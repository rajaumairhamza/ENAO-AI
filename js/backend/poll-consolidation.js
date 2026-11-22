
/* == ASSEMBLED PIECE 44 — 44-poll-consolidation.js (v62-backend-fix) == */
/* ==========================================================================
 * ENAO AI — Piece 44: Poll Consolidation (44-poll-consolidation.js)
 *
 * ONE shared poll loop replaces the many overlapping setInterval / setTimeout
 * pollers in the live v61 artifact. The v61 artifact ran a 450 ms monitor
 * poll, a 600 ms-first-tick task poll chain, a 700 ms sync, a 1200 ms monitor
 * sync, a 1000 ms panel-extras poll, a 500 ms state backstop, a 1500 ms
 * panel tick and a 120 ms mouth-animation timer at the same time. On a slow
 * device / network that saturates the browser's per-host connection pool
 * (6 concurrent), ask/health fetches queue until they time out — and one
 * timeout used to flip the app into "backend unreachable".
 *
 * Parent-verified server evidence (22 Nov 2026): the backend has run
 * continuously since 5:37 PM with NRestarts=0 and every request returning
 * 200. The "unreachable" state is a FRONTEND fault (pool saturation plus
 * single-attempt flagging), not the backend stopping. This piece removes
 * the amplifier; it never decides whether the backend is up or down.
 *
 * ACCURACY RULE (Raja, 22 Nov 2026 ~6:57 PM PKT): "ENZO ko accurate
 * banao — chahe jo bhi ho, kisi bhi tarah se ENZO ghalti na kare."
 * Applied here:
 *   1. FRESH DATA ONLY. dedupedFetch() collapses only requests that are
 *      IN FLIGHT at the same moment. A completed response is NEVER cached
 *      or replayed: the next call always fetches fresh data. A slow
 *      response must never overwrite newer state: every run carries a
 *      sequence token (markRun / isCurrent); wiring code drops any
 *      resolution whose token is no longer current.
 *   2. STALE IS NEVER SHOWN AS FRESH. getStatus() reports dataState
 *      ('fresh' | 'stale' | 'unknown' | 'error') from the age of the last
 *      successful poll. Wiring code must check dataState before rendering
 *      progress/status; stale data is shown as "updating..." or hidden,
 *      never as a current number.
 *   3. DUPLICATES NEVER DOUBLE-COUNT. Concurrent identical GETs share one
 *      fetch, so two pollers asking for the same URL cannot inflate a
 *      count or a progress figure.
 *   4. WHAT CANNOT BE VERIFIED IS SAID PLAINLY. Poll failures are
 *      reported only to this loop's own backoff. This module holds NO
 *      backend up/down state at all — that belongs to piece 42's health
 *      module. A poller that has never succeeded reports 'unknown', not
 *      a guessed value.
 *
 * UMD/IIFE, ES5 style, no dependencies, no emoji. Loads in a browser as
 * window.EnzoPollLoop and in Node as module.exports (for the test harness).
 * Does NOT touch voice/language code. Does NOT change poll payloads or
 * endpoints. Does NOT change what any poller DOES, only when/how often
 * it runs.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.EnzoPollLoop = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var VERSION = '44-poll-consolidation-v1';

  /* ---- Floors (milliseconds). A poller may never run faster than these. -- */
  var TASK_MIN_MS = 2000;   /* task-progress polling while a task runs */
  var IDLE_MIN_MS = 5000;   /* idle status polling */
  var PANEL_MIN_MS = 2000;  /* panel extras / panel tick refresh */
  var OTHER_MIN_MS = 1000;  /* any other registered poller */
  var TICK_MS = 250;        /* the single shared loop's own cadence */
  var MAX_BACKOFF_MS = 30000;
  var BACKOFF_AFTER = 3;    /* consecutive failures before backoff starts */
  var STALE_AFTER_MULT = 2; /* data older than 2x effective interval = stale */
  var JITTER = 0.10;        /* +/-10% scheduling jitter */

  /* ---- State ---------------------------------------------------------- */
  var pollers = {};         /* name -> poller record */
  var loopTimer = null;     /* the ONE setInterval handle */
  var inFlightFetch = {};   /* url key -> shared promise (in-flight only) */
  var lastFetchAt = {};     /* url key -> timestamp the fetch COMPLETED */
  var context = { hasActiveTask: false, panelVisible: true };
  var seqCounters = {};     /* name -> latest sequence token issued */

  function now() { return Date.now(); }

  function floorFor(kind, requested) {
    var min;
    if (kind === 'task') min = TASK_MIN_MS;
    else if (kind === 'idle') min = IDLE_MIN_MS;
    else if (kind === 'panel') min = PANEL_MIN_MS;
    else min = OTHER_MIN_MS;
    var ms = Number(requested);
    if (!isFinite(ms) || ms <= 0) ms = min;
    return Math.max(ms, min);
  }

  function jittered(ms, useJitter) {
    if (!useJitter) return ms;
    var f = 1 + (Math.random() * 2 - 1) * JITTER;
    return Math.max(1, Math.round(ms * f));
  }

  /* ---- Loop control --------------------------------------------------- */
  /* The loop runs only while something needs polling. When there is no
   * active task AND the panel is not visible, polling STOPS entirely. */
  function contextAllowsPolling() {
    return !!(context.hasActiveTask || context.panelVisible);
  }

  function maybeStart() {
    if (loopTimer !== null) return;
    if (!contextAllowsPolling()) return;
    if (Object.keys(pollers).length === 0) return;
    loopTimer = setInterval(tick, TICK_MS);
  }

  function maybeStop() {
    if (loopTimer === null) return;
    if (contextAllowsPolling() && Object.keys(pollers).length > 0) return;
    clearInterval(loopTimer);
    loopTimer = null;
  }

  function tick() {
    var t = now();
    var names = Object.keys(pollers);
    for (var i = 0; i < names.length; i++) {
      var p = pollers[names[i]];
      if (!p) continue;
      if (p.inFlight) continue;              /* never overlap the same poller */
      if (t < p.nextRunAt) continue;
      if (p.active && !p.active()) {          /* optional per-poller gate */
        p.nextRunAt = t + jittered(p.effectiveMs, p.jitter);
        continue;
      }
      runPoller(p, t);
    }
  }

  function effectiveMsFor(p) {
    var ms = p.baseMs * Math.pow(2, p.backoffLevel);
    return Math.min(ms, MAX_BACKOFF_MS);
  }

  function runPoller(p, t) {
    var seq = (seqCounters[p.name] || 0) + 1;
    seqCounters[p.name] = seq;
    p.seq = seq;
    p.inFlight = true;
    p.lastStartAt = t;
    var result;
    try {
      result = p.fn();
    } catch (err) {
      onPollerFailure(p, err);
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(function () { onPollerSuccess(p, seq); },
                  function (err) { onPollerFailure(p, err, seq); });
    } else {
      onPollerSuccess(p, seq);
    }
  }

  function onPollerSuccess(p, seq) {
    /* A success only counts if no newer run of this poller has started
     * since (a newer run supersedes this one). */
    if (seq !== undefined && seq !== seqCounters[p.name]) {
      p.inFlight = false;
      return;
    }
    p.inFlight = false;
    p.consecutiveFailures = 0;
    p.backoffLevel = 0;
    p.effectiveMs = p.baseMs;
    p.lastSuccessAt = now();
    p.lastErrorAt = null;
    scheduleNext(p);
    if (typeof p.onSuccess === 'function') {
      try { p.onSuccess(p.name); } catch (e) {}
    }
  }

  function onPollerFailure(p, err, seq) {
    if (seq !== undefined && seq !== seqCounters[p.name]) {
      p.inFlight = false;
      return;
    }
    p.inFlight = false;
    p.consecutiveFailures += 1;
    p.lastErrorAt = now();
    /* 3 failures in a row -> double the interval, up to the 30 s cap.
     * Each further consecutive failure doubles again. Success resets. */
    if (p.consecutiveFailures >= BACKOFF_AFTER) {
      p.backoffLevel += 1;
      p.effectiveMs = effectiveMsFor(p);
    }
    scheduleNext(p);
    /* Failures are reported ONLY to this loop's own backoff. This module
     * never flips, sets, or implies any backend up/down state. */
    if (typeof p.onError === 'function') {
      try { p.onError(p.name, err, p.consecutiveFailures); } catch (e) {}
    }
  }

  function scheduleNext(p) {
    p.nextRunAt = now() + jittered(p.effectiveMs, p.jitter);
  }

  /* ---- Public API ----------------------------------------------------- */
  function registerPoller(name, fn, intervalMs, opts) {
    if (!name || typeof fn !== 'function') {
      throw new Error('EnzoPollLoop.registerPoller: name and fn are required');
    }
    opts = opts || {};
    var kind = opts.kind || 'other';
    var baseMs = floorFor(kind, intervalMs);
    var useJitter = opts.jitter !== false;
    var existing = pollers[name];
    pollers[name] = {
      name: name,
      fn: fn,
      kind: kind,
      baseMs: baseMs,
      effectiveMs: baseMs,
      jitter: useJitter,
      active: (typeof opts.active === 'function') ? opts.active : null,
      onError: (typeof opts.onError === 'function') ? opts.onError : null,
      onSuccess: (typeof opts.onSuccess === 'function') ? opts.onSuccess : null,
      inFlight: false,
      consecutiveFailures: 0,
      backoffLevel: 0,
      lastStartAt: null,
      lastSuccessAt: (existing && existing.lastSuccessAt) || null,
      lastErrorAt: (existing && existing.lastErrorAt) || null,
      nextRunAt: now() + jittered(baseMs, useJitter),
      seq: (seqCounters[name] || 0)
    };
    maybeStart();
    return pollers[name].baseMs;
  }

  function unregisterPoller(name) {
    if (pollers[name]) {
      delete pollers[name];
      maybeStop();
      return true;
    }
    return false;
  }

  /* Change a poller's interval at run time (e.g. task paused -> 4000 ms).
   * Floors are still enforced; the kind floor always applies. */
  function setIntervalMs(name, ms) {
    var p = pollers[name];
    if (!p) return false;
    p.baseMs = floorFor(p.kind, ms);
    if (p.backoffLevel === 0) p.effectiveMs = p.baseMs;
    return true;
  }

  function setContext(ctx) {
    if (!ctx) return;
    if (typeof ctx.hasActiveTask === 'boolean') context.hasActiveTask = ctx.hasActiveTask;
    if (typeof ctx.panelVisible === 'boolean') context.panelVisible = ctx.panelVisible;
    if (contextAllowsPolling()) maybeStart();
    else maybeStop();
  }

  function getContext() {
    return { hasActiveTask: context.hasActiveTask, panelVisible: context.panelVisible };
  }

  /* Resume polling on demand (e.g. a task just started, panel just shown). */
  function wake() {
    maybeStart();
    var t = now();
    var names = Object.keys(pollers);
    for (var i = 0; i < names.length; i++) {
      var p = pollers[names[i]];
      if (p.nextRunAt > t + p.effectiveMs) p.nextRunAt = t;
    }
  }

  function start() { maybeStart(); }
  function stop() {
    if (loopTimer !== null) { clearInterval(loopTimer); loopTimer = null; }
  }
  function isRunning() { return loopTimer !== null; }

  /* ---- Sequence / freshness guards (accuracy) ------------------------- */
  /* Issue a fresh sequence token for a fetch a caller is about to make
   * outside a registered run (e.g. the one-off getTask after a task
   * completes). isCurrent() is false once a newer token exists, so a slow
   * response can be recognised as stale and dropped, never rendered. */
  function markRun(name) {
    var seq = (seqCounters[name] || 0) + 1;
    seqCounters[name] = seq;
    if (pollers[name]) pollers[name].seq = seq;
    return seq;
  }

  function isCurrent(name, seq) {
    return seqCounters[name] === seq;
  }

  /* Freshness of a poller's last good data. 'unknown' = never succeeded
   * (nothing verified yet — report that plainly, never guess). 'stale' =
   * last success is older than 2x the effective interval. 'error' = failing
   * repeatedly (3+ consecutive failures) while the last good data is still
   * inside the stale window. Otherwise 'fresh'. */
  function dataStateFor(p, t) {
    if (p.lastSuccessAt === null) return 'unknown';
    var age = t - p.lastSuccessAt;
    if (age > STALE_AFTER_MULT * p.effectiveMs) return 'stale';
    if (p.consecutiveFailures >= BACKOFF_AFTER) return 'error';
    return 'fresh';
  }

  function statusFor(p, t) {
    return {
      name: p.name,
      kind: p.kind,
      baseIntervalMs: p.baseMs,
      effectiveIntervalMs: p.effectiveMs,
      consecutiveFailures: p.consecutiveFailures,
      backoffLevel: p.backoffLevel,
      inFlight: p.inFlight,
      lastStartAt: p.lastStartAt,
      lastSuccessAt: p.lastSuccessAt,
      lastErrorAt: p.lastErrorAt,
      dataState: dataStateFor(p, t),
      dataAgeMs: (p.lastSuccessAt === null) ? null : (t - p.lastSuccessAt)
    };
  }

  function getStatus(name) {
    var t = now();
    if (name) {
      var p = pollers[name];
      return p ? statusFor(p, t) : null;
    }
    var out = { running: isRunning(), context: getContext(), pollers: {} };
    var names = Object.keys(pollers);
    for (var i = 0; i < names.length; i++) out.pollers[names[i]] = statusFor(pollers[names[i]], t);
    return out;
  }

  /* ---- Deduplicated fetch --------------------------------------------- */
  /* If a GET for the same URL is already in flight, the new caller awaits
   * the SAME promise instead of issuing a duplicate fetch — so two pollers
   * asking for the same URL can never double-count or double-issue.
   * The shared entry is deleted the moment the request settles, so a later
   * call ALWAYS fetches fresh data: completed responses are never cached
   * or replayed. Non-GET requests are never deduped. */
  function dedupedFetch(url, opts, fetchFn) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var fn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fn) throw new Error('EnzoPollLoop.dedupedFetch: no fetch available');
    if (method !== 'GET') return fn(url, opts);
    var key = method + ' ' + String(url);
    if (inFlightFetch[key]) return inFlightFetch[key];
    var promise = fn(url, opts);
    inFlightFetch[key] = promise;
    var settle = function (value, isErr) {
      delete inFlightFetch[key];
      lastFetchAt[key] = now();
      if (isErr) throw value;
      return value;
    };
    var shared = promise.then(
      function (v) { return settle(v, false); },
      function (e) { return settle(e, true); }
    );
    inFlightFetch[key] = shared;
    return shared;
  }

  function lastFetchAtFor(url) {
    var key = 'GET ' + String(url);
    return (lastFetchAt[key] === undefined) ? null : lastFetchAt[key];
  }

  function reset() {
    stop();
    pollers = {};
    inFlightFetch = {};
    lastFetchAt = {};
    seqCounters = {};
    context = { hasActiveTask: false, panelVisible: true };
  }

  return {
    VERSION: VERSION,
    TASK_MIN_MS: TASK_MIN_MS,
    IDLE_MIN_MS: IDLE_MIN_MS,
    PANEL_MIN_MS: PANEL_MIN_MS,
    MAX_BACKOFF_MS: MAX_BACKOFF_MS,
    BACKOFF_AFTER: BACKOFF_AFTER,
    registerPoller: registerPoller,
    unregisterPoller: unregisterPoller,
    setIntervalMs: setIntervalMs,
    setContext: setContext,
    getContext: getContext,
    wake: wake,
    start: start,
    stop: stop,
    isRunning: isRunning,
    markRun: markRun,
    isCurrent: isCurrent,
    getStatus: getStatus,
    dedupedFetch: dedupedFetch,
    lastFetchAt: lastFetchAtFor,
    reset: reset
  };
});
/* == END PIECE 44 == */
