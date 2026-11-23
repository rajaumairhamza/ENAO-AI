
/* ============================================================================
 * ENAO AI — Universal Intelligence Engine, piece F1 (20-errors.js)
 * Section 12: universal error detection + self-correction.
 *
 * What this piece does:
 *  - classifyError(error, ctx): puts any failure into ONE of nine
 *    classes (wrong-interpretation | failed-tool | irrelevant-result |
 *    missing-info | execution-failure | invalid-output |
 *    conflicting-instructions | incomplete-result |
 *    unexpected-behaviour). The class comes from an explicit kind
 *    field when present, otherwise from caller flags in ctx, otherwise
 *    from the error message / HTTP status. Nothing here names a
 *    subject: the same rules apply to any request.
 *  - diagnose(error, ctx): the likely cause as data {errorClass,
 *    cause, evidence}. Evidence lists only facts actually present in
 *    the inputs (status, message excerpt, stage, tool name, attempt);
 *    nothing is invented.
 *  - recoveryPlan(error, ctx): what to do next — one of
 *    'retry-safe' | 'retry-unsafe' | 'abort' | 'escalate-to-user' —
 *    with an attempt cap (default 3 attempts, never more than 5),
 *    an idempotency note, and downgrade: false always. A task is
 *    NEVER silently downgraded: when the caller asks to skip a check
 *    that failed, the plan escalates instead and says so.
 *  - retrySafe(error, ctx): true only when a retry cannot repeat a
 *    harmful side effect and could plausibly help. False for
 *    non-idempotent side effects (payment / send / delete / publish)
 *    that may already have happened, for failures that need new
 *    information or a user decision, for permanent tool errors, and
 *    once the attempt cap is reached.
 *  - honestErrorMessage(error, ctx, lang): ONE honest sentence in
 *    the user's language ('en' | 'roman' | 'ur') stating what failed
 *    and what happens next. Never a bare dead-end, never a fabricated
 *    detail (no invented counts, codes, or causes).
 *
 * What it does NOT do:
 *  - No retrying itself: it only DECIDES. The caller (orchestrator /
 *    askQuestion) performs the retry, the abort, or the ask-the-user
 *    step, using the plan this piece returns.
 *  - No network, no DOM, no dependencies. Pure functions only.
 *
 * Style: plain ES5, var + function declarations, no modules.
 * Zero emojis. No hardcoded topic names.
 * ========================================================================== */
(function (root) {

var VERSION = '20-errors v1.0 (enao-universal-intel, 22 Nov 2026)';

/* The nine error classes, in the order classification prefers them
   when several signals are present at once. */
var ERROR_CLASSES = [
  'wrong-interpretation',
  'failed-tool',
  'irrelevant-result',
  'missing-info',
  'execution-failure',
  'invalid-output',
  'conflicting-instructions',
  'incomplete-result',
  'unexpected-behaviour'
];

var MAX_ATTEMPTS_DEFAULT = 3;
var MAX_ATTEMPTS_HARD_CAP = 5;

/* Side effects that must never be repeated blindly: repeating them
   could charge twice, send twice, delete, or publish twice. */
var UNSAFE_SIDE_EFFECTS = [
  'payment', 'pay', 'purchase', 'transfer', 'send', 'message',
  'delete', 'publish', 'post', 'charge'
];

/* Permanent tool failures: retrying the same call cannot help. */
var PERMANENT_TOOL_STATUSES = [400, 401, 403, 404, 405, 410, 422];

/* ---------- small helpers ---------- */
function errTrim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '');
}
function errLower(s) {
  return String(s || '').toLowerCase();
}
function errIsPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function errClip(s, max) {
  var t = errTrim(s);
  if (t.length <= max) return t;
  return t.slice(0, max) + '...';
}
function errInList(list, value) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

/* Normalise whatever the caller hands over (Error, string, object,
   null) into {kind, code, status, message}. Missing fields stay null
   so diagnose() never invents them. */
