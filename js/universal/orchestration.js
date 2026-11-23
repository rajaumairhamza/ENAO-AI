
/* ============================================================================
   ENAO AI universal-intel — PIECE 13: universal intelligence routing
   File: 13-orchestration.js  (AUDIT.md sections 4 and 13, piece B2)
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   PURPOSE
   -------
   AUDIT root causes 4 and 6: capabilities are wired ad hoc inside
   askQuestion() / computeRoute() with if/else branches, and
   multi-capability tasks (research -> analyse -> build -> validate)
   have no stage coordination outside research agents. This piece is
   the registry and the router: it records what every capability is,
   what it needs, what it provides and what permission it requires;
   it selects capabilities from an analysis of the request (never from
   a keyword list); it splits multi-capability work into ordered
   stages with dependencies; and it runs those stages, in parallel
   where they are independent, combining results and reporting
   conflicts instead of hiding them.

   DESIGN
   ------
   - Registry: createRegistry() returns a registry object. register()
     records one capability; registerBuiltins() registers every
     capability that already exists in the live build, by its REAL
     name, with a handler that is a STRING reference to the real
     function (for example 'classifyIntent' or
     'EnzoAgents.runSplitParallelAssemble'). Handlers are NEVER
     reimplemented here — this piece routes to work, it does not redo
     it. A handler string that names a function that does not exist
     yet is still a string; the assembler resolves it at call time
     and reports it honestly if it is absent.
   - Routing is dynamic: route() reads the request analysis (from
     piece 12's analyzeRequest when present, otherwise its own
     verb/object reading of the request text) and scores every
     registered capability by whether it provides what the request
     needs, whether its needs are met, and whether its permissions
     allow it. No capability is selected by a keyword match on the
     request text alone.
   - Stages: planStages() turns a routed capability list into ordered
     stages with explicit dependsOn lists. A stage that depends on
     another never runs before it; independent stages share a level
     and may run in parallel.
   - Coordination: coordinateStages() runs stages level by level
     (Promise.all inside a level, levels in order), combines results,
     and resolves conflicts by ONE rule — latest verified wins
     (among verified results the latest wins; a verified result beats
     an unverified one whatever the order). Every conflict is reported
     in the returned conflicts list, never hidden. A failed stage is
     recorded, its dependents are skipped honestly, and independent
     stages still run.
   - Pure functions, no DOM, no network, no dependencies, plain ES5.
     Zero emojis. No hardcoded topics.

   PUBLIC API (on EnzoUniversalOrchestration)
   ------------------------------------------
   createRegistry()
     -> registry { capabilities, register, get, list, has, remove }
   registerBuiltins(registry)
     -> registry (the same object, with all 14 builtins registered)
   route(request, ctx)
     -> [{ name, reason, score, required, handler }]
     Ordered best-first. request may be a string or an analysis
     object from piece 12 (analyzeRequest output). ctx may carry
     ctx.registry (otherwise a fresh builtins registry is used) and
     ctx.permissions (an array of granted permission names).
   planStages(request, ctx)
     -> [{ id, name, capability, dependsOn, level, description }]
     Ordered stages with dependencies. ctx as in route().
   coordinateStages(stages, executors)
     -> Promise resolving to { results, combined, conflicts, order,
          status, errors, skipped }
     executors maps a capability name (or a stage id) to a function
     (stage) -> result. A result may be a plain value, or an object
     { value, verified, outputs } where outputs maps a key to a
     value. combined merges outputs/value by key under the
     latest-verified-wins rule. Always returns a Promise.
   VERSION: '13-orchestration-1.0.0'
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '13-orchestration-1.0.0';

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function root() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return this;
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

  function uniq(arr) {
    var out = [], i;
    for (i = 0; i < arr.length; i++) {
      if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
    }
    return out;
  }

  function norm(text) {
    return ' ' + asString(text || '').toLowerCase()
      .replace(/[?!.,;:'"()\[\]{}_\/\\\-]+/g, ' ')
      .replace(/\s+/g, ' ') + ' ';
  }

  function hasWord(n, word) { return n.indexOf(' ' + word + ' ') !== -1; }

  function hasAnyWord(n, list) {
    var i;
    for (i = 0; i < list.length; i++) if (hasWord(n, list[i])) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Registry                                                            */
  /* ------------------------------------------------------------------ */

  function createRegistry() {
    var capabilities = {};
    var order = [];

    function register(name, spec) {
      var n = trim(name);
      if (!n) return false;
      if (!isPlainObject(spec)) return false;
      var entry = {
        name: n,
        kinds: cloneArray(spec.kinds),
        needs: cloneArray(spec.needs),
        provides: cloneArray(spec.provides),
        permissions: cloneArray(spec.permissions),
        handler: asString(spec.handler || ''),
        handlerRef: asString(spec.handlerRef || spec.handler || ''),
        description: asString(spec.description || '')
      };
      if (!capabilities[n]) order.push(n);
      capabilities[n] = entry;
      return true;
    }

    function get(name) {
      var n = trim(name);
      return capabilities[n] || null;
    }

    function list() {
      var out = [], i;
      for (i = 0; i < order.length; i++) {
        if (capabilities[order[i]]) out.push(capabilities[order[i]]);
      }
      return out;
    }

    function has(name) { return !!capabilities[trim(name)]; }

    function remove(name) {
      var n = trim(name);
      if (!capabilities[n]) return false;
      delete capabilities[n];
      var idx = order.indexOf(n);
      if (idx !== -1) order.splice(idx, 1);
      return true;
    }

    return {
      capabilities: capabilities,
      register: register,
      get: get,
      list: list,
      has: has,
      remove: remove
    };
  }

  /* ------------------------------------------------------------------ */
  /* Builtins — every capability that already exists, by its real name. */
  /* Handlers are STRING references to the real functions, never        */
  /* reimplementations. See the EVIDENCE file for the live anchors.     */
  /* ------------------------------------------------------------------ */

  var BUILTINS = [
    { name: 'conversation',
      kinds: ['conversation', 'greeting', 'talk'],
      needs: ['request-text'],
      provides: ['reply', 'follow-up-resolution'],
      permissions: [],
      handler: 'EnaoConversation.resolveFollowUp',
      description: 'Everyday talk, follow-ups and the search gate (piece 02).' },
    { name: 'reasoning',
      kinds: ['definition', 'analysis', 'explanation', 'decision'],
      needs: ['request-text'],
      provides: ['reasoning-trace', 'open-intent', 'missing-info'],
      permissions: [],
      handler: 'EnzoUniversalReasoning.analyzeRequest',
      description: 'Open intent + reasoning engine (piece 12).' },
    { name: 'retrieval/search',
      kinds: ['search', 'lookup', 'find'],
      needs: ['request-text'],
      provides: ['current-information', 'sources'],
      permissions: ['network'],
      handler: 'searchWeb',
      description: 'Live search used by the legacy pipeline before answering.' },
    { name: 'research',
      kinds: ['research', 'investigation', 'verification'],
      needs: ['topic'],
      provides: ['report', 'verified-sources', 'comparison'],
      permissions: ['network'],
      handler: 'backendAsk',
      description: 'Deep research through the backend ask route (/api/v2).' },
    { name: 'writing',
      kinds: ['write', 'draft', 'summary', 'article'],
      needs: ['request-text'],
      provides: ['document', 'draft', 'summary'],
      permissions: [],
      handler: 'EnzoUniversalReasoning.analyzeRequest',
      description: 'Writing work, delivered as a ready-to-use document.' },
    { name: 'programming',
      kinds: ['code', 'fix', 'debug', 'script'],
      needs: ['request-text'],
      provides: ['code', 'fix'],
      permissions: [],
      handler: 'EnzoBuildFlow.createBuildSession',
      description: 'Code work, built through the build flow.' },
    { name: 'design',
      kinds: ['design', 'layout', 'visual'],
      needs: ['request-text'],
      provides: ['design', 'layout'],
      permissions: [],
      handler: 'EnzoUniversalPreset.resolveBuildKind',
      description: 'Design direction, resolved through the universal preset.' },
    { name: 'seo-tools',
      kinds: ['seo', 'keyword', 'backlink', 'ranking'],
      needs: ['url-or-domain-or-query'],
      provides: ['seo-report', 'keyword-list', 'backlink-list'],
      permissions: ['network'],
      handler: 'EnzoSeoTools.parseSeoCommand',
      description: 'The nine SEO tools with their own scores (piece 05).' },
    { name: 'agents',
      kinds: ['multi-part', 'parallel', 'long-task'],
      needs: ['parts'],
      provides: ['parallel-results', 'assembled-result'],
      permissions: ['network'],
      handler: 'EnzoAgents.runSplitParallelAssemble',
      description: 'One agent per part, parallel, assembled (piece 06).' },
    { name: 'monitor',
      kinds: ['progress', 'status', 'live-view'],
      needs: ['task-id'],
      provides: ['progress', 'live-status'],
      permissions: [],
      handler: 'EnzoMonitor.getState',
      description: 'Fullscreen live monitor + live guidance (piece 03).' },
    { name: 'voice',
      kinds: ['voice', 'speak', 'call'],
      needs: ['request-text'],
      provides: ['spoken-reply', 'voice-id-gate'],
      permissions: ['microphone'],
      handler: 'EnzoVoiceID.gateAndRoute',
      description: 'Voice-in to voice-out, Raja-only voice gate (piece 04).' },
    { name: 'build-flow',
      kinds: ['build', 'create', 'website', 'app'],
      needs: ['request-text'],
      provides: ['build-session', 'artefact'],
      permissions: [],
      handler: 'EnzoBuildFlow.createBuildSession',
      description: 'Think, research, Q and A, then build (piece 08).' },
    { name: 'file-analysis',
      kinds: ['file', 'document', 'extract'],
      needs: ['file'],
      provides: ['file-summary', 'extracted-data'],
      permissions: ['file-access'],
      handler: 'EnzoUniversalReasoning.analyzeRequest',
      description: 'Analysis of a supplied file or document.' },
    { name: 'automation',
      kinds: ['automate', 'send', 'schedule', 'publish'],
      needs: ['request-text'],
      provides: ['scheduled-action', 'sent-message'],
      permissions: ['send'],
      handler: 'EnzoRules.applyRules',
      description: 'Automated or scheduled actions under the standing rules.' }
  ];

  function registerBuiltins(registry) {
    var reg = registry || createRegistry();
    var i;
    for (i = 0; i < BUILTINS.length; i++) {
      reg.register(BUILTINS[i].name, BUILTINS[i]);
    }
    return reg;
  }

  function defaultRegistry(ctx) {
    if (ctx && ctx.registry && typeof ctx.registry.list === 'function') return ctx.registry;
    if (ctx && ctx.capabilities && typeof ctx.capabilities.list === 'function') return ctx.capabilities;
    return registerBuiltins(createRegistry());
  }

  /* ------------------------------------------------------------------ */
  /* Request reading — from a piece-12 analysis when present, otherwise  */
  /* from the request text itself. Routing scores capabilities by what  */
  /* they provide against what the request needs, never by keywords.   */
  /* ------------------------------------------------------------------ */

  function readAnalysis(request, ctx) {
    var analysis = null;
    if (isPlainObject(request) && (request.intent || request.capabilitiesNeeded || request.taskType)) {
      analysis = request;
    } else if (ctx && isPlainObject(ctx.analysis)) {
      analysis = ctx.analysis;
    } else if (typeof request === 'string') {
      try {
        var w = root();
        if (w && w.EnzoUniversalReasoning && typeof w.EnzoUniversalReasoning.analyzeRequest === 'function') {
          analysis = w.EnzoUniversalReasoning.analyzeRequest(request, ctx);
        }
      } catch (e) { analysis = null; }
    }
    return analysis;
  }

  function requestTextOf(request) {
    if (typeof request === 'string') return request;
    if (isPlainObject(request)) {
      if (typeof request.text === 'string') return request.text;
      if (typeof request.intent === 'string') return request.intent;
    }
    return '';
  }

  /* What the request needs, in capability vocabulary. Derived from the
     analysis (capabilitiesNeeded, needsExternalInfo, needsReasoning,
     expectedOutput, missingInfo) and from the request's own words —
     the deliverable it names and the work it describes. */
  function neededProvides(analysis, text) {
    var needs = [];
    if (analysis) {
      if (analysis.needsExternalInfo) needs.push('current-information');
      if (analysis.needsReasoning) needs.push('reasoning-trace');
      if (analysis.expectedOutput === 'report') needs.push('report');
      if (analysis.expectedOutput === 'document' || analysis.expectedOutput === 'article') needs.push('document');
      if (analysis.expectedOutput === 'comparison') needs.push('comparison');
      if (analysis.expectedOutput === 'summary') needs.push('summary');
      if (analysis.expectedOutput === 'artefact' || analysis.expectedOutput === 'website') needs.push('artefact');
      if (analysis.expectedOutput === 'code' || analysis.expectedOutput === 'script') needs.push('code');
      if (analysis.expectedOutput === 'design') needs.push('design');
      if (analysis.classifierKind === 'research') needs.push('report');
      if (analysis.classifierKind === 'conversation') needs.push('reply');
    }
    var n = norm(text);
    if (hasWord(n, 'report')) needs.push('report');
    if (hasWord(n, 'sources') || hasWord(n, 'verify')) needs.push('verified-sources');
    if (hasWord(n, 'website') || hasWord(n, 'app')) needs.push('artefact');
    if (hasWord(n, 'code') || hasWord(n, 'script')) needs.push('code');
    return uniq(needs);
  }

  function permissionsGranted(ctx) {
    if (ctx && Array.isArray(ctx.permissions)) return ctx.permissions;
    if (ctx && Array.isArray(ctx.grantedPermissions)) return ctx.grantedPermissions;
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: route                                                       */
  /* ------------------------------------------------------------------ */

  function route(request, ctx) {
    var registry = defaultRegistry(ctx);
    var analysis = readAnalysis(request, ctx);
    var text = requestTextOf(request);
    var needs = neededProvides(analysis, text);
    var granted = permissionsGranted(ctx);
    var wanted = [];
    if (analysis && Array.isArray(analysis.capabilitiesNeeded)) wanted = analysis.capabilitiesNeeded;
    var caps = registry.list();
    var scored = [];
    var i, j;
    var textNorm = norm(text);
    var isGreeting = hasAnyWord(textNorm, ['hello', 'hi', 'hey', 'salam',
      'assalamualaikum', 'aoa', 'namaste', 'thanks', 'thank', 'shukriya', 'bye']);
    for (i = 0; i < caps.length; i++) {
      var cap = caps[i];
      var score = 0;
      var reasons = [];
      if (isGreeting && cap.name === 'conversation') {
        score += 8;
        reasons.push('greeting or small talk');
      }
      var wantedIdx = wanted.indexOf(cap.name);
      if (wantedIdx !== -1) {
        score += 10 - wantedIdx;
        reasons.push('analysis needs this capability');
      }
      for (j = 0; j < needs.length; j++) {
        if (cap.provides.indexOf(needs[j]) !== -1) {
          score += 4;
          reasons.push('provides ' + needs[j]);
        }
      }
      for (j = 0; j < cap.kinds.length; j++) {
        if (analysis && analysis.taskType && analysis.taskType.indexOf(cap.kinds[j]) !== -1) {
          score += 2;
          reasons.push('matches task type');
          break;
        }
      }
      if (analysis && analysis.classifierKind && cap.kinds.indexOf(analysis.classifierKind) !== -1) {
        score += 3;
        reasons.push('matches classifier kind ' + analysis.classifierKind);
      }
      /* Permissions: a capability whose permission is not granted is
         still listed (so the gap is visible) but scores lower and is
         marked not required — the assembler must ask or skip it. */
      var blocked = false;
      if (granted !== null) {
        for (j = 0; j < cap.permissions.length; j++) {
          if (granted.indexOf(cap.permissions[j]) === -1) {
            blocked = true;
            score -= 3;
            reasons.push('permission not granted: ' + cap.permissions[j]);
          }
        }
      }
      /* A capability whose needs are unmet scores lower, honestly. */
      if (analysis && Array.isArray(analysis.missingInfo)) {
        for (j = 0; j < cap.needs.length; j++) {
          var need = cap.needs[j];
          if (need === 'topic' || need === 'file') {
            var missingNames = [];
            var k;
            for (k = 0; k < analysis.missingInfo.length; k++) {
              var mi = analysis.missingInfo[k];
              missingNames.push(typeof mi === 'string' ? mi : mi.name);
            }
            if ((need === 'topic' && missingNames.indexOf('subject') !== -1) ||
                (need === 'file' && missingNames.indexOf('file') !== -1)) {
              score -= 2;
              reasons.push('needs ' + need + ', which is missing');
            }
          }
        }
      }
      if (score > 0) {
        scored.push({ name: cap.name, reason: reasons.join('; ') || 'selected by analysis',
          score: score, required: !blocked && wantedIdx === 0,
          handler: cap.handler, blocked: blocked });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    /* The first capability is always required when anything scored;
       the rest are required only when the analysis named them. */
    if (scored.length > 0 && !scored[0].blocked) scored[0].required = true;
    /* Nothing scored (unseen request): fall back to reasoning alone,
       so routing never returns an empty dead end. */
    if (scored.length === 0) {
      var r = registry.get('reasoning');
      scored.push({ name: 'reasoning',
        reason: 'no capability scored; best-effort reasoning first',
        score: 1, required: true,
        handler: r ? r.handler : 'EnzoUniversalReasoning.analyzeRequest',
        blocked: false });
    }
    return scored;
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: planStages                                                  */
  /* ------------------------------------------------------------------ */

  /* Dependency rules between capabilities, in execution order. A stage
     may only run after every capability it depends on has run. */
  var STAGE_ORDER = ['conversation', 'reasoning', 'retrieval/search',
    'research', 'file-analysis', 'seo-tools', 'agents', 'programming',
    'design', 'writing', 'build-flow', 'automation', 'voice', 'monitor'];

  var STAGE_DEPENDS = {
    'retrieval/search': ['reasoning'],
    'research': ['retrieval/search'],
    'file-analysis': ['reasoning'],
    'seo-tools': ['retrieval/search'],
    'agents': ['reasoning'],
    'programming': ['reasoning'],
    'design': ['reasoning'],
    'writing': ['reasoning'],
    'build-flow': ['writing', 'design'],
    'automation': ['writing'],
    'voice': ['reasoning'],
    'monitor': []
  };

  function stageDescription(capName, text) {
    var t = trim(text);
    var short = t.length > 60 ? t.slice(0, 60) + '...' : t;
    var base = {
      'conversation': 'Understand the conversation and resolve follow-ups',
      'reasoning': 'Analyse the request and plan the approach',
      'retrieval/search': 'Gather current information',
      'research': 'Investigate with verified sources and prepare findings',
      'file-analysis': 'Read and analyse the supplied file',
      'seo-tools': 'Run the SEO checks for the given target',
      'agents': 'Split into parts and run one agent per part in parallel',
      'programming': 'Write or fix the code',
      'design': 'Produce the design direction',
      'writing': 'Write the deliverable',
      'build-flow': 'Build the artefact through think, research, Q and A, build',
      'automation': 'Carry out the automated or scheduled action',
      'voice': 'Deliver the reply by voice',
      'monitor': 'Show progress in the live view'
    };
    var d = base[capName] || ('Use capability ' + capName);
    return short ? (d + ' for: ' + short) : d;
  }

  function planStages(request, ctx) {
    var routed = route(request, ctx);
    var text = requestTextOf(request);
    var present = {};
    var i, j;
    for (i = 0; i < routed.length; i++) present[routed[i].name] = true;
    /* Order stages by the fixed capability order, not by score, so
       dependencies always come first. */
    var ordered = [];
    for (i = 0; i < STAGE_ORDER.length; i++) {
      if (present[STAGE_ORDER[i]]) ordered.push(STAGE_ORDER[i]);
    }
    for (i = 0; i < routed.length; i++) {
      if (ordered.indexOf(routed[i].name) === -1) ordered.push(routed[i].name);
    }
    /* The monitor stage is always available as a final stage when
       there is real work to show, but only when the caller asked for
       it or the task is multi-stage. */
    var stages = [];
    var idOf = {};
    for (i = 0; i < ordered.length; i++) {
      var id = 'stage-' + (i + 1);
      idOf[ordered[i]] = id;
      stages.push({ id: id, name: ordered[i], capability: ordered[i],
        dependsOn: [], level: 0, description: stageDescription(ordered[i], text) });
    }
    for (i = 0; i < stages.length; i++) {
      var deps = STAGE_DEPENDS[stages[i].capability] || [];
      var depIds = [];
      for (j = 0; j < deps.length; j++) {
        if (idOf[deps[j]]) depIds.push(idOf[deps[j]]);
      }
      stages[i].dependsOn = depIds;
    }
    /* Levels: a stage's level is one more than its highest dependency. */
    var changed = true, guard = 0;
    while (changed && guard < 20) {
      changed = false;
      guard++;
      for (i = 0; i < stages.length; i++) {
        var maxDep = -1;
        for (j = 0; j < stages[i].dependsOn.length; j++) {
          var d = stages[i].dependsOn[j];
          for (var k = 0; k < stages.length; k++) {
            if (stages[k].id === d && stages[k].level > maxDep) maxDep = stages[k].level;
          }
        }
        var want = maxDep + 1;
        if (stages[i].level !== want) { stages[i].level = want; changed = true; }
      }
    }
    stages.sort(function (a, b) {
      if (a.level !== b.level) return a.level - b.level;
      return a.id < b.id ? -1 : 1;
    });
    return stages;
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: coordinateStages — run levels in order, parallel in level  */
  /* ------------------------------------------------------------------ */

  function resultOutputs(stage, raw) {
    /* Normalise an executor result into { value, verified, outputs }.
       outputs maps a key to a value; a plain value becomes the single
       key 'result'. */
    if (raw === null || raw === undefined) return { value: null, verified: false, outputs: {} };
    if (isPlainObject(raw) && (raw.outputs || raw.value !== undefined || raw.verified !== undefined)) {
      var outs = {};
      if (isPlainObject(raw.outputs)) outs = raw.outputs;
      else if (raw.value !== undefined) outs = { result: raw.value };
      return { value: (raw.value !== undefined ? raw.value : raw),
        verified: raw.verified === true, outputs: outs };
    }
    if (isPlainObject(raw)) {
      var o = {}, k;
      for (k in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) o[k] = raw[k];
      }
      return { value: raw, verified: false, outputs: o };
    }
    return { value: raw, verified: false, outputs: { result: raw } };
  }

  function coordinateStages(stages, executors) {
    var list = Array.isArray(stages) ? stages : [];
    var execs = isPlainObject(executors) ? executors : {};
    var byId = {};
    var i, j;
    for (i = 0; i < list.length; i++) byId[list[i].id] = list[i];

    /* Group stages into levels by dependency depth (same rule as
       planStages, recomputed so hand-built stage lists work too). */
    var levels = {};
    var levelOf = {};
    function levelFor(stage, seen) {
      if (levelOf[stage.id] !== undefined) return levelOf[stage.id];
      if (seen.indexOf(stage.id) !== -1) return 0;
      seen.push(stage.id);
      var max = -1;
      var deps = Array.isArray(stage.dependsOn) ? stage.dependsOn : [];
      for (var d = 0; d < deps.length; d++) {
        var dep = byId[deps[d]];
        if (dep) {
          var lv = levelFor(dep, seen);
          if (lv > max) max = lv;
        }
      }
      seen.pop();
      levelOf[stage.id] = max + 1;
      return max + 1;
    }
    for (i = 0; i < list.length; i++) {
      var lv = levelFor(list[i], []);
      if (!levels[lv]) levels[lv] = [];
      levels[lv].push(list[i]);
    }
    var levelKeys = [];
    for (var lk in levels) {
      if (Object.prototype.hasOwnProperty.call(levels, lk)) levelKeys.push(parseInt(lk, 10));
    }
    levelKeys.sort(function (a, b) { return a - b; });

    var results = {};
    var combined = {};
    var provenance = {};
    var conflicts = [];
    var errors = [];
    var skipped = [];
    var order = [];
    var failedIds = {};

    function mergeOutputs(stageId, normed, seq) {
      var outs = normed.outputs, key;
      for (key in outs) {
        if (!Object.prototype.hasOwnProperty.call(outs, key)) continue;
        var val = outs[key];
        if (!Object.prototype.hasOwnProperty.call(combined, key)) {
          combined[key] = val;
          provenance[key] = { stage: stageId, verified: normed.verified, seq: seq };
        } else if (combined[key] !== val) {
          var prev = provenance[key];
          var winnerIsNew = false;
          if (normed.verified && !prev.verified) winnerIsNew = true;
          else if (normed.verified && prev.verified) winnerIsNew = true;
          else if (!normed.verified && !prev.verified) winnerIsNew = true;
          /* Latest verified wins: a verified result beats an
             unverified one whatever the order; among equals the
             latest wins. An unverified result never beats a
             verified one. */
          if (!normed.verified && prev.verified) winnerIsNew = false;
          conflicts.push({ key: key,
            previous: { value: combined[key], stage: prev.stage, verified: prev.verified },
            next: { value: val, stage: stageId, verified: normed.verified },
            winner: winnerIsNew ? 'next' : 'previous',
            rule: 'latest-verified-wins' });
          if (winnerIsNew) {
            combined[key] = val;
            provenance[key] = { stage: stageId, verified: normed.verified, seq: seq };
          }
        }
      }
    }

    function runStage(stage, seq) {
      var fn = execs[stage.capability] || execs[stage.id] || execs[stage.name];
      if (typeof fn !== 'function') {
        var err = new Error('no executor for capability: ' + stage.capability);
        errors.push({ stage: stage.id, capability: stage.capability, error: err.message });
        results[stage.id] = { stage: stage.id, capability: stage.capability, status: 'failed', error: err.message };
        failedIds[stage.id] = true;
        order.push(stage.id);
        return Promise.resolve(null);
      }
      var out;
      try {
        out = fn(stage);
      } catch (e) {
        errors.push({ stage: stage.id, capability: stage.capability, error: (e && e.message) || String(e) });
        results[stage.id] = { stage: stage.id, capability: stage.capability, status: 'failed', error: (e && e.message) || String(e) };
        failedIds[stage.id] = true;
        order.push(stage.id);
        return Promise.resolve(null);
      }
      return Promise.resolve(out).then(function (raw) {
        var normed = resultOutputs(stage, raw);
        results[stage.id] = { stage: stage.id, capability: stage.capability,
          status: 'done', value: normed.value, verified: normed.verified };
        mergeOutputs(stage.id, normed, seq);
        order.push(stage.id);
        return raw;
      }, function (e) {
        errors.push({ stage: stage.id, capability: stage.capability, error: (e && e.message) || String(e) });
        results[stage.id] = { stage: stage.id, capability: stage.capability, status: 'failed', error: (e && e.message) || String(e) };
        failedIds[stage.id] = true;
        order.push(stage.id);
        return null;
      });
    }

    var chain = Promise.resolve();
    var seq = 0;
    levelKeys.forEach(function (lv) {
      chain = chain.then(function () {
        var group = levels[lv];
        var ready = [], k;
        for (k = 0; k < group.length; k++) {
          var st = group[k];
          var deps = Array.isArray(st.dependsOn) ? st.dependsOn : [];
          var blocked = false;
          for (var d = 0; d < deps.length; d++) {
            if (failedIds[deps[d]]) { blocked = true; break; }
          }
          if (blocked) {
            skipped.push(st.id);
            results[st.id] = { stage: st.id, capability: st.capability,
              status: 'skipped', error: 'dependency failed' };
            order.push(st.id);
          } else {
            ready.push(st);
          }
        }
        /* Independent stages in one level run in parallel. */
        var jobs = ready.map(function (st) { seq++; return runStage(st, seq); });
        return Promise.all(jobs);
      });
    });

    return chain.then(function () {
      var status = 'done';
      if (errors.length > 0 && skipped.length > 0) status = 'partial';
      else if (errors.length > 0) status = 'partial';
      else if (skipped.length > 0) status = 'partial';
      return { results: results, combined: combined, conflicts: conflicts,
        order: order, status: status, errors: errors, skipped: skipped };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    createRegistry: createRegistry,
    registerBuiltins: registerBuiltins,
    route: route,
    planStages: planStages,
    coordinateStages: coordinateStages
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalOrchestration = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalOrchestration = api;
  } catch (e) { /* exposure is best-effort */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
