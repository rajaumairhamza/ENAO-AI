
/* ============================================================================
 * ENAO AI — research-live, piece 21-lifecycle.js
 * PRD section 2: search lifecycle repair.
 *
 * What this piece does:
 *  - A task-state machine with states idle, processing, searching,
 *    researching, executing, validating, completed, failed, cancelled.
 *    Every transition goes through setState(); an illegal transition is
 *    rejected, recorded in the instance log, and NEVER silently applied
 *    (the task keeps its previous state).
 *  - cancelTask(taskId, reason): aborts registered AbortControllers,
 *    clears registered timers and polling intervals, runs registered
 *    sub-operation cancel functions, hides the indicator, and notifies
 *    the backend with POST /api/v2/tasks/{id}/cancel when a fetch
 *    implementation is available. Cancelling twice is safe: the second
 *    call is a no-op and does not re-notify the backend.
 *  - completeTask(taskId): marks the task completed, clears ALL loading
 *    indicators, and cancels any remaining background sub-operations for
 *    that task, so no background searching continues after the final
 *    answer. failTask(taskId, error) does the same for the failed end.
 *  - syncStatus(taskId, backendStatus): maps a backend task status to
 *    the frontend state; on a terminal backend status (completed,
 *    failed, cancelled) the frontend indicators clear immediately.
 *  - purgeStaleState(stored): persistence guard. On load, any stored
 *    record of a completed / failed / cancelled task is forced to a
 *    non-searching indicator, so a stale state can never restore a
 *    searching indicator after a reload.
 *  - Duplicate prevention: startTask() with the same logical key as an
 *    active task cancels the old task first (reason 'superseded');
 *    starting the same task id while it is active reuses it instead of
 *    running two searches; starting a terminal task id starts it fresh.
 *  - setIndicator(state, el): DOM helper. Shows the indicator only for
 *    active states (processing / searching / researching / executing /
 *    validating) and hides it for idle / completed / failed / cancelled.
 *    There is no path through this piece that leaves an indicator
 *    permanently active.
 *
 * What it does NOT do:
 *  - No network of its own: the backend cancel POST uses an injected
 *    fetch (opts.fetch) or the global fetch when present, and a missing
 *    fetch only means "backend not notified", never an exception. The
 *    piece never starts a search, never renders an answer, and never
 *    touches the chat messages.
 *  - No DOM except setIndicator() (and the optional label update inside
 *    it). All state work is pure and testable without a DOM.
 *  - No silent downgrade: a terminal task is never quietly reopened.
 *    Only startTask() may start a fresh run for a terminal task id.
 *
 * Style: plain ES5, var + function declarations, no modules.
 * Zero emojis. No hardcoded topic names.
 * ========================================================================== */
(function (root) {

var VERSION = '21-lifecycle v1.0 (enao-research-live, 22 Nov 2026)';

var STATES = [
  'idle', 'processing', 'searching', 'researching', 'executing',
  'validating', 'completed', 'failed', 'cancelled'
];

var ACTIVE_STATES = [
  'processing', 'searching', 'researching', 'executing', 'validating'
];

var TERMINAL_STATES = ['completed', 'failed', 'cancelled'];

/* Allowed outgoing transitions. Terminal states have none: nothing
   leaves completed / failed / cancelled through setState(). */
var TRANSITIONS = {
  idle: ['processing', 'searching', 'researching', 'executing'],
  processing: ['searching', 'researching', 'executing', 'validating',
    'completed', 'failed', 'cancelled'],
  searching: ['researching', 'executing', 'validating',
    'completed', 'failed', 'cancelled'],
  researching: ['executing', 'validating',
    'completed', 'failed', 'cancelled'],
  executing: ['validating', 'completed', 'failed', 'cancelled'],
  validating: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

/* Backend task statuses (server.py: TERMINAL_STATES, handle_progress,
   handle_task_control) mapped to frontend states. Backend 'done' is
   the agent-level spelling of completed. */
var BACKEND_STATUS_MAP = {
  queued: 'processing',
  running: 'executing',
  paused: 'processing',
  verifying: 'validating',
  searching: 'searching',
  researching: 'researching',
  executing: 'executing',
  processing: 'processing',
  validating: 'validating',
  done: 'completed',
  completed: 'completed',
  partially_completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled'
};

/* Indicator label per active state, matching the live typing words
   (showTyping / setTypingStatus in the export). */
var INDICATOR_LABELS = {
  processing: 'Thinking\u2026',
  searching: 'Searching\u2026',
  researching: 'Researching\u2026',
  executing: 'Working\u2026',
  validating: 'Checking\u2026'
};

var DEFAULT_API_BASE = window.EnzoPagesBackend.getBackendBase();

/* ---------- small helpers ---------- */
function lcTrim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '');
}
function lcInList(list, value) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}
function lcIsTerminal(state) {
  return lcInList(TERMINAL_STATES, state);
}
function lcIsActive(state) {
  return lcInList(ACTIVE_STATES, state);
}
function lcNow() {
  return Date.now();
}