function errNormalise(error) {
  var out = { kind: null, code: null, status: null, message: '' };
  if (error === null || error === undefined) return out;
  if (typeof error === 'string') {
    out.message = error;
    return out;
  }
  if (error instanceof Error) {
    out.message = error.message || '';
    if (typeof error.code !== 'undefined') out.code = error.code;
    if (typeof error.status !== 'undefined') out.status = error.status;
    if (typeof error.kind === 'string') out.kind = error.kind;
    return out;
  }
  if (errIsPlainObject(error)) {
    if (typeof error.kind === 'string') out.kind = error.kind;
    else if (typeof error.errorClass === 'string') out.kind = error.errorClass;
    else if (typeof error.type === 'string') out.kind = error.type;
    if (typeof error.code !== 'undefined') out.code = error.code;
    if (typeof error.status === 'number') out.status = error.status;
    else if (typeof error.statusCode === 'number') out.status = error.statusCode;
    else if (typeof error.httpStatus === 'number') out.status = error.httpStatus;
    if (typeof error.message === 'string') out.message = error.message;
    else if (typeof error.error === 'string') out.message = error.error;
    return out;
  }
  out.message = String(error);
  return out;
}

function errAttemptsUsed(ctx) {
  if (!ctx) return 0;
  var n = ctx.attempt;
  if (typeof n !== 'number') n = ctx.attempts;
  if (typeof n !== 'number' || isNaN(n) || n < 0) return 0;
  return Math.floor(n);
}
function errMaxAttempts(ctx) {
  var m = MAX_ATTEMPTS_DEFAULT;
  if (ctx && typeof ctx.maxAttempts === 'number' && !isNaN(ctx.maxAttempts)) {
    m = Math.floor(ctx.maxAttempts);
  }
  if (m < 1) m = 1;
  if (m > MAX_ATTEMPTS_HARD_CAP) m = MAX_ATTEMPTS_HARD_CAP;
  return m;
}
function errStatusOf(error, ctx) {
  var n = errNormalise(error);
  if (typeof n.status === 'number') return n.status;
  if (ctx && typeof ctx.status === 'number') return ctx.status;
  if (ctx && typeof ctx.statusCode === 'number') return ctx.statusCode;
  return null;
}

/* True when a retry could repeat a harmful side effect: a
   non-idempotent unsafe side effect, or a step that may already have
   happened, without an idempotency key / idempotent flag. */
function errSideEffectRisk(ctx) {
  var c = ctx || {};
  var side = errLower(c.sideEffect || '');
  var idempotent = c.idempotent === true ||
    (typeof c.idempotencyKey === 'string' && errTrim(c.idempotencyKey) !== '');
  if (side && errInList(UNSAFE_SIDE_EFFECTS, side) && !idempotent) {
    return true;
  }
  if ((c.sideEffectPerformed === true || c.possiblyCompleted === true) &&
      !idempotent) {
    return true;
  }
  return false;
}

/* ---------- PUBLIC: classifyError ---------- */
/* Explicit kind wins. Then caller flags in ctx (the caller knows
   things a message cannot say: the result was irrelevant, a field is
   missing, the instructions conflict). Then message patterns, in
   priority order. Then HTTP status. Then the stage the caller
   reports. Anything else is unexpected-behaviour — an honest
   admission, not a guess at a more specific class. */
