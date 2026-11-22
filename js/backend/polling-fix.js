
/* ==========================================================================
 * ENAO AI — Live-defect fix, worker 3: CHAT-SYNC + POLLING 404 STORM
 * Piece 32: pieces/32-polling-fix.js
 *
 * Defect (VM log, 22 Nov 2026 ~11:03-11:08 UTC, confirmed live by the
 * coordinator): the browser polled GET /api/v2/chats/cmwrc44ophyz4/tasks
 * and /events?since=0 many times per second (same for chat
 * cmwrqbn8526y6); GET /api/v2/tasks//progress and /sources with an EMPTY
 * task id; POST /api/v2/tasks/2/cancel -> 404. The cmwr* ids are
 * localStorage-only chats the backend never knew about, and the frontend
 * polled them forever.
 *
 * Root causes found by grep in ~/workspace/your_files/enao-ai/enao-ai.html
 * (45,471 lines; NEVER edited by this piece):
 *
 *  R1. TWO ID NAMESPACES, MONITOR USES THE WRONG ONE. Local chats live in
 *      localStorage 'enao_chats_v1' with ids like cmwrqbn8526y6. The
 *      backend only knows the server-assigned id returned by POST /chats
 *      (ensureBackendChat, ~L12885, stored as chat.backendId). The monitor
 *      data layer (M1, ~L20582 pollOnce) is fed the LOCAL id:
 *      syncMonitorChat (~L44263, setInterval 1200 ms) calls
 *      EnzoMonitor.setChatId(activeChat().id) and .start(); backendAsk
 *      (~L13290) calls EnzoMonitor.setChatId(chat.id); monitor restore()
 *      (~L19928) reloads a persisted (local) chatId from localStorage
 *      'enao_monitor_v1' and start() polls it on page load. So a chat
 *      that never had an /ask is polled from load, forever.
 *  R2. MONITOR RETRIES 404 FOREVER. M1 pollOnce (~L20582) treats a 404
 *      as proof the backend is up ("404 (unknown chat) still proves the
 *      backend is up") and re-schedules with backoff [1,2,5,10,30]s
 *      forever. pollProgressOnce (~L20669) re-schedules progress polling
 *      on ANY failure, forever. No code path ever marks a chat unknown.
 *  R3. P-F v2req STRIPS THE HTTP STATUS (~L12720). It throws a generic
 *      Error('http '+r.status) with no err.status, so the P-F task poller
 *      startPoll (~L13154, tick every 2500 ms, 4000 ms paused, first tick
 *      600 ms) cannot tell a 404 from a network error; its 3-strike rule
 *      counts every error alike and falls back to legacy search instead
 *      of marking the chat/task unknown.
 *  R4. EMPTY-ID CALLS HAVE NO SINGLE CHOKE POINT. fetchTaskSources
 *      (~L12920) guards `if(!taskId)` but handleAskResp (~L13260) calls
 *      it with resp.task_id unchecked; startPoll fetches
 *      v2get('/tasks/'+taskId) and /progress with no guard; postModify
 *      (~L25065, ~L29315) calls fetch with encodeURIComponent(taskId)
 *      and no guard at all (encodeURIComponent(undefined) === "undefined");
 *      the lifecycle cancelTask (~L39442) does String(taskId) — turning
 *      undefined into the literal string "undefined" — and
 *      notifyBackendCancel (~L39288) fires the POST even for unknown ids
 *      ("Cancelling an unknown task id is also safe... the backend is
 *      still told"). v2Control (~L12818) and stopGeneration (~L13824)
 *      POST /tasks/{t.taskId}/cancel with no guard. That is where
 *      /tasks//progress, /tasks//sources and /tasks/2/cancel come from:
 *      an empty id, or a stale/unknown id, sent with no check.
 *  R5. LIVE SCREEN RECURSES FOREVER. EnzoLiveScreen pollOnce (~L42544)
 *      fetches task + progress + events every 2500 ms and schedulePoll
 *      (~L42531) re-schedules on BOTH resolve and reject; openLiveScreen
 *      (~L42840) takes its chatId from EnzoMonitor.getState().chatId —
 *      the same local id from R1. No 404 handling anywhere in the loop.
 *  R6. restoreBackendForChat (~L13323) is the ONE correct caller: it
 *      uses the backend id (bid) for /chats/{bid}/tasks. Every other
 *      chat poller uses the local id. The fix makes every poller use R6's
 *      rule: poll a chat ONLY under its backend id, ONLY after the
 *      backend confirmed it.
 *
 * What this piece does (pure, testable helpers + one guarded transport
 * that is the single choke point every caller must use):
 *
 *  1. Backend-known chat registry. A chat is pollable ONLY after the
 *     backend confirmed it (successful create/get/ask for that chat id).
 *     Local-only chats are NEVER polled.
 *  2. First-404 rule. The first 404 on a chat's /tasks or /events marks
 *     that chat local-only, stops its polling loops immediately, and
 *     never retries it in the session. An unknown chat is polled AT MOST
 *     ONCE per session (one probe, then stopped).
 *  3. Empty-id guard at the single choke point (the transport below)
 *     and re-checked at each poller: no progress/sources/task/cancel/
 *     pause/resume/modify call may ever fire with an empty, blank,
 *     whitespace-only, undefined, null, "undefined", "null" or "NaN"
 *     task id. Same for empty chat ids.
 *  4. Monitor and Live Screen pollers share the same registry, guards
 *     and first-404 rule (createMonitorPoller / createLiveScreenPoller).
 *  5. Unknown-task control dedupe: a cancel/pause/resume/modify is sent
 *     ONLY for a task id the backend has confirmed (ask response,
 *     successful task/progress fetch, or an explicit confirmTask()).
 *     A control call for a task the backend does not know is never sent
 *     at all — zero fetch calls — so the live POST /api/v2/tasks/2/cancel
 *     404 can never happen. After a 404 a task stays unknown and its
 *     control calls stay suppressed for the session; an in-flight
 *     control call is never duplicated; a successful cancel is never
 *     re-sent (task terminal).
 *
 * What this piece does NOT change: polling behaviour for backend-known
 * chats and tasks is untouched — progress still polls every 2 s / 2.5 s,
 * long-poll events still re-poll at once after a 25 s hold, non-404
 * errors still back off and retry. No fetch is invented, no data is
 * synthesised, no emojis.
 *
 * Style: plain ES5, var + function declarations, no dependencies, no
 * emojis. Loads in a browser as window.EnzoPollingFix and in Node as a
 * CommonJS module (require('./32-polling-fix.js')) for the harness.
 * ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.EnzoPollingFix = api;
})(typeof window !== 'undefined' ? window
    : (typeof globalThis !== 'undefined' ? globalThis : this),
function () {
  'use strict';

  var VERSION = '32-polling-fix v1.0 (enao-live-fix, 22 Nov 2026)';
  var TERMINAL_TASK_STATES = {
    completed: true, partially_completed: true,
    failed: true, cancelled: true
  };
  var CONTROL_ACTIONS = { pause: true, resume: true, cancel: true, modify: true };
  var BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

  /* ------------------------------------------------------------------ */
  /* Small pure helpers                                                  */
  /* ------------------------------------------------------------------ */

  /* Normalise an id. Returns the trimmed string, or null when the value
     can never be a real backend id: undefined, null, non-string
     non-number, empty, whitespace-only, or the literal strings produced
     by String(undefined) / String(null) — the exact trap at export
     L39442 (cancelTask does String(taskId)) and L25065/L29315
     (encodeURIComponent(undefined) === "undefined"). Numbers are
     accepted (a numeric task id such as 2 is non-empty; whether the
     backend knows it is decided by the registry/404 rule, not here). */
  function asId(value) {
    if (typeof value === 'number') {
      if (!isFinite(value)) return null;
      return String(value);
    }
    if (typeof value !== 'string') return null;
    var s = value.replace(/^\s+|\s+$/g, '');
    if (!s) return null;
    if (s === 'undefined' || s === 'null' || s === 'NaN') return null;
    return s;
  }

  function isNonEmptyId(value) {
    return asId(value) !== null;
  }

  /* Detect a 404 from any of the error shapes in the export. The
     monitor's httpJson (~L20557) sets err.status; P-F v2req (~L12720)
     does NOT, it throws Error('http 404') — so the message text must
     also be checked. A bare "Not Found" with no 404 is NOT treated as
     a 404: only a numeric 404 counts, so a stray message can never
     wrongly quarantine a known chat. */
  function is404(err) {
    if (!err) return false;
    if (err.status === 404 || err.statusCode === 404) return true;
    var m = String((err && err.message) || err);
    return /(^|[^0-9])404([^0-9]|$)/.test(m);
  }

  function isTerminalTaskState(state) {
    return !!TERMINAL_TASK_STATES[state];
  }

  function clone(obj) {
    if (obj === undefined) return undefined;
    return JSON.parse(JSON.stringify(obj));
  }

  /* ------------------------------------------------------------------ */
  /* Registry: what the backend has confirmed, what it rejected, and    */
  /* what has already been probed once this session. One registry per   */
  /* page load; nothing here persists to localStorage, so a reload      */
  /* re-probes once (correct: a chat created on the backend since the   */
  /* last load must be pollable again).                                 */
  /* ------------------------------------------------------------------ */

  function createRegistry() {
    var knownByLocal = {};   /* local chat id -> backend chat id */
    var knownBackend = {};   /* backend chat id -> true */
    var localOnly = {};      /* chat id (local or backend, as polled) -> true */
    var probed = {};         /* chat id -> number of probe attempts */
    var knownTasks = {};     /* task id -> true */
    var unknownTasks = {};   /* task id -> true (404'd, never retry) */
    var controlState = {};   /* taskId + '|' + action -> 'inflight'|'ok'|'notfound' */

    function markLocalOnly(chatId) {
      var id = asId(chatId);
      if (id) localOnly[id] = true;
    }

    return {
      /* Backend confirmed this chat: POST /chats succeeded, or a
         GET /chats/{id}/... succeeded. localId is the localStorage id,
         backendId the server-assigned id; when they are the same id
         (or only one is known) pass it as both. */
      confirmChat: function (localId, backendId) {
        var l = asId(localId);
        var b = asId(backendId) || l;
        if (!l || !b) return false;
        knownByLocal[l] = b;
        knownBackend[b] = true;
        delete localOnly[l];
        delete localOnly[b];
        return true;
      },
      /* A poll under this id succeeded: the id itself is backend-known. */
      confirmChatByPolledId: function (polledId) {
        var id = asId(polledId);
        if (!id) return false;
        knownBackend[id] = true;
        delete localOnly[id];
        return true;
      },
      markChatLocalOnly: markLocalOnly,
      isChatKnown: function (chatId) {
        var id = asId(chatId);
        if (!id) return false;
        return !!knownBackend[id] || !!knownByLocal[id];
      },
      isChatLocalOnly: function (chatId) {
        var id = asId(chatId);
        if (!id) return false;
        return !!localOnly[id];
      },
      /* The id a poller must put in the URL, or null when the chat must
         not be polled at all. Never returns a local-only id. */
      resolveBackendId: function (localId) {
        var id = asId(localId);
        if (!id) return null;
        if (localOnly[id]) return null;
        if (knownByLocal[id]) return knownByLocal[id];
        if (knownBackend[id]) return id;
        return null;
      },
      /* First-404 rule, probe half: true only the first time an
         unconfirmed chat is polled. Callers must call noteProbe() when
         they actually fire the probe so the count is exact. */
      canProbeChat: function (chatId) {
        var id = asId(chatId);
        if (!id) return false;
        if (localOnly[id]) return false;
        return !probed[id];
      },
      noteProbe: function (chatId) {
        var id = asId(chatId);
        if (!id) return 0;
        probed[id] = (probed[id] || 0) + 1;
        return probed[id];
      },
      probeCount: function (chatId) {
        var id = asId(chatId);
        return id ? (probed[id] || 0) : 0;
      },
      /* Record a chat poll outcome. A 404 quarantines the chat
         (local-only, polling stops); a success confirms it. Returns
         'local-only', 'confirmed' or 'error' (non-404: retry with
         backoff, chat stays unconfirmed). */
      noteChatPollResult: function (chatId, err) {
        var id = asId(chatId);
        if (!id) return 'empty-id';
        if (!err) {
          knownBackend[id] = true;
          delete localOnly[id];
          return 'confirmed';
        }
        if (is404(err)) {
          localOnly[id] = true;
          return 'local-only';
        }
        return 'error';
      },
      confirmTask: function (taskId) {
        var id = asId(taskId);
        if (!id) return false;
        knownTasks[id] = true;
        delete unknownTasks[id];
        return true;
      },
      isTaskKnown: function (taskId) {
        var id = asId(taskId);
        return !!id && !!knownTasks[id];
      },
      isTaskUnknown: function (taskId) {
        var id = asId(taskId);
        return !!id && !!unknownTasks[id];
      },
      markTaskUnknown: function (taskId) {
        var id = asId(taskId);
        if (id) unknownTasks[id] = true;
      },
      /* Record a task poll outcome. A 404 quarantines the task;
         a success confirms it. Returns 'unknown', 'confirmed' or
         'error'. */
      noteTaskPollResult: function (taskId, err) {
        var id = asId(taskId);
        if (!id) return 'empty-id';
        if (!err) {
          knownTasks[id] = true;
          delete unknownTasks[id];
          return 'confirmed';
        }
        if (is404(err)) {
          unknownTasks[id] = true;
          return 'unknown';
        }
        return 'error';
      },
      /* Control-call dedupe (rule 5). Returns true when a control call
         for this task+action may be sent now. A control call is sent
         ONLY for a task the backend has confirmed: an unconfirmed task
         (never seen in a successful ask/task/progress response) is
         treated as unknown, so POST /tasks/2/cancel-style calls for ids
         the backend never issued make zero fetch calls. */
      canSendControl: function (taskId, action) {
        var id = asId(taskId);
        if (!id || !CONTROL_ACTIONS[action]) return false;
        if (!knownTasks[id]) return false;
        if (unknownTasks[id]) return false;
        var st = controlState[id + '|' + action];
        if (st === 'inflight' || st === 'notfound') return false;
        /* A successful cancel is terminal: never re-send it. Pause /
           resume may be sent again after a success. */
        if (st === 'ok' && action === 'cancel') return false;
        return true;
      },
      noteControlSent: function (taskId, action) {
        var id = asId(taskId);
        if (id && CONTROL_ACTIONS[action]) controlState[id + '|' + action] = 'inflight';
      },
      noteControlResult: function (taskId, action, err) {
        var id = asId(taskId);
        if (!id || !CONTROL_ACTIONS[action]) return 'empty-id';
        var key = id + '|' + action;
        if (!err) {
          controlState[key] = 'ok';
          knownTasks[id] = true;
          delete unknownTasks[id];
          return 'confirmed';
        }
        if (is404(err)) {
          controlState[key] = 'notfound';
          unknownTasks[id] = true;
          return 'unknown';
        }
        delete controlState[key];
        return 'error';
      },
      snapshot: function () {
        return {
          knownByLocal: clone(knownByLocal),
          knownBackend: clone(knownBackend),
          localOnly: clone(localOnly),
          probed: clone(probed),
          knownTasks: clone(knownTasks),
          unknownTasks: clone(unknownTasks),
          controlState: clone(controlState)
        };
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Guarded transport: the SINGLE choke point. Every backend poll /    */
  /* control call in the export must go through here (or through a      */
  /* wrapper with identical checks). No method here ever calls fetch    */
  /* with an empty id, with a local-only chat, with a second probe of   */
  /* an unknown chat, with an unknown task, or with a duplicate /       */
  /* already-404'd control call. Rejections carry .code so callers can  */
  /* tell a guard refusal (no request was sent) from a backend error.   */
  /* ------------------------------------------------------------------ */

  function guardedError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* fetchFn must be fetch-compatible: fetch(url, opts) -> Promise of a
     Response-like {ok, status, json()}. The transport normalises a
     non-2xx response into an Error with .status set — this also repairs
     R3 for callers routed through here (P-F v2req drops the status). */
  function createTransport(fetchFn, registry, opts) {
    if (typeof fetchFn !== 'function') {
      throw new Error('EnzoPollingFix.createTransport: fetchFn is required');
    }
    var reg = registry || createRegistry();
    var base = (opts && typeof opts.base === 'string' && opts.base)
      ? opts.base.replace(/\/$/, '') : '/api/v2';

    function callFetch(url, fetchOpts) {
      var p;
      try {
        p = fetchFn(url, fetchOpts || { method: 'GET' });
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
      return Promise.resolve(p).then(function (resp) {
        if (!resp || typeof resp.json !== 'function') {
          throw new Error('Invalid response from backend');
        }
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (!resp.ok) {
            var err = new Error((j && (j.message || j.error)) ||
              ('Backend returned HTTP ' + resp.status));
            err.status = resp.status;
            err.payload = j;
            throw err;
          }
          return j;
        });
      });
    }

    /* Chat calls: known -> poll under the backend id; unconfirmed ->
       exactly one probe under the id as given; local-only / already
       probed -> refuse without fetching. On success the polled id is
       confirmed; on 404 the chat is quarantined. */
    function chatCall(kind, chatId, suffix, fetchOpts) {
      var id = asId(chatId);
      if (!id) {
        return Promise.reject(guardedError('empty-chat-id',
          'Refused ' + kind + ': chat id is empty — no request sent.'));
      }
      var backendId = reg.resolveBackendId(id);
      if (backendId) {
        return callFetch(base + '/chats/' + encodeURIComponent(backendId) + suffix, fetchOpts)
          .then(function (j) { reg.noteChatPollResult(backendId, null); return j; },
            function (err) { reg.noteChatPollResult(backendId, err); throw err; });
      }
      if (reg.isChatLocalOnly(id) || !reg.canProbeChat(id)) {
        return Promise.reject(guardedError('chat-local-only',
          'Refused ' + kind + ': chat ' + id +
          ' is local-only (backend never confirmed it) — no request sent.'));
      }
      reg.noteProbe(id);
      return callFetch(base + '/chats/' + encodeURIComponent(id) + suffix, fetchOpts)
        .then(function (j) { reg.noteChatPollResult(id, null); return j; },
          function (err) { reg.noteChatPollResult(id, err); throw err; });
    }

    /* Task calls: empty id -> refuse; unknown (404'd) task -> refuse;
       otherwise fetch, confirming on success and quarantining on 404. */
    function taskCall(kind, taskId, suffix, fetchOpts) {
      var id = asId(taskId);
      if (!id) {
        return Promise.reject(guardedError('empty-task-id',
          'Refused ' + kind + ': task id is empty — no request sent.'));
      }
      if (reg.isTaskUnknown(id)) {
        return Promise.reject(guardedError('task-unknown',
          'Refused ' + kind + ': task ' + id +
          ' is unknown to the backend — no request sent.'));
      }
      return callFetch(base + '/tasks/' + encodeURIComponent(id) + suffix, fetchOpts)
        .then(function (j) { reg.noteTaskPollResult(id, null); return j; },
          function (err) { reg.noteTaskPollResult(id, err); throw err; });
    }

    function controlCall(taskId, action, body) {
      var id = asId(taskId);
      if (!id) {
        return Promise.reject(guardedError('empty-task-id',
          'Refused task control (' + action + '): task id is empty — no request sent.'));
      }
      if (!CONTROL_ACTIONS[action]) {
        return Promise.reject(guardedError('bad-action',
          'Refused task control: unknown action "' + action + '".'));
      }
      if (!reg.isTaskKnown(id)) {
        return Promise.reject(guardedError('task-unknown',
          'Refused task control (' + action + ') for task ' + id +
          ': task was never confirmed by the backend — no request sent.'));
      }
      if (!reg.canSendControl(id, action)) {
        return Promise.reject(guardedError('control-suppressed',
          'Refused task control (' + action + ') for task ' + id +
          ': already sent, in flight, or task unknown to the backend — no request sent.'));
      }
      reg.noteControlSent(id, action);
      return callFetch(base + '/tasks/' + encodeURIComponent(id) + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(function (j) { reg.noteControlResult(id, action, null); return j; },
        function (err) { reg.noteControlResult(id, action, err); throw err; });
    }

    return {
      registry: reg,
      base: base,
      getChatEvents: function (chatId, since) {
        var s = (typeof since === 'number' && since >= 0) ? since : 0;
        return chatCall('events', chatId, '/events?since=' + s);
      },
      getChatTasks: function (chatId) {
        return chatCall('chat-tasks', chatId, '/tasks');
      },
      getTask: function (taskId) {
        return taskCall('task', taskId, '');
      },
      getTaskProgress: function (taskId) {
        return taskCall('progress', taskId, '/progress');
      },
      getTaskSources: function (taskId) {
        return taskCall('sources', taskId, '/sources');
      },
      postTaskControl: function (taskId, action) {
        return controlCall(taskId, action, {});
      },
      postTaskModify: function (taskId, instruction) {
        return controlCall(taskId, 'modify', { instruction: instruction || '' });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Pollers. All share one registry + transport, all obey the same     */
  /* rules, all stop on first 404. Timers are injectable so the harness */
  /* can drive them without real time. Default timers are the globals.  */
  /* ------------------------------------------------------------------ */

  function defaultTimers() {
    return {
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (t) { clearTimeout(t); }
    };
  }

  function nextBackoff(step) {
    return BACKOFF_MS[Math.min(step, BACKOFF_MS.length - 1)];
  }

  /* Long-poll event poller — replaces M1 pollOnce (~L20582) and the
     syncMonitorChat re-pointing (~L44263). Behaviour for known chats is
     unchanged: after a successful long-poll (server held up to 25 s)
     it re-polls at once; non-404 errors back off. A 404, an empty chat
     id, or a local-only chat stops the loop immediately. */
  function createEventPoller(opts) {
    opts = opts || {};
    var transport = opts.transport;
    if (!transport) throw new Error('EnzoPollingFix.createEventPoller: transport is required');
    var timers = opts.timers || defaultTimers();
    var chatId = asId(opts.chatId);
    var timer = null;
    var running = false;
    var stopped = false;
    var stopReason = null;
    var backoffStep = 0;
    var rounds = 0;
    var inFlight = null; /* a round already running: re-calling pollOnce
      joins it instead of firing a duplicate probe (a duplicate probe
      would break the at-most-once rule for unknown chats) */

    function stop(reason) {
      if (timer) { timers.clearTimeout(timer); timer = null; }
      running = false;
      stopped = true;
      stopReason = reason || 'stopped';
      if (typeof opts.onStop === 'function') {
        try { opts.onStop(stopReason); } catch (e) { /* callback must not break stop */ }
      }
    }

    function schedule(delayMs) {
      if (!running || stopped) return;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(function () {
        timer = null;
        pollOnce();
      }, delayMs);
    }

    function pollOnce() {
      if (stopped || !running) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (!chatId) { stop('empty-chat-id'); return Promise.resolve(false); }
      rounds++;
      inFlight = transport.getChatEvents(chatId, opts.since || 0).then(function (j) {
        inFlight = null;
        if (stopped || !running) return false;
        backoffStep = 0;
        if (typeof opts.onEvents === 'function') {
          try { opts.onEvents(j); } catch (e) { /* callback must not break polling */ }
        }
        if (typeof opts.onSince === 'function') {
          try { opts.onSince(j); } catch (e) { /* ignore */ }
        }
        schedule(0); /* server already held up to 25 s: poll again at once */
        return true;
      }, function (err) {
        inFlight = null;
        if (stopped || !running) return false;
        if (err && (err.code === 'chat-local-only' || err.code === 'empty-chat-id')) {
          stop(err.code === 'empty-chat-id' ? 'empty-chat-id' : 'chat-local-only');
          return false;
        }
        if (is404(err)) { stop('chat-404'); return false; }
        if (typeof opts.onError === 'function') {
          try { opts.onError(err); } catch (e) { /* ignore */ }
        }
        var delay = nextBackoff(backoffStep);
        backoffStep++;
        schedule(delay);
        return false;
      });
      return inFlight;
    }

    return {
      kind: 'events',
      start: function () {
        if (stopped) return false;
        if (running) return true;
        if (!chatId) { stop('empty-chat-id'); return false; }
        /* Unknown chat: the transport allows exactly one probe; the
           poller must not even schedule a retry loop for a chat the
           registry already quarantined. */
        var reg = transport.registry;
        if (reg && reg.isChatLocalOnly(chatId)) { stop('chat-local-only'); return false; }
        running = true;
        backoffStep = 0;
        pollOnce();
        return true;
      },
      stop: function () { stop('stopped'); },
      setChatId: function (id) {
        var next = asId(id);
        if (next === chatId) return;
        if (timer) { timers.clearTimeout(timer); timer = null; }
        chatId = next;
        backoffStep = 0;
        if (running && chatId) pollOnce();
        else if (running) stop('empty-chat-id');
      },
      getChatId: function () { return chatId; },
      pollOnce: pollOnce,
      isRunning: function () { return running && !stopped; },
      isStopped: function () { return stopped; },
      getStopReason: function () { return stopReason; },
      getRounds: function () { return rounds; }
    };
  }

  /* Progress poller — replaces P-F startPoll tick (~L13154) and M1
     pollProgressOnce (~L20669). Behaviour for known tasks is unchanged:
     polls every intervalMs while the task is active; terminal states
     stop it. A 404 or an empty task id stops it immediately. Non-404
     errors back off, and after 3 consecutive non-404 errors it stops
     with 'unreachable' (the existing P-F 3-strike rule, preserved). */
  function createProgressPoller(opts) {
    opts = opts || {};
    var transport = opts.transport;
    if (!transport) throw new Error('EnzoPollingFix.createProgressPoller: transport is required');
    var timers = opts.timers || defaultTimers();
    var taskId = asId(opts.taskId);
    var intervalMs = (typeof opts.intervalMs === 'number' && opts.intervalMs > 0)
      ? opts.intervalMs : 2500;
    var timer = null;
    var running = false;
    var stopped = false;
    var stopReason = null;
    var strikes = 0;
    var rounds = 0;
    var inFlight = null; /* same duplicate-probe guard as the events poller */

    function stop(reason) {
      if (timer) { timers.clearTimeout(timer); timer = null; }
      running = false;
      stopped = true;
      stopReason = reason || 'stopped';
      if (typeof opts.onStop === 'function') {
        try { opts.onStop(stopReason); } catch (e) { /* ignore */ }
      }
    }

    function schedule(delayMs) {
      if (!running || stopped) return;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(function () {
        timer = null;
        pollOnce();
      }, delayMs);
    }

    function pollOnce() {
      if (stopped || !running) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (!taskId) { stop('empty-task-id'); return Promise.resolve(false); }
      rounds++;
      inFlight = transport.getTaskProgress(taskId).then(function (p) {
        inFlight = null;
        if (stopped || !running) return false;
        strikes = 0;
        if (typeof opts.onProgress === 'function') {
          try { opts.onProgress(p); } catch (e) { /* ignore */ }
        }
        if (p && isTerminalTaskState(p.state)) {
          stop('terminal:' + p.state);
          if (typeof opts.onTerminal === 'function') {
            try { opts.onTerminal(p); } catch (e) { /* ignore */ }
          }
          return true;
        }
        schedule(intervalMs);
        return true;
      }, function (err) {
        inFlight = null;
        if (stopped || !running) return false;
        if (err && (err.code === 'empty-task-id' || err.code === 'task-unknown')) {
          stop(err.code === 'empty-task-id' ? 'empty-task-id' : 'task-404');
          return false;
        }
        if (is404(err)) { stop('task-404'); return false; }
        if (typeof opts.onError === 'function') {
          try { opts.onError(err); } catch (e) { /* ignore */ }
        }
        strikes++;
        if (strikes >= 3) { stop('unreachable'); return false; }
        schedule(3000);
        return false;
      });
      return inFlight;
    }

    return {
      kind: 'progress',
      start: function () {
        if (stopped) return false;
        if (running) return true;
        if (!taskId) { stop('empty-task-id'); return false; }
        var reg = transport.registry;
        if (reg && reg.isTaskUnknown(taskId)) { stop('task-404'); return false; }
        running = true;
        strikes = 0;
        pollOnce();
        return true;
      },
      stop: function () { stop('stopped'); },
      setTaskId: function (id) {
        var next = asId(id);
        if (next === taskId) return;
        if (timer) { timers.clearTimeout(timer); timer = null; }
        taskId = next;
        strikes = 0;
        if (running && taskId) pollOnce();
        else if (running) stop('empty-task-id');
      },
      getTaskId: function () { return taskId; },
      pollOnce: pollOnce,
      isRunning: function () { return running && !stopped; },
      isStopped: function () { return stopped; },
      getStopReason: function () { return stopReason; },
      getRounds: function () { return rounds; }
    };
  }

  /* Monitor poller — M1 data layer shape (events long-poll + progress
     poll + sources on terminal) sharing one registry/transport. An
     unknown chat stops ONLY the events side; a known task's progress
     keeps polling. Sources are fetched once, only for a known task id,
     only when the task reaches a terminal state. */
  function createMonitorPoller(opts) {
    opts = opts || {};
    var transport = opts.transport;
    if (!transport) throw new Error('EnzoPollingFix.createMonitorPoller: transport is required');
    var events = createEventPoller({
      transport: transport,
      chatId: opts.chatId,
      timers: opts.timers,
      since: opts.since || 0,
      onEvents: opts.onEvents,
      onError: opts.onError,
      onStop: function (reason) {
        if (typeof opts.onEventsStop === 'function') {
          try { opts.onEventsStop(reason); } catch (e) { /* ignore */ }
        }
      }
    });
    var progress = null;
    var sourcesFetched = {};

    function ensureProgress(taskId) {
      var id = asId(taskId);
      if (!id) return null;
      if (progress && progress.getTaskId() === id) return progress;
      if (progress) progress.stop();
      progress = createProgressPoller({
        transport: transport,
        taskId: id,
        intervalMs: opts.progressIntervalMs || 2000,
        timers: opts.timers,
        onProgress: opts.onProgress,
        onError: opts.onError,
        onTerminal: function (p) {
          if (!sourcesFetched[id]) {
            sourcesFetched[id] = true;
            transport.getTaskSources(id).then(function (j) {
              if (typeof opts.onSources === 'function') {
                try { opts.onSources(id, j); } catch (e) { /* ignore */ }
              }
            }, function () { /* sources failure never stops polling */ });
          }
          if (typeof opts.onTerminal === 'function') {
            try { opts.onTerminal(id, p); } catch (e) { /* ignore */ }
          }
        },
        onStop: function (reason) {
          if (typeof opts.onProgressStop === 'function') {
            try { opts.onProgressStop(reason); } catch (e) { /* ignore */ }
          }
        }
      });
      return progress;
    }

    return {
      kind: 'monitor',
      events: events,
      start: function () {
        var ok = events.start();
        if (opts.taskId) {
          var p = ensureProgress(opts.taskId);
          if (p) p.start();
        }
        return ok;
      },
      stop: function () {
        events.stop();
        if (progress) progress.stop();
      },
      setChatId: function (id) { events.setChatId(id); },
      getChatId: function () { return events.getChatId(); },
      openTask: function (taskId) {
        var p = ensureProgress(taskId);
        if (!p) return null;
        p.start();
        return p;
      },
      getProgressPoller: function () { return progress; },
      pollEventsOnce: function () { return events.pollOnce(); },
      pollProgressOnce: function () {
        return progress ? progress.pollOnce() : Promise.resolve(false);
      },
      isEventsStopped: function () { return events.isStopped(); },
      getEventsStopReason: function () { return events.getStopReason(); }
    };
  }

  /* Live Screen poller — one round fetches task + progress + events in
     the same order as EnzoLiveScreen pollOnce (~L42544), every
     pollIntervalMs, until the screen closes or the lifecycle is
     terminal. A 404 on events skips ONLY the events leg from then on
     (task/progress keep polling while the task is known); a 404 on the
     task or progress leg stops the whole loop; an empty task id never
     starts it. */
  function createLiveScreenPoller(opts) {
    opts = opts || {};
    var transport = opts.transport;
    if (!transport) throw new Error('EnzoPollingFix.createLiveScreenPoller: transport is required');
    var timers = opts.timers || defaultTimers();
    var taskId = asId(opts.taskId);
    var chatId = asId(opts.chatId);
    var intervalMs = (typeof opts.pollIntervalMs === 'number' && opts.pollIntervalMs > 0)
      ? opts.pollIntervalMs : 2500;
    var timer = null;
    var open = false;
    var stopped = false;
    var stopReason = null;
    var eventsStopped = false;
    var rounds = 0;
    var inFlight = null; /* same duplicate-probe guard as the other pollers */

    function stop(reason) {
      if (timer) { timers.clearTimeout(timer); timer = null; }
      open = false;
      stopped = true;
      stopReason = reason || 'stopped';
      if (typeof opts.onStop === 'function') {
        try { opts.onStop(stopReason); } catch (e) { /* ignore */ }
      }
    }

    function schedule() {
      if (!open || stopped) return;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(function () {
        timer = null;
        pollOnce();
      }, intervalMs);
    }

    function pollOnce() {
      if (stopped || !open) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (!taskId) { stop('empty-task-id'); return Promise.resolve(false); }
      rounds++;
      var chain = Promise.resolve();
      chain = chain.then(function () {
        return transport.getTask(taskId);
      }).then(function (j) {
        var task = (j && j.task) ? j.task : j;
        if (typeof opts.onTask === 'function') {
          try { opts.onTask(task); } catch (e) { /* ignore */ }
        }
        if (task && isTerminalTaskState(task.state)) {
          stop('terminal:' + task.state);
          return null;
        }
        return task;
      }, function (err) {
        if (is404(err) || (err && err.code === 'task-unknown')) { stop('task-404'); }
        else if (typeof opts.onError === 'function') {
          try { opts.onError(err); } catch (e) { /* ignore */ }
        }
        return null;
      });
      chain = chain.then(function (task) {
        if (stopped || !open || !task) return null;
        return transport.getTaskProgress(taskId).then(function (p) {
          if (typeof opts.onProgress === 'function') {
            try { opts.onProgress(p); } catch (e) { /* ignore */ }
          }
          if (p && isTerminalTaskState(p.state)) stop('terminal:' + p.state);
          return p;
        }, function (err) {
          if (is404(err) || (err && err.code === 'task-unknown')) stop('task-404');
          return null;
        });
      });
      chain = chain.then(function () {
        if (stopped || !open || eventsStopped || !chatId) return null;
        return transport.getChatEvents(chatId, opts.since || 0).then(function (j) {
          if (typeof opts.onEvents === 'function') {
            try { opts.onEvents(j); } catch (e) { /* ignore */ }
          }
          return j;
        }, function (err) {
          if (is404(err) || (err && err.code === 'chat-local-only')) {
            eventsStopped = true;
            if (typeof opts.onEventsStop === 'function') {
              try { opts.onEventsStop('chat-404'); } catch (e) { /* ignore */ }
            }
          }
          return null;
        });
      });
      inFlight = chain.then(function () {
        inFlight = null;
        if (stopped || !open) return false;
        if (typeof opts.onRound === 'function') {
          try { opts.onRound(rounds); } catch (e) { /* ignore */ }
        }
        schedule();
        return true;
      }, function () {
        inFlight = null;
        return false;
      });
      return inFlight;
    }

    return {
      kind: 'livescreen',
      start: function () {
        if (stopped) return false;
        if (open) return true;
        if (!taskId) { stop('empty-task-id'); return false; }
        var reg = transport.registry;
        if (reg && reg.isTaskUnknown(taskId)) { stop('task-404'); return false; }
        open = true;
        pollOnce();
        return true;
      },
      stop: function () { stop('stopped'); },
      close: function () { stop('closed'); },
      setChatId: function (id) { chatId = asId(id); eventsStopped = false; },
      setTaskId: function (id) { taskId = asId(id); },
      pollOnce: pollOnce,
      isOpen: function () { return open && !stopped; },
      isStopped: function () { return stopped; },
      isEventsStopped: function () { return eventsStopped; },
      getStopReason: function () { return stopReason; },
      getRounds: function () { return rounds; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* install(root): optional runtime wiring. Defensive by design — it   */
  /* never throws, never replaces a method it cannot wrap, and reports  */
  /* exactly what it patched. The assembler should ALSO apply the      */
  /* static edits in WIRING (below); install() is the safety net for   */
  /* the pieces that can only be reached at runtime (EnzoMonitor).     */
  /* ------------------------------------------------------------------ */

  function install(root) {
    var w = root || (typeof window !== 'undefined' ? window : null);
    var patched = [];
    var refused = [];
    if (!w) return { patched: patched, refused: ['no-window'] };
    try {
      var m = w.EnzoMonitor;
      if (m) {
        /* setChatId must never start polling a local-only chat, and
           must poll under the backend id when one is known. */
        if (typeof m.setChatId === 'function' && !m.setChatId.__pollingFixWrapped) {
          var origSetChatId = m.setChatId;
          var wrappedSetChatId = function (id) {
            var reg = api._registry;
            var clean = asId(id);
            if (!clean) return; /* empty chat id: refuse silently, no poll */
            if (reg) {
              if (reg.isChatLocalOnly(clean)) return;
              var backendId = reg.resolveBackendId(clean);
              if (backendId) return origSetChatId.call(m, backendId);
              /* Unconfirmed chat: do not hand it to the monitor at all.
                 The ask flow confirms it via confirmChat() once the
                 backend answers; until then there is nothing to poll. */
              return;
            }
            return origSetChatId.call(m, id);
          };
          wrappedSetChatId.__pollingFixWrapped = true;
          m.setChatId = wrappedSetChatId;
          patched.push('EnzoMonitor.setChatId');
        }
        /* Control + sources calls go through the guard: empty or
           unknown task ids never reach the network. */
        var controlMap = [
          ['pauseTask', 'pause'], ['resumeTask', 'resume'], ['cancelTask', 'cancel']
        ];
        controlMap.forEach(function (pair) {
          var name = pair[0];
          var action = pair[1];
          if (typeof m[name] === 'function' && !m[name].__pollingFixWrapped) {
            var orig = m[name];
            var wrapped = function (taskId) {
              var clean = asId(taskId);
              if (!clean) {
                return Promise.reject(new Error('taskId is required'));
              }
              var reg = api._registry;
              if (reg && !reg.isTaskKnown(clean)) {
                return Promise.reject(new Error('task ' + clean + ' was never confirmed by the backend'));
              }
              if (reg && !reg.canSendControl(clean, action)) {
                return Promise.reject(new Error('task control (' + action + ') for task ' + clean + ' was already sent'));
              }
              return orig.call(m, taskId);
            };
            wrapped.__pollingFixWrapped = true;
            m[name] = wrapped;
            patched.push('EnzoMonitor.' + name);
          }
        });
        if (typeof m.getSources === 'function' && !m.getSources.__pollingFixWrapped) {
          var origSources = m.getSources;
          var wrappedSources = function (taskId) {
            var clean = asId(taskId);
            if (!clean) return Promise.reject(new Error('taskId is required'));
            var reg = api._registry;
            if (reg && reg.isTaskUnknown(clean)) {
              return Promise.reject(new Error('task ' + clean + ' is unknown to the backend'));
            }
            return origSources.call(m, taskId);
          };
          wrappedSources.__pollingFixWrapped = true;
          m.getSources = wrappedSources;
          patched.push('EnzoMonitor.getSources');
        }
        if (typeof m.openTask === 'function' && !m.openTask.__pollingFixWrapped) {
          var origOpen = m.openTask;
          var wrappedOpen = function (taskId) {
            var clean = asId(taskId);
            if (!clean) return Promise.reject(new Error('taskId is required'));
            var reg = api._registry;
            if (reg && reg.isTaskUnknown(clean)) {
              return Promise.reject(new Error('task ' + clean + ' is unknown to the backend'));
            }
            return origOpen.call(m, taskId);
          };
          wrappedOpen.__pollingFixWrapped = true;
          m.openTask = wrappedOpen;
          patched.push('EnzoMonitor.openTask');
        }
      } else {
        refused.push('EnzoMonitor absent (load this piece after the monitor, or call install() again)');
      }
    } catch (e) {
      refused.push('install threw: ' + (e && e.message ? e.message : String(e)));
    }
    return { patched: patched, refused: refused };
  }

  /* Static wiring the assembler must apply in the export (install()
     cannot do these: they are call-site edits). Line numbers are the
     live export ~/workspace/your_files/enao-ai/enao-ai.html. */
  var WIRING = [
    '1. Load pieces/32-polling-fix.js BEFORE any script that polls, and call EnzoPollingFix.install() once window.EnzoMonitor exists (re-call after the monitor loads if it was absent).',
    '2. P-F v2req (~L12720): preserve the HTTP status — in the error path set err.status = r.status before throwing, so startPoll can tell a 404 from a network error. Until then, route task/chat calls through EnzoPollingFix.createTransport(window.fetch), which sets .status itself.',
    '3. ensureBackendChat success (~L12885): call EnzoPollingFix.confirmChat(chat.id, backendId) so the registry maps the local id to the backend id. handleAskResp research branch (~L13260): call EnzoPollingFix.confirmTask(resp.task_id) and confirmChat(chat.id, chat.backendId) before startPoll().',
    '4. startPoll (~L13154): replace v2get("/tasks/"+taskId+"/progress") with transport.getTaskProgress(taskId); replace the initial v2get("/tasks/"+taskId) with transport.getTask(taskId); replace fetchTaskSources(taskId) with transport.getTaskSources(taskId). Do NOT add a retry after a 404 — the transport already stopped that task.',
    '5. Monitor M1 pollOnce (~L20582): route the events long-poll through transport.getChatEvents(state.chatId, sinceCursor); on err.code "chat-local-only" call stop(), never schedulePoll(). Same for pollProgressOnce (~L20669) via transport.getTaskProgress, listTasks (~L21125) via transport.getChatTasks, openTask/fetchTaskInternal/fetchSourcesInternal/taskControl (~L20826/L20856/L20875) via the transport methods. Remove the comment claiming a 404 "still proves the backend is up" as a reason to retry.',
    '6. syncMonitorChat (~L44263, setInterval 1200 ms) and backendAsk (~L13290) and openChatById (~L13840): pass the BACKEND id to EnzoMonitor.setChatId — activeChat().backendId resolved via EnzoPollingFix.resolveBackendId(activeChat().id) — never the local cmwr* id. When resolveBackendId returns null, do NOT call setChatId/start() at all.',
    '7. Monitor restore() (~L19928): do NOT restore a persisted chatId into state.chatId and start polling it; restore history only, and re-confirm the chat through ensureBackendChat before any poll.',
    '8. v2Control (~L12818) and stopGeneration (~L13824): guard with EnzoPollingFix.guardTaskId(t.taskId) / canSendControl(taskId, "cancel") before v2post("/tasks/"+taskId+"/cancel"); never send when the guard refuses.',
    '9. Live Screen pollOnce (~L42544) / schedulePoll (~L42531): route task/progress/events through the transport; on a chat 404 skip only the events leg (keep task/progress while the task is known); on a task/progress 404 stop the loop. openLiveScreen (~L42840): resolve its chatId through the registry first; an unresolvable chat id means events polling stays off.',
    '10. Lifecycle cancelTask (~L39442) and notifyBackendCancel (~L39288): reject when asId(taskId) is null (kills the String(undefined) -> "undefined" trap) and when the registry marks the task unknown or a cancel was already sent; never notify the backend for an unknown id.',
    '11. postModify (~L25065, ~L29315) and agents fetchProgress (~L28495): route through transport.postTaskModify / getTaskProgress — both refuse empty ids with zero fetch calls.'
  ];

  var api = {
    VERSION: VERSION,
    asId: asId,
    isNonEmptyId: isNonEmptyId,
    is404: is404,
    isTerminalTaskState: isTerminalTaskState,
    createRegistry: createRegistry,
    createTransport: createTransport,
    createEventPoller: createEventPoller,
    createProgressPoller: createProgressPoller,
    createMonitorPoller: createMonitorPoller,
    createLiveScreenPoller: createLiveScreenPoller,
    install: install,
    WIRING: WIRING,
    /* Shared page-level registry used by install() and by the ask flow
       helpers below. Tests create their own registries instead. */
    _registry: createRegistry(),
    confirmChat: function (localId, backendId) {
      return api._registry.confirmChat(localId, backendId);
    },
    confirmTask: function (taskId) {
      return api._registry.confirmTask(taskId);
    },
    markChatLocalOnly: function (chatId) {
      return api._registry.markChatLocalOnly(chatId);
    },
    resolveBackendId: function (localId) {
      return api._registry.resolveBackendId(localId);
    },
    guardTaskId: function (taskId) {
      var id = asId(taskId);
      if (!id) return { ok: false, reason: 'empty-task-id' };
      if (api._registry.isTaskUnknown(id)) return { ok: false, reason: 'task-unknown' };
      return { ok: true, taskId: id };
    },
    guardChatId: function (chatId) {
      var id = asId(chatId);
      if (!id) return { ok: false, reason: 'empty-chat-id' };
      if (api._registry.isChatLocalOnly(id)) return { ok: false, reason: 'chat-local-only' };
      return { ok: true, chatId: id, backendId: api._registry.resolveBackendId(id) };
    },
    canSendControl: function (taskId, action) {
      return api._registry.canSendControl(taskId, action);
    },
    snapshot: function () {
      return api._registry.snapshot();
    }
  };

  return api;
});