/* ---------- PUBLIC (pure): mapBackendStatus ---------- */
/* Backend status string -> frontend state, or null when unknown.
   Unknown statuses never move the frontend state. */
function mapBackendStatus(backendStatus) {
  var s = lcTrim(backendStatus).toLowerCase();
  if (!s) return null;
  if (BACKEND_STATUS_MAP.hasOwnProperty(s)) return BACKEND_STATUS_MAP[s];
  return null;
}

/* ---------- PUBLIC (pure): purgeStaleState ---------- */
/* Persistence guard. stored may be one record, an array of records,
   or {tasks: {...}} / {tasks: [...]}. Every record whose state is
   terminal is forced to a non-searching indicator (indicatorActive,
   searching and isGenerating all false); active-state records are
   left untouched. Returns {state, purged, restorable}: state is the
   cleaned copy in the same shape it arrived in, purged lists the
   task ids that were forced clean, restorable lists the task ids
   whose active state may legitimately be resumed. The input is
   never mutated. */
function purgeStaleState(stored) {
  var purged = [];
  var restorable = [];
  if (stored === null || stored === undefined) {
    return { state: stored, purged: purged, restorable: restorable };
  }
  function cleanRecord(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    var out = {};
    var k;
    for (k in rec) {
      if (rec.hasOwnProperty(k)) out[k] = rec[k];
    }
    var st = out.state || out.status || 'idle';
    var id = out.taskId || out.task_id || out.id || null;
    if (lcIsTerminal(st)) {
      out.indicatorActive = false;
      out.searching = false;
      out.isGenerating = false;
      if (id !== null && id !== undefined) purged.push(String(id));
    } else if (lcIsActive(st)) {
      if (id !== null && id !== undefined) restorable.push(String(id));
    }
    return out;
  }
  var cleaned;
  if (Array.isArray(stored)) {
    cleaned = [];
    for (var i = 0; i < stored.length; i++) {
      cleaned.push(cleanRecord(stored[i]));
    }
  } else if (typeof stored === 'object' &&
             stored.tasks !== undefined &&
             stored.tasks !== null) {
    cleaned = {};
    var k2;
    for (k2 in stored) {
      if (stored.hasOwnProperty(k2)) cleaned[k2] = stored[k2];
    }
    if (Array.isArray(stored.tasks)) {
      cleaned.tasks = [];
      for (var j = 0; j < stored.tasks.length; j++) {
        cleaned.tasks.push(cleanRecord(stored.tasks[j]));
      }
    } else if (typeof stored.tasks === 'object') {
      cleaned.tasks = {};
      for (var key in stored.tasks) {
        if (stored.tasks.hasOwnProperty(key)) {
          cleaned.tasks[key] = cleanRecord(stored.tasks[key]);
        }
      }
    }
  } else if (typeof stored === 'object') {
    cleaned = cleanRecord(stored);
  } else {
    cleaned = stored;
  }
  return { state: cleaned, purged: purged, restorable: restorable };
}

