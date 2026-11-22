
/* == ASSEMBLED PIECE 42 — 42-reachability-core.js (v62-backend-fix) == */
/* ================= 42-reachability-core =================
   Single source of truth for backend reachability (piece 42).
   Live v61 defect it fixes: v2health() did ONE fetch with a 6s timeout
   and on ANY failure set v2Up=false + showed "Platform backend
   unreachable", and two more call sites did the same unconditionally.
   One transient blip (slow network, pool saturation from polling) put
   the UI into a stuck fallback state even while the backend was healthy.

   ACCURACY RULE (Raja, 22 Nov 2026 ~6:57 PM PKT): the status shown must
   always match the real backend state. This module therefore:
     - NEVER declares the backend down on fewer than 3 failed attempts
       (attempts at ~0s, ~1.5s, ~4s, each with its own ~6s timeout).
     - NEVER declares the backend up without a probe that actually
       succeeded (HTTP 2xx AND a healthy body, per checkBackendReachable).
       A 2xx with a bad/unreadable body, an HTTP error, a timeout and a
       network failure are all failures, never "up".
     - NEVER claims "up" from a cleared cache: resetFailure() moves the
       state to 'unknown', not 'up'; only a fresh successful probe can
       set 'up' again.
     - NEVER shows a stale verdict as current: while a probe sequence is
       running the status is 'checking' (not the old 'up'/'down'), and
       getState()/isStale() expose lastCheckAt so a caller can tell a
       stale reading from a fresh one.
     - onChange fires ONLY on a real settled-status change (up<->down,
       plus the very first 'down', since the banner starts hidden and
       the first 'up' changes nothing visible); never on every probe,
       never twice for the same status, never for 'checking'.

   ES5 style (var, function declarations), no dependencies, no emoji.
   Reuses window.EnzoPagesBackend.getBackendBase() when present (else
   '/api/v2') and calls its checkBackendReachable() once per attempt.
   The piece-33 API (checkBackendReachable, shouldBlockAsk,
   describeCheck) is NOT changed. Guarded against double instantiation.
   ================================================================ */
