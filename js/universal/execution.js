
/* ============================================================================
   ENAO AI universal-intel — PIECE 15: Universal task execution
   File: 15-execution.js  (AUDIT.md sections 6 + 12, piece C2)
   Artifact: enao-ai (web_static). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
   Piece build only. Backend: none — frontend piece only, no new endpoint.

   PURPOSE
   -------
   Root cause 6 in AUDIT.md: agents exist for research only and website
   builds have their own flow (08); any other multi-step task (write +
   verify + deliver a report, analyse a file + build a dashboard) has
   no planner, no stage tracking, no dependency handling. Root cause 9
   (no systematic error recovery) is covered here too, for the
   execution side: errors are classified, safe retries are capped, and
   anything else aborts or escalates instead of looping forever.
   This piece is the general planner + executor: a plan is stages with
   dependencies, an executor is a small state machine
   (pending -> running -> done / failed / paused), and every stage
   runs through runStage with its result checked — a stage is never
   marked done for instructions alone.

   PLAN SHAPE
   ----------
   createPlan(task, ctx) builds { task, kind, stages, createdAt }.
   When ctx carries an orchestration plan, its stages are REUSED, not
   rebuilt: the 06-agents / backend shape ({ parts: [{ subtask }] } or
   { subtasks: [...] }) becomes chained stages plus a final
   assemble/deliver stage, and the 13-orchestration shape
   (planStages() stages array, or { stages: [...] }) is kept as-is
   with its real dependsOn graph preserved. Otherwise stages come
   from the request kind (research / build / write / file / monitor /
   agents / answer / default), each stage depending on the previous
   one.
   A stage is { id, title, dependsOn, status, attempts, maxAttempts,
   result, error }. Status values: pending | running | done | failed |
   paused. Nothing else is ever written into status.

   NO FAKE COMPLETION (the rule this piece exists to enforce)
   ----------------------------------------------------------
   runStage marks a stage done ONLY when the injected work function
   returns a real result: a non-empty value. Returning undefined,
   null, an empty string, or an object with completed === false or
   instructionsOnly === true is treated as "no result" — the stage is
   marked failed with error 'empty-result' and is NOT marked done.
   The work function itself is injected by the caller (fn callbacks);
   this piece never fetches, never touches the DOM, never invents a
   result. A prose string that merely tells the user what to do
   cannot be detected as instructions by this check — that limit is
   stated honestly in the EVIDENCE file; callers that can tell
   instructions from output should return { instructionsOnly: true }.

   ERROR HANDLING
   --------------
   handleStageError classifies the error message:
     transient  timeout / network / rate limit / 429 / 503 / temporary
     permanent  not found / 404 / invalid / validation / permission /
                denied / forbidden / unsupported / 401 / 403
     unknown    everything else
   Decisions: transient + attempts left -> retry (safe retry only,
   attempt cap MAX_ATTEMPTS = 3 per stage); transient with no attempts
   left -> escalate; permanent -> abort; unknown -> escalate.
   'retry' keeps the executor running, 'abort' fails it, 'escalate'
   pauses it for a human decision. The cap is per stage and is never
   reset by a retry.

   VALIDATION
   ----------
   validateStageResult delegates to window/globalThis
   EnzoUniversalValidation when it is present (piece 17, not yet
   built at the time of this piece — the delegation is guarded and
   the builtin check runs when it is absent). The builtin check is
   basic completeness: result present and non-empty, and every field
   in stage.expects present on an object result.

   PROGRESS
   --------
   taskSummary returns real progress only: stages done / total as
   counts and the text "N of M stages done". No percentages are ever
   computed or returned anywhere in this piece.

   PUBLIC API (pure functions; fn callbacks injected by the caller)
   ----------------------------------------------------------------
   createPlan(task, ctx) -> plan
   createExecutor(plan) -> executor
   runStage(executor, stage, fn) -> { ok, stage, result } or
     { ok: false, reason | error, decision } (a Promise when fn
     returns a thenable; the stage stays running until it settles)
   handleStageError(executor, stage, error) -> { action, classification,
     reason, attemptsLeft, attempts }
   validateStageResult(stage, result) -> { valid, missing, checkedBy,
     reasons }
   taskSummary(executor) -> { state, total, done, failed, running,
     pending, paused, progressText, stages }
   pauseExecutor(executor) / resumeExecutor(executor) -> executor state

   STYLE: plain ES5, var + function declarations, no modules, zero
   emojis, no hardcoded topic names, no network, no DOM.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '15-execution v1.0 (enao-universal-intel, 22 Nov 2026)';
  var MAX_ATTEMPTS = 3;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function root() {
    if (typeof window !== 'undefined') return window;
    return (typeof globalThis !== 'undefined') ? globalThis : this;
  }

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function trim(s) {
    return asString(s).replace(/^\s+|\s+$/g, '');
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function cloneArray(a) {
    var out = [], i;
    if (!Array.isArray(a)) return out;
    for (i = 0; i < a.length; i++) out.push(a[i]);
    return out;
  }

  function lower(s) {
    return asString(s).toLowerCase();
  }

  /* ------------------------------------------------------------------ */
  /* Stage templates by request kind                                     */
  /* ------------------------------------------------------------------ */

  var STAGE_TEMPLATES = {
    research: ['Plan the research', 'Gather sources', 'Verify facts', 'Assemble the report', 'Deliver the result'],
    build: ['Think through the request', 'Research what is needed', 'Ask what is missing', 'Build it', 'Validate the result', 'Deliver the result'],
    write: ['Outline the piece', 'Draft it', 'Verify the facts', 'Deliver the result'],
    file: ['Read the file', 'Analyse the contents', 'Deliver the result'],
    monitor: ['Open the live view', 'Track progress', 'Deliver the result'],
    agents: ['Split into parts', 'Run agents in parallel', 'Assemble the results', 'Deliver the result'],
    answer: ['Answer the request', 'Deliver the result'],
    default: ['Plan the work', 'Execute the work', 'Verify the result', 'Deliver the result']
  };

  function kindOf(task, ctx) {
    if (ctx && trim(ctx.kind)) return lower(ctx.kind);
    if (isPlainObject(task) && trim(task.kind)) return lower(task.kind);
    return 'default';
  }

  function textOf(task) {
    if (typeof task === 'string') return task;
    if (isPlainObject(task)) return asString(task.text || task.title || task.command || '');
    return '';
  }

  function newStage(id, title, dependsOn, expects) {
    return {
      id: id,
      title: title,
      dependsOn: cloneArray(dependsOn || []),
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      result: null,
      error: null,
      expects: cloneArray(expects || [])
    };
  }

  function stagesFromTitles(titles) {
    var stages = [], i, deps;
    for (i = 0; i < titles.length; i++) {
      deps = i === 0 ? [] : ['stage-' + i];
      stages.push(newStage('stage-' + (i + 1), titles[i], deps));
    }
    return stages;
  }

  /* Reuse an orchestration plan when one is present. Two shapes are
     accepted, both real:
     (a) the 06-agents / backend shape: { parts: [{ subtask | title }] }
         or { subtasks: [...] } — each part becomes one stage in order,
         depending on the previous stage, plus a final assemble/deliver
         stage (matching what 06-agents assembleAgentResults does).
     (b) the 13-orchestration shape: planStages() returns a stages
         ARRAY of { id, name, capability, dependsOn, level } — passed
         either as the array itself or as { stages: [...] }. Those
         stages are kept as-is, with their real dependsOn graph
         preserved (parallel levels survive), and NO assemble stage is
         appended: a 13 plan is already complete. */
  function stagesFromOrchestrationPlan(plan) {
    var entries = null;
    var complete = false;
    if (Array.isArray(plan)) {
      entries = plan;
      complete = true;
    } else if (isPlainObject(plan)) {
      if (Array.isArray(plan.stages)) {
        entries = plan.stages;
        complete = true;
      } else if (Array.isArray(plan.parts)) {
        entries = plan.parts;
      } else if (Array.isArray(plan.subtasks)) {
        entries = plan.subtasks;
      }
    }
    if (!entries || entries.length === 0) return null;
    var picked = [], ids = {}, i, j, title, id;
    for (i = 0; i < entries.length; i++) {
      if (typeof entries[i] === 'string') title = entries[i];
      else if (isPlainObject(entries[i])) {
        title = asString(entries[i].subtask || entries[i].title || entries[i].name || entries[i].part || '');
      } else title = '';
      if (!trim(title)) title = 'Part ' + (i + 1);
      id = (isPlainObject(entries[i]) && trim(entries[i].id))
        ? trim(entries[i].id) : 'stage-' + (i + 1);
      ids[id] = true;
      picked.push({ entry: entries[i], id: id, title: title });
    }
    var stages = [], deps;
    for (i = 0; i < picked.length; i++) {
      deps = null;
      var e = picked[i].entry;
      if (isPlainObject(e) && Array.isArray(e.dependsOn) && e.dependsOn.length > 0) {
        deps = [];
        for (j = 0; j < e.dependsOn.length; j++) {
          if (ids[e.dependsOn[j]]) deps.push(e.dependsOn[j]);
        }
        if (deps.length === 0) deps = null;
      }
      if (deps === null) deps = i === 0 ? [] : [picked[i - 1].id];
      stages.push(newStage(picked[i].id, picked[i].title, deps));
    }
    if (!complete) {
      stages.push(newStage('stage-' + (stages.length + 1),
        'Assemble and deliver the result', [stages[stages.length - 1].id]));
    }
    return stages;
  }

  /* ------------------------------------------------------------------ */
  /* createPlan                                                          */
  /* ------------------------------------------------------------------ */

  function createPlan(task, ctx) {
    var kind = kindOf(task, ctx);
    var text = textOf(task);
    var stages = null;

    if (ctx && (isPlainObject(ctx.orchestrationPlan) || Array.isArray(ctx.orchestrationPlan))) {
      stages = stagesFromOrchestrationPlan(ctx.orchestrationPlan);
    }
    if (!stages && ctx && Array.isArray(ctx.stages) && ctx.stages.length > 0) {
      stages = stagesFromTitles(ctx.stages.map(function (s) {
        return typeof s === 'string' ? s : asString(s.title || s.name || '');
      }));
    }
    if (!stages) {
      var titles = STAGE_TEMPLATES[kind] || STAGE_TEMPLATES.default;
      stages = stagesFromTitles(titles);
    }

    return {
      task: text,
      kind: kind,
      stages: stages,
      createdAt: new Date().toISOString()
    };
  }

  /* ------------------------------------------------------------------ */
  /* Executor (state machine)                                            */
  /* ------------------------------------------------------------------ */

  function createExecutor(plan) {
    var p = plan || createPlan('', {});
    return {
      plan: p,
      state: 'pending',
      currentStageId: null,
      startedAt: null,
      finishedAt: null,
      log: []
    };
  }

  function findStage(executor, stageId) {
    var stages = executor.plan.stages || [];
    var i;
    for (i = 0; i < stages.length; i++) {
      if (stages[i].id === stageId) return stages[i];
    }
    return null;
  }

  function logEvent(executor, message) {
    executor.log.push({ at: new Date().toISOString(), message: message });
  }

  function allStagesDone(executor) {
    var stages = executor.plan.stages || [];
    var i;
    if (stages.length === 0) return false;
    for (i = 0; i < stages.length; i++) {
      if (stages[i].status !== 'done') return false;
    }
    return true;
  }

  function pauseExecutor(executor) {
    if (!executor) return null;
    if (executor.state === 'running') {
      executor.state = 'paused';
      logEvent(executor, 'Executor paused.');
    }
    return executor.state;
  }

  function resumeExecutor(executor) {
    if (!executor) return null;
    if (executor.state === 'paused') {
      executor.state = 'running';
      logEvent(executor, 'Executor resumed.');
    }
    return executor.state;
  }

  /* ------------------------------------------------------------------ */
  /* Result validation                                                   */
  /* ------------------------------------------------------------------ */

  function getValidation() {
    try {
      var w = root();
      if (w && w.EnzoUniversalValidation) return w.EnzoUniversalValidation;
    } catch (e) { /* no validation module present */ }
    return null;
  }

  function builtinValidate(stage, result) {
    var missing = [];
    var reasons = [];
    if (result === null || result === undefined) {
      return { valid: false, missing: ['result'], checkedBy: 'builtin',
        reasons: ['Stage produced no result.'] };
    }
    if (typeof result === 'string' && trim(result) === '') {
      return { valid: false, missing: ['result'], checkedBy: 'builtin',
        reasons: ['Stage produced an empty result.'] };
    }
    if (isPlainObject(result)) {
      if (result.completed === false) {
        return { valid: false, missing: ['completed'], checkedBy: 'builtin',
          reasons: ['Stage reported completed as false.'] };
      }
      if (result.instructionsOnly === true) {
        return { valid: false, missing: ['output'], checkedBy: 'builtin',
          reasons: ['Stage produced instructions only, no output.'] };
      }
      var expects = (stage && Array.isArray(stage.expects)) ? stage.expects : [];
      var i;
      for (i = 0; i < expects.length; i++) {
        if (result[expects[i]] === undefined || result[expects[i]] === null) {
          missing.push(expects[i]);
        }
      }
      if (missing.length > 0) {
        reasons.push('Missing expected field(s): ' + missing.join(', ') + '.');
        return { valid: false, missing: missing, checkedBy: 'builtin', reasons: reasons };
      }
    }
    return { valid: true, missing: [], checkedBy: 'builtin', reasons: [] };
  }

  function validateStageResult(stage, result) {
    var validation = getValidation();
    if (validation && typeof validation.validateStageResult === 'function') {
      try {
        var delegated = validation.validateStageResult(stage, result);
        if (isPlainObject(delegated)) {
          delegated.checkedBy = 'EnzoUniversalValidation';
          return delegated;
        }
      } catch (e) { /* fall through to the builtin check */ }
    }
    if (validation && typeof validation.validate === 'function') {
      try {
        var v2 = validation.validate(stage, result);
        if (isPlainObject(v2)) {
          v2.checkedBy = 'EnzoUniversalValidation';
          return v2;
        }
      } catch (e) { /* fall through to the builtin check */ }
    }
    return builtinValidate(stage, result);
  }

  /* ------------------------------------------------------------------ */
  /* Error classification + decision                                     */
  /* ------------------------------------------------------------------ */

  function classifyError(error) {
    var msg = lower(error && error.message ? error.message : asString(error));
    if (/timeout|timed out|network|fetch failed|failed to fetch|rate limit|too many requests|429|503|service unavailable|temporar|econn|eai_again|socket hang up/i.test(msg)) {
      return 'transient';
    }
    if (/not found|404|invalid|validation|permission|denied|forbidden|unsupported|unauthori|401|403|bad request|400/i.test(msg)) {
      return 'permanent';
    }
    return 'unknown';
  }

  function handleStageError(executor, stage, error) {
    var classification = classifyError(error);
    var message = error && error.message ? error.message : asString(error);
    var attempts = stage ? stage.attempts : 0;
    var maxAttempts = stage ? (stage.maxAttempts || MAX_ATTEMPTS) : MAX_ATTEMPTS;
    var attemptsLeft = Math.max(0, maxAttempts - attempts);
    var decision;

    if (classification === 'transient' && attemptsLeft > 0) {
      decision = { action: 'retry', classification: classification,
        reason: 'Transient error (' + message + '); safe to retry. ' + attemptsLeft + ' attempt(s) left.',
        attemptsLeft: attemptsLeft, attempts: attempts };
      if (stage) stage.status = 'pending';
      if (executor) logEvent(executor, 'Stage ' + (stage ? stage.id : '?') + ' failed transiently; retry queued.');
    } else if (classification === 'transient') {
      decision = { action: 'escalate', classification: classification,
        reason: 'Transient error (' + message + ') but no attempts left; needs a human decision.',
        attemptsLeft: 0, attempts: attempts };
      if (executor) {
        executor.state = 'paused';
        logEvent(executor, 'Stage ' + (stage ? stage.id : '?') + ' exhausted retries; executor paused.');
      }
    } else if (classification === 'permanent') {
      decision = { action: 'abort', classification: classification,
        reason: 'Permanent error (' + message + '); retrying will not help.',
        attemptsLeft: attemptsLeft, attempts: attempts };
      if (executor) {
        executor.state = 'failed';
        executor.finishedAt = new Date().toISOString();
        logEvent(executor, 'Stage ' + (stage ? stage.id : '?') + ' failed permanently; executor failed.');
      }
    } else {
      decision = { action: 'escalate', classification: classification,
        reason: 'Unclassified error (' + message + '); needs a human decision.',
        attemptsLeft: attemptsLeft, attempts: attempts };
      if (executor) {
        executor.state = 'paused';
        logEvent(executor, 'Stage ' + (stage ? stage.id : '?') + ' failed with an unclassified error; executor paused.');
      }
    }
    return decision;
  }

  /* ------------------------------------------------------------------ */
  /* runStage                                                            */
  /* ------------------------------------------------------------------ */

  function dependenciesDone(executor, stage) {
    var missing = [];
    var i, dep;
    for (i = 0; i < (stage.dependsOn || []).length; i++) {
      dep = findStage(executor, stage.dependsOn[i]);
      if (!dep || dep.status !== 'done') missing.push(stage.dependsOn[i]);
    }
    return missing;
  }

  function finishStageSuccess(executor, stage, result) {
    stage.result = result;
    stage.status = 'done';
    stage.error = null;
    executor.currentStageId = null;
    logEvent(executor, 'Stage ' + stage.id + ' done.');
    if (allStagesDone(executor)) {
      executor.state = 'done';
      executor.finishedAt = new Date().toISOString();
      logEvent(executor, 'All stages done.');
    }
    return { ok: true, stage: stage, result: result };
  }

  function finishStageFailure(executor, stage, error, reason) {
    stage.status = 'failed';
    stage.error = asString(error && error.message ? error.message : error);
    executor.currentStageId = null;
    logEvent(executor, 'Stage ' + stage.id + ' failed: ' + stage.error);
    var decision = handleStageError(executor, stage, error);
    return { ok: false, stage: stage, error: stage.error, reason: reason || 'stage-error', decision: decision };
  }

  function isThenable(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function') &&
      typeof v.then === 'function';
  }

  function runStage(executor, stage, fn) {
    if (!executor || !stage) {
      return { ok: false, reason: 'missing-executor-or-stage' };
    }
    if (executor.state === 'done' || executor.state === 'failed') {
      return { ok: false, reason: 'executor-finished', state: executor.state };
    }
    if (executor.state === 'paused') {
      return { ok: false, reason: 'executor-paused' };
    }
    if (stage.status === 'done') {
      return { ok: false, reason: 'already-done', stage: stage };
    }
    if (stage.status === 'running') {
      return { ok: false, reason: 'already-running', stage: stage };
    }
    var missingDeps = dependenciesDone(executor, stage);
    if (missingDeps.length > 0) {
      return { ok: false, reason: 'dependency-not-done', missing: missingDeps, stage: stage };
    }
    if (typeof fn !== 'function') {
      return { ok: false, reason: 'no-work-function', stage: stage };
    }

    if (executor.state === 'pending') {
      executor.state = 'running';
      executor.startedAt = new Date().toISOString();
    }
    stage.status = 'running';
    stage.attempts += 1;
    stage.error = null;
    executor.currentStageId = stage.id;
    logEvent(executor, 'Stage ' + stage.id + ' started (attempt ' + stage.attempts + ').');

    var result;
    try {
      result = fn(stage, executor);
    } catch (e) {
      return finishStageFailure(executor, stage, e, 'stage-error');
    }

    /* Async work: the stage stays running until the promise settles;
       it is never marked done on the promise alone. */
    if (isThenable(result)) {
      var self = { executor: executor, stage: stage };
      return result.then(function (value) {
        var check = validateStageResult(self.stage, value);
        if (!check.valid) {
          return finishStageFailure(self.executor, self.stage,
            new Error('Stage produced an incomplete result: ' + check.reasons.join(' ')), 'empty-result');
        }
        return finishStageSuccess(self.executor, self.stage, value);
      }, function (err) {
        return finishStageFailure(self.executor, self.stage, err, 'stage-error');
      });
    }

    var check = validateStageResult(stage, result);
    if (!check.valid) {
      return finishStageFailure(executor, stage,
        new Error('Stage produced an incomplete result: ' + check.reasons.join(' ')), 'empty-result');
    }
    return finishStageSuccess(executor, stage, result);
  }

  /* ------------------------------------------------------------------ */
  /* taskSummary — real progress only, never percentages                 */
  /* ------------------------------------------------------------------ */

  function taskSummary(executor) {
    var stages = (executor && executor.plan && executor.plan.stages) || [];
    var done = 0, failed = 0, running = 0, pending = 0, paused = 0, i;
    var stageList = [];
    for (i = 0; i < stages.length; i++) {
      if (stages[i].status === 'done') done += 1;
      else if (stages[i].status === 'failed') failed += 1;
      else if (stages[i].status === 'running') running += 1;
      else if (stages[i].status === 'paused') paused += 1;
      else pending += 1;
      stageList.push({ id: stages[i].id, title: stages[i].title, status: stages[i].status });
    }
    return {
      state: executor ? executor.state : 'unknown',
      total: stages.length,
      done: done,
      failed: failed,
      running: running,
      pending: pending,
      paused: paused,
      progressText: done + ' of ' + stages.length + ' stages done',
      stages: stageList
    };
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    createPlan: createPlan,
    createExecutor: createExecutor,
    runStage: runStage,
    handleStageError: handleStageError,
    validateStageResult: validateStageResult,
    taskSummary: taskSummary,
    pauseExecutor: pauseExecutor,
    resumeExecutor: resumeExecutor
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalExecution = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalExecution = api;
  } catch (e) { /* exposure is best-effort */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
