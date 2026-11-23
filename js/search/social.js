
/* ============================================================================
 * ENAO AI — research-live piece 22-social.js
 * PRD section 5: Universal Social Media Research Engine.
 *
 * What this piece does:
 *  - registerPlatform(def): an extensible platform registry. Adding a new
 *    platform is one registerPlatform call; the engine itself never
 *    changes. A def is {id, name, kinds, searchUrl(query), publicAccess,
 *    domain, free, needsAuth, needsApi, unsupported, fallback, notes}.
 *    kinds is a subset of ['posts','videos','profiles','hashtags',
 *    'trending']. publicAccess is one of 'rss' | 'public-page' |
 *    'public-json' | 'requires-auth' | 'unsupported'.
 *  - capabilityMatrix(): for every platform, exactly what works WITHOUT
 *    any key or login (free public access only — Lifetime Free Rule, no
 *    paid API or key ever) vs what needs auth / API access / is
 *    unsupported by the platform. Status is one of 'works-free' |
 *    'needs-auth' | 'needs-api' | 'unsupported'. Private accounts,
 *    private messages and restricted content are NEVER claimed
 *    searchable: every platform lists them under 'unsupported'.
 *  - planSearch(opts): pure planning. Picks the platforms relevant to
 *    the query (kind match + query hints), includes only the ones that
 *    are accessible without a key/login, and lists every skipped
 *    platform with the plain reason and its legitimate fallback.
 *  - searchSocial(opts, fetcher): runs the plan. Queries only the
 *    accessible platforms, through the existing same-origin proxy
 *    (/api/search with a site: filter, /api/fetch to verify a result
 *    page) via the injected fetcher. Merges results across platforms,
 *    dedupes by URL, ranks by relevance. Returns
 *    {query, planned, searchedPlatforms, results, skipped, errors}.
 *  - verifyResult(result, fetcher): fetches the result URL through
 *    /api/fetch and upgrades verified to 'platform-reported' only when
 *    the fetched page text actually contains the result title.
 *  - platformStatus(): every platform with its honest implementation
 *    status: 'fully-implemented-tested' | 'partially-implemented' |
 *    'waiting-api-access' | 'waiting-authentication' |
 *    'unsupported-by-platform' | 'not-yet-implemented', plus the reason
 *    and whether it was verified live.
 *  - normaliseResult(platformId, raw): shapes one raw proxy item into
 *    {platform, account, title, description, publishedAt, url,
 *    engagement, engagementNote, verified, context}. publishedAt is
 *    null when the source gave no parseable date — a date is NEVER
 *    invented. engagement is null unless the source actually returned
 *    a finite number — follower/like/view counts are NEVER invented.
 *
 * What it does NOT do:
 *  - It never uses a paid API or a key, and it never logs in anywhere.
 *  - It never searches a platform that blocks unauthenticated search:
 *    those platforms are skipped with a plain reason and the engine
 *    falls back to legitimate indexed sources (the web-search proxy).
 *  - It never claims private accounts, messages or restricted content
 *    are searchable.
 *  - No network of its own: all fetching goes through the injected
 *    fetcher (default: same-origin /api/search and /api/fetch via
 *    global fetch). No DOM, no dependencies. Plain ES5.
 *
 * Style: plain ES5, var + function declarations, no modules.
 * Zero emojis. No hardcoded topic names in the logic.
 * ========================================================================== */
(function (root) {

var VERSION = '22-social v1.0 (enao-research-live, 22 Nov 2026)';

/* The five content kinds a platform may offer. */
var KINDS = ['posts', 'videos', 'profiles', 'hashtags', 'trending'];

var ACCESS_STATUSES = ['works-free', 'needs-auth', 'needs-api',
  'unsupported'];

var IMPL_STATUSES = ['fully-implemented-tested', 'partially-implemented',
  'waiting-api-access', 'waiting-authentication',
  'unsupported-by-platform', 'not-yet-implemented'];

var PUBLIC_ACCESS = ['rss', 'public-page', 'public-json',
  'requires-auth', 'unsupported'];

var VERIFIED_VALUES = ['platform-reported', 'independently-verified',
  'unverified'];

/* ---------- small helpers ---------- */
function socTrim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '');
}
function socIsPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function socHas(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function socCopyList(list) {
  var out = [];
  var i;
  if (!Array.isArray(list)) return out;
  for (i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}
function socEncode(q) {
  return encodeURIComponent(String(q));
}
function socValidId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);
}
function socValidKinds(kinds) {
  var i;
  if (!Array.isArray(kinds) || kinds.length === 0) return false;
  for (i = 0; i < kinds.length; i++) {
    if (KINDS.indexOf(kinds[i]) === -1) return false;
  }
  return true;
}
/* Parse a date only when the source actually gave one that parses.
   Anything else (missing, empty, garbage) is null — never today,
   never a guess. Returns an ISO string or null. */