(function (root, factory) {
  var g = (typeof window !== 'undefined') ? window
    : (typeof global !== 'undefined') ? global : this;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(g);
  } else {
    root.EnzoBackendHealth = factory(g);
  }
})(this, function (root) {
  'use strict';

  /* Double-instantiation guard: a second <script> include returns the
     existing instance instead of building a second state machine. */
  if (root.__enzoBackendHealth) return root.__enzoBackendHealth;

  var DEFAULT_TIMEOUT_MS = 6000;      /* per-attempt timeout, as v2health used */
  var DEFAULT_RETRY_DELAYS = [1500, 2500]; /* attempt 2 at ~1.5s, attempt 3 at ~4s */
  var DEFAULT_MAX_ATTEMPTS = 3;
  var DEFAULT_DOWN_INTERVAL_MS = 15000; /* re-probe while down */
  var DEFAULT_UP_INTERVAL_MS = 60000;   /* light re-probe while up */
  var DEFAULT_STALE_AFTER_MS = 120000;  /* a verdict older than this is stale */

  function nowMs() { return Date.now(); }
  function isoNow() { return new Date().toISOString(); }
  function isFn(f) { return typeof f === 'function'; }

  function createInstance(opts) {
    opts = opts || {};
    var timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
      ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    var retryDelays = (opts.retryDelays instanceof Array && opts.retryDelays.length)
      ? opts.retryDelays : DEFAULT_RETRY_DELAYS;
    var maxAttempts = (typeof opts.maxAttempts === 'number' && opts.maxAttempts > 0)
      ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS;
    var downIntervalMs = (typeof opts.downIntervalMs === 'number' && opts.downIntervalMs > 0)
      ? opts.downIntervalMs : DEFAULT_DOWN_INTERVAL_MS;
    var upIntervalMs = (typeof opts.upIntervalMs === 'number' && opts.upIntervalMs > 0)
      ? opts.upIntervalMs : DEFAULT_UP_INTERVAL_MS;
    var staleAfterMs = (typeof opts.staleAfterMs === 'number' && opts.staleAfterMs > 0)
      ? opts.staleAfterMs : DEFAULT_STALE_AFTER_MS;
    var fetchFnOpt = isFn(opts.fetchFn) ? opts.fetchFn : null;
    var hostnameOpt = (typeof opts.hostname === 'string') ? opts.hostname : undefined;
    var setTimeoutFn = isFn(opts.setTimeoutFn) ? opts.setTimeoutFn : setTimeout;
    var clearTimeoutFn = isFn(opts.clearTimeoutFn) ? opts.clearTimeoutFn : clearTimeout;
    var nowFn = isFn(opts.nowFn) ? opts.nowFn : nowMs;

    /* ---- state (the single source of truth) ---- */
    var status = 'unknown';           /* 'unknown'|'up'|'down'|'checking' */
    var lastSettled = null;           /* last settled ('up'/'down') verdict; survives 'unknown'/'checking' so a flip after resetFailure still notifies */
    var lastOkAt = null;              /* ms epoch of last successful probe */
    var lastFailAt = null;            /* ms epoch of last failed verdict */
    var lastCheckAt = null;           /* ms epoch of last completed verdict */
    var lastReason = '';
    var lastStatus = '';
    var lastProbe = null;             /* last single-attempt result {reachable, status, reason, httpStatus, base} -- used to build the honest unavailable notice */
    var consecutiveFailures = 0;      /* failed attempts since last success */
    var totalAttempts = 0;            /* probe attempts made, all time */
    var listeners = [];
    var inflight = null;              /* in-flight checkHealth promise */
    var timer = null;                 /* background-loop timer */
    var loopRunning = false;

    function getBackendBase() {
      try {
        if (root.EnzoPagesBackend && isFn(root.EnzoPagesBackend.getBackendBase)) {
          return root.EnzoPagesBackend.getBackendBase();
        }
      } catch (e) {}
      return '/api/v2';
    }

    /* Set a settled status ('up'/'down') and notify ONLY on a real change
       of settled status. Transitions to/from 'checking'/'unknown' never
       notify: the UI must not flicker on a probe that has not decided.
       The banner starts hidden, so the very first 'up' changes nothing
       visible and does not fire; the very first 'down' must show the
       banner and does fire once. After that, only real up<->down flips
       fire -- never twice for the same status. lastSettled survives a
       resetFailure, so a recovery after a cleared failure still fires. */
    function setSettled(next, reason) {
      var prevSettled = lastSettled;
      lastSettled = next;
      status = next;
      if (next === 'up') { lastOkAt = nowFn(); }
      if (next === 'down') { lastFailAt = nowFn(); }
      lastCheckAt = nowFn();
      if (typeof reason === 'string') lastReason = reason;
      var mustFire = (prevSettled !== null && prevSettled !== next) ||
        (prevSettled === null && next === 'down');
      if (mustFire) {
        var i;
        for (i = 0; i < listeners.length; i++) {
          try { listeners[i](next, getState()); } catch (e) {}
        }
      }
    }

    /* One probe attempt. Returns a Promise of a checkBackendReachable-style
       result { reachable, status, reason, httpStatus }. Uses piece 33 when
       present; otherwise a direct GET <base>/health with the same honesty
       rules (2xx + {ok:true} only). Never rejects. */
    function probeOnce(o) {
      var pages = root.EnzoPagesBackend;
      if (pages && isFn(pages.checkBackendReachable)) {
        var checkOpts = { timeoutMs: o.timeoutMs };
        if (fetchFnOpt) checkOpts.fetchFn = fetchFnOpt;
        if (o.fetchFn) checkOpts.fetchFn = o.fetchFn;
        if (hostnameOpt !== undefined) checkOpts.hostname = hostnameOpt;
        if (o.hostname !== undefined) checkOpts.hostname = o.hostname;
        try {
          return Promise.resolve(pages.checkBackendReachable(checkOpts))
            .then(function (c) {
              if (!c || typeof c !== 'object') {
                return { reachable: false, status: 'unreachable', reason: 'Empty health-check result.', httpStatus: null };
              }
              return {
                reachable: c.reachable === true,
                status: c.status || (c.reachable === true ? 'ok' : 'unreachable'),
                reason: c.reason || '',
                httpStatus: (typeof c.httpStatus === 'number') ? c.httpStatus : null
              };
            }, function (err) {
              return { reachable: false, status: 'unreachable', reason: (err && err.message) ? String(err.message) : 'Health check failed.', httpStatus: null };
            });
        } catch (e) {
          return Promise.resolve({ reachable: false, status: 'unreachable', reason: 'Health check threw.', httpStatus: null });
        }
      }
      /* No piece 33: direct fetch with our own timeout. */
      var fetchFn = o.fetchFn || fetchFnOpt || root.fetch;
      if (!isFn(fetchFn)) {
        return Promise.resolve({ reachable: false, status: 'no-fetch', reason: 'This environment cannot make network requests.', httpStatus: null });
      }
      var url = getBackendBase() + '/health';
      var ctl = null, timerId = null, settled = false;
      function settle(r) {
        if (settled) return r;
        settled = true;
        if (timerId) clearTimeoutFn(timerId);
        return r;
      }
      try {
        if (typeof root.AbortController !== 'undefined') {
          ctl = new root.AbortController();
          timerId = setTimeoutFn(function () { try { ctl.abort(); } catch (e) {} }, o.timeoutMs);
        }
      } catch (e) {}
      var req = { signal: ctl ? ctl.signal : undefined };
      var p;
      try { p = fetchFn(url, req); } catch (e) {
        return Promise.resolve(settle({ reachable: false, status: 'unreachable', reason: 'Health request could not be sent.', httpStatus: null }));
      }
      return Promise.resolve(p).then(function (resp) {
        if (!resp || typeof resp.status !== 'number') {
          return settle({ reachable: false, status: 'unreachable', reason: 'No HTTP response from the backend.', httpStatus: null });
        }
        if (resp.status < 200 || resp.status >= 300) {
          return settle({ reachable: false, status: 'http-error', reason: 'The backend answered with HTTP ' + resp.status + ' instead of a healthy reply.', httpStatus: resp.status });
        }
        if (isFn(resp.json)) {
          return resp.json().then(function (j) {
            if (j && j.ok === true) {
              return settle({ reachable: true, status: 'ok', reason: '', httpStatus: resp.status });
            }
            return settle({ reachable: false, status: 'bad-health', reason: 'The backend answered, but its health reply was not a healthy one.', httpStatus: resp.status });
          }, function () {
            return settle({ reachable: false, status: 'bad-health', reason: 'The backend answered, but its health reply could not be read.', httpStatus: resp.status });
          });
        }
        return settle({ reachable: true, status: 'ok', reason: '', httpStatus: resp.status });
      }, function (err) {
        var name = (err && err.name) || '';
        if (name === 'AbortError' || name === 'TimeoutError') {
          return settle({ reachable: false, status: 'timeout', reason: 'The backend did not answer within the time allowed.', httpStatus: null });
        }
        return settle({ reachable: false, status: 'unreachable', reason: 'The backend could not be reached from this page.', httpStatus: null });
      });
    }

    function wait(ms) {
      return new Promise(function (resolve) { setTimeoutFn(resolve, ms); });
    }

    /* Full verdict: up to maxAttempts attempts with backoff. A single
       success at any attempt means reachable. Unreachable is declared
       ONLY after every attempt has failed. Never rejects. */
    function checkHealth(callOpts) {
      if (inflight) return inflight;
      callOpts = callOpts || {};
      var o = {
        timeoutMs: (typeof callOpts.timeoutMs === 'number' && callOpts.timeoutMs > 0) ? callOpts.timeoutMs : timeoutMs,
        maxAttempts: (typeof callOpts.maxAttempts === 'number' && callOpts.maxAttempts > 0) ? callOpts.maxAttempts : maxAttempts,
        retryDelays: (callOpts.retryDelays instanceof Array && callOpts.retryDelays.length) ? callOpts.retryDelays : retryDelays,
        fetchFn: isFn(callOpts.fetchFn) ? callOpts.fetchFn : null,
        hostname: (typeof callOpts.hostname === 'string') ? callOpts.hostname : undefined
      };
      var attemptsMade = 0;
      var last = { reachable: false, status: 'unreachable', reason: '', httpStatus: null };
      var wasDown = (status === 'down');
      /* While a verdict is pending, the honest status is 'checking' --
         except when already 'down', where the banner stays until a probe
         actually succeeds (no flicker, no false recovery). */
      if (!wasDown && status !== 'checking') status = 'checking';

      function attempt(n) {
        attemptsMade++;
        totalAttempts++;
        return probeOnce(o).then(function (r) {
          last = r;
          lastStatus = r.status;
          lastReason = r.reason || '';
          lastProbe = { reachable: r.reachable === true, status: r.status, reason: r.reason || '', httpStatus: r.httpStatus, base: getBackendBase() };
          if (r.reachable === true) {
            consecutiveFailures = 0;
            setSettled('up', '');
            return { reachable: true, attempts: attemptsMade, lastStatus: lastStatus, lastReason: lastReason, checkedAt: isoNow() };
          }
          consecutiveFailures++;
          if (n + 1 < o.maxAttempts) {
            var delay = o.retryDelays[n] !== undefined ? o.retryDelays[n]
              : o.retryDelays[o.retryDelays.length - 1];
            return wait(delay).then(function () { return attempt(n + 1); });
          }
          setSettled('down', lastReason);
          return { reachable: false, attempts: attemptsMade, lastStatus: lastStatus, lastReason: lastReason, checkedAt: isoNow() };
        });
      }
      inflight = attempt(0).then(function (res) { inflight = null; return res; });
      return inflight;
    }

    /* Background loop: one timer, rescheduled after each probe so probes
       never overlap. While 'down', a full 3-attempt probe every 15s until
       reachable (onChange('up') fires, no reload). While 'up', one light
       single-attempt probe every 60s; a failure only moves to 'checking'
       and runs the full 3-attempt sequence before any UI change. */
    function scheduleNext() {
      if (!loopRunning) return;
      if (timer) { clearTimeoutFn(timer); timer = null; }
      var delay = (status === 'down') ? downIntervalMs : upIntervalMs;
      timer = setTimeoutFn(function () {
        timer = null;
        if (!loopRunning) return;
        if (inflight) { scheduleNext(); return; } /* never overlap a manual check */
        if (status === 'down') {
          checkHealth().then(function () { scheduleNext(); });
        } else {
          /* Light probe: one attempt only. Success keeps 'up'; failure
             hands over to the full sequence (checkHealth) which decides. */
          probeOnce({ timeoutMs: timeoutMs, maxAttempts: 1 }).then(function (r) {
            totalAttempts++;
            lastStatus = r.status; lastReason = r.reason || '';
            lastProbe = { reachable: r.reachable === true, status: r.status, reason: r.reason || '', httpStatus: r.httpStatus, base: getBackendBase() };
            if (r.reachable === true) {
              consecutiveFailures = 0;
              lastStatus = r.status; lastReason = '';
              if (status !== 'up') setSettled('up', '');
              else { lastOkAt = nowFn(); lastCheckAt = nowFn(); }
              scheduleNext();
            } else {
              consecutiveFailures++;
              if (status !== 'checking') status = 'checking';
              checkHealth().then(function () { scheduleNext(); });
            }
          });
        }
      }, delay);
    }

    function getState() {
      return {
        status: status,
        lastOkAt: lastOkAt,
        lastFailAt: lastFailAt,
        lastCheckAt: lastCheckAt,
        consecutiveFailures: consecutiveFailures,
        attempts: totalAttempts,
        lastStatus: lastStatus,
        lastReason: lastReason,
        lastProbe: lastProbe
      };
    }

    var instance = {
      checkHealth: checkHealth,
      getState: getState,
      onChange: function (fn) {
        if (!isFn(fn)) return function () {};
        listeners.push(fn);
        return function () {
          var i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },
      /* Clears a cached failure (used by Retry Search). Accuracy: this
         NEVER claims the backend is up -- it moves to 'unknown' and the
         next probe decides. No onChange fires for the clearing itself. */
      resetFailure: function () {
        consecutiveFailures = 0;
        lastFailAt = null;
        lastReason = '';
        lastStatus = '';
        if (status === 'down' || status === 'checking') status = 'unknown';
        if (timer) { clearTimeoutFn(timer); timer = null; }
        if (loopRunning) scheduleNext();
      },
      /* True when no verdict has been completed within maxAgeMs (or no
         verdict ever). A stale 'up' must not be presented as current. */
      isStale: function (maxAgeMs) {
        var limit = (typeof maxAgeMs === 'number' && maxAgeMs > 0) ? maxAgeMs : staleAfterMs;
        if (lastCheckAt === null) return true;
        return (nowFn() - lastCheckAt) > limit;
      },
      start: function () {
        if (loopRunning) return;
        loopRunning = true;
        /* Immediate full verdict on start, then the background loop. */
        checkHealth().then(function () { scheduleNext(); });
      },
      stop: function () {
        loopRunning = false;
        if (timer) { clearTimeoutFn(timer); timer = null; }
      },
      getBackendBase: getBackendBase,
      /* Test/internal seam: build an independent instance with its own
         state (used by the harness so tests never share the singleton). */
      _create: createInstance,
      _defaults: {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        retryDelays: DEFAULT_RETRY_DELAYS,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        downIntervalMs: DEFAULT_DOWN_INTERVAL_MS,
        upIntervalMs: DEFAULT_UP_INTERVAL_MS,
        staleAfterMs: DEFAULT_STALE_AFTER_MS
      }
    };
    return instance;
  }

  var singleton = createInstance({});
  root.__enzoBackendHealth = singleton;
  return singleton;
});
/* == END PIECE 42 == */
