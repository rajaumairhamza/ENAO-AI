
/* ============================================================================
 * ENAO AI — research-live piece 23-video.js
 * PRD section 6: video search + display.
 *
 * What this piece does:
 *  - Discovers videos through free sources only (Lifetime Free Rule: no
 *    paid API, no key): the existing same-origin proxy /api/search (which
 *    already returns real video links from DuckDuckGo Lite) and, where a
 *    channel is known, that channel's public YouTube RSS feed
 *    (feeds/videos.xml) fetched through /api/fetch. DuckDuckGo video
 *    results are attempted through /api/fetch as well, where reachable.
 *  - Normalises every hit into one result shape. Nothing is invented:
 *    publishedAt and duration are null when the source did not actually
 *    provide them, and thumbnailUrl is set only when the source actually
 *    returned a thumbnail URL.
 *  - searchVideos({query, platforms, maxResults}) returns relevant
 *    videos only: non-video website links are filtered out, results are
 *    deduplicated by URL, and results from all platforms are compared
 *    in one list (relevance first).
 *  - videoCardHtml(result) renders a card with thumbnail-or-placeholder,
 *    title, channel, date-or-'date not available', duration-or-unknown,
 *    and a direct "Watch on {platform}" link. A play affordance appears
 *    ONLY when the video is embeddable; otherwise the card shows the
 *    direct link and no play button at all.
 *  - embedHtml(result) returns an iframe ONLY when embeddable === true.
 *    Anything else returns null and the caller shows thumbnail + link.
 *  - summarizeVideo(result, transcriptOrText) summarises ONLY from text
 *    actually provided. With no transcript or page text it says so
 *    plainly instead of inventing a summary.
 *
 * What it does NOT do:
 *  - It does not call any paid API and needs no key. It does not run a
 *    general web search for a video topic and it never returns a plain
 *    web page as a video. It does not guess a publish date, a duration,
 *    a view count, or a thumbnail: fields the source did not return
 *    stay null and are shown as unknown.
 *  - It cannot know whether one particular video's owner disabled
 *    embedding, or whether a video is age-restricted. embeddable ===
 *    true means the platform permits embedding by default through its
 *    official player URL; the per-video exceptions are recorded in
 *    23-video.EVIDENCE.md and the caller must still show the direct
 *    link next to any embed.
 *
 * Style: plain ES5, var + function declarations, no modules, no DOM
 * dependency for the pure helpers. Network goes through injected
 * fetch functions so the piece is testable in Node; in the browser the
 * defaults use the same-origin /api/search and /api/fetch endpoints
 * the live export already uses (see enao-ai.html: serverSearch and
 * fetchPageInfo). Zero emojis. No CSS blur effects anywhere.
 * ========================================================================== */