/* ---------- PUBLIC: setIndicator ---------- */
/* Shows the indicator only for active states; hides it for idle /
   completed / failed / cancelled. el defaults to the live typing row
   (#typingRow); when no element is found nothing throws and false is
   returned. The typing label (#typingLabel) follows the state word
   when it exists. Returns true when the indicator is visible. */
function setIndicator(state, el) {
  var visible = lcIsActive(state);
  var row = el || null;
  if (!row && typeof document !== 'undefined' &&
      document && typeof document.getElementById === 'function') {
    row = document.getElementById('typingRow');
  }
  if (!row) return false;
  try {
    if (!row.style) row.style = {};
    row.style.display = visible ? 'flex' : 'none';
    if (visible && typeof document !== 'undefined' &&
        document && typeof document.getElementById === 'function') {
      var label = document.getElementById('typingLabel');
      if (label && INDICATOR_LABELS[state]) label.textContent = INDICATOR_LABELS[state];
    }
    if (row.setAttribute) {
      row.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
  } catch (e) {
    return false;
  }
  return visible;
}

/* ---------- lifecycle instance ---------- */
/* createLifecycle(opts):
 *   opts.fetch    — fetch implementation for the backend cancel POST
 *                    (defaults to the global fetch when present;
 *                    null disables backend notification).
 *   opts.apiBase  — backend base, default '/api/v2'.
 *   opts.clock    — {setTimeout, clearTimeout, setInterval,
 *                    clearInterval}; defaults to the globals.
 *                    Injected in tests so timers can be observed.
 *   opts.indicatorEl — element (or null) passed to setIndicator().
 *   opts.onStateChange(taskId, from, to) — listener.
 *   opts.onIllegal(entry) — listener for rejected transitions.
 *   opts.logToConsole — when true, illegal transitions also go to
 *                    console.warn (default false: the log holds them).
 */
function createLifecycle(opts) {
  var o = opts || {};
  var fetchFn = (typeof o.fetch !== 'undefined') ? o.fetch
    : ((typeof fetch !== 'undefined') ? fetch : null);
  var apiBase = typeof o.apiBase === 'string' ? o.apiBase : DEFAULT_API_BASE;
  var clock = o.clock || {};
  var setTimeoutFn = clock.setTimeout ||
    ((typeof setTimeout !== 'undefined') ? setTimeout : null);
  var clearTimeoutFn = clock.clearTimeout ||
    ((typeof clearTimeout !== 'undefined') ? clearTimeout : null);
  var clearIntervalFn = clock.clearInterval ||
    ((typeof clearInterval !== 'undefined') ? clearInterval : null);
  var indicatorEl = (typeof o.indicatorEl !== 'undefined') ? o.indicatorEl : null;
  var onStateChange = (typeof o.onStateChange === 'function') ? o.onStateChange : null;
  var onIllegal = (typeof o.onIllegal === 'function') ? o.onIllegal : null;
  var logToConsole = o.logToConsole === true;

  var tasks = {};   /* taskId -> record */
  var log = [];     /* rejected transitions + lifecycle events */

  function recordLog(entry) {
    entry.at = lcNow();
    log.push(entry);
    if (logToConsole && typeof console !== 'undefined' &&
        console && typeof console.warn === 'function') {
      console.warn('[EnzoSearchLifecycle] ' + entry.type +
        (entry.taskId ? ' task=' + entry.taskId : '') +
        (entry.detail ? ' ' + entry.detail : ''));
    }
    return entry;
  }

  function getRecord(taskId) {
    return tasks.hasOwnProperty(taskId) ? tasks[taskId] : null;
  }

  function newRecord(taskId, logicalKey) {
    return {
      taskId: taskId,
      logicalKey: logicalKey || taskId,
      state: 'idle',
      reason: null,
      error: null,
      controllers: [],
      timers: [],
      polls: [],
      subOps: [],        /* {id, cancel} */
      backendNotified: false,
      backendPromise: null,
      createdAt: lcNow(),
      updatedAt: lcNow()
    };
  }

  function applyIndicator(rec) {
    setIndicator(rec.state, indicatorEl);
  }

  /* Clear every in-flight frontend handle for a record: abort
     controllers, clear timers and polling intervals, run every
     sub-operation cancel function (each guarded so one throwing
     cancel cannot block the rest). Returns how many handles were
     cleared. */
  function clearHandles(rec) {
    var cleared = 0;
    var i;
    for (i = 0; i < rec.controllers.length; i++) {
      try {
        if (rec.controllers[i] && typeof rec.controllers[i].abort === 'function') {
          rec.controllers[i].abort();
          cleared++;
        }
      } catch (e) {}
    }
    rec.controllers = [];
    for (i = 0; i < rec.timers.length; i++) {
      try {
        if (clearTimeoutFn) clearTimeoutFn(rec.timers[i]);
        cleared++;
      } catch (e) {}
    }
    rec.timers = [];
    for (i = 0; i < rec.polls.length; i++) {
      try {
        if (clearIntervalFn) clearIntervalFn(rec.polls[i]);
        cleared++;
      } catch (e) {}
    }
    rec.polls = [];
    for (i = 0; i < rec.subOps.length; i++) {
      try {
        if (rec.subOps[i] && typeof rec.subOps[i].cancel === 'function') {
          rec.subOps[i].cancel();
          cleared++;
        }
      } catch (e) {}
    }
    rec.subOps = [];
    return cleared;
  }

  /* POST /api/v2/tasks/{id}/cancel. Fire-and-forget for the caller:
     the returned promise never rejects (a failure is recorded on
     the record instead). Returns the promise, or null when no fetch
     implementation is available. */
  function notifyBackendCancel(rec) {
    /* v59 (Piece 32 [10]): never notify the backend for an empty or unknown id, or when a cancel was already sent. */
    if (typeof window !== 'undefined' && window.EnzoPollingFix) {
      if (!window.EnzoPollingFix.asId(rec && rec.taskId)) return null;
      if (!window.EnzoPollingFix.canSendControl(rec.taskId, 'cancel')) return null;
    }
    if (!fetchFn) return null;
    if (rec.backendNotified) return rec.backendPromise;
    rec.backendNotified = true;
    var url = apiBase + '/tasks/' + encodeURIComponent(rec.taskId) + '/cancel';
    var p = null;
    try {
      p = fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (e) {
      rec.backendPromise = null;
      recordLog({ type: 'backend-cancel-failed', taskId: rec.taskId, detail: String(e && e.message ? e.message : e) });
      return null;
    }
    rec.backendPromise = p;
    if (p && typeof p.then === 'function') {
      p.then(function () {}, function (err) {
        recordLog({ type: 'backend-cancel-failed', taskId: rec.taskId, detail: String(err && err.message ? err.message : err) });
      });
    }
    return p;
  }

  function moveTo(rec, next, reason) {
    var from = rec.state;
    rec.state = next;
    rec.updatedAt = lcNow();
    if (reason !== undefined) rec.reason = reason;
    applyIndicator(rec);
    if (onStateChange) {
      try { onStateChange(rec.taskId, from, next); } catch (e) {}
    }
    return { ok: true, taskId: rec.taskId, from: from, to: next };
  }

  /* ---------- PUBLIC: setState ---------- */
  /* The ONLY way a task changes state. Same-state is a no-op success.
     Any other transition not in TRANSITIONS is rejected, logged, and
     the state is left untouched. */
  function setState(taskId, next, reason) {
    var id = String(taskId);
    var target = lcTrim(next);
    var rec = getRecord(id);
    if (!rec) {
      rec = newRecord(id);
      tasks[id] = rec;
    }
    if (rec.state === target) {
      return { ok: true, taskId: id, from: rec.state, to: target, noop: true };
    }
    if (!lcInList(STATES, target)) {
      recordLog({ type: 'illegal-transition', taskId: id,
        detail: 'unknown state "' + target + '" from "' + rec.state + '"' });
      if (onIllegal) {
        try { onIllegal(log[log.length - 1]); } catch (e) {}
      }
      return { ok: false, taskId: id, from: rec.state, to: target, rejected: true, reason: 'unknown-state' };
    }
    if (!lcInList(TRANSITIONS[rec.state] || [], target)) {
      recordLog({ type: 'illegal-transition', taskId: id,
        detail: 'rejected "' + rec.state + '" -> "' + target + '"' });
      if (onIllegal) {
        try { onIllegal(log[log.length - 1]); } catch (e) {}
      }
      return { ok: false, taskId: id, from: rec.state, to: target, rejected: true, reason: 'illegal-transition' };
    }
    return moveTo(rec, target, reason);
  }

  /* ---------- PUBLIC: startTask ---------- */
  /* Duplicate prevention. logicalKey defaults to the task id.
     - Same task id, still active: reuse it (no second search).
     - Same task id, terminal: start it fresh (idle -> processing).
     - Different task id, same logical key, old one active: cancel
       the old one first (reason 'superseded'), then start the new one.
     Returns {task, reused, superseded}. */
  function startTask(taskId, startOpts) {
    var id = String(taskId);
    var so = startOpts || {};
    var logicalKey = so.logicalKey ? String(so.logicalKey) : id;
    var rec = getRecord(id);
    if (rec && lcIsActive(rec.state)) {
      return { task: publicTask(rec), reused: true, superseded: null };
    }
    var superseded = null;
    var key;
    for (key in tasks) {
      if (tasks.hasOwnProperty(key) && key !== id) {
        var other = tasks[key];
        if (other.logicalKey === logicalKey && lcIsActive(other.state)) {
          cancelTask(key, 'superseded');
          superseded = key;
        }
      }
    }
    if (!rec) {
      rec = newRecord(id, logicalKey);
      tasks[id] = rec;
    } else {
      rec.logicalKey = logicalKey;
      rec.reason = null;
      rec.error = null;
      rec.backendNotified = false;
      rec.backendPromise = null;
    }
    var res = setState(id, so.initialState || 'processing');
    if (!res.ok) {
      /* Terminal record that setState refused to reopen: reset via
         the explicit fresh-start path (the only reopen allowed). */
      rec.state = 'idle';
      rec.updatedAt = lcNow();
      setState(id, so.initialState || 'processing');
    }
    return { task: publicTask(rec), reused: false, superseded: superseded };
  }

  /* ---------- PUBLIC: register handles ---------- */
  function registerAbort(taskId, controller) {
    var rec = getRecord(String(taskId));
    if (!rec || !controller) return false;
    rec.controllers.push(controller);
    return true;
  }
  function registerTimer(taskId, timerId) {
    var rec = getRecord(String(taskId));
    if (!rec || timerId === null || timerId === undefined) return false;
    rec.timers.push(timerId);
    return true;
  }
  function registerPoll(taskId, intervalId) {
    var rec = getRecord(String(taskId));
    if (!rec || intervalId === null || intervalId === undefined) return false;
    rec.polls.push(intervalId);
    return true;
  }
  /* registerSubOp(taskId, subId, cancelFn): a background
     sub-operation (an extra search pass, a poll loop, a fetch) with
     its own cancel function. Cancelled on cancel / complete / fail. */
  function registerSubOp(taskId, subId, cancelFn) {
    var rec = getRecord(String(taskId));
    if (!rec || typeof cancelFn !== 'function') return false;
    rec.subOps.push({ id: subId, cancel: cancelFn });
    return true;
  }

  /* ---------- PUBLIC: cancelTask ---------- */
  /* Cancelling twice is safe: the second call returns
     {ok: true, alreadyCancelled: true} and does not re-notify the
     backend. Cancelling an unknown task id is also safe: a record is
     created straight in the cancelled state and the backend is still
     told (best effort). */
  function cancelTask(taskId, reason) {
    /* v59 (Piece 32 [10]): asId kills the String(undefined) -> 'undefined' trap; an empty id is rejected, never recorded or sent. */
    var id = (typeof window !== 'undefined' && window.EnzoPollingFix) ? window.EnzoPollingFix.asId(taskId) : String(taskId);
    if (id === null || id === undefined || id === '') return { ok: false, taskId: taskId, rejected: true, reason: 'empty-task-id' };
    var rec = getRecord(id);
    if (!rec) {
      rec = newRecord(id);
      rec.state = 'cancelled';
      rec.reason = reason || 'cancelled';
      tasks[id] = rec;
      notifyBackendCancel(rec);
      applyIndicator(rec);
      return { ok: true, taskId: id, from: 'idle', to: 'cancelled', unknown: true, backendPromise: rec.backendPromise };
    }
    if (rec.state === 'cancelled') {
      return { ok: true, taskId: id, from: 'cancelled', to: 'cancelled', alreadyCancelled: true, backendPromise: rec.backendPromise };
    }
    if (lcIsTerminal(rec.state)) {
      return { ok: false, taskId: id, from: rec.state, to: 'cancelled', rejected: true, reason: 'already-terminal' };
    }
    var from = rec.state;
    var cleared = clearHandles(rec);
    notifyBackendCancel(rec);
    var res = moveTo(rec, 'cancelled', reason || 'cancelled');
    res.handlesCleared = cleared;
    res.from = from;
    res.backendPromise = rec.backendPromise;
    return res;
  }

  /* ---------- PUBLIC: completeTask ---------- */
  /* Final answer delivered: mark completed, clear ALL loading
     indicators, and cancel any remaining background sub-operations
     for that task. No background searching after the final answer. */
  function completeTask(taskId) {
    var id = String(taskId);
    var rec = getRecord(id);
    if (!rec) {
      return { ok: false, taskId: id, reason: 'unknown-task' };
    }
    if (rec.state === 'completed') {
      return { ok: true, taskId: id, from: 'completed', to: 'completed', noop: true };
    }
    if (lcIsTerminal(rec.state)) {
      return { ok: false, taskId: id, from: rec.state, to: 'completed', rejected: true, reason: 'already-terminal' };
    }
    var from = rec.state;
    var cleared = clearHandles(rec);
    var res = moveTo(rec, 'completed');
    res.handlesCleared = cleared;
    res.from = from;
    return res;
  }

  /* ---------- PUBLIC: failTask ---------- */
  function failTask(taskId, error) {
    var id = String(taskId);
    var rec = getRecord(id);
    if (!rec) {
      return { ok: false, taskId: id, reason: 'unknown-task' };
    }
    if (rec.state === 'failed') {
      return { ok: true, taskId: id, from: 'failed', to: 'failed', noop: true };
    }
    if (lcIsTerminal(rec.state)) {
      return { ok: false, taskId: id, from: rec.state, to: 'failed', rejected: true, reason: 'already-terminal' };
    }
    var from = rec.state;
    var cleared = clearHandles(rec);
    rec.error = (error && error.message) ? error.message : (error ? String(error) : null);
    var res = moveTo(rec, 'failed');
    res.handlesCleared = cleared;
    res.from = from;
    return res;
  }

  /* ---------- PUBLIC: syncStatus ---------- */
  /* Map a backend task status onto the frontend state. On a terminal
     backend status the frontend indicators clear immediately (via
     moveTo -> applyIndicator, plus clearHandles so no poll or fetch
     keeps running for a finished task). Unknown backend statuses are
     ignored and logged; they never move the frontend state. */
  function syncStatus(taskId, backendStatus) {
    var id = String(taskId);
    var mapped = mapBackendStatus(backendStatus);
    if (mapped === null) {
      recordLog({ type: 'unknown-backend-status', taskId: id,
        detail: 'backend status "' + String(backendStatus) + '" not recognised' });
      return { ok: false, taskId: id, backendStatus: backendStatus, applied: false, reason: 'unknown-status' };
    }
    var rec = getRecord(id);
    if (!rec) {
      rec = newRecord(id);
      tasks[id] = rec;
    }
    if (rec.state === mapped) {
      return { ok: true, taskId: id, from: rec.state, to: mapped, noop: true, applied: true };
    }
    if (lcIsTerminal(mapped)) {
      var from = rec.state;
      var cleared = clearHandles(rec);
      var res = moveTo(rec, mapped);
      res.handlesCleared = cleared;
      res.from = from;
      res.backendStatus = backendStatus;
      res.terminalCleared = true;
      return res;
    }
    if (lcIsTerminal(rec.state)) {
      recordLog({ type: 'illegal-transition', taskId: id,
        detail: 'backend "' + String(backendStatus) + '" cannot reopen terminal state "' + rec.state + '"' });
      return { ok: false, taskId: id, from: rec.state, to: mapped, rejected: true, reason: 'already-terminal', backendStatus: backendStatus };
    }
    /* Active -> active backend updates: only forward moves are
       applied; a backward backend status is ignored, never forced. */
    if (lcInList(TRANSITIONS[rec.state] || [], mapped)) {
      var r2 = moveTo(rec, mapped);
      r2.backendStatus = backendStatus;
      return r2;
    }
    return { ok: true, taskId: id, from: rec.state, to: rec.state, applied: false, reason: 'backward-status-ignored', backendStatus: backendStatus };
  }

  /* ---------- PUBLIC: reads ---------- */
  function publicTask(rec) {
    return {
      taskId: rec.taskId,
      logicalKey: rec.logicalKey,
      state: rec.state,
      reason: rec.reason,
      error: rec.error,
      activeHandles: rec.controllers.length + rec.timers.length +
        rec.polls.length + rec.subOps.length,
      backendNotified: rec.backendNotified,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    };
  }
  function getTask(taskId) {
    var rec = getRecord(String(taskId));
    return rec ? publicTask(rec) : null;
  }
  function getState(taskId) {
    var rec = getRecord(String(taskId));
    return rec ? rec.state : 'idle';
  }
  function listTasks() {
    var out = [];
    var key;
    for (key in tasks) {
      if (tasks.hasOwnProperty(key)) out.push(publicTask(tasks[key]));
    }
    return out;
  }
  function getLog() {
    return log.slice();
  }
  function clearLog() {
    log = [];
  }

  return {
    VERSION: VERSION,
    setState: setState,
    getState: getState,
    getTask: getTask,
    listTasks: listTasks,
    startTask: startTask,
    cancelTask: cancelTask,
    completeTask: completeTask,
    failTask: failTask,
    syncStatus: syncStatus,
    registerAbort: registerAbort,
    registerTimer: registerTimer,
    registerPoll: registerPoll,
    registerSubOp: registerSubOp,
    setIndicator: function (state) { return setIndicator(state, indicatorEl); },
    getLog: getLog,
    clearLog: clearLog
  };
}

/* ---------- export tail (guarded) ---------- */
var EnzoSearchLifecycle = {
  VERSION: VERSION,
  STATES: STATES,
  ACTIVE_STATES: ACTIVE_STATES,
  TERMINAL_STATES: TERMINAL_STATES,
  TRANSITIONS: TRANSITIONS,
  BACKEND_STATUS_MAP: BACKEND_STATUS_MAP,
  isActiveState: lcIsActive,
  isTerminalState: lcIsTerminal,
  mapBackendStatus: mapBackendStatus,
  purgeStaleState: purgeStaleState,
  setIndicator: setIndicator,
  createLifecycle: createLifecycle
};

if (typeof root !== 'undefined') root.EnzoSearchLifecycle = EnzoSearchLifecycle;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnzoSearchLifecycle;
}

})(typeof window !== 'undefined' ? window : this);
