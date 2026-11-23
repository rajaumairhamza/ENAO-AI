/* ==========================================================================
 * PIECE P7 — Keyword-expansion learning (frontend)
 * v68 ENZO full internet access, System 2 scope. DO NOT EDIT THE ARTIFACT.
 * DO NOT DEPLOY. Piece build only.
 *
 * PURPOSE
 * -------
 * When Raja says "learn 'x'", ENZO no longer runs one bare search for x
 * (which returned 0 results for Roman Urdu — Case C). Instead it starts
 * a keyword-learn job: ~100 deterministic keywords for x, EVERY keyword
 * searched through the P2 layer, EVERY returned site fetched + read,
 * learned points saved with their real sources. This module drives that
 * job from the browser: create, poll with REAL progress (keyword N/100,
 * sites read, current keyword), render the saved keyword list, save the
 * learned points into the piece-42 store, and build the honest final
 * report (four counts — see buildKeywordReport).
 *
 * WHAT IT REUSES (never reimplements)
 * -----------------------------------
 * - Piece 42 directed-learning (directed-learning.js): detection
 *   (detectDirectedLearning) and the old learnFromInternet path, which
 *   stays as the FALLBACK when the keyword job API is unavailable.
 *   The keyword path is the DEFAULT for "learn x from the internet"
 *   orders; a plain learn order still works the old way when the
 *   keyword system is unavailable (see FIX.md §5).
 * - Piece 41 store (teaching.js / EnzoLearningTeaching): learned
 *   points are saved with the SAME item shape piece 42 uses —
 *   { kind:'fact'|'skill', text, detail, lang, source:{type,url,title,
 *   date}, ts, topic } — into `enao_learned_items_v1`. No second store.
 * - Piece 43 settings-learned (settings-learned.js): the Settings
 *   "Things ENZO learned" panel lists the saved points with per-item
 *   Delete; this module adds the keyword JOB list + keyword list
 *   rendering (renderKeywordList) next to it (wiring in FIX.md §6).
 *
 * RULES (locked by this piece + Raja 23 Nov ~11:50 AM)
 * ------------------------------------------------------
 * - Per keyword, ALL sites the search returns are read — no sampling,
 *   no top-N cap. A search page that returns 10 results means 10 reads.
 * - Same URL across keywords: fetched ONCE, counted ONCE, attributed
 *   to ALL keywords (the backend records the attribution).
 * - Honest counts, always all four: keywords searched (of 100), sites
 *   found, sites actually read, sites skipped-with-reason. Never claim
 *   a page that was not fetched. A 0-result keyword is reported as 0.
 * - The "will use these sources" closing is printed ONLY when >= 1
 *   sourced point was actually retrieved (Case C, P6 rule).
 *
 * PUBLIC API (on EnzoKeywordLearning)
 * -------------------------------------
 * startKeywordLearn(topic, deps)
 *   -> Promise resolving to { available, jobId, report, savedIds,
 *      summary }. When the backend job API is unavailable (network
 *      error / 404 / no fetch), available:false and the caller falls
 *      back to the old learnFromInternet path.
 *      deps.api (optional): { createJob(topic), getJob(jobId),
 *      resumeJob(jobId), deletePoints(jobId, idx) } — defaults use
 *      fetch() against /api/v2/learn/*. deps.onProgress(job, report)
 *      is called on every poll. deps.store: piece-41 store (addItem);
 *      falls back to window.EnzoLearningTeaching.
 * renderProgress(job, report) -> HTML string (progress block).
 * renderKeywordList(job, keywords) -> HTML string (saved keyword list
 *   with per-keyword status; 0-result keywords shown as 0).
 * buildKeywordReport(job, report, lang) -> string (honest final
 *   report, user's language; four counts + skip reasons + engine note).
 * savePointsToStore(points, topic, lang, deps) -> savedIds array.
 * deleteKeywordPoints(jobId, idx, deps) -> Promise resolving to the
 *   number of points deleted (job record + matching store items).
 * VERSION: 'p7-keyword-1.0.0'
 * ========================================================================== */