function socParseDate(value) {
  var t;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    t = value.getTime();
    return isNaN(t) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    /* Unix seconds (10 digits) vs milliseconds (13 digits). */
    t = value < 100000000000 ? value * 1000 : value;
    var d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== 'string' || socTrim(value) === '') return null;
  t = Date.parse(socTrim(value));
  if (isNaN(t)) return null;
  return new Date(t).toISOString();
}
/* Engagement counts only when the source returned a real finite
   number. Humanised strings ('1.2K'), formatted strings ('1,204')
   and anything else are NOT parsed: the field stays null with a
   note, because parsing them would be inventing precision. */
function socParseEngagement(raw) {
  if (!socIsPlainObject(raw)) return { value: null, note: null };
  var fields = ['likes', 'views', 'followers', 'shares', 'comments',
    'engagement'];
  var found = {};
  var i, v;
  for (i = 0; i < fields.length; i++) {
    v = raw[fields[i]];
    if (typeof v === 'number' && isFinite(v)) found[fields[i]] = v;
  }
  var keys = [];
  for (i = 0; i < fields.length; i++) {
    if (socHas(found, fields[i])) keys.push(fields[i]);
  }
  if (keys.length === 0) {
    return { value: null,
      note: 'engagement not returned by the source' };
  }
  var out = {};
  for (i = 0; i < keys.length; i++) out[keys[i]] = found[keys[i]];
  return { value: out, note: null };
}
/* Normalise a URL for dedupe: lowercase scheme+host, drop fragment,
   drop tracking params, drop a trailing slash, drop www. Two links
   that differ only by tracking params are the same result. */