function classifyError(error, ctx) {
  var n = errNormalise(error);
  var c = ctx || {};
  var msg = errLower(n.message);
  var code = errLower(n.code === null || n.code === undefined ? '' : n.code);

  if (n.kind && errInList(ERROR_CLASSES, n.kind)) return n.kind;
  if (n.kind && errInList(ERROR_CLASSES, errLower(n.kind))) {
    return errLower(n.kind);
  }

  /* Caller flags (strongest non-explicit signal). */
  if (c.conflictingInstructions === true) return 'conflicting-instructions';
  if (c.missingInfo === true || c.missingFields) return 'missing-info';
  if (c.misunderstood === true || c.wrongInterpretation === true) {
    return 'wrong-interpretation';
  }
  if (c.resultRelevant === false) return 'irrelevant-result';
  if (c.outputInvalid === true || c.outputValid === false) {
    return 'invalid-output';
  }
  if (c.incomplete === true || c.resultIncomplete === true) {
    return 'incomplete-result';
  }
  if (c.toolFailed === true || c.toolError === true) return 'failed-tool';

  /* Message patterns, most specific first. */
  if (msg.indexOf('conflicting instruction') !== -1 ||
      msg.indexOf('contradictory instruction') !== -1 ||
      msg.indexOf('instructions conflict') !== -1 ||
      msg.indexOf('conflict between') !== -1) {
    return 'conflicting-instructions';
  }
  if (msg.indexOf('missing information') !== -1 ||
      msg.indexOf('missing required') !== -1 ||
      msg.indexOf('not enough information') !== -1 ||
      msg.indexOf('need more information') !== -1 ||
      msg.indexOf('information is missing') !== -1) {
    return 'missing-info';
  }
  if (msg.indexOf('invalid json') !== -1 ||
      msg.indexOf('invalid output') !== -1 ||
      msg.indexOf('malformed') !== -1 ||
      msg.indexOf('failed validation') !== -1 ||
      msg.indexOf('validation failed') !== -1 ||
      msg.indexOf('parse error') !== -1 ||
      msg.indexOf('syntax error') !== -1 ||
      msg.indexOf('unexpected token') !== -1) {
    return 'invalid-output';
  }
  if (msg.indexOf('incomplete') !== -1 ||
      msg.indexOf('truncated') !== -1 ||
      msg.indexOf('partial result') !== -1 ||
      msg.indexOf('cut off') !== -1 ||
      msg.indexOf('only part of') !== -1) {
    return 'incomplete-result';
  }
  if (msg.indexOf('irrelevant') !== -1 ||
      msg.indexOf('off-topic') !== -1 ||
      msg.indexOf('does not answer') !== -1 ||
      msg.indexOf("doesn't answer") !== -1 ||
      msg.indexOf('not relevant') !== -1 ||
      msg.indexOf('unrelated to') !== -1) {
    return 'irrelevant-result';
  }
  if (msg.indexOf('misunderstood') !== -1 ||
      msg.indexOf('misinterpret') !== -1 ||
      msg.indexOf('wrong interpretation') !== -1 ||
      msg.indexOf('not what you asked') !== -1 ||
      msg.indexOf('not what i asked') !== -1) {
    return 'wrong-interpretation';
  }
  if (msg.indexOf('tool failed') !== -1 ||
      msg.indexOf('tool error') !== -1 ||
      msg.indexOf('tool timed out') !== -1 ||
      msg.indexOf('tool unavailable') !== -1 ||
      msg.indexOf('fetch failed') !== -1 ||
      msg.indexOf('network error') !== -1 ||
      msg.indexOf('failed to fetch') !== -1 ||
      msg.indexOf('timed out') !== -1 ||
      msg.indexOf('timeout') !== -1 ||
      msg.indexOf('service unavailable') !== -1 ||
      msg.indexOf('too many requests') !== -1 ||
      code.indexOf('timeout') !== -1 ||
      code.indexOf('econn') !== -1 ||
      code.indexOf('enotfound') !== -1) {
    return 'failed-tool';
  }
  if (msg.indexOf('execution failed') !== -1 ||
      msg.indexOf('failed to run') !== -1 ||
      msg.indexOf('failed to execute') !== -1 ||
      msg.indexOf('crashed') !== -1 ||
      msg.indexOf('exception') !== -1) {
    return 'execution-failure';
  }
  if (msg.indexOf('ambiguous') !== -1 ||
      msg.indexOf('unclear') !== -1 ||
      msg.indexOf('not clear what') !== -1) {
    return 'missing-info';
  }

  /* HTTP status, when nothing else spoke. The status may arrive on
     the error itself or in ctx (the caller often holds it). */
  var st = (typeof n.status === 'number') ? n.status
    : ((c && typeof c.status === 'number') ? c.status : null);
  if (typeof st === 'number') {
    if (st === 422) return 'missing-info';
    if (st === 400) return 'invalid-output';
    if (st === 408 || st === 429 ||
        (st >= 500 && st < 600)) return 'failed-tool';
    if (st === 401 || st === 403 || st === 404) {
      return 'failed-tool';
    }
  }

  /* Stage the caller reports. */
  if (c.stage === 'tool' || c.stage === 'search' || c.stage === 'fetch') {
    return 'failed-tool';
  }
  if (c.stage === 'validation' || c.stage === 'parse') {
    return 'invalid-output';
  }
  if (c.stage === 'interpretation' || c.stage === 'understanding') {
    return 'wrong-interpretation';
  }
  if (c.stage === 'execution' || c.stage === 'run') {
    return 'execution-failure';
  }

  return 'unexpected-behaviour';
}

