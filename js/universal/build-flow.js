
/* ============================================================================
 * ENAO AI — THE BUILD FLOW: think -> research -> ask -> build
 * Piece 08 (08-build-flow.js)
 * ----------------------------------------------------------------------------
 * Raja's rule (voice call, 22 Nov 2026 ~1:09 PM PKT): for ANY build,
 * ENZO follows this flow in order — (1) ENZO itself THINKS what to do
 * (plans the steps), (2) RESEARCHES the internet for what that kind of
 * website should be like, (3) then asks Raja QUESTIONS (Q&A — whatever
 * it understands/needs, in Raja's language), (4) only then BUILDS.
 * This flow applies to every website/app build, never just portfolio.
 *
 * What this piece does:
 *  - think(kind, command): ENZO's own thinking step. Returns an ordered
 *    list of steps it will take (what it will build, in what order, what
 *    it needs to find out). No network, no build yet.
 *  - researchStep(kind, researchFn): the research step. Takes an
 *    injected researchFn(query) (so tests can stub it; in the real app
 *    it calls the existing search backend). Issues at least one real
 *    research query about what that kind of site should be like and
 *    returns the findings with sources. Research findings are REQUIRED
 *    before Q&A — buildSpec refuses a plan that skipped research.
 *  - deriveQuestions(plan, research, knownInfo): questions for Raja,
 *    only about what is genuinely unknown or ambiguous. Never asks
 *    what is already known or what research already answered. Each
 *    question states why it is needed. Questions are in the user's
 *    language (Roman Urdu).
 *  - applyAnswers(plan, answers): fills the plan from Raja's answers.
 *    Unanswered items stay as editable placeholders, never invented.
 *  - buildSpec(plan): the final build spec handed to ENZO's agents
 *    (sections, content, design direction, placeholders). Enforces
 *    ordering: it refuses (returns an error object, never a spec) if
 *    the think / research / Q&A stages were skipped.
 *  - createBuildSession(kind, command): a small state machine with
 *    stages THINK -> RESEARCH -> ASK -> BUILD, with advance() guards
 *    so stages cannot be skipped or reordered.
 *
 * What it does NOT do:
 *  - No network of its own: research only happens through the injected
 *    researchFn. A missing researchFn is an error, never a silent skip.
 *  - No building: it produces the SPEC the agents build from. The
 *    actual build (06-agents split/parallel/assemble) is a later step.
 *  - No inventing: a field with no answer is a placeholder in the spec,
 *    never a made-up value.
 *
 * INTEGRATION POINT (07-universal-preset): piece 07 does not exist yet.
 * When it lands, the assembler should call
 * EnzoBuildFlow.setPresetProvider(function (kind) { return preset; })
 * with 07's preset for the kind (fields + design direction). Until
 * then think() uses the minimal built-in kind table below, and
 * buildSpec() uses the generic design direction from Raja's locked
 * rule (unique design every time, alive / 3D / animated, never a
 * repeat). setPresetProvider(null) restores the built-in table.
 *
 * Style: plain ES5, no dependencies, no emojis anywhere.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var STAGES = ['THINK', 'RESEARCH', 'ASK', 'BUILD'];

  /* Minimal kind table (standalone until 07 lands). Each kind lists the
     fields ENZO needs to know before it can build. A field is an object
     { id, label, question, why }. 'question' and 'why' are in Roman
     Urdu, the user's language. */
  var KIND_FIELDS = {
    portfolio: [
      { id: 'ownerName', label: 'Owner name',
        question: 'Portfolio kis ka hai — naam kya likhna hai?',
        why: 'Naam ke baghair portfolio kisi ka nahi lagta; ye asal maloomat hai, invent nahi kar sakte.' },
      { id: 'tagline', label: 'Tagline',
        question: 'Portfolio ki tagline kya ho — ek line mein aap kya karte hain?',
        why: 'Tagline pehli nazar mein batati hai ke aap kaun hain aur kya karte hain.' },
      { id: 'projects', label: 'Projects',
        question: 'Kaun se asal projects dikhane hain — naam aur ek line tafseel ke saath?',
        why: 'Sirf asal projects dikhaye jayenge; jo project nahi hai wo invent nahi hoga.' },
      { id: 'skills', label: 'Skills',
        question: 'Kaun si skills dikhani hain?',
        why: 'Skills se pata chalta hai ke aap kya kar sakte hain.' },
      { id: 'contact', label: 'Contact',
        question: 'Contact kaise ho — email ya koi aur tareeqa?',
        why: 'Log aap se rabta kaise karein, ye batana zaroori hai.' },
      { id: 'style', label: 'Style',
        question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
        why: 'Har website ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
    ],
    business: [
      { id: 'businessName', label: 'Business name',
        question: 'Business ka naam kya hai?',
        why: 'Naam ke baghair website pehchani nahi jayegi.' },
      { id: 'services', label: 'Services',
        question: 'Kaun si services dikhani hain?',
        why: 'Services hi website ka asal kaam hain.' },
      { id: 'audience', label: 'Audience',
        question: 'Website kis ke liye hai — kaun log aayenge?',
        why: 'Audience se design aur alfaz tay hote hain.' },
      { id: 'contact', label: 'Contact',
        question: 'Contact kaise ho — email, phone ya form?',
        why: 'Customer rabta kaise kare, ye batana zaroori hai.' },
      { id: 'style', label: 'Style',
        question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
        why: 'Har website ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
    ],
    blog: [
      { id: 'topic', label: 'Topic',
        question: 'Blog kis topic par hai?',
        why: 'Topic se sections aur content tay hota hai.' },
      { id: 'audience', label: 'Audience',
        question: 'Blog kis ke liye hai — kaun log parhenge?',
        why: 'Audience se alfaz aur design tay hote hain.' },
      { id: 'style', label: 'Style',
        question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
        why: 'Har website ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
    ],
    landing: [
      { id: 'product', label: 'Product',
        question: 'Landing page kis product ya offer ke liye hai?',
        why: 'Product ke baghair page ka maqsad samajh nahi aata.' },
      { id: 'audience', label: 'Audience',
        question: 'Page kis ke liye hai — kaun log aayenge?',
        why: 'Audience se alfaz aur design tay hote hain.' },
      { id: 'goal', label: 'Goal',
        question: 'Page ka maqsad kya hai — signup, khareedna, ya rabta?',
        why: 'Maqsad se button aur sections tay hote hain.' },
      { id: 'style', label: 'Style',
        question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
        why: 'Har website ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
    ],
    app: [
      { id: 'purpose', label: 'Purpose',
        question: 'App kis kaam ke liye hai — kya karegi?',
        why: 'Maqsad se features aur screens tay hote hain.' },
      { id: 'features', label: 'Features',
        question: 'Kaun se features hone chahiye?',
        why: 'Features hi app ka asal kaam hain.' },
      { id: 'audience', label: 'Audience',
        question: 'App kis ke liye hai — kaun log use karenge?',
        why: 'Audience se design aur alfaz tay hote hain.' },
      { id: 'style', label: 'Style',
        question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
        why: 'Har app ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
    ]
  };

  var GENERIC_FIELDS = [
    { id: 'purpose', label: 'Purpose',
      question: 'Is website ka maqsad kya hai — kis kaam ke liye hai?',
      why: 'Maqsad ke baghair sections aur design tay nahi ho sakte.' },
    { id: 'audience', label: 'Audience',
      question: 'Website kis ke liye hai — kaun log aayenge?',
      why: 'Audience se alfaz aur design tay hote hain.' },
    { id: 'sections', label: 'Sections',
      question: 'Kaun se sections hone chahiye?',
      why: 'Sections se website ka dhancha banta hai.' },
    { id: 'style', label: 'Style',
      question: 'Design kaisa ho — colours ya style ki koi pasand hai?',
      why: 'Har website ka design naya hota hai; aap ki pasand ho to wohi pehle rakhi jayegi.' }
  ];

  /* Generic design direction from Raja's locked rule (22 Nov 2026
     ~1:07 PM): design/UI/UX hamesha kamaal ka ho, 3D cheezein, har
     cheez hilti-julti, cards zinda lagain — website ZINDA lage, murda
     nahi; har website NAYE design ke saath bane, design repeat nahi. */
  var GENERIC_DESIGN = {
    style: 'unique',
    direction: 'Professional, alive design: 3D elements, moving and animated parts, cards that feel alive — the site must feel alive, not dead. A fresh design every time, never a repeat.',
    motion: 'animated',
    repeatDesign: false
  };

  var presetProvider = null; /* injected by the assembler once 07 lands */

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

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

  function normKind(kind) {
    return asString(kind).toLowerCase().replace(/^\s+|\s+$/g, '');
  }

  function isThenable(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function')
      && typeof v.then === 'function';
  }

  /* Fields for a kind: 07's preset provider wins when set, otherwise
     the built-in minimal table, otherwise the generic fields. Returns
     fresh copies so callers can never mutate the table. */
  function fieldsForKind(kind) {
    var k = normKind(kind);
    var raw = null;
    if (presetProvider) {
      try {
        var preset = presetProvider(k);
        if (preset && Array.isArray(preset.fields) && preset.fields.length > 0) {
          raw = preset.fields;
        }
      } catch (e) { raw = null; }
    }
    if (!raw) raw = KIND_FIELDS[k] || GENERIC_FIELDS;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var f = raw[i];
      if (!isPlainObject(f) || !asNonEmptyString(f.id)) continue;
      out.push({
        id: asString(f.id),
        label: asNonEmptyString(f.label) || asString(f.id),
        question: asNonEmptyString(f.question) ||
          ('Is ke baare mein kya batana hai — ' + asString(f.id) + '?'),
        why: asNonEmptyString(f.why) || 'Ye maloomat build ke liye zaroori hai.'
      });
    }
    return out;
  }

  function designForKind(kind) {
    var k = normKind(kind);
    if (presetProvider) {
      try {
        var preset = presetProvider(k);
        if (preset && isPlainObject(preset.design)) return preset.design;
      } catch (e) { /* fall through to generic */ }
    }
    return {
      style: GENERIC_DESIGN.style,
      direction: GENERIC_DESIGN.direction,
      motion: GENERIC_DESIGN.motion,
      repeatDesign: GENERIC_DESIGN.repeatDesign
    };
  }

  function newPlan(kind, command) {
    var k = normKind(kind) || 'website';
    var fields = fieldsForKind(k);
    var fieldStates = [];
    for (var i = 0; i < fields.length; i++) {
      fieldStates.push({
        id: fields[i].id,
        label: fields[i].label,
        question: fields[i].question,
        why: fields[i].why,
        value: null,
        known: false,
        placeholder: true,
        source: null /* 'known' | 'research' | 'answer' | null */
      });
    }
    return {
      kind: k,
      command: asNonEmptyString(command) || '',
      fields: fieldStates,
      steps: [],
      research: null,
      questions: [],
      _stages: { think: false, researched: false, asked: false, answered: false }
    };
  }

  function fieldById(plan, fieldId) {
    if (!plan || !Array.isArray(plan.fields)) return null;
    for (var i = 0; i < plan.fields.length; i++) {
      if (plan.fields[i].id === fieldId) return plan.fields[i];
    }
    return null;
  }

  function missingStages(plan) {
    var missing = [];
    if (!plan || !plan._stages) return ['think', 'research', 'qa'];
    if (!plan._stages.think) missing.push('think');
    if (!plan._stages.researched) missing.push('research');
    if (!plan._stages.asked) missing.push('qa');
    return missing;
  }

  /* ------------------------------------------------------------------ */
  /* 1. THINK — ENZO's own thinking step (no network, no build)         */
  /* ------------------------------------------------------------------ */

  function think(kind, oneLineCommand) {
    var k = normKind(kind) || 'website';
    var command = asNonEmptyString(oneLineCommand) || ('Build a ' + k + '.');
    var plan = newPlan(k, command);
    plan.steps = [
      { n: 1, title: 'Samajhna — command ko samajhna',
        detail: 'Raja ne kya banane ko kaha hai: "' + command + '". Kind: ' + k + '.' },
      { n: 2, title: 'Plan banana — sections aur order tay karna',
        detail: 'Website ke sections aur un ka order tay karna, pehle se set standards ke mutabiq.' },
      { n: 3, title: 'Research karna — is qisam ki website kaisi hoti hai',
        detail: 'Internet se dekhna ke ' + k + ' website mein kya sections, standards aur design hote hain.' },
      { n: 4, title: 'Sawal poochhna — jo maloom nahi, Raja se poochhna',
        detail: 'Sirf wohi poochhna jo maloom nahi ya research se jawab nahi mila.' },
      { n: 5, title: 'Jawab se plan bharna — placeholder, kabhi invent nahi',
        detail: 'Raja ke jawab plan mein bharna; jo jawab na mile wo editable placeholder rahega.' },
      { n: 6, title: 'Build spec dena — agents ko spec dena',
        detail: 'Sections, asal content, design direction aur placeholders ki spec agents ko dena.' },
      { n: 7, title: 'Build karna — agents parallel, phir join',
        detail: 'ENZO ke agents hisson mein banayen, parallel chalaye, phir results jod kar final de.' }
    ];
    plan._stages.think = true;
    return plan;
  }

  /* ------------------------------------------------------------------ */
  /* 2. RESEARCH — at least one real query, findings with sources       */
  /* ------------------------------------------------------------------ */

  function researchQueries(kind) {
    var k = normKind(kind) || 'website';
    return [
      'what should a ' + k + ' website include sections',
      'best ' + k + ' website design standards examples'
    ];
  }

  /* Normalise one researchFn result into { text, sources, answered }.
     Never invents a URL: sources come only from url/link fields the
     result actually carries. A finding may also carry field answers
     ({ field, value }) — those count as research-answered. */
  function normaliseFinding(query, raw) {
    var text = '';
    var sources = [];
    var answered = {};
    if (typeof raw === 'string') {
      text = raw;
    } else if (Array.isArray(raw)) {
      var parts = [];
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i];
        if (typeof item === 'string') {
          parts.push(item);
        } else if (isPlainObject(item)) {
          if (asNonEmptyString(item.snippet)) parts.push(item.snippet);
          else if (asNonEmptyString(item.text)) parts.push(item.text);
          else if (asNonEmptyString(item.title)) parts.push(item.title);
          var url = asNonEmptyString(item.url) || asNonEmptyString(item.link);
          if (url && sources.indexOf(url) === -1) sources.push(url);
          if (asNonEmptyString(item.field) && asNonEmptyString(item.value)) {
            answered[item.field] = item.value;
          }
        }
      }
      text = parts.join(' ');
    } else if (isPlainObject(raw)) {
      if (Array.isArray(raw.findings)) {
        var sub = normaliseFinding(query, raw.findings);
        text = sub.text;
        sources = sub.sources;
        answered = sub.answered;
      } else if (asNonEmptyString(raw.text)) {
        text = raw.text;
      } else if (asNonEmptyString(raw.snippet)) {
        text = raw.snippet;
      } else if (asNonEmptyString(raw.summary)) {
        text = raw.summary;
      }
      if (Array.isArray(raw.sources)) {
        for (var j = 0; j < raw.sources.length; j++) {
          var s = raw.sources[j];
          var u = (typeof s === 'string') ? s : (isPlainObject(s) ? asNonEmptyString(s.url) : null);
          if (u && sources.indexOf(u) === -1) sources.push(u);
        }
      }
      if (isPlainObject(raw.answered)) {
        var keys = Object.keys(raw.answered);
        for (var a = 0; a < keys.length; a++) {
          if (asNonEmptyString(raw.answered[keys[a]])) {
            answered[keys[a]] = raw.answered[keys[a]];
          }
        }
      }
    }
    return { query: query, text: text, sources: sources, answered: answered };
  }

  function finishResearch(kind, queries, findings) {
    var sources = [];
    var answered = {};
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      for (var s = 0; s < f.sources.length; s++) {
        if (sources.indexOf(f.sources[s]) === -1) sources.push(f.sources[s]);
      }
      var keys = Object.keys(f.answered);
      for (var a = 0; a < keys.length; a++) {
        if (!(keys[a] in answered)) answered[keys[a]] = f.answered[keys[a]];
      }
    }
    return {
      kind: normKind(kind) || 'website',
      queries: queries,
      findings: findings,
      sources: sources,
      answered: answered
    };
  }

  /* researchStep(kind, researchFn): researchFn(query) is called with
     at least one real query about what that kind of site should be
     like. Returns the findings object, or { ok: false, error } when
     researchFn is missing or throws. If researchFn returns a Promise
     for any query, a Promise is returned instead (same shape). */
  function researchStep(kind, researchFn) {
    if (typeof researchFn !== 'function') {
      return { ok: false, error: 'researchFn is required — research cannot be skipped' };
    }
    var queries = researchQueries(kind);
    var results = [];
    var async = false;
    for (var i = 0; i < queries.length; i++) {
      var raw;
      try {
        raw = researchFn(queries[i]);
      } catch (e) {
        return { ok: false, error: 'research failed for query "' + queries[i] + '": ' + (e && e.message ? e.message : String(e)) };
      }
      if (isThenable(raw)) async = true;
      results.push(raw);
    }
    if (!async) {
      var findings = [];
      for (var j = 0; j < queries.length; j++) {
        findings.push(normaliseFinding(queries[j], results[j]));
      }
      return finishResearch(kind, queries, findings);
    }
    return Promise.all(results.map(function (r) { return Promise.resolve(r); }))
      .then(function (resolved) {
        var findings = [];
        for (var k = 0; k < queries.length; k++) {
          findings.push(normaliseFinding(queries[k], resolved[k]));
        }
        return finishResearch(kind, queries, findings);
      });
  }

  /* ------------------------------------------------------------------ */
  /* 3. Q&A — questions only about what is genuinely unknown            */
  /* ------------------------------------------------------------------ */

  /* deriveQuestions(plan, research, knownInfo): knownInfo is
     { fieldId: value } of things already known. research may carry
     .answered { fieldId: value } for things research already answered.
     Returns { questions, asked, skippedKnown, skippedResearched }.
     A question is { id, field, label, question, why, lang }. */
  function deriveQuestions(plan, research, knownInfo) {
    if (!plan || !Array.isArray(plan.fields)) {
      return { ok: false, error: 'a plan from think() is required before questions' };
    }
    /* Research findings are REQUIRED before Q&A: questions must never
       be asked from think alone. A research object with zero findings
       is fine (research ran and found nothing, honestly); a missing
       research object means the stage was skipped. */
    if (!isPlainObject(research) ||
        (!Array.isArray(research.findings) && !Array.isArray(research.queries))) {
      return { ok: false, error: 'research findings are required before questions — run researchStep first' };
    }
    var known = isPlainObject(knownInfo) ? knownInfo : {};
    var answered = (research && isPlainObject(research.answered)) ? research.answered : {};
    var questions = [];
    var asked = [];
    var skippedKnown = [];
    var skippedResearched = [];

    for (var i = 0; i < plan.fields.length; i++) {
      var f = plan.fields[i];
      var knownValue = asNonEmptyString(known[f.id]);
      if (knownValue !== null) {
        f.value = knownValue;
        f.known = true;
        f.placeholder = false;
        f.source = 'known';
        skippedKnown.push(f.id);
        continue;
      }
      if (f.value !== null && f.value !== '') {
        skippedKnown.push(f.id);
        continue;
      }
      var researchValue = asNonEmptyString(answered[f.id]);
      if (researchValue !== null) {
        f.value = researchValue;
        f.known = true;
        f.placeholder = false;
        f.source = 'research';
        skippedResearched.push(f.id);
        continue;
      }
      questions.push({
        id: 'q_' + f.id,
        field: f.id,
        label: f.label,
        question: f.question,
        why: f.why,
        lang: 'roman'
      });
      asked.push(f.id);
    }
    plan.questions = questions;
    plan._stages.asked = true;
    return {
      questions: questions,
      asked: asked,
      skippedKnown: skippedKnown,
      skippedResearched: skippedResearched
    };
  }

  /* ------------------------------------------------------------------ */
  /* 4. ANSWERS — fill the plan; unanswered stay placeholders           */
  /* ------------------------------------------------------------------ */

  /* applyAnswers(plan, answers): answers is { fieldId: value }. A
     blank or missing answer leaves the field as an editable
     placeholder — it is never invented. Returns the plan. */
  function applyAnswers(plan, answers) {
    if (!plan || !Array.isArray(plan.fields)) return plan;
    var map = isPlainObject(answers) ? answers : {};
    for (var i = 0; i < plan.fields.length; i++) {
      var f = plan.fields[i];
      var v = asNonEmptyString(map[f.id]);
      if (v !== null) {
        f.value = v;
        f.known = true;
        f.placeholder = false;
        f.source = 'answer';
      }
    }
    if (plan._stages) plan._stages.answered = true;
    return plan;
  }

  /* ------------------------------------------------------------------ */
  /* 5. BUILD SPEC — refuses when any stage was skipped                  */
  /* ------------------------------------------------------------------ */

  /* buildSpec(plan): returns { ok: true, spec } on success, or
     { ok: false, error, missing } when think / research / Q&A was
     skipped. Never returns a spec for an incomplete flow. */
  function buildSpec(plan) {
    var missing = missingStages(plan);
    if (missing.length > 0) {
      return {
        ok: false,
        error: 'Build flow incomplete — missing stage(s): ' + missing.join(', ') +
          '. Follow the flow: think, then research, then questions, then build.',
        missing: missing
      };
    }
    var content = {};
    var placeholders = [];
    var sections = [];
    for (var i = 0; i < plan.fields.length; i++) {
      var f = plan.fields[i];
      if (f.value !== null && f.value !== '') {
        content[f.id] = f.value;
      } else {
        content[f.id] = { placeholder: true, label: f.label, editable: true };
        placeholders.push(f.id);
      }
      sections.push(f.label);
    }
    var spec = {
      kind: plan.kind,
      command: plan.command,
      sections: sections,
      content: content,
      placeholders: placeholders,
      design: designForKind(plan.kind),
      steps: plan.steps,
      research: plan.research
        ? { queries: plan.research.queries, sources: plan.research.sources }
        : null,
      questionsAsked: plan.questions ? plan.questions.length : 0
    };
    return { ok: true, spec: spec };
  }

  /* needsResearch(plan): true when the plan has no research findings
     yet — the flow must not go from think straight to build. */
  function needsResearch(plan) {
    if (!plan || !plan._stages) return true;
    return !plan._stages.researched;
  }

  /* ------------------------------------------------------------------ */
  /* 6. STATE MACHINE — THINK -> RESEARCH -> ASK -> BUILD               */
  /* ------------------------------------------------------------------ */

  function createBuildSession(kind, command) {
    var session = {
      kind: normKind(kind) || 'website',
      command: asNonEmptyString(command) || '',
      stage: 'THINK',
      plan: null,
      research: null,
      questions: null,
      spec: null
    };

    function guardError(target) {
      return {
        ok: false,
        error: 'Cannot move to ' + target + ' from stage ' + session.stage +
          '. The flow is THINK -> RESEARCH -> ASK -> BUILD, in order.',
        stage: session.stage
      };
    }

    session.getStage = function () { return session.stage; };
    session.needsResearch = function () { return needsResearch(session.plan); };

    session.think = function () {
      if (session.stage !== 'THINK') return guardError('RESEARCH');
      session.plan = think(session.kind, session.command);
      session.stage = 'RESEARCH';
      return { ok: true, stage: session.stage, plan: session.plan };
    };

    /* research(researchFn): runs researchStep and attaches the
       findings to the plan. Accepts a sync or async researchFn; when
       async, returns a Promise with the same shape. */
    session.research = function (researchFn) {
      if (session.stage !== 'RESEARCH') return guardError('ASK');
      var out = researchStep(session.kind, researchFn);
      if (isThenable(out)) {
        return out.then(function (res) {
          if (res && res.ok === false) return res;
          session.plan.research = res;
          session.plan._stages.researched = true;
          session.research = res;
          session.stage = 'ASK';
          return { ok: true, stage: session.stage, research: res };
        });
      }
      if (out && out.ok === false) return out;
      session.plan.research = out;
      session.plan._stages.researched = true;
      session.research = out;
      session.stage = 'ASK';
      return { ok: true, stage: session.stage, research: out };
    };

    /* ask(knownInfo): derives the questions for Raja. Stays in ASK
       until build() is called; answer() may be called first. */
    session.ask = function (knownInfo) {
      if (session.stage !== 'ASK') return guardError('ASK');
      var out = deriveQuestions(session.plan, session.research, knownInfo);
      if (out && out.ok === false) return out;
      session.questions = out.questions;
      return { ok: true, stage: session.stage, questions: out.questions,
               skippedKnown: out.skippedKnown,
               skippedResearched: out.skippedResearched };
    };

    /* answer(answers): fills the plan from Raja's answers. Only valid
       in ASK, after ask() derived the questions. */
    session.answer = function (answers) {
      if (session.stage !== 'ASK') return guardError('ASK');
      if (!session.plan._stages.asked) {
        return { ok: false, error: 'Ask the questions first — call ask() before answer().', stage: session.stage };
      }
      applyAnswers(session.plan, answers);
      return { ok: true, stage: session.stage, plan: session.plan };
    };

    /* build(): hands the spec to the agents. Only valid in ASK after
       ask() — and buildSpec itself re-checks every stage. */
    session.build = function () {
      if (session.stage !== 'ASK') return guardError('BUILD');
      var out = buildSpec(session.plan);
      if (out && out.ok === false) {
        out.stage = session.stage;
        return out;
      }
      session.spec = out.spec;
      session.stage = 'BUILD';
      return { ok: true, stage: session.stage, spec: out.spec };
    };

    /* advance(target, arg): the guarded transition. target is one of
       'RESEARCH', 'ASK', 'BUILD'. 'RESEARCH' runs think(); 'ASK' runs
       researchStep with arg = researchFn; 'BUILD' runs build() (arg =
       { knownInfo, answers } is applied first when questions were not
       yet derived, or answers when they were). Any skip, reorder or
       backwards move returns { ok: false, error } and changes nothing. */
    session.advance = function (target, arg) {
      if (target === 'RESEARCH') {
        if (session.stage !== 'THINK') return guardError('RESEARCH');
        return session.think();
      }
      if (target === 'ASK') {
        if (session.stage !== 'RESEARCH') return guardError('ASK');
        return session.research(arg);
      }
      if (target === 'BUILD') {
        if (session.stage !== 'ASK') return guardError('BUILD');
        if (!session.plan._stages.asked) {
          var opts = isPlainObject(arg) ? arg : {};
          var asked = session.ask(opts.knownInfo || {});
          if (asked && asked.ok === false) return asked;
          if (opts.answers) session.answer(opts.answers);
        } else if (isPlainObject(arg) && arg.answers) {
          session.answer(arg.answers);
        }
        return session.build();
      }
      return {
        ok: false,
        error: 'Unknown target stage "' + asString(target) +
          '" — valid targets are RESEARCH, ASK, BUILD.',
        stage: session.stage
      };
    };

    return session;
  }

  /* ------------------------------------------------------------------ */
  /* Preset provider (07 integration point)                              */
  /* ------------------------------------------------------------------ */

  function setPresetProvider(fn) {
    presetProvider = (typeof fn === 'function') ? fn : null;
    return presetProvider !== null;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  var api = {
    STAGES: STAGES,
    think: think,
    researchStep: researchStep,
    researchQueries: researchQueries,
    deriveQuestions: deriveQuestions,
    applyAnswers: applyAnswers,
    buildSpec: buildSpec,
    needsResearch: needsResearch,
    createBuildSession: createBuildSession,
    setPresetProvider: setPresetProvider,
    fieldsForKind: fieldsForKind
  };

  try {
    if (typeof window !== 'undefined') window.EnzoBuildFlow = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoBuildFlow = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