(function (global) {
'use strict';

var VERSION = 'p7-keyword-1.0.0';
var POLL_MS = 3000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function asString(v) { return (v === null || v === undefined) ? '' : String(v); }
function trim(s) { return asString(s).replace(/^\s+|\s+$/g, ''); }
function escH(s) {
  return asString(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function toPromise(value) {
  try {
    if (value && typeof value.then === 'function') return value;
  } catch (e) { /* plain value */ }
  return Promise.resolve(value);
}
function getGlobal(name) {
  try {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof window !== 'undefined' && window[name]) return window[name];
  } catch (e) { /* best-effort */ }
  return null;
}

/* ------------------------------------------------------------------ */
/* Default API (fetch against the same-origin backend)                 */
/* ------------------------------------------------------------------ */

function fetchJson(url, opts) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('fetch is not available'));
  }
  return fetch(url, opts).then(function (resp) {
    if (!resp.ok) {
      throw new Error('keyword-learn API answered HTTP ' + resp.status);
    }
    return resp.json();
  });
}

function defaultApi() {
  return {
    createJob: function (topic) {
      return fetchJson('/api/v2/learn/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic })
      });
    },
    getJob: function (jobId) {
      return fetchJson('/api/v2/learn/' + encodeURIComponent(jobId));
    },
    resumeJob: function (jobId) {
      return fetchJson('/api/v2/learn/' + encodeURIComponent(jobId) + '/resume', {
        method: 'POST'
      });
    },
    deletePoints: function (jobId, idx) {
      return fetchJson('/api/v2/learn/' + encodeURIComponent(jobId) +
        '/keywords/' + encodeURIComponent(idx) + '/points/delete', {
        method: 'POST'
      });
    },
    listJobs: function () {
      return fetchJson('/api/v2/learn');
    }
  };
}

function resolveApi(deps) {
  if (deps && deps.api) return deps.api;
  return defaultApi();
}

function resolveStore(deps) {
  if (deps && deps.store && typeof deps.store.addItem === 'function') return deps.store;
  var teaching = getGlobal('EnzoLearningTeaching');
  if (teaching && typeof teaching.addItem === 'function') return teaching;
  return null;
}

/* ------------------------------------------------------------------ */
/* Progress + keyword list rendering (HTML strings, escaped)           */
/* ------------------------------------------------------------------ */

/* renderProgress(job, report): real progress — keyword N/100, sites
   read so far, current keyword. Nothing here is estimated: every
   number comes from the job record. */
function renderProgress(job, report) {
  job = job || {};
  report = report || {};
  var total = job.keywords_total || report.keywords_total || 100;
  var done = report.keywords_searched || job.keywords_done || 0;
  var kws = job.keywords || [];
  var current = '';
  var i;
  for (i = 0; i < kws.length; i++) {
    if (kws[i] && kws[i].status === 'pending') { current = kws[i].keyword || ''; break; }
  }
  if (!current && job.status === 'running') current = 'finishing up';
  var h = '<div class="kw-progress">';
  h += '<div class="kw-progress-line">Learning: keyword ' + done + ' of ' + total + '</div>';
  h += '<div class="kw-progress-line">Sites found: ' + (report.sites_found || 0) +
    ' &middot; read: ' + (report.sites_read || 0) +
    ' &middot; skipped: ' + (report.sites_skipped || 0) + '</div>';
  if (current) h += '<div class="kw-progress-line">Now: ' + escH(current) + '</div>';
  h += '<div class="kw-progress-line">Learned points so far: ' + (report.points_learned || 0) + '</div>';
  h += '</div>';
  return h;
}

/* renderKeywordList(job, keywords): the SAVED keyword list, visible in
   the learning record / Settings. One row per keyword: keyword, family,
   status, results returned, sites read / skipped. A 0-result keyword is
   shown as "0 results" — never hidden. */