/* ---------- PUBLIC: diagnose ---------- */
/* Likely cause as data. 'cause' is a short machine-readable token;
   'evidence' lists only facts actually present in the inputs, so a
   caller can show the user (or log) exactly what the diagnosis rests
   on. Nothing is invented: an unknown cause is reported as
   'unknown-cause' with whatever evidence exists (possibly none). */
function diagnose(error, ctx) {
  var n = errNormalise(error);
  var c = ctx || {};
  var cls = classifyError(error, ctx);
  var cause = 'unknown-cause';
  var evidence = [];

  if (errTrim(n.message)) {
    evidence.push('message: "' + errClip(n.message, 120) + '"');
  }
  if (typeof n.status === 'number') {
    evidence.push('status: ' + n.status);
  }
  if (n.code !== null && n.code !== undefined && String(n.code) !== '') {
    evidence.push('code: ' + String(n.code));
  }
  if (typeof c.tool === 'string' && errTrim(c.tool)) {
    evidence.push('tool: ' + errTrim(c.tool));
  }
  if (typeof c.stage === 'string' && errTrim(c.stage)) {
    evidence.push('stage: ' + errTrim(c.stage));
  }
  if (typeof c.attempt === 'number') {
    evidence.push('attempt: ' + c.attempt);
  }
  if (Array.isArray(c.missingFields) && c.missingFields.length > 0) {
    evidence.push('missing fields: ' + c.missingFields.join(', '));
  }

  var msg = errLower(n.message);
  if (cls === 'conflicting-instructions') {
    cause = 'instructions-contradict-each-other';
  } else if (cls === 'missing-info') {
    cause = 'required-information-absent';
  } else if (cls === 'wrong-interpretation') {
    cause = 'request-ambiguous-or-misread';
  } else if (cls === 'irrelevant-result') {
    cause = 'result-does-not-match-request';
  } else if (cls === 'invalid-output') {
    if (msg.indexOf('parse error') !== -1 ||
        msg.indexOf('invalid json') !== -1 ||
        msg.indexOf('unexpected token') !== -1 ||
        msg.indexOf('syntax error') !== -1) {
      cause = 'output-unparseable';
    } else {
      cause = 'output-failed-validation';
    }
  } else if (cls === 'incomplete-result') {
    cause = 'result-truncated-or-partial';
  } else if (cls === 'failed-tool') {
    if (msg.indexOf('timed out') !== -1 || msg.indexOf('timeout') !== -1 ||
        (typeof n.status === 'number' && (n.status === 408 || n.status === 504))) {
      cause = 'tool-timeout';
    } else if (typeof n.status === 'number' && n.status === 429) {
      cause = 'tool-rate-limited';
    } else if (typeof n.status === 'number' && n.status >= 500) {
      cause = 'tool-http-5xx';
    } else if (typeof n.status === 'number' &&
               (n.status === 401 || n.status === 403)) {
      cause = 'tool-permission-denied';
    } else if (typeof n.status === 'number' && n.status === 404) {
      cause = 'tool-not-found';
    } else if (msg.indexOf('network') !== -1 ||
               msg.indexOf('fetch failed') !== -1 ||
               msg.indexOf('failed to fetch') !== -1) {
      cause = 'tool-network-error';
    } else {
      cause = 'tool-error';
    }
  } else if (cls === 'execution-failure') {
    if (msg.indexOf('crashed') !== -1) cause = 'step-crashed';
    else cause = 'step-threw-exception';
  }
  /* unexpected-behaviour keeps 'unknown-cause' by design. */

  return { errorClass: cls, cause: cause, evidence: evidence };
}

/* ---------- PUBLIC: retrySafe ---------- */
/* True only when a retry (a) cannot repeat a harmful side effect and
   (b) could plausibly help. False when:
   - the attempt cap is already reached;
   - a non-idempotent side effect (payment / send / delete / publish
     ...) may already have happened — repeating it could double it;
   - the failure needs new information or a user decision first
     (missing-info, conflicting-instructions, wrong-interpretation
     without a clarified input);
   - the tool failure is permanent (401 / 403 / 404 and friends);
   - the cause is unknown (unexpected-behaviour) and the caller has
     not flagged it transient.
   A retry that is merely useless (same input, same result) is also
   refused: retrying must have a new input, a new attempt, or a
   transient cause behind it. */
