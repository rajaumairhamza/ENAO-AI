/* ==========================================================================
 * PIECE 42 — Directed learning flow (internet + YouTube, real sources only)
 * ENAO AI learning track (artifact slug: enao-ai, live build
 * v61-deep-triggers-4lang). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
 * Piece build only.
 *
 * PURPOSE
 * -------
 * A "learn this" order is different from a research order: the user is
 * not asking for an answer, they are asking ENZO to LEARN something
 * from a named place (the internet, YouTube, a specific video) and to
 * remember what it learned. This piece detects that order, runs the
 * learning through injected deps, and saves each learned point to the
 * learned store (piece 41 spec) with its real source attached.
 *
 * WHAT IT REUSES (never reimplements)
 * -----------------------------------
 * - Piece 31 triggers (31-triggers.js): the four-language research
 *   trigger sets. This piece does NOT reuse them directly — a directed
 *   learning order needs a LEARN verb plus a named source, which is a
 *   narrower signal than a research order — but it follows the same
 *   four-language pattern (EN / Urdu script / Roman Urdu / Punjabi
 *   Shahmukhi) and the same language labels ('en' | 'urdu' | 'roman'
 *   | 'punjabi').
 * - Piece 25 orchestrator (25-orchestrator.js): the central research
 *   runner. In the app, deps.search is the orchestrator/backend
 *   research path; this piece never fetches the internet itself.
 * - Piece 41 store (41-teaching.js, spec): store.addItem({ kind, text,
 *   detail, lang, source, ts, topic }). Piece 41 did not exist when
 *   this piece was built; the code resolves the store from deps.store
 *   first, then window.EnzoLearningTeaching when present, and saves
 *   nothing (honestly, savedIds []) when neither is available.
 *
 * RULES (locked by this piece)
 * -----------------------------
 * - A directed-learning order needs BOTH a learn verb AND a named
 *   source (internet / YouTube / a video). "research karo" without a
 *   learn verb is NOT directed learning; "learn about X" with no
 *   source named is NOT directed learning; a plain question is not.
 * - Only REAL returned results become learned points. 0 results ->
 *   status 'partial' with an honest message, never invented points.
 * - YouTube has NO free transcript API. A video's learnable content
 *   is its real title, description, channel and publish date, fetched
 *   through deps.resolveVideo (oEmbed / page fetch in the app). If the
 *   dep returns metadata only (no description / transcript text),
 *   points = [] and status = 'metadata-only' with an honest message.
 *   NEVER invent what a video says.
 * - No fabricated sources or counts: every learned point cites the
 *   real source object it came from; summaries state real numbers
 *   only and name what could NOT be learned.
 *
 * PUBLIC API (on EnzoDirectedLearning)
 * -------------------------------------
 * detectDirectedLearning(text)
 *   -> { isDirected:true, source:'internet'|'youtube'|'video',
 *        topic:string|null, videoUrl:string|null, lang:string }
 *      or null when the text is not a directed-learning order.
 * learnFromInternet(topic, deps)
 *   -> Promise resolving to { learned:[{ point, source:{ title, url,
 *      date } }], sourcesVerified:number, status:'ok'|'partial'|
 *      'failed', message:string, topic:string }.
 *      deps.search(topic) -> array of results, or { results:[...] },
 *      or a Promise of either. Each result needs a real url; results
 *      without one are dropped, never cited.
 * learnFromYouTube(videoUrlOrQuery, deps)
 *   -> Promise resolving to { video:{ title, channel, url, published
 *      }|null, points:[{ point, source:{ title, url, date } }],
 *      status:'ok'|'metadata-only'|'failed', message:string }.
 *      deps.resolveVideo(input) -> { title, channel, url, published,
 *      description?, transcript? } or null, or a Promise of either.
 *      Points come ONLY from real description / transcript text the
 *      dep returned; metadata-only input yields points [].
 * summariseLearning(result, lang)
 *   -> string. Short summary in the user's language: what was learned
 *      (bullets, each with its real source), what could NOT be learned
 *      or accessed, and what ENZO will now do differently. Honest
 *      about gaps; no invented counts.
 * applyDirectedLearning(text, deps)
 *   -> Promise resolving to { directed:boolean, detected:object|null,
 *      result:object|null, summary:string|null, savedIds:array }.
 *      detect -> run the right learner -> save each learned point as
 *      a store item with its source attached -> return everything.
 * extractVideoUrl(text) -> string|null (first YouTube URL in text).
 * P7 KEYWORD-FIRST EXTENSION (v68, pieces/07-keyword-learning):
 *   For source 'internet', applyDirectedLearning now tries the keyword
 *   job first (EnzoKeywordLearning.startKeywordLearn — 100 keywords,
 *   every site read, honest four-count report). When the keyword API is
 *   unavailable it falls back to the old learnFromInternet path, so a
 *   plain learn order still works the old way. Nothing else changes.
 * VERSION: '42-directed-1.0.0-p7'
 *
 * DEP CONTRACT (for the app wiring — see 42-directed.EVIDENCE.md)
 * -----------------------------------------------------------------
 * deps.search(topic): the app's real research path (piece 25
 *   orchestrator / backend /api/v2). Returns results with real
 *   { title, url, date?, snippet?|text? }.
 * deps.resolveVideo(input): oEmbed / page fetch through the app's
 *   proxy (/api/fetch). Returns real video metadata and, when the
 *   page actually carries it, description / transcript text.
 * deps.store (optional): an object with addItem(item). Falls back to
 *   window.EnzoLearningTeaching when it exposes addItem. When neither
 *   exists, nothing is saved and savedIds is [].
 * ========================================================================== */
