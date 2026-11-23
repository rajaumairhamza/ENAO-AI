
/* ============================================================================
 * ENAO AI — UNIVERSAL INTELLIGENCE ENGINE, Piece E1: GENERATION
 * File: 18-generation.js  (section 8 of the universal-intel audit)
 * ----------------------------------------------------------------------------
 * What this piece does:
 *  - detectOutputType(text, ctx): what deliverable the request expects,
 *    read from the request's own words — written content, document,
 *    report, presentation, design, image, website, app, software,
 *    code, data output, or a structured file. No fixed template is
 *    assumed: the type comes from the words in the request, and an
 *    unmatched request returns type null with gap 'unknown-output'
 *    instead of a guessed type.
 *  - planGeneration(request, ctx): the ordered generation stages
 *    (plan -> research -> design -> generate -> test -> revise), with
 *    only the stages the request actually needs. A stage that is not
 *    needed is listed under `skipped` with its reason, never silently
 *    dropped and never run for show.
 *  - supportedFormats(outputType): the exact formats this app can
 *    actually produce. It never claims a format it cannot produce:
 *    binary / native formats (pdf, docx, pptx, xlsx), image, audio,
 *    video and compiled-app files are listed under `unsupported`
 *    with the reason, not hidden.
 *  - generationChecklist(outputType): what must be checked about an
 *    output of that type before it is delivered.
 *
 * What it does NOT do:
 *  - No generating of its own: it detects, plans and checks. The
 *    actual generation is done by the agents / build flow (pieces
 *    06/07/08) and the answering pipeline, fed by planGeneration.
 *  - No internet research itself, no invented facts, no invented
 *    sources or numbers. A checklist check that needs a source can
 *    only pass when a real source is supplied by the caller.
 *  - No hardcoded topics: the same words work for any subject, and
 *    the harness proves topic-invariance across unrelated subjects.
 *
 * Style: plain ES5, no dependencies, no network, no DOM, no emojis.
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = 'universal-e1-generation-v1';

  /* ------------------------------------------------------------------ */
  /* Small helpers (same shape as 07-universal-preset.js)                */
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

  function normText(text) {
    var s = asString(text).toLowerCase();
    s = s.replace(/[\u0600-\u06FF]+/g, function (m) { return ' ' + m + ' '; });
    s = s.replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* OUTPUT_TYPES registry                                               */
  /* ------------------------------------------------------------------ */
  /* Order matters for ties: on an equal keyword score the earlier
     (more specific) entry wins, exactly like 07-universal-preset.js.
     So 'write a report' is a report, not generic written content;
     'write python code' is code, not generic written content; and a
     bare 'write something' is written content. Each entry lists the
     words in the request that name that deliverable — nothing else
     decides the type. */
  var OUTPUT_TYPES = [
    {
      id: 'presentation', label: 'Presentation',
      keywords: ['presentation', 'slide deck', 'slides', 'slide', 'powerpoint', 'ppt', 'keynote', 'deck']
    },
    {
      id: 'report', label: 'Report',
      keywords: ['research report', 'summary report', 'report', 'findings report']
    },
    {
      id: 'document', label: 'Document',
      keywords: ['word document', 'document', 'pdf', 'handbook', 'manual', 'guide', 'doc']
    },
    {
      id: 'structured_file', label: 'Structured file',
      keywords: ['spreadsheet', 'json file', 'csv file', 'table file', 'excel', 'csv', 'json']
    },
    {
      id: 'website', label: 'Website',
      keywords: ['landing page', 'web page', 'webpage', 'website', 'web site', 'homepage', 'site']
    },
    {
      id: 'app', label: 'App',
      keywords: ['mobile app', 'android app', 'ios app', 'iphone app', 'app']
    },
    {
      id: 'software', label: 'Software',
      keywords: ['desktop program', 'computer program', 'software', 'program', 'system', 'tool', 'platform']
    },
    {
      id: 'code', label: 'Code',
      keywords: ['python code', 'javascript code', 'html code', 'css code', 'code', 'coding', 'function', 'debug', 'snippet', 'python', 'javascript']
    },
    {
      id: 'image', label: 'Image',
      keywords: ['thumbnail', 'illustration', 'photograph', 'image', 'picture', 'photo', 'logo', 'banner', 'drawing', 'avatar', 'icon']
    },
    {
      id: 'design', label: 'Design',
      keywords: ['ui design', 'layout design', 'card design', 'cover design', 'design', 'poster', 'flyer', 'brochure', 'mockup']
    },
    {
      id: 'data', label: 'Data output',
      keywords: ['data analysis', 'analyse data', 'analyze data', 'dataset', 'statistics', 'chart', 'graph', 'insights', 'data']
    },
    {
      id: 'written', label: 'Written content',
      keywords: ['blog post', 'article', 'story', 'essay', 'poem', 'caption', 'email', 'letter', 'summary', 'summarise', 'summarize', 'paragraph', 'novel', 'speech', 'script', 'content', 'text', 'write']
    }
  ];

  var TYPE_BY_ID = {};
  (function () {
    var i;
    for (i = 0; i < OUTPUT_TYPES.length; i++) {
      TYPE_BY_ID[OUTPUT_TYPES[i].id] = OUTPUT_TYPES[i];
    }
  })();

  function getOutputType(typeId) {
    return TYPE_BY_ID[asString(typeId)] || null;
  }

  function listOutputTypes() {
    var out = [];
    var i;
    for (i = 0; i < OUTPUT_TYPES.length; i++) out.push(OUTPUT_TYPES[i].id);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* detectOutputType(text, ctx)                                         */
  /* ------------------------------------------------------------------ */
  /* Returns { type, label, confidence, matched, gap, note }.
     type is null when nothing in the request names a deliverable —
     the piece never guesses. confidence is 0 when nothing matched,
     0.6 for one single-word match, 0.8 for a phrase or two matches,
     1 for a strong (phrase + word, or 3+ matches) signal. */
  function detectOutputType(text, ctx) {
    var raw = asString(text);
    var base = {
      type: null, label: null, confidence: 0,
      matched: [], gap: null, note: null
    };
    var n = normText(raw);
    if (!n) {
      base.gap = 'empty';
      base.note = 'No request text was given, so no deliverable can be detected.';
      return base;
    }
    var padded = ' ' + n + ' ';
    var best = null;
    var bestScore = 0;
    var bestMatched = [];
    var i, j;
    for (i = 0; i < OUTPUT_TYPES.length; i++) {
      var entry = OUTPUT_TYPES[i];
      var score = 0;
      var matched = [];
      for (j = 0; j < entry.keywords.length; j++) {
        var kw = normText(entry.keywords[j]);
        if (!kw) continue;
        if (kw.indexOf(' ') !== -1) {
          if (padded.indexOf(' ' + kw + ' ') !== -1) {
            score += kw.split(' ').length * 2;
            matched.push(entry.keywords[j]);
          }
        } else if (padded.indexOf(' ' + kw + ' ') !== -1) {
          score += 2;
          matched.push(entry.keywords[j]);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = entry;
        bestMatched = matched;
      }
    }
    if (!best) {
      base.gap = 'unknown-output';
      base.note = 'No deliverable is named in this request — ask what should be produced instead of guessing.';
      return base;
    }
    base.type = best.id;
    base.label = best.label;
    base.matched = bestMatched;
    base.confidence = bestScore >= 6 ? 1 : (bestScore >= 4 ? 0.8 : 0.6);
    return base;
  }

  /* ------------------------------------------------------------------ */
  /* Generation stages                                                   */
  /* ------------------------------------------------------------------ */
  /* Canonical order, never reordered: plan -> research -> design ->
     generate -> test -> revise. planGeneration returns only the
     stages the request needs, in this order, and lists the rest
     under `skipped` with a reason. */
  var GENERATION_STAGES = [
    { id: 'plan', name: 'Plan', what: 'Decide what will be produced, in what order, and what is still unknown.' },
    { id: 'research', name: 'Research', what: 'Gather the real facts, sources or examples the output depends on.' },
    { id: 'design', name: 'Design', what: 'Decide the shape, layout and look before anything is generated.' },
    { id: 'generate', name: 'Generate', what: 'Produce the output from the plan, the research and the design.' },
    { id: 'test', name: 'Test', what: 'Check the output actually works: renders, runs, parses, or adds up.' },
    { id: 'revise', name: 'Revise', what: 'Fix what the test found and polish the output before delivery.' }
  ];

  var STAGE_BY_ID = {};
  (function () {
    var i;
    for (i = 0; i < GENERATION_STAGES.length; i++) {
      STAGE_BY_ID[GENERATION_STAGES[i].id] = GENERATION_STAGES[i];
    }
  })();

  /* Which stages each output type needs, beyond plan + generate
     (which every generation needs). Research is needed where the
     output must be grounded in real facts; design where the output
     has a visible shape; test where the output is machine-checkable
     (it renders, runs, parses, or adds up). Revise follows test,
     or a request that itself asks for a draft / revision. */
  var RESEARCH_TYPES = ['report', 'presentation', 'website', 'app', 'software', 'data', 'document', 'written'];
  var DESIGN_TYPES = ['website', 'app', 'software', 'presentation', 'design', 'image', 'document', 'report'];
  var TEST_TYPES = ['website', 'app', 'software', 'code', 'data', 'structured_file'];

  function hasWord(text, pattern) {
    return pattern.test(asString(text).toLowerCase());
  }

  /* ------------------------------------------------------------------ */
  /* planGeneration(request, ctx)                                        */
  /* ------------------------------------------------------------------ */
  /* request: a string, or { text, outputType } / { text, type }.
     ctx: optional { outputType } override, or { needsResearch,
     needsDesign, needsTest } hints from the caller. Returns
     { outputType, outputLabel, stages, stageIds, skipped,
       confidence, gap }. */
  function planGeneration(request, ctx) {
    var reqText = '';
    var reqType = null;
    if (typeof request === 'string') {
      reqText = request;
    } else if (isPlainObject(request)) {
      reqText = asString(request.text || request.request || '');
      reqType = asNonEmptyString(request.outputType || request.type || null);
    } else {
      reqText = asString(request);
    }
    var context = isPlainObject(ctx) ? ctx : {};
    if (!reqType) reqType = asNonEmptyString(context.outputType || context.type || null);

    var detected = null;
    if (reqType && getOutputType(reqType)) {
      detected = { type: reqType, label: getOutputType(reqType).label, confidence: 1, matched: [], gap: null };
    } else {
      detected = detectOutputType(reqText, context);
    }

    var type = detected.type;
    var wantsResearch = hasWord(reqText, /\b(research|investigat\w*|latest|sources?|compare|find out|look up)\b/);
    var wantsDesign = hasWord(reqText, /\b(design|layout|style|look|colour|color|theme)\b/);
    var wantsTest = hasWord(reqText, /\b(test|verify|check|validate|try it|run it)\b/);
    var wantsRevise = hasWord(reqText, /\b(revise|improve|review|draft|polish|fix|rewrite)\b/);

    var needResearch = RESEARCH_TYPES.indexOf(type) !== -1 || wantsResearch;
    var needDesign = DESIGN_TYPES.indexOf(type) !== -1 || wantsDesign;
    var needTest = TEST_TYPES.indexOf(type) !== -1 || wantsTest;
    if (typeof context.needsResearch === 'boolean') needResearch = context.needsResearch;
    if (typeof context.needsDesign === 'boolean') needDesign = context.needsDesign;
    if (typeof context.needsTest === 'boolean') needTest = context.needsTest;
    var needRevise = needTest || wantsRevise;

    var stages = [];
    var skipped = [];
    var i;
    for (i = 0; i < GENERATION_STAGES.length; i++) {
      var stage = GENERATION_STAGES[i];
      var needed = false;
      var reason = '';
      if (stage.id === 'plan') { needed = true; }
      else if (stage.id === 'research') { needed = needResearch; reason = 'This output does not depend on external facts.'; }
      else if (stage.id === 'design') { needed = needDesign; reason = 'This output has no visible shape to design.'; }
      else if (stage.id === 'generate') { needed = true; }
      else if (stage.id === 'test') { needed = needTest; reason = 'This output is not machine-checkable (it does not render, run, parse or add up).'; }
      else if (stage.id === 'revise') { needed = needRevise; reason = 'Nothing was tested and no revision was asked for.'; }
      if (needed) {
        stages.push({ id: stage.id, name: stage.name, what: stage.what });
      } else {
        skipped.push({ id: stage.id, reason: reason });
      }
    }

    var stageIds = [];
    for (i = 0; i < stages.length; i++) stageIds.push(stages[i].id);

    return {
      outputType: type,
      outputLabel: type ? getOutputType(type).label : null,
      stages: stages,
      stageIds: stageIds,
      skipped: skipped,
      confidence: detected.confidence,
      gap: detected.gap
    };
  }

  /* ------------------------------------------------------------------ */
  /* supportedFormats(outputType) — honesty about what can be made     */
  /* ------------------------------------------------------------------ */
  /* This app is a chat assistant that can deliver text and single
     HTML pages. It can produce plain text, markdown, HTML and
     plain-text data/code files. It CANNOT produce binary or native
     files (pdf, docx, pptx, xlsx), image, audio or video files, or
     compiled apps — those are listed as unsupported with the reason,
     and must never be promised. An image request therefore has no
     supported format here: the honest answer is an HTML/text
     alternative, not a claimed image file. */
  var SUPPORTED_FORMATS = [
    { id: 'text', label: 'Plain text', how: 'Delivered as a chat answer.' },
    { id: 'markdown', label: 'Markdown', how: 'Delivered as a chat answer, rendered by the chat.' },
    { id: 'html', label: 'HTML document / page (single file)', how: 'Delivered as a single HTML file or page.' },
    { id: 'json', label: 'JSON (plain text)', how: 'Delivered as plain-text JSON content.' },
    { id: 'csv', label: 'CSV (plain text)', how: 'Delivered as plain-text CSV content.' },
    { id: 'code', label: 'Code file (plain text)', how: 'Delivered as plain-text source code.' }
  ];

  var UNSUPPORTED_FORMATS = [
    { id: 'pdf', label: 'PDF', reason: 'A binary document format this app cannot produce.' },
    { id: 'docx', label: 'Word document (docx)', reason: 'A binary document format this app cannot produce.' },
    { id: 'pptx', label: 'PowerPoint (pptx)', reason: 'A binary presentation format this app cannot produce.' },
    { id: 'xlsx', label: 'Excel workbook (xlsx)', reason: 'A binary spreadsheet format this app cannot produce.' },
    { id: 'png', label: 'PNG image', reason: 'An image file this app cannot generate.' },
    { id: 'jpg', label: 'JPG image', reason: 'An image file this app cannot generate.' },
    { id: 'mp4', label: 'MP4 video', reason: 'A video file this app cannot generate.' },
    { id: 'mp3', label: 'MP3 audio', reason: 'An audio file this app cannot generate.' },
    { id: 'apk', label: 'Android app package (apk)', reason: 'A compiled app this app cannot build or package.' },
    { id: 'exe', label: 'Windows program (exe)', reason: 'A compiled program this app cannot build or package.' }
  ];

  /* Formats that fit each output type, as ids from SUPPORTED_FORMATS.
     'image' maps to none: no format here can carry an image file. */
  var FORMATS_BY_TYPE = {
    written: ['text', 'markdown'],
    document: ['text', 'markdown', 'html'],
    report: ['text', 'markdown', 'html'],
    presentation: ['html', 'markdown'],
    design: ['html', 'text'],
    image: [],
    website: ['html'],
    app: ['code', 'html'],
    software: ['code'],
    code: ['code'],
    data: ['json', 'csv', 'text'],
    structured_file: ['json', 'csv']
  };

  function supportedFormats(outputType) {
    var type = asString(outputType || '');
    var wanted = null;
    if (type && FORMATS_BY_TYPE.hasOwnProperty(type)) wanted = FORMATS_BY_TYPE[type];
    var supported = [];
    var i, j;
    /* When a type is given, keep the type's own format order;
       otherwise list every supported format in registry order. */
    if (wanted) {
      for (i = 0; i < wanted.length; i++) {
        for (j = 0; j < SUPPORTED_FORMATS.length; j++) {
          if (SUPPORTED_FORMATS[j].id === wanted[i]) {
            supported.push({
              id: SUPPORTED_FORMATS[j].id,
              label: SUPPORTED_FORMATS[j].label,
              how: SUPPORTED_FORMATS[j].how
            });
          }
        }
      }
    } else {
      for (i = 0; i < SUPPORTED_FORMATS.length; i++) {
        supported.push({
          id: SUPPORTED_FORMATS[i].id,
          label: SUPPORTED_FORMATS[i].label,
          how: SUPPORTED_FORMATS[i].how
        });
      }
    }
    var supportedIds = [];
    for (j = 0; j < supported.length; j++) supportedIds.push(supported[j].id);
    var unsupported = [];
    for (i = 0; i < UNSUPPORTED_FORMATS.length; i++) {
      unsupported.push({
        id: UNSUPPORTED_FORMATS[i].id,
        label: UNSUPPORTED_FORMATS[i].label,
        reason: UNSUPPORTED_FORMATS[i].reason
      });
    }
    var unsupportedIds = [];
    for (j = 0; j < unsupported.length; j++) unsupportedIds.push(unsupported[j].id);
    var note = null;
    if (type === 'image') {
      note = 'No supported format can carry an image file — offer an HTML/text alternative instead of claiming an image file.';
    } else if (type && !FORMATS_BY_TYPE.hasOwnProperty(type)) {
      note = 'Unknown output type — showing every format this app can produce.';
    }
    return {
      outputType: type || null,
      supported: supported,
      supportedIds: supportedIds,
      unsupported: unsupported,
      unsupportedIds: unsupportedIds,
      note: note
    };
  }

  /* ------------------------------------------------------------------ */
  /* generationChecklist(outputType)                                     */
  /* ------------------------------------------------------------------ */
  /* What must be checked about an output of this type before it is
     delivered. Every list ends with the two checks that apply to
     every output: it answers the request that was actually made,
     and it contains no invented fact, name, number or source. An
     unknown type gets the generic list only, with gap
     'unknown-output'. */
  var GENERIC_CHECKS = [
    { id: 'answers-request', check: 'It answers the request that was actually made.', why: 'An output that answers a different request is wrong even if it looks finished.' },
    { id: 'no-invented-facts', check: 'It contains no invented fact, name, number or source.', why: 'Anything not given by the user or found in real research must be a marked placeholder, never a guessed value.' },
    { id: 'complete', check: 'Nothing the request asked for is missing.', why: 'A partial delivery must say what is missing instead of looking complete.' },
    { id: 'language', check: 'It is in the language the request was made in.', why: 'The wrong language is a wrong delivery.' }
  ];

  var CHECKS_BY_TYPE = {
    written: [
      { id: 'on-topic', check: 'It stays on the topic the request named.', why: 'Off-topic writing does not answer the request.' },
      { id: 'readable', check: 'It reads clearly, with correct spelling and grammar.', why: 'Errors in the writing are errors in the delivery.' }
    ],
    document: [
      { id: 'sections', check: 'Every section the request asked for is present, in order.', why: 'A document with missing sections is incomplete.' },
      { id: 'renders', check: 'The document renders correctly in its format (text, markdown or HTML).', why: 'Broken formatting is a broken document.' },
      { id: 'no-fake-content', check: 'No section is filled with invented content presented as real.', why: 'Unknown content must stay a marked placeholder.' }
    ],
    report: [
      { id: 'sources-real', check: 'Every source cited is real and was actually used.', why: 'A cited source that does not exist is a fabricated claim.' },
      { id: 'numbers-traceable', check: 'Every number can be traced back to a source.', why: 'An untraceable number cannot be trusted.' },
      { id: 'conclusion-follows', check: 'The conclusion follows from the evidence shown.', why: 'A conclusion the evidence does not support is misleading.' }
    ],
    presentation: [
      { id: 'one-idea-per-slide', check: 'Each slide carries one idea, in a logical order.', why: 'Crowded or unordered slides do not present the subject.' },
      { id: 'readable-slides', check: 'Slide text is short and readable at a glance.', why: 'A slide that must be read like a page is not a slide.' },
      { id: 'renders', check: 'The presentation renders correctly as HTML.', why: 'A presentation that does not render cannot be shown.' }
    ],
    design: [
      { id: 'matches-brief', check: 'It matches the brief: subject, purpose and audience.', why: 'A design for the wrong brief is the wrong design.' },
      { id: 'consistent', check: 'Colours, layout and text style are consistent throughout.', why: 'Inconsistent design looks unfinished.' },
      { id: 'text-correct', check: 'Every word in the design is spelled correctly.', why: 'A spelling error in a design is visible to everyone who sees it.' }
    ],
    image: [
      { id: 'format-honest', check: 'No image file is claimed — this app cannot produce one.', why: 'Promising an image file that cannot be made is a false delivery.' },
      { id: 'matches-description', check: 'The HTML/text alternative matches the description that was asked for.', why: 'The alternative must still be what was asked for, in a format that exists.' }
    ],
    website: [
      { id: 'renders', check: 'The page renders and opens without errors.', why: 'A page that does not open is not delivered.' },
      { id: 'links-work', check: 'Every link on the page works.', why: 'A dead link is a broken page.' },
      { id: 'no-fake-content', check: 'No content is presented as real when it is invented.', why: 'Unknown content must stay a marked editable placeholder.' },
      { id: 'responsive', check: 'The page is usable on a small screen as well as a large one.', why: 'A page that only works on one screen size is unfinished.' }
    ],
    app: [
      { id: 'flow', check: 'The screens flow in the order the user would use them.', why: 'An app whose screens do not flow cannot be used.' },
      { id: 'features-present', check: 'Every feature the request asked for is present.', why: 'A missing feature is a missing part of the app.' },
      { id: 'no-fake-data', check: 'No data is presented as real when it is invented.', why: 'Demo data must be marked as demo data, never passed off as real.' }
    ],
    software: [
      { id: 'logic-correct', check: 'The logic does what the request described.', why: 'Software that does something else is wrong software.' },
      { id: 'inputs-handled', check: 'Empty and wrong inputs are handled, not crashed on.', why: 'Unhandled input is a failure the user will hit first.' },
      { id: 'no-invented-behaviour', check: 'No behaviour is claimed that the code does not have.', why: 'Claimed behaviour that does not exist is a false delivery.' }
    ],
    code: [
      { id: 'syntax-valid', check: 'The code has valid syntax for its language.', why: 'Code that does not parse cannot run.' },
      { id: 'runs', check: 'The code runs without error on a plain example.', why: 'Code that fails on its first run is not finished.' },
      { id: 'does-what-asked', check: 'It does what the request asked for, and nothing unrelated.', why: 'Extra or missing behaviour is a wrong delivery.' },
      { id: 'no-invented-apis', check: 'Every function, library and call it uses really exists.', why: 'An invented API call fails the moment it runs.' }
    ],
    data: [
      { id: 'numbers-add-up', check: 'The numbers add up and are consistent with each other.', why: 'Numbers that contradict each other cannot be trusted.' },
      { id: 'source-stated', check: 'Where the data came from is stated.', why: 'Data with no stated source cannot be checked.' },
      { id: 'units-labelled', check: 'Units and labels are shown for every figure.', why: 'A number with no unit can be read the wrong way.' }
    ],
    structured_file: [
      { id: 'parses', check: 'The file parses as valid JSON or CSV.', why: 'A file that does not parse cannot be used.' },
      { id: 'shape-matches', check: 'Its keys or columns match what the request asked for.', why: 'The wrong shape is the wrong file.' },
      { id: 'no-invented-rows', check: 'No row is invented and presented as real data.', why: 'Invented rows are fabricated data.' }
    ]
  };

  function generationChecklist(outputType) {
    var type = asString(outputType || '');
    var entry = getOutputType(type);
    var checks = [];
    var i;
    if (entry && CHECKS_BY_TYPE[type]) {
      for (i = 0; i < CHECKS_BY_TYPE[type].length; i++) {
        checks.push({
          id: CHECKS_BY_TYPE[type][i].id,
          check: CHECKS_BY_TYPE[type][i].check,
          why: CHECKS_BY_TYPE[type][i].why
        });
      }
    }
    for (i = 0; i < GENERIC_CHECKS.length; i++) {
      checks.push({
        id: GENERIC_CHECKS[i].id,
        check: GENERIC_CHECKS[i].check,
        why: GENERIC_CHECKS[i].why
      });
    }
    return {
      outputType: entry ? type : null,
      outputLabel: entry ? entry.label : null,
      checks: checks,
      gap: entry ? null : 'unknown-output'
    };
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    OUTPUT_TYPES: OUTPUT_TYPES,
    GENERATION_STAGES: GENERATION_STAGES,
    SUPPORTED_FORMATS: SUPPORTED_FORMATS,
    UNSUPPORTED_FORMATS: UNSUPPORTED_FORMATS,
    listOutputTypes: listOutputTypes,
    getOutputType: getOutputType,
    detectOutputType: detectOutputType,
    planGeneration: planGeneration,
    supportedFormats: supportedFormats,
    generationChecklist: generationChecklist
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalGeneration = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalGeneration = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