function retrySafe(error, ctx) {
  var c = ctx || {};
  var cls = classifyError(error, ctx);
  var used = errAttemptsUsed(ctx);
  var max = errMaxAttempts(ctx);
  if (used >= max) return false;

  /* Non-idempotent side effect that may already have happened. */
  var side = errLower(c.sideEffect || '');
  var idempotent = c.idempotent === true ||
    (typeof c.idempotencyKey === 'string' && errTrim(c.idempotencyKey) !== '');
  if (side && errInList(UNSAFE_SIDE_EFFECTS, side) && !idempotent) {
    return false;
  }
  if ((c.sideEffectPerformed === true || c.possiblyCompleted === true) &&
      !idempotent) {
    return false;
  }

  var status = errStatusOf(error, ctx);
  if (cls === 'failed-tool' && typeof status === 'number' &&
      errInList(PERMANENT_TOOL_STATUSES, status)) {
    return false;
  }
  if (cls === 'conflicting-instructions' && c.conflictResolved !== true) {
    return false;
  }
  if (cls === 'missing-info' && c.missingInfoProvided !== true) {
    return false;
  }
  if (cls === 'wrong-interpretation' && c.clarifiedInput !== true) {
    return false;
  }
  if (cls === 'irrelevant-result' && c.refinedInput !== true &&
      c.clarifiedInput !== true) {
    return false;
  }
  if (cls === 'execution-failure' && c.transient === false) {
    return false;
  }
  if (cls === 'unexpected-behaviour' && c.transient !== true) {
    return false;
  }
  return true;
}

/* ---------- PUBLIC: recoveryPlan ---------- */
/* One decision, with the numbers behind it. Decisions:
   - 'retry-safe': retry now (same call, or with the clarified /
     refined input the caller supplies). attemptsLeft > 0.
   - 'retry-unsafe': do NOT retry blindly — the step may already have
     partly happened. Verify what actually happened first, then ask
     the user. Never auto-retried.
   - 'abort': stop this step. The failure cannot be fixed by retrying
     (tool gone, step cannot run) and no user input can fix it here.
   - 'escalate-to-user': stop and ask the user (missing detail,
     contradictory instructions, permission problem, attempts
     exhausted). The user decides.
   downgrade is ALWAYS false: this piece never proposes dropping a
   check, a validation, or a required step to "make it work". When
   the caller asks for a downgrade (ctx.requestedDowngrade), the plan
   escalates and records downgradeRefused: true. */