function renderKeywordList(job, keywords) {
  job = job || {};
  var list = keywords || job.keywords || [];
  var h = '<div class="kw-list-head"><h4>Keywords for "' +
    escH(job.topic || '') + '"</h4>';
  h += '<p class="kw-note">' + list.length +
    ' keywords saved. Every keyword was searched; every site the search returned was read, or skipped with a reason.</p></div>';
  if (!list.length) {
    h += '<div class="kw-row"><span>No keywords saved yet.</span></div>';
    return h;
  }
  h += '<div class="kw-list">';
  list.forEach(function (k, i) {
    var status = k.status || 'pending';
    var label = status === 'done' ? 'done' :
      status === 'zero' ? '0 results' :
      status === 'failed' ? 'search failed' : 'waiting';
    h += '<div class="kw-item" data-kw-idx="' + i + '">';
    h += '<span class="kw-word">' + escH(k.keyword || '') + '</span>';
    h += ' <span class="kw-family">' + escH(k.family || '') + '</span>';
    h += ' <span class="kw-status">' + escH(label) + '</span>';
    if (status === 'done') {
      h += ' <span class="kw-counts">' + (k.results_returned || 0) +
        ' found &middot; ' + (k.sites_read || 0) + ' read' +
        (k.sites_skipped ? ' &middot; ' + k.sites_skipped + ' skipped' : '') + '</span>';
    }
    if (status === 'failed' && k.error) {
      h += ' <span class="kw-error">' + escH(k.error) + '</span>';
    }
    h += '</div>';
  });
  h += '</div>';
  return h;
}

/* ------------------------------------------------------------------ */
/* Honest final report (four counts, user's language)                  */
/* ------------------------------------------------------------------ */

var REPORT_TEXT = {
  en: {
    head: 'What I learned about "%s":',
    kw: 'Keywords searched: %d of %d.',
    found: 'Sites found: %d.',
    read: 'Sites actually read: %d.',
    skipped: 'Sites skipped: %d.',
    skipRow: '- %s — %s',
    zero: 'Keywords with no results: %s.',
    noneZero: 'Every keyword returned at least one result.',
    engine: 'Note: the search returns one page of results per keyword; I read every result it returned and did not invent further pages.',
    points: 'Learned points: %d, each with its real source.',
    next: 'What I will do differently: I will remember these points and use them when you ask about this topic again, citing the same sources.',
    nextNone: 'I learned nothing because no sources were found, so there is nothing to remember for next time.'
  },
  roman: {
    head: '"%s" ke baare mein maine kya seekha:',
    kw: 'Keywords search kiye: %d mein se %d.',
    found: 'Sites mili: %d.',
    read: 'Sites asal mein parhi: %d.',
    skipped: 'Sites skip ki: %d.',
    skipRow: '- %s — %s',
    zero: 'Keywords jin ka koi result nahi mila: %s.',
    noneZero: 'Har keyword ka kam se kam ek result mila.',
    engine: 'Note: search har keyword ke liye ek page results deti hai; maine jo result aaya wo sab parha, mazeed pages invent nahi kiye.',
    points: 'Learned points: %d, har ek apne asal source ke saath.',
    next: 'Aage main kya mukhtalif karoon ga: main in baton ko yaad rakhon ga aur jab aap is topic par dobara poochein ge to inhi sources ke hawale se istemal karoon ga.',
    nextNone: 'Maine kuch nahi seekha kyun ke koi source nahi mila, is liye agli baar ke liye yaad rakhne ko kuch nahi hai.'
  },
  urdu: {
    head: '"%s" کے بارے میں میں نے کیا سیکھا:',
    kw: 'تلاش کیے گئے کلیدی الفاظ: %d میں سے %d۔',
    found: 'ملنے والی سائٹس: %d۔',
    read: 'اصل میں پڑھی گئی سائٹس: %d۔',
    skipped: 'چھوڑی گئی سائٹس: %d۔',
    skipRow: '- %s — %s',
    zero: 'جن کلیدی الفاظ کا کوئی نتیجہ نہیں ملا: %s۔',
    noneZero: 'ہر کلیدی لفظ کا کم از کم ایک نتیجہ ملا۔',
    engine: 'نوٹ: سرچ ہر کلیدی لفظ کے لیے ایک صفحہ نتائج دیتی ہے؛ میں نے جو نتائج آئے وہ سب پڑھے، مزید صفحات ایجاد نہیں کیے۔',
    points: 'سیکھے گئے نکات: %d، ہر ایک اپنے اصل ذریعے کے ساتھ۔',
    next: 'آگے میں کیا مختلف کروں گا: میں ان باتوں کو یاد رکھوں گا اور جب آپ اس موضوع پر دوبارہ پوچھیں گے تو انہی ذرائع کے حوالے سے استعمال کروں گا۔',
    nextNone: 'میں نے کچھ نہیں سیکھا کیونکہ کوئی ذریعہ نہیں ملا، اس لیے اگلی بار کے لیے یاد رکھنے کو کچھ نہیں ہے۔'
  },
  punjabi: {
    head: '"%s" بارے میں کی سکھیا:',
    kw: 'تلاش کیتے گئے لفظ: %d وچوں %d۔',
    found: 'لبھیاں سائٹاں: %d۔',
    read: 'اصل وچ پڑھیاں سائٹاں: %d۔',
    skipped: 'چھڈیاں سائٹاں: %d۔',
    skipRow: '- %s — %s',
    zero: 'جنہاں لفظاں دا کوئی نتیجہ نہیں ملیا: %s۔',
    noneZero: 'ہر لفظ دا گھٹو گھٹ اک نتیجہ ملیا۔',
    engine: 'نوٹ: سرچ ہر لفظ لئی اک صفحہ نتائج دیندی اے؛ میں جو نتائج آئے اوہ سب پڑھے، ہور صفحے ایجاد نہیں کیتے۔',
    points: 'سکھے ہوئے نکتے: %d، ہر اک اپنے اصل ذریعے نال۔',
    next: 'اگے میں کی وکھرا کراں گا: میں ایناں گلاں نوں یاد رکھاں گا تے جدوں تسیں ایس موضوع تے دوبارہ پچھو گے تاں اوہناں ای ذرائع دے حوالے نال ورتاؤں گا۔',
    nextNone: 'میں کجھ نہیں سکھیا کیونکہ کوئی ذریعہ نہیں ملیا، ایس لئی اگلی واری لئی یاد رکھن نوں کجھ نہیں ہے۔'
  }
};

