
/* ============================================================================
   ENAO AI universal-intel — PIECE 12: universal intent + reasoning engine
   File: 12-reasoning.js  (AUDIT.md section 3, piece B1)
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   PURPOSE
   -------
   AUDIT root cause 2: input handling is pattern matching, not
   understanding. A request outside the known patterns falls to
   'general' with no analysis of what it actually needs. This piece is
   the centre that analyses ANY request — seen or unseen — in open,
   free-form terms: what verb is being asked for, what object it acts
   on, what is known, what is missing, what approach fits. It never
   returns a dead end: an unseen request still gets a best-effort
   approach, and a clarification is only ever asked for essential
   missing information.

   DESIGN
   ------
   - OPEN intent: intent is a free-form verb + object derived from the
     request's own words (for example 'write report', 'compare options',
     'plan schedule'), NOT a fixed kind list. taskType is a slug built
     from that same verb + object head, so a new kind of request gets a
     new taskType instead of being forced into an old bucket.
   - CONSUMES 01-intent when present: analyzeRequest looks for a
     classifyIntent function (on ctx.classifyIntent, on ctx, or on the
     global object) and, when found, calls it and uses its kind and
     params as ONE signal among others — never as the whole answer, and
     never duplicated here. When classifyIntent is absent the piece
     works standalone from its own verb/object analysis.
   - No hardcoded topics. The same phrasing analyses the same way for
     any subject; the harness proves topic-invariance across unrelated
     subjects. No topic name appears in this file.
   - Pure functions, no DOM, no network, no dependencies, plain ES5.
     Zero emojis.

   PUBLIC API (on EnzoUniversalReasoning)
   --------------------------------------
   analyzeRequest(text, ctx)
     -> { intent, taskType, needsReasoning, needsExternalInfo,
          capabilitiesNeeded, missingInfo, expectedOutput, planHint,
          classifierKind, classifierReason, unseen, confidence }
     intent is a free-form string ('write report'); taskType is a slug
     ('write-report'); capabilitiesNeeded is an array of capability
     names (the registry names from piece 13); missingInfo is an array
     of { name, essential, why }; expectedOutput names the deliverable
     shape; planHint is a short approach sketch. unseen mirrors
     isUnseenRequest. confidence is 'high' | 'medium' | 'low' and is
     low exactly when the request is unseen or essentially empty.
   reasonAbout(text, ctx)
     -> { asked, known, missing, approach, steps, uncertainties,
          canProceed, unseen }
     A step-by-step reasoning trace as DATA, not prose: what is asked
     (the open intent + object), what is known (facts present in the
     request and in ctx), what is missing (essential vs optional),
     what approach fits (ordered steps), and what is still uncertain.
   isUnseenRequest(text, ctx)
     -> boolean. True when no known pattern or capability covers the
     request. An unseen request is NOT an error: analyzeRequest and
     reasonAbout still return a best-effort approach for it.
   assessMissingInfo(text, ctx)
     -> { essential, optional, questions, canProceed }
     essential: missing parameters without which the task cannot start
     (the subject, the target of a destructive/send action, the thing
     to act on). optional: nice-to-have parameters (length, format,
     depth, counts, deadline). questions: clarification questions for
     the essential items ONLY — never for optional ones.
   VERSION: '12-reasoning-1.0.0'
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '12-reasoning-1.0.0';

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

  function norm(text) {
    var s = ' ' + asString(text || '').toLowerCase()
      .replace(/[?!.,;:'"()\[\]{}_\/\\\-]+/g, ' ')
      .replace(/\s+/g, ' ') + ' ';
    s = s.replace(/\bkia\b/g, 'kya');
    s = s.replace(/\bha\b/g, 'hai');
    s = s.replace(/\bhen\b/g, 'hain');
    s = s.replace(/\s+/g, ' ');
    return s;
  }

  function wordsOf(text) {
    var t = trim(norm(text));
    return t ? t.split(/\s+/) : [];
  }

  function hasWord(n, word) {
    return n.indexOf(' ' + word + ' ') !== -1;
  }

  function hasAnyWord(n, list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (hasWord(n, list[i])) return true;
    }
    return false;
  }

  function slug(s) {
    return trim(asString(s).toLowerCase())
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'request';
  }

  function uniq(arr) {
    var out = [], i;
    for (i = 0; i < arr.length; i++) {
      if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
    }
    return out;
  }

  function hasUrdu(text) { return /[\u0600-\u06FF]/.test(asString(text)); }

  /* ------------------------------------------------------------------ */
  /* Verb families — generic action words, no topics. Each family maps  */
  /* to the capability names piece 13 registers. A verb family is a     */
  /* SIGNAL, not a keyword gate: the open intent is always derived     */
  /* from the request's own words first, and the family only decides   */
  /* which capabilities the approach needs.                            */
  /* ------------------------------------------------------------------ */

  /* verb -> { capability, family } ; families are deliberately broad
     so a phrasing the author never saw still lands near a capability. */
  var VERB_MAP = {
    research: { cap: 'research', family: 'investigate' },
    investigate: { cap: 'research', family: 'investigate' },
    search: { cap: 'retrieval/search', family: 'investigate' },
    find: { cap: 'retrieval/search', family: 'investigate' },
    lookup: { cap: 'retrieval/search', family: 'investigate' },
    verify: { cap: 'research', family: 'investigate' },
    check: { cap: 'retrieval/search', family: 'investigate' },
    compare: { cap: 'research', family: 'analyse' },
    analyse: { cap: 'reasoning', family: 'analyse' },
    analyze: { cap: 'reasoning', family: 'analyse' },
    explain: { cap: 'reasoning', family: 'explain' },
    define: { cap: 'reasoning', family: 'explain' },
    describe: { cap: 'reasoning', family: 'explain' },
    summarise: { cap: 'writing', family: 'summarise' },
    summarize: { cap: 'writing', family: 'summarise' },
    write: { cap: 'writing', family: 'create' },
    draft: { cap: 'writing', family: 'create' },
    compose: { cap: 'writing', family: 'create' },
    create: { cap: 'build-flow', family: 'create' },
    build: { cap: 'build-flow', family: 'create' },
    make: { cap: 'build-flow', family: 'create' },
    design: { cap: 'design', family: 'create' },
    draw: { cap: 'design', family: 'create' },
    plan: { cap: 'reasoning', family: 'plan' },
    schedule: { cap: 'automation', family: 'plan' },
    organise: { cap: 'reasoning', family: 'plan' },
    organize: { cap: 'reasoning', family: 'plan' },
    calculate: { cap: 'reasoning', family: 'calculate' },
    compute: { cap: 'reasoning', family: 'calculate' },
    code: { cap: 'programming', family: 'code' },
    program: { cap: 'programming', family: 'code' },
    fix: { cap: 'programming', family: 'code' },
    debug: { cap: 'programming', family: 'code' },
    automate: { cap: 'automation', family: 'automate' },
    send: { cap: 'automation', family: 'send' },
    translate: { cap: 'writing', family: 'translate' },
    review: { cap: 'reasoning', family: 'analyse' },
    audit: { cap: 'seo-tools', family: 'analyse' },
    optimise: { cap: 'seo-tools', family: 'analyse' },
    optimize: { cap: 'seo-tools', family: 'analyse' },
    rank: { cap: 'seo-tools', family: 'analyse' },
    list: { cap: 'writing', family: 'list' },
    convert: { cap: 'programming', family: 'convert' },
    teach: { cap: 'reasoning', family: 'explain' },
    learn: { cap: 'reasoning', family: 'explain' },
    decide: { cap: 'reasoning', family: 'decide' },
    choose: { cap: 'reasoning', family: 'decide' },
    recommend: { cap: 'reasoning', family: 'decide' },
    suggest: { cap: 'reasoning', family: 'decide' },
    troubleshoot: { cap: 'reasoning', family: 'analyse' },
    predict: { cap: 'reasoning', family: 'analyse' },
    estimate: { cap: 'reasoning', family: 'calculate' },
    monitor: { cap: 'monitor', family: 'monitor' },
    track: { cap: 'monitor', family: 'monitor' },
    speak: { cap: 'voice', family: 'voice' },
    say: { cap: 'voice', family: 'voice' },
    tell: { cap: 'conversation', family: 'talk' },
    talk: { cap: 'conversation', family: 'talk' },
    discuss: { cap: 'conversation', family: 'talk' },
    chat: { cap: 'conversation', family: 'talk' },
    ask: { cap: 'conversation', family: 'talk' },
    help: { cap: 'reasoning', family: 'help' },
    edit: { cap: 'writing', family: 'create' },
    improve: { cap: 'writing', family: 'create' },
    generate: { cap: 'build-flow', family: 'create' },
    test: { cap: 'programming', family: 'code' },
    deploy: { cap: 'automation', family: 'automate' },
    publish: { cap: 'automation', family: 'send' },
    delete: { cap: 'automation', family: 'send' },
    remove: { cap: 'automation', family: 'send' },
    upload: { cap: 'automation', family: 'send' },
    download: { cap: 'retrieval/search', family: 'investigate' },
    read: { cap: 'file-analysis', family: 'analyse' },
    open: { cap: 'file-analysis', family: 'analyse' },
    parse: { cap: 'file-analysis', family: 'analyse' },
    extract: { cap: 'file-analysis', family: 'analyse' },
    /* Roman Urdu action words, same families as the English ones. */
    banao: { cap: 'build-flow', family: 'create' },
    banayo: { cap: 'build-flow', family: 'create' },
    likho: { cap: 'writing', family: 'create' },
    likh: { cap: 'writing', family: 'create' },
    batao: { cap: 'conversation', family: 'talk' },
    samjhao: { cap: 'reasoning', family: 'explain' },
    dhoond: { cap: 'retrieval/search', family: 'investigate' },
    dhoondo: { cap: 'retrieval/search', family: 'investigate' },
    karo: { cap: 'reasoning', family: 'help' },
    kar: { cap: 'reasoning', family: 'help' },
    dekho: { cap: 'retrieval/search', family: 'investigate' },
    nikalo: { cap: 'retrieval/search', family: 'investigate' },
    bhejo: { cap: 'automation', family: 'send' },
    bhej: { cap: 'automation', family: 'send' },
    theek: { cap: 'programming', family: 'code' }
  };

  var QUESTION_WORDS = ['what', 'why', 'how', 'when', 'where', 'who',
    'which', 'whose', 'whom', 'kya', 'kia', 'kyun', 'kyu', 'kab',
    'kahan', 'kidhar', 'kaise', 'kaisa', 'kaun', 'konsa', 'kaunsa'];

  var FILLER_WORDS = { the: 1, a: 1, an: 1, please: 1, plz: 1, me: 1,
    my: 1, for: 1, to: 1, of: 1, on: 1, in: 1, about: 1, mujhe: 1,
    mera: 1, meri: 1, mere: 1, aap: 1, tum: 1, ye: 1, yeh: 1, wo: 1,
    woh: 1, is: 1, ka: 1, ki: 1, ke: 1, ko: 1, se: 1, par: 1, pe: 1,
    mein: 1, main: 1, bhi: 1, aur: 1, ab: 1, abhi: 1, zara: 1,
    baare: 1, bare: 1, something: 1, anything: 1, stuff: 1, thing: 1,
    cheez: 1, kuch: 1, this: 1, that: 1, it: 1, them: 1, us: 1, is: 1,
    with: 1, and: 1, or: 1, by: 1, from: 1, at: 1, into: 1, up: 1,
    do: 1, does: 1, did: 1 };

  var GREETING_WORDS = ['hello', 'hi', 'hey', 'salam', 'assalamualaikum',
    'aoa', 'namaste', 'thanks', 'thank', 'shukriya', 'bye'];

  /* Deliverable nouns the request itself names (object head words). */
  var DELIVERABLE_WORDS = ['report', 'summary', 'list', 'plan', 'schedule',
    'article', 'essay', 'letter', 'email', 'message', 'proposal', 'website',
    'app', 'page', 'design', 'logo', 'code', 'script', 'program', 'table',
    'chart', 'presentation', 'slides', 'video', 'audio', 'image', 'file',
    'dashboard', 'guide', 'tutorial', 'review', 'comparison', 'analysis',
    'answer', 'question', 'story', 'poem', 'song', 'recipe', 'menu',
    'invoice', 'resume', 'cv', 'portfolio', 'contract', 'policy'];

  /* ------------------------------------------------------------------ */
  /* classifyIntent consumption (01-intent) — one signal, never a copy  */
  /* ------------------------------------------------------------------ */

  function findClassifier(ctx) {
    var fn = null;
    try {
      if (ctx && typeof ctx.classifyIntent === 'function') fn = ctx.classifyIntent;
      else if (ctx && ctx.classifier && typeof ctx.classifier.classifyIntent === 'function') fn = ctx.classifier.classifyIntent;
      else if (typeof classifyIntent === 'function') fn = classifyIntent;
      else {
        var w = root();
        if (w && typeof w.classifyIntent === 'function') fn = w.classifyIntent;
        else if (w && w.EnaoIntel && typeof w.EnaoIntel.classifyIntent === 'function') fn = w.EnaoIntel.classifyIntent;
      }
    } catch (e) { fn = null; }
    return fn;
  }

  function callClassifier(text, ctx) {
    var fn = findClassifier(ctx);
    if (!fn) return null;
    try {
      var r = fn(text, ctx);
      if (!r || typeof r !== 'object') return null;
      return r;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* Verb + object extraction (open intent)                              */
  /* ------------------------------------------------------------------ */

  function extractVerbObject(text) {
    var n = norm(text);
    var toks = wordsOf(text);
    var verb = null, verbIndex = -1, i;
    /* First known action verb in the message wins; a question word
       before it (what/how/why) means the verb is the question's verb. */
    for (i = 0; i < toks.length; i++) {
      if (VERB_MAP[toks[i]]) { verb = toks[i]; verbIndex = i; break; }
    }
    var objectWords = [];
    if (verbIndex >= 0) {
      /* Content words BEFORE the verb too: Roman Urdu / Urdu word
         order puts the object before the verb ("report likh do"), so
         a pre-verb content word is the object, not noise. */
      for (i = 0; i < verbIndex; i++) {
        if (!FILLER_WORDS[toks[i]] && QUESTION_WORDS.indexOf(toks[i]) === -1) {
          objectWords.push(toks[i]);
        }
      }
      for (i = verbIndex + 1; i < toks.length; i++) {
        if (!FILLER_WORDS[toks[i]] && QUESTION_WORDS.indexOf(toks[i]) === -1) {
          objectWords.push(toks[i]);
        }
      }
    } else {
      /* No action verb: the object is the content words themselves
         (a question, a fragment, a greeting). */
      for (i = 0; i < toks.length; i++) {
        if (!FILLER_WORDS[toks[i]] && QUESTION_WORDS.indexOf(toks[i]) === -1) {
          objectWords.push(toks[i]);
        }
      }
    }
    var object = trim(objectWords.join(' '));
    var objectHead = objectWords.length > 0 ? objectWords[0] : '';
    return { verb: verb, verbIndex: verbIndex, object: object,
      objectHead: objectHead, objectWords: objectWords, norm: n, tokens: toks };
  }

  function openIntent(vo) {
    if (vo.verb && vo.objectHead) return vo.verb + ' ' + vo.objectHead;
    if (vo.verb) return vo.verb;
    if (vo.objectHead) return vo.objectHead;
    return 'understand request';
  }

  function taskTypeOf(vo) {
    var intent = openIntent(vo);
    return slug(intent);
  }

  /* ------------------------------------------------------------------ */
  /* Capability derivation from the analysis (not from a fixed list)     */
  /* ------------------------------------------------------------------ */

  function capabilitiesFor(vo, n, classifierKind) {
    var caps = [];
    if (vo.verb && VERB_MAP[vo.verb]) caps.push(VERB_MAP[vo.verb].cap);
    /* A question about something is reasoning + conversation first. */
    if (hasAnyWord(n, QUESTION_WORDS)) {
      if (caps.indexOf('reasoning') === -1) caps.push('reasoning');
    }
    /* Deliverable nouns pull in their capability. */
    if (hasWord(n, 'website') || hasWord(n, 'app') || hasWord(n, 'page')) {
      if (caps.indexOf('build-flow') === -1) caps.push('build-flow');
    }
    if (hasWord(n, 'report') || hasWord(n, 'summary') || hasWord(n, 'article') ||
        hasWord(n, 'letter') || hasWord(n, 'email') || hasWord(n, 'essay')) {
      if (caps.indexOf('writing') === -1) caps.push('writing');
    }
    if (hasWord(n, 'design') || hasWord(n, 'logo') || hasWord(n, 'layout')) {
      if (caps.indexOf('design') === -1) caps.push('design');
    }
    if (hasWord(n, 'code') || hasWord(n, 'script') || hasWord(n, 'program') ||
        hasWord(n, 'function') || hasWord(n, 'bug') || hasWord(n, 'error')) {
      if (caps.indexOf('programming') === -1) caps.push('programming');
    }
    if (hasWord(n, 'seo') || hasWord(n, 'keyword') || hasWord(n, 'backlink') ||
        hasWord(n, 'ranking') || hasWord(n, 'rank')) {
      if (caps.indexOf('seo-tools') === -1) caps.push('seo-tools');
    }
    if (hasWord(n, 'file') || hasWord(n, 'document') || hasWord(n, 'pdf') ||
        hasWord(n, 'spreadsheet') || hasWord(n, 'csv')) {
      if (caps.indexOf('file-analysis') === -1) caps.push('file-analysis');
    }
    if (hasWord(n, 'voice') || hasWord(n, 'speak') || hasWord(n, 'audio') ||
        hasWord(n, 'mic') || hasWord(n, 'call')) {
      if (caps.indexOf('voice') === -1) caps.push('voice');
    }
    if (hasWord(n, 'monitor') || hasWord(n, 'progress') || hasWord(n, 'status')) {
      if (caps.indexOf('monitor') === -1) caps.push('monitor');
    }
    /* Classifier signal: research kind needs external info capability. */
    if (classifierKind === 'research') {
      if (caps.indexOf('research') === -1) caps.push('research');
      if (caps.indexOf('retrieval/search') === -1) caps.push('retrieval/search');
    }
    if (classifierKind === 'conversation' && caps.length === 0) caps.push('conversation');
    if (classifierKind === 'definition' && caps.indexOf('reasoning') === -1) caps.push('reasoning');
    /* Multi-part work (more than one action verb) needs agents. */
    var verbCount = 0, i;
    for (i = 0; i < vo.tokens.length; i++) {
      if (VERB_MAP[vo.tokens[i]]) verbCount++;
    }
    if (verbCount >= 2 && caps.indexOf('agents') === -1) caps.push('agents');
    if (hasWord(n, 'step') && hasWord(n, 'by') && caps.indexOf('agents') === -1) {
      /* 'step by step' alone is not multi-agent work; only add agents
         when the request itself names parts or several actions. */
    }
    return uniq(caps);
  }

  function needsReasoning(vo, n, classifierKind) {
    if (hasAnyWord(n, ['compare', 'analyse', 'analyze', 'decide', 'choose',
      'recommend', 'plan', 'calculate', 'compute', 'why', 'troubleshoot',
      'predict', 'evaluate', 'assess', 'explain', 'design', 'strategy'])) return true;
    if (vo.verb && VERB_MAP[vo.verb] && (VERB_MAP[vo.verb].family === 'analyse' ||
        VERB_MAP[vo.verb].family === 'plan' || VERB_MAP[vo.verb].family === 'decide' ||
        VERB_MAP[vo.verb].family === 'calculate')) return true;
    if (vo.tokens.length >= 12) return true;
    if (hasWord(n, 'and') && vo.verb) return true;
    if (classifierKind === 'definition') return true;
    return false;
  }

  function needsExternalInfo(vo, n, classifierKind, text) {
    if (classifierKind === 'research') return true;
    if (hasAnyWord(n, ['latest', 'current', 'today', 'news', 'price',
      'weather', 'score', 'update', 'recent', 'live'])) return true;
    if (hasWord(n, 'verify') || hasWord(n, 'fact')) return true;
    if (/https?:\/\//.test(asString(text))) return true;
    if (hasWord(n, 'sources') || hasWord(n, 'websites') || hasWord(n, 'sites')) return true;
    return false;
  }

  function expectedOutputOf(vo, n, classifierKind) {
    var i;
    for (i = 0; i < DELIVERABLE_WORDS.length; i++) {
      if (hasWord(n, DELIVERABLE_WORDS[i])) return DELIVERABLE_WORDS[i];
    }
    if (hasAnyWord(n, QUESTION_WORDS)) return 'answer';
    if (vo.verb === 'write' || vo.verb === 'draft' || vo.verb === 'compose') return 'document';
    if (vo.verb === 'build' || vo.verb === 'create' || vo.verb === 'make') return 'artefact';
    if (vo.verb === 'calculate' || vo.verb === 'compute' || vo.verb === 'estimate') return 'result';
    if (vo.verb === 'compare') return 'comparison';
    if (vo.verb === 'summarise' || vo.verb === 'summarize') return 'summary';
    if (vo.verb === 'translate') return 'translation';
    if (vo.verb === 'list') return 'list';
    if (classifierKind === 'conversation') return 'reply';
    if (classifierKind === 'definition') return 'explanation';
    if (classifierKind === 'research') return 'report';
    return 'answer';
  }

  function planHintOf(vo, caps, unseen) {
    if (unseen) {
      return 'No known pattern covers this request: restate it in own ' +
        'words, identify the closest capability, attempt a best-effort ' +
        'answer from what is known, and name what is still missing ' +
        'instead of refusing.';
    }
    var parts = [];
    if (caps.indexOf('retrieval/search') !== -1 || caps.indexOf('research') !== -1) {
      parts.push('gather current information first');
    }
    if (caps.indexOf('reasoning') !== -1) parts.push('reason step by step');
    if (caps.indexOf('agents') !== -1) parts.push('split into parts and work in parallel');
    if (caps.indexOf('writing') !== -1 || caps.indexOf('build-flow') !== -1) {
      parts.push('produce the deliverable');
    }
    if (parts.length === 0) parts.push('answer directly from what is known');
    parts.push('check the result before delivering it');
    return parts.join(', then ') + '.';
  }

  /* ------------------------------------------------------------------ */
  /* Missing information — essential vs nice-to-have                     */
  /* ------------------------------------------------------------------ */

  function assessMissingInfo(text, ctx) {
    var raw = asString(text);
    var t = trim(raw);
    var vo = extractVerbObject(raw);
    var n = vo.norm;
    var essential = [], optional = [];
    var i;

    function addEssential(name, why) {
      essential.push({ name: name, essential: true, why: why });
    }
    function addOptional(name, why) {
      optional.push({ name: name, essential: false, why: why });
    }

    if (!t) {
      addEssential('request', 'Nothing was said, so there is nothing to act on.');
      return { essential: essential, optional: optional,
        questions: ['What would you like me to do?'], canProceed: false };
    }

    var knownTopic = null;
    if (ctx) {
      if (typeof ctx.currentTopic === 'string' && trim(ctx.currentTopic)) knownTopic = ctx.currentTopic;
      else if (ctx.state && typeof ctx.state.currentTopic === 'string' && trim(ctx.state.currentTopic)) knownTopic = ctx.state.currentTopic;
      else if (ctx.intelState && typeof ctx.intelState.currentTopic === 'string' && trim(ctx.intelState.currentTopic)) knownTopic = ctx.intelState.currentTopic;
      else if (Array.isArray(ctx.history) && ctx.history.length > 0) {
        var last = ctx.history[ctx.history.length - 1];
        if (last && typeof last.topic === 'string' && trim(last.topic)) knownTopic = last.topic;
      }
    }

    var classifier = callClassifier(raw, ctx);
    var classifierKind = classifier ? classifier.kind : null;

    /* The subject itself is essential whenever the request names no
       object and no topic is known from context. */
    var hasObject = !!vo.object;
    var pronounOnly = /^(it|that|this|them|ye|yeh|wo|woh|us|is)\s*$/.test(vo.object) ||
      /\b(it|that|this|them)\s*$/.test(n) && !hasObject;
    if (!hasObject || pronounOnly) {
      if (!knownTopic) {
        addEssential('subject', 'The request names no subject to act on.');
      }
    }
    /* Destructive / send actions on an unclear target are essential. */
    if (hasAnyWord(n, ['delete', 'remove', 'send', 'erase', 'cancel']) && !hasObject && !knownTopic) {
      var already = false;
      for (i = 0; i < essential.length; i++) if (essential[i].name === 'target') already = true;
      if (!already) addEssential('target', 'A delete/send action needs a named target; guessing it would be unsafe.');
    }
    /* A research order with no topic is essential-missing. */
    if (classifierKind === 'research' && classifier && classifier.params && !classifier.params.topic && !hasObject && !knownTopic) {
      var hasSubj = false;
      for (i = 0; i < essential.length; i++) if (essential[i].name === 'subject') hasSubj = true;
      if (!hasSubj) addEssential('subject', 'The investigation names no topic.');
    }
    /* A bare greeting / small talk needs nothing. */
    /* Optional parameters: present only as nice-to-have, never asked. */
    if (vo.verb && !/^\d+$/.test(vo.object)) {
      if (!/\b\d+\s*(words?|pages?)\b/.test(n) && (vo.verb === 'write' || vo.verb === 'draft' || vo.verb === 'summarise' || vo.verb === 'summarize')) {
        addOptional('length', 'A length would help shape the output, but a sensible default works.');
      }
      if (!hasWord(n, 'format') && (vo.verb === 'write' || vo.verb === 'create' || vo.verb === 'build')) {
        addOptional('format', 'A preferred format would help, but a plain deliverable works.');
      }
      if (classifierKind === 'research' && !(classifier && classifier.params && classifier.params.sources)) {
        addOptional('source-count', 'A source count would help, but a default count works.');
      }
      if (!hasWord(n, 'deadline') && !hasWord(n, 'when') && (vo.verb === 'plan' || vo.verb === 'schedule')) {
        addOptional('deadline', 'A deadline would help prioritise, but a plan can be made without one.');
      }
      if (!hasWord(n, 'language') && hasWord(n, 'translate')) {
        /* Only essential when no language is named anywhere; the
           check below (named-language list) decides that. */
      }
    }
    if (hasWord(n, 'translate') && !hasWord(n, 'language')) {
      var hasLang = false;
      for (i = 0; i < essential.length; i++) if (essential[i].name === 'target-language') hasLang = true;
      if (!hasLang) {
        /* Only essential when no language is named anywhere in the text. */
        if (!/\b(english|urdu|hindi|arabic|french|spanish|german|italian|portuguese|punjabi|chinese|japanese|turkish)\b/.test(n)) {
          addEssential('target-language', 'A translation needs a target language.');
        }
      }
    }

    var questions = [];
    for (i = 0; i < essential.length; i++) {
      if (essential[i].name === 'subject') questions.push('What subject should I work on?');
      else if (essential[i].name === 'target') questions.push('What exactly should I act on?');
      else if (essential[i].name === 'target-language') questions.push('Which language should I translate it into?');
      else if (essential[i].name === 'request') questions.push('What would you like me to do?');
      else questions.push('What is the ' + essential[i].name + '?');
    }
    questions = uniq(questions);
    return { essential: essential, optional: optional, questions: questions,
      canProceed: essential.length === 0 };
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: analyzeRequest                                              */
  /* ------------------------------------------------------------------ */

  function analyzeRequest(text, ctx) {
    var raw = asString(text);
    var vo = extractVerbObject(raw);
    var n = vo.norm;
    var classifier = callClassifier(raw, ctx);
    var classifierKind = classifier ? classifier.kind : null;
    var classifierReason = classifier ? (classifier.reason || null) : null;
    var caps = capabilitiesFor(vo, n, classifierKind);
    var missing = assessMissingInfo(raw, ctx);
    var unseen = isUnseenRequest(raw, ctx);
    var intent = openIntent(vo);
    var taskType = taskTypeOf(vo);
    var output = expectedOutputOf(vo, n, classifierKind);
    var reasoning = needsReasoning(vo, n, classifierKind);
    var external = needsExternalInfo(vo, n, classifierKind, raw);
    var confidence = 'high';
    if (unseen || !trim(raw)) confidence = 'low';
    else if (missing.essential.length > 0 || caps.length === 0) confidence = 'medium';
    /* A greeting is fully understood even with no capability beyond
       conversation. */
    if (hasAnyWord(n, GREETING_WORDS) && vo.tokens.length <= 3) confidence = 'high';
    return {
      intent: intent,
      taskType: taskType,
      needsReasoning: reasoning,
      needsExternalInfo: external,
      capabilitiesNeeded: caps,
      missingInfo: missing.essential.concat(missing.optional),
      expectedOutput: output,
      planHint: planHintOf(vo, caps, unseen),
      classifierKind: classifierKind,
      classifierReason: classifierReason,
      unseen: unseen,
      confidence: confidence
    };
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: isUnseenRequest                                             */
  /* ------------------------------------------------------------------ */

  function isUnseenRequest(text, ctx) {
    var raw = asString(text);
    if (!trim(raw)) return false;
    var vo = extractVerbObject(raw);
    var n = vo.norm;
    var classifier = callClassifier(raw, ctx);
    var classifierKind = classifier ? classifier.kind : null;
    /* A known conversation phrase or definition is seen, even if no
       action verb matched. */
    if (classifierKind === 'conversation' || classifierKind === 'definition' ||
        classifierKind === 'research') return false;
    if (hasAnyWord(n, GREETING_WORDS)) return false;
    var caps = capabilitiesFor(vo, n, classifierKind);
    if (caps.length > 0) {
      /* A verb the map knows, or a deliverable noun, means the request
         is covered — unless the verb is the generic 'help'/'karo' with
         no object at all, which names no real task. */
      if (vo.verb && (vo.verb === 'help' || vo.verb === 'karo' || vo.verb === 'kar') && !vo.object) return true;
      return false;
    }
    /* ctx may name the capabilities that are known; if the caller
       supplies a list and none matches, that is unseen too. */
    if (ctx && Array.isArray(ctx.knownCapabilities) && ctx.knownCapabilities.length > 0) return true;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC: reasonAbout — trace as data, not prose                      */
  /* ------------------------------------------------------------------ */

  function reasonAbout(text, ctx) {
    var raw = asString(text);
    var vo = extractVerbObject(raw);
    var analysis = analyzeRequest(raw, ctx);
    var missing = assessMissingInfo(raw, ctx);
    var known = [];
    var i;
    if (vo.verb) known.push({ field: 'action', value: vo.verb });
    if (vo.object) known.push({ field: 'object', value: vo.object });
    if (analysis.classifierKind) known.push({ field: 'classifier-kind', value: analysis.classifierKind });
    if (ctx && typeof ctx.currentTopic === 'string' && trim(ctx.currentTopic)) {
      known.push({ field: 'context-topic', value: trim(ctx.currentTopic) });
    } else if (ctx && ctx.state && typeof ctx.state.currentTopic === 'string' && trim(ctx.state.currentTopic)) {
      known.push({ field: 'context-topic', value: trim(ctx.state.currentTopic) });
    }
    if (/\b\d+\b/.test(raw)) {
      var nums = raw.match(/\b\d+\b/g) || [];
      for (i = 0; i < nums.length; i++) known.push({ field: 'number', value: nums[i] });
    }
    var uncertainties = [];
    if (analysis.unseen) uncertainties.push('no-known-pattern-covers-this-request');
    if (missing.essential.length > 0) uncertainties.push('essential-information-missing');
    if (analysis.needsExternalInfo) uncertainties.push('external-information-may-be-outdated');
    if (!vo.verb && !vo.object) uncertainties.push('no-action-or-object-stated');

    var steps = [];
    steps.push('restate the request as intent: ' + analysis.intent);
    if (analysis.needsExternalInfo) steps.push('gather current information before answering');
    if (analysis.needsReasoning) steps.push('reason step by step about the parts');
    if (analysis.capabilitiesNeeded.indexOf('agents') !== -1) steps.push('split into parts and work on them in parallel');
    if (analysis.expectedOutput !== 'answer' && analysis.expectedOutput !== 'reply') {
      steps.push('produce the ' + analysis.expectedOutput);
    } else {
      steps.push('answer directly from what is known');
    }
    if (missing.essential.length > 0) steps.push('ask only for the essential missing information');
    steps.push('check the result before delivering it');

    var approach = [];
    if (analysis.unseen) {
      approach.push('best-effort: use the closest known capability');
      approach.push('state what is known and what is still missing');
      approach.push('deliver a partial result rather than refusing');
    } else if (analysis.capabilitiesNeeded.length > 0) {
      for (i = 0; i < analysis.capabilitiesNeeded.length; i++) {
        approach.push('use capability: ' + analysis.capabilitiesNeeded[i]);
      }
    } else {
      approach.push('answer directly from knowledge');
    }

    return {
      asked: { intent: analysis.intent, taskType: analysis.taskType,
        object: vo.object || null, verb: vo.verb || null,
        expectedOutput: analysis.expectedOutput },
      known: known,
      missing: { essential: missing.essential, optional: missing.optional },
      approach: approach,
      steps: steps,
      uncertainties: uncertainties,
      canProceed: missing.essential.length === 0,
      unseen: analysis.unseen
    };
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    analyzeRequest: analyzeRequest,
    reasonAbout: reasonAbout,
    isUnseenRequest: isUnseenRequest,
    assessMissingInfo: assessMissingInfo
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalReasoning = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalReasoning = api;
  } catch (e) { /* exposure is best-effort */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
