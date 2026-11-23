
/* ============================================================================
 * ENAO AI — ENZO's OWN AGENTS: live agents panel + per-agent guidance
 * Piece P9 (06-agents.js)
 * ----------------------------------------------------------------------------
 * Raja's requirement (voice call, 22 Nov 2026 ~12:42 PM PKT): when there
 * is long research or big work, ENZO itself creates its OWN AGENTS —
 * splits the work into parts, assigns its own agent per part, runs them
 * all in parallel, then joins all results into one final result (exactly
 * like this build is made in pieces). Each agent's work must show in the
 * live view (which agent is on which part, its progress/status), and Raja
 * can guide in the middle via mic/typing (live-guidance rule unchanged).
 *
 * What this piece does:
 *  - Agents panel inside the full-screen live view (03-monitor-fullscreen):
 *    one row per agent — display name (Agent 1, Agent 2, ...), the part
 *    it works on (its subtask), live status (queued / running / done /
 *    failed / paused), REAL progress only (steps done, sources found —
 *    never an invented percentage), and its partial finding when done.
 *    The panel is fed by two real sources and nothing else: the
 *    per-agent events the backend emits (agent_created / agent_started /
 *    agent_progress / agent_completed / agent_failed / retry_started /
 *    agent_verified) and GET /api/v2/tasks/{id}/progress (agents carry
 *    subtask + sources_count since P9). Zero events means zero rows.
 *  - Per-agent guidance targeting: parseAgentGuidance(text, agents)
 *    resolves which agent Raja means ("agent 2", "doosra agent",
 *    "pehle wala agent", "history wala agent", Urdu script equivalents)
 *    plus the directive (stop / pause / redo / focus / more-detail /
 *    more-sources) and routes it through the REAL modify endpoint
 *    (POST /api/v2/tasks/{id}/modify) with a directive naming that
 *    agent's subtask — because the backend matches subtasks by content
 *    words, never by agent number. Directives that have NO backend route
 *    are NOT sent: they are reported as a gap (see "Guidance-targeting
 *    gaps" in the EVIDENCE file). This piece invents no endpoint.
 *
 * What it does NOT do:
 *  - No whole-task guidance: that stays in 03-monitor-fullscreen
 *    (parseGuidance / applyGuidance). If an instruction names no agent,
 *    applyAgentGuidance rejects with 'no-agent-target' so the caller
 *    (the assembler / 03) can fall back to whole-task guidance.
 *  - No voice identification: the mic lives in 03; this piece only
 *    parses text it is handed.
 *  - No percentages, no ETA, no invented findings: progress lines show
 *    only steps and source counts the backend actually reported.
 *
 * Style: plain ES5, no dependencies, no emojis anywhere.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var API_BASE = window.EnzoPagesBackend.getBackendBase();
  var PANEL_ID = 'enzoMonitorAgents';
  var LIST_ID = 'enzoMonitorAgentsList';
  var COUNT_ID = 'enzoMonitorAgentsCount';
  var STATUS_ID = 'enzoMonitorAgentsStatus';
  var BODY_ID = 'enzoMonitorBody';
  var GUIDANCE_ID = 'enzoMonitorGuidance';
  var BUTTON_ID = 'enzoMonitorBtn';
  var TOOLS_ENTRY_ID = 'enzoMonitorToolsEntry';

  /* Role labels, same words as the monitor data layer (M1 ROLE_LABELS),
     used only to display a role when the progress payload has no role
     text of its own. Reverse map (label -> role) is used when reading
     M1 activities, whose public shape carries the label, not the role. */
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

  var LABEL_TO_ROLE = {};
  (function () {
    var k;
    for (k in ROLE_LABELS) {
      if (Object.prototype.hasOwnProperty.call(ROLE_LABELS, k)) {
        LABEL_TO_ROLE[ROLE_LABELS[k]] = k;
      }
    }
  })();

  /* Backend agent statuses -> panel statuses. 'paused' is shown as
     'paused' (a fifth badge); everything else maps 1:1. Unknown values
     fall back to 'queued' rather than inventing a status. */
  var STATUS_MAP = {
    queued: 'queued',
    running: 'running',
    done: 'done',
    failed: 'failed',
    paused: 'paused',
    cancelled: 'failed'
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function root() {
    if (typeof window !== 'undefined') return window;
    return (typeof globalThis !== 'undefined') ? globalThis : this;
  }

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

  function getMonitor() {
    try {
      var w = root();
      return (w && w.EnzoMonitor) ? w.EnzoMonitor : null;
    } catch (e) { return null; }
  }

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function asNonEmptyString(v) {
    var s = asString(v).replace(/^\s+|\s+$/g, '');
    return s ? s : null;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /* Normalise for matching: lower-case, collapse whitespace, strip
     surrounding punctuation. Urdu-script words are kept as tokens. */
  function normText(text) {
    var s = asString(text).toLowerCase();
    s = s.replace(/[\u0600-\u06FF]+/g, function (m) { return ' ' + m + ' '; });
    s = s.replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  function hasUrduScript(text) {
    return /[\u0600-\u06FF]/.test(asString(text));
  }

  /* Urdu-Indic digits (۰-۹) to ASCII digits, so "ایجنٹ ۲" reads as 2. */
  function foldDigits(text) {
    var map = {
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    };
    return asString(text).replace(/[۰-۹]/g, function (d) { return map[d]; });
  }

  var ROMAN_URDU_WORDS = [
    'ruk', 'jao', 'jayo', 'band', 'karo', 'kar', 'do', 'dobara', 'shuru',
    'phir', 'se', 'zyada', 'dhyaan', 'sirf', 'thora', 'thodi', 'der',
    'dair', 'jaari', 'rakho', 'chor', 'hata', 'nikal', 'aur', 'bhi',
    'is', 'ye', 'yeh', 'par', 'pe', 'ka', 'ki', 'ko', 'mein', 'mera',
    'kya', 'kis', 'kuch', 'bas', 'pehle', 'gehrai', 'tafseel', 'muqabla',
    'agent', 'hisse', 'hissa', 'wala', 'wale', 'doosra', 'dusra', 'teesra'
  ];

  function detectLanguage(text) {
    var raw = asString(text);
    if (hasUrduScript(raw)) return 'ur';
    var words = normText(raw).split(' ');
    var hits = 0;
    for (var i = 0; i < words.length; i++) {
      if (ROMAN_URDU_WORDS.indexOf(words[i]) !== -1) hits++;
    }
    if (hits > 0) return 'roman';
    return 'en';
  }

  /* ------------------------------------------------------------------ */
  /* Module state                                                        */
  /* ------------------------------------------------------------------ */

  var mounted = false;
  var panelBuilt = false;
  var subscribed = false;
  var currentTaskId = null;
  var agents = {};      /* agent_id -> agent record */
  var agentOrder = [];  /* agent_ids in display (creation) order */
  var els = {};
  var fetchFnOverride = null; /* tests only: stub fetch layer */
  var monitorOverride = null; /* tests only: stub EnzoMonitor */
  var onStateChange = null;   /* the subscribe callback, for unmount */

  function getFetch() {
    if (fetchFnOverride) return fetchFnOverride;
    var w = root();
    return (w && typeof w.fetch === 'function') ? w.fetch : null;
  }

  function getMonitorOrOverride() {
    return monitorOverride || getMonitor();
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  /* ------------------------------------------------------------------ */
  /* Agent records                                                       */
  /* ------------------------------------------------------------------ */

  /* One record per agent. Only fields the backend actually reported are
     stored; anything unknown stays null/empty and renders as "unknown"
     or is omitted — never invented. */
  function newAgent(agentId, index) {
    return {
      agent_id: agentId,
      index: (typeof index === 'number' && index > 0) ? index : null,
      name: (typeof index === 'number' && index > 0)
        ? ('Agent ' + index) : 'Agent ?',
      role: null,
      subtask: null,
      status: 'queued',
      steps: [],          /* real step strings, in arrival order */
      sourcesFound: null, /* count from agent_progress / progress */
      sources: [],        /* URLs from agent_progress, when reported */
      finding: null,      /* preview text, only when the agent is done */
      verified: null,     /* 'verified' | 'conflicting' | 'unverified' */
      error: null,
      note: null
    };
  }

  function displayIndex(agentId) {
    var pos = agentOrder.indexOf(agentId);
    return pos === -1 ? null : pos + 1;
  }

  function ensureAgent(agentId, detail) {
    if (!agentId) return null;
    var rec = agents[agentId];
    if (!rec) {
      var idx = null;
      if (detail && typeof detail.agent_index === 'number') {
        idx = detail.agent_index;
      }
      rec = newAgent(agentId, idx);
      agents[agentId] = rec;
      agentOrder.push(agentId);
    }
    if (detail) {
      if (typeof detail.agent_index === 'number') {
        rec.index = detail.agent_index;
        rec.name = 'Agent ' + detail.agent_index;
      }
      if (asNonEmptyString(detail.agent_name)) {
        rec.name = detail.agent_name;
      }
      if (asNonEmptyString(detail.role)) rec.role = detail.role;
      if (asNonEmptyString(detail.subtask)) rec.subtask = detail.subtask;
    }
    if (rec.index === null) {
      var pos = displayIndex(agentId);
      if (pos !== null) {
        rec.index = pos;
        rec.name = 'Agent ' + pos;
      }
    }
    return rec;
  }

  function getAgents() {
    var out = [];
    for (var i = 0; i < agentOrder.length; i++) {
      var rec = agents[agentOrder[i]];
      if (rec) out.push(rec);
    }
    return out;
  }

  function pushStep(rec, step) {
    var s = asNonEmptyString(step);
    if (!s) return;
    if (rec.steps.indexOf(s) === -1) rec.steps.push(s);
  }

  /* ------------------------------------------------------------------ */
  /* Event ingestion — the live feed for the panel                       */
  /* ------------------------------------------------------------------ */
  /* One real backend event updates at most one agent row. Events for
     unknown agents create their row (the monitor may subscribe
     mid-task). Unknown event types are ignored, never rendered. */

  function detailOf(event) {
    if (isPlainObject(event.detail)) return event.detail;
    if (typeof event.detail === 'string') {
      try {
        var parsed = JSON.parse(event.detail);
        return isPlainObject(parsed) ? parsed : {};
      } catch (e) { return {}; }
    }
    return {};
  }

  function ingestEvent(event) {
    if (!isPlainObject(event)) return false;
    var type = asString(event.type);
    var detail = detailOf(event);
    var agentId = asNonEmptyString(event.agent_id);
    if (!agentId) return false;

    var rec = null;
    var handled = true;

    if (type === 'agent_created') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'queued';
    } else if (type === 'agent_started' || type === 'agent_running') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'running';
    } else if (type === 'agent_progress') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'running';
      var step = asNonEmptyString(detail.step);
      var count = (typeof detail.sources_found === 'number')
        ? detail.sources_found : null;
      if (count !== null) rec.sourcesFound = count;
      if (Array.isArray(detail.sources)) {
        var urls = [];
        for (var i = 0; i < detail.sources.length; i++) {
          if (typeof detail.sources[i] === 'string' && detail.sources[i]) {
            urls.push(detail.sources[i]);
          }
        }
        if (urls.length > 0) rec.sources = urls;
      }
      if (step) {
        pushStep(rec, count !== null
          ? (step + ' — ' + count + ' source' + (count === 1 ? '' : 's')
             + ' found')
          : step);
      } else if (count !== null) {
        pushStep(rec, count + ' source' + (count === 1 ? '' : 's')
                 + ' found');
      }
    } else if (type === 'agent_completed' || type === 'agent_done') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'done';
      if (typeof detail.sources_found === 'number') {
        rec.sourcesFound = detail.sources_found;
      }
      if (typeof detail.finding_preview === 'string'
          && detail.finding_preview) {
        rec.finding = detail.finding_preview;
      }
    } else if (type === 'agent_failed') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'failed';
      rec.error = asNonEmptyString(detail.error) || 'Agent failed.';
    } else if (type === 'failure') {
      /* Generic failure scoped to an agent: same outcome as
         agent_failed, without inventing a separate event. */
      rec = ensureAgent(agentId, detail);
      rec.status = 'failed';
      rec.error = asNonEmptyString(detail.error) || 'Agent failed.';
    } else if (type === 'retry_started') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'running';
      var retries = (typeof detail.retries === 'number')
        ? detail.retries : null;
      pushStep(rec, retries !== null
        ? ('Retrying — attempt ' + retries + '.')
        : 'Retrying after a failure.');
    } else if (type === 'agent_verified') {
      rec = ensureAgent(agentId, detail);
      var invented = Array.isArray(detail.invented_urls)
        ? detail.invented_urls.length : 0;
      if (detail.verified === true) rec.verified = 'verified';
      else if (detail.verified === false) {
        rec.verified = invented > 0 ? 'conflicting' : 'unverified';
      }
    } else if (type === 'agent_reassigned') {
      rec = ensureAgent(agentId, detail);
      pushStep(rec, 'Reassigned to a fresh attempt.');
    } else if (type === 'agent_paused') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'paused';
    } else if (type === 'agent_cancelled') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'failed';
      rec.note = 'Agent cancelled.';
    } else if (type === 'agent_queued') {
      rec = ensureAgent(agentId, detail);
      rec.status = 'queued';
    } else {
      handled = false;
    }

    if (handled) render();
    return handled;
  }

  /* ------------------------------------------------------------------ */
  /* Progress payload — the second real feed                             */
  /* ------------------------------------------------------------------ */
  /* GET /api/v2/tasks/{id}/progress returns agents with role, subtask,
     status and sources_count (P9). applyProgress merges that into the
     same records ingestEvent maintains; it never invents a step. */

  function applyProgress(progress) {
    if (!isPlainObject(progress)) return false;
    var changed = false;
    if (Array.isArray(progress.agents)) {
      for (var i = 0; i < progress.agents.length; i++) {
        var a = progress.agents[i];
        if (!isPlainObject(a)) continue;
        var agentId = asNonEmptyString(a.agent_id);
        if (!agentId) continue;
        var rec = ensureAgent(agentId, {
          role: asNonEmptyString(a.role),
          subtask: asNonEmptyString(a.subtask),
          agent_index: i + 1
        });
        var mapped = STATUS_MAP[asString(a.status)] || 'queued';
        if (rec.status !== mapped) { rec.status = mapped; changed = true; }
        if (typeof a.sources_count === 'number') {
          if (rec.sourcesFound !== a.sources_count) {
            rec.sourcesFound = a.sources_count;
            changed = true;
          }
        }
        if (rec.index === null) { rec.index = i + 1; rec.name = 'Agent ' + (i + 1); }
      }
    }
    if (Array.isArray(progress.findings_preview)) {
      for (var j = 0; j < progress.findings_preview.length; j++) {
        var f = progress.findings_preview[j];
        var text = null;
        var fAgent = null;
        if (typeof f === 'string') { text = f; }
        else if (isPlainObject(f)) {
          text = asNonEmptyString(f.finding) || asNonEmptyString(f.preview);
          fAgent = asNonEmptyString(f.agent_id);
        }
        if (!text) continue;
        if (fAgent && agents[fAgent]) {
          if (agents[fAgent].finding !== text) {
            agents[fAgent].finding = text;
            changed = true;
          }
        }
      }
    }
    if (changed) render();
    return changed;
  }

  function fetchProgress(taskId) {
    var fetchFn = getFetch();
    var id = taskId || currentTaskId;
    if (!fetchFn) return Promise.reject(new Error('fetch is not available'));
    if (!id) return Promise.reject(new Error('no-active-task'));
    /* v59 (Piece 32 [11]): progress through the EnzoPollingFix transport. */
    if (window.__enzoGetTransport59) return window.__enzoGetTransport59().getTaskProgress(id).then(function (j) { applyProgress(j); return j; });
    return fetchFn(API_BASE + '/tasks/' + encodeURIComponent(id) + '/progress', {
      method: 'GET'
    }).then(function (resp) {
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
        applyProgress(j);
        return j;
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Split + ONE agent per part + parallel + assemble                  */
  /* ------------------------------------------------------------------ */
  /* Long research / big work is SPLIT into parts, ONE agent per part
     is spawned/created (spawnAgent, one call per part, via
     spawnAgentsForParts), the agents run in PARALLEL (Promise.all,
     one job per agent), and their results are ASSEMBLED into one
     final result (assembleAgentResults). This is ENZO's own
     orchestration only: no external service, nothing paid, and each
     agent's part/status/progress stays visible in the live panel
     through the same records ingestEvent / applyProgress maintain. */

  function splitTask(task, partCount) {
    var text = asString(task).replace(/^\s+|\s+$/g, '');
    var count = parseInt(partCount, 10);
    if (isNaN(count) || count < 1) count = 3;
    if (count > 10) count = 10;
    var words = text ? text.split(/\s+/) : [];
    var parts = [];
    var i;
    if (words.length >= count) {
      var per = Math.ceil(words.length / count);
      for (i = 0; i < count; i++) {
        var slice = words.slice(i * per, (i + 1) * per);
        parts.push({
          index: i + 1,
          title: 'Part ' + (i + 1) + ' of ' + count,
          part: 'Part ' + (i + 1) + ' of ' + count,
          subtask: slice.join(' ') || text
        });
      }
    } else {
      for (i = 0; i < count; i++) {
        parts.push({
          index: i + 1,
          title: 'Part ' + (i + 1) + ' of ' + count,
          part: 'Part ' + (i + 1) + ' of ' + count,
          subtask: text + ' (part ' + (i + 1) + ' of ' + count + ')'
        });
      }
    }
    return parts;
  }

  var spawnCounter = 0;

  /* Spawn ONE agent for ONE part. Returns the agent record. */
  function spawnAgent(part, index) {
    spawnCounter += 1;
    var idx = (typeof index === 'number' && index > 0) ? index : spawnCounter;
    var agentId = 'spawned_agent_' + spawnCounter;
    var subtask = '';
    if (isPlainObject(part)) {
      subtask = asNonEmptyString(part.subtask)
        || asNonEmptyString(part.title)
        || asNonEmptyString(part.part) || '';
    } else {
      subtask = asString(part);
    }
    var rec = ensureAgent(agentId, {
      agent_index: idx,
      subtask: subtask || ('Part ' + idx)
    });
    rec.status = 'queued';
    render();
    return rec;
  }

  /* ONE agent per part: an agent is spawned/created per part. */
  function spawnAgentsForParts(parts) {
    var arr = Array.isArray(parts) ? parts : [];
    var list = [];
    for (var i = 0; i < arr.length; i++) {
      list.push(spawnAgent(arr[i], i + 1));
    }
    return list;
  }

  /* Run the agents for the parts in PARALLEL: one job per agent,
     joined with Promise.all so every part runs at the same time. */
  function runAgentsInParallel(parts, workFn) {
    var agentsList = spawnAgentsForParts(parts);
    var jobs = agentsList.map(function (agent) {
      return Promise.resolve().then(function () {
        agent.status = 'running';
        render();
        var out = (typeof workFn === 'function')
          ? workFn(agent)
          : { agent_id: agent.agent_id,
              result: 'Result for ' + (agent.subtask || agent.name) };
        return Promise.resolve(out).then(function (res) {
          agent.status = 'done';
          if (res && typeof res === 'object'
              && typeof res.result === 'string') {
            agent.finding = res.result;
          }
          render();
          return res;
        });
      });
    });
    return Promise.all(jobs);
  }

  /* ASSEMBLE the part results into one final result. Accepts the
     per-agent results (objects with a result/finding, or plain
     strings) and returns one object whose final result carries
     every part's result, in part order. */
  function assembleAgentResults(results) {
    var arr = Array.isArray(results) ? results : [];
    var texts = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (typeof r === 'string') {
        texts.push(r);
      } else if (isPlainObject(r)) {
        if (typeof r.result === 'string') texts.push(r.result);
        else if (typeof r.finding === 'string') texts.push(r.finding);
        else if (typeof r.part === 'string') texts.push(r.part);
        else texts.push(JSON.stringify(r));
      } else {
        texts.push(String(r));
      }
    }
    var finalText = texts.join('\n');
    return {
      final_result: finalText,
      assembled: finalText,
      parts: arr.length,
      part_count: arr.length
    };
  }

  /* Split + parallel + assemble in one call: split the task, run
     one agent per part in parallel, assemble into one final result. */
  function runSplitParallelAssemble(task, partCount, workFn) {
    var parts = splitTask(task, partCount);
    return runAgentsInParallel(parts, workFn).then(function (results) {
      return assembleAgentResults(results);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Monitor subscription — pick up M1 state (activities + events)      */
  /* ------------------------------------------------------------------ */
  /* M1 activities carry the agent id in their id ('agent:<id>'), the
     role label as title, and the subtask as why. When the progress fetch
     has not run yet, that is enough to show the row; the progress fetch
     (or the next event) fills in the role and source count. Nothing is
     shown that M1 did not actually record. */

  function refreshFromMonitor() {
    var m = getMonitorOrOverride();
    if (!m || typeof m.getState !== 'function') return false;
    var state = null;
    try { state = m.getState(); } catch (e) { return false; }
    if (!state || !isPlainObject(state.tasks)) return false;
    var changed = false;
    var taskIds = Object.keys(state.tasks);
    for (var t = 0; t < taskIds.length; t++) {
      var entry = state.tasks[taskIds[t]];
      if (!entry || !Array.isArray(entry.activities)) continue;
      if (state.activeTaskId) currentTaskId = state.activeTaskId;
      for (var i = 0; i < entry.activities.length; i++) {
        var act = entry.activities[i];
        if (!isPlainObject(act) || typeof act.id !== 'string') continue;
        if (act.id.indexOf('agent:') !== 0) continue;
        var agentId = act.id.slice('agent:'.length);
        if (!agentId) continue;
        var role = LABEL_TO_ROLE[asString(act.title)] || null;
        var rec = ensureAgent(agentId, {
          role: role,
          subtask: asNonEmptyString(act.why)
        });
        var mapped = null;
        if (act.status === 'completed') mapped = 'done';
        else if (act.status === 'failed') mapped = 'failed';
        else if (act.status === 'running') mapped = 'running';
        else if (act.status === 'retrying') mapped = 'running';
        else if (act.status === 'pending') mapped = 'queued';
        if (mapped && rec.status !== mapped) {
          /* Events and progress are authoritative over restored
             history: only fill in a row that has never been updated. */
          if (rec.steps.length === 0 && rec.sourcesFound === null) {
            rec.status = mapped;
            changed = true;
          }
        }
        if (Array.isArray(act.findings) && act.findings.length > 0) {
          var text = act.findings[act.findings.length - 1];
          if (typeof text === 'string' && text && !rec.finding) {
            rec.finding = text;
            changed = true;
          }
        }
      }
    }
    if (changed) render();
    return changed;
  }

  /* ------------------------------------------------------------------ */
  /* Panel rendering                                                     */
  /* ------------------------------------------------------------------ */

  function statusLabel(status) {
    if (status === 'queued') return 'queued';
    if (status === 'running') return 'running';
    if (status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    if (status === 'paused') return 'paused';
    return 'queued';
  }

  function progressText(rec) {
    /* Real progress only: steps actually reported + sources actually
       found. No percentage is ever computed or shown. */
    var parts = [];
    if (rec.status === 'queued') parts.push('Waiting to start.');
    if (rec.sourcesFound !== null) {
      parts.push(rec.sourcesFound + ' source' +
                 (rec.sourcesFound === 1 ? '' : 's') + ' found');
    }
    if (rec.steps.length > 0) {
      parts.push(rec.steps[rec.steps.length - 1]);
    }
    if (rec.status === 'running' && parts.length === 0) {
      parts.push('Working…');
    }
    if (rec.status === 'done' && parts.length === 0) {
      parts.push('Finished.');
    }
    if (rec.status === 'failed') {
      parts.push(rec.error || 'Failed.');
    }
    if (rec.status === 'paused') parts.push('Paused.');
    return parts.join(' ');
  }

  function render() {
    if (!panelBuilt || !els.list) return;
    while (els.list.firstChild) {
      els.list.removeChild(els.list.firstChild);
    }
    var list = getAgents();
    if (els.count) {
      var done = 0;
      for (var c = 0; c < list.length; c++) {
        if (list[c].status === 'done') done++;
      }
      els.count.textContent = list.length === 0
        ? 'No agents yet — start a research task to see its agents here.'
        : (list.length + ' agent' + (list.length === 1 ? '' : 's') +
           ' — ' + done + ' done');
    }
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      var row = el('li', 'enzo-agents-row');
      row.setAttribute('data-agent-id', rec.agent_id);
      row.setAttribute('data-agent-status', rec.status);

      var head = el('div', 'enzo-agents-head');
      head.appendChild(el('span', 'enzo-agents-name', rec.name));
      head.appendChild(el('span', 'enzo-agents-part',
        rec.subtask || 'Part not named yet.'));
      var badge = el('span',
        'enzo-agents-status enzo-agents-status-' + statusLabel(rec.status),
        statusLabel(rec.status));
      head.appendChild(badge);
      row.appendChild(head);

      if (rec.role) {
        row.appendChild(el('div', 'enzo-agents-role',
          ROLE_LABELS[rec.role] || rec.role));
      }
      row.appendChild(el('div', 'enzo-agents-progress', progressText(rec)));
      if (rec.verified) {
        row.appendChild(el('div', 'enzo-agents-verified',
          'Sources check: ' + rec.verified + '.'));
      }
      if (rec.status === 'done' && rec.finding) {
        row.appendChild(el('div', 'enzo-agents-finding', rec.finding));
      }
      els.list.appendChild(row);
    }
  }

  function buildPanel() {
    if (panelBuilt) return els.panel || null;
    var body = $(BODY_ID);
    if (!body) return null;
    var panel = el('div', 'enzo-agents-panel');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'ENZO agents working on this research');

    var header = el('div', 'enzo-agents-header', 'ENZO agents — working in parallel');
    panel.appendChild(header);

    var count = el('p', 'enzo-agents-count',
      'No agents yet — start a research task to see its agents here.');
    count.id = COUNT_ID;
    panel.appendChild(count);
    els.count = count;

    var list = el('ul', 'enzo-agents-list');
    list.id = LIST_ID;
    panel.appendChild(list);
    els.list = list;

    var status = el('p', 'enzo-agents-status-line', null);
    status.id = STATUS_ID;
    status.setAttribute('aria-live', 'polite');
    panel.appendChild(status);
    els.status = status;

    /* Directly under the guidance bar when it exists (03 mounts the bar
       as the first child of #enzoMonitorBody), otherwise first child of
       the monitor body — always above the dashboard and the timeline. */
    var guide = $(GUIDANCE_ID);
    if (guide && guide.parentNode === body && guide.nextSibling) {
      body.insertBefore(panel, guide.nextSibling);
    } else if (guide && guide.parentNode === body) {
      body.appendChild(panel);
    } else if (body.firstChild) {
      body.insertBefore(panel, body.firstChild);
    } else {
      body.appendChild(panel);
    }
    els.panel = panel;
    panelBuilt = true;
    render();
    return panel;
  }

  /* ------------------------------------------------------------------ */
  /* Per-agent guidance targeting: parseAgentGuidance(text, agents)      */
  /*                                                                     */
  /* Pure function. Returns { raw, lang, agentRef, action, directive,   */
  /* routable, gap, note }.                                             */
  /*  agentRef: { kind: 'ordinal' | 'role-words' | 'all' | 'none' |      */
  /*    'unresolved', index, agent_id, subtask, role, status }          */
  /*  action: 'stop' | 'pause' | 'redo' | 'focus' | 'more-detail' |      */
  /*    'more-sources' | 'none'                                         */
  /*  directive: English instruction for POST .../modify, naming the    */
  /*    agent's REAL subtask (the backend matches subtasks by content   */
  /*    words, never by agent number). Empty when not routable.          */
  /*  routable: false means NOTHING is sent — the gap names the exact   */
  /*    reason (see EVIDENCE).                                          */
  /* ------------------------------------------------------------------ */

  var ORDINAL_WORDS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    pehla: 1, pehle: 1, doosra: 2, doosre: 2, dusra: 2, dusre: 2,
    dosra: 2, teesra: 3, teesre: 3, tisra: 3, chautha: 4, paanchwan: 5
  };

  var ORDINAL_URDU = {
    'پہلا': 1, 'پہلے': 1, 'دوسرا': 2, 'تیسرا': 3, 'چوتھا': 4, 'پانچواں': 5
  };

  /* Words stripped when matching an agent by its part ("history wala
     agent" -> the agent whose subtask mentions history). */
  var REF_STRIP = [
    'agent', 'agents', 'wala', 'wale', 'wali', 'ko', 'ka', 'ki', 'ke',
    'is', 'ye', 'yeh', 'us', 'iss', 'par', 'pe', 'mein', 'aur', 'bhi',
    'dobara', 'phir', 'se', 'karo', 'kar', 'karna', 'karwao', 'do',
    'roko', 'rok', 'do', 'band', 'khatam', 'ruko', 'pause', 'stop',
    'focus', 'dhyaan', 'zyada', 'ziyada', 'detail', 'details', 'tafseel',
    'gehrai', 'sources', 'source', 'hisse', 'hissa', 'hisay', 'part',
    'the', 'a', 'an', 'this', 'that', 'it', 'to', 'for', 'on', 'more',
    'research', 'karo', 'please', 'zara', 'thora', 'thoda', 'sirf',
    'pehle', 'pehla', 'doosra', 'dusra', 'dosra', 'teesra', 'tisra',
    'ایجنٹ', 'حصہ', 'حصے', 'کو', 'پر', 'دوبارہ', 'روک', 'دو', 'کرو'
  ];

  function contentWords(text) {
    var words = normText(text).split(' ').filter(function (w) {
      return w !== '';
    });
    var out = [];
    for (var i = 0; i < words.length; i++) {
      if (REF_STRIP.indexOf(words[i]) === -1 && words[i].length >= 3) {
        out.push(words[i]);
      }
    }
    return out;
  }

  function agentByIndex(agentsList, index) {
    if (!agentsList) return null;
    for (var i = 0; i < agentsList.length; i++) {
      var a = agentsList[i];
      if (!a) continue;
      var n = (typeof a.index === 'number') ? a.index : (i + 1);
      if (n === index) return a;
      if (a.name === 'Agent ' + index) return a;
    }
    return null;
  }

  function agentByWords(agentsList, words) {
    if (!agentsList || words.length === 0) return null;
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < agentsList.length; i++) {
      var a = agentsList[i];
      if (!a) continue;
      var hay = normText((a.subtask || '') + ' ' + (a.role || ''));
      var score = 0;
      for (var j = 0; j < words.length; j++) {
        if (hay.indexOf(words[j]) !== -1) score++;
      }
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return bestScore > 0 ? best : null;
  }

  function resolveAgentRef(text, agentsList) {
    var raw = asString(text);
    var folded = foldDigits(raw);
    var n = normText(folded);

    /* "all agents" / "sab agents" — a whole-task instruction, not one
       agent. The caller (03) owns whole-task guidance. */
    if (/\ball agents\b/.test(n) || /\bsab agents\b/.test(n) ||
        /\bsaare agents\b/.test(n) || /\bsare agents\b/.test(n) ||
        /تمام ایجنٹ/.test(raw)) {
      return { kind: 'all', index: null, agent_id: null,
               subtask: null, role: null, status: null };
    }

    /* Ordinal by number: "agent 2", "2nd agent", "agent number 2",
       "ایجنٹ 2". */
    var m = n.match(/\bagent\s*(?:number\s*)?(\d+)\b/) ||
      n.match(/\b(\d+)\s*(?:st|nd|rd|th)?\s*agent\b/) ||
      folded.match(/ایجنٹ\s*(\d+)/);
    if (m) {
      var num = parseInt(m[1], 10);
      var found = agentByIndex(agentsList, num);
      if (found) {
        return { kind: 'ordinal', index: num, agent_id: found.agent_id,
                 subtask: found.subtask, role: found.role,
                 status: found.status };
      }
      return { kind: 'unresolved', index: num, agent_id: null,
               subtask: null, role: null, status: null };
    }

    /* Ordinal by word: "first agent", "pehla agent", "doosra agent",
       "پہلا ایجنٹ". */
    var wordRe = new RegExp(
      '\\b(first|second|third|fourth|fifth|pehla|pehle|doosra|doosre|' +
      'dusra|dusre|dosra|teesra|teesre|tisra|chautha|paanchwan)\\b\\s*(?:wala\\s+|wale\\s+)?agent\\b|' +
      '(پہلا|پہلے|دوسرا|تیسرا|چوتھا|پانچواں)\\s*ایجنٹ');
    var wm = wordRe.exec(n) || wordRe.exec(raw);
    if (wm) {
      var word = wm[1] || wm[2];
      var wNum = ORDINAL_WORDS[word] || ORDINAL_URDU[word];
      if (wNum) {
        var wFound = agentByIndex(agentsList, wNum);
        if (wFound) {
          return { kind: 'ordinal', index: wNum, agent_id: wFound.agent_id,
                   subtask: wFound.subtask, role: wFound.role,
                   status: wFound.status };
        }
        return { kind: 'unresolved', index: wNum, agent_id: null,
                 subtask: null, role: null, status: null };
      }
    }

    /* "pehle wala agent" / "dusre wala agent" (ordinal word + wala). */
    var walaRe = /\b(pehle|pehla|doosre|doosra|dusre|dusra|teesre|teesra)\s+(wala|wale)\s+agent\b/;
    var walaM = walaRe.exec(n);
    if (walaM) {
      var base = walaM[1].replace(/e$/, 'a');
      var vNum = ORDINAL_WORDS[base] || ORDINAL_WORDS[walaM[1]];
      if (vNum) {
        var vFound = agentByIndex(agentsList, vNum);
        if (vFound) {
          return { kind: 'ordinal', index: vNum, agent_id: vFound.agent_id,
                   subtask: vFound.subtask, role: vFound.role,
                   status: vFound.status };
        }
        return { kind: 'unresolved', index: vNum, agent_id: null,
                 subtask: null, role: null, status: null };
      }
    }

    /* By part: "history wala agent", "data wala agent", "history wale
       hisse ko dobara karo" — match the agent whose subtask/role shares
       a content word with the instruction. A bare "is hisse ko dobara
       karo" names no part, so its content words are empty and it falls
       through to 'none' (whole-task guidance owns it). */
    if (/\bagent\b/.test(n) || /ایجنٹ/.test(raw) || /\bhisse\b/.test(n) ||
        /\bhissa\b/.test(n) || /\bpart\b/.test(n)) {
      var words = contentWords(raw);
      var byWord = agentByWords(agentsList, words);
      if (byWord) {
        var idx = (typeof byWord.index === 'number') ? byWord.index : null;
        return { kind: 'role-words', index: idx, agent_id: byWord.agent_id,
                 subtask: byWord.subtask, role: byWord.role,
                 status: byWord.status };
      }
      if (/\bagent\b/.test(n) || /ایجنٹ/.test(raw)) {
        return { kind: 'unresolved', index: null, agent_id: null,
                 subtask: null, role: null, status: null };
      }
    }

    return { kind: 'none', index: null, agent_id: null,
             subtask: null, role: null, status: null };
  }

  function detectAgentAction(text) {
    var raw = asString(text);
    var n = normText(raw);
    /* Pause-specific phrasings first: "thodi der ke liye roko" is a
       pause, bare "roko" is a stop (same order rule as 03). */
    var pauseRe = new RegExp(
      '\\bpause\\b|' +
      'thodi der|' +
      'thoda ruk|' +
      'thora ruk|' +
      'kuch der|' +
      'وقفہ');
    if (pauseRe.test(n) || pauseRe.test(raw)) return 'pause';
    var redoRe = new RegExp(
      '\\bdobara\\b|' +
      'phir se|' +
      'dobara karo|' +
      'دوبارہ');
    if (redoRe.test(n) || redoRe.test(raw)) return 'redo';
    var stopRe = new RegExp(
      '\\bstop\\b|' +
      'roko|' +
      'rok do|' +
      'band karo|' +
      'band kar do|' +
      'khatam kar do|' +
      'روکو|' +
      'روک دو|' +
      'بند کر دو|' +
      'ختم کر دو');
    if (stopRe.test(n) || stopRe.test(raw)) return 'stop';
    var focusRe = new RegExp(
      '\\bfocus\\b|' +
      'zyada dhyaan|' +
      'ziyada dhyaan|' +
      '\\bpriorit|' +
      'pehle .* focus|' +
      'زیادہ توجہ|' +
      'توجہ');
    if (focusRe.test(n) || focusRe.test(raw)) return 'focus';
    var moreSrcRe = new RegExp(
      'more sources|' +
      'aur sources|' +
      'zyada sources|' +
      'مزید ذرائع');
    if (moreSrcRe.test(n) || moreSrcRe.test(raw)) return 'more-sources';
    var detailRe = new RegExp(
      'more detail|' +
      'zyada detail|' +
      'go deeper|' +
      'gehrai|' +
      'تفصیل');
    if (detailRe.test(n) || detailRe.test(raw)) return 'more-detail';
    return 'none';
  }

  function parseAgentGuidance(text, agentsList) {
    var raw = asString(text);
    var lang = detectLanguage(raw);
    var list = agentsList || getAgents();
    var base = {
      raw: raw, lang: lang,
      agentRef: { kind: 'none', index: null, agent_id: null,
                  subtask: null, role: null, status: null },
      action: 'none', directive: '', routable: false, gap: null, note: null
    };
    if (!normText(raw)) {
      base.gap = 'empty';
      return base;
    }
    var ref = resolveAgentRef(raw, list);
    base.agentRef = ref;
    var action = detectAgentAction(raw);
    base.action = action;

    if (ref.kind === 'none') {
      /* No agent is named: whole-task guidance owns this (03). */
      base.gap = 'no-agent-reference';
      return base;
    }
    if (ref.kind === 'all') {
      base.gap = 'whole-task-guidance';
      return base;
    }
    if (!list || list.length === 0) {
      base.gap = 'no-agents-known';
      base.note = 'The live panel has no agents yet, so "agent 2" cannot'
        + ' be resolved to a part.';
      return base;
    }
    if (ref.kind === 'unresolved') {
      base.gap = 'agent-not-found';
      base.note = 'No agent matches that reference in the live panel.';
      return base;
    }
    if (action === 'none') {
      base.gap = 'no-directive';
      return base;
    }
    var subtask = asNonEmptyString(ref.subtask) || '';
    var status = asString(ref.status || '');
    var knownStatus = (status === 'queued' || status === 'running' ||
                       status === 'paused' || status === 'done' ||
                       status === 'failed');

    if (action === 'pause') {
      /* GAP (verified): AgentManager.pause_agent exists, but no /api/v2
         route exposes it — only the whole-task pause exists. Never
         pretend a per-agent pause was sent. */
      base.gap = 'no-per-agent-pause-endpoint';
      base.note = 'One agent alone cannot be paused through the API;'
        + ' pause the whole task instead, or stop that agent.';
      return base;
    }
    if (action === 'stop') {
      if (status === 'done' || status === 'failed') {
        base.gap = 'agent-already-finished';
        base.note = 'That agent already finished; there is nothing to'
          + ' stop, and completed work is kept.';
        return base;
      }
      /* remove_subtask cancels queued/running/paused agents (control.py)
         and keeps completed work. The directive names the real subtask:
         the backend matches by content words. */
      base.directive = subtask
        ? ('Remove the subtask about ' + subtask)
        : 'Remove the subtask about this part';
      base.routable = true;
      if (!knownStatus) {
        base.note = 'Agent status is unknown to the panel; the backend'
          + ' will answer if there is nothing to stop.';
      }
      return base;
    }
    if (action === 'redo') {
      if (status === 'done') {
        /* GAP (verified): remove_subtask preserves completed work by
           design (control.py) — a finished part cannot be redone
           through modify. */
        base.gap = 'completed-work-preserved';
        base.note = 'That part already finished and its result is kept;'
          + ' modify cannot redo a completed part. Start a follow-up'
          + ' task for a fresh run of it.';
        return base;
      }
      if (status === 'failed') {
        /* GAP (verified): remove_subtask ignores failed agents and
           add_topic refuses a topic already in the plan — so a failed
           part cannot be redone through modify either. */
        base.gap = 'failed-part-cannot-redo-via-modify';
        base.note = 'That part failed and its subtask is still in the'
          + ' plan, so modify can neither remove it nor re-add it.';
        return base;
      }
      /* Queued/running/paused: remove cancels it, add_topic starts a
         fresh agent for the same part. One modify call classifies both
         actions (control.py _classify_modify returns all matches). */
      base.directive = subtask
        ? ('Remove the subtask about ' + subtask +
           ' and add a topic about ' + subtask)
        : 'Remove the subtask about this part and add a topic about it';
      base.routable = true;
      if (!knownStatus) {
        base.note = 'Agent status is unknown to the panel; the backend'
          + ' will answer if the part cannot be redone.';
      }
      return base;
    }
    /* focus / more-detail / more-sources: modify adds a new subtask (or
       raises the matched one) whatever the target's status; completed
       work is kept, new work is added. Always routable. */
    if (action === 'focus') {
      base.directive = subtask
        ? ('Focus first on ' + subtask)
        : 'Focus first on the current part';
      base.routable = true;
    } else if (action === 'more-detail') {
      base.directive = subtask
        ? ('Give more detail on ' + subtask)
        : 'Give more detail on the current part';
      base.routable = true;
    } else if (action === 'more-sources') {
      base.directive = subtask
        ? ('Find more sources on ' + subtask)
        : 'Find more sources on the current part';
      base.routable = true;
    }
    if (base.routable && status === 'done') {
      base.note = 'That part already finished; this adds new work on it'
        + ' while the finished result is kept.';
    }
    return base;
  }

  /* ------------------------------------------------------------------ */
  /* Confirmation + gap lines, in the user's language.                   */
  /* ------------------------------------------------------------------ */

  var CONFIRM = {
    ok: {
      ur: 'Theek hai — us agent ko aap ki instruction ke mutabiq adjust kar diya gaya hai.',
      roman: 'Theek hai — us agent ko aap ki instruction ke mutabiq adjust kar diya gaya hai.',
      en: 'Done — that agent has been adjusted as you instructed.'
    },
    noAgent: {
      ur: 'Kisi agent ka naam nahi diya — agent ka number ya hissa batayein, jaise "agent 2".',
      roman: 'Kisi agent ka naam nahi diya — agent ka number ya hissa batayein, jaise "agent 2".',
      en: 'No agent was named — say which agent, e.g. "agent 2".'
    },
    notFound: {
      ur: 'Wo agent live panel mein nahi mila — number ya hissa dobara batayein.',
      roman: 'Wo agent live panel mein nahi mila — number ya hissa dobara batayein.',
      en: 'That agent was not found in the live panel — say the number or part again.'
    },
    pauseGap: {
      ur: 'Ek agent ko akela pause nahi kiya ja sakta — poori research pause karein, ya us agent ko rok dein.',
      roman: 'Ek agent ko akela pause nahi kiya ja sakta — poori research pause karein, ya us agent ko rok dein.',
      en: 'One agent alone cannot be paused — pause the whole research, or stop that agent.'
    },
    finishedGap: {
      ur: 'Wo agent pehle hi khatam ho chuka hai — us ka kaam mehfooz hai.',
      roman: 'Wo agent pehle hi khatam ho chuka hai — us ka kaam mehfooz hai.',
      en: 'That agent already finished — its work is kept.'
    },
    redoDoneGap: {
      ur: 'Wo hissa pehle hi mukammal hai — mukammal kaam dobara nahi hota. Follow-up research shuru karein.',
      roman: 'Wo hissa pehle hi mukammal hai — mukammal kaam dobara nahi hota. Follow-up research shuru karein.',
      en: 'That part already finished — completed work cannot be redone. Start a follow-up task.'
    },
    redoFailedGap: {
      ur: 'Wo hissa fail ho gaya hai aur dobara shuru nahi ho sakta — follow-up research shuru karein.',
      roman: 'Wo hissa fail ho gaya hai aur dobara shuru nahi ho sakta — follow-up research shuru karein.',
      en: 'That part failed and cannot be restarted this way — start a follow-up task.'
    },
    noDirective: {
      ur: 'Agent to mil gaya, par instruction samajh nahi aayi — batayein us se kya karwana hai.',
      roman: 'Agent to mil gaya, par instruction samajh nahi aayi — batayein us se kya karwana hai.',
      en: 'The agent was found, but no instruction was understood — say what it should do.'
    },
    error: {
      ur: 'Instruction nahi bheji ja saki — dobara koshish karein.',
      roman: 'Instruction nahi bheji ja saki — dobara koshish karein.',
      en: 'The instruction could not be sent — please try again.'
    },
    noTask: {
      ur: 'Koi research chal nahi rahi — pehle research shuru karein.',
      roman: 'Koi research chal nahi rahi — pehle research shuru karein.',
      en: 'No research is running — start a research task first.'
    },
    sending: {
      ur: 'Bhej rahe hain…',
      roman: 'Bhej rahe hain…',
      en: 'Sending…'
    }
  };

  function confirmText(kind, lang) {
    var group = CONFIRM[kind] || CONFIRM.ok;
    return group[lang] || group.en;
  }

  function gapKind(gap) {
    if (gap === 'no-agent-reference' || gap === 'whole-task-guidance') {
      return 'noAgent';
    }
    if (gap === 'agent-not-found' || gap === 'no-agents-known') {
      return 'notFound';
    }
    if (gap === 'no-per-agent-pause-endpoint') return 'pauseGap';
    if (gap === 'agent-already-finished') return 'finishedGap';
    if (gap === 'completed-work-preserved') return 'redoDoneGap';
    if (gap === 'failed-part-cannot-redo-via-modify') return 'redoFailedGap';
    if (gap === 'no-directive') return 'noDirective';
    return 'error';
  }

  /* ------------------------------------------------------------------ */
  /* Backend calls (real endpoints only)                                 */
  /* ------------------------------------------------------------------ */

  function postModify(taskId, directive) {
    /* v59 (Piece 32 [11]): routed through the EnzoPollingFix transport — empty ids are refused with zero fetch calls. */
    if (window.__enzoGetTransport59) return window.__enzoGetTransport59().postTaskModify(taskId, directive);
    var fetchFn = getFetch();
    if (!fetchFn) {
      return Promise.reject(new Error('fetch is not available'));
    }
    return fetchFn(API_BASE + '/tasks/' + encodeURIComponent(taskId) + '/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: directive })
    }).then(function (resp) {
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
    });
  }

  function currentTaskIdFromMonitor() {
    var m = getMonitorOrOverride();
    if (!m) return currentTaskId;
    try {
      var st = (typeof m.getState === 'function') ? m.getState() : null;
      if (st && st.activeTaskId) return st.activeTaskId;
    } catch (e) { /* fall through */ }
    return currentTaskId;
  }

  function logAgentGuidance(taskId, parsed, result) {
    var m = getMonitorOrOverride();
    if (!m || typeof m.noteFrontendStep !== 'function') return null;
    var detail = 'Instruction: "' + parsed.raw + '"';
    if (parsed.directive) detail += ' Sent as: "' + parsed.directive + '".';
    if (parsed.agentRef && parsed.agentRef.agent_id) {
      detail += ' Agent: ' + (parsed.agentRef.subtask || parsed.agentRef.agent_id) + '.';
    }
    if (result && result.modified === false && result.clarification_question) {
      detail += ' Backend asked: "' + result.clarification_question + '"';
    } else if (result && result.message) {
      detail += ' Backend: "' + result.message + '"';
    }
    try {
      return m.noteFrontendStep({
        title: 'Guidance for one agent: ' + parsed.raw,
        detail: detail,
        kind: 'agent-guidance',
        taskId: taskId
      });
    } catch (e) { return null; }
  }

  /* Dispatch a parsed agent-targeted instruction. Rejects with an Error
     whose message is the gap id when nothing can be sent — so the caller
     can fall back to whole-task guidance on 'no-agent-target' and show
     the gap line otherwise. Never sends a call the backend cannot honour. */
  function applyAgentGuidance(text, taskId, agentsList) {
    var parsed = parseAgentGuidance(text, agentsList);
    if (!normText(text)) {
      return Promise.reject(new Error('empty'));
    }
    if (parsed.agentRef.kind === 'none') {
      return Promise.reject(new Error('no-agent-target'));
    }
    if (!parsed.routable) {
      setStatus(confirmText(gapKind(parsed.gap), parsed.lang) +
        (parsed.note ? ' (' + parsed.note + ')' : ''));
      var gapErr = new Error(parsed.gap || 'not-routable');
      gapErr.parsed = parsed;
      return Promise.reject(gapErr);
    }
    var id = taskId || currentTaskIdFromMonitor();
    if (!id) {
      setStatus(confirmText('noTask', parsed.lang));
      return Promise.reject(new Error('no-active-task'));
    }
    setStatus(confirmText('sending', parsed.lang));
    return postModify(id, parsed.directive).then(function (result) {
      logAgentGuidance(id, parsed, result);
      if (result && result.modified === false &&
          result.clarification_question) {
        setStatus(result.clarification_question);
      } else {
        setStatus(confirmText('ok', parsed.lang));
      }
      return { parsed: parsed, result: result };
    }, function (err) {
      var msg = (err && err.message) ? err.message : 'Task control failed.';
      setStatus(confirmText('error', parsed.lang) + ' (' + msg + ')');
      throw err;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mount / unmount                                                     */
  /* ------------------------------------------------------------------ */

  function onMonitorState() {
    refreshFromMonitor();
  }

  function onDocumentClick(e) {
    /* Defensive re-mount, mirroring 03: the panel is built once the
       monitor body exists, which happens when M2 mounts / the live
       view opens. mount() is idempotent, so repeated clicks are free. */
    if (!e || !e.target) return;
    var t = e.target;
    if (t.closest) {
      if (t.closest('#' + BUTTON_ID + ', #' + TOOLS_ENTRY_ID)) mount();
    } else if (t.id === BUTTON_ID || t.id === TOOLS_ENTRY_ID) {
      mount();
    }
  }

  function mount() {
    if (mounted && panelBuilt) return true;
    if (typeof document === 'undefined' || !document.body) return false;
    if (!buildPanel()) return false;
    var m = getMonitorOrOverride();
    if (m && typeof m.subscribe === 'function' && !subscribed) {
      try {
        onStateChange = onMonitorState;
        m.subscribe(onStateChange);
        subscribed = true;
      } catch (e) { subscribed = false; }
    }
    if (document.addEventListener && !mounted) {
      document.addEventListener('click', onDocumentClick);
    }
    refreshFromMonitor();
    mounted = true;
    return true;
  }

  function unmount() {
    var m = getMonitorOrOverride();
    if (m && typeof m.unsubscribe === 'function' && subscribed && onStateChange) {
      try { m.unsubscribe(onStateChange); } catch (e) { /* best-effort */ }
    }
    subscribed = false;
    onStateChange = null;
    if (document && document.removeEventListener) {
      document.removeEventListener('click', onDocumentClick);
    }
    var panel = $(PANEL_ID);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    els = {};
    panelBuilt = false;
    mounted = false;
    agents = {};
    agentOrder = [];
    currentTaskId = null;
  }

  var api = {
    mount: mount,
    unmount: unmount,
    render: render,
    ingestEvent: ingestEvent,
    applyProgress: applyProgress,
    fetchProgress: fetchProgress,
    refreshFromMonitor: refreshFromMonitor,
    parseAgentGuidance: parseAgentGuidance,
    applyAgentGuidance: applyAgentGuidance,
    splitTask: splitTask,
    spawnAgent: spawnAgent,
    spawnAgentsForParts: spawnAgentsForParts,
    runAgentsInParallel: runAgentsInParallel,
    assembleAgentResults: assembleAgentResults,
    runSplitParallelAssemble: runSplitParallelAssemble,
    getAgents: getAgents,
    detectLanguage: detectLanguage,
    confirmText: confirmText,
    setCurrentTaskId: function (id) { currentTaskId = id || null; },
    /* Test-only seams (not for production use): */
    _setFetchForTest: function (fn) { fetchFnOverride = fn || null; },
    _setMonitorForTest: function (m) { monitorOverride = m || null; },
    _resetForTest: function () {
      agents = {};
      agentOrder = [];
      currentTaskId = null;
      if (panelBuilt) render();
    }
  };

  try {
    if (typeof window !== 'undefined') window.EnzoAgents = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoAgents = api;
  } catch (e) { /* exposure is best-effort */ }

  function initEnzoAgents() {
    if (typeof document === 'undefined') return false;
    if (document.readyState === 'loading' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', function () { mount(); });
      return true;
    }
    return mount();
  }

  try {
    if (typeof window !== 'undefined') window.initEnzoAgents = initEnzoAgents;
    if (typeof globalThis !== 'undefined') globalThis.initEnzoAgents = initEnzoAgents;
  } catch (e) { /* ignore */ }

  initEnzoAgents();

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
