
/* == ASSEMBLED PIECE 43 — 43-askpath-retry.js (v62-backend-fix) == */
/* ============================================================================
 * EnzoAskRecovery — piece 43-askpath-retry (ENAO AI / ENZO, live build
 * v61-deep-triggers-4lang)
 *
 * PROBLEM (verified in the live v61 artifact enao-ai.html, 48,870 lines):
 * Raja's screenshot (22 Nov 2026, 6:53 PM PKT) showed TWO failures at once:
 *   (1) "The search service is temporarily unavailable. Please try again
 *       later." + a "Retry Search" button — the fallback search path failed
 *       on its own while the real backend was healthy the whole time.
 *   (2) "Retry Search" just re-ran the question in the SAME mode, and when
 *       v2Up===false the ask wrapper routed straight to the legacy fallback
 *       (line 16722) WITHOUT ever re-probing the backend. Retry could never
 *       rescue a falsely-flagged backend.
 * Root causes: fallbackLegacy() sets v2Up=false unconditionally at entry
 * (line 15955); the ask-gate block sets v2Up=false on ONE failed check
 * (line 16204); the runBackendAsk59() chain catch falls back on ANY single
 * error (lines 16192-16196). One slow ask = permanent fallback until the
 * 60-second recheck (line 16755).
 *
 * STANDING RULE (Raja, 22 Nov 2026 ~6:57 PM PKT — ACCURACY RULE):
 * "ENZO ko accurate banao — chahe jo bhi ho, kisi bhi tarah se ENZO ghalti
 * na kare." For this piece that means: the fallback NEVER silently gives a
 * wrong answer; every fallback answer carries a plain label saying it is
 * fallback, not research; anything that cannot be verified is stated
 * plainly, never guessed and never fabricated. validateFallbackAnswer()
 * enforces this, and the test suite treats a wrong fallback answer, or a
 * fallback presented as research, as FAIL.
 *
 * SERVER EVIDENCE (parent checked the live server): the backend has been
 * running continuously since 5:37 PM, NRestarts=0, every request HTTP 200.
 * The screenshot's "unreachable" was the FRONTEND's fault, not the backend
 * stopping. This piece therefore treats "backend down" as a claim that must
 * be re-proven with fresh multi-attempt checks before any fallback runs.
 *
 * WHAT THIS MODULE DOES (and does NOT do):
 *  - probeBackend(): fresh multi-attempt health check FIRST, before any
 *    fallback decision. Prefers window.EnzoBackendHealth (piece 42) when
 *    present — its checkHealth() ALREADY probes with multiple attempts
 *    internally (maxAttempts 3, delays [1500, 2500] by default), so it
 *    is called ONCE and its verdict is used as-is; the caller's
 *    attempts/delays only override piece 42's defaults when explicitly
 *    given. Else window.EnzoPagesBackend.checkBackendReachable retried
 *    3x with backoff. Never throws; always resolves a verdict object.
 *  - retryAsk(): the new Retry Search behaviour — re-probe first; on
 *    reachable run the REAL backend ask path, never legacy; only on
 *    sustained unreachable fall back, with the honest one-line notice
 *    attached and background re-probing armed.
 *  - guardedAsk(): wraps one backend attempt so a SINGLE failed request
 *    (timeout, network error, one 500) NEVER flips the app into fallback
 *    mode — it re-probes with backoff first; fallback only after the
 *    multi-attempt check fails.
 *  - fallbackNotice() / applyFallbackLabel(): the honest fallback label
 *    (en / roman / urdu). A fallback answer must NEVER be presented as a
 *    researched answer.
 *  - validateFallbackAnswer(): accuracy guard — wrong fallback answer =
 *    FAIL, fallback called research = FAIL.
 *  - Does NOT touch voice/language code (no voice-speak call sites
 *    anywhere in this file). Does NOT change the P-F backend ask itself,
 *    only its error / retry routing. Does NOT own backend state — state
 *    lives in piece 42 (EnzoBackendHealth): its checkHealth() verdict
 *    already drives the shared state, so this module only reports
 *    verdicts; the injected setUp(up, probe) hook is a seam for
 *    environments without piece 42 and is wired as a no-op when
 *    piece 42 is present (see WIRING-43.md).
 *
 * STYLE: UMD / IIFE, ES5, no dependencies, no emoji.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EnzoAskRecovery = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '43-askpath-retry-v1';

  /* Backoff between probe attempts: attempt 1 fails -> wait 400ms ->
     attempt 2 fails -> wait 1200ms -> attempt 3. Total worst case ~1.6s
     plus the checks themselves. Deliberately short: a retry must feel
     instant, and the checks are single /health GETs. */
  var DEFAULT_DELAYS_MS = [400, 1200];
  var DEFAULT_ATTEMPTS = 3;
  var DEFAULT_BG_INTERVAL_MS = 30000;

  /* ------------------------------------------------------------------ */
  /* Honest fallback label — one plain line, user's language aware,      */
  /* same three languages as ERR_TXT (enao-ai.html line ~15932).          */
  /* It says all three facts in one line: backend could not be reached,  */
  /* this answer is fallback search only (NOT live research), and real    */
  /* research resumes automatically on recovery. No scary banner, no     */
  /* "temporarily unavailable" wording, no fake research label.           */
  /* ------------------------------------------------------------------ */
  var FALLBACK_NOTICE = {
    en: 'The platform backend could not be reached, so this answer uses the built-in fallback search only — not live research — and it will keep retrying in the background; real research resumes automatically as soon as the backend is reachable again.',
    roman: 'Platform backend se rabta nahi ho saka, is liye ye jawab sirf built-in fallback search se hai — live research nahi — aur ye background mein dobara koshish karta rahega; backend wapas milte hi asal research khud ba khud dobara shuru ho jayegi.',
    urdu: 'پلیٹ فارم بیک اینڈ سے رابطہ نہیں ہو سکا، اس لیے یہ جواب صرف بلٹ ان فال بیک سرچ سے ہے — لائیو ریسرچ نہیں — اور یہ پس منظر میں دوبارہ کوشش کرتا رہے گا؛ بیک اینڈ واپس ملتے ہی اصل ریسرچ خود بخود دوبارہ شروع ہو جائے گی۔'
  };

  /* Short modeWhy suffix for a fallback message. The live artifact
     already uses this honest wording at line ~16024; keep it identical
     so old and new fallback messages read the same. */
  var FALLBACK_MODE_WHY = 'fallback search (platform backend unreachable)';

  function normLang(lang) {
    if (lang === 'urdu' || lang === 'roman') return lang;
    return 'en';
  }

  function fallbackNotice(lang) {
    return FALLBACK_NOTICE[normLang(lang)];
  }

  function fallbackModeWhy(routeLabel) {
    var label = (routeLabel && String(routeLabel)) || 'Answer';
    return label + ' — ' + FALLBACK_MODE_WHY;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* One plain line as HTML for the assembler to prepend to a fallback
     answer. A plain <p>, deliberately NOT the notice-warn banner that
     the screenshot showed. */
  function fallbackNoticeHtml(lang) {
    return '<p class="fallback-note">' + escapeHtml(fallbackNotice(lang)) + '</p>';
  }

  function defaultSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /* Normalise whatever a health check returns into a boolean verdict.
     Accepts: true/false, {reachable:true/false}, {ok:true/false},
     {status:'ok'}, or a thrown / undefined result (unreachable). */
  function verdictOf(result) {
    if (result === true) return true;
    if (result === false || result == null) return false;
    if (typeof result === 'object') {
      if (typeof result.reachable === 'boolean') return result.reachable;
      if (typeof result.ok === 'boolean') return result.ok;
      if (typeof result.status === 'string') return result.status === 'ok';
    }
    return false;
  }

  function reasonOf(result) {
    if (isPlainObject(result) && typeof result.reason === 'string' && result.reason) return result.reason;
    if (isPlainObject(result) && typeof result.status === 'string' && result.status) return result.status;
    return '';
  }

  /* Find a callable single-check function, in priority order:
     1. opts.check — explicit function injected by the caller / tests.
     2. opts.health (window.EnzoBackendHealth, piece 42) — try its
        known method names in order; first one that is a function wins.
        NOTE: piece 42's real entry point is checkHealth(), which is
        handled separately in probeBackend (it already retries
        internally, so it must be called ONCE, not wrapped in this
        module's retry loop). The names below are the fallback for
        health-like objects without checkHealth.
     3. opts.pagesBackend (window.EnzoPagesBackend) — its
        checkBackendReachable, which the live artifact inlines at
        lines ~250-330 and which returns {reachable, status, ...}.
     Returns null when no check mechanism exists at all. */
  function resolveSingleCheck(opts) {
    var health = opts.health;
    var pages = opts.pagesBackend;
    var names, i, fn;
    if (typeof opts.check === 'function') {
      return function () { return opts.check(opts.timeoutMs); };
    }
    if (health && typeof health === 'object') {
      names = ['check', 'probe', 'checkBackendReachable', 'isReachable', 'health'];
      for (i = 0; i < names.length; i++) {
        fn = health[names[i]];
        if (typeof fn === 'function') {
          return (function (f) {
            return function () { return f.call(health, opts.timeoutMs); };
          })(fn);
        }
      }
    }
    if (pages && typeof pages.checkBackendReachable === 'function') {
      return function () {
        var arg = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
          ? { timeoutMs: opts.timeoutMs } : undefined;
        return pages.checkBackendReachable(arg);
      };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* probeBackend(opts) — the one fact this whole piece stands on.       */
  /* Runs a FRESH multi-attempt health check and resolves (never         */
  /* rejects) {reachable, attempts, lastCheck, lastReason}.              */
  /* opts: {check|health|pagesBackend, attempts=3, delays=[400,1200],    */
  /*        sleep (fn ms->Promise, default setTimeout), timeoutMs}.      */
  /* A single failed attempt proves NOTHING — only all attempts failing   */
  /* proves unreachable. When no check mechanism exists at all,          */
  /* attempts is 0 and reachable is false with reason                    */
  /* 'no-health-check-available'; callers treat that as UNKNOWN and try  */
  /* the real backend ask once (see retryAsk / guardedAsk), because      */
  /* silently falling back with no evidence would be the exact bug       */
  /* this piece fixes.                                                   */
  /* ------------------------------------------------------------------ */
  function probeBackend(opts) {
    opts = opts || {};
    var attempts = (typeof opts.attempts === 'number' && opts.attempts > 0)
      ? Math.floor(opts.attempts) : DEFAULT_ATTEMPTS;
    var delays = Array.isArray(opts.delays) && opts.delays.length
      ? opts.delays : DEFAULT_DELAYS_MS;
    var sleep = (typeof opts.sleep === 'function') ? opts.sleep : defaultSleep;

    /* Piece 42 fast path: EnzoBackendHealth.checkHealth() ALREADY runs
       a full multi-attempt probe internally (maxAttempts 3, retryDelays
       [1500, 2500], timeout 6000ms by default) and drives the shared
       backend state from its verdict. Calling it once IS the
       multi-attempt check — wrapping it in this module's retry loop
       would run up to 9 checks for one verdict. resetFailure() first
       clears any cached failure (piece 42 documents it as the Retry
       Search seam: it moves state to 'unknown', never claims 'up').
       The caller's attempts/delays only override piece 42's defaults
       when explicitly given; otherwise piece 42's tuning stands. */
    var health = opts.health;
    if (health && typeof health.checkHealth === 'function') {
      if (typeof health.resetFailure === 'function') {
        try { health.resetFailure(); } catch (e) {}
      }
      var co = {};
      if (typeof opts.attempts === 'number' && opts.attempts > 0) co.maxAttempts = Math.floor(opts.attempts);
      if (Array.isArray(opts.delays) && opts.delays.length) co.retryDelays = opts.delays;
      if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) co.timeoutMs = opts.timeoutMs;
      var p42;
      try {
        p42 = Promise.resolve(health.checkHealth(co));
      } catch (e) {
        p42 = Promise.resolve(null);
      }
      return p42.then(function (result) {
        var ok = verdictOf(result);
        var n = (result && typeof result.attempts === 'number' && result.attempts > 0) ? result.attempts : 1;
        var why = '';
        if (!ok && result && typeof result === 'object') {
          why = result.lastReason || result.reason || result.lastStatus || result.status || 'unreachable';
        }
        return { reachable: ok, attempts: n, lastCheck: result, lastReason: ok ? '' : String(why) };
      }, function () {
        return { reachable: false, attempts: 1, lastCheck: null, lastReason: 'checkHealth-threw' };
      });
    }

    var single = resolveSingleCheck(opts);
    if (!single) {
      return Promise.resolve({
        reachable: false, attempts: 0, lastCheck: null,
        lastReason: 'no-health-check-available'
      });
    }
    var tried = 0;
    var lastCheck = null;
    var lastReason = '';
    function oneAttempt() {
      tried++;
      var p;
      try {
        p = Promise.resolve(single());
      } catch (e) {
        p = Promise.resolve(null);
      }
      return p.then(function (result) {
        lastCheck = result;
        if (verdictOf(result)) {
          return { reachable: true, attempts: tried, lastCheck: lastCheck, lastReason: '' };
        }
        lastReason = reasonOf(result) || 'unreachable';
        if (tried >= attempts) {
          return { reachable: false, attempts: tried, lastCheck: lastCheck, lastReason: lastReason };
        }
        var wait = delays[Math.min(tried - 1, delays.length - 1)];
        return sleep(wait).then(oneAttempt);
      }, function () {
        /* A throwing check is one failed attempt, never a crash. */
        lastCheck = null;
        lastReason = 'check-threw';
        if (tried >= attempts) {
          return { reachable: false, attempts: tried, lastCheck: null, lastReason: lastReason };
        }
        var wait2 = delays[Math.min(tried - 1, delays.length - 1)];
        return sleep(wait2).then(oneAttempt);
      });
    }
    return oneAttempt();
  }

  /* ------------------------------------------------------------------ */
  /* armBackgroundRecovery(opts) — "it will keep retrying in the         */
  /* background". Re-probes on an interval until the backend answers,    */
  /* then stops itself and calls onRecovered. Returns {stop, ticks}.     */
  /* opts: {probe (probeBackend opts), intervalMs=30000, intervalFn,     */
  /*        clearIntervalFn, onRecovered, setUp}. The interval only ever  */
  /* runs ONE single check per tick (attempts: 1) so it never hammers    */
  /* the backend; the full 3-attempt probe is for on-demand decisions.   */
  /* ------------------------------------------------------------------ */
  function armBackgroundRecovery(opts) {
    opts = opts || {};
    var intervalMs = (typeof opts.intervalMs === 'number' && opts.intervalMs > 0)
      ? opts.intervalMs : DEFAULT_BG_INTERVAL_MS;
    var setInt = (typeof opts.intervalFn === 'function') ? opts.intervalFn : setInterval;
    var clearInt = (typeof opts.clearIntervalFn === 'function') ? opts.clearIntervalFn : clearInterval;
    var ticks = 0;
    var stopped = false;
    var handle = null;
    function stop() {
      if (stopped) return;
      stopped = true;
      if (handle != null) { try { clearInt(handle); } catch (e) {} handle = null; }
    }
    function tick() {
      if (stopped) return null;
      ticks++;
      var probeOpts = {};
      var k;
      for (k in opts.probe || {}) { if (Object.prototype.hasOwnProperty.call(opts.probe, k)) probeOpts[k] = opts.probe[k]; }
      probeOpts.attempts = 1;
      return probeBackend(probeOpts).then(function (probe) {
        if (stopped) return;
        if (probe.reachable) {
          stop();
          if (typeof opts.setUp === 'function') { try { opts.setUp(true, probe); } catch (e) {} }
          if (typeof opts.onRecovered === 'function') { try { opts.onRecovered(probe); } catch (e) {} }
        }
      });
    }
    handle = setInt(tick, intervalMs);
    return { stop: stop, ticks: function () { return ticks; } };
  }

  /* ------------------------------------------------------------------ */
  /* retryAsk(question, opts) — the NEW Retry Search behaviour.          */
  /*   (a) Force a FRESH multi-attempt backend health check FIRST. The   */
  /*       cached v2Up flag and backendGate59.ok are NEVER trusted here. */
  /*   (b) Reachable -> run the REAL backend ask path (opts.runBackend,  */
  /*       wired by the assembler to the P-F runBackendAsk59 route),     */
  /*       never the legacy fallback.                                    */
  /*   (c) Sustained unreachable (all attempts fail) -> opts.runFallback */
  /*       only, with the honest one-line notice attached; background    */
  /*       re-probing is armed so real research resumes on recovery.     */
  /*   (d) No health-check mechanism at all (probe.attempts === 0) ->    */
  /*       UNKNOWN, not down: attempt the real backend ask once. A       */
  /*       failed ask is then handled by guardedAsk; silently falling    */
  /*       back with zero evidence would repeat the screenshot bug.      */
  /* Resolves {path:'backend'|'fallback'|'error', probe, notice?, ...}.  */
  /* Never rejects for ask/health outcomes. opts.runBackend /            */
  /* opts.runFallback are injected by the assembler (see WIRING-43.md);  */
  /* when a hook is missing the outcome still reports the honest path.   */
  /* ------------------------------------------------------------------ */
  function retryAsk(question, opts) {
    opts = opts || {};
    var q = (question == null) ? '' : String(question);
    if (!q.trim()) {
      return Promise.resolve({ path: 'error', reason: 'empty-question', probe: null, notice: null });
    }
    var lang = normLang(opts.lang);
    var probeOpts = opts.probe || {};
    if (!probeOpts.health && typeof window !== 'undefined' && window.EnzoBackendHealth) probeOpts.health = window.EnzoBackendHealth;
    if (!probeOpts.pagesBackend && typeof window !== 'undefined' && window.EnzoPagesBackend) probeOpts.pagesBackend = window.EnzoPagesBackend;
    if (typeof opts.sleep === 'function') probeOpts.sleep = opts.sleep;
    if (typeof opts.attempts === 'number') probeOpts.attempts = opts.attempts;
    if (Array.isArray(opts.delays)) probeOpts.delays = opts.delays;
    if (typeof opts.check === 'function') probeOpts.check = opts.check;
    return probeBackend(probeOpts).then(function (probe) {
      var unknown = (probe.attempts === 0);
      if (probe.reachable || unknown) {
        if (typeof opts.setUp === 'function') { try { opts.setUp(true, probe); } catch (e) {} }
        if (typeof opts.runBackend === 'function') {
          var out;
          try {
            out = opts.runBackend(q, { deep: !!opts.deep, viaVoice: !!opts.viaVoice, lang: lang, recovered: true, probe: probe, unknownProbe: unknown });
          } catch (e) {
            return { path: 'backend', probe: probe, notice: null, runError: String(e && e.message || e) };
          }
          return Promise.resolve(out).then(function () {
            return { path: 'backend', probe: probe, notice: null, unknownProbe: unknown };
          });
        }
        return { path: 'backend', probe: probe, notice: null, unknownProbe: unknown, runBackendMissing: true };
      }
      /* Sustained unreachable: fallback, honestly labelled. */
      var notice = fallbackNotice(lang);
      if (typeof opts.setUp === 'function') { try { opts.setUp(false, probe); } catch (e) {} }
      var bg = null;
      if (opts.armBackground !== false) {
        bg = armBackgroundRecovery({
          probe: probeOpts,
          intervalMs: opts.bgIntervalMs,
          intervalFn: opts.intervalFn,
          clearIntervalFn: opts.clearIntervalFn,
          setUp: opts.setUp,
          onRecovered: opts.onRecovered
        });
      }
      if (typeof opts.runFallback === 'function') {
        var fbOut;
        try {
          fbOut = opts.runFallback(q, { deep: !!opts.deep, viaVoice: !!opts.viaVoice, lang: lang, notice: notice, probe: probe, backgroundRecovery: bg });
        } catch (e) {
          return { path: 'fallback', probe: probe, notice: notice, backgroundRecovery: bg, runError: String(e && e.message || e) };
        }
        return Promise.resolve(fbOut).then(function () {
          return { path: 'fallback', probe: probe, notice: notice, backgroundRecovery: bg };
        });
      }
      return { path: 'fallback', probe: probe, notice: notice, backgroundRecovery: bg, runFallbackMissing: true };
    });
  }

  /* ------------------------------------------------------------------ */
  /* guardedAsk(ctx, opts) — wrap the existing ask entry so ONE failed   */
  /* request NEVER flips the app into fallback mode.                     */
  /*   attempt(ctx)        — one backend attempt; the assembler passes   */
  /*                         runBackendAsk59 (safe to re-run:             */
  /*                         ensureBackendChat is cached and              */
  /*                         uploadChatFiles skips already-uploaded       */
  /*                         files — enao-ai.html lines 15759-15790).    */
  /*   runFallback(ctx)    — fallbackLegacy, called ONLY after the       */
  /*                         multi-attempt probe fails. The ctx it gets  */
  /*                         carries ctx.fallbackNotice (one plain line, */
  /*                         ctx.lang) and ctx.fallback = true.          */
  /*   setUp(up, probe)    — piece-42 state hook; NEVER called with     */
  /*                         false on a single failure. Only after the   */
  /*                         sustained probe failure.                    */
  /*   maxBackendAttempts  — backend tries total (default 2: the first   */
  /*                         failure + one retry after a good re-probe). */
  /* Resolves {path:'backend'|'fallback', recovered, attempts, probe,    */
  /* notice?}. Never rejects for ask/health outcomes.                    */
  /* ------------------------------------------------------------------ */
  function guardedAsk(ctx, opts) {
    opts = opts || {};
    var maxBackendAttempts = (typeof opts.maxBackendAttempts === 'number' && opts.maxBackendAttempts > 0)
      ? Math.floor(opts.maxBackendAttempts) : 2;
    var probeOpts = opts.probe || {};
    if (!probeOpts.health && typeof window !== 'undefined' && window.EnzoBackendHealth) probeOpts.health = window.EnzoBackendHealth;
    if (!probeOpts.pagesBackend && typeof window !== 'undefined' && window.EnzoPagesBackend) probeOpts.pagesBackend = window.EnzoPagesBackend;
    if (typeof opts.sleep === 'function') probeOpts.sleep = opts.sleep;
    if (typeof opts.check === 'function') probeOpts.check = opts.check;
    var lang = normLang(ctx && ctx.lang);
    var backendTries = 0;
    var lastProbe = null;

    function doFallback(reason) {
      var notice = fallbackNotice(lang);
      if (ctx && typeof ctx === 'object') {
        ctx.fallback = true;
        ctx.fallbackNotice = notice;
        ctx.fallbackModeWhy = fallbackModeWhy(ctx.route && ctx.route.label);
      }
      /* State flips to down ONLY when the probe proved sustained
         unreachable. When the backend is up but the ask itself keeps
         failing ('backend-attempt-failed-after-retry'), the fallback
         covers this one question only — flipping global state would be
         the exact false-flag bug this piece fixes. */
      if (reason === 'backend-unreachable' && typeof opts.setUp === 'function') { try { opts.setUp(false, lastProbe); } catch (e) {} }
      if (typeof opts.runFallback === 'function') {
        var fb;
        try { fb = opts.runFallback(ctx); } catch (e) {
          return Promise.resolve({ path: 'fallback', recovered: false, attempts: backendTries, probe: lastProbe, notice: notice, reason: reason, runError: String(e && e.message || e) });
        }
        return Promise.resolve(fb).then(function () {
          return { path: 'fallback', recovered: false, attempts: backendTries, probe: lastProbe, notice: notice, reason: reason };
        });
      }
      return Promise.resolve({ path: 'fallback', recovered: false, attempts: backendTries, probe: lastProbe, notice: notice, reason: reason, runFallbackMissing: true });
    }

    function attemptOnce() {
      backendTries++;
      var p;
      try {
        p = Promise.resolve(opts.attempt(ctx));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(function (value) {
        return { path: 'backend', recovered: backendTries > 1, attempts: backendTries, probe: lastProbe, notice: null, value: value };
      }, function () {
        /* ONE failure: do NOT fall back and do NOT re-probe when no retry
           is left. Re-probe only when a retry is still available: the
           probe verdict decides retry-vs-fallback, and a probe that just
           said "reachable" is not re-run after the retry fails. */
        if (backendTries >= maxBackendAttempts) return doFallback('backend-attempt-failed-after-retry');
        return probeBackend(probeOpts).then(function (probe) {
          lastProbe = probe;
          var unknown = (probe.attempts === 0);
          if (probe.reachable || unknown) {
            /* Backend is up (or no probe exists to say otherwise): the
               failure was this one request, not the backend. Retry the
               backend ask once instead of flipping to fallback. */
            return attemptOnce();
          }
          /* Sustained unreachable across all probe attempts: only now
             is the fallback honest. */
          return doFallback('backend-unreachable');
        });
      });
    }

    if (typeof opts.attempt !== 'function') {
      return Promise.resolve({ path: 'error', reason: 'missing-attempt', recovered: false, attempts: 0, probe: null, notice: null });
    }
    return attemptOnce();
  }

  /* ------------------------------------------------------------------ */
  /* ACCURACY GUARD — the standing rule, enforced in code.               */
  /* validateFallbackAnswer(answer) returns {ok, failures[]}.            */
  /* answer: {plain|text|html, sources:[{...}], modeWhy, lang}.          */
  /*   FAIL if: modeWhy does not say "fallback"; the visible text claims */
  /*   research / verified sources / a researched count; the answer has  */
  /*   zero real sources and no fallback notice (an unverified guess);   */
  /*   citation markers [1] appear with zero sources; the text carries   */
  /*   an emoji. A fallback answer that passes is one that (a) is        */
  /*   labelled fallback in modeWhy AND in its visible text, (b) only    */
  /*   cites sources it actually fetched, and (c) says plainly when     */
  /*   nothing could be verified.                                        */
  /* ------------------------------------------------------------------ */
  var RESEARCH_CLAIM_PATTERNS = [
    /live research/i,
    /\bresearched\b/i,
    /\bresearching\b/i,
    /verified sources/i,
    /sources confirm/i,
    /according to (live )?research/i,
    /\b100 websites\b/i,
    /\b\d+\s+(websites|sources)\s+(researched|checked|verified|searched)\b/i
  ];

  function stripHonestPhrases(text, lang) {
    var t = String(text || '');
    var langs = ['en', 'roman', 'urdu'];
    var i;
    for (i = 0; i < langs.length; i++) {
      var n = FALLBACK_NOTICE[langs[i]];
      if (n && t.indexOf(n) !== -1) t = t.split(n).join(' ');
    }
    /* The notice's own forward-looking sentence is honest, not a claim
       that research already happened. Honest denials ("not live
       research", "live research nahi") are denials, not claims. */
    t = t.replace(/real research resumes? automatically[^.]*/gi, ' ');
    t = t.replace(/not (a )?live research[^.]*/gi, ' ');
    t = t.replace(/live research nahi[^.]*/gi, ' ');
    t = t.replace(/لائیو ریسرچ نہیں/gi, ' ');
    t = t.replace(/no research was run/gi, ' ');
    t = t.replace(/fallback search only/gi, ' ');
    t = t.replace(/built-in fallback search/gi, ' ');
    return t;
  }

  function findResearchClaim(text) {
    var i;
    for (i = 0; i < RESEARCH_CLAIM_PATTERNS.length; i++) {
      var m = RESEARCH_CLAIM_PATTERNS[i].exec(text);
      if (m) return m[0];
    }
    return null;
  }

  function hasEmoji(text) {
    var s = String(text || '');
    var i, code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) return true; /* surrogate pair = emoji / pictograph */
      if (code >= 0x2600 && code <= 0x27BF) return true; /* misc symbols / dingbats */
      if (code >= 0x2B00 && code <= 0x2BFF) return true;
      if (code >= 0x1F000 && code <= 0x1FAFF) return true;
    }
    return false;
  }

  function visibleTextOf(answer) {
    if (!answer || typeof answer !== 'object') return '';
    var t = answer.plain || answer.text || '';
    if (!t && answer.html) t = String(answer.html).replace(/<[^>]*>/g, ' ');
    return String(t || '');
  }

  function validateFallbackAnswer(answer, opts) {
    opts = opts || {};
    var failures = [];
    var lang = normLang(answer && answer.lang);
    var text = visibleTextOf(answer);
    var modeWhy = (answer && answer.modeWhy) || '';
    var sources = (answer && Array.isArray(answer.sources)) ? answer.sources : [];
    var usableSources = sources.filter(function (s) {
      return s && ((s.extract || s.snippet || '').trim().length > 25 || s.final_url || s.url);
    });

    /* 1. The mode must say fallback — never research. */
    if (!/fallback/i.test(modeWhy)) {
      failures.push('modeWhy-must-say-fallback');
    }
    if (/live research/i.test(modeWhy) && !/fallback/i.test(modeWhy)) {
      failures.push('modeWhy-claims-live-research');
    }

    /* 2. The visible text must label the fallback too, not only modeWhy. */
    if (!/fallback/i.test(text)) {
      failures.push('fallback-not-labelled-in-text');
    }

    /* 3. No research claims in the answer body (notice text excluded). */
    var body = stripHonestPhrases(text, lang);
    var claim = findResearchClaim(body);
    if (claim) {
      failures.push('fallback-claims-research: ' + claim);
    }

    /* 4. Zero usable sources + substantive answer body = an unverified
          guess presented as an answer. Merely whispering the word
          "fallback" once does not excuse it: after the notice, the
          fallback label itself, and any honest "could not verify / could
          not find" line are stripped, nothing claim-like may remain.
          The honest outcome with zero sources is the notice, or an
          explicit "could not verify" line — never bare claims. */
    var notice = FALLBACK_NOTICE[lang];
    var hasNotice = text.indexOf(notice) !== -1 || /fallback/i.test(text);
    if (usableSources.length === 0 && text.trim().length > 0 && !hasNotice) {
      failures.push('unverified-answer-without-label');
    }
    var unlabelled = body.replace(/fallback/gi, ' ')
      .replace(/\b\w+\s+could not (verify|find)\b[^.!?]*[.!?]?/gi, ' ')
      .replace(/\b\w+\s+couldn.?t (verify|find)\b[^.!?]*[.!?]?/gi, ' ')
      .replace(/no usable (results|sources|pages)[^.!?]*[.!?]?/gi, ' ')
      .replace(/not verified[^.!?]*[.!?]?/gi, ' ')
      .replace(/^[.,;:!?\s]+/, '').replace(/[.,;:!?\s]+$/, '');
    if (usableSources.length === 0 && unlabelled.length > 0) {
      failures.push('unverified-claims-without-sources');
    }
    if (usableSources.length === 0 && /\[\d+\]/.test(body)) {
      failures.push('citations-without-sources');
    }

    /* 5. A claimed researched count must never exceed fetched sources. */
    var countMatch = /(\d+)\s+(websites|sources)\s+(researched|checked|verified|searched)/i.exec(body);
    if (countMatch && parseInt(countMatch[1], 10) > usableSources.length) {
      failures.push('fabricated-count: claims ' + countMatch[1] + ' but fetched ' + usableSources.length);
    }

    /* 6. No emoji in fallback output. */
    if (hasEmoji(text) || hasEmoji(modeWhy)) {
      failures.push('emoji-in-fallback');
    }

    return { ok: failures.length === 0, failures: failures };
  }

  function isResearchClaim(text) {
    return findResearchClaim(stripHonestPhrases(text, 'en'));
  }

  /* Attach the honest label to a message object about to be delivered
     from the fallback path. Sets modeWhy to the fallback wording,
     marks fallback=true / researched=false, and prepends the one-line
     notice to plain and html when it is not already there. Idempotent:
     calling it twice does not duplicate the notice. */
  function applyFallbackLabel(msg, lang) {
    if (!msg || typeof msg !== 'object') return msg;
    var l = normLang(lang || msg.lang);
    var notice = fallbackNotice(l);
    msg.fallback = true;
    msg.researched = false;
    msg.modeWhy = fallbackModeWhy(msg.modeWhy && !/fallback/i.test(msg.modeWhy)
      ? msg.modeWhy.replace(/\s*[—–-]\s*.*$/, '')
      : undefined);
    if (typeof msg.plain === 'string') {
      if (msg.plain.indexOf(notice) === -1) msg.plain = notice + '\n\n' + msg.plain;
    }
    if (typeof msg.html === 'string') {
      if (msg.html.indexOf(notice) === -1) msg.html = fallbackNoticeHtml(l) + msg.html;
    }
    if (typeof msg._fullHtml === 'string') {
      if (msg._fullHtml.indexOf(notice) === -1) msg._fullHtml = fallbackNoticeHtml(l) + msg._fullHtml;
    }
    return msg;
  }

  function describeProbe(probe) {
    if (!probe) return 'Backend not checked yet.';
    if (probe.attempts === 0) return 'Backend check unavailable — no health-check mechanism present; the real ask will be tried once.';
    if (probe.reachable) return 'Backend reachable (' + probe.attempts + ' attempt' + (probe.attempts > 1 ? 's' : '') + ').';
    return 'Backend unreachable after ' + probe.attempts + ' attempts' +
      (probe.lastReason ? ' (' + probe.lastReason + ')' : '') + '.';
  }

  return {
    VERSION: VERSION,
    DEFAULT_ATTEMPTS: DEFAULT_ATTEMPTS,
    DEFAULT_DELAYS_MS: DEFAULT_DELAYS_MS.slice(),
    DEFAULT_BG_INTERVAL_MS: DEFAULT_BG_INTERVAL_MS,
    probeBackend: probeBackend,
    retryAsk: retryAsk,
    guardedAsk: guardedAsk,
    armBackgroundRecovery: armBackgroundRecovery,
    fallbackNotice: fallbackNotice,
    fallbackNoticeHtml: fallbackNoticeHtml,
    fallbackModeWhy: fallbackModeWhy,
    applyFallbackLabel: applyFallbackLabel,
    validateFallbackAnswer: validateFallbackAnswer,
    isResearchClaim: isResearchClaim,
    describeProbe: describeProbe
  };
});
/* == END PIECE 43 == */