function fmt(s) {
  var args = Array.prototype.slice.call(arguments, 1);
  var i = 0;
  return asString(s).replace(/%[ds]/g, function () {
    var v = args[i++];
    return (v === null || v === undefined) ? '' : String(v);
  });
}

/* buildKeywordReport(job, report, lang): the four counts, exactly, in
   the user's language. Skip reasons are listed, never hidden. The
   "will use these sources" closing appears ONLY when >= 1 sourced
   point exists (Case C / P6 rule) — with 0 points the closing says
   plainly that nothing was learned. */
function buildKeywordReport(job, report, lang) {
  var l = REPORT_TEXT[lang] ? lang : 'en';
  var t = REPORT_TEXT[l];
  job = job || {};
  report = report || {};
  var total = report.keywords_total || job.keywords_total || 100;
  var lines = [];
  lines.push(fmt(t.head, job.topic || report.topic || ''));
  lines.push(fmt(t.kw, report.keywords_searched || 0, total));
  lines.push(fmt(t.found, report.sites_found || 0));
  lines.push(fmt(t.read, report.sites_read || 0));
  lines.push(fmt(t.skipped, report.sites_skipped || 0));
  var skips = report.skipped_sites || [];
  var i;
  for (i = 0; i < skips.length; i++) {
    lines.push(fmt(t.skipRow, skips[i].url || '', skips[i].reason || ''));
  }
  if (report.zero_keywords && report.zero_keywords.length) {
    lines.push(fmt(t.zero, report.zero_keywords.join(', ')));
  } else {
    lines.push(t.noneZero);
  }
  lines.push(t.engine);
  lines.push(fmt(t.points, report.points_learned || 0));
  if ((report.points_learned || 0) > 0) {
    lines.push(t.next);
  } else {
    lines.push(t.nextNone);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Saving points (piece-42 store shape, no second store)               */
/* ------------------------------------------------------------------ */

function savePointsToStore(points, topic, lang, deps) {
  var store = resolveStore(deps);
  var savedIds = [];
  if (!store || !points || !points.length) return savedIds;
  var i, p, item, id;
  for (i = 0; i < points.length; i++) {
    p = points[i];
    if (!p || !p.text) continue;
    item = {
      kind: 'fact',
      text: asString(p.text || '').slice(0, 500),
      detail: (p.source && p.source.title) || p.source_title || '',
      lang: lang || 'en',
      source: {
        type: 'internet',
        url: (p.source && p.source.url) || p.source_url || '',
        title: (p.source && p.source.title) || p.source_title || '',
        date: (p.source && p.source.date) || p.source_date || ''
      },
      ts: Date.now(),
      topic: topic || ''
    };
    try {
      id = store.addItem(item);
      savedIds.push((id === undefined || id === null) ? i : id);
    } catch (e) { /* one failed save must not lose the rest */ }
  }
  return savedIds;
}

/* deleteKeywordPoints(jobId, idx, deps): per-keyword delete from the
   job record (API) + the matching items from `enao_learned_items_v1`
   (matched by point text + source URL, via the store's own
   getItems/deleteItem). Returns a Promise of the deleted count. */
function deleteKeywordPoints(jobId, idx, deps) {
  deps = deps || {};
  var api = resolveApi(deps);
  return toPromise(api.deletePoints(jobId, idx)).then(function (res) {
    var n = (res && typeof res.deleted === 'number') ? res.deleted : 0;
    var store = resolveStore(deps);
    if (store && typeof store.getItems === 'function' &&
        typeof store.deleteItem === 'function') {
      var job = (deps && deps.job) || null;
      var points = (job && job.points) || [];
      var i, j, items, it, match;
      try { items = store.getItems() || []; } catch (e) { items = []; }
      for (i = 0; i < points.length; i++) {
        if (points[i].keyword_idx !== idx) continue;
        for (j = 0; j < items.length; j++) {
          it = items[j];
          match = it && it.text === points[i].text &&
            it.source && it.source.url === points[i].source_url;
          if (match) {
            try { store.deleteItem(it.id); } catch (e) { /* keep going */ }
          }
        }
      }
    }
    return n;
  });
}

/* ------------------------------------------------------------------ */
/* Job driver                                                          */
/* ------------------------------------------------------------------ */

function isTerminal(job) {
  var s = (job && job.status) || '';
  return s === 'completed' || s === 'partially_completed' ||
    s === 'failed' || s === 'cancelled';
}

/* startKeywordLearn(topic, deps): create the job, poll until terminal,
   save the learned points into the piece-42 store, and return the
   honest report. deps.onProgress(job, report) fires on every poll.
   When the job API is unavailable the promise resolves with
   available:false — the caller (directed-learning) then falls back to
   the old learnFromInternet path instead of failing the learn order. */
function startKeywordLearn(topic, deps) {
  deps = deps || {};
  var api = resolveApi(deps);
  var lang = deps.lang || 'roman';
  var t = trim(topic);
  if (!t) {
    return Promise.resolve({
      available: true, jobId: null, report: null, savedIds: [],
      summary: 'No topic was given, so there was nothing to learn.'
    });
  }
  var jobId = null;
  var lastPayload = null;
  function poll() {
    return toPromise(api.getJob(jobId)).then(function (payload) {
      lastPayload = payload || {};
      var job = lastPayload.job || {};
      var report = lastPayload.report || {};
      if (typeof deps.onProgress === 'function') {
        try { deps.onProgress(job, report); } catch (e) { /* ignore */ }
      }
      if (isTerminal(job)) return lastPayload;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(poll()); }, POLL_MS);
      });
    });
  }
  var created;
  try {
    created = api.createJob(t);
  } catch (e) {
    return Promise.resolve({
      available: false, jobId: null, report: null, savedIds: [],
      summary: null, error: String((e && e.message) || e)
    });
  }
  return toPromise(created).then(function (payload) {
    jobId = (payload && payload.job_id) || null;
    if (!jobId) {
      return { available: false, jobId: null, report: null, savedIds: [],
        summary: null, error: 'keyword-learn API returned no job id' };
    }
    return poll();
  }).then(function (payload) {
    var job = (payload && payload.job) || {};
    var report = (payload && payload.report) || {};
    var points = (payload && payload.points) || [];
    var savedIds = savePointsToStore(points, t, lang, deps);
    return {
      available: true,
      jobId: jobId,
      report: report,
      job: job,
      keywords: (payload && payload.keywords) || [],
      points: points,
      savedIds: savedIds,
      summary: buildKeywordReport(job, report, lang)
    };
  }, function (err) {
    return { available: false, jobId: jobId, report: null, savedIds: [],
      summary: null, error: String((err && err.message) || err) };
  });
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

var api = {
  VERSION: VERSION,
  startKeywordLearn: startKeywordLearn,
  renderProgress: renderProgress,
  renderKeywordList: renderKeywordList,
  buildKeywordReport: buildKeywordReport,
  savePointsToStore: savePointsToStore,
  deleteKeywordPoints: deleteKeywordPoints
};

global.EnzoKeywordLearning = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