(function (global) {
'use strict';

var VERSION = '42-directed-1.0.0-p7';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function asString(v) { return (v === null || v === undefined) ? '' : String(v); }
function trim(s) { return asString(s).replace(/^\s+|\s+$/g, ''); }
function hasUrduScript(text) { return /[\u0600-\u06FF]/.test(asString(text)); }

function toPromise(value) {
  try {
    if (value && typeof value.then === 'function') return value;
  } catch (e) { /* treat as plain value */ }
  return Promise.resolve(value);
}

function getGlobal(name) {
  try {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof window !== 'undefined' && window[name]) return window[name];
  } catch (e) { /* lookup is best-effort */ }
  return null;
}

/* ------------------------------------------------------------------ */
/* Language detection (same four labels as piece 31)                   */
/* ------------------------------------------------------------------ */

var PUNJABI_MARKERS = /توں|ایہ|ویکھ|سکھو|سکھ\s*لو|دے\s|نیں|کیویں|چکو|چھڈو|وچ|نال/;
var ROMAN_MARKER_RE = /\b(seekh\w*|sikh\w*|seekho|sikho|batao|karo|kar|ye|yeh|kaise|kya|mujhe|meri|bhi|aur|par|se|lo|dekh|bare|mein|ke|ka|ki|ko)\b/i;

function detectDirectedLanguage(text) {
  var raw = asString(text);
  if (hasUrduScript(raw)) {
    if (PUNJABI_MARKERS.test(raw)) return 'punjabi';
    return 'urdu';
  }
  if (ROMAN_MARKER_RE.test(raw)) return 'roman';
  return 'en';
}

/* ------------------------------------------------------------------ */
/* Video URL extraction                                                */
/* ------------------------------------------------------------------ */

var VIDEO_URL_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^ \s'"]*|shorts\/[^ \s'"/]+|embed\/[^ \s'"/]+|live\/[^ \s'"/]+)|youtu\.be\/[^ \s'"/]+)/i;

function extractVideoUrl(text) {
  var m = VIDEO_URL_RE.exec(asString(text));
  return m ? m[0] : null;
}

/* ------------------------------------------------------------------ */
/* Trigger detection                                                   */
/* ------------------------------------------------------------------ */

/* Learn verbs, per language. Imperative forms only: past-tense forms
   ("learned", "seekha") and "what did you learn" questions are NOT
   orders and are excluded by the guards below. */
function hasLearnVerb(text, lang) {
  var raw = asString(text);
  if (/\blearn\b/i.test(raw)) return true;
  if (/\bwatch\b/i.test(raw) && /\blearn\b/i.test(raw)) return true;
  if (/سیکھ/.test(raw)) return true;   /* Urdu script: سیکھو، سیکھ لو، سیکھ کر */
  if (/سکھ/.test(raw)) return true;    /* Punjabi Shahmukhi: سکھو، سکھ لو */
  if (/\b(seekh\w*|sikh\w*|seekho|sikho)\b/i.test(raw)) return true;
  return false;
}

/* Guards: questions ABOUT learning, and past-tense learning, are not
   orders. "tum ne is video se kya seekha" / "what did you learn from
   this video" ask about the past; they do not order new learning. */
function isAboutPastLearning(text) {
  var raw = asString(text);
  var low = raw.toLowerCase();
  if (/\bwhat\s+did\s+you\s+learn\b/.test(low)) return true;
  if (/\bwhat\s+have\s+you\s+(learnt|learned)\b/.test(low)) return true;
  if (/\b(kya|kia)\s+seekha\b/.test(low)) return true;
  if (/\bseekha\s+(hai|tha|thi)\b/.test(low)) return true;
  if (/کیا\s*سیکھا/.test(raw)) return true;
  if (/کیا\s*سکھیا/.test(raw)) return true;
  return false;
}

/* Source presence. A source counts only when named as the place to
   learn FROM (se / par / from / توں beside it, or a video URL). */
function detectDirectedSource(text) {
  var raw = asString(text);
  var videoUrl = extractVideoUrl(raw);
  if (videoUrl) return { source: 'video', videoUrl: videoUrl };
  if (/\bthis\s+video\b/i.test(raw) || /\bthat\s+video\b/i.test(raw) ||
      /\bis\s+video\b/i.test(raw) || /اس\s*ویڈیو/.test(raw) ||
      /\bvideo\b/i.test(raw) || /ویڈیو/.test(raw)) {
    return { source: 'video', videoUrl: null };
  }
  if (/\byoutube\b/i.test(raw) || /یوٹیوب/.test(raw)) {
    return { source: 'youtube', videoUrl: null };
  }
  if (/\binternet\b/i.test(raw) || /انٹرنیٹ/.test(raw)) {
    return { source: 'internet', videoUrl: null };
  }
  return { source: null, videoUrl: null };
}

/* Topic extraction: strip the trigger words (learn verb, source words,
   demonstratives, particles, "please", "about") and keep what is left.
   The trigger words are never the topic. When nothing is left, the
   topic is null and the learning flow asks for it. */
var TOPIC_STRIP_EN = /\b(learn|watch|from|the|internet|youtube|yt|video|videos|this|that|it|about|please|and|on|via|through|is|a|an|of|to|kar|karo|seekh\w*|sikh\w*)\b/gi;
var TOPIC_STRIP_ROMAN = /\b(seekh\w*|sikh\w*|seekho|sikho|dekh|kar|se|internet|youtube|video|is|ye|yeh|wo|woh|batao|lo|ke|ka|ki|ko|bare|mein|par|please|aur|karo|karke)\b/gi;
var TOPIC_LEAD_FILLER = /^(ke|کہ|ki|کا|کے|about|on|par|se|from|aur|and|to|is|ye|یہ|اس|ایہ|توں|تے|وچ|نال|دا|دی|دے)\s+/i;

/* Urdu-script strip set: whole tokens only. Substring stripping would
   eat letters inside real topic words (e.g. "کو" inside "کوانٹم"),
   so the Urdu-script branch tokenises on whitespace and drops only
   tokens that ARE trigger / particle words. */
var TOPIC_STRIP_URDU_TOKENS = {
  'انٹرنیٹ': 1, 'یوٹیوب': 1, 'ویڈیو': 1,
  'سیکھو': 1, 'سیکھ': 1, 'سکھو': 1, 'سکھ': 1,
  'ویکھ': 1, 'ویکھو': 1, 'دیکھ': 1, 'دیکھو': 1,
  'بتاؤ': 1, 'بتا': 1, 'دسو': 1,
  'سے': 1, 'توں': 1, 'پر': 1, 'پے': 1,
  'کے': 1, 'کا': 1, 'کی': 1, 'کو': 1, 'میں': 1, 'بارے': 1,
  'یہ': 1, 'اس': 1, 'ایہ': 1, 'ایس': 1, 'کہ': 1, 'لو': 1, 'کر': 1,
  'براہ': 1, 'کرم': 1
};

function extractDirectedTopic(text) {
  var raw = asString(text);
  /* A URL is never part of the topic. */
  var t = raw.replace(/https?:\/\/[^\s'"]+/gi, ' ');
  if (hasUrduScript(t)) {
    var toks = t.replace(/[?!.,;:'"()\[\]{}؟۔،؛]+/g, ' ').split(/\s+/);
    var kept = [];
    var i;
    for (i = 0; i < toks.length; i++) {
      if (!toks[i]) continue;
      if (!TOPIC_STRIP_URDU_TOKENS[toks[i]]) kept.push(toks[i]);
    }
    t = kept.join(' ');
  } else {
    t = t.replace(TOPIC_STRIP_EN, ' ');
    t = t.replace(TOPIC_STRIP_ROMAN, ' ');
    t = trim(t.replace(/[?!.,;:'"()\[\]{}]+/g, ' ').replace(/\s+/g, ' '));
  }
  /* Strip leading particles left over after the trigger strip. */
  var guard = 0;
  while (TOPIC_LEAD_FILLER.test(t) && guard < 6) {
    t = trim(t.replace(TOPIC_LEAD_FILLER, ''));
    guard++;
  }
  if (!t) return null;
  if (/^(it|that|this|these|those|them|ye|yeh|wo|woh|us|is|isi|usi)$/i.test(t)) return null;
  return t.slice(0, 120);
}

/* detectDirectedLearning(text)
   Needs BOTH a learn verb AND a named source. Returns null otherwise:
   plain research orders ("research karo"), normal questions and
   definitions never fire here. */
function detectDirectedLearning(text) {
  var raw = asString(text);
  if (!trim(raw)) return null;
  if (isAboutPastLearning(raw)) return null;
  if (!hasLearnVerb(raw)) return null;
  var src = detectDirectedSource(raw);
  if (!src.source) return null;
  var lang = detectDirectedLanguage(raw);
  return {
    isDirected: true,
    source: src.source,
    topic: extractDirectedTopic(raw),
    videoUrl: src.videoUrl,
    lang: lang
  };
}

/* ------------------------------------------------------------------ */
/* Internet learner                                                    */
/* ------------------------------------------------------------------ */

function normaliseSearchResults(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (typeof res === 'object' && Array.isArray(res.results)) return res.results;
  return [];
}

function resultPoint(r) {
  if (!r || typeof r !== 'object') return null;
  var url = asString(r.url || r.link || '');
  if (!url || url.indexOf('http') !== 0) return null;
  var title = asString(r.title || '');
  var text = asString(r.snippet || r.text || r.description || title);
  if (!trim(text) && !trim(title)) return null;
  return {
    point: trim(text) || trim(title),
    source: {
      title: title || url,
      url: url,
      date: asString(r.date || r.published || r.publishedAt || '')
    }
  };
}

/* learnFromInternet(topic, deps)
   Runs real research through deps.search. Only real returned results
   become learned points; 0 results -> 'partial' with an honest
   message, never invented points. Always returns a Promise. */
function learnFromInternet(topic, deps) {
  deps = (deps && typeof deps === 'object') ? deps : {};
  var t = trim(topic);
  if (!t) {
    return Promise.resolve({
      learned: [], sourcesVerified: 0, status: 'failed',
      message: 'No topic was given, so there was nothing to learn from the internet.',
      topic: null
    });
  }
  if (typeof deps.search !== 'function') {
    return Promise.resolve({
      learned: [], sourcesVerified: 0, status: 'failed',
      message: 'No search function was supplied, so I could not look anything up on the internet.',
      topic: t
    });
  }
  var out;
  try {
    out = deps.search(t);
  } catch (e) {
    return Promise.resolve({
      learned: [], sourcesVerified: 0, status: 'failed',
      message: 'The internet search failed (' + ((e && e.message) || String(e)) + '), so I learned nothing.',
      topic: t
    });
  }
  return toPromise(out).then(function (res) {
    var list = normaliseSearchResults(res);
    var learned = [];
    var i, p;
    for (i = 0; i < list.length; i++) {
      p = resultPoint(list[i]);
      if (p) learned.push(p);
    }
    if (!learned.length) {
      return {
        learned: [], sourcesVerified: 0, status: 'partial',
        message: 'I searched the internet for "' + t + '" but found no usable results, so I learned nothing. I did not invent an answer.',
        topic: t
      };
    }
    return {
      learned: learned,
      sourcesVerified: learned.length,
      status: 'ok',
      message: 'Learned ' + learned.length + ' point' + (learned.length === 1 ? '' : 's') +
        ' about "' + t + '" from ' + learned.length + ' real source' +
        (learned.length === 1 ? '' : 's') + '.',
      topic: t
    };
  }, function (err) {
    return {
      learned: [], sourcesVerified: 0, status: 'failed',
      message: 'The internet search failed (' + ((err && err.message) || String(err)) + '), so I learned nothing.',
      topic: t
    };
  });
}

/* ------------------------------------------------------------------ */
/* YouTube learner                                                     */
/* ------------------------------------------------------------------ */

/* Split real description / transcript text into learnable points:
   one point per non-empty sentence, capped at 5, each citing the
   video as its source. Nothing is added that the text does not say. */
function pointsFromText(text, videoSource) {
  var raw = asString(text);
  if (!trim(raw)) return [];
  var parts = raw.split(/(?<=[.!?])\s+|\n+/);
  var out = [];
  var i, s;
  for (i = 0; i < parts.length && out.length < 5; i++) {
    s = trim(parts[i]);
    if (!s) continue;
    if (s.length < 8) continue;
    out.push({
      point: s,
      source: {
        title: videoSource.title,
        url: videoSource.url,
        date: videoSource.date || ''
      }
    });
  }
  return out;
}

/* learnFromYouTube(videoUrlOrQuery, deps)
   Resolves the video through deps.resolveVideo. Metadata only (no
   description / transcript text) -> points [] and status
   'metadata-only' with an honest message. NEVER fabricate transcript
   content. Always returns a Promise. */
function learnFromYouTube(videoUrlOrQuery, deps) {
  deps = (deps && typeof deps === 'object') ? deps : {};
  var input = trim(videoUrlOrQuery);
  if (!input) {
    return Promise.resolve({
      video: null, points: [], status: 'failed',
      message: 'No video was given, so there was nothing to learn from.'
    });
  }
  if (typeof deps.resolveVideo !== 'function') {
    return Promise.resolve({
      video: null, points: [], status: 'failed',
      message: 'No video resolver was supplied, so I could not open the video.'
    });
  }
  var out;
  try {
    out = deps.resolveVideo(input);
  } catch (e) {
    return Promise.resolve({
      video: null, points: [], status: 'failed',
      message: 'Opening the video failed (' + ((e && e.message) || String(e)) + '), so I learned nothing.'
    });
  }
  return toPromise(out).then(function (v) {
    if (!v || typeof v !== 'object' || (!v.title && !v.url)) {
      return {
        video: null, points: [], status: 'failed',
        message: 'I could not find or open that video, so I learned nothing from it.'
      };
    }
    var video = {
      title: asString(v.title || ''),
      channel: asString(v.channel || v.author || ''),
      url: asString(v.url || input),
      published: asString(v.published || v.publishedAt || v.date || '')
    };
    var text = asString(v.transcript || v.description || '');
    var source = { title: video.title || video.url, url: video.url, date: video.published };
    var points = pointsFromText(text, source);
    if (!points.length) {
      return {
        video: video, points: [], status: 'metadata-only',
        message: 'I could read the video\'s title and description, but not a full transcript, so I learned only what the description states. The video is "' +
          (video.title || video.url) + '"' +
          (video.channel ? ' by ' + video.channel : '') +
          '; I did not invent anything it says.',
        transcriptAvailable: false
      };
    }
    return {
      video: video,
      points: points,
      status: 'ok',
      message: 'Learned ' + points.length + ' point' + (points.length === 1 ? '' : 's') +
        ' from the video "' + (video.title || video.url) + '", taken only from its real description' +
        (v.transcript ? ' and transcript' : '') + '.',
      transcriptAvailable: !!v.transcript
    };
  }, function (err) {
    return {
      video: null, points: [], status: 'failed',
      message: 'Opening the video failed (' + ((err && err.message) || String(err)) + '), so I learned nothing.'
    };
  });
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

var SUMMARY_TEXT = {
  en: {
    learned: 'What I learned:',
    notLearned: 'What I could not learn:',
    next: 'What I will do differently: I will remember these points and use them when you ask about this topic again, citing the same sources.',
    nextNone: 'I learned nothing because no sources were found, so there is nothing to remember for next time.',
    nextNoneVideo: 'I learned nothing from this video, so there is nothing to remember for next time.'
  },
  urdu: {
    learned: 'میں نے کیا سیکھا:',
    notLearned: 'میں کیا نہیں سیکھ سکا:',
    next: 'آگے میں کیا مختلف کروں گا: میں ان باتوں کو یاد رکھوں گا اور جب آپ اس موضوع پر دوبارہ پوچھیں گے تو انہی ذرائع کے حوالے سے استعمال کروں گا۔',
    nextNone: 'میں نے کچھ نہیں سیکھا کیونکہ کوئی ذریعہ نہیں ملا، اس لیے اگلی بار کے لیے یاد رکھنے کو کچھ نہیں ہے۔',
    nextNoneVideo: 'میں نے اس ویڈیو سے کچھ نہیں سیکھا، اس لیے اگلی بار کے لیے یاد رکھنے کو کچھ نہیں ہے۔'
  },
  roman: {
    learned: 'Maine kya seekha:',
    notLearned: 'Main kya nahi seekh saka:',
    next: 'Aage main kya mukhtalif karoon ga: main in baton ko yaad rakhon ga aur jab aap is topic par dobara poochein ge to inhi sources ke hawale se istemal karoon ga.',
    nextNone: 'Maine kuch nahi seekha kyun ke koi source nahi mila, is liye agli baar ke liye yaad rakhne ko kuch nahi hai.',
    nextNoneVideo: 'Maine is video se kuch nahi seekha, is liye agli baar ke liye yaad rakhne ko kuch nahi hai.'
  },
  punjabi: {
    learned: 'میں کی سکھیا:',
    notLearned: 'میں کی نہیں سکھ سکیا:',
    next: 'اگے میں کی وکھرا کراں گا: میں ایناں گلاں نوں یاد رکھاں گا تے جدوں تسیں ایس موضوع تے دوبارہ پچھو گے تاں اوہناں ای ذرائع دے حوالے نال ورتاؤں گا۔',
    nextNone: 'میں کجھ نہیں سکھیا کیونکہ کوئی ذریعہ نہیں ملیا، ایس لئی اگلی واری لئی یاد رکھن نوں کجھ نہیں ہے۔',
    nextNoneVideo: 'میں ایس ویڈیو توں کجھ نہیں سکھیا، ایس لئی اگلی واری لئی یاد رکھن نوں کجھ نہیں ہے۔'
  }
};

function learnedPointsOf(result) {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.learned)) return result.learned;
  if (Array.isArray(result.points)) return result.points;
  return [];
}

/* Count the learned points that actually cite a real source URL. A point
   without an http(s) source URL is not a sourced point — the "will use
   these sources" closing may only ever be printed when this count is ≥ 1
   (Case C, v68 P6). */
function sourcedPointsOf(result) {
  var points = learnedPointsOf(result);
  var n = 0, i, src;
  for (i = 0; i < points.length; i++) {
    src = (points[i] && points[i].source) || {};
    if (typeof src.url === 'string' && /^https?:\/\//i.test(src.url)) n++;
  }
  return n;
}

/* summariseLearning(result, lang)
   Short summary in the user's language: what was learned (bullets,
   each with its real source), what could NOT be learned/accessed,
   and what ENZO will now do differently. Honest about gaps; no
   invented counts. The "will do differently" closing claims sources
   only when ≥ 1 sourced point was actually retrieved; a zero-source
   run closes with a plain nothing-learned line instead (Case C, v68 P6). */
function summariseLearning(result, lang) {
  var l = SUMMARY_TEXT[lang] ? lang : 'en';
  var t = SUMMARY_TEXT[l];
  var points = learnedPointsOf(result);
  var lines = [];
  if (result && result.video && result.video.title) {
    lines.push('Video: "' + result.video.title + '"' +
      (result.video.channel ? ' by ' + result.video.channel : '') + '.');
  }
  lines.push(t.learned);
  if (points.length) {
    var i, p, src;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      src = (p && p.source) || {};
      lines.push('- ' + asString(p.point || '') +
        (src.url ? ' (Source: ' + asString(src.title || src.url) + ' — ' + src.url + ')' : ''));
    }
  } else {
    lines.push('- ' + (result && result.message ? asString(result.message) : 'Nothing was learned.'));
  }
  var gap = null;
  if (result && result.status === 'metadata-only') {
    gap = result.message ||
      'I could read the video\'s title and description, but not a full transcript, so I learned only what the description states.';
  } else if (result && (result.status === 'partial' || result.status === 'failed')) {
    gap = result.message || 'Nothing could be learned.';
  } else if (result && result.video && !points.length) {
    gap = 'No learnable text was available from the video.';
  }
  if (gap) {
    lines.push(t.notLearned);
    lines.push('- ' + gap);
  }
  /* Case C (v68 P6): the "will remember / use these sources" closing is
     printed ONLY when the run actually retrieved ≥ 1 sourced point. With
     zero sourced points it would claim sources that do not exist — so the
     closing instead says plainly, in the user's language, that nothing
     was learned, and nothing else. A video that was retrieved but yielded
     no learnable text gets the video variant (the video exists, but there
     are no points to remember); every other zero-source run gets the
     no-sources variant. */
  if (sourcedPointsOf(result) > 0) {
    lines.push(t.next);
  } else if (result && result.video && (result.video.url || result.video.title)) {
    lines.push(t.nextNoneVideo);
  } else {
    lines.push(t.nextNone);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Wiring entry                                                        */
/* ------------------------------------------------------------------ */

function resolveStore(deps) {
  if (deps && deps.store && typeof deps.store.addItem === 'function') return deps.store;
  var teaching = getGlobal('EnzoLearningTeaching');
  if (teaching && typeof teaching.addItem === 'function') return teaching;
  var learning = getGlobal('EnzoLearning');
  if (learning && typeof learning.addItem === 'function') return learning;
  return null;
}

/* applyDirectedLearning(text, deps)
   detect -> run the right learner -> save each learned point as a
   store item with its source attached -> return { result, summary,
   savedIds }. Non-directed text returns directed:false and no work. */
/* learnFromInternetThenSave(detected, deps): the OLD internet path
   (one search for the topic) with the piece-42 store save. Used as the
   fallback when the keyword job API is unavailable (P7). */
function learnFromInternetThenSave(detected, deps) {
  return toPromise(learnFromInternet(detected.topic, deps))
    .then(function (result) { return saveLearnedPoints(detected, result, deps); });
}

/* saveLearnedPoints(detected, result, deps): the piece-42 store save,
   shared by the old path and the YouTube path. The keyword path saves
   its own points (EnzoKeywordLearning.savePointsToStore) and never
   calls this — no double-save. */
function saveLearnedPoints(detected, result, deps) {
  var points = learnedPointsOf(result);
  var savedIds = [];
  var store = resolveStore(deps);
  if (store && points.length) {
    var i, p, item, id;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      item = {
        kind: detected.source === 'internet' ? 'fact' : 'skill',
        text: asString(p.point || ''),
        detail: (p.source && p.source.title) ? asString(p.source.title) : '',
        lang: detected.lang,
        source: {
          type: detected.source,
          url: (p.source && p.source.url) || '',
          title: (p.source && p.source.title) || '',
          date: (p.source && p.source.date) || ''
        },
        ts: Date.now(),
        topic: detected.topic || ''
      };
      try {
        id = store.addItem(item);
        savedIds.push((id === undefined || id === null) ? i : id);
      } catch (e) { /* one failed save must not lose the rest */ }
    }
  }
  return {
    directed: true,
    detected: detected,
    result: result,
    summary: summariseLearning(result, detected.lang),
    savedIds: savedIds
  };
}

function applyDirectedLearning(text, deps) {
  deps = (deps && typeof deps === 'object') ? deps : {};
  var detected = detectDirectedLearning(text);
  if (!detected) {
    return Promise.resolve({
      directed: false, detected: null, result: null, summary: null, savedIds: []
    });
  }
  /* P7: internet orders go through the keyword job FIRST (100 keywords,
     every returned site read, honest four-count report). The keyword
     module saves the points itself; this branch returns them mapped
     into the piece-42 result shape. Any unavailability falls back to
     the old one-search path below — a learn order never fails just
     because the keyword system is down. */
  if (detected.source === 'internet') {
    var kwLearn = (deps && deps.keywordLearn) ||
      getGlobal('EnzoKeywordLearning');
    if (kwLearn && typeof kwLearn.startKeywordLearn === 'function') {
      var kwJob;
      try {
        kwJob = kwLearn.startKeywordLearn(detected.topic, {
          lang: detected.lang,
          store: resolveStore(deps),
          onProgress: deps.onKeywordProgress
        });
      } catch (e) {
        kwJob = null;
      }
      if (kwJob) {
        return toPromise(kwJob).then(function (kwRes) {
          if (kwRes && kwRes.available) {
            var learned = (kwRes.points || []).map(function (pt) {
              return {
                point: pt.text || '',
                source: {
                  title: pt.source_title || pt.source_url || '',
                  url: pt.source_url || '',
                  date: pt.source_date || ''
                }
              };
            });
            var result = {
              learned: learned,
              sourcesVerified: learned.length,
              status: learned.length ? 'ok' : 'partial',
              message: 'Learned ' + learned.length + ' point' +
                (learned.length === 1 ? '' : 's') + ' about "' +
                (detected.topic || '') + '" from the keyword job.',
              topic: detected.topic,
              keywordReport: kwRes.report || null,
              jobId: kwRes.jobId || null
            };
            return {
              directed: true,
              detected: detected,
              result: result,
              summary: kwRes.summary || summariseLearning(result, detected.lang),
              savedIds: kwRes.savedIds || []
            };
          }
          return learnFromInternetThenSave(detected, deps);
        }, function () {
          return learnFromInternetThenSave(detected, deps);
        });
      }
    }
  }
  var job;
  if (detected.source === 'internet') {
    job = learnFromInternet(detected.topic, deps);
  } else {
    job = learnFromYouTube(detected.videoUrl || detected.topic || '', deps);
  }
  return toPromise(job).then(function (result) {
    return saveLearnedPoints(detected, result, deps);
  });
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

var api = {
  VERSION: VERSION,
  detectDirectedLearning: detectDirectedLearning,
  detectDirectedLanguage: detectDirectedLanguage,
  extractVideoUrl: extractVideoUrl,
  learnFromInternet: learnFromInternet,
  learnFromYouTube: learnFromYouTube,
  summariseLearning: summariseLearning,
  applyDirectedLearning: applyDirectedLearning
};

global.EnzoDirectedLearning = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
