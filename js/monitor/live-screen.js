
/* ============================================================================
 * ENAO AI — Live Screen, complete implementation (PRD section 8)
 * Piece 24 (24-livescreen.js) — enao-research-live
 *
 * What already existed (inspected before writing this piece):
 *  - v53 monitor panel (M2, 02-monitor-ui.js/css in the live export
 *    ~/workspace/your_files/enao-ai/enao-ai.html): a 480px right
 *    slide-over with a timeline, sources, report and controls, driven by
 *    the M1 data layer (window.EnzoMonitor).
 *  - v55 fullscreen live view (P6, 03-monitor-fullscreen.js/css):
 *    the same "View Live Research" button now opens the M2 panel
 *    FULL-SCREEN (body class `enzo-live-fullscreen` hides both sidebars
 *    #sidebar and #enzoPanel, main.main and #enzoFab; no dim overlay,
 *    no soft-focus filter) plus a live-guidance bar INSIDE the live
 *    view with mic + typing that reaches the running task through real
 *    endpoints (POST /api/v2/tasks/{id}/pause|resume|cancel|modify).
 *  - M1 data layer (window.EnzoMonitor): long-polls
 *    GET /api/v2/chats/{chatId}/events?since=<event_id> (25 s server
 *    hold), polls GET /api/v2/tasks/{id}/progress, fetches
 *    GET /api/v2/tasks/{id}/sources, and exposes pauseTask /
 *    resumeTask / cancelTask / noteFrontendStep / getState.
 *  - Backend (~/workspace/enao-platform/server/server.py): task states
 *    queued, planning, running, verifying, paused, completed,
 *    partially_completed, failed, cancelled; canonical event types in
 *    progress/progress.py EVENT_TYPES (28 types); progress payload
 *    {state, done, total, agents:[{agent_id, role, subtask, status,
 *    sources_count}], elapsed_s, eta_s, eta_basis, findings_preview}
 *    where done/total are raw DB counts; sources payload {sources,
 *    unverified, excluded, sources_verified}.
 *  - Search proxy (~/workspace/enao-ai/search-proxy.py):
 *    GET /api/fetch?url=... returns {url, title, text} for the real
 *    fetched page (final URL after redirects, title, plain text) or
 *    {error, message} with HTTP 400/502 when the page cannot be
 *    fetched (SSRF guard, DNS, timeout).
 *
 * What this piece ADDS (it does not replace M2/P6):
 *  - A dedicated Live Screen view of its own (window.EnzoLiveScreen):
 *    fullscreen, both sidebars hidden, no soft-focus filter — the same
 *    pattern as the P6 fullscreen view, but a standalone screen built
 *    for one running task: current-operation indicator, a real-time
 *    timeline of ACTUAL operations, and a LIVE BROWSER pane showing
 *    the actual pages ENZO is opening, rendered from real /api/fetch
 *    results (real URL, real title, real fetched-text summary) with a
 *    navigation history of pages actually visited during the task.
 *  - Live workflow: openLiveScreen(taskId) -> live environment ->
 *    streams real progress -> user observes / validates -> close
 *    returns to the normal layout with the accurate completed/failed
 *    state from the last real task fetch.
 *  - Pause / Resume / Stop wired to the real backend endpoints
 *    (POST /api/v2/tasks/{id}/pause|resume|cancel), preferably
 *    through window.EnzoMonitor when it is present (it calls exactly
 *    those URLs), otherwise by direct fetch to the same URLs.
 *  - Live guidance (mic + typing) inside the Live Screen that reaches
 *    the running task: it DELEGATES to window.EnzoMonitorFullscreen
 *    .applyGuidance when that module is present and only falls back
 *    to its own pause/resume/cancel/modify calls when it is absent.
 *    It does not rebuild the P6 guidance parser.
 *
 * What is REAL here and what is HONESTLY NOT possible:
 *  - REAL: task state, events, progress counts, sources, fetched page
 *    title/text/summary, control calls — all from the backend or the
 *    search proxy, never invented. Zero events means an empty timeline.
 *  - NOT POSSIBLE without extra auth/permissions: this screen shows
 *    ENZO's own server-side execution environment (the research proxy
 *    + backend). It can NEVER show or control the user's local
 *    computer or local browser: there is no local-browser automation
 *    in this build, no extension, no local agent. The UI labels this
 *    on the screen itself ("ENZO's research environment - not your
 *    device"). A page that blocks fetching shows its real error and
 *    permission state, never a fake success.
 *  - NO percentages anywhere: progress is shown only as real counts
 *    ("N of M agents finished", done/total from the progress
 *    payload). No progress bar is rendered from invented numbers.
 *  - NO simulated activity: no timers that fake work, no placeholder
 *    timeline entries, no fake browser navigation. The browser pane
 *    only ever shows a page after a real fetch returned for it.
 *
 * Lifecycle states (PRD section 8 display states):
 *  idle, processing, searching, researching, executing, validating,
 *  completed, failed, cancelled. Backend task states are MAPPED onto
 *  these (see mapTaskState); nothing is reported in a lifecycle state
 *  the backend did not actually reach. `paused` is a flag on top of
 *  the lifecycle, not a lifecycle state of its own.
 *
 * Style: plain ES5, var + function declarations, no modules, no
 * dependencies. Zero emojis. No paid API or key. The forbidden
 * example-topic literal appears nowhere in this file.
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '24-livescreen v1.0 (enao-research-live, 22 Nov 2026)';

  var API_BASE = window.EnzoPagesBackend.getBackendBase();
  var FETCH_BASE_DEFAULT = window.EnzoPagesBackend.getSearchUrl('/api/fetch');
  var BODY_CLASS = 'enzo-livescreen-open';
  var ROOT_ID = 'enzoLiveScreen';
  var CSS_ID = 'enzoLiveScreenCss';
  var POLL_INTERVAL_MS = 2500;
  var SUMMARY_MAX_CHARS = 600;
  var MAX_TIMELINE_ENTRIES = 500;
  var MAX_HISTORY_ENTRIES = 200;

  /* PRD section 8 lifecycle states (display states only). */
  var LIFECYCLE_STATES = [
    'idle', 'processing', 'searching', 'researching', 'executing',
    'validating', 'completed', 'failed', 'cancelled'
  ];

  var TERMINAL_LIFECYCLE = {
    completed: true, failed: true, cancelled: true
  };

  /* Backend task.state -> lifecycle. `partially_completed` is a
     completed outcome with a partial flag kept on the outcome. */
  var TASK_STATE_TO_LIFECYCLE = {
    queued: 'processing',
    planning: 'processing',
    running: 'executing',
    verifying: 'validating',
    paused: 'processing',
    completed: 'completed',
    partially_completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled'
  };

  /* Agent roles that mean "searching" vs "researching" (orchestrator
     ROLES, same split the M1 data layer uses). Verification roles mean
     "validating". Report synthesis stays "executing". */
  var SEARCHING_ROLES = {
    research_discovery: true, current_info: true, official_source: true
  };
  var RESEARCHING_ROLES = {
    data_collection: true, technical_analysis: true,
    historical_research: true, product_comparison: true
  };
  var VERIFICATION_ROLES = {
    fact_verification: true, contradiction_detection: true,
    quality_assurance: true
  };

  /* Human labels for the canonical backend event types
     (progress/progress.py EVENT_TYPES). Unknown types fall back to
     the type with underscores turned into spaces — never invented. */
  var EVENT_LABELS = {
    task_created: 'Task created',
    task_started: 'Task started',
    task_state: 'Task state changed',
    task_recovered: 'Task recovered',
    agent_created: 'Agent created',
    agent_started: 'Agent started',
    agent_progress: 'Agent progress',
    agent_completed: 'Agent completed',
    agent_failed: 'Agent failed',
    agent_verified: 'Agent verified',
    agent_reassigned: 'Agent reassigned',
    agent_released: 'Agent released',
    agent_paused: 'Agent paused',
    agent_resumed: 'Agent resumed',
    agent_cancelled: 'Agent cancelled',
    agent_queued: 'Agent queued',
    agent_running: 'Agent running',
    agent_done: 'Agent finished',
    subtask_completed: 'Subtask completed',
    failure: 'Failure',
    retry_started: 'Retry started',
    verification_started: 'Verification started',
    task_paused: 'Task paused',
    task_resumed: 'Task resumed',
    task_completed: 'Task completed',
    task_partially_completed: 'Task partially completed',
    task_cancelled: 'Task cancelled',
    task_modified: 'Task changed by guidance',
    finding_added: 'Finding added'
  };

  var ENV_LABEL = "ENZO's research environment - not your device";
  var ENV_NOTE = 'This screen shows what ENZO is doing on its own server ' +
    '(research proxy + backend). It does not show or control your ' +
    'computer or your browser.';

  /* ---------- small helpers ---------- */

  function lsTrim(s) {
    return String(s || '').replace(/^\s+|\s+$/g, '');
  }

  function lsIsPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function lsAsString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function lsAsNonEmptyString(v) {
    var s = lsTrim(lsAsString(v));
    return s ? s : null;
  }

  /* Backend created_at is unix seconds; task timestamps are ISO or
     epoch. Normalise to an ISO string, or null when unusable. Never
     invents a time. */
  function lsToIso(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      if (!isFinite(value) || value <= 0) return null;
      var ms = value < 1000000000000 ? value * 1000 : value;
      var d = new Date(ms);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof value === 'string') {
      var parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
      var num = Number(value);
      if (isFinite(num) && num > 0) return lsToIso(num);
      return null;
    }
    return null;
  }

  function lsNowIso() {
    return new Date().toISOString();
  }

  function lsClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function lsDoc() {
    if (typeof document !== 'undefined' && document) return document;
    return null;
  }

  function lsRoot() {
    if (typeof window !== 'undefined' && window) return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return root;
  }

  function lsEl(tag, className, text) {
    var doc = lsDoc();
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function lsClear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* ---------- pure: lifecycle mapping ---------- */

  function mapTaskState(taskState) {
    var s = lsTrim(lsAsString(taskState));
    if (TASK_STATE_TO_LIFECYCLE[s]) return TASK_STATE_TO_LIFECYCLE[s];
    return 'idle';
  }

  function isTerminalLifecycle(lifecycle) {
    return !!TERMINAL_LIFECYCLE[lsTrim(lsAsString(lifecycle))];
  }

  /* Refine the lifecycle from one real event type (+ agent role when
     present). Returns a lifecycle state, or null when the event says
     nothing about the phase (caller keeps the current lifecycle).
     Terminal event types always win. */
  function lifecycleFromEventType(eventType, detail) {
    var t = lsTrim(lsAsString(eventType));
    var d = lsIsPlainObject(detail) ? detail : {};
    if (t === 'task_completed' || t === 'task_partially_completed') return 'completed';
    if (t === 'task_cancelled') return 'cancelled';
    if (t === 'failure' || t === 'agent_failed') return 'failed';
    if (t === 'verification_started' || t === 'agent_verified') return 'validating';
    if (t === 'task_started' || t === 'task_created' || t === 'task_recovered') return 'processing';
    if (t === 'agent_started' || t === 'agent_progress' || t === 'agent_running') {
      var role = lsAsString(d.role || (d.agent && d.agent.role) || '');
      if (VERIFICATION_ROLES[role]) return 'validating';
      if (SEARCHING_ROLES[role]) return 'searching';
      if (RESEARCHING_ROLES[role]) return 'researching';
      if (role === 'report_synthesis') return 'executing';
      return null;
    }
    if (t === 'agent_completed' || t === 'agent_done' || t === 'subtask_completed') return null;
    return null;
  }

  /* ---------- pure: events -> timeline ---------- */

  function lsDetailOf(event) {
    if (lsIsPlainObject(event.detail)) return event.detail;
    if (typeof event.detail === 'string') {
      try {
        var parsed = JSON.parse(event.detail);
        return lsIsPlainObject(parsed) ? parsed : { value: event.detail };
      } catch (e) {
        return { value: event.detail };
      }
    }
    return {};
  }

  function lsUrlFromDetail(detail) {
    var candidates = [
      detail.url, detail.final_url,
      detail.source && detail.source.url,
      detail.source && detail.source.final_url
    ];
    for (var i = 0; i < candidates.length; i++) {
      var u = lsAsNonEmptyString(candidates[i]);
      if (u) return u;
    }
    return null;
  }

  function lsTitleFromDetail(detail) {
    if (lsIsPlainObject(detail.source)) {
      var t = lsAsNonEmptyString(detail.source.title);
      if (t) return t;
    }
    return lsAsNonEmptyString(detail.title);
  }

  function eventLabel(eventType, detail) {
    var t = lsTrim(lsAsString(eventType));
    var base = EVENT_LABELS[t] || t.replace(/_/g, ' ') || 'Event';
    var d = lsIsPlainObject(detail) ? detail : {};
    var role = lsAsString(d.role || (d.agent && d.agent.role) || '');
    if (role) base += ' - ' + role.replace(/_/g, ' ');
    var subtask = lsAsNonEmptyString(d.subtask);
    if (subtask) base += ': ' + subtask;
    return base;
  }

  /* Normalise one raw backend event (public_event shape:
     {event_id, chat_id, task_id, agent_id, type, detail, created_at}).
     Returns null when the event is unusable — it is dropped, never
     shown as invented activity. */
  function normalizeEvent(raw) {
    if (!lsIsPlainObject(raw)) return null;
    var type = lsAsNonEmptyString(raw.type);
    if (!type) return null;
    var eventId = raw.event_id;
    if (eventId === null || eventId === undefined || eventId === '') return null;
    var detail = lsDetailOf(raw);
    var detailText = lsAsNonEmptyString(detail.message) ||
      lsAsNonEmptyString(detail.text) ||
      lsAsNonEmptyString(detail.value) || '';
    return {
      eventId: eventId,
      taskId: lsAsNonEmptyString(raw.task_id),
      agentId: lsAsNonEmptyString(raw.agent_id),
      type: type,
      label: eventLabel(type, detail),
      detailText: detailText,
      url: lsUrlFromDetail(detail),
      title: lsTitleFromDetail(detail),
      createdAt: lsToIso(raw.created_at),
      kind: 'backend'
    };
  }

  /* Append real events to a timeline, deduplicated by event_id.
     Returns {timeline, added}. Never invents entries; invalid events
     are skipped and counted nowhere. */
  function appendEvents(timeline, seen, events) {
    var list = Array.isArray(timeline) ? timeline : [];
    var seenMap = seen || {};
    var added = 0;
    var i, norm;
    if (!Array.isArray(events)) return { timeline: list, added: 0 };
    for (i = 0; i < events.length; i++) {
      norm = normalizeEvent(events[i]);
      if (!norm) continue;
      var key = String(norm.eventId);
      if (seenMap[key]) continue;
      seenMap[key] = true;
      list.push(norm);
      added++;
    }
    list.sort(function (a, b) {
      var na = Number(a.eventId), nb = Number(b.eventId);
      if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
      var ta = a.createdAt || '', tb = b.createdAt || '';
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });
    while (list.length > MAX_TIMELINE_ENTRIES) list.shift();
    return { timeline: list, added: added };
  }

  /* ---------- pure: fetched pages ---------- */

  /* First N chars of real fetched text, whitespace collapsed. Empty
     stays empty — no summary is invented for a page with no text. */
  function summarizeText(text, maxChars) {
    var s = lsAsString(text || '').replace(/\s+/g, ' ');
    s = lsTrim(s);
    var max = (typeof maxChars === 'number' && maxChars > 0) ? maxChars : SUMMARY_MAX_CHARS;
    if (s.length > max) return s.slice(0, max) + '...';
    return s;
  }

  /* Build the browser-pane record from a REAL /api/fetch result
     ({url, title, text}) or from its real error ({error, message}).
     The url kept is the proxy's returned final URL, never the
     requested URL when the proxy reports a different one. */
  function buildPageSummary(result, requestedUrl) {
    var reqUrl = lsAsNonEmptyString(requestedUrl) || '';
    if (!lsIsPlainObject(result)) {
      return { url: reqUrl, title: '', summary: '', status: 'error',
        error: 'Empty response from the fetch service.', fetchedAt: lsNowIso() };
    }
    if (result.error) {
      return { url: lsAsNonEmptyString(result.url) || reqUrl, title: '',
        summary: '', status: 'error',
        error: lsAsString(result.message || result.error),
        fetchedAt: lsNowIso() };
    }
    var url = lsAsNonEmptyString(result.url) || reqUrl;
    if (!url) {
      return { url: '', title: '', summary: '', status: 'error',
        error: 'The fetch service returned no URL.', fetchedAt: lsNowIso() };
    }
    return { url: url, title: lsAsString(result.title || ''),
      summary: summarizeText(result.text || '', SUMMARY_MAX_CHARS),
      status: 'ok', error: null, fetchedAt: lsNowIso() };
  }

  /* ---------- pure: guidance classification (fallback only) ---------- */

  /* Used ONLY when window.EnzoMonitorFullscreen.applyGuidance is not
     present. The fullscreen module's parser is preferred (see
     sendGuidance). Verbs are matched on the user's own words; the
     steer case sends the user's words verbatim to /modify and shows
     the backend's real answer (400/409 included). */
  function classifyGuidance(text) {
    var raw = lsTrim(lsAsString(text));
    if (!raw) return { intent: 'empty', raw: raw, action: null, topic: '' };
    var low = raw.toLowerCase();
    if (/\b(stop|cancel|abort|end this)\b/.test(low)) {
      return { intent: 'cancel', raw: raw, action: 'cancel', topic: '' };
    }
    if (/\b(pause|hold on|wait|stop for now)\b/.test(low)) {
      return { intent: 'pause', raw: raw, action: 'pause', topic: '' };
    }
    if (/\b(resume|continue|carry on|go on)\b/.test(low)) {
      return { intent: 'resume', raw: raw, action: 'resume', topic: '' };
    }
    return { intent: 'steer', raw: raw, action: 'modify', topic: raw };
  }

  /* ---------- pure: endpoint URLs ---------- */

  function eventsUrl(chatId, since) {
    return API_BASE + '/chats/' + encodeURIComponent(chatId) +
      '/events?since=' + (typeof since === 'number' ? since : 0);
  }

  function taskUrl(taskId) {
    return API_BASE + '/tasks/' + encodeURIComponent(taskId);
  }

  function progressUrl(taskId) {
    return API_BASE + '/tasks/' + encodeURIComponent(taskId) + '/progress';
  }

  function sourcesUrl(taskId) {
    return API_BASE + '/tasks/' + encodeURIComponent(taskId) + '/sources';
  }

  function controlUrl(taskId, action) {
    return API_BASE + '/tasks/' + encodeURIComponent(taskId) + '/' + action;
  }

  function fetchPageUrl(fetchBase, url) {
    var base = lsAsNonEmptyString(fetchBase) || FETCH_BASE_DEFAULT;
    return base + '?url=' + encodeURIComponent(url);
  }

  /* ---------- singleton state ---------- */

  var S = {
    open: false,
    taskId: null,
    chatId: null,
    lifecycle: 'idle',
    taskState: null,
    taskError: null,
    paused: false,
    partial: false,
    outcome: null,
    timeline: [],
    seenEventIds: {},
    sinceCursor: 0,
    history: [],
    currentPage: null,
    currentOperation: null,
    progressDone: null,
    progressTotal: null,
    sourcesNote: '',
    error: null,
    connected: false,
    pollTimer: null,
    pollInFlight: false,
    fetchFn: null,
    fetchBase: FETCH_BASE_DEFAULT,
    pollIntervalMs: POLL_INTERVAL_MS,
    autoPoll: true,
    onClose: null
  };

  var rootEl = null;
  var els = {};
  var styleEl = null;
  var lastFocused = null;
  var keyListenerAttached = false;

  function resetState(taskId, chatId, opts) {
    S.taskId = taskId;
    S.chatId = chatId || null;
    S.lifecycle = 'idle';
    S.taskState = null;
    S.taskError = null;
    S.paused = false;
    S.partial = false;
    S.outcome = null;
    S.timeline = [];
    S.seenEventIds = {};
    S.sinceCursor = 0;
    S.history = [];
    S.currentPage = null;
    S.currentOperation = null;
    S.progressDone = null;
    S.progressTotal = null;
    S.sourcesNote = '';
    S.error = null;
    S.connected = false;
    S.pollInFlight = false;
    S.fetchFn = (opts && typeof opts.fetchFn === 'function') ? opts.fetchFn : null;
    S.fetchBase = (opts && lsAsNonEmptyString(opts.fetchBase)) || FETCH_BASE_DEFAULT;
    S.pollIntervalMs = (opts && typeof opts.pollIntervalMs === 'number' && opts.pollIntervalMs > 0)
      ? opts.pollIntervalMs : POLL_INTERVAL_MS;
    S.autoPoll = !(opts && opts.autoPoll === false);
    S.eventsOff59 = false;
    S.onClose = (opts && typeof opts.onClose === 'function') ? opts.onClose : null;
  }

  function getFetchFn() {
    if (S.fetchFn) return S.fetchFn;
    var w = lsRoot();
    if (w && typeof w.fetch === 'function') return w.fetch;
    if (typeof fetch !== 'undefined' && fetch) return fetch;
    return null;
  }

  function httpJson(url, options) {
    var f = getFetchFn();
    if (!f) {
      return Promise.reject(new Error('Fetch is not available in this environment.'));
    }
    return Promise.resolve().then(function () {
      return f(url, options || {});
    }).then(function (resp) {
      if (!resp) throw new Error('Empty response from ' + url + '.');
      var payload = (typeof resp.json === 'function')
        ? resp.json()
        : Promise.reject(new Error('Response was not JSON.'));
      return Promise.resolve(payload).then(function (j) {
        if (!resp.ok) {
          var m = (j && (j.message || j.error)) ||
            ('Request failed with status ' + resp.status + '.');
          throw new Error(String(m));
        }
        return j;
      });
    });
  }

  function httpGet(url) {
    return httpJson(url, { method: 'GET' });
  }

  function httpPost(url, body) {
    return httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  /* ---------- state application (real data only) ---------- */

  function applyTaskData(task) {
    if (!lsIsPlainObject(task)) return;
    S.taskState = lsAsNonEmptyString(task.state);
    S.taskError = lsAsNonEmptyString(task.error);
    S.paused = (S.taskState === 'paused');
    S.partial = (S.taskState === 'partially_completed');
    S.lifecycle = mapTaskState(S.taskState);
    if (isTerminalLifecycle(S.lifecycle)) {
      S.outcome = {
        state: S.taskState,
        lifecycle: S.lifecycle,
        partial: S.partial,
        error: S.taskError,
        finishedAt: lsToIso(task.finished_at)
      };
    } else {
      S.outcome = null;
    }
  }

  function applyProgressData(p) {
    if (!lsIsPlainObject(p)) return;
    if (typeof p.done === 'number') S.progressDone = p.done;
    if (typeof p.total === 'number') S.progressTotal = p.total;
    var state = lsAsNonEmptyString(p.state);
    if (state && !S.taskState) S.taskState = state;
    if (Array.isArray(p.agents)) {
      for (var i = 0; i < p.agents.length; i++) {
        var a = p.agents[i];
        if (lsIsPlainObject(a) && (a.status === 'running' || a.status === 'queued')) {
          var role = lsAsString(a.role || '').replace(/_/g, ' ');
          var sub = lsAsNonEmptyString(a.subtask);
          S.currentOperation = (role ? role : 'Agent') + (sub ? ': ' + sub : '') + ' (' + a.status + ')';
          break;
        }
      }
    }
  }

  function applyEventsData(j) {
    if (!lsIsPlainObject(j)) return;
    var events = Array.isArray(j.events) ? j.events : [];
    var res = appendEvents(S.timeline, S.seenEventIds, events);
    S.timeline = res.timeline;
    if (typeof j.last_event_id === 'number' && j.last_event_id > S.sinceCursor) {
      S.sinceCursor = j.last_event_id;
    }
    if (res.added > 0) {
      var latest = S.timeline[S.timeline.length - 1];
      if (latest) {
        S.currentOperation = latest.label;
        var refined = lifecycleFromEventType(latest.type, null);
        if (refined && !isTerminalLifecycle(S.lifecycle)) {
          if (S.taskState === 'running' || !S.taskState) S.lifecycle = refined;
        }
        if (latest.type === 'task_completed' || latest.type === 'task_partially_completed') {
          S.lifecycle = 'completed';
          S.partial = (latest.type === 'task_partially_completed');
          S.outcome = { state: S.taskState || 'completed', lifecycle: 'completed',
            partial: S.partial, error: S.taskError, finishedAt: latest.createdAt };
        } else if (latest.type === 'task_cancelled') {
          S.lifecycle = 'cancelled';
          S.outcome = { state: 'cancelled', lifecycle: 'cancelled',
            partial: false, error: S.taskError, finishedAt: latest.createdAt };
        } else if (latest.type === 'failure') {
          S.lifecycle = 'failed';
          S.outcome = { state: S.taskState || 'failed', lifecycle: 'failed',
            partial: false, error: S.taskError, finishedAt: latest.createdAt };
        }
        if (latest.url) recordHistoryVisit(latest.url, latest.title, 'backend-event');
      }
    }
  }

  /* A page ENZO's server-side run actually touched. `provenance`
     says how we know: 'backend-event' (a real event carried the URL),
     'backend-source' (the real sources list), or 'live-fetch' (this
     screen fetched it through /api/fetch and shows its real content).
     Nothing is added without a real URL from one of those. */
  function recordHistoryVisit(url, title, provenance) {
    var u = lsAsNonEmptyString(url);
    if (!u) return null;
    for (var i = 0; i < S.history.length; i++) {
      if (S.history[i].url === u) {
        if (title && !S.history[i].title) S.history[i].title = title;
        if (provenance === 'live-fetch') S.history[i].provenance = 'live-fetch';
        return S.history[i];
      }
    }
    var entry = { url: u, title: lsAsString(title || ''),
      provenance: provenance || 'backend-event',
      status: (provenance === 'live-fetch') ? 'ok' : 'visited',
      error: null, fetchedAt: lsNowIso() };
    S.history.push(entry);
    while (S.history.length > MAX_HISTORY_ENTRIES) S.history.shift();
    return entry;
  }

  function applySourcesData(j) {
    if (!lsIsPlainObject(j)) return;
    var sources = Array.isArray(j.sources) ? j.sources : [];
    var unverified = Array.isArray(j.unverified) ? j.unverified : [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!lsIsPlainObject(s)) continue;
      var url = lsAsNonEmptyString(s.final_url) || lsAsNonEmptyString(s.url);
      recordHistoryVisit(url, lsAsString(s.title || ''), 'backend-source');
    }
    for (var k = 0; k < unverified.length; k++) {
      var u2 = unverified[k];
      if (!lsIsPlainObject(u2)) continue;
      var url2 = lsAsNonEmptyString(u2.final_url) || lsAsNonEmptyString(u2.url);
      var entry = recordHistoryVisit(url2, lsAsString(u2.title || ''), 'backend-source');
      if (entry) {
        entry.status = 'unverified';
        entry.error = lsAsNonEmptyString(u2.reason) || 'unverified';
      }
    }
    var verified = (typeof j.sources_verified === 'number') ? j.sources_verified : sources.length;
    S.sourcesNote = verified + ' verified source(s) listed; ' +
      unverified.length + ' unverified (shown with their reason, never as citations).';
  }

  /* ---------- CSS (injected once; namespaced; no soft-focus filter) ---------- */

  var CSS_TEXT =
    'body.enzo-livescreen-open { overflow: hidden; }\n' +
    'body.enzo-livescreen-open #sidebar,\n' +
    'body.enzo-livescreen-open #enzoPanel,\n' +
    'body.enzo-livescreen-open main.main,\n' +
    'body.enzo-livescreen-open #enzoFab,\n' +
    'body.enzo-livescreen-open #enzoMonitorBackdrop { display: none !important; }\n' +
    '#enzoLiveScreen { position: fixed; top: 0; right: 0; bottom: 0; left: 0; ' +
    'width: 100vw; height: 100vh; height: 100dvh; z-index: 62; display: flex; ' +
    'flex-direction: column; background: var(--surface, #0B1530); ' +
    'color: var(--ink, #F8FAFC); border: 0; overflow: hidden; ' +
    'font-size: 14px; line-height: 1.55; }\n' +
    '#enzoLiveScreen[hidden] { display: none; }\n' +
    '.enzo-livescreen-head { padding: 14px 18px 10px; border-bottom: 1px solid var(--hatch-widget-border, #1E2A4A); }\n' +
    '.enzo-livescreen-head h2 { margin: 0 0 2px; font-size: 17px; }\n' +
    '.enzo-livescreen-env { font-size: 12.5px; font-weight: 700; color: #00D9FF; margin: 0 0 4px; }\n' +
    '.enzo-livescreen-note { font-size: 12.5px; color: var(--muted, #AAB8D0); margin: 0; }\n' +
    '.enzo-livescreen-close { position: absolute; top: 12px; right: 14px; }\n' +
    '.enzo-livescreen-body { flex: 1; overflow-y: auto; padding: 14px 18px; max-width: 980px; width: 100%; margin: 0 auto; }\n' +
    '.enzo-livescreen-op { border: 1px solid rgba(0, 217, 255, .45); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; background: var(--surface2, #101B3A); }\n' +
    '.enzo-livescreen-op b { display: block; font-size: 13px; }\n' +
    '.enzo-livescreen-op span { font-size: 12.5px; color: var(--muted, #AAB8D0); }\n' +
    '.enzo-livescreen-sec { font-size: 13px; font-weight: 700; margin: 16px 0 6px; }\n' +
    '.enzo-livescreen-timeline, .enzo-livescreen-history { list-style: none; margin: 0; padding: 0; }\n' +
    '.enzo-livescreen-timeline li, .enzo-livescreen-history li { padding: 7px 10px; border: 1px solid var(--hatch-widget-border, #1E2A4A); border-radius: 8px; margin-bottom: 6px; font-size: 13px; }\n' +
    '.enzo-livescreen-timeline li small, .enzo-livescreen-history li small { display: block; font-size: 11.5px; color: var(--muted, #AAB8D0); }\n' +
    '.enzo-livescreen-empty { font-size: 13px; color: var(--muted, #AAB8D0); margin: 4px 0; }\n' +
    '.enzo-livescreen-error { border: 1px solid #F87171; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 13px; background: #2A1220; }\n' +
    '.enzo-livescreen-browser { border: 1px solid var(--hatch-widget-border, #1E2A4A); border-radius: 10px; padding: 10px 12px; margin-bottom: 6px; background: var(--surface2, #101B3A); }\n' +
    '.enzo-livescreen-browser .enzo-livescreen-url { font-size: 12.5px; color: #00D9FF; word-break: break-all; }\n' +
    '.enzo-livescreen-browser h3 { margin: 6px 0 4px; font-size: 14px; }\n' +
    '.enzo-livescreen-browser p { margin: 0; font-size: 13px; }\n' +
    '.enzo-livescreen-controls { display: flex; gap: 8px; margin: 14px 0; flex-wrap: wrap; }\n' +
    '.enzo-livescreen-controls button, .enzo-livescreen-close, .enzo-livescreen-guide button { cursor: pointer; border: 1px solid var(--hatch-widget-border, #1E2A4A); background: var(--surface2, #101B3A); color: var(--ink, #F8FAFC); border-radius: 8px; padding: 7px 12px; font-size: 13px; }\n' +
    '.enzo-livescreen-controls button[disabled], .enzo-livescreen-guide button[disabled] { opacity: .45; cursor: default; }\n' +
    '.enzo-livescreen-guide { border: 1px solid rgba(0, 217, 255, .45); border-radius: 10px; padding: 10px 12px; margin-top: 14px; }\n' +
    '.enzo-livescreen-guide-row { display: flex; gap: 8px; }\n' +
    '.enzo-livescreen-guide input { flex: 1; min-width: 0; border: 1px solid var(--hatch-widget-border, #1E2A4A); border-radius: 8px; background: var(--surface, #0B1530); color: var(--ink, #F8FAFC); padding: 7px 10px; font-size: 13px; }\n' +
    '.enzo-livescreen-status { font-size: 12.5px; color: var(--muted, #AAB8D0); margin: 8px 0 0; }\n';

  /* ---------- DOM build ---------- */

  function ensureStyle() {
    var doc = lsDoc();
    if (!doc || styleEl) return;
    if (doc.getElementById) {
      var existing = doc.getElementById(CSS_ID);
      if (existing) { styleEl = existing; return; }
    }
    styleEl = doc.createElement('style');
    styleEl.id = CSS_ID;
    styleEl.textContent = CSS_TEXT;
    var head = doc.head || doc.body;
    if (head && head.appendChild) head.appendChild(styleEl);
  }

  function buildDom() {
    var doc = lsDoc();
    if (!doc) return null;
    ensureStyle();
    var rootNode = lsEl('div', null, null);
    rootNode.id = ROOT_ID;
    rootNode.hidden = true;
    rootNode.setAttribute('role', 'dialog');
    rootNode.setAttribute('aria-label', 'Live Screen - ENZO research');

    var head = lsEl('div', 'enzo-livescreen-head', null);
    var env = lsEl('p', 'enzo-livescreen-env', ENV_LABEL);
    var title = lsEl('h2', null, 'Live Screen');
    var note = lsEl('p', 'enzo-livescreen-note', ENV_NOTE);
    head.appendChild(env);
    head.appendChild(title);
    head.appendChild(note);
    var closeBtn = lsEl('button', 'enzo-livescreen-close', 'Close');
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('aria-label', 'Close Live Screen');
    head.appendChild(closeBtn);

    var body = lsEl('div', 'enzo-livescreen-body', null);

    var opBox = lsEl('div', 'enzo-livescreen-op', null);
    var opLabel = lsEl('b', null, 'Current operation');
    var opText = lsEl('span', null, 'Waiting - no operation has started yet.');
    opBox.appendChild(opLabel);
    opBox.appendChild(opText);

    var statusLine = lsEl('p', 'enzo-livescreen-status', 'Status: idle');

    var errBox = lsEl('div', 'enzo-livescreen-error', null);
    errBox.hidden = true;

    var controls = lsEl('div', 'enzo-livescreen-controls', null);
    var pauseBtn = lsEl('button', null, 'Pause');
    pauseBtn.setAttribute('type', 'button');
    var resumeBtn = lsEl('button', null, 'Resume');
    resumeBtn.setAttribute('type', 'button');
    var stopBtn = lsEl('button', null, 'Stop');
    stopBtn.setAttribute('type', 'button');
    controls.appendChild(pauseBtn);
    controls.appendChild(resumeBtn);
    controls.appendChild(stopBtn);

    var tlTitle = lsEl('h3', 'enzo-livescreen-sec', 'Live timeline - actual operations only');
    var tlEmpty = lsEl('p', 'enzo-livescreen-empty',
      'No operations yet - the timeline fills only as real backend events arrive.');
    var tlList = lsEl('ul', 'enzo-livescreen-timeline', null);

    var brTitle = lsEl('h3', 'enzo-livescreen-sec', 'Live browser - pages ENZO is opening');
    var brNote = lsEl('p', 'enzo-livescreen-empty',
      'Pages appear here only after ENZO fetched them on its server. ' +
      'Select a page from the history below to load its real fetched content.');
    var brPane = lsEl('div', 'enzo-livescreen-browser', null);
    var brUrl = lsEl('p', 'enzo-livescreen-url', 'No page open yet.');
    var brHeading = lsEl('h3', null, '');
    var brSummary = lsEl('p', null, '');
    brPane.appendChild(brUrl);
    brPane.appendChild(brHeading);
    brPane.appendChild(brSummary);

    var histTitle = lsEl('h3', 'enzo-livescreen-sec', 'Pages visited during this task');
    var histEmpty = lsEl('p', 'enzo-livescreen-empty', 'No pages visited yet.');
    var histList = lsEl('ul', 'enzo-livescreen-history', null);

    var guide = lsEl('div', 'enzo-livescreen-guide', null);
    var guideLabel = lsEl('p', null, 'Guide the running task (mic or typing):');
    var guideRow = lsEl('div', 'enzo-livescreen-guide-row', null);
    var micBtn = lsEl('button', null, 'Mic');
    micBtn.setAttribute('type', 'button');
    micBtn.setAttribute('aria-label', 'Guide by voice');
    var guideInput = lsEl('input', null, null);
    guideInput.setAttribute('type', 'text');
    guideInput.setAttribute('placeholder', 'Type an instruction for the running task');
    guideInput.setAttribute('aria-label', 'Guide the running task');
    var sendBtn = lsEl('button', null, 'Send');
    sendBtn.setAttribute('type', 'button');
    guideRow.appendChild(micBtn);
    guideRow.appendChild(guideInput);
    guideRow.appendChild(sendBtn);
    var guideStatus = lsEl('p', 'enzo-livescreen-status', '');
    guide.appendChild(guideLabel);
    guide.appendChild(guideRow);
    guide.appendChild(guideStatus);

    body.appendChild(opBox);
    body.appendChild(statusLine);
    body.appendChild(errBox);
    body.appendChild(controls);
    body.appendChild(tlTitle);
    body.appendChild(tlEmpty);
    body.appendChild(tlList);
    body.appendChild(brTitle);
    body.appendChild(brNote);
    body.appendChild(brPane);
    body.appendChild(histTitle);
    body.appendChild(histEmpty);
    body.appendChild(histList);
    body.appendChild(guide);

    rootNode.appendChild(head);
    rootNode.appendChild(body);
    if (doc.body && doc.body.appendChild) doc.body.appendChild(rootNode);

    els = {
      root: rootNode, closeBtn: closeBtn, opText: opText,
      statusLine: statusLine, errBox: errBox,
      pauseBtn: pauseBtn, resumeBtn: resumeBtn, stopBtn: stopBtn,
      tlEmpty: tlEmpty, tlList: tlList,
      brUrl: brUrl, brHeading: brHeading, brSummary: brSummary,
      histEmpty: histEmpty, histList: histList,
      micBtn: micBtn, guideInput: guideInput, sendBtn: sendBtn,
      guideStatus: guideStatus
    };

    closeBtn.addEventListener('click', function () { closeLiveScreen(); });
    pauseBtn.addEventListener('click', function () { controlTask('pause'); });
    resumeBtn.addEventListener('click', function () { controlTask('resume'); });
    stopBtn.addEventListener('click', function () { controlTask('cancel'); });
    sendBtn.addEventListener('click', function () {
      var text = guideInput.value;
      sendGuidance(text).then(function () { guideInput.value = ''; }, function () { /* status already shows the real error */ });
    });
    guideInput.addEventListener('keydown', function (e) {
      if (e && e.key === 'Enter') {
        var text = guideInput.value;
        sendGuidance(text).then(function () { guideInput.value = ''; }, function () { /* status already shows the real error */ });
      }
    });
    micBtn.addEventListener('click', function () { startMic(); });
    histList.addEventListener('click', function (e) {
      var t = e && e.target;
      if (!t) return;
      var url = t.getAttribute ? t.getAttribute('data-url') : null;
      if (url) renderPage(url);
    });
    return rootNode;
  }

  /* ---------- render (state -> DOM, real data only) ---------- */

  function render() {
    if (!rootEl || !els.root) return;
    var status = 'Status: ' + S.lifecycle;
    if (S.paused) status += ' (paused)';
    if (S.partial) status += ' (partially completed)';
    if (S.progressDone !== null && S.progressTotal !== null) {
      status += ' - ' + S.progressDone + ' of ' + S.progressTotal + ' agents finished';
    }
    els.statusLine.textContent = status;

    els.opText.textContent = S.currentOperation ||
      (isTerminalLifecycle(S.lifecycle)
        ? 'Task ended: ' + S.lifecycle + '.'
        : 'Waiting - no operation has started yet.');

    if (S.error || S.taskError) {
      els.errBox.hidden = false;
      els.errBox.textContent = 'Error: ' + (S.error || S.taskError);
    } else {
      els.errBox.hidden = true;
      els.errBox.textContent = '';
    }

    var terminal = isTerminalLifecycle(S.lifecycle);
    els.pauseBtn.disabled = terminal || S.paused || !S.taskId;
    els.resumeBtn.disabled = terminal || !S.paused || !S.taskId;
    els.stopBtn.disabled = terminal || !S.taskId;

    els.tlEmpty.hidden = S.timeline.length > 0;
    lsClear(els.tlList);
    for (var i = 0; i < S.timeline.length; i++) {
      var entry = S.timeline[i];
      var li = lsEl('li', null, null);
      var label = lsEl('span', null, entry.label);
      li.appendChild(label);
      var meta = lsEl('small', null,
        (entry.createdAt || 'time unknown') +
        (entry.detailText ? ' - ' + entry.detailText : '') +
        (entry.url ? ' - ' + entry.url : ''));
      li.appendChild(meta);
      els.tlList.appendChild(li);
    }

    if (S.currentPage) {
      var cp = S.currentPage;
      els.brUrl.textContent = cp.url || 'No page open yet.';
      if (cp.status === 'loading') {
        els.brHeading.textContent = 'Loading the real page...';
        els.brSummary.textContent = '';
      } else if (cp.status === 'error') {
        els.brHeading.textContent = 'This page could not be fetched.';
        els.brSummary.textContent = 'Real error from the fetch service: ' + (cp.error || 'unknown error');
      } else {
        els.brHeading.textContent = cp.title || '(no title returned)';
        els.brSummary.textContent = cp.summary || '(the fetched page returned no text)';
      }
    } else {
      els.brUrl.textContent = 'No page open yet.';
      els.brHeading.textContent = '';
      els.brSummary.textContent = '';
    }

    els.histEmpty.hidden = S.history.length > 0;
    lsClear(els.histList);
    for (var h = 0; h < S.history.length; h++) {
      var item = S.history[h];
      var hli = lsEl('li', null, null);
      var btn = lsEl('button', null, (item.title || item.url));
      btn.setAttribute('type', 'button');
      btn.setAttribute('data-url', item.url);
      btn.addEventListener('click', (function (u) {
        return function () { renderPage(u); };
      })(item.url));
      hli.appendChild(btn);
      var hmeta = lsEl('small', null,
        item.url + ' - ' + item.provenance +
        (item.status === 'unverified' ? ' - unverified: ' + (item.error || 'unverified') : '') +
        (item.status === 'error' ? ' - fetch failed: ' + (item.error || 'unknown error') : ''));
      hli.appendChild(hmeta);
      els.histList.appendChild(hli);
    }
  }

  /* ---------- polling (real backend only) ---------- */

  function stopPollTimer() {
    if (S.pollTimer) {
      if (typeof clearTimeout !== 'undefined') clearTimeout(S.pollTimer);
      S.pollTimer = null;
    }
  }

  function schedulePoll() {
    if (!S.open || !S.autoPoll) return;
    if (isTerminalLifecycle(S.lifecycle)) return;
    stopPollTimer();
    S.pollTimer = setTimeout(function () {
      S.pollTimer = null;
      pollOnce().then(function () { schedulePoll(); }, function () { schedulePoll(); });
    }, S.pollIntervalMs);
  }

  /* One poll round: task + progress + events (+ sources once the task
     is terminal). Returns a promise resolving to true when the round
     ran. Any failure is recorded as the real error; nothing is
     invented to fill the gap. */
  function pollOnce() {
    if (!S.open || !S.taskId || S.pollInFlight) {
      return Promise.resolve(false);
    }
    S.pollInFlight = true;
    var taskId = S.taskId;
    var chatId = S.chatId;
    var terminalBefore = isTerminalLifecycle(S.lifecycle);
    var chain = Promise.resolve();

    chain = chain.then(function () {
      return EnzoPollLoop.dedupedFetch('/api/v2/tasks/' + encodeURIComponent(taskId), {}, function(){ return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTask(taskId) : httpGet(taskUrl(taskId))); });
    }).then(function (j) {
      var task = (j && j.task) ? j.task : j;
      applyTaskData(task);
      S.connected = true;
      S.error = null;
    }, function (err) {
      if (err && err.status === 404) { S.autoPoll = false; stopPollTimer(); } // v59: a task 404 stops the Live Screen poll loop.
      S.error = err && err.message ? err.message : 'Task request failed.';
    });

    /* Progress first, events last: the current-operation indicator
       then reflects the latest real event, not the progress snapshot
       taken a moment earlier. */
    chain = chain.then(function () {
      return EnzoPollLoop.dedupedFetch('/api/v2/tasks/' + encodeURIComponent(taskId) + '/progress', {}, function(){ return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getTaskProgress(taskId) : httpGet(progressUrl(taskId))); });
    }).then(function (p) {
      applyProgressData(p);
    }, function (err) { if (err && err.status === 404) { S.autoPoll = false; stopPollTimer(); } /* v59: a progress 404 stops the loop; other progress failures are best-effort */ });

    if (chatId && !S.eventsOff59) {
      chain = chain.then(function () {
        return EnzoPollLoop.dedupedFetch('/api/v2/chats/' + encodeURIComponent(chatId) + '/events?since=' + S.sinceCursor, {}, function(){ return (window.__enzoGetTransport59 ? window.__enzoGetTransport59().getChatEvents(chatId, S.sinceCursor) : httpGet(eventsUrl(chatId, S.sinceCursor))); });
      }).then(function (j) {
        applyEventsData(j);
        S.connected = true;
        S.error = null;
      }, function (err) {
        if (err && (err.status === 404 || err.code === 'chat-local-only')) S.eventsOff59 = true; // v59: a chat 404 skips only the events leg; task/progress keep polling while the task is known.
        S.error = err && err.message ? err.message : 'Events request failed.';
      });
    }

    chain = chain.then(function () {
      if (isTerminalLifecycle(S.lifecycle) && !terminalBefore) {
        return EnzoPollLoop.dedupedFetch('/api/v2/tasks/' + encodeURIComponent(taskId) + '/sources', {}, function(){ return httpGet(sourcesUrl(taskId)); }).then(function (j) {
          applySourcesData(j);
        }, function () { /* sources failure is shown via S.error only if nothing else failed */ });
      }
      return null;
    });

    return chain.then(function () {
      S.pollInFlight = false;
      render();
      return true;
    }, function (err) {
      S.pollInFlight = false;
      S.error = (err && err.message) ? err.message : 'Polling failed.';
      render();
      return true;
    });
  }

  /* ---------- live browser pane ---------- */

  /* Fetch one page through the real search proxy and show what it
     actually returned. Returns a promise resolving to the page
     record. A blocked/failed fetch records the real error. */
  function renderPage(url) {
    var u = lsAsNonEmptyString(url);
    if (!u) return Promise.reject(new Error('No URL was given.'));
    if (!S.open) return Promise.reject(new Error('The Live Screen is not open.'));
    S.currentPage = { url: u, title: '', summary: '', status: 'loading', error: null, fetchedAt: lsNowIso() };
    render();
    return httpGet(fetchPageUrl(S.fetchBase, u)).then(function (result) {
      var page = buildPageSummary(result, u);
      S.currentPage = page;
      var entry = recordHistoryVisit(page.url, page.title, 'live-fetch');
      if (entry) {
        entry.status = page.status;
        entry.error = page.error;
        entry.fetchedAt = page.fetchedAt;
      }
      render();
      return page;
    }, function (err) {
      var page = { url: u, title: '', summary: '', status: 'error',
        error: (err && err.message) ? err.message : 'Fetch failed.',
        fetchedAt: lsNowIso() };
      S.currentPage = page;
      var entry = recordHistoryVisit(u, '', 'live-fetch');
      if (entry) { entry.status = 'error'; entry.error = page.error; }
      render();
      return page;
    });
  }

  /* ---------- task control (real endpoints) ---------- */

  function getMonitor() {
    try {
      var w = lsRoot();
      return (w && w.EnzoMonitor) ? w.EnzoMonitor : null;
    } catch (e) { return null; }
  }

  /* Pause / resume / cancel through the real backend endpoint.
     Prefers window.EnzoMonitor (it calls exactly these URLs and
     keeps the monitor state in sync); falls back to a direct fetch
     to the same URL. The task state is updated from the real
     response only. */
  function controlTask(action) {
    if (!S.taskId) return Promise.reject(new Error('No task is open in the Live Screen.'));
    if (action !== 'pause' && action !== 'resume' && action !== 'cancel') {
      return Promise.reject(new Error('Unknown control action: ' + action));
    }
    var m = getMonitor();
    var work = null;
    if (m) {
      var fn = (action === 'pause') ? m.pauseTask : (action === 'resume') ? m.resumeTask : m.cancelTask;
      if (typeof fn === 'function') {
        try { work = fn.call(m, S.taskId); } catch (e) { work = null; }
      }
    }
    if (!work) work = httpPost(controlUrl(S.taskId, action), {});
    return Promise.resolve(work).then(function (result) {
      var task = null;
      if (lsIsPlainObject(result)) {
        task = result.task || null;
        var state = lsAsNonEmptyString(result.state);
        if (!task && state) task = { state: state };
        if (!task && lsAsNonEmptyString(result.status)) task = { state: result.status };
      }
      if (task) applyTaskData(task);
      S.error = null;
      render();
      return { ok: true, action: action, taskId: S.taskId, result: result };
    }, function (err) {
      S.error = (err && err.message) ? err.message : ('Task ' + action + ' failed.');
      render();
      throw err instanceof Error ? err : new Error(S.error);
    });
  }

  function pauseTask() { return controlTask('pause'); }
  function resumeTask() { return controlTask('resume'); }
  function stopTask() { return controlTask('cancel'); }

  /* ---------- live guidance (delegates to P6; fallback only) ---------- */

  function logGuidanceEntry(text, note) {
    var entry = {
      eventId: 'client-guidance-' + S.timeline.length + '-' + Date.now(),
      taskId: S.taskId,
      agentId: null,
      type: 'guidance',
      label: 'Guidance from you: ' + text,
      detailText: note || '',
      url: null,
      title: null,
      createdAt: lsNowIso(),
      kind: 'client:guidance'
    };
    S.timeline.push(entry);
    while (S.timeline.length > MAX_TIMELINE_ENTRIES) S.timeline.shift();
  }

  /* Send guidance to the running task. Preferred path: the existing
     fullscreen module (window.EnzoMonitorFullscreen.applyGuidance),
     which owns the parser and the modify directives. Fallback path:
     classify locally and call the real pause/resume/cancel/modify
     endpoints. Either way the backend's real answer is shown; a 400
     or 409 is shown as the error it is, never as success. */
  function sendGuidance(text) {
    var raw = lsTrim(lsAsString(text));
    if (!raw) {
      if (els.guideStatus) els.guideStatus.textContent = 'Type an instruction first.';
      return Promise.reject(new Error('empty'));
    }
    if (!S.taskId) {
      if (els.guideStatus) els.guideStatus.textContent = 'No task is open in the Live Screen.';
      return Promise.reject(new Error('no-active-task'));
    }
    var w = lsRoot();
    var fs = (w && w.EnzoMonitorFullscreen) ? w.EnzoMonitorFullscreen : null;
    if (els.guideStatus) els.guideStatus.textContent = 'Sending guidance...';
    var work;
    if (fs && typeof fs.applyGuidance === 'function') {
      try {
        work = Promise.resolve(fs.applyGuidance(raw, S.taskId));
      } catch (e) {
        work = Promise.reject(e);
      }
    } else {
      var parsed = classifyGuidance(raw);
      if (parsed.action === 'pause' || parsed.action === 'resume' || parsed.action === 'cancel') {
        work = controlTask(parsed.action);
      } else {
        work = httpPost(controlUrl(S.taskId, 'modify'), { instruction: raw });
      }
    }
    return Promise.resolve(work).then(function (result) {
      var note = '';
      if (result && result.modified === false && result.clarification_question) {
        note = 'Backend asked: "' + result.clarification_question + '"';
      } else if (result && result.message) {
        note = 'Backend: "' + result.message + '"';
      }
      logGuidanceEntry(raw, note);
      if (els.guideStatus) {
        els.guideStatus.textContent = note || 'Guidance sent to the running task.';
      }
      render();
      return { ok: true, result: result };
    }, function (err) {
      var msg = (err && err.message) ? err.message : 'Guidance failed.';
      if (els.guideStatus) els.guideStatus.textContent = 'Guidance failed: ' + msg;
      render();
      throw err instanceof Error ? err : new Error(msg);
    });
  }

  /* Voice guidance via the browser Web Speech API (transcription
     only — no speaker verification; that belongs to the voice piece).
     When the API is absent the mic is disabled with an honest note. */
  function startMic() {
    var w = lsRoot();
    var SR = (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null;
    if (!SR) {
      if (els.guideStatus) {
        els.guideStatus.textContent = 'Voice input is not available in this browser.';
      }
      return false;
    }
    try {
      var rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) {
        try {
          var res = e && e.results && e.results[0] && e.results[0][0];
          var transcript = res ? lsTrim(lsAsString(res.transcript)) : '';
          if (transcript && els.guideInput) {
            els.guideInput.value = transcript;
            sendGuidance(transcript);
          }
        } catch (err) { /* transcription errors surface via onerror */ }
      };
      rec.onerror = function (e) {
        if (els.guideStatus) {
          els.guideStatus.textContent = 'Voice input failed: ' +
            ((e && e.error) ? e.error : 'unknown error');
        }
      };
      rec.start();
      if (els.guideStatus) els.guideStatus.textContent = 'Listening...';
      return true;
    } catch (e) {
      if (els.guideStatus) {
        els.guideStatus.textContent = 'Voice input could not start: ' + e.message;
      }
      return false;
    }
  }

  function syncMicAvailability() {
    if (!els.micBtn) return;
    var w = lsRoot();
    var SR = (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null;
    els.micBtn.disabled = !SR;
    if (!SR) els.micBtn.setAttribute('title', 'Voice input is not available in this browser.');
  }

  /* ---------- open / close ---------- */

  function onKeyDown(e) {
    if (!e) return;
    if ((e.key === 'Escape' || e.key === 'Esc') && S.open) {
      if (e.preventDefault) e.preventDefault();
      closeLiveScreen();
    }
  }

  function openLiveScreen(taskId, opts) {
    var id = lsAsNonEmptyString(taskId);
    if (!id) return { ok: false, error: 'taskId is required.' };
    var doc = lsDoc();
    if (!doc) return { ok: false, error: 'No document is available.' };
    if (!rootEl) rootEl = buildDom();
    if (!rootEl) return { ok: false, error: 'The Live Screen could not be built.' };
    var chatId = null;
    if (opts && lsAsNonEmptyString(opts.chatId)) chatId = opts.chatId;
    if (!chatId) {
      try {
        var m = getMonitor();
        if (m && typeof m.getState === 'function') {
          var st = m.getState();
          if (st && st.chatId) chatId = st.chatId;
        }
      } catch (e) { /* chat stays unknown; events polling is skipped */ }
    }
    /* v59 (Piece 32 [9]): resolve the chat id through the registry first; an unresolvable (local-only) chat id means events polling stays off. */
    if (chatId && window.EnzoPollingFix) { chatId = window.EnzoPollingFix.resolveBackendId(chatId); }
    resetState(id, chatId, opts || {});
    if (!chatId) S.eventsOff59 = true;
    if (!keyListenerAttached && doc.addEventListener) {
      doc.addEventListener('keydown', onKeyDown);
      keyListenerAttached = true;
    }
    lastFocused = doc.activeElement || null;
    if (doc.body && doc.body.classList) doc.body.classList.add(BODY_CLASS);
    rootEl.hidden = false;
    S.open = true;
    syncMicAvailability();
    render();
    if (els.closeBtn && els.closeBtn.focus) {
      try { els.closeBtn.focus(); } catch (e) { /* focus is best-effort */ }
    }
    pollOnce().then(function () { schedulePoll(); }, function () { schedulePoll(); });
    return { ok: true, taskId: id, chatId: chatId };
  }

  /* Close returns to the normal layout and reports the accurate
     outcome from the last real task fetch — never a guessed state. */
  function closeLiveScreen() {
    if (!S.open && !rootEl) return null;
    stopPollTimer();
    S.open = false;
    var doc = lsDoc();
    if (doc && doc.body && doc.body.classList) doc.body.classList.remove(BODY_CLASS);
    if (rootEl) rootEl.hidden = true;
    var snapshot = getState();
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) { /* focus is best-effort */ }
    }
    lastFocused = null;
    if (S.onClose) {
      try { S.onClose(snapshot); } catch (e) { /* callback must not break close */ }
    }
    return snapshot;
  }

  function isOpen() {
    return !!S.open;
  }

  function getState() {
    return {
      open: !!S.open,
      taskId: S.taskId,
      chatId: S.chatId,
      lifecycle: S.lifecycle,
      taskState: S.taskState,
      taskError: S.taskError,
      paused: !!S.paused,
      partial: !!S.partial,
      outcome: S.outcome ? lsClone(S.outcome) : null,
      timelineLength: S.timeline.length,
      historyLength: S.history.length,
      currentOperation: S.currentOperation,
      progressDone: S.progressDone,
      progressTotal: S.progressTotal,
      sourcesNote: S.sourcesNote,
      error: S.error,
      connected: !!S.connected,
      currentPage: S.currentPage ? lsClone(S.currentPage) : null,
      envLabel: ENV_LABEL
    };
  }

  function getTimeline() {
    return lsClone(S.timeline);
  }

  function getHistory() {
    return lsClone(S.history);
  }

  function destroy() {
    stopPollTimer();
    var doc = lsDoc();
    if (doc && keyListenerAttached && doc.removeEventListener) {
      doc.removeEventListener('keydown', onKeyDown);
      keyListenerAttached = false;
    }
    if (rootEl && rootEl.parentNode && rootEl.parentNode.removeChild) {
      rootEl.parentNode.removeChild(rootEl);
    }
    rootEl = null;
    els = {};
    styleEl = null;
    S.open = false;
  }

  /* ---------- export tail (guarded; same pattern as piece 21) ---------- */
  var EnzoLiveScreen = {
    VERSION: VERSION,
    LIFECYCLE_STATES: LIFECYCLE_STATES,
    ENV_LABEL: ENV_LABEL,
    ENV_NOTE: ENV_NOTE,
    mapTaskState: mapTaskState,
    isTerminalLifecycle: isTerminalLifecycle,
    lifecycleFromEventType: lifecycleFromEventType,
    normalizeEvent: normalizeEvent,
    appendEvents: appendEvents,
    summarizeText: summarizeText,
    buildPageSummary: buildPageSummary,
    classifyGuidance: classifyGuidance,
    eventsUrl: eventsUrl,
    taskUrl: taskUrl,
    progressUrl: progressUrl,
    sourcesUrl: sourcesUrl,
    controlUrl: controlUrl,
    fetchPageUrl: fetchPageUrl,
    openLiveScreen: openLiveScreen,
    closeLiveScreen: closeLiveScreen,
    isOpen: isOpen,
    getState: getState,
    getTimeline: getTimeline,
    getHistory: getHistory,
    pollOnce: pollOnce,
    renderPage: renderPage,
    pauseTask: pauseTask,
    resumeTask: resumeTask,
    stopTask: stopTask,
    controlTask: controlTask,
    sendGuidance: sendGuidance,
    startMic: startMic,
    destroy: destroy
  };

  if (typeof root !== 'undefined') root.EnzoLiveScreen = EnzoLiveScreen;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnzoLiveScreen;
  }

})(typeof window !== 'undefined' ? window : this);