function socNormaliseUrl(url) {
  var u = socTrim(url);
  if (!/^https?:\/\//i.test(u)) return u.toLowerCase();
  var hash = u.indexOf('#');
  if (hash !== -1) u = u.slice(0, hash);
  var q = u.indexOf('?');
  var query = q === -1 ? '' : u.slice(q + 1);
  var kept = [];
  if (query) {
    var parts = query.split('&');
    var i;
    for (i = 0; i < parts.length; i++) {
      var k = parts[i].split('=')[0].toLowerCase();
      if (k === '' || k.indexOf('utm_') === 0 || k === 'fbclid' ||
          k === 'gclid' || k === 'igshid' || k === 'si') continue;
      kept.push(parts[i]);
    }
  }
  var out;
  /* Rebuild from the original base with only scheme+host lowercased:
     paths are case-sensitive on some hosts, so the path keeps its
     original case. */
  var origBase = q === -1 ? u : u.slice(0, q);
  var m2 = origBase.match(/^(https?:\/\/)([^\/]+)(\/.*)?$/i);
  if (!m2) return u.toLowerCase();
  var host = m2[2].toLowerCase().replace(/^www\./, '');
  var path = m2[3] || '';
  if (path.length > 1 && path.charAt(path.length - 1) === '/') {
    path = path.slice(0, -1);
  }
  out = m2[1].toLowerCase() + host + path;
  if (kept.length) out += '?' + kept.join('&');
  return out;
}
function socDomainOf(url) {
  var m = String(url || '').match(/^(?:https?:\/\/)?([^\/\?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/* ---------- platform registry ---------- */
/* The registry holds stored defs. A stored def keeps the caller's
   searchUrl function by reference and copies every list, so later
   mutation of the caller's arrays cannot change the registry. */
var registry = {};

function socStoreDef(def) {
  return {
    id: def.id,
    name: def.name,
    kinds: socCopyList(def.kinds),
    searchUrl: def.searchUrl,
    publicAccess: def.publicAccess,
    domain: def.domain || '',
    accessStatus: def.accessStatus,
    implStatus: def.implStatus,
    free: socCopyList(def.free || []),
    needsAuth: socCopyList(def.needsAuth || []),
    needsApi: socCopyList(def.needsApi || []),
    unsupported: socCopyList(def.unsupported || []),
    fallback: def.fallback || '',
    reason: def.reason || '',
    verifiedLive: def.verifiedLive === true,
    notes: def.notes || ''
  };
}

function socPublicDef(stored) {
  var out = socStoreDef(stored);
  return out;
}

/* Validate a platform def. Returns an error string or null. */
function socValidateDef(def) {
  if (!socIsPlainObject(def)) return 'def-must-be-an-object';
  if (!socValidId(def.id)) return 'invalid-id';
  if (typeof def.name !== 'string' || socTrim(def.name) === '') {
    return 'invalid-name';
  }
  if (!socValidKinds(def.kinds)) return 'invalid-kinds';
  if (typeof def.searchUrl !== 'function') return 'invalid-searchUrl';
  if (PUBLIC_ACCESS.indexOf(def.publicAccess) === -1) {
    return 'invalid-publicAccess';
  }
  if (ACCESS_STATUSES.indexOf(def.accessStatus) === -1) {
    return 'invalid-accessStatus';
  }
  if (IMPL_STATUSES.indexOf(def.implStatus) === -1) {
    return 'invalid-implStatus';
  }
  if (typeof def.domain !== 'string' || socTrim(def.domain) === '') {
    return 'invalid-domain';
  }
  return null;
}

/* ---------- PUBLIC: registerPlatform / unregisterPlatform ---------- */
/* Adding a new platform is one call: no engine change is needed.
   A duplicate id is refused (unregister first, then re-register),
   and an invalid def is refused — never half-registered. */
function registerPlatform(def) {
  var err = socValidateDef(def);
  if (err) return { ok: false, error: err };
  if (socHas(registry, def.id)) {
    return { ok: false, error: 'duplicate-id' };
  }
  registry[def.id] = socStoreDef(def);
  return { ok: true, id: def.id };
}

function unregisterPlatform(id) {
  if (!socHas(registry, id)) return false;
  delete registry[id];
  return true;
}

function getPlatform(id) {
  if (!socHas(registry, id)) return null;
  return socPublicDef(registry[id]);
}

function listPlatforms() {
  var ids = [];
  var k;
  for (k in registry) if (socHas(registry, k)) ids.push(k);
  ids.sort();
  var out = [];
  var i;
  for (i = 0; i < ids.length; i++) out.push(socPublicDef(registry[ids[i]]));
  return out;
}

/* ---------- built-in platforms ---------- */
/* Honest access model, per platform (see 22-social.EVIDENCE.md for
   the reason and the verification basis of each line):
   - works-free: a real public mechanism exists with no key/login.
   - needs-auth: search / browsing needs a logged-in account.
   - needs-api: only a keyed official API offers the function.
   - unsupported: the platform offers no public search for it at all.
   No platform lists private accounts, messages or restricted
   content as searchable — those are always under 'unsupported'. */
function socBuiltin(name, kinds, publicAccess, domain, accessStatus,
    implStatus, free, needsAuth, needsApi, unsupported, fallback,
    reason, verifiedLive, notes, searchUrl) {
  return {
    id: name,
    name: name,
    kinds: kinds,
    searchUrl: searchUrl,
    publicAccess: publicAccess,
    domain: domain,
    accessStatus: accessStatus,
    implStatus: implStatus,
    free: free,
    needsAuth: needsAuth,
    needsApi: needsApi,
    unsupported: unsupported,
    fallback: fallback,
    reason: reason,
    verifiedLive: verifiedLive,
    notes: notes
  };
}

function socRegisterBuiltins() {
  var defs = [
    socBuiltin('youtube',
      ['videos', 'posts', 'profiles', 'trending'], 'rss',
      'youtube.com', 'works-free', 'partially-implemented',
      ['public channel RSS feeds (feeds/videos.xml, no key)',
       'public video pages found through the web-search proxy',
       'public oEmbed metadata for a known video URL'],
      [],
      ['keyword search via the Data API (needs a key — never used)'],
      ['private videos', 'age-restricted content without sign-in',
       'direct messages'],
      'site:youtube.com web search via /api/search; channel RSS feed ' +
      'when a channel is named',
      'Public channel RSS is a documented keyless feed; public video ' +
      'pages are indexed by search engines. Native keyword search ' +
      'needs a key, so the engine never calls it.',
      false,
      'Channel RSS and indexed public pages only; no key, no login.',
      function (q) {
        return 'https://www.youtube.com/results?search_query=' +
          socEncode(q);
      }),
    /* P6 (v68): the 'reddit' builtin registration is DELETED — it pointed
       the engine at public Reddit JSON (reddit.com/search.json and .json
       fetches). Public Reddit reading, if any, goes through P4's
       social-feed (public RSS/Atom documents) only. A 'reddit' question
       now plans as unknown-platform with the web-search fallback. */
    socBuiltin('telegram',
      ['posts', 'profiles'], 'public-page',
      't.me', 'works-free', 'partially-implemented',
      ['public channel previews at t.me/s/<channel> (no login)',
       'public channel post pages found through the web-search proxy'],
      [],
      ['global keyword search across channels (needs MTProto/Bot API)'],
      ['private channels and groups', 'private messages'],
      'site:t.me web search via /api/search; t.me/s/ preview fetch ' +
      'via /api/fetch when a channel is named',
      'Public channels expose a web preview at t.me/s/ with no login; ' +
      'there is no public global search, so keyword search across ' +
      'channels needs an API.',
      false,
      'Only named public channels can be read directly; keyword ' +
      'search falls back to the web-search index.',
      function (q) {
        return 'https://t.me/s/' + socEncode(q);
      }),
    socBuiltin('tiktok',
      ['videos', 'posts', 'profiles', 'hashtags', 'trending'],
      'public-page', 'tiktok.com', 'works-free', 'partially-implemented',
      ['public video pages found through the web-search proxy'],
      ['keyword search on the site (needs a logged-in account)'],
      ['Research API (needs approval and a key — never used)'],
      ['private accounts', 'direct messages'],
      'site:tiktok.com web search via /api/search (indexed public ' +
      'videos only)',
      'Public video pages are indexed by search engines, so the ' +
      'web-search fallback finds them; the site itself gates search ' +
      'behind login and the official API needs a key.',
      false,
      'Fallback only: the engine never opens tiktok.com search ' +
      'directly.',
      function (q) {
        return 'https://www.tiktok.com/search?q=' + socEncode(q);
      }),
    socBuiltin('pinterest',
      ['posts', 'profiles', 'hashtags', 'trending'], 'public-page',
      'pinterest.com', 'works-free', 'partially-implemented',
      ['public pins and boards found through the web-search proxy'],
      ['saved-search feeds and logged-in browsing'],
      ['API v5 (needs a key — never used)'],
      ['private boards', 'direct messages'],
      'site:pinterest.com web search via /api/search (indexed public ' +
      'pins only)',
      'Public pins and boards are indexed by search engines; on-site ' +
      'search and feeds need a login and the API needs a key.',
      false,
      'Fallback only: the engine never opens pinterest.com search ' +
      'directly.',
      function (q) {
        return 'https://www.pinterest.com/search/pins/?q=' + socEncode(q);
      }),
    socBuiltin('threads',
      ['posts', 'profiles', 'hashtags', 'trending'], 'public-page',
      'threads.net', 'works-free', 'partially-implemented',
      ['public posts found through the web-search proxy'],
      ['keyword search on the site (needs a logged-in account)'],
      ['Threads API (needs a key — never used)'],
      ['private accounts', 'direct messages'],
      'site:threads.net web search via /api/search (indexed public ' +
      'posts only)',
      'Public posts are indexed by search engines; on-site search ' +
      'needs a login and the API needs a key.',
      false,
      'Fallback only: the engine never opens threads.net search ' +
      'directly.',
      function (q) {
        return 'https://www.threads.net/search?q=' + socEncode(q);
      }),
    socBuiltin('x',
      ['posts', 'profiles', 'hashtags', 'trending'], 'requires-auth',
      'x.com', 'needs-auth', 'waiting-authentication',
      ['a direct link to a single public post sometimes opens',
       'public posts found through the web-search proxy'],
      ['search, Explore and hashtag pages (redirect to login)',
       'browsing profiles, replies and follower lists reliably'],
      ['official API (needs a key — never used)'],
      ['protected (private) accounts', 'direct messages'],
      'site:x.com web search via /api/search (indexed public posts ' +
      'only, often days behind; NOT a live search)',
      'X redirects search, Explore and hashtag pages to the login ' +
      'screen (tested 8 Nov 2026 by an independent guide); Nitter ' +
      'mirrors are dead after legal takedowns in Aug 2026. Only ' +
      'direct links and the search-engine index still work logged out.',
      false,
      'The engine never claims live X search: it reports the login ' +
      'wall plainly and uses the indexed fallback only.',
      function (q) {
        return 'https://x.com/search?q=' + socEncode(q);
      }),
    socBuiltin('instagram',
      ['posts', 'videos', 'profiles', 'hashtags', 'trending'],
      'requires-auth', 'instagram.com', 'needs-auth',
      'waiting-authentication',
      ['a direct link to a single public post or profile sometimes ' +
       'opens on desktop after dismissing the login prompt'],
      ['search', 'browsing profiles and feeds at any volume',
       'viewing stories'],
      ['Graph API (needs a key — never used)'],
      ['private accounts', 'stories without login',
       'direct messages'],
      'site:instagram.com web search via /api/search (indexed public ' +
      'pages only; NOT a live search)',
      'Instagram requires an account for search and throttles ' +
      'logged-out browsing with repeated login prompts and error ' +
      'pages after a few profiles; only direct links sometimes open.',
      false,
      'The engine never claims live Instagram search: it reports the ' +
      'login wall plainly and uses the indexed fallback only.',
      function (q) {
        return 'https://www.instagram.com/explore/search/keyword/?q=' +
          socEncode(q);
      }),
    socBuiltin('facebook',
      ['posts', 'videos', 'profiles', 'trending'], 'requires-auth',
      'facebook.com', 'needs-auth', 'waiting-authentication',
      ['public page names found through the web-search proxy'],
      ['search', 'viewing posts and profiles'],
      ['Graph API (needs a key — never used)'],
      ['private profiles and groups', 'direct messages'],
      'site:facebook.com web search via /api/search (indexed public ' +
      'pages only; NOT a live search)',
      'Facebook requires an account for search and for viewing most ' +
      'posts; only indexed public page names surface without login.',
      false,
      'The engine never claims live Facebook search: it reports the ' +
      'login wall plainly and uses the indexed fallback only.',
      function (q) {
        return 'https://www.facebook.com/search/top/?q=' + socEncode(q);
      }),
    socBuiltin('linkedin',
      ['posts', 'videos', 'profiles', 'trending'], 'requires-auth',
      'linkedin.com', 'needs-auth', 'waiting-authentication',
      ['public profile pages found through the web-search proxy'],
      ['search', 'viewing posts and articles'],
      ['official API (needs a key — never used)'],
      ['private profiles', 'direct messages'],
      'site:linkedin.com web search via /api/search (indexed public ' +
      'profiles only; NOT a live search)',
      'LinkedIn requires an account for search and for viewing posts ' +
      'and articles; only indexed public profiles surface without ' +
      'login.',
      false,
      'The engine never claims live LinkedIn search: it reports the ' +
      'login wall plainly and uses the indexed fallback only.',
      function (q) {
        return 'https://www.linkedin.com/search/results/all/?keywords=' +
          socEncode(q);
      }),
    socBuiltin('snapchat',
      ['posts', 'videos'], 'unsupported',
      'snapchat.com', 'unsupported', 'unsupported-by-platform',
      [],
      ['viewing a public profile page (limited, no search)'],
      ['any keyword search (no public search exists)'],
      ['private snaps and stories', 'direct messages',
       'ephemeral content (gone by design)'],
      'none for search — the engine reports this plainly and only ' +
      'suggests a general web search for public Spotlight mentions, ' +
      'labelled unverified',
      'Snapchat content is ephemeral and private by design; the ' +
      'platform offers no public keyword search at all, with or ' +
      'without login.',
      false,
      'Snapchat is never searched by this engine; it is listed so ' +
      'the gap is visible instead of silently missing.',
      function (q) {
        return 'https://www.snapchat.com/search?q=' + socEncode(q);
      })
  ];
  var i;
  for (i = 0; i < defs.length; i++) {
    var r = registerPlatform(defs[i]);
    if (!r.ok) throw new Error('builtin registration failed: ' +
      defs[i].id + ' (' + r.error + ')');
  }
}
socRegisterBuiltins();

/* ---------- PUBLIC: capabilityMatrix / platformStatus ---------- */
/* The honest capability matrix: per platform, what works free vs
   what needs auth / API / is unsupported. A fresh copy each call. */
function capabilityMatrix() {
  var list = listPlatforms();
  var out = [];
  var i;
  for (i = 0; i < list.length; i++) {
    var p = list[i];
    out.push({
      id: p.id,
      name: p.name,
      kinds: socCopyList(p.kinds),
      domain: p.domain,
      publicAccess: p.publicAccess,
      accessStatus: p.accessStatus,
      free: socCopyList(p.free),
      needsAuth: socCopyList(p.needsAuth),
      needsApi: socCopyList(p.needsApi),
      unsupported: socCopyList(p.unsupported),
      fallback: p.fallback,
      notes: p.notes
    });
  }
  return out;
}

/* Implementation status per platform. No platform is claimed
   'fully-implemented-tested' here: no live end-to-end run against
   the real platforms was made in this build session, so every
   status is honest about that. verifiedLive is false throughout
   until a live check actually runs. */
function platformStatus() {
  var list = listPlatforms();
  var out = [];
  var i;
  for (i = 0; i < list.length; i++) {
    var p = list[i];
    out.push({
      id: p.id,
      name: p.name,
      accessStatus: p.accessStatus,
      implStatus: p.implStatus,
      reason: p.reason,
      fallback: p.fallback,
      verifiedLive: p.verifiedLive === true
    });
  }
  return out;
}

/* ---------- PUBLIC: normaliseResult ---------- */
/* Shapes one raw proxy item into the result contract. account is
   null unless the source actually named an author/outlet; dates
   and engagement are null unless the source actually returned
   them — never invented. verified starts 'unverified': a
   web-search index result is not the platform speaking. */
function normaliseResult(platformId, raw) {
  if (!socIsPlainObject(raw)) return null;
  var url = socTrim(raw.url || raw.link || '');
  if (!/^https?:\/\//i.test(url)) return null;
  var title = socTrim(raw.title || '');
  if (title === '') title = socDomainOf(url) || 'Untitled result';
  var desc = socTrim(raw.snippet || raw.description || raw.extract ||
    '');
  var publishedAt = socParseDate(
    socHas(raw, 'pubDate') ? raw.pubDate :
    socHas(raw, 'publishedAt') ? raw.publishedAt :
    socHas(raw, 'published') ? raw.published :
    socHas(raw, 'date') ? raw.date : null);
  var eng = socParseEngagement(raw);
  var account = null;
  var author = socTrim(raw.author || raw.account || '');
  if (author !== '') account = author;
  else if (socTrim(raw.outlet || '') !== '') account = socTrim(raw.outlet);
  var verified = 'unverified';
  if (raw.verified && VERIFIED_VALUES.indexOf(raw.verified) !== -1) {
    verified = raw.verified;
  }
  var context = socTrim(raw.context || '');
  if (context === '') {
    context = 'Found through the web-search proxy (site:' +
      socDomainOf(url) + '); not fetched from the platform itself, ' +
      'so the platform has not confirmed this item.';
    if (publishedAt === null) {
      context += ' No publication date was returned.';
    }
    if (eng.value === null) {
      context += ' No engagement counts were returned.';
    }
  }
  return {
    platform: platformId,
    account: account,
    title: title,
    description: desc,
    publishedAt: publishedAt,
    url: url,
    engagement: eng.value,
    engagementNote: eng.note,
    verified: verified,
    context: context
  };
}

/* ---------- PUBLIC: dedupeResults / rankResults ---------- */
function dedupeResults(results) {
  var seen = {};
  var out = [];
  var i;
  for (i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r || !r.url) continue;
    var key = socNormaliseUrl(r.url);
    if (!socHas(seen, key)) {
      seen[key] = out.length;
      out.push(r);
      continue;
    }
    /* Duplicate: keep the most informative copy — one the platform
       itself confirmed beats an unverified one, and a dated copy
       beats an undated one (a date is evidence, not decoration).
       Otherwise keep the first. */
    var existing = out[seen[key]];
    var existingRich = (existing.verified === 'platform-reported' ? 2 : 0) +
      (existing.publishedAt ? 1 : 0);
    var newRich = (r.verified === 'platform-reported' ? 2 : 0) +
      (r.publishedAt ? 1 : 0);
    if (newRich > existingRich) {
      out[seen[key]] = r;
    }
  }
  return out;
}

/* Relevance ranking: query-term hits in the title count most, then
   hits in the description, then platform confirmation, then newest
   first (dated results only — undated results are never dropped
   for missing a date, they simply sort after dated ones on a tie).
   Stable: equal scores keep plan order. */
function socRelevanceScore(result, terms) {
  var score = 0;
  var title = String(result.title || '').toLowerCase();
  var desc = String(result.description || '').toLowerCase();
  var i;
  for (i = 0; i < terms.length; i++) {
    if (terms[i] === '') continue;
    if (title.indexOf(terms[i]) !== -1) score += 3;
    if (desc.indexOf(terms[i]) !== -1) score += 1;
  }
  if (result.verified === 'platform-reported') score += 2;
  else if (result.verified === 'independently-verified') score += 1;
  return score;
}

function rankResults(results, query) {
  var terms = socTrim(query).toLowerCase().split(/\s+/);
  var scored = [];
  var i;
  for (i = 0; i < results.length; i++) {
    scored.push({
      result: results[i],
      score: socRelevanceScore(results[i], terms),
      index: i
    });
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var ad = a.result.publishedAt ? Date.parse(a.result.publishedAt) : NaN;
    var bd = b.result.publishedAt ? Date.parse(b.result.publishedAt) : NaN;
    var aHas = !isNaN(ad), bHas = !isNaN(bd);
    if (aHas && bHas && bd !== ad) return bd - ad;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return a.index - b.index;
  });
  var out = [];
  for (i = 0; i < scored.length; i++) out.push(scored[i].result);
  return out;
}

/* ---------- PUBLIC: planSearch ---------- */
/* Pure planning: no network. Returns {query, kinds, included,
   skipped, since, until, errors}. Included = accessible platforms
   whose kinds intersect the requested kinds, ordered by kind
   overlap (best match first) then by id. Every skipped platform
   carries the plain reason and its fallback. Query hints: a '#'
   tag prioritises hashtags; video words prioritise videos. */
function planSearch(opts) {
  var o = socIsPlainObject(opts) ? opts : {};
  var query = socTrim(o.query || '');
  var plan = {
    query: query,
    kinds: null,
    included: [],
    skipped: [],
    since: null,
    until: null,
    errors: []
  };
  if (query === '') {
    plan.errors.push('empty-query');
    return plan;
  }
  var kinds;
  if (Array.isArray(o.kinds) && o.kinds.length > 0) {
    kinds = [];
    var i;
    for (i = 0; i < o.kinds.length; i++) {
      if (KINDS.indexOf(o.kinds[i]) !== -1 &&
          kinds.indexOf(o.kinds[i]) === -1) kinds.push(o.kinds[i]);
    }
    if (kinds.length === 0) kinds = socCopyList(KINDS);
  } else {
    kinds = socCopyList(KINDS);
  }
  plan.kinds = kinds;
  var since = socParseDate(o.since);
  var until = socParseDate(o.until);
  plan.since = since;
  plan.until = until;
  var requested;
  if (Array.isArray(o.platforms) && o.platforms.length > 0) {
    requested = [];
    for (i = 0; i < o.platforms.length; i++) {
      var pid = String(o.platforms[i]);
      if (requested.indexOf(pid) === -1) requested.push(pid);
    }
  } else {
    requested = [];
    var all = listPlatforms();
    for (i = 0; i < all.length; i++) requested.push(all[i].id);
  }
  var hashtagQuery = query.indexOf('#') !== -1;
  var videoQuery = /\b(video|videos|watch|clip|clips|reel|reels)\b/i
    .test(query);
  var scored = [];
  for (i = 0; i < requested.length; i++) {
    var id = requested[i];
    var p = getPlatform(id);
    if (!p) {
      plan.skipped.push({ id: id, reason: 'unknown-platform',
        fallback: 'No such platform is registered.' });
      continue;
    }
    var overlap = 0;
    var j;
    for (j = 0; j < p.kinds.length; j++) {
      if (kinds.indexOf(p.kinds[j]) !== -1) overlap++;
    }
    if (overlap === 0) {
      plan.skipped.push({ id: id, reason: 'kind-mismatch',
        fallback: 'This platform offers none of the requested kinds (' +
          kinds.join(', ') + ').' });
      continue;
    }
    if (p.accessStatus !== 'works-free') {
      var reason = p.accessStatus === 'needs-auth'
        ? 'needs-authentication'
        : p.accessStatus === 'needs-api' ? 'needs-api-access'
        : 'unsupported-by-platform';
      plan.skipped.push({ id: id, reason: reason,
        fallback: p.fallback,
        detail: p.accessStatus === 'needs-auth'
          ? 'Search on this platform needs a logged-in account; ' +
            'the engine never logs in.'
          : p.accessStatus === 'needs-api'
          ? 'This function needs a keyed official API; the engine ' +
            'never uses keys.'
          : 'The platform offers no public search for this.' });
      continue;
    }
    var boost = 0;
    if (hashtagQuery && p.kinds.indexOf('hashtags') !== -1) boost += 2;
    if (videoQuery && p.kinds.indexOf('videos') !== -1) boost += 2;
    scored.push({ id: id, overlap: overlap, boost: boost });
  }
  scored.sort(function (a, b) {
    var sa = a.overlap + a.boost, sb = b.overlap + b.boost;
    if (sb !== sa) return sb - sa;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });
  for (i = 0; i < scored.length; i++) plan.included.push(scored[i].id);
  return plan;
}

/* ---------- fetcher ---------- */
/* Default fetcher: same-origin proxy, exactly as the live export
   uses it — fetchJSONT('/api/search?q=...') and
   fetchJSONT('/api/fetch?url=...'). Injected in tests so no
   network is needed there. */
function socDefaultFetcher(url) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('no-fetcher-available'));
  }
  return fetch(url).then(function (resp) {
    if (!resp.ok) throw new Error('proxy-http-' + resp.status);
    return resp.json();
  });
}

function socResolveFetcher(opts) {
  if (socIsPlainObject(opts) && typeof opts.fetcher === 'function') {
    return opts.fetcher;
  }
  return socDefaultFetcher;
}

/* One platform's search through the proxy: a site: query, so the
   results genuinely come from that platform's indexed public
   pages. The proxy caps fetch at 1.5 MB / 6000 chars, and its
   /api/search returns at most 10 results — the engine takes what
   it is given and never pads the list. */
function socSearchOnePlatform(platformId, query, fetcher) {
  var p = getPlatform(platformId);
  if (!p) return Promise.resolve([]);
  /* FIX 2 (v63): drop the named platform place word from the query;
     the site: filter already scopes the search to the platform. */
  var cleanQ = query;
  try{ cleanQ = stripPlaceWordFromQuery(query, detectSource(query).source); }catch(e){}
  if (!cleanQ) cleanQ = query;
  var siteQuery = 'site:' + p.domain + ' ' + cleanQ;
  var url = window.EnzoPagesBackend.getSearchUrl('/api/search?q=' + socEncode(siteQuery));
  return fetcher(url).then(function (payload) {
    var arr = [];
    if (Array.isArray(payload)) arr = payload;
    else if (socIsPlainObject(payload)) {
      arr = payload.results || payload.items || [];
    }
    if (!Array.isArray(arr)) return [];
    var out = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      var r = normaliseResult(platformId, arr[i]);
      if (r) out.push(r);
    }
    return out;
  });
}

