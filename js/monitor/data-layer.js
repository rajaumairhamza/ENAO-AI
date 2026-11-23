
/* ============================================================================
 * ENAO AI — Live Research Monitor: DATA LAYER (Piece M1)
 * ----------------------------------------------------------------------------
 * Single self-contained script, no dependencies. Exposes window.EnzoMonitor.
 *
 * What it does:
 *  - Long-polls GET /api/v2/chats/{chatId}/events?since=<event_id> (25 s
 *    server hold) and turns each REAL backend event into at most one
 *    Activity. Nothing is invented: zero events means zero activities.
 *  - Polls GET /api/v2/tasks/{taskId}/progress (~every 2 s while a task is
 *    active) to keep agent statuses / retry counts honest, and fetches
 *    GET /api/v2/tasks/{taskId}/sources on completion and on demand.
 *  - Persists ALL history to localStorage under key "enao_monitor_v1" and
 *    restores it on load, so a refresh keeps the timeline.
 *  - pause / resume / cancel call the real POST /api/v2/tasks/{id}/...
 *    endpoints and update local state from the response only.
 *  - getSummary() builds a completion summary ONLY from the real task
 *    result + real sources. Anything unknown is stated as unknown.
 *
 * What it NEVER does:
 *  - No /api/search event stream exists, so when /api/v2 is unreachable
 *    the monitor serves stored history only and synthesises NO live
 *    activity. There is no fallback live source.
 *  - No emojis anywhere. UI strings are English only.
 *  - No paid plan / API key / pricing / payment elements, no new backend
 *    service: it reuses /api/v2/ only.
 *
 * Event-type ground truth (see 01-monitor-data.EVIDENCE.md):
 *  Canonical set: progress/progress.py EVENT_TYPES (lines 60-73).
 *  Actually emitted by the live orchestrator (orchestrator.py) — which
 *  writes straight to the events table without that validation — plus
 *  control/control.py (P7, used by server.py handle_task_control).
 *  Types with no emitter anywhere are mapped defensively but documented
 *  as never-observed.
 *
 * Frontend hook: window.EnzoMonitor.noteFrontendStep(step) lets the
 * frontend ask flow record its own REAL client-side steps (e.g.
 * "question sent", "fallback proxy in use") as activities with kind
 * prefixed "client:". The data layer never calls it itself.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var API_BASE = window.EnzoPagesBackend.getBackendBase();
  var STORAGE_KEY = 'enao_monitor_v1';
  var STORAGE_VERSION = 1;
  var LONG_POLL_TIMEOUT_MS = 30000; // Server holds at most 25 s.
  var PROGRESS_INTERVAL_MS = 2000; // Poll progress while a task is active.
  var BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]; // Capped at 30 s.
  var MAX_SEEN_EVENTS = 2000; // Bounded dedupe set (persisted).
  var MAX_ACTIVITIES_PER_TASK = 500; // Safety cap; oldest dropped first.

  var TERMINAL_TASK_STATES = {
    completed: true,
    partially_completed: true,
    failed: true,
    cancelled: true
  };

  /* Human labels for the real agent roles (orchestrator.py ROLES). */
  var ROLE_LABELS = {
    research_discovery: 'Discovering sources',
    official_source: 'Checking official sources',
    current_info: 'Gathering current information',
    data_collection: 'Collecting data',
    technical_analysis: 'Analysing technical details',
    product_comparison: 'Comparing options',
    historical_research: 'Researching background',
    fact_verification: 'Verifying facts',
    contradiction_detection: 'Checking for contradictions',
    quality_assurance: 'Checking quality',
    report_synthesis: 'Writing the report'
  };

  var RESEARCH_ROLES = {
    research_discovery: true,
    official_source: true,
    current_info: true,
    data_collection: true,
    technical_analysis: true,
    product_comparison: true,
    historical_research: true
  };

  var VERIFICATION_ROLES = {
    fact_verification: true,
    contradiction_detection: true,
    quality_assurance: true
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers (no dependencies)                                     */
  /* ------------------------------------------------------------------ */

  function root() {
    if (typeof window !== 'undefined') return window;
    return (typeof globalThis !== 'undefined') ? globalThis : this;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function asNonEmptyString(v) {
    var s = asString(v).trim();
    return s ? s : null;
  }

  /* Backend created_at is unix seconds; task timestamps are ISO or epoch.
     Normalise to an ISO string, or null when unusable. Never invents a time. */
  function toIso(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      if (!isFinite(value) || value <= 0) return null;
      // Seconds (< 1e12) vs milliseconds.
      var ms = value < 1000000000000 ? value * 1000 : value;
      var d = new Date(ms);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof value === 'string') {
      var parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
      var num = Number(value);
      if (isFinite(num) && num > 0) return toIso(num);
      return null;
    }
    return null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function detailOf(event) {
    if (isPlainObject(event.detail)) return event.detail;
    if (typeof event.detail === 'string') {
      try {
        var parsed = JSON.parse(event.detail);
        return isPlainObject(parsed) ? parsed : { value: event.detail };
      } catch (e) {
        return { value: event.detail };
      }
    }
    return {};
  }

  /* First usable URL from an event detail (source links, never invented). */
  function urlFromDetail(detail) {
    var candidates = [
      detail.url, detail.final_url,
      detail.source && detail.source.url,
      detail.source && detail.source.final_url
    ];
    for (var i = 0; i < candidates.length; i++) {
      var u = asNonEmptyString(candidates[i]);
      if (u) return u;
    }
    return null;
  }

  function titleFromDetail(detail) {
    var s = detail.source;
    if (isPlainObject(s)) {
      var t = asNonEmptyString(s.title);
      if (t) return t;
    }
    return asNonEmptyString(detail.title);
  }

  function roleLabel(role) {
    var r = asString(role);
    if (ROLE_LABELS[r]) return ROLE_LABELS[r];
    return r || 'Agent step';
  }

  function kindForRole(role) {
    var r = asString(role);
    if (r === 'report_synthesis') return 'synthesis';
    if (VERIFICATION_ROLES[r]) return 'verification';
    if (RESEARCH_ROLES[r]) return 'research';
    return 'research';
  }

  function whyForRole(role, subtask) {
    var s = asNonEmptyString(subtask);
    if (s) return s;
    return 'Step of the research plan (' + roleLabel(role) + ').';
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  var state = {
    connected: false,
    backendAvailable: false,
    chatId: null,
    activeTaskId: null,
    tasks: {} // taskId -> { task, activities, sources, summary, lastActivityAt }
  };

  /* Internal-only bookkeeping (never exposed via getState()). */
  var seenEventIds = {}; // event_id -> true (dedupe, persisted, bounded)
  var seenEventOrder = []; // insertion order for the bound
  var sinceCursor = 0; // Highest event_id consumed for the current chat.
  var agentActivityIndex = {}; // taskId -> { agentId -> activityId }
  var sourcesMeta = {}; // taskId -> { excluded, excludedNote }
  var pendingClientSteps = []; // noteFrontendStep() calls with no active task
  var clientStepCounter = 0;
  var subscribers = [];
  var running = false;
  var pollTimer = null;
  var progressTimer = null;
  var backoffStep = 0;
  var progressInFlight = {}; // taskId -> true while a progress fetch runs

  /* ------------------------------------------------------------------ */
  /* Persistence (localStorage key "enao_monitor_v1")                    */
  /* ------------------------------------------------------------------ */

  function storage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* storage unavailable (e.g. private mode) */ }
    return null;
  }

  function save() {
    var store = storage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        chatId: state.chatId,
        activeTaskId: state.activeTaskId,
        since: sinceCursor,
        seenEventIds: seenEventOrder.slice(-MAX_SEEN_EVENTS),
        tasks: state.tasks,
        sourcesMeta: sourcesMeta,
        pendingClientSteps: pendingClientSteps,
        clientStepCounter: clientStepCounter
      }));
    } catch (e) { /* Quota / unavailable: history stays in memory only. */ }
  }

  function restore() {
    var store = storage();
    if (!store) return;
    var raw = null;
    try { raw = store.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!isPlainObject(data) || data.version !== STORAGE_VERSION) return;
    /* v59 (Piece 32 [7]): a persisted chatId is NOT restored into state.chatId and never polled — history only. The chat is re-confirmed through ensureBackendChat before any poll. */
    if (typeof data.activeTaskId === 'string') state.activeTaskId = data.activeTaskId;
    if (typeof data.since === 'number' && data.since >= 0) sinceCursor = data.since;
    if (Array.isArray(data.seenEventIds)) {
      seenEventOrder = data.seenEventIds.filter(function (id) {
        return typeof id === 'number';
      }).slice(-MAX_SEEN_EVENTS);
      seenEventIds = {};
      seenEventOrder.forEach(function (id) { seenEventIds[id] = true; });
    }
    if (isPlainObject(data.tasks)) state.tasks = data.tasks;
    if (isPlainObject(data.sourcesMeta)) sourcesMeta = data.sourcesMeta;
    if (Array.isArray(data.pendingClientSteps)) {
      pendingClientSteps = data.pendingClientSteps;
    }
    if (typeof data.clientStepCounter === 'number') {
      clientStepCounter = data.clientStepCounter;
    }
    // Rebuild the agent -> activity index from restored activities.
    agentActivityIndex = {};
    Object.keys(state.tasks).forEach(function (taskId) {
      var entry = state.tasks[taskId];
      if (!entry || !Array.isArray(entry.activities)) return;
      entry.activities.forEach(function (act) {
        if (act && typeof act.id === 'string' &&
            act.id.indexOf('agent:') === 0 && act._agentId) {
          if (!agentActivityIndex[taskId]) agentActivityIndex[taskId] = {};
          agentActivityIndex[taskId][act._agentId] = act.id;
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Task entries + activities                                           */
  /* ------------------------------------------------------------------ */

  function ensureTaskEntry(taskId) {
    if (!taskId) return null;
    var entry = state.tasks[taskId];
    if (!entry) {
      entry = {
        task: {
          task_id: taskId,
          title: null,
          kind: null,
          state: null,
          created_at: null,
          started_at: null,
          finished_at: null,
          error: null
        },
        activities: [],
        sources: [],
        summary: null,
        lastActivityAt: null
      };
      state.tasks[taskId] = entry;
    }
    return entry;
  }

  function normaliseTask(raw) {
    if (!isPlainObject(raw)) return null;
    var taskId = asNonEmptyString(raw.task_id || raw.id);
    if (!taskId) return null;
    return {
      task_id: taskId,
      title: asNonEmptyString(raw.title),
      kind: asNonEmptyString(raw.kind),
      state: asNonEmptyString(raw.state),
      created_at: toIso(raw.created_at),
      started_at: toIso(raw.started_at),
      finished_at: toIso(raw.finished_at),
      error: asNonEmptyString(raw.error)
    };
  }

  function mergeTask(raw) {
    var norm = normaliseTask(raw);
    if (!norm) return null;
    var entry = ensureTaskEntry(norm.task_id);
    var prev = entry.task;
    entry.task = {
      task_id: norm.task_id,
      title: norm.title !== null ? norm.title : prev.title,
      kind: norm.kind !== null ? norm.kind : prev.kind,
      state: norm.state !== null ? norm.state : prev.state,
      created_at: norm.created_at || prev.created_at,
      started_at: norm.started_at || prev.started_at,
      finished_at: norm.finished_at || prev.finished_at,
      error: norm.error !== null ? norm.error : prev.error
    };
    // Keep the full raw task (plan / progress / result) for getSummary().
    entry._rawTask = raw;
    return entry;
  }

  function newActivity(fields) {
    return {
      id: fields.id,
      taskId: fields.taskId,
      kind: fields.kind,
      title: fields.title,
      detail: fields.detail || '',
      why: fields.why || '',
      sourceUrl: fields.sourceUrl || null,
      sourceTitle: fields.sourceTitle || null,
      findings: Array.isArray(fields.findings) ? fields.findings.slice() : [],
      status: fields.status || 'pending',
      startedAt: fields.startedAt || nowIso(),
      finishedAt: fields.finishedAt || null,
      durationMs: fields.durationMs || null,
      error: fields.error || null,
      verified: (fields.verified === undefined) ? null : fields.verified,
      _agentId: fields.agentId || undefined
    };
  }

  /* Strip internal fields before anything leaves this module. */
  function publicActivity(act) {
    var out = clone(act);
    delete out._agentId;
    return out;
  }

  function finishActivity(act, finishedAtIso) {
    var end = finishedAtIso || nowIso();
    act.finishedAt = end;
    if (act.startedAt) {
      var ms = new Date(end).getTime() - new Date(act.startedAt).getTime();
      act.durationMs = (isFinite(ms) && ms >= 0) ? ms : null;
    }
  }

  function addActivity(taskId, activity) {
    var entry = ensureTaskEntry(taskId);
    if (!entry) return null;
    entry.activities.push(activity);
    if (entry.activities.length > MAX_ACTIVITIES_PER_TASK) {
      entry.activities.splice(
        0, entry.activities.length - MAX_ACTIVITIES_PER_TASK);
    }
    entry.lastActivityAt = activity.startedAt || nowIso();
    return activity;
  }

  function findActivity(entry, activityId) {
    for (var i = 0; i < entry.activities.length; i++) {
      if (entry.activities[i].id === activityId) return entry.activities[i];
    }
    return null;
  }

  function agentActivityId(agentId) {
    return 'agent:' + agentId;
  }

  function getAgentActivity(taskId, agentId) {
    var byAgent = agentActivityIndex[taskId];
    if (!byAgent) return null;
    var activityId = byAgent[agentId];
    if (!activityId) return null;
    var entry = state.tasks[taskId];
    if (!entry) return null;
    return findActivity(entry, activityId);
  }

  function registerAgentActivity(taskId, agentId, activity) {
    if (!agentActivityIndex[taskId]) agentActivityIndex[taskId] = {};
    agentActivityIndex[taskId][agentId] = activity.id;
  }

  function notify() {
    var snapshot = getState();
    subscribers.slice().forEach(function (cb) {
      try { cb(snapshot); } catch (e) { /* subscriber errors never break the loop */ }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Event -> Activity mapping                                           */
  /* ------------------------------------------------------------------ */
  /* One real backend event maps to at most one Activity. Agent lifecycle
     events for the same agent merge into that agent's single Activity
     (started -> running, completed -> completed); task-level events each
     get their own Activity (id "ev:<event_id>"); findings get their own
     Activity carrying the finding text. Unknown types are NOT dropped:
     they are real rows, so they surface as a generic "event" Activity
     carrying the raw type, and are listed in the EVIDENCE file. */

  function mapEventToActivity(event) {
    var type = asString(event.type);
    var detail = detailOf(event);
    var taskId = asNonEmptyString(event.task_id);
    var agentId = asNonEmptyString(event.agent_id);
    var startedAt = toIso(event.created_at) || nowIso();
    var role = asNonEmptyString(detail.role) || asNonEmptyString(detail.subtask_role);
    var subtask = asNonEmptyString(detail.subtask);
    var errorText = asNonEmptyString(detail.error);

    if (!taskId) return null; // Chat-level events with no task: nothing to attach to.

    var entry = ensureTaskEntry(taskId);

    /* ---- Agent lifecycle: one Activity per agent ------------------- */
    var agentLifecycle = {
      agent_started: 'running',
      agent_completed: 'completed',
      agent_created: 'pending',
      agent_running: 'running',
      agent_progress: 'running',
      agent_done: 'completed',
      agent_queued: 'pending',
      agent_paused: 'pending',
      agent_cancelled: 'failed',
      agent_failed: 'failed'
    };
    if (Object.prototype.hasOwnProperty.call(agentLifecycle, type) && agentId) {
      var existing = getAgentActivity(taskId, agentId);
      var status = agentLifecycle[type];
      if (existing) {
        // Keep the original startedAt; only advance the status.
        if (status === 'completed' || status === 'failed') {
          if (existing.status !== status || !existing.finishedAt) {
            existing.status = status;
            finishActivity(existing, startedAt);
          }
        } else {
          existing.status = status;
          if (type === 'agent_failed' || type === 'agent_cancelled') {
            existing.error = errorText || 'Agent stopped.';
          }
        }
        if (role && existing.title === 'Agent step') {
          existing.title = roleLabel(role);
          existing.kind = kindForRole(role);
        }
        if (subtask && !existing.why) existing.why = subtask;
        return existing;
      }
      var act = newActivity({
        id: agentActivityId(agentId),
        taskId: taskId,
        kind: kindForRole(role || ''),
        title: roleLabel(role),
        detail: subtask || '',
        why: whyForRole(role || '', subtask),
        status: status,
        startedAt: startedAt,
        agentId: agentId,
        error: (status === 'failed')
          ? (errorText || 'Agent failed.') : null
      });
      if (status === 'completed' || status === 'failed') {
        finishActivity(act, startedAt);
      }
      addActivity(taskId, act);
      registerAgentActivity(taskId, agentId, act);
      return act;
    }

    /* ---- Retry: the agent's Activity becomes "retrying" ------------ */
    if (type === 'retry_started' && agentId) {
      var target = getAgentActivity(taskId, agentId);
      var retries = (typeof detail.retries === 'number') ? detail.retries : null;
      if (target) {
        target.status = 'retrying';
        target.finishedAt = null;
        target.durationMs = null;
        target.detail = retries !== null
          ? ('Retry attempt ' + retries + '.')
          : 'Retrying after a failure.';
        return target;
      }
      var retryAct = newActivity({
        id: agentActivityId(agentId),
        taskId: taskId,
        kind: kindForRole(role || ''),
        title: roleLabel(role),
        detail: retries !== null
          ? ('Retry attempt ' + retries + '.') : 'Retrying after a failure.',
        why: whyForRole(role || '', subtask),
        status: 'retrying',
        startedAt: startedAt,
        agentId: agentId
      });
      addActivity(taskId, retryAct);
      registerAgentActivity(taskId, agentId, retryAct);
      return retryAct;
    }

    /* ---- Failure ---------------------------------------------------- */
    if (type === 'failure') {
      if (agentId) {
        var failed = getAgentActivity(taskId, agentId);
        if (failed) {
          failed.status = 'failed';
          failed.error = errorText || 'Agent failed.';
          finishActivity(failed, startedAt);
          return failed;
        }
        var failAct = newActivity({
          id: agentActivityId(agentId),
          taskId: taskId,
          kind: kindForRole(role || ''),
          title: roleLabel(role),
          detail: subtask || '',
          why: whyForRole(role || '', subtask),
          status: 'failed',
          startedAt: startedAt,
          error: errorText || 'Agent failed.',
          agentId: agentId
        });
        finishActivity(failAct, startedAt);
        addActivity(taskId, failAct);
        registerAgentActivity(taskId, agentId, failAct);
        return failAct;
      }
      var taskFail = newActivity({
        id: 'ev:' + event.event_id,
        taskId: taskId,
        kind: 'task',
        title: 'Research task failed',
        detail: errorText || '',
        why: 'The backend reported a failure for this task.',
        status: 'failed',
        startedAt: startedAt,
        error: errorText || 'Task failed.'
      });
      finishActivity(taskFail, startedAt);
      addActivity(taskId, taskFail);
      return taskFail;
    }

    /* ---- Verification of an agent's output -------------------------- */
    if (type === 'agent_verified' && agentId) {
      var verifiedAct = getAgentActivity(taskId, agentId);
      var invented = Array.isArray(detail.invented_urls)
        ? detail.invented_urls.filter(function (u) { return typeof u === 'string'; })
        : [];
      var verifiedFlag = null;
      if (detail.verified === true) verifiedFlag = 'verified';
      else if (detail.verified === false) {
        verifiedFlag = invented.length > 0 ? 'conflicting' : 'unverified';
      }
      if (verifiedAct) {
        verifiedAct.verified = verifiedFlag;
        if (detail.verified === false && invented.length > 0) {
          verifiedAct.detail = 'Cited ' + invented.length +
            ' URL(s) that were not among the retrieved sources.';
        }
        return verifiedAct;
      }
      var vAct = newActivity({
        id: agentActivityId(agentId),
        taskId: taskId,
        kind: kindForRole(role || ''),
        title: roleLabel(role),
        detail: '',
        why: whyForRole(role || '', subtask),
        status: 'completed',
        startedAt: startedAt,
        verified: verifiedFlag,
        agentId: agentId
      });
      finishActivity(vAct, startedAt);
      addActivity(taskId, vAct);
      registerAgentActivity(taskId, agentId, vAct);
      return vAct;
    }

    /* ---- Reassignment / release: note on the agent's Activity ------ */
    if ((type === 'agent_reassigned' || type === 'agent_released') && agentId) {
      var noted = getAgentActivity(taskId, agentId);
      if (noted) {
        noted.detail = (type === 'agent_reassigned')
          ? 'Agent reassigned to a fresh attempt.'
          : 'Agent released.';
        return noted;
      }
      var nAct = newActivity({
        id: agentActivityId(agentId),
        taskId: taskId,
        kind: kindForRole(role || ''),
        title: roleLabel(role),
        detail: (type === 'agent_reassigned')
          ? 'Agent reassigned to a fresh attempt.' : 'Agent released.',
        why: whyForRole(role || '', subtask),
        status: 'pending',
        startedAt: startedAt,
        agentId: agentId
      });
      addActivity(taskId, nAct);
      registerAgentActivity(taskId, agentId, nAct);
      return nAct;
    }

    /* ---- Finding: its own Activity, carrying the finding text ------ */
    if (type === 'finding_added') {
      var findingText = asNonEmptyString(detail.finding);
      if (!findingText) return null; // An empty finding says nothing.
      var src = isPlainObject(detail.source) ? detail.source : null;
      var sourceUrl = urlFromDetail(detail);
      if (!sourceUrl && typeof detail.source === 'string') {
        sourceUrl = asNonEmptyString(detail.source);
      }
      var fAct = newActivity({
        id: 'ev:' + event.event_id,
        taskId: taskId,
        kind: 'finding',
        title: agentId ? ('Finding: ' + roleLabel(role)) : 'Finding',
        detail: '',
        why: subtask || (role ? roleLabel(role) : 'Recorded by the backend.'),
        sourceUrl: sourceUrl,
        sourceTitle: titleFromDetail(detail),
        findings: [findingText],
        status: 'completed',
        startedAt: startedAt,
        verified: sourceUrl ? 'unverified' : 'missing',
        agentId: agentId || undefined
      });
      finishActivity(fAct, startedAt);
      addActivity(taskId, fAct);
      return fAct;
    }

    /* ---- Task-level lifecycle: one Activity per event -------------- */
    var taskEvents = {
      task_created: { title: 'Research task created', status: 'completed' },
      task_started: { title: 'Research started', status: 'completed' },
      task_completed: { title: 'Research completed', status: 'completed' },
      task_partially_completed: {
        title: 'Research partially completed', status: 'completed'
      },
      task_paused: { title: 'Research paused', status: 'completed' },
      task_resumed: { title: 'Research resumed', status: 'completed' },
      task_cancelled: { title: 'Research cancelled', status: 'completed' },
      task_modified: { title: 'Research task modified', status: 'completed' },
      verification_started: {
        title: 'Verification started', status: 'completed'
      },
      subtask_completed: { title: 'Subtask completed', status: 'completed' }
    };
    if (Object.prototype.hasOwnProperty.call(taskEvents, type)) {
      var spec = taskEvents[type];
      var tAct = newActivity({
        id: 'ev:' + event.event_id,
        taskId: taskId,
        kind: (type === 'verification_started') ? 'verification' : 'task',
        title: spec.title,
        detail: taskTitleDetail(entry, detail, type),
        why: taskWhy(entry, type),
        status: spec.status,
        startedAt: startedAt
      });
      finishActivity(tAct, startedAt);
      addActivity(taskId, tAct);
      return tAct;
    }

    /* ---- Generic task-state transition ------------------------------ */
    if (type === 'task_state') {
      var fromState = asNonEmptyString(detail.from);
      var toState = asNonEmptyString(detail.to);
      var sAct = newActivity({
        id: 'ev:' + event.event_id,
        taskId: taskId,
        kind: 'task',
        title: (fromState && toState)
          ? ('Task state: ' + fromState + ' to ' + toState)
          : 'Task state changed',
        detail: asNonEmptyString(detail.detail) || '',
        why: 'The backend recorded a state change for this task.',
        status: 'completed',
        startedAt: startedAt
      });
      finishActivity(sAct, startedAt);
      addActivity(taskId, sAct);
      return sAct;
    }

    /* ---- Anything else that really arrived: generic, never dropped -- */
    var gAct = newActivity({
      id: 'ev:' + event.event_id,
      taskId: taskId,
      kind: 'event',
      title: 'Event: ' + type,
      detail: '',
      why: 'The backend recorded this event; no specific mapping exists.',
      status: 'completed',
      startedAt: startedAt
    });
    finishActivity(gAct, startedAt);
    addActivity(taskId, gAct);
    return gAct;
  }

  function taskTitleDetail(entry, detail, type) {
    if (type === 'task_created' || type === 'task_started') {
      return asNonEmptyString(detail.title) || entry.task.title || '';
    }
    if (type === 'task_completed' || type === 'task_partially_completed') {
      var parts = [];
      if (typeof detail.findings === 'number') {
        parts.push(detail.findings + ' finding(s)');
      }
      if (typeof detail.sources === 'number') {
        parts.push(detail.sources + ' source(s)');
      }
      return parts.join(', ');
    }
    if (type === 'task_paused' || type === 'task_resumed') {
      var from = asNonEmptyString(detail.from);
      return from ? ('From state: ' + from + '.') : '';
    }
    return '';
  }

  function taskWhy(entry, type) {
    var title = entry.task.title;
    if (type === 'verification_started') {
      return 'Collected material is now being checked against its sources.';
    }
    if (type === 'task_paused') return 'Paused by request; work can resume.';
    if (type === 'task_resumed') return 'Work continues after a pause.';
    if (type === 'task_cancelled') return 'Cancelled by request.';
    if (type === 'task_completed') {
      return 'All planned research steps finished.';
    }
    if (type === 'task_partially_completed') {
      return 'Some steps finished; some failed or found no sources.';
    }
    return title ? ('Research task: ' + title + '.') : 'Research task.';
  }

  function processEvents(events) {
    if (!Array.isArray(events)) return 0;
    var added = 0;
    var changed = false;
    events.forEach(function (event) {
      if (!isPlainObject(event)) return;
      var eventId = event.event_id;
      if (typeof eventId !== 'number') return;
      if (seenEventIds[eventId]) return; // Dedupe: same event twice = once.
      seenEventIds[eventId] = true;
      seenEventOrder.push(eventId);
      if (seenEventOrder.length > MAX_SEEN_EVENTS) {
        var dropped = seenEventOrder.splice(
          0, seenEventOrder.length - MAX_SEEN_EVENTS);
        dropped.forEach(function (id) { delete seenEventIds[id]; });
      }
      if (eventId > sinceCursor) sinceCursor = eventId;
      var activity = mapEventToActivity(event);
      if (window.EnzoAgents) { try { window.EnzoAgents.ingestEvent(event); } catch (e) {} }
      if (activity) { added++; changed = true; }
      // Task state hints carried by events (task-level ones only).
      if (event.task_id && typeof event.task_id === 'string') {
        var entry = state.tasks[event.task_id];
        if (entry) {
          var next = null;
          if (event.type === 'task_completed') next = 'completed';
          else if (event.type === 'task_partially_completed') {
            next = 'partially_completed';
          } else if (event.type === 'task_cancelled') next = 'cancelled';
          else if (event.type === 'task_paused') next = 'paused';
          else if (event.type === 'task_resumed') next = 'running';
          else if (event.type === 'task_started') next = 'running';
          if (next) {
            entry.task.state = next;
            if (TERMINAL_TASK_STATES[next]) {
              entry.task.finished_at = entry.task.finished_at ||
                toIso(event.created_at) || nowIso();
            }
            changed = true;
          }
        }
      }
    });
    if (changed) { save(); notify(); }
    return added;
  }

  /* ------------------------------------------------------------------ */
  /* HTTP layer (same-origin /api/v2 only)                               */
  /* ------------------------------------------------------------------ */

  function httpJson(path, options) {
    options = options || {};
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch is not available'));
    }
    var fetchOptions = { method: options.method || 'GET' };
    if (options.body !== undefined) {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify(options.body);
    }
    var controller = null;
    var timer = null;
    if (typeof AbortController !== 'undefined') {
      try {
        controller = new AbortController();
        fetchOptions.signal = controller.signal;
        timer = setTimeout(function () {
          try { controller.abort(); } catch (e) { /* already settled */ }
        }, options.timeoutMs || LONG_POLL_TIMEOUT_MS);
      } catch (e) { controller = null; }
    }
    return fetch(API_BASE + path, fetchOptions).then(function (resp) {
      if (timer) clearTimeout(timer);
      // Any HTTP response at all means the backend is reachable.
      state.backendAvailable = true;
      if (!resp || typeof resp.json !== 'function') {
        throw new Error('Invalid response from backend');
      }
      return resp.json().catch(function () { return null; }).then(function (j) {
        if (!resp.ok) {
          var message = (j && (j.message || j.error)) ||
            ('Backend returned HTTP ' + resp.status);
          var err = new Error(message);
          err.status = resp.status;
          err.payload = j;
          throw err;
        }
        return j;
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      // No HTTP response: network failure / aborted long-poll.
      if (err && err.name === 'AbortError') throw err;
      state.backendAvailable = false;
      throw err;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Long-poll event loop                                                */
  /* ------------------------------------------------------------------ */

  function schedulePoll(delayMs) {
    if (!running) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, delayMs);
  }

  function pollOnce() {
    pollTimer = null;
    if (!running) return;
    if (!state.chatId) {
      state.connected = false;
      return; // No chat yet: nothing to poll. start() resumes on setChatId.
    }
    var chatId = state.chatId;
    var eventsPromise59 = EnzoPollLoop.dedupedFetch('/api/v2/chats/' + encodeURIComponent(chatId) + '/events?since=' + sinceCursor, {}, function(){ return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getChatEvents(chatId, sinceCursor) : httpJson('/chats/' + encodeURIComponent(chatId) + '/events?since=' + sinceCursor, { timeoutMs: LONG_POLL_TIMEOUT_MS })); });
    eventsPromise59.then(function (j) {
      if (!running || state.chatId !== chatId) return;
      backoffStep = 0;
      state.connected = true;
      var events = (j && Array.isArray(j.events)) ? j.events : [];
      if (typeof j.last_event_id === 'number' &&
          j.last_event_id > sinceCursor) {
        sinceCursor = j.last_event_id;
      }
      if (events.length > 0) processEvents(events);
      maybeFetchCompletedSources(events);
      save();
      notify();
      schedulePoll(0); // Server already held up to 25 s: poll again at once.
    }, function (err) {
      if (!running || state.chatId !== chatId) return;
      state.connected = false;
      if (err && err.name === 'AbortError') {
        // Our own 30 s guard fired (server should answer within 25 s).
        schedulePoll(0);
        return;
      }
      if (err && err.code === 'chat-local-only') { stop(); return; }
      if (err && err.status === 404) { try { if (window.EnzoPollingFix) window.EnzoPollingFix.markChatLocalOnly(chatId); } catch (e) {} stop(); return; }
      // Any other HTTP response means the backend answered; no response
      // at all means it is unreachable.
      if (err && typeof err.status === 'number') state.backendAvailable = true;
      var delay = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)];
      backoffStep++;
      save();
      notify();
      schedulePoll(delay);
    });
  }

  /* When a task reaches a terminal event, pull its sources once so the
     monitor (and getSummary) has the real citation list. */
  function maybeFetchCompletedSources(events) {
    if (!Array.isArray(events)) return;
    events.forEach(function (event) {
      if (!event || !event.task_id) return;
      if (event.type === 'task_completed' ||
          event.type === 'task_partially_completed' ||
          event.type === 'task_cancelled') {
        fetchSourcesInternal(event.task_id).catch(function () { /* keep polling */ });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Progress polling (~2 s while a task is active)                      */
  /* ------------------------------------------------------------------ */

  function scheduleProgress() {
    if (!running) return;
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = setTimeout(pollProgressOnce, PROGRESS_INTERVAL_MS);
  }

  function activeTaskIds() {
    var ids = [];
    if (state.activeTaskId) {
      var entry = state.tasks[state.activeTaskId];
      if (entry && !TERMINAL_TASK_STATES[entry.task.state]) {
        ids.push(state.activeTaskId);
      }
    }
    // Also keep polling any other non-terminal task already in state.
    Object.keys(state.tasks).forEach(function (taskId) {
      if (ids.indexOf(taskId) !== -1) return;
      var entry = state.tasks[taskId];
      if (entry && entry.task.state &&
          !TERMINAL_TASK_STATES[entry.task.state]) {
        ids.push(taskId);
      }
    });
    return ids;
  }

  function pollProgressOnce() {
    progressTimer = null;
    if (!running) return;
    var ids = activeTaskIds();
    if (ids.length === 0) return; // Nothing active: no polling, no noise.
    ids.forEach(function (taskId) {
      if (progressInFlight[taskId]) return;
      progressInFlight[taskId] = true;
      (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTaskProgress(taskId) : httpJson('/tasks/' + encodeURIComponent(taskId) + '/progress', { timeoutMs: 15000 })).then(function (p) {
        delete progressInFlight[taskId];
        if (!running) return;
        applyProgress(taskId, p);
        scheduleProgress();
      }, function (err) {
        delete progressInFlight[taskId];
        if (!running) return;
        if (err && (err.status === 404 || err.code === 'task-unknown' || err.code === 'empty-task-id')) return; // v59: a 404 stops progress polling for this task.
        scheduleProgress(); // Other progress failures never stop the event loop.
      });
    });
  }

  function applyProgress(taskId, p) {
    if (!isPlainObject(p)) return;
    var entry = ensureTaskEntry(taskId);
    var changed = false;
    if (typeof p.state === 'string' && p.state) {
      if (entry.task.state !== p.state) {
        entry.task.state = p.state;
        changed = true;
      }
      if (TERMINAL_TASK_STATES[p.state] && !entry.task.finished_at) {
        entry.task.finished_at = nowIso();
      }
    }
    if (Array.isArray(p.agents)) {
      p.agents.forEach(function (agent) {
        if (!isPlainObject(agent)) return;
        var agentId = asNonEmptyString(agent.agent_id);
        if (!agentId) return;
        var role = asNonEmptyString(agent.role);
        var status = asString(agent.status);
        var retries = (typeof agent.retries === 'number') ? agent.retries : 0;
        var existing = getAgentActivity(taskId, agentId);
        var mapped = null;
        if (status === 'done') mapped = 'completed';
        else if (status === 'failed') mapped = 'failed';
        else if (status === 'running') mapped = 'running';
        else if (status === 'queued') mapped = 'pending';
        else if (status === 'paused') mapped = 'pending';
        else if (status === 'cancelled') mapped = 'failed';
        else mapped = 'pending';
        if (retries > 0 && (mapped === 'running' || mapped === 'pending')) {
          mapped = 'retrying';
        }
        if (existing) {
          if (existing.status !== mapped) {
            existing.status = mapped;
            changed = true;
          }
          if (mapped === 'completed' || mapped === 'failed') {
            if (!existing.finishedAt) {
              finishActivity(existing, nowIso());
              changed = true;
            }
            if (mapped === 'failed' && status === 'cancelled') {
              existing.error = existing.error || 'Agent cancelled.';
            }
          }
          if (mapped === 'retrying') {
            existing.finishedAt = null;
            existing.durationMs = null;
            existing.detail = 'Retry attempt after a failure' +
              (retries > 0 ? (' (retries: ' + retries + ').') : '.');
            changed = true;
          }
        } else if (role || status === 'running' || status === 'done' ||
            status === 'failed') {
          // Real backend state for an agent we have no event for (e.g.
          // history restored, or polling started mid-task). This is
          // progress data, not invented activity.
          var act = newActivity({
            id: agentActivityId(agentId),
            taskId: taskId,
            kind: kindForRole(role || ''),
            title: roleLabel(role),
            detail: retries > 0 ? ('Retries so far: ' + retries + '.') : '',
            why: whyForRole(role || '', null),
            status: mapped,
            startedAt: nowIso(),
            agentId: agentId
          });
          if (mapped === 'completed' || mapped === 'failed') {
            finishActivity(act, nowIso());
          }
          addActivity(taskId, act);
          registerAgentActivity(taskId, agentId, act);
          changed = true;
        }
      });
    }
    // Findings preview: only findings the backend actually recorded.
    if (Array.isArray(p.findings_preview) && p.findings_preview.length > 0) {
      var texts = [];
      p.findings_preview.forEach(function (f) {
        if (typeof f === 'string' && f.trim()) texts.push(f.trim());
        else if (isPlainObject(f) && typeof f.finding === 'string' &&
            f.finding.trim()) {
          texts.push(f.finding.trim());
        }
      });
      if (texts.length > 0) {
        var fId = 'task:' + taskId + ':findings';
        var fAct = findActivity(entry, fId);
        if (!fAct) {
          fAct = newActivity({
            id: fId,
            taskId: taskId,
            kind: 'finding',
            title: 'Findings so far',
            detail: '',
            why: 'Intermediate findings recorded by the backend.',
            findings: texts,
            status: TERMINAL_TASK_STATES[entry.task.state]
              ? 'completed' : 'running',
            startedAt: nowIso()
          });
          addActivity(taskId, fAct);
          changed = true;
        } else {
          var merged = fAct.findings.slice();
          texts.forEach(function (t) {
            if (merged.indexOf(t) === -1) merged.push(t);
          });
          if (merged.length !== fAct.findings.length) {
            fAct.findings = merged;
            changed = true;
          }
          var want = TERMINAL_TASK_STATES[entry.task.state]
            ? 'completed' : 'running';
          if (fAct.status !== want) { fAct.status = want; changed = true; }
        }
      }
    }
    if (TERMINAL_TASK_STATES[entry.task.state]) {
      // Task finished: pull sources + full task once for the summary.
      fetchSourcesInternal(taskId).catch(function () { /* keep history */ });
      fetchTaskInternal(taskId).catch(function () { /* keep history */ });
    }
    if (changed) { save(); notify(); }
  }

  /* ------------------------------------------------------------------ */
  /* Fetch helpers (task / sources)                                      */
  /* ------------------------------------------------------------------ */

  function fetchTaskInternal(taskId) {
    return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTask(taskId) : httpJson('/tasks/' + encodeURIComponent(taskId), { timeoutMs: 15000 })).then(function (j) {
      var raw = (j && isPlainObject(j.task)) ? j.task : j;
      var entry = mergeTask(raw);
      if (entry) { save(); notify(); }
      return entry;
    });
  }

  function normaliseSource(raw) {
    if (!isPlainObject(raw)) return null;
    return {
      source_id: asNonEmptyString(raw.source_id),
      task_id: asNonEmptyString(raw.task_id),
      chat_id: asNonEmptyString(raw.chat_id),
      url: asNonEmptyString(raw.url),
      final_url: asNonEmptyString(raw.final_url),
      title: asNonEmptyString(raw.title),
      outlet: asNonEmptyString(raw.outlet),
      pub_date: asNonEmptyString(raw.pub_date),
      fetched_at: asNonEmptyString(raw.fetched_at),
      snippet: asNonEmptyString(raw.snippet),
      quality: (raw.quality === null || raw.quality === undefined)
        ? null : raw.quality,
      supports_claim: (raw.supports_claim === null ||
        raw.supports_claim === undefined) ? null : raw.supports_claim
    };
  }

  function fetchSourcesInternal(taskId) {
    return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTaskSources(taskId) : httpJson('/tasks/' + encodeURIComponent(taskId) + '/sources', { timeoutMs: 20000 })).then(function (j) {
      var entry = ensureTaskEntry(taskId);
      var rows = (j && Array.isArray(j.sources)) ? j.sources : [];
      entry.sources = rows.map(normaliseSource).filter(function (s) {
        return s !== null;
      });
      // The endpoint returns citable sources only, plus an excluded count
      // and note — excluded rows themselves are never sent to the client.
      sourcesMeta[taskId] = {
        excluded: (typeof j.excluded === 'number') ? j.excluded : null,
        excludedNote: asNonEmptyString(j.excluded_note)
      };
      save();
      notify();
      return clone(entry.sources);
    });
  }

  function taskControl(taskId, action) {
    if (!taskId) return Promise.reject(new Error('taskId is required'));
    var entry = ensureTaskEntry(taskId);
    return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().postTaskControl(taskId, action) : httpJson('/tasks/' + encodeURIComponent(taskId) + '/' + action, { method: 'POST', body: {}, timeoutMs: 15000 })).then(function (j) {
      var raw = (j && isPlainObject(j.task)) ? j.task : null;
      if (raw) mergeTask(raw);
      else if (j && typeof j.state === 'string' && j.state) {
        entry.task.state = j.state;
        if (TERMINAL_TASK_STATES[j.state] && !entry.task.finished_at) {
          entry.task.finished_at = nowIso();
        }
      }
      entry.task.error = null;
      save();
      notify();
      return j;
    }, function (err) {
      // Never pretend success: surface the error on the task and reject.
      entry.task.error = (err && err.message) || 'Task control failed.';
      save();
      notify();
      throw err;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Summary — ONLY from the real task result + real sources             */
  /* ------------------------------------------------------------------ */

  function buildSummary(taskId) {
    var entry = state.tasks[taskId];
    if (!entry) return null;
    var raw = entry._rawTask || {};
    var result = isPlainObject(raw.result) ? raw.result : null;
    var plan = isPlainObject(raw.plan) ? raw.plan : null;
    var task = entry.task;

    var objective = null;
    if (plan && typeof plan.objective === 'string' && plan.objective.trim()) {
      objective = plan.objective.trim();
    } else if (task.title) {
      objective = task.title;
    }

    var methodology;
    var planSubtasks = [];
    if (plan) {
      if (Array.isArray(plan.subtasks)) {
        plan.subtasks.forEach(function (s) {
          if (!isPlainObject(s)) return;
          planSubtasks.push({
            role: asNonEmptyString(s.role),
            title: asNonEmptyString(s.title)
          });
        });
      }
      methodology = {
        description: planSubtasks.length > 0
          ? 'The backend split the research into ' + planSubtasks.length +
            ' planned step(s) and ran them as agents.'
          : 'The backend returned a plan with no subtasks listed.',
        subtasks: planSubtasks,
        complexity: isPlainObject(plan.complexity)
          ? clone(plan.complexity) : null
      };
    } else {
      methodology = {
        description: 'Unknown: the backend did not return a plan for this task.',
        subtasks: [],
        complexity: null
      };
    }

    var sources = clone(entry.sources || []);
    var meta = sourcesMeta[taskId] || {};

    var discoveries = [];
    entry.activities.forEach(function (act) {
      (act.findings || []).forEach(function (f) {
        if (typeof f === 'string' && f && discoveries.indexOf(f) === -1) {
          discoveries.push(f);
        }
      });
    });
    if (result && Array.isArray(result.findings)) {
      result.findings.forEach(function (f) {
        var text = (typeof f === 'string') ? f
          : (isPlainObject(f) ? asNonEmptyString(f.finding) : null);
        if (text && discoveries.indexOf(text) === -1) discoveries.push(text);
      });
    }

    var verifiedFindings = [];
    entry.activities.forEach(function (act) {
      if (act.verified === 'verified') {
        (act.findings || []).forEach(function (f) {
          if (verifiedFindings.indexOf(f) === -1) verifiedFindings.push(f);
        });
      }
    });

    var limitations = [];
    if (!TERMINAL_TASK_STATES[task.state]) {
      limitations.push(
        'Task state is "' + (task.state || 'unknown') +
        '": the task has not finished, so this summary is partial.');
    }
    if (!result) {
      limitations.push(
        'Unknown: the backend has not returned a result for this task yet.');
    }
    if (sources.length === 0) {
      limitations.push(
        'No citable sources were returned for this task ' +
        '(a citable source needs both a final URL and a publication date).');
    }
    if (typeof meta.excluded === 'number' && meta.excluded > 0) {
      limitations.push(meta.excludedNote ||
        (meta.excluded + ' retrieved source(s) were excluded as citations.'));
    }
    if (!plan) {
      limitations.push('Unknown: no plan was returned, so the method cannot be described.');
    }

    var conclusions = null;
    var conclusionsNote;
    if (result && typeof result.conclusions === 'string' &&
        result.conclusions.trim()) {
      conclusions = result.conclusions.trim();
      conclusionsNote = 'Taken from the task result.';
    } else {
      conclusionsNote = 'Unknown: the task result contains no conclusions field; ' +
        'no conclusion is inferred. See the task result for the full report.';
    }

    var summary = {
      taskId: taskId,
      title: task.title,
      objective: objective,
      state: task.state,
      methodology: methodology,
      sources: sources,
      discoveries: discoveries,
      verifiedFindings: verifiedFindings,
      verified_findings: verifiedFindings,
      findings: verifiedFindings,
      limitations: limitations,
      conclusions: conclusions,
      conclusionsNote: conclusionsNote,
      generatedFrom: {
        hasResult: result !== null,
        sourcesCited: (result && typeof result.sources_cited === 'number')
          ? result.sources_cited : null,
        sourcesRetrieved: (result && typeof result.sources_retrieved === 'number')
          ? result.sources_retrieved : null,
        sourcesListed: sources.length,
        excludedSources: (typeof meta.excluded === 'number')
          ? meta.excluded : null
      }
    };
    entry.summary = summary;
    save();
    return clone(summary);
  }

  /* ------------------------------------------------------------------ */
  /* Frontend hook: real client-side steps only                          */
  /* ------------------------------------------------------------------ */

  function noteFrontendStep(step) {
    var title = null;
    var detail = '';
    var kindSuffix = 'step';
    var taskId = null;
    if (typeof step === 'string') {
      title = step.trim();
    } else if (isPlainObject(step)) {
      title = asNonEmptyString(step.title) || asNonEmptyString(step.text);
      detail = asNonEmptyString(step.detail) || '';
      var k = asNonEmptyString(step.kind);
      if (k) kindSuffix = k.replace(/^client:/, '');
      taskId = asNonEmptyString(step.taskId) || null;
    }
    if (!title) return null;
    clientStepCounter++;
    var activity = newActivity({
      id: 'client:' + clientStepCounter + ':' + Date.now(),
      taskId: taskId || state.activeTaskId || '__pending__',
      kind: 'client:' + kindSuffix,
      title: title,
      detail: detail,
      why: 'Recorded by the frontend ask flow (client-side step).',
      status: 'completed',
      startedAt: nowIso()
    });
    finishActivity(activity, activity.startedAt);
    var targetId = taskId || state.activeTaskId;
    if (targetId) {
      addActivity(targetId, activity);
      activity.taskId = targetId;
    } else {
      // No task yet (e.g. "question sent" precedes task creation):
      // buffer until a task becomes active, then attach. Never dropped.
      pendingClientSteps.push(activity);
    }
    save();
    notify();
    return publicActivity(activity);
  }

  function flushPendingClientSteps(taskId) {
    if (!taskId || pendingClientSteps.length === 0) return;
    pendingClientSteps.forEach(function (activity) {
      activity.taskId = taskId;
      addActivity(taskId, activity);
    });
    pendingClientSteps = [];
  }

  /* ------------------------------------------------------------------ */
  /* Public API (exact contract — M2 builds against these names/shapes) */
  /* ------------------------------------------------------------------ */

  function getState() {
    var tasksOut = {};
    Object.keys(state.tasks).forEach(function (taskId) {
      var entry = state.tasks[taskId];
      tasksOut[taskId] = {
        task: clone(entry.task),
        activities: entry.activities.map(publicActivity),
        sources: clone(entry.sources || []),
        summary: clone(entry.summary),
        lastActivityAt: entry.lastActivityAt || null
      };
    });
    return {
      connected: state.connected,
      backendAvailable: state.backendAvailable,
      chatId: state.chatId,
      activeTaskId: state.activeTaskId,
      tasks: tasksOut
    };
  }

  function listTasks() {
    if (!state.chatId) return Promise.resolve([]);
    return EnzoPollLoop.dedupedFetch('/api/v2/chats/' + encodeURIComponent(state.chatId) + '/tasks', {}, function(){ return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getChatTasks(state.chatId) : httpJson('/chats/' + encodeURIComponent(state.chatId) + '/tasks', { timeoutMs: 15000 })); }).then(function (j) {
      var rows = (j && Array.isArray(j.tasks)) ? j.tasks
        : (Array.isArray(j) ? j : []);
      var out = [];
      rows.forEach(function (raw) {
        var entry = mergeTask(raw);
        if (entry) out.push(clone(entry.task));
      });
      save();
      notify();
      return out;
    });
  }

  function openTask(taskId) {
    if (!taskId) return Promise.reject(new Error('taskId is required'));
    state.activeTaskId = taskId;
    ensureTaskEntry(taskId);
    flushPendingClientSteps(taskId);
    return fetchTaskInternal(taskId).then(function () {
      return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTaskProgress(taskId) : httpJson('/tasks/' + encodeURIComponent(taskId) + '/progress', { timeoutMs: 15000 })).then(function (p) {
        applyProgress(taskId, p);
        return fetchSourcesInternal(taskId).catch(function () { return []; });
      }, function () {
        return fetchSourcesInternal(taskId).catch(function () { return []; });
      }).then(function () {
        if (running) scheduleProgress();
        save();
        notify();
        return clone(getState().tasks[taskId]);
      });
    });
  }

  function getTask(taskId) {
    var entry = taskId ? state.tasks[taskId] : null;
    if (!entry) return null;
    return {
      task: clone(entry.task),
      activities: entry.activities.map(publicActivity),
      sources: clone(entry.sources || []),
      summary: clone(entry.summary),
      lastActivityAt: entry.lastActivityAt || null
    };
  }

  function getSources(taskId) {
    if (!taskId) return Promise.reject(new Error('taskId is required'));
    ensureTaskEntry(taskId);
    return fetchSourcesInternal(taskId);
  }

  function getSummary(taskId) {
    if (!taskId) return null;
    return buildSummary(taskId);
  }

  function setChatId(id) {
    var next = (typeof id === 'string' && id) ? id : null;
    if (next === state.chatId) return;
    state.chatId = next;
    sinceCursor = 0;
    seenEventIds = {};
    seenEventOrder = [];
    state.connected = false;
    save();
    notify();
    if (running && next) {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      pollOnce();
    }
  }

  function getChatId() {
    return state.chatId;
  }

  function start() {
    if (running) return;
    running = true;
    backoffStep = 0;
    pollOnce();
    if (activeTaskIds().length > 0) scheduleProgress();
  }

  function stop() {
    running = false;
    state.connected = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    save();
    notify();
  }

  function isConnected() {
    return state.connected;
  }

  function subscribe(cb) {
    if (typeof cb !== 'function') return;
    if (subscribers.indexOf(cb) === -1) subscribers.push(cb);
  }

  function unsubscribe(cb) {
    var i = subscribers.indexOf(cb);
    if (i !== -1) subscribers.splice(i, 1);
  }

  /* Restore persisted history before anyone reads state. */
  restore();

  root().EnzoMonitor = {
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    getState: getState,
    listTasks: listTasks,
    openTask: openTask,
    getTask: getTask,
    pauseTask: function (taskId) { return taskControl(taskId, 'pause'); },
    resumeTask: function (taskId) { return taskControl(taskId, 'resume'); },
    cancelTask: function (taskId) { return taskControl(taskId, 'cancel'); },
    getSources: getSources,
    getSummary: getSummary,
    setChatId: setChatId,
    getChatId: getChatId,
    start: start,
    stop: stop,
    isConnected: isConnected,
    noteFrontendStep: noteFrontendStep
  };
})();