function recoveryPlan(error, ctx) {
  var c = ctx || {};
  var diag = diagnose(error, ctx);
  var cls = diag.errorClass;
  var used = errAttemptsUsed(ctx);
  var max = errMaxAttempts(ctx);
  var left = max - used;
  if (left < 0) left = 0;
  var safe = retrySafe(error, ctx);
  var status = errStatusOf(error, ctx);
  var sideRisk = errSideEffectRisk(ctx);
  var downgradeRefused = c.requestedDowngrade === true;
  var decision = 'escalate-to-user';
  var reason = 'needs-user-decision';
  var nextStep = 'Ask the user what to do next.';

  if (downgradeRefused) {
    decision = 'escalate-to-user';
    reason = 'downgrade-refused';
    nextStep = 'Do not skip the failed check. Ask the user how to proceed.';
  } else if (cls === 'failed-tool' && typeof status === 'number' &&
             status === 404) {
    decision = 'abort';
    reason = 'tool-not-found';
    nextStep = 'Stop this step. The tool is not available; do not retry it.';
  } else if (cls === 'execution-failure' && c.transient === false) {
    decision = 'abort';
    reason = 'step-cannot-run';
    nextStep = 'Stop this step. It cannot run as requested; do not retry it.';
  } else if (sideRisk && left > 0) {
    /* A retry could repeat a harmful side effect, whatever the error
       class is. Never auto-retry: verify first, then ask the user.
       (A 404 or a non-transient failure aborts above this branch:
       when the tool is gone or the step cannot run, there is
       nothing to retry at all.) */
    decision = 'retry-unsafe';
    reason = 'retry-could-repeat-side-effect';
    nextStep = 'Do not retry yet. First verify what already happened, then ask the user.';
  } else if (safe && left > 0) {
    decision = 'retry-safe';
    reason = 'transient-or-repairable';
    if (cls === 'irrelevant-result' || cls === 'wrong-interpretation') {
      nextStep = 'Retry with the clarified request.';
    } else if (cls === 'incomplete-result') {
      nextStep = 'Retry to get the missing part of the result.';
    } else if (cls === 'invalid-output') {
      nextStep = 'Retry, asking for the result in the required form.';
    } else if (cls === 'conflicting-instructions' ||
               cls === 'missing-info') {
      nextStep = 'Retry with the information the user just provided.';
    } else {
      nextStep = 'Retry the step once more.';
    }
  } else if (left <= 0) {
    decision = 'escalate-to-user';
    reason = 'attempt-cap-reached';
    nextStep = 'Attempts are exhausted. Ask the user what to do next.';
  } else if (cls === 'conflicting-instructions') {
    decision = 'escalate-to-user';
    reason = 'needs-user-decision';
    nextStep = 'Ask the user which instruction to follow.';
  } else if (cls === 'missing-info') {
    decision = 'escalate-to-user';
    reason = 'needs-user-decision';
    nextStep = 'Ask the user for the missing information.';
  } else if (cls === 'wrong-interpretation') {
    decision = 'escalate-to-user';
    reason = 'needs-user-decision';
    nextStep = 'Ask the user to clarify the request.';
  } else if (cls === 'failed-tool' && typeof status === 'number' &&
             (status === 401 || status === 403)) {
    decision = 'escalate-to-user';
    reason = 'needs-user-decision';
    nextStep = 'Ask the user to check access or permission for the tool.';
  } else {
    decision = 'escalate-to-user';
    reason = 'needs-user-decision';
    nextStep = 'Ask the user what to do next.';
  }

  return {
    decision: decision,
    errorClass: cls,
    cause: diag.cause,
    attemptsUsed: used,
    maxAttempts: max,
    attemptsLeft: left,
    idempotent: (c.idempotent === true ||
      (typeof c.idempotencyKey === 'string' &&
       errTrim(c.idempotencyKey) !== '')),
    nextStep: nextStep,
    reason: reason,
    downgrade: false,
    downgradeRefused: downgradeRefused
  };
}

/* ---------- PUBLIC: honestErrorMessage ---------- */
/* ONE sentence in the user's language: what failed + what happens
   next. Built from two halves — a failure fragment for the error
   class and a next-step fragment for the plan decision — so the
   sentence always matches both. No invented counts, codes, or
   causes; no second sentence; no bare dead-end. lang: 'en' |
   'roman' | 'ur' (aliases 'urdu' and 'roman-urdu' accepted).
   Unknown / missing lang falls back to English. */
var ERR_FAIL = {
  'wrong-interpretation': {
    en: 'I misunderstood your request',
    roman: 'Main aap ki request ghalat samjha',
    ur: 'میں آپ کی درخواست غلط سمجھا'
  },
  'failed-tool': {
    en: 'The tool I tried to use failed',
    roman: 'Jo tool main ne use karne ki koshish ki wo fail ho gaya',
    ur: 'جس ٹول کو میں نے استعمال کرنے کی کوشش کی وہ ناکام ہو گیا'
  },
  'irrelevant-result': {
    en: 'The result I got does not answer your request',
    roman: 'Jo result mujhe mila wo aap ki request ka jawab nahi deta',
    ur: 'جو نتیجہ مجھے ملا وہ آپ کی درخواست کا جواب نہیں دیتا'
  },
  'missing-info': {
    en: 'I do not have all the information I need',
    roman: 'Mere paas wo tamam maloomat nahi hain jo mujhe chahiye',
    ur: 'میرے پاس وہ تمام معلومات نہیں ہیں جو مجھے چاہیے'
  },
  'execution-failure': {
    en: 'That step failed while it was running',
    roman: 'Wo step chalte hue fail ho gaya',
    ur: 'وہ مرحلہ چلتے ہوئے ناکام ہو گیا'
  },
  'invalid-output': {
    en: 'The result came back in a form I cannot use',
    roman: 'Result aisi shakal mein aaya jo main use nahi kar sakta',
    ur: 'نتیجہ ایسی شکل میں آیا جو میں استعمال نہیں کر سکتا'
  },
  'conflicting-instructions': {
    en: 'Your instructions contradict each other',
    roman: 'Aap ki instructions aik doosre se mutazad hain',
    ur: 'آپ کی ہدایات ایک دوسرے سے متضاد ہیں'
  },
  'incomplete-result': {
    en: 'The result came back incomplete',
    roman: 'Result adhoora aaya',
    ur: 'نتیجہ ادھورا آیا'
  },
  'unexpected-behaviour': {
    en: 'Something unexpected happened',
    roman: 'Kuch ghair mutawaqa ho gaya',
    ur: 'کچھ غیر متوقع ہو گیا'
  }
};