/* ---------- PUBLIC: verifyResult ---------- */
/* Fetch the result URL through /api/fetch and upgrade verified to
   'platform-reported' only when the fetched page text actually
   contains the result title. A failed fetch or a missing title
   leaves the result exactly as it was — verification never
   invents confirmation. Returns a Promise of a result copy. */
function verifyResult(result, fetcher) {
  var fetchFn = (typeof fetcher === 'function')
    ? fetcher : socDefaultFetcher;
  if (!socIsPlainObject(result) || !result.url) {
    return Promise.reject(new Error('invalid-result'));
  }
  var copy = {};
  var k;
  for (k in result) if (socHas(result, k)) copy[k] = result[k];
  var url = window.EnzoPagesBackend.getSearchUrl('/api/fetch?url=' + socEncode(result.url));
  return fetchFn(url).then(function (payload) {
    var text = '';
    if (socIsPlainObject(payload)) {
      text = String(payload.text || payload.content || '');
    }
    var title = String(copy.title || '');
    if (title !== '' && text !== '' &&
        text.toLowerCase().indexOf(title.toLowerCase()) !== -1) {
      copy.verified = 'platform-reported';
      copy.context = 'Fetched the result page through /api/fetch and ' +
        'the page text contains the result title.';
    }
    return copy;
  }).catch(function () {
    return copy;
  });
}

