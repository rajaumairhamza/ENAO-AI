
/* ==========================================================================
   ENAO AI — Piece M2: Live Research Monitor PANEL UI (02-monitor-ui.js)
   Purely additive UI. It only ADDS nodes/styles; it never edits existing
   markup, CSS or JS in the export (enao-ai.html).

   Anchors in the export (v52-face-avatar, verified by grep — see
   02-monitor-ui.EVIDENCE.md):
     - #typingRow (L1803): the generating-status row — three animated dots
       (.typing) + #typingLabel (Thinking…/Searching…/Writing…). The
       "View Live Research" button is inserted right after it.
     - #toolsModal / #toolsGrid (L1997/L2001) + renderTools()/openTools()
       (L5479/L5518): a "View Live Research" entry is added to the Tools
       menu grid whenever the Tools modal is opened.
     - askQuestion() (L4224) / setGenerating() (L4151) / showTyping() /
       setTypingStatus() (L4960-L4971): the research flow entry points.
       This UI does NOT hook into them directly — it learns about research
       only through the M1 data layer below, so the ask flow is untouched.
     - Design variables: :root dark navy (L1099-L1119) — --bg #050B1D,
       --surface #0B1530, --surface2 #101B3A, --accent #3B82F6,
       --accent-dark #00D9FF, purple #8B5CF6 (used as a literal, the
       export has no --purple variable).
     - Drawer pattern: .modal/.modal-card (L231), #drawerBackdrop (L1890),
       .drawer-close, and the mobile .enzo-panel.open slide-over
       (max-width:820px). This panel follows the same conventions.

   Data layer (piece M1) — code against this contract verbatim:
     window.EnzoMonitor = { subscribe, unsubscribe, getState, listTasks,
       openTask, getTask, pauseTask, resumeTask, cancelTask, getSources,
       getSummary, setChatId, getChatId, start, stop, isConnected }
   If window.EnzoMonitor is absent, the UI renders a graceful empty state
   ("Research monitor is starting…") and retries mounting — never crashes,
   never renders fake data.

   Honesty rules (locked):
     - Progress is REAL completed/total step COUNTS from the backend only.
       If the total is unknown, counts are shown ("7 steps done") and
       never a % bar.
     - No invented sources, counts or percentages. No activity rows, no
       findings and no report are rendered unless the backend supplied them.
     - Every source link uses final_url and opens in a new tab.
     - verified === null means NO badge (never "Verified"). Unverified /
       conflicting / missing info is labelled as such.
     - Zero emojis anywhere; icons are inline SVG only.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Small DOM helpers (plain createElement/textContent only, so the    */
  /* UI works in the real page and in the minimal-DOM test harness).    */
  /* ------------------------------------------------------------------ */
  function $(id) {
    return (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById(id) : null;
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function svgIcon(name) {
    /* Inline SVG only — no emojis. Paths are small and self-contained so
       they do not depend on the export's <symbol> sprite. */
    var paths = {
      search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
      play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
      doc: '<path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="2"/>',
      link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 18.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      chev: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    return '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
      (paths[name] || paths.search) + '</svg>';
  }

  function iconSpan(name) {
    var s = el('span', 'enzo-monitor-ic');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = svgIcon(name);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Formatting — real values only; unknown values render as "—".      */
  /* ------------------------------------------------------------------ */
  function formatTime(ts) {
    if (ts === undefined || ts === null || ts === '') return '—';
    var d = new Date(typeof ts === 'number' ? ts : String(ts));
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return d.toISOString(); }
  }

  function formatDateTime(ts) {
    if (ts === undefined || ts === null || ts === '') return '—';
    var d = new Date(typeof ts === 'number' ? ts : String(ts));
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return d.toISOString(); }
  }

  function formatDuration(ms) {
    if (ms === undefined || ms === null || isNaN(Number(ms))) return '—';
    var s = Math.round(Number(ms) / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + (s % 60) + 's';
  }

  function esc(str) { return String(str === undefined || str === null ? '' : str); }

  /* ------------------------------------------------------------------ */
  /* Status / verification labels — from the Activity object only.     */
  /* ------------------------------------------------------------------ */
  var STATUS_LABELS = {
    completed: 'Completed', running: 'Running', pending: 'Pending',
    failed: 'Failed', retrying: 'Retrying'
  };
  var VERIFIED_LABELS = {
    verified: 'Verified', unverified: 'Unverified',
    conflicting: 'Conflicting', missing: 'Missing info'
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || (status ? String(status) : 'Pending');
  }

  function verificationBadge(verified) {
    if (!verified || !VERIFIED_LABELS[verified]) return null;
    var b = el('span', 'enzo-monitor-vbadge', VERIFIED_LABELS[verified]);
    b.setAttribute('data-v', verified);
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Module state.                                                       */
  /* ------------------------------------------------------------------ */
  var mounted = false;
  var isOpenFlag = false;
  var view = 'timeline'; /* 'timeline' | 'sources' | 'report' */
  var activeTaskId = null; /* explicit selection via setActiveTask/open(id) */
  var expanded = {}; /* activity id -> true */
  var expandAllFlag = false;
  var subscribed = false;
  var unsubscribeFn = null;
  var lastState = null;
  var lastFocused = null;
  var retryTimer = null;
  var retryCount = 0;
  var MAX_RETRIES = 12; /* ~18s of retries while the data layer loads */
  var els = {}; /* references to created nodes */

  function getMonitor() {
    try {
      var w = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
      return (w && w.EnzoMonitor) ? w.EnzoMonitor : null;
    } catch (e) { return null; }
  }

  function safeGetState() {
    var m = getMonitor();
    if (!m || typeof m.getState !== 'function') return null;
    try { return m.getState() || null; } catch (e) { return null; }
  }

  function safeCall(fnName, arg) {
    var m = getMonitor();
    if (!m || typeof m[fnName] !== 'function') return null;
    try { return m[fnName](arg); } catch (e) { return null; }
  }

  /* Tasks: prefer listTasks() when present, else state.tasks. */
  function allTasks(state) {
    var list = safeCall('listTasks');
    if (list && list.length !== undefined) return list;
    if (state && state.tasks) {
      var out = [];
      var keys = Object.keys(state.tasks);
      for (var i = 0; i < keys.length; i++) {
        var entry = state.tasks[keys[i]];
        if (entry && entry.task) out.push(entry.task);
        else if (entry) out.push(entry);
      }
      return out;
    }
    return [];
  }

  function taskEntry(state, taskId) {
    if (!state || !state.tasks) return null;
    return state.tasks[taskId] || null;
  }

  function currentTask(state) {
    var tasks = allTasks(state);
    if (!tasks.length) return null;
    if (activeTaskId) {
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].task_id === activeTaskId) return tasks[i];
      }
    }
    if (state && state.activeTaskId) {
      for (var j = 0; j < tasks.length; j++) {
        if (tasks[j].task_id === state.activeTaskId) return tasks[j];
      }
    }
    /* Fall back to the newest running/paused task, else the newest task. */
    var sorted = tasks.slice().sort(function (a, b) {
      return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1;
    });
    for (var k = 0; k < sorted.length; k++) {
      if (sorted[k].state === 'running' || sorted[k].state === 'paused') return sorted[k];
    }
    return sorted[0];
  }

  function isTaskActive(task) {
    return !!task && (task.state === 'running' || task.state === 'paused');
  }

  function activitiesOf(state, task) {
    if (!task) return [];
    var entry = taskEntry(state, task.task_id);
    if (entry && entry.activities) return entry.activities;
    if (task.activities) return task.activities;
    return [];
  }

  function sourcesOf(state, task) {
    if (!task) return [];
    var fromLayer = safeCall('getSources', task.task_id);
    if (fromLayer && fromLayer.length !== undefined) return fromLayer;
    var entry = taskEntry(state, task.task_id);
    if (entry && entry.sources) return entry.sources;
    if (task.sources) return task.sources;
    return [];
  }

  function summaryOf(state, task) {
    if (!task) return null;
    var fromLayer = safeCall('getSummary', task.task_id);
    if (fromLayer !== null && fromLayer !== undefined) return fromLayer;
    var entry = taskEntry(state, task.task_id);
    if (entry && entry.summary !== undefined && entry.summary !== null) return entry.summary;
    if (task.summary !== undefined && task.summary !== null) return task.summary;
    return null;
  }

  function currentActivity(activities) {
    for (var i = 0; i < activities.length; i++) {
      if (activities[i].status === 'running') return activities[i];
    }
    for (var j = activities.length - 1; j >= 0; j--) {
      if (activities[j].status === 'completed') return activities[j];
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Build the trigger button (anchored next to #typingRow).            */
  /* ------------------------------------------------------------------ */
  function buildButton() {
    if ($('enzoMonitorBtn')) { els.button = $('enzoMonitorBtn'); return els.button; }
    var b = el('button', 'enzo-monitor-btn', null);
    b.id = 'enzoMonitorBtn';
    b.type = 'button';
    b.setAttribute('aria-label', 'View Live Research');
    b.setAttribute('title', 'View Live Research — watch this research as it happens');
    b.hidden = true;
    var dot = el('span', 'enzo-monitor-btn-dot');
    dot.setAttribute('aria-hidden', 'true');
    b.appendChild(dot);
    b.appendChild(iconSpan('search'));
    b.appendChild(el('span', null, 'View Live Research'));
    b.addEventListener('click', function () { if (window.EnzoMonitorFullscreen) window.EnzoMonitorFullscreen.open(); else open(); });
    /* Anchor: directly after #typingRow inside #chatView, so it sits next
       to the generating-status row (three dots + status word). Fallbacks
       never restructure the composer: #chatView, then #scrollArea, then body. */
    var typingRow = $('typingRow');
    if (typingRow && typingRow.parentNode) {
      if (typingRow.nextSibling) typingRow.parentNode.insertBefore(b, typingRow.nextSibling);
      else typingRow.parentNode.appendChild(b);
    } else if ($('chatView')) {
      $('chatView').appendChild(b);
    } else if ($('scrollArea')) {
      $('scrollArea').appendChild(b);
    } else if (document.body) {
      document.body.appendChild(b);
    }
    els.button = b;
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Tools-menu entry: added to #toolsGrid when the Tools modal opens.  */
  /* renderTools() rebuilds the grid on every openTools(), so the entry */
  /* is (re-)inserted each time a Tools button is clicked and on every  */
  /* state update while the modal is open. It never edits other cards.  */
  /* ------------------------------------------------------------------ */
  function ensureToolsEntry() {
    var grid = $('toolsGrid');
    if (!grid) return;
    if ($('enzoMonitorToolsEntry')) return;
    var b = el('button', 'toolcard enzo-monitor-tools-entry', null);
    b.id = 'enzoMonitorToolsEntry';
    b.type = 'button';
    var title = el('b', null, 'View Live Research');
    var desc = el('span', null, 'Open the live research monitor — timeline, sources and final report.');
    b.appendChild(title);
    b.appendChild(desc);
    b.addEventListener('click', function () {
      try {
        if (typeof window !== 'undefined' && typeof window.closeModal === 'function') {
          window.closeModal('toolsModal');
        } else {
          var modal = $('toolsModal');
          if (modal) modal.classList.remove('open');
        }
      } catch (e) { /* modal close is best-effort */ }
      if (window.EnzoMonitorFullscreen) window.EnzoMonitorFullscreen.open(); else open();
    });
    grid.appendChild(b);
  }

  function wireToolsButtons() {
    var ids = ['toolsBtn', 'toolsBtnSide', 'moreToolsBtn', 'amTools'];
    for (var i = 0; i < ids.length; i++) {
      var btn = $(ids[i]);
      if (!btn || btn.getAttribute('data-enzo-monitor-wired')) continue;
      btn.setAttribute('data-enzo-monitor-wired', '1');
      btn.addEventListener('click', function () {
        /* renderTools() runs synchronously inside openTools(); re-insert
           the entry just after it has rebuilt the grid. */
        setTimeout(ensureToolsEntry, 50);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Build the monitor panel (appended to <body> only). v55: no backdrop — the full-screen live view replaces the slide-over. */
  /* ------------------------------------------------------------------ */
  function buildPanel() {
    if ($('enzoMonitorPanel')) {
      els.panel = $('enzoMonitorPanel');
      return;
    }

    var panel = el('aside', null, null);
    panel.id = 'enzoMonitorPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Live Research Monitor');
    panel.setAttribute('aria-modal', 'false');
    panel.hidden = true;

    var head = el('div', 'enzo-monitor-head');
    var headText = el('div', null, null);
    headText.appendChild(el('h2', null, 'Live Research'));
    headText.appendChild(el('p', null, 'Watch this research as it happens — every step, source and finding.'));
    var closeBtn = el('button', 'enzo-monitor-close', '×');
    closeBtn.type = 'button';
    closeBtn.id = 'enzoMonitorClose';
    closeBtn.setAttribute('aria-label', 'Close research monitor');
    closeBtn.setAttribute('title', 'Close');
    closeBtn.addEventListener('click', function () { close(); });
    head.appendChild(headText);
    head.appendChild(closeBtn);
    panel.appendChild(head);
    els.closeBtn = closeBtn;

    var body = el('div', 'enzo-monitor-body');
    body.id = 'enzoMonitorBody';

    els.banner = el('div', 'enzo-monitor-banner', 'Live updates paused — showing stored history.');
    els.banner.hidden = true;
    body.appendChild(els.banner);

    els.starting = el('div', 'enzo-monitor-empty', 'Research monitor is starting…');
    els.starting.id = 'enzoMonitorStarting';
    body.appendChild(els.starting);

    els.empty = el('div', 'enzo-monitor-empty', 'No research running yet — ask a research question and watch it here.');
    els.empty.id = 'enzoMonitorEmpty';
    els.empty.hidden = true;
    body.appendChild(els.empty);

    els.errorBox = el('div', 'enzo-monitor-error', null);
    els.errorBox.id = 'enzoMonitorError';
    els.errorBox.hidden = true;
    body.appendChild(els.errorBox);

    /* Dashboard */
    els.objective = el('h3', 'enzo-monitor-objective', null);
    body.appendChild(els.objective);
    els.current = el('p', 'enzo-monitor-current', null);
    body.appendChild(els.current);

    els.counts = el('div', 'enzo-monitor-counts');
    els.countSteps = el('div', 'enzo-monitor-count');
    els.countSteps.appendChild(el('b', null, '—'));
    els.countSteps.appendChild(el('span', null, 'steps done'));
    els.countSources = el('div', 'enzo-monitor-count');
    els.countSources.appendChild(el('b', null, '—'));
    els.countSources.appendChild(el('span', null, 'sources found'));
    els.counts.appendChild(els.countSteps);
    els.counts.appendChild(els.countSources);
    body.appendChild(els.counts);

    els.findingsSec = el('div', null, null);
    els.findingsSec.appendChild(el('div', 'enzo-monitor-sec', 'Important findings'));
    els.findingsList = el('ul', 'enzo-monitor-findings');
    els.findingsSec.appendChild(els.findingsList);
    els.findingsNone = el('p', 'enzo-monitor-meta', 'No findings yet.');
    els.findingsSec.appendChild(els.findingsNone);
    body.appendChild(els.findingsSec);

    els.lastActivity = el('p', 'enzo-monitor-meta', null);
    body.appendChild(els.lastActivity);

    /* History */
    els.historySec = el('div', null, null);
    els.historySec.appendChild(el('div', 'enzo-monitor-sec', 'Research history'));
    els.historyList = el('div', 'enzo-monitor-history');
    els.historySec.appendChild(els.historyList);
    body.appendChild(els.historySec);

    /* Controls */
    var controls = el('div', 'enzo-monitor-controls');
    els.pauseBtn = el('button', null, 'Pause');
    els.pauseBtn.type = 'button'; els.pauseBtn.id = 'enzoMonitorPause';
    els.pauseBtn.addEventListener('click', function () {
      var t = currentTask(lastState);
      if (t) safeCall('pauseTask', t.task_id);
    });
    els.resumeBtn = el('button', null, 'Resume');
    els.resumeBtn.type = 'button'; els.resumeBtn.id = 'enzoMonitorResume';
    els.resumeBtn.addEventListener('click', function () {
      var t = currentTask(lastState);
      if (t) safeCall('resumeTask', t.task_id);
    });
    els.stopBtn = el('button', 'enzo-monitor-danger', 'Stop');
    els.stopBtn.type = 'button'; els.stopBtn.id = 'enzoMonitorStop';
    els.stopBtn.addEventListener('click', function () { showStopConfirm(true); });
    els.expandBtn = el('button', null, 'Expand All');
    els.expandBtn.type = 'button'; els.expandBtn.id = 'enzoMonitorExpandAll';
    els.expandBtn.addEventListener('click', function () {
      expandAllFlag = true;
      var acts = activitiesOf(lastState, currentTask(lastState));
      for (var i = 0; i < acts.length; i++) expanded[acts[i].id] = true;
      render();
    });
    els.collapseBtn = el('button', null, 'Collapse All');
    els.collapseBtn.type = 'button'; els.collapseBtn.id = 'enzoMonitorCollapseAll';
    els.collapseBtn.addEventListener('click', function () {
      expandAllFlag = false;
      expanded = {};
      render();
    });
    els.sourcesBtn = el('button', null, 'View Sources');
    els.sourcesBtn.type = 'button'; els.sourcesBtn.id = 'enzoMonitorViewSources';
    els.sourcesBtn.addEventListener('click', function () { view = 'sources'; render(); });
    els.reportBtn = el('button', null, 'View Final Report');
    els.reportBtn.type = 'button'; els.reportBtn.id = 'enzoMonitorViewReport';
    els.reportBtn.addEventListener('click', function () { view = 'report'; render(); });
    controls.appendChild(els.pauseBtn);
    controls.appendChild(els.resumeBtn);
    controls.appendChild(els.stopBtn);
    controls.appendChild(els.expandBtn);
    controls.appendChild(els.collapseBtn);
    controls.appendChild(els.sourcesBtn);
    controls.appendChild(els.reportBtn);
    body.appendChild(controls);
    els.controls = controls;

    /* Inline stop confirm */
    els.stopConfirm = el('div', 'enzo-monitor-confirm', null);
    els.stopConfirm.id = 'enzoMonitorStopConfirm';
    els.stopConfirm.hidden = true;
    els.stopConfirm.appendChild(el('span', null, 'Stop this research?'));
    var yes = el('button', 'enzo-monitor-confirm-yes', 'Yes, stop it');
    yes.type = 'button';
    yes.addEventListener('click', function () {
      var t = currentTask(lastState);
      showStopConfirm(false);
      if (t) safeCall('cancelTask', t.task_id);
    });
    var no = el('button', null, 'Keep going');
    no.type = 'button';
    no.addEventListener('click', function () { showStopConfirm(false); });
    els.stopConfirm.appendChild(yes);
    els.stopConfirm.appendChild(no);
    body.appendChild(els.stopConfirm);

    /* Views */
    els.timelineView = el('div', null, null);
    els.timelineView.id = 'enzoMonitorTimelineView';
    els.timelineView.appendChild(el('div', 'enzo-monitor-sec', 'Live timeline'));
    els.timelineList = el('ul', 'enzo-monitor-timeline');
    els.timelineList.id = 'enzoMonitorTimeline';
    els.timelineView.appendChild(els.timelineList);
    els.timelineNone = el('p', 'enzo-monitor-meta', 'No activities yet for this research.');
    els.timelineView.appendChild(els.timelineNone);
    body.appendChild(els.timelineView);

    els.sourcesView = el('div', null, null);
    els.sourcesView.id = 'enzoMonitorSourcesView';
    els.sourcesView.hidden = true;
    var srcNav = el('div', 'enzo-monitor-viewnav');
    var backFromSources = el('button', null, 'Back to timeline');
    backFromSources.type = 'button';
    backFromSources.addEventListener('click', function () { view = 'timeline'; render(); });
    srcNav.appendChild(backFromSources);
    els.sourcesView.appendChild(srcNav);
    els.sourcesView.appendChild(el('div', 'enzo-monitor-sec', 'Sources'));
    els.sourcesList = el('ul', 'enzo-monitor-src');
    els.sourcesList.id = 'enzoMonitorSources';
    els.sourcesView.appendChild(els.sourcesList);
    els.sourcesNone = el('p', 'enzo-monitor-meta', 'No sources discovered yet.');
    els.sourcesView.appendChild(els.sourcesNone);
    body.appendChild(els.sourcesView);

    els.reportView = el('div', 'enzo-monitor-report', null);
    els.reportView.id = 'enzoMonitorReportView';
    els.reportView.hidden = true;
    var repNav = el('div', 'enzo-monitor-viewnav');
    var backFromReport = el('button', null, 'Back to timeline');
    backFromReport.type = 'button';
    backFromReport.addEventListener('click', function () { view = 'timeline'; render(); });
    repNav.appendChild(backFromReport);
    els.reportView.appendChild(repNav);
    els.reportBody = el('div', null, null);
    els.reportBody.id = 'enzoMonitorReport';
    els.reportView.appendChild(els.reportBody);
    body.appendChild(els.reportView);

    panel.appendChild(body);
    els.body = body;
    els.panel = panel;
    document.body.appendChild(panel);
  }

  function showStopConfirm(show) {
    if (els.stopConfirm) els.stopConfirm.hidden = !show;
  }

  /* ------------------------------------------------------------------ */
  /* Render — driven only by EnzoMonitor state (subscribe callback).   */
  /* No polling, no fake data: every number/label comes from the state. */
  /* ------------------------------------------------------------------ */
  function render() {
    if (!mounted || !els.panel) return;
    var state = lastState;
    var monitor = getMonitor();

    /* Data layer absent: graceful starting state, keep retrying mount. */
    if (!monitor || !state) {
      if (els.starting) els.starting.hidden = false;
      if (els.empty) els.empty.hidden = true;
      if (els.banner) els.banner.hidden = true;
      if (els.errorBox) els.errorBox.hidden = true;
      updateButton(null);
      return;
    }
    if (els.starting) els.starting.hidden = true;

    /* Backend unreachable: keep showing stored history, say so plainly. */
    if (els.banner) els.banner.hidden = state.backendAvailable !== false;

    var task = currentTask(state);
    var tasks = allTasks(state);

    if (!task) {
      if (els.empty) els.empty.hidden = false;
      if (els.objective) els.objective.textContent = '';
      if (els.current) els.current.textContent = '';
      if (els.counts) els.counts.hidden = false;
      setCount(els.countSteps, '0 steps done');
      setCount(els.countSources, '0 sources found');
      if (els.findingsList) clear(els.findingsList);
      if (els.findingsNone) els.findingsNone.hidden = false;
      if (els.lastActivity) els.lastActivity.textContent = '';
      if (els.errorBox) els.errorBox.hidden = true;
      renderHistory(tasks, null);
      renderTimeline([]);
      renderSources([]);
      renderReport(null, null);
      updateButton(null);
      syncControls(null);
      return;
    }
    if (els.empty) els.empty.hidden = true;

    var activities = activitiesOf(state, task);
    var sources = sourcesOf(state, task);
    var summary = summaryOf(state, task);

    /* Dashboard header */
    if (els.objective) els.objective.textContent = esc(task.title || 'Research');
    var cur = currentActivity(activities);
    if (els.current) {
      clear(els.current);
      els.current.appendChild(el('span', null, 'Current activity: '));
      els.current.appendChild(el('b', null, cur ? esc(cur.title || cur.kind || 'Working') : 'Idle'));
      if (cur && cur.status === 'running') {
        els.current.appendChild(el('span', null, ' — running now'));
      }
    }

    /* Step COUNTS only — never a % bar. Total unknown = activities
       length is all we know, so "N steps done" + "M remaining" counts. */
    var done = 0;
    for (var i = 0; i < activities.length; i++) {
      if (activities[i].status === 'completed') done++;
    }
    var remaining = activities.length - done;
    setCount(els.countSteps, done + ' steps done' + (activities.length ? ' · ' + remaining + ' remaining' : ''));
    /* Sources discovered vs analysed: both real array lengths. Analysed
       = sources that were actually fetched (fetched_at present). */
    var analysed = 0;
    for (var j = 0; j < sources.length; j++) {
      if (sources[j].fetched_at) analysed++;
    }
    setCount(els.countSources, sources.length + ' sources found · ' + analysed + ' analysed');

    /* Important findings: activity findings + summary findings. */
    var findings = [];
    for (var k = 0; k < activities.length; k++) {
      var f = activities[k].findings || [];
      for (var m = 0; m < f.length; m++) {
        if (f[m] !== undefined && f[m] !== null && String(f[m]) !== '') findings.push(String(f[m]));
      }
    }
    if (summary && summary.findings) {
      for (var n = 0; n < summary.findings.length; n++) {
        if (findings.indexOf(String(summary.findings[n])) === -1) findings.push(String(summary.findings[n]));
      }
    }
    if (els.findingsList) {
      clear(els.findingsList);
      for (var p = 0; p < findings.length; p++) {
        els.findingsList.appendChild(el('li', null, findings[p]));
      }
    }
    if (els.findingsNone) els.findingsNone.hidden = findings.length > 0;

    /* Last activity timestamp — real value only. */
    var entry = taskEntry(state, task.task_id);
    var lastAt = (entry && entry.lastActivityAt) || task.finished_at || task.started_at || null;
    if (!lastAt && activities.length) {
      var lastAct = activities[activities.length - 1];
      lastAt = lastAct.finishedAt || lastAct.startedAt || null;
    }
    if (els.lastActivity) {
      els.lastActivity.textContent = lastAt
        ? 'Last activity: ' + formatDateTime(lastAt)
        : 'Last activity: —';
    }

    /* Task failed: show the real error string. */
    if (els.errorBox) {
      if (task.state === 'failed' && task.error) {
        clear(els.errorBox);
        els.errorBox.appendChild(el('b', null, 'Research failed: '));
        els.errorBox.appendChild(el('span', null, String(task.error)));
        els.errorBox.hidden = false;
      } else {
        els.errorBox.hidden = true;
      }
    }

    renderHistory(tasks, task);
    renderTimeline(activities);
    renderSources(sources);
    renderReport(summary, task);
    updateButton(task);
    syncControls(task);
    ensureToolsEntry();
  }

  function setCount(countEl, label) {
    if (!countEl) return;
    var b = null;
    /* count element holds <b> then <span>; update both from the label. */
    for (var i = 0; i < countEl.childNodes.length; i++) {
      if (countEl.childNodes[i].tagName === 'B') b = countEl.childNodes[i];
    }
    if (b) b.textContent = label;
  }

  function renderHistory(tasks, activeTask) {
    if (!els.historyList) return;
    clear(els.historyList);
    if (!tasks.length) {
      if (els.historySec) els.historySec.hidden = true;
      return;
    }
    if (els.historySec) els.historySec.hidden = false;
    var sorted = tasks.slice().sort(function (a, b) {
      return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1;
    });
    for (var i = 0; i < sorted.length; i++) {
      (function (t) {
        var btn = el('button', null, null);
        btn.type = 'button';
        btn.setAttribute('data-task-id', t.task_id);
        if (activeTask && t.task_id === activeTask.task_id) btn.setAttribute('aria-current', 'true');
        btn.appendChild(el('span', null, esc(t.title || t.task_id || 'Research')));
        btn.appendChild(el('small', null, statusLabel(t.state)));
        btn.addEventListener('click', function () { setActiveTask(t.task_id); });
        els.historyList.appendChild(btn);
      })(sorted[i]);
    }
  }

  function renderTimeline(activities) {
    if (!els.timelineList) return;
    clear(els.timelineList);
    if (els.timelineNone) els.timelineNone.hidden = activities.length > 0;
    for (var i = 0; i < activities.length; i++) {
      els.timelineList.appendChild(buildActivityRow(activities[i]));
    }
    syncViews();
  }

  function buildActivityRow(a) {
    var li = el('li', 'enzo-monitor-row');
    li.setAttribute('data-activity-id', a.id || '');
    li.setAttribute('data-status', a.status || 'pending');
    var isOpen = !!expanded[a.id] || expandAllFlag;
    var isRunning = a.status === 'running';

    var head = el('button', 'enzo-monitor-row-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    head.addEventListener('click', function () {
      if (expanded[a.id]) delete expanded[a.id];
      else expanded[a.id] = true;
      expandAllFlag = false;
      render();
    });
    head.appendChild(el('span', 'enzo-monitor-row-time', formatTime(a.startedAt || a.finishedAt)));
    if (isRunning) {
      var pulse = el('span', 'enzo-monitor-pulse-dot');
      pulse.setAttribute('aria-hidden', 'true');
      head.appendChild(pulse);
    }
    head.appendChild(el('span', 'enzo-monitor-row-title', esc(a.title || a.kind || 'Step')));
    var badge = verificationBadge(a.verified);
    if (badge) head.appendChild(badge);
    var pill = el('span', 'enzo-monitor-pill', statusLabel(a.status));
    pill.setAttribute('data-status', a.status || 'pending');
    head.appendChild(pill);
    li.appendChild(head);

    var detail = el('div', 'enzo-monitor-row-detail');
    detail.hidden = !isOpen;
    var dl = el('dl', null, null);
    addDetail(dl, 'What was done', a.detail || a.title || '—');
    addDetail(dl, 'Why', a.why || '—');
    /* Source / website used — clickable final_url, new tab. */
    var dtSrc = el('dt', null, 'Source / website used');
    var ddSrc = el('dd', null, null);
    if (a.sourceUrl) {
      var link = el('a', 'enzo-monitor-src-link', esc(a.sourceTitle || a.sourceUrl));
      link.setAttribute('href', a.sourceUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      ddSrc.appendChild(link);
    } else {
      ddSrc.appendChild(el('span', null, 'No source for this step.'));
    }
    dl.appendChild(dtSrc);
    dl.appendChild(ddSrc);
    /* What was discovered */
    var dtFound = el('dt', null, 'What was discovered');
    var ddFound = el('dd', null, null);
    var findings = a.findings || [];
    if (findings.length) {
      var ul = el('ul', null, null);
      for (var i = 0; i < findings.length; i++) ul.appendChild(el('li', null, String(findings[i])));
      ddFound.appendChild(ul);
    } else {
      ddFound.appendChild(el('span', null, 'Nothing recorded for this step.'));
    }
    dl.appendChild(dtFound);
    dl.appendChild(ddFound);
    /* Important findings are the same list; keep one labelled place. */
    addDetail(dl, 'Time taken', formatDuration(a.durationMs));
    if (a.error) addDetail(dl, 'Errors / limitations', String(a.error));
    else addDetail(dl, 'Errors / limitations', 'None reported.');
    detail.appendChild(dl);
    li.appendChild(detail);
    return li;
  }

  function addDetail(dl, label, value) {
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, esc(value)));
  }

  function renderSources(sources) {
    if (!els.sourcesList) return;
    clear(els.sourcesList);
    if (els.sourcesNone) els.sourcesNone.hidden = sources.length > 0;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var li = el('li', null, null);
      li.setAttribute('data-source-id', s.source_id || '');
      var url = s.final_url || s.url || '';
      var title = el('h4', null, null);
      if (url) {
        var link = el('a', 'enzo-monitor-src-link', esc(s.title || s.outlet || url));
        link.setAttribute('href', url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        title.appendChild(link);
      } else {
        title.appendChild(el('span', null, esc(s.title || s.outlet || 'Source')));
      }
      li.appendChild(title);
      if (s.snippet) li.appendChild(el('p', null, esc(s.snippet)));
      var meta = el('div', 'enzo-monitor-src-meta');
      if (s.outlet) meta.appendChild(el('span', null, esc(s.outlet)));
      if (s.pub_date) meta.appendChild(el('span', null, 'Published: ' + formatDateTime(s.pub_date)));
      if (s.fetched_at) meta.appendChild(el('span', null, 'Fetched: ' + formatDateTime(s.fetched_at)));
      if (s.quality) meta.appendChild(el('span', null, 'Quality: ' + esc(s.quality)));
      var vb = verificationBadge(s.verified);
      if (vb) meta.appendChild(vb);
      else if (s.supports_claim === false) meta.appendChild(el('span', null, 'Does not support the claim.'));
      li.appendChild(meta);
      els.sourcesList.appendChild(li);
    }
    syncViews();
  }

  function renderReport(summary, task) {
    if (!els.reportBody) return;
    clear(els.reportBody);
    if (!summary) {
      els.reportBody.appendChild(el('p', null,
        task ? 'Report will appear when research finishes.'
             : 'No research running yet — ask a research question and watch it here.'));
      syncViews();
      return;
    }
    /* Summary shape is free-form from M1; render only fields it supplies. */
    var text = (typeof summary === 'string') ? summary : null;
    if (text) {
      els.reportBody.appendChild(el('p', null, text));
      syncViews();
      return;
    }
    if (summary.objective || (task && task.title)) {
      els.reportBody.appendChild(el('h3', null, 'Objective'));
      els.reportBody.appendChild(el('p', null, esc(summary.objective || task.title || '')));
    }
    if (summary.methodology) {
      els.reportBody.appendChild(el('h3', null, 'Methodology'));
      els.reportBody.appendChild(el('p', null, esc(summary.methodology)));
    }
    addReportList('Sources', summary.sources, function (s) {
      return (typeof s === 'string') ? s : (s.title || s.url || s.final_url || 'Source');
    });
    addReportList('Discoveries', summary.discoveries);
    addReportList('Verified findings', summary.verified_findings || summary.findings);
    addReportList('Limitations', summary.limitations);
    if (summary.conclusions) {
      els.reportBody.appendChild(el('h3', null, 'Conclusions'));
      if (Array.isArray(summary.conclusions)) {
        var ul = el('ul', null, null);
        for (var i = 0; i < summary.conclusions.length; i++) ul.appendChild(el('li', null, String(summary.conclusions[i])));
        els.reportBody.appendChild(ul);
      } else {
        els.reportBody.appendChild(el('p', null, esc(summary.conclusions)));
      }
    }
    if (!els.reportBody.childNodes.length) {
      els.reportBody.appendChild(el('p', null, 'Report will appear when research finishes.'));
    }
    syncViews();
  }

  function addReportList(heading, items, mapFn) {
    if (!items || !items.length) return;
    els.reportBody.appendChild(el('h3', null, heading));
    var ul = el('ul', null, null);
    for (var i = 0; i < items.length; i++) {
      var v = mapFn ? mapFn(items[i]) : String(items[i]);
      ul.appendChild(el('li', null, v));
    }
    els.reportBody.appendChild(ul);
  }

  function syncViews() {
    if (els.timelineView) els.timelineView.hidden = view !== 'timeline';
    if (els.sourcesView) els.sourcesView.hidden = view !== 'sources';
    if (els.reportView) els.reportView.hidden = view !== 'report';
    if (els.controls) {
      /* View buttons reflect the current view; Pause/Resume/Stop stay
         visible in every view so controls are never lost. */
      if (els.sourcesBtn) els.sourcesBtn.setAttribute('aria-pressed', view === 'sources' ? 'true' : 'false');
      if (els.reportBtn) els.reportBtn.setAttribute('aria-pressed', view === 'report' ? 'true' : 'false');
    }
  }

  function syncControls(task) {
    var running = !!task && task.state === 'running';
    var paused = !!task && task.state === 'paused';
    var stoppable = running || paused;
    if (els.pauseBtn) els.pauseBtn.disabled = !running;
    if (els.resumeBtn) els.resumeBtn.disabled = !paused;
    if (els.stopBtn) els.stopBtn.disabled = !stoppable;
    if (els.expandBtn) els.expandBtn.disabled = !task;
    if (els.collapseBtn) els.collapseBtn.disabled = !task;
    if (els.sourcesBtn) els.sourcesBtn.disabled = !task;
    if (els.reportBtn) els.reportBtn.disabled = !task;
  }

  /* Button shows only while a research task is active (running/paused). */
  function updateButton(task) {
    if (!els.button) return;
    var active = isTaskActive(task);
    if (!active && lastState) {
      var tasks = allTasks(lastState);
      for (var i = 0; i < tasks.length; i++) {
        if (isTaskActive(tasks[i])) { active = true; task = tasks[i]; break; }
      }
    }
    els.button.hidden = !active;
    if (active && task) {
      els.button.setAttribute('data-state', task.state || 'running');
      els.button.setAttribute('data-task-id', task.task_id || '');
    } else {
      els.button.removeAttribute('data-state');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Subscribe to the data layer (live updates, no polling of our own). */
  /* ------------------------------------------------------------------ */
  function onStateChange(next) {
    lastState = (next && typeof next === 'object') ? next : safeGetState();
    if (!lastState) lastState = safeGetState();
    render();
  }

  function subscribe() {
    if (subscribed) return;
    var m = getMonitor();
    if (!m || typeof m.subscribe !== 'function') return;
    try {
      var r = m.subscribe(onStateChange);
      unsubscribeFn = (typeof r === 'function') ? r : null;
      subscribed = true;
    } catch (e) { subscribed = false; }
    lastState = safeGetState();
    render();
  }

  function scheduleRetry() {
    if (subscribed || retryCount >= MAX_RETRIES) return;
    retryCount++;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (getMonitor()) { subscribe(); }
      if (!subscribed) scheduleRetry();
    }, 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Open / close / toggle.                                              */
  /* ------------------------------------------------------------------ */
  function open(taskId) {
    /* v55 P6: slide-over REMOVED — full-screen live view; hide BOTH sidebars (#sidebar + #enzoPanel) via the enzo-live-fullscreen body class plus inline display none. */
    if (typeof document !== 'undefined') {
      if (document.body && document.body.classList) document.body.classList.add('enzo-live-fullscreen');
      var sb = document.getElementById('sidebar'); if (sb) sb.style.display = 'none';
      var ep = document.getElementById('enzoPanel'); if (ep) ep.style.display = 'none';
    }
    isOpenFlag = true;
    try { render(); } catch (e) { /* re-render from stored monitor state */ }
    if (window.EnzoMonitorFullscreen) return window.EnzoMonitorFullscreen.open(taskId);
    return false;
  }
  function close() {
    /* v55 P6: restore the normal 3-column layout — remove the fullscreen class and restore BOTH sidebars. State is only hidden, never unmounted or cleared. */
    if (typeof document !== 'undefined') {
      if (document.body && document.body.classList) document.body.classList.remove('enzo-live-fullscreen');
      var sb = document.getElementById('sidebar'); if (sb) sb.style.display = '';
      var ep = document.getElementById('enzoPanel'); if (ep) ep.style.display = '';
    }
    isOpenFlag = false;
    if (window.EnzoMonitorFullscreen) window.EnzoMonitorFullscreen.close();
  }

  function onKeyDown(e) {
    if (!e) return;
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpenFlag) {
      if (e.preventDefault) e.preventDefault();
      close();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API.                                                         */
  /* ------------------------------------------------------------------ */
  function mount() {
    if (mounted) { render(); return true; }
    if (typeof document === 'undefined' || !document.body) return false;
    try {
      buildButton();
      buildPanel();
      wireToolsButtons();
      if (document.addEventListener) {
        document.addEventListener('keydown', onKeyDown);
      }
      mounted = true;
      subscribe();
      lastState = safeGetState();
      render();
      if (!subscribed) scheduleRetry();
      return true;
    } catch (e) {
      mounted = false;
      return false;
    }
  }

  function unmount() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (subscribed && unsubscribeFn) {
      try { unsubscribeFn(); } catch (e) { /* ignore */ }
    } else {
      var m = getMonitor();
      if (m && typeof m.unsubscribe === 'function') {
        try { m.unsubscribe(onStateChange); } catch (e) { /* ignore */ }
      }
    }
    subscribed = false;
    unsubscribeFn = null;
    if (document.removeEventListener) {
      document.removeEventListener('keydown', onKeyDown);
    }
    var panel = $('enzoMonitorPanel');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    var btn = $('enzoMonitorBtn');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    var entry = $('enzoMonitorToolsEntry');
    if (entry && entry.parentNode) entry.parentNode.removeChild(entry);
    els = {};
    mounted = false;
    isOpenFlag = false;
    lastState = null;
  }

  function setActiveTask(taskId) {
    activeTaskId = taskId || null;
    var m = getMonitor();
    if (taskId && m && typeof m.openTask === 'function') {
      try { m.openTask(taskId); } catch (e) { /* openTask is best-effort */ }
    }
    view = 'timeline';
    render();
  }

  var api = {
    mount: mount,
    unmount: unmount,
    open: open,
    close: close,
    toggle: function () { if (isOpenFlag) close(); else open(); },
    isOpen: function () { return isOpenFlag; },
    setActiveTask: setActiveTask
  };

  /* Expose on window (and globalThis for non-window runtimes). */
  try {
    if (typeof window !== 'undefined') window.EnzoMonitorUI = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoMonitorUI = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Auto-mount guard: mount when the DOM is ready; if the data layer is
     not loaded yet, mount() still builds the graceful starting state
     and scheduleRetry() subscribes as soon as EnzoMonitor appears. */
  function initEnzoMonitorUI() {
    if (typeof document === 'undefined') return false;
    if (document.readyState === 'loading' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', function () { mount(); });
      return true;
    }
    return mount();
  }

  try {
    if (typeof window !== 'undefined') window.initEnzoMonitorUI = initEnzoMonitorUI;
    if (typeof globalThis !== 'undefined') globalThis.initEnzoMonitorUI = initEnzoMonitorUI;
  } catch (e) { /* ignore */ }

  initEnzoMonitorUI();
})();