var ERR_NEXT = {
  'retry-safe': {
    en: 'I will try it again and let you know if it still does not work',
    roman: 'Main dobara koshish karunga aur agar phir bhi na hua to aap ko bataunga',
    ur: 'میں دوبارہ کوشش کروں گا اور اگر پھر بھی نہ ہوا تو آپ کو بتاؤں گا'
  },
  'retry-unsafe': {
    en: 'I will not repeat it until we check what actually happened',
    roman: 'Main use dobara nahi karunga jab tak hum check na kar lein ke asal mein kya hua',
    ur: 'میں اسے دوبارہ نہیں کروں گا جب تک ہم چیک نہ کر لیں کہ اصل میں کیا ہوا'
  },
  abort: {
    en: 'I have stopped this step instead of guessing',
    roman: 'Main ne andaze se kaam karne ke bajaye ye step rok diya hai',
    ur: 'میں نے اندازے سے کام کرنے کے بجائے یہ مرحلہ روک دیا ہے'
  },
  'escalate-to-user': {
    en: 'I need your help to decide what to do next',
    roman: 'Aage kya karna hai ye faisla karne ke liye mujhe aap ki madad chahiye',
    ur: 'آگے کیا کرنا ہے یہ فیصلہ کرنے کے لیے مجھے آپ کی مدد چاہیے'
  }
};

function errLangOf(lang, ctx) {
  var l = errLower(lang || (ctx && ctx.lang) || '');
  if (l === 'urdu' || l === 'ur') return 'ur';
  if (l === 'roman' || l === 'roman-urdu' || l === 'romanurdu') return 'roman';
  return 'en';
}

function honestErrorMessage(error, ctx, lang) {
  var c = ctx || {};
  var plan = recoveryPlan(error, ctx);
  var lg = errLangOf(lang, c);
  var fail = ERR_FAIL[plan.errorClass] || ERR_FAIL['unexpected-behaviour'];
  var next = ERR_NEXT[plan.decision] || ERR_NEXT['escalate-to-user'];
  var failText = fail[lg] || fail.en;
  var nextText = next[lg] || next.en;
  if (lg === 'ur') {
    return failText + '، اس لیے ' + nextText + '۔';
  }
  if (lg === 'roman') {
    /* The next-step fragment joins mid-sentence, so its first word
       is lower-cased (English "I" stays capital by rule; Roman
       Urdu has no such exception). */
    nextText = nextText.charAt(0).toLowerCase() + nextText.slice(1);
    return failText + ', is liye ' + nextText + '.';
  }
  return failText + ', so ' + nextText + '.';
}

/* ---------- export tail (guarded) ---------- */
var EnzoUniversalErrors = {
  VERSION: VERSION,
  ERROR_CLASSES: ERROR_CLASSES,
  MAX_ATTEMPTS_DEFAULT: MAX_ATTEMPTS_DEFAULT,
  MAX_ATTEMPTS_HARD_CAP: MAX_ATTEMPTS_HARD_CAP,
  classifyError: classifyError,
  diagnose: diagnose,
  recoveryPlan: recoveryPlan,
  retrySafe: retrySafe,
  honestErrorMessage: honestErrorMessage
};

if (typeof root !== 'undefined') root.EnzoUniversalErrors = EnzoUniversalErrors;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnzoUniversalErrors;
}

})(typeof window !== 'undefined' ? window : this);