/* ---------- PUBLIC: searchSocial ---------- */
/* Runs the plan across ALL relevant accessible platforms, not just
   the first: every included platform is queried, failures are
   recorded per platform (never fatal to the whole search), results
   are merged, deduped by URL and ranked. Undated results are kept
   (a missing date is not a reason to drop a real result); the
   since/until window only drops results whose real date falls
   outside it. Returns a Promise. */
function searchSocial(opts, fetcherArg) {
  var o = socIsPlainObject(opts) ? opts : {};
  var fetcher = (typeof fetcherArg === 'function')
    ? fetcherArg : socResolveFetcher(o);
  var plan = planSearch(o);
  var outcome = {
    query: plan.query,
    planned: plan,
    searchedPlatforms: [],
    results: [],
    skipped: plan.skipped,
    errors: []
  };
  if (plan.errors.length > 0) {
    outcome.errors = socCopyList(plan.errors);
    return Promise.resolve(outcome);
  }
  var jobs = [];
  var i;
  for (i = 0; i < plan.included.length; i++) {
    (function (platformId) {
      jobs.push(socSearchOnePlatform(platformId, plan.query, fetcher)
        .then(function (items) {
          return { platform: platformId, items: items, error: null };
        })
        .catch(function (e) {
          return { platform: platformId, items: [],
            error: (e && e.message) ? String(e.message) : String(e) };
        }));
    })(plan.included[i]);
  }
  return Promise.all(jobs).then(function (settled) {
    var merged = [];
    var j;
    for (j = 0; j < settled.length; j++) {
      var s = settled[j];
      outcome.searchedPlatforms.push(s.platform);
      if (s.error) {
        outcome.errors.push({ platform: s.platform, error: s.error });
        continue;
      }
      for (i = 0; i < s.items.length; i++) merged.push(s.items[i]);
    }
    /* Date-window filter: only results with a real date can be
       outside it; undated results are kept. */
    var sinceMs = plan.since ? Date.parse(plan.since) : NaN;
    var untilMs = plan.until ? Date.parse(plan.until) : NaN;
    var filtered = [];
    for (i = 0; i < merged.length; i++) {
      var r = merged[i];
      if (r.publishedAt) {
        var t = Date.parse(r.publishedAt);
        if (!isNaN(sinceMs) && t < sinceMs) continue;
        if (!isNaN(untilMs) && t > untilMs) continue;
      }
      filtered.push(r);
    }
    var deduped = dedupeResults(filtered);
    var ranked = rankResults(deduped, plan.query);
    if (o.verify === true) {
      var verifyJobs = [];
      for (i = 0; i < ranked.length; i++) {
        verifyJobs.push(verifyResult(ranked[i], fetcher));
      }
      return Promise.all(verifyJobs).then(function (verified) {
        outcome.results = rankResults(verified, plan.query);
        return outcome;
      });
    }
    outcome.results = ranked;
    return outcome;
  });
}

/* ---------- export tail (guarded) ---------- */
var EnzoSocial = {
  VERSION: VERSION,
  KINDS: KINDS,
  ACCESS_STATUSES: ACCESS_STATUSES,
  IMPL_STATUSES: IMPL_STATUSES,
  PUBLIC_ACCESS: PUBLIC_ACCESS,
  registerPlatform: registerPlatform,
  unregisterPlatform: unregisterPlatform,
  getPlatform: getPlatform,
  listPlatforms: listPlatforms,
  capabilityMatrix: capabilityMatrix,
  platformStatus: platformStatus,
  planSearch: planSearch,
  searchSocial: searchSocial,
  verifyResult: verifyResult,
  normaliseResult: normaliseResult,
  dedupeResults: dedupeResults,
  rankResults: rankResults
};

if (typeof root !== 'undefined') root.EnzoSocial = EnzoSocial;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnzoSocial;
}

})(typeof window !== 'undefined' ? window : this);