(function (root) {

var VERSION = '23-video v1.0 (enao-research-live, 22 Nov 2026)';

/* ---------- platform table ---------- */
var PLATFORMS = {
  youtube: {
    label: 'YouTube',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com',
            'youtu.be', 'www.youtu.be', 'youtube-nocookie.com',
            'www.youtube-nocookie.com'],
    embedBase: 'https://www.youtube-nocookie.com/embed/'
  },
  vimeo: {
    label: 'Vimeo',
    hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
    embedBase: 'https://player.vimeo.com/video/'
  },
  dailymotion: {
    label: 'Dailymotion',
    hosts: ['dailymotion.com', 'www.dailymotion.com'],
    embedBase: 'https://www.dailymotion.com/embed/video/'
  },
  other: {
    label: 'Video',
    hosts: [],
    embedBase: ''
  }
};
var SUPPORTED_PLATFORMS = ['youtube', 'vimeo', 'dailymotion', 'other'];

/* Per-source status as actually tested on 22 Nov 2026. The same table,
   with the full notes, lives in 23-video.EVIDENCE.md. */
var SOURCE_STATUS = [
  { source: 'proxy-search',
    method: 'GET /api/search?q=<query> (same-origin proxy: DuckDuckGo Lite + Wikipedia + Google News)',
    status: 'verified-live',
    note: 'Live call on 22 Nov 2026 returned real YouTube, Vimeo and Dailymotion video links among its results.' },
  { source: 'youtube-rss',
    method: 'GET /api/fetch?url=https://www.youtube.com/feeds/videos.xml?channel_id=<UC id>',
    status: 'documented-unverified-live',
    note: 'Feed format is documented (Atom, 15 newest entries, videoId / title / link / published / media:thumbnail / media:description). A direct fetch in this session returned a placeholder page instead of Atom XML, so the live fetch is still unverified.' },
  { source: 'youtube-oembed',
    method: 'GET https://www.youtube.com/oembed?url=<watch url>&format=json',
    status: 'documented-unverified-live',
    note: 'Keyless endpoint, documented to return title and author only (no date, no duration). Direct fetch in this session returned a placeholder page instead of JSON. Not used by this piece.' },
  { source: 'ddg-video-html',
    method: 'GET /api/fetch?url=https://html.duckduckgo.com/html/?q=<query>&iax=videos&ia=videos',
    status: 'blocked-in-session',
    note: 'Direct fetch on 22 Nov 2026 returned a bot-challenge page ("confirm this search was made by a human"). The piece still attempts it through the proxy and reports blocked when the challenge text comes back.' },
  { source: 'vimeo-search',
    method: 'none keyless; videos arrive via /api/search',
    status: 'unverified',
    note: 'No keyless Vimeo search endpoint is used. Vimeo videos found by the proxy are recognised by URL and embedded through the official player URL.' },
  { source: 'dailymotion-search',
    method: 'none keyless; videos arrive via /api/search',
    status: 'unverified',
    note: 'No keyless Dailymotion search endpoint is used. Dailymotion videos found by the proxy are recognised by URL and embedded through the official player URL.' },
  { source: 'generic-video-pages',
    method: 'URL pattern match on /api/search results (/video/, /videos/, /watch)',
    status: 'verified-live',
    note: 'The live proxy call returned video pages on other hosts (for example a /video/ page). They are listed with embeddable "unknown": a direct link only, never an iframe.' }
];

/* ---------- small helpers ---------- */
function vidTrim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '');
}
function vidIsPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function vidHas(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function vidEscapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function vidIsHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\/[^\/\s]+/i.test(vidTrim(u));
}
function vidHostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    var m = String(u || '').match(/^https?:\/\/([^\/\s:?#]+)/i);
    return m ? m[1].replace(/^www\./, '').toLowerCase() : '';
  }
}

/* ---------- PUBLIC: detectPlatform / extractVideoId ---------- */
function detectPlatform(url) {
  if (!vidIsHttpUrl(url)) return null;
  var host = vidHostOf(url);
  var p;
  for (p in PLATFORMS) {
    if (!vidHas(PLATFORMS, p) || p === 'other') continue;
    var hosts = PLATFORMS[p].hosts;
    var i;
    for (i = 0; i < hosts.length; i++) {
      if (host === hosts[i].replace(/^www\./, '')) return p;
    }
  }
  return 'other';
}

function extractVideoId(url, platform) {
  if (!vidIsHttpUrl(url)) return null;
  var plat = platform || detectPlatform(url);
  var m;
  if (plat === 'youtube') {
    m = String(url).match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
    m = String(url).match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
    m = String(url).match(/\/(shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[2];
    return null;
  }
  if (plat === 'vimeo') {
    m = String(url).match(/vimeo\.com\/(?:video\/|channels\/[^\/]+\/|groups\/[^\/]+\/videos\/)?(\d+)/);
    if (m) return m[1];
    return null;
  }
  if (plat === 'dailymotion') {
    m = String(url).match(/dailymotion\.com\/video\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    m = String(url).match(/dai\.ly\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    return null;
  }
  return null;
}

/* A URL counts as a video link only when it is a recognised platform
   video URL, or when its path carries a video segment (/video/,
   /videos/, /watch). A page that merely mentions a video in its title
   or snippet is NOT a video link: the live proxy returns such pages
   (a gallery page, a resource page) and they must be dropped here,
   never shown as videos. */
function isVideoUrl(url) {
  if (!vidIsHttpUrl(url)) return false;
  var plat = detectPlatform(url);
  if (plat === 'youtube' || plat === 'vimeo' || plat === 'dailymotion') {
    return extractVideoId(url, plat) !== null;
  }
  var path = '';
  try { path = new URL(url).pathname; } catch (e) {
    var m = String(url).match(/^https?:\/\/[^\/]+(\/[^?#]*)/);
    path = m ? m[1] : '';
  }
  return /(^|\/)video\/|(^|\/)videos\/|(^|\/)watch(\/|$)/i.test(path);
}

/* ---------- duration / date: never invented ---------- */
function parseDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  var n;
  if (typeof value === 'number') {
    if (!isFinite(value) || value <= 0 || value > 172800) return null;
    return Math.round(value);
  }
  var s = vidTrim(value);
  if (/^\d+$/.test(s)) {
    n = parseInt(s, 10);
    if (n <= 0 || n > 172800) return null;
    return n;
  }
  var iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    n = (parseInt(iso[1] || '0', 10) * 3600) +
        (parseInt(iso[2] || '0', 10) * 60) +
        Math.round(parseFloat(iso[3] || '0'));
    return n > 0 ? n : null;
  }
  var parts = s.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (parts) {
    if (parts[3] !== undefined) {
      return (parseInt(parts[1], 10) * 3600) +
             (parseInt(parts[2], 10) * 60) + parseInt(parts[3], 10);
    }
    return (parseInt(parts[1], 10) * 60) + parseInt(parts[2], 10);
  }
  return null;
}

function parsePublishedAt(value) {
  if (value === null || value === undefined || value === '') return null;
  var t = Date.parse(vidTrim(value));
  if (isNaN(t)) return null;
  var d = new Date(t);
  if (d.getFullYear() < 2005 || d.getFullYear() > 2100) return null;
  return d.toISOString();
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return null;
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  function two(n) { return (n < 10 ? '0' : '') + n; }
  if (h > 0) return h + ':' + two(m) + ':' + two(s);
  return m + ':' + two(s);
}

/* ---------- PUBLIC: embed rules ---------- */
/* Official player URLs. YouTube uses the privacy-enhanced host, as
   the live export's own guidance does. Vimeo uses dnt=1. These are
   the platforms' documented embed addresses; a video whose owner
   disabled embedding, or an age-restricted video, will still refuse
   to play inside the frame, which is why the direct link is always
   shown next to any embed. */
function embedUrlFor(platform, videoId) {
  if (!videoId) return null;
  if (platform === 'youtube') return PLATFORMS.youtube.embedBase + videoId;
  if (platform === 'vimeo') return PLATFORMS.vimeo.embedBase + videoId + '?dnt=1';
  if (platform === 'dailymotion') return PLATFORMS.dailymotion.embedBase + videoId;
  return null;
}

/* ---------- PUBLIC: normalizeResult ---------- */
/* Turns one raw hit into the result shape, or null when the hit is
   not usable. A result is only ever built from fields the source
   actually supplied: publishedAt, duration and thumbnailUrl are null
   unless the source returned a usable value. */
function normalizeResult(raw) {
  if (!vidIsPlainObject(raw)) return null;
  var url = vidTrim(raw.url || '');
  if (!vidIsHttpUrl(url)) return null;
  var title = vidTrim(raw.title || '');
  if (!title) return null;
  var platform = (typeof raw.platform === 'string' &&
    vidHas(PLATFORMS, raw.platform)) ? raw.platform : detectPlatform(url);
  var videoId = null;
  if (typeof raw.videoId === 'string' && vidTrim(raw.videoId)) {
    videoId = vidTrim(raw.videoId);
  } else {
    videoId = extractVideoId(url, platform);
  }
  var channel = vidTrim(raw.channel || raw.author || '');
  var description = vidTrim(raw.description || raw.snippet || '');
  var publishedAt = parsePublishedAt(
    raw.publishedAt || raw.published || raw.pubDate || raw.date || null);
  var thumbnailUrl = null;
  var thumb = vidTrim(raw.thumbnailUrl || raw.thumbnail || '');
  if (vidIsHttpUrl(thumb)) thumbnailUrl = thumb;
  var duration = parseDuration(
    vidHas(raw, 'duration') ? raw.duration : null);
  var embeddable;
  var embedUrl = null;
  if (raw.embeddable === false) {
    embeddable = false;
  } else if (raw.embeddable === 'unknown') {
    embeddable = 'unknown';
  } else if (platform === 'youtube' || platform === 'vimeo' ||
             platform === 'dailymotion') {
    if (videoId) {
      embeddable = true;
      embedUrl = embedUrlFor(platform, videoId);
    } else {
      embeddable = 'unknown';
    }
  } else {
    embeddable = 'unknown';
  }
  return {
    platform: platform,
    videoId: videoId,
    title: title.slice(0, 200),
    channel: channel || null,
    description: description ? description.slice(0, 500) : null,
    publishedAt: publishedAt,
    url: url,
    thumbnailUrl: thumbnailUrl,
    duration: duration,
    embeddable: embeddable,
    embedUrl: embedUrl
  };
}

/* Mark a result as known-not-embeddable (for example after a live
   probe shows the player refusing). Returns a copy; the input is
   not mutated. */
function markNotEmbeddable(result) {
  if (!vidIsPlainObject(result)) return null;
  var copy = {};
  var k;
  for (k in result) {
    if (vidHas(result, k)) copy[k] = result[k];
  }
  copy.embeddable = false;
  copy.embedUrl = null;
  return copy;
}

/* ---------- canonical URL + dedupe ---------- */
function canonicalUrl(result) {
  if (!result || !result.url) return '';
  if (result.videoId &&
      (result.platform === 'youtube' || result.platform === 'vimeo' ||
       result.platform === 'dailymotion')) {
    if (result.platform === 'youtube') {
      return 'https://www.youtube.com/watch?v=' + result.videoId;
    }
    if (result.platform === 'vimeo') {
      return 'https://vimeo.com/' + result.videoId;
    }
    return 'https://www.dailymotion.com/video/' + result.videoId;
  }
  var u = vidTrim(result.url).replace(/#.*$/, '');
  u = u.replace(/([?&])(utm_[^=&]*|fbclid|gclid|mc_cid|mc_eid)=[^&]*&?/gi, '$1');
  u = u.replace(/[?&]$/, '').replace(/\/$/, '');
  return u.toLowerCase();
}

function dedupeResults(results) {
  var seen = {};
  var out = [];
  var i;
  for (i = 0; i < (results || []).length; i++) {
    var r = results[i];
    if (!r || !r.url) continue;
    var key = canonicalUrl(r);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push(r);
  }
  return out;
}

/* ---------- relevance ---------- */
var VIDEO_STOPWORDS = {
  the: 1, and: 1, for: 1, with: 1, from: 1, about: 1, video: 1,
  videos: 1, watch: 1, free: 1, online: 1, best: 1, top: 1,
  how: 1, what: 1, why: 1, when: 1, where: 1, are: 1, you: 1,
  aur: 1, kya: 1, hai: 1, ka: 1, ki: 1, ke: 1, mein: 1, se: 1
};

function queryTerms(query) {
  var words = String(query || '').toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ').split(/\s+/);
  var out = [];
  var i;
  for (i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length > 2 && !VIDEO_STOPWORDS[w] && out.indexOf(w) === -1) {
      out.push(w);
    }
  }
  return out;
}

function relevanceScore(result, terms) {
  if (!terms || !terms.length) return 1;
  var hay = ((result.title || '') + ' ' + (result.description || '') +
             ' ' + (result.channel || '')).toLowerCase();
  var hits = 0;
  var i, j;
  for (i = 0; i < terms.length; i++) {
    /* A singular/plural mismatch must not drop a relevant video:
       'tides' in the query matches 'tide' in a title, and the
       reverse. Only the trailing 's' is varied; nothing else is
       stemmed, so unrelated words cannot match. */
    var variants = [terms[i]];
    if (/s$/.test(terms[i])) variants.push(terms[i].slice(0, -1));
    else variants.push(terms[i] + 's');
    for (j = 0; j < variants.length; j++) {
      if (hay.indexOf(variants[j]) !== -1) { hits++; break; }
    }
  }
  return hits / terms.length;
}

function filterRelevant(results, query) {
  var terms = queryTerms(query);
  if (!terms.length) return (results || []).slice();
  var out = [];
  var i;
  for (i = 0; i < (results || []).length; i++) {
    if (relevanceScore(results[i], terms) > 0) out.push(results[i]);
  }
  return out;
}

/* ---------- pure parsers (no network) ---------- */
/* YouTube channel RSS (Atom). Fields follow the documented feed:
   yt:videoId, title, link rel="alternate", published,
   media:thumbnail url, media:description, author/name. Entries
   missing a video id or a link are dropped, never repaired with a
   guessed URL. */
function vidTagText(block, tag) {
  var m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/^\s+|\s+$/g, '');
}
function vidTagAttr(block, tag, attr) {
  var m = block.match(new RegExp('<' + tag + '[^>]*' + attr + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
}

function parseYouTubeRss(xmlText, channelName) {
  var out = [];
  if (typeof xmlText !== 'string' || !xmlText) return out;
  var entries = xmlText.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  var i;
  for (i = 0; i < entries.length; i++) {
    var e = entries[i];
    var videoId = vidTagText(e, 'yt:videoId');
    var link = vidTagAttr(e, 'link', 'href');
    if (!videoId || !vidIsHttpUrl(link)) continue;
    var author = vidTagText(e, 'author');
    var name = '';
    if (author) {
      var nm = author.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
      if (nm) name = nm[1].replace(/<[^>]+>/g, '').replace(/^\s+|\s+$/g, '');
    }
    var r = normalizeResult({
      platform: 'youtube',
      videoId: videoId,
      title: vidTagText(e, 'title'),
      channel: name || channelName || null,
      description: vidTagText(e, 'media:description'),
      publishedAt: vidTagText(e, 'published'),
      url: link,
      thumbnailUrl: vidTagAttr(e, 'media:thumbnail', 'url')
    });
    if (r) out.push(r);
  }
  return out;
}

/* DuckDuckGo video results page (HTML). Same link extraction as the
   proxy's ddg_lite: result__a links, uddg decoding, ads dropped.
   Returns [] on a challenge page: the caller reports 'blocked'. */
function parseDdgVideoHtml(html) {
  var out = [];
  if (typeof html !== 'string' || !html) return out;
  var re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    var title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/^\s+|\s+$/g, '');
    var real = href;
    if (href.indexOf('uddg=') !== -1) {
      var q = href.split('uddg=')[1].split('&')[0];
      try { real = decodeURIComponent(q); } catch (e) { real = ''; }
    }
    if (!vidIsHttpUrl(real) || !title) continue;
    var low = real.toLowerCase();
    if (low.indexOf('duckduckgo.com/y.js') !== -1 ||
        low.indexOf('aclick') !== -1 ||
        low.indexOf('bing.com/aclk') !== -1) continue;
    if (!isVideoUrl(real)) continue;
    var r = normalizeResult({ title: title, url: real });
    if (r) out.push(r);
  }
  return out;
}

function isDdgChallenge(html) {
  return typeof html === 'string' &&
    /confirm this search was made by a human|anomaly|challenge/i.test(html);
}

/* ---------- network defaults (browser) ---------- */
function defaultFetchJson(url) {
  if (typeof fetch !== 'function') {
    return Promise.resolve(null);
  }
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  });
}
function defaultFetchText(url) {
  if (typeof fetch !== 'function') {
    return Promise.resolve('');
  }
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function (j) {
    return (j && typeof j.text === 'string') ? j.text : '';
  });
}

/* ---------- PUBLIC: searchVideos ---------- */
/* options: {query, platforms, maxResults, channelIds, fetchJson,
   fetchText}. fetchJson defaults to the same-origin /api/search
   call; fetchText defaults to the same-origin /api/fetch call (used
   for YouTube RSS and the DuckDuckGo video page). Both are
   injectable so the function is testable without a network.
   Resolves (never rejects for a source failure) to
   {query, results, sources, error}. sources records the real outcome
   of every source attempted: ok / empty / failed / blocked /
   skipped / unverified. */
function searchVideos(options) {
  var opts = vidIsPlainObject(options) ? options : {};
  var query = vidTrim(opts.query || '');
  var maxResults = parseInt(opts.maxResults, 10);
  if (isNaN(maxResults) || maxResults <= 0) maxResults = 8;
  if (maxResults > 20) maxResults = 20;
  var wanted = Array.isArray(opts.platforms) && opts.platforms.length
    ? opts.platforms : SUPPORTED_PLATFORMS.slice();
  var fetchJson = (typeof opts.fetchJson === 'function')
    ? opts.fetchJson : defaultFetchJson;
  var fetchText = (typeof opts.fetchText === 'function')
    ? opts.fetchText : defaultFetchText;
  var channelIds = Array.isArray(opts.channelIds) ? opts.channelIds : [];

  if (!query) {
    return Promise.resolve({
      query: '',
      results: [],
      sources: [],
      error: 'A search query is needed.'
    });
  }

  var sources = [];
  function record(name, status, count, note) {
    sources.push({ name: name, status: status,
                   count: count || 0, note: note || '' });
  }

  /* 1) The proxy: bias the query toward video results, then keep
     only links that are actually video links. */
  /* FIX 2 (v63): the query sent to the proxy drops the named platform
     place word; `query` itself stays unchanged for relevance below. */
  var cleanQ = query;
  try{ cleanQ = stripPlaceWordFromQuery(query, detectSource(query).source); }catch(e){}
  if (!cleanQ) cleanQ = query;
  var searchQuery = /\bvideo\b/i.test(cleanQ) ? cleanQ : cleanQ + ' video';
  var proxyP = Promise.resolve().then(function () {
    return fetchJson(window.EnzoPagesBackend.getSearchUrl('/api/search?q=' + encodeURIComponent(searchQuery)));
  }).then(function (j) {
    var arr = Array.isArray(j) ? j : ((j && (j.results || j.items)) || []);
    var found = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      var raw = arr[i];
      if (!raw || !raw.url || !isVideoUrl(raw.url)) continue;
      var r = normalizeResult({
        title: raw.title,
        url: raw.url,
        description: raw.snippet || raw.description || '',
        publishedAt: raw.pubDate || raw.published || null
      });
      if (r) found.push(r);
    }
    record('proxy-search', found.length ? 'ok' : 'empty', found.length,
      found.length ? '' : 'The proxy returned no video links for this query.');
    return found;
  }).catch(function (e) {
    record('proxy-search', 'failed', 0,
      'The search service could not be reached: ' +
      (e && e.message ? String(e.message) : 'network error'));
    return [];
  });

  /* 2) YouTube channel RSS, only when channel IDs are supplied.
     A channel feed lists that channel's newest videos; it cannot
     search by topic, so its entries are relevance-filtered below
     like every other source. */
  var rssP;
  if (!channelIds.length) {
    record('youtube-rss', 'skipped', 0,
      'No channel IDs were supplied, so no channel feed was read.');
    rssP = Promise.resolve([]);
  } else {
    var jobs = channelIds.map(function (ch) {
      var id = typeof ch === 'string' ? ch : (ch && ch.channelId) || '';
      var name = (ch && ch.channelName) || null;
      if (!/^UC[A-Za-z0-9_-]{10,}$/.test(id)) return Promise.resolve([]);
      var feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id;
      return Promise.resolve().then(function () {
        return fetchText(window.EnzoPagesBackend.getSearchUrl('/api/fetch?url=' + encodeURIComponent(feedUrl)));
      }).then(function (text) {
        return parseYouTubeRss(text, name);
      }).catch(function () { return []; });
    });
    rssP = Promise.all(jobs).then(function (lists) {
      var all = [];
      var i;
      for (i = 0; i < lists.length; i++) all = all.concat(lists[i]);
      record('youtube-rss', all.length ? 'ok' : 'empty', all.length,
        all.length ? '' : 'The channel feeds returned no videos.');
      return all;
    });
  }

  /* 3) DuckDuckGo video results, through the proxy's fetch endpoint.
     Frequently blocked by a bot challenge; that is reported, not
     hidden. */
  var ddgP = Promise.resolve().then(function () {
    var pageUrl = 'https://html.duckduckgo.com/html/?q=' +
      encodeURIComponent(searchQuery) + '&iax=videos&ia=videos';
    return fetchText(window.EnzoPagesBackend.getSearchUrl('/api/fetch?url=' + encodeURIComponent(pageUrl)));
  }).then(function (html) {
    if (isDdgChallenge(html)) {
      record('ddg-video-html', 'blocked', 0,
        'DuckDuckGo returned a bot-challenge page instead of results.');
      return [];
    }
    var found = parseDdgVideoHtml(html);
    record('ddg-video-html', found.length ? 'ok' : 'empty', found.length,
      found.length ? '' : 'No video links were parsed from the page.');
    return found;
  }).catch(function (e) {
    record('ddg-video-html', 'failed', 0,
      'The video results page could not be read: ' +
      (e && e.message ? String(e.message) : 'network error'));
    return [];
  });

  return Promise.all([proxyP, rssP, ddgP]).then(function (lists) {
    var merged = [];
    var i, j;
    for (i = 0; i < lists.length; i++) {
      for (j = 0; j < lists[i].length; j++) merged.push(lists[i][j]);
    }
    var relevant = filterRelevant(merged, query);
    var byPlatform = [];
    var k;
    for (k = 0; k < relevant.length; k++) {
      if (wanted.indexOf(relevant[k].platform) !== -1) {
        byPlatform.push(relevant[k]);
      }
    }
    var terms = queryTerms(query);
    var scored = byPlatform.map(function (r) {
      return { r: r, score: relevanceScore(r, terms) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var sorted = [];
    for (k = 0; k < scored.length; k++) sorted.push(scored[k].r);
    var deduped = dedupeResults(sorted).slice(0, maxResults);
    return { query: query, results: deduped, sources: sources, error: null };
  });
}

/* ---------- PUBLIC: videoCardHtml / embedHtml ---------- */
function platformLabel(platform) {
  return (platform && PLATFORMS[platform]) ? PLATFORMS[platform].label : 'Video';
}

function videoCardHtml(result) {
  if (!vidIsPlainObject(result) || !vidIsHttpUrl(result.url) ||
      !vidTrim(result.title || '')) {
    return '';
  }
  var label = platformLabel(result.platform);
  var dateText = result.publishedAt
    ? vidTrim(String(result.publishedAt)).slice(0, 10)
    : 'date not available';
  var dur = formatDuration(
    (typeof result.duration === 'number') ? result.duration : null);
  var durText = dur || 'duration unknown';
  var channelText = vidTrim(result.channel || '') || 'channel not listed';
  var thumb = '';
  if (vidIsHttpUrl(result.thumbnailUrl)) {
    thumb = '<img class="enzo-video-thumb" src="' +
      vidEscapeHtml(result.thumbnailUrl) + '" alt="" loading="lazy" ' +
      'decoding="async" onerror="this.style.display=\'none\'">';
  } else {
    thumb = '<div class="enzo-video-thumb-placeholder">No thumbnail</div>';
  }
  var play = '';
  if (result.embeddable === true && vidIsHttpUrl(result.embedUrl)) {
    play = '<button type="button" class="enzo-video-play" ' +
      'data-act="enzo-video-play" data-embed="' +
      vidEscapeHtml(result.embedUrl) + '">Play here</button>';
  }
  return '<div class="enzo-video-card" data-platform="' +
    vidEscapeHtml(result.platform || 'other') + '">' +
    thumb +
    '<div class="enzo-video-body">' +
    '<h3 class="enzo-video-title">' + vidEscapeHtml(result.title) + '</h3>' +
    '<p class="enzo-video-channel">' + vidEscapeHtml(channelText) + '</p>' +
    '<p class="enzo-video-meta">' + vidEscapeHtml(dateText) + ' &middot; ' +
    vidEscapeHtml(durText) + '</p>' +
    '<a class="enzo-video-watch" href="' + vidEscapeHtml(result.url) +
    '" target="_blank" rel="noopener">Watch on ' +
    vidEscapeHtml(label) + '</a>' +
    play +
    '</div></div>';
}

/* An iframe is returned ONLY when the result is embeddable and the
   platform's official player URL is present. Anything else returns
   null: the caller must show the thumbnail and the direct link
   instead, and must never render a player that cannot play. */
function embedHtml(result) {
  if (!vidIsPlainObject(result)) return null;
  if (result.embeddable !== true) return null;
  if (!vidIsHttpUrl(result.embedUrl)) return null;
  return '<iframe src="' + vidEscapeHtml(result.embedUrl) + '" ' +
    'title="' + vidEscapeHtml(result.title || 'Video') + '" ' +
    'width="560" height="315" frameborder="0" loading="lazy" ' +
    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; ' +
    'gyroscope; picture-in-picture" allowfullscreen></iframe>';
}

/* ---------- PUBLIC: summarizeVideo ---------- */
/* Summarises ONLY from text actually provided (a transcript, or page
   text fetched for the video). With no source text it refuses in
   plain words instead of inventing a summary. The summary is
   extractive: the first sentences of the provided text, nothing
   added. */
function summarizeVideo(result, transcriptOrText) {
  if (!vidIsPlainObject(result) || !vidIsHttpUrl(result.url)) {
    return { available: false, summary: null, sentences: 0, source: null,
      message: 'No video was provided, so there is nothing to summarise.' };
  }
  var text = vidTrim(transcriptOrText || '');
  if (!text) {
    return { available: false, summary: null, sentences: 0, source: null,
      message: 'No transcript or page text was provided for this video, ' +
        'so no summary can be written. Provide a transcript or fetch ' +
        'the video page text first.' };
  }
  var sentences = text.match(/[^.!?]+[.!?]+["')]?/g) || [text];
  var picked = sentences.slice(0, 3);
  var summary = vidTrim(picked.join(' '));
  if (summary.length > 600) {
    var cut = summary.slice(0, 600);
    var lastSpace = cut.lastIndexOf(' ');
    summary = (lastSpace > 200 ? cut.slice(0, lastSpace) : cut) + '...';
  }
  return { available: true, summary: summary,
    sentences: picked.length, source: 'provided-text',
    message: 'Summary uses only the text provided; nothing was added from elsewhere.' };
}

/* ---------- PUBLIC: sourceStatus ---------- */
function sourceStatus() {
  var out = [];
  var i;
  for (i = 0; i < SOURCE_STATUS.length; i++) {
    out.push({
      source: SOURCE_STATUS[i].source,
      method: SOURCE_STATUS[i].method,
      status: SOURCE_STATUS[i].status,
      note: SOURCE_STATUS[i].note
    });
  }
  return out;
}

/* ---------- export tail (guarded, same pattern as the other pieces) ---------- */
var EnzoVideo = {
  VERSION: VERSION,
  PLATFORMS: PLATFORMS,
  SUPPORTED_PLATFORMS: SUPPORTED_PLATFORMS,
  sourceStatus: sourceStatus,
  detectPlatform: detectPlatform,
  extractVideoId: extractVideoId,
  isVideoUrl: isVideoUrl,
  parseDuration: parseDuration,
  parsePublishedAt: parsePublishedAt,
  formatDuration: formatDuration,
  embedUrlFor: embedUrlFor,
  normalizeResult: normalizeResult,
  markNotEmbeddable: markNotEmbeddable,
  canonicalUrl: canonicalUrl,
  dedupeResults: dedupeResults,
  queryTerms: queryTerms,
  relevanceScore: relevanceScore,
  filterRelevant: filterRelevant,
  parseYouTubeRss: parseYouTubeRss,
  parseDdgVideoHtml: parseDdgVideoHtml,
  isDdgChallenge: isDdgChallenge,
  searchVideos: searchVideos,
  videoCardHtml: videoCardHtml,
  embedHtml: embedHtml,
  summarizeVideo: summarizeVideo
};

if (typeof root !== 'undefined') root.EnzoVideo = EnzoVideo;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnzoVideo;
}

})(typeof window !== 'undefined' ? window : this);
