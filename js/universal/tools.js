
/* ============================================================================
   ENAO AI universal-intel — PIECE 14: Universal tool discovery + selection
   File: 14-tools.js  (AUDIT.md section 5, piece C1)
   Artifact: enao-ai (web_static). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
   Piece build only. Backend: none — frontend piece only, no new endpoint.

   PURPOSE
   -------
   Root cause 5 in AUDIT.md: tools are menu entries / chat commands.
   Nothing evaluates necessity, suitability, permissions, success, or
   satisfaction before/after use, and there is no honest-unavailable
   path except per-feature copy. This piece is the registry + selector
   that fixes that: every real capability in the app is registered once
   (by its real name and real handler), each request is scored against
   every tool on necessity / suitability / operation support /
   permissions / files, the best tool wins, a blocked tool is reported
   honestly with what is missing, and an unrelated tool is NEVER
   substituted for the one that was asked for.

   WHAT COUNTS AS "REAL" HERE
   ---------------------------
   registerBuiltins registers only capabilities that exist in the live
   build (v56-universal) or in an already-built master-intel piece:
   the 9 SEO tools (05-seo-tools.js, window.EnzoSeoTools), the monitor
   controls (window.EnzoMonitor, POST /api/v2/tasks/{id}/pause|resume|
   cancel|modify), the agents (06-agents.js, window.EnzoAgents), voice
   (mic live call + spoken answers + window.EnzoVoiceID), the AI Tools
   menu (TOOL_DEFS / TOOLS in the artifact: pdf, word, excel, image,
   summarize, code, data, imagegen, research, deepmode, translate,
   writing), the build flow (08, window.EnzoBuildFlow) + universal
   preset (07, window.EnzoUniversalPreset), deep research and the
   normal chat answer (askQuestion / computeRoute). Nothing is
   invented: a tool entry names its real handler string and, where it
   has one, its real endpoint. If a handler is absent at runtime the
   selector still names the tool honestly — availability is decided
   by evaluateTool/selectTool from ctx, never by guessing.

   SCORING (0-100, deterministic, topic-neutral)
   ----------------------------------------------
   necessity    0-30  request kind matches the tool category, or the
                      request text carries the tool's operation words.
   suitability  0-25  second-tier fit: category fit + keyword overlap.
   operation    0-20  requested operation is supported (20), no
                      operation requested (10, neutral), unsupported (0
                      + blockedBy entry — the tool cannot do this job).
   permissions  0-15  every needed permission granted (15), else 0 +
                      blockedBy entry per missing permission.
   files        0-10  every needed file present (10), else 0 +
                      blockedBy entry per missing file kind.
   Scoring reads only the request's kind / operation / files and the
   tool's own keywords — never the topic words — so the same request
   shape scores the same whatever the topic is (the harness proves
   this across unrelated topics).

   HONEST-UNAVAILABLE RULE
   -------------------------
   selectTool returns { tool, score, reasons, blockedBy, alternative }.
   When the best tool is blocked, tool is null and alternative carries
   { available: false, message, needs, substitute }: substitute is a
   DIFFERENT tool only when it is in the same category, unblocked, and
   scores >= 40 — otherwise substitute is null and the message says
   plainly what is missing. An unrelated tool is never offered as a
   replacement for the requested job.

   PUBLIC API (pure functions, no DOM, no network)
   ------------------------------------------------
   createToolRegistry() -> registry { register, get, list,
     listByCategory, count }
   registerBuiltins(registry) -> { registered, skipped }
   evaluateTool(tool, request, ctx) -> { tool, score, necessity,
     reasons, blockedBy[] }
   selectTool(request, ctx) -> { tool, score, reasons, blockedBy,
     alternative }  (uses ctx.registry when given, else the builtins)
   checkPermissions(tool, ctx) -> { tool, granted, missing[] }
     (missing messages in ctx.language: 'en' | 'roman' | 'ur')
   recordToolResult(tool, result) -> stored entry { tool, success,
     relevance, satisfaction, at }
   getToolHistory() / getToolStats(name) — read back what was recorded.

   STYLE: plain ES5, var + function declarations, no modules, zero
   emojis, no hardcoded topic names, no network, no DOM.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '14-tools v1.0 (enao-universal-intel, 22 Nov 2026)';
  var MIN_SELECT_SCORE = 25;
  var MIN_SUBSTITUTE_SCORE = 40;

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

  /* Normalise request text for matching: lower-case, keep letters and
     digits, collapse the rest to single spaces. Topic words survive
     untouched — they simply never match a tool keyword list, because
     every keyword below is an operation word, not a topic word. */
  function normText(text) {
    var s = lower(text);
    s = s.replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  function tokensOf(text) {
    var n = normText(text);
    return n ? n.split(' ') : [];
  }

  function hasToken(tokens, word) {
    var i;
    for (i = 0; i < tokens.length; i++) {
      if (tokens[i] === word) return true;
    }
    return false;
  }

  function countKeywordHits(tokens, keywords) {
    var hits = 0, i;
    for (i = 0; i < keywords.length; i++) {
      if (hasToken(tokens, keywords[i])) hits += 1;
    }
    return hits;
  }

  /* ------------------------------------------------------------------ */
  /* Permission messages, in the user's language                         */
  /* ------------------------------------------------------------------ */

  var PERMISSION_MESSAGES = {
    microphone: {
      en: 'Microphone access is needed for this. Allow the microphone and try again.',
      roman: 'Is ke liye microphone ki permission chahiye. Microphone allow karein aur dobara koshish karein.',
      ur: 'اس کے لیے مائیکروفون کی اجازت درکار ہے۔ مائیکروفون کی اجازت دیں اور دوبارہ کوشش کریں۔'
    },
    'file-access': {
      en: 'A file is needed for this. Attach the file and try again.',
      roman: 'Is ke liye file chahiye. File attach karein aur dobara koshish karein.',
      ur: 'اس کے لیے فائل درکار ہے۔ فائل منسلک کریں اور دوبارہ کوشش کریں۔'
    },
    network: {
      en: 'Internet access is needed for this. Check the connection and try again.',
      roman: 'Is ke liye internet chahiye. Connection check karein aur dobara koshish karein.',
      ur: 'اس کے لیے انٹرنیٹ درکار ہے۔ کنکشن چیک کریں اور دوبارہ کوشش کریں۔'
    },
    'voice-id': {
      en: 'Voice identification is needed for this. Complete the voice setup first.',
      roman: 'Is ke liye voice identification chahiye. Pehle voice setup mukammal karein.',
      ur: 'اس کے لیے آواز کی شناخت درکار ہے۔ پہلے آواز کا سیٹ اپ مکمل کریں۔'
    },
    storage: {
      en: 'Browser storage is needed for this. Storage must be available in this browser.',
      roman: 'Is ke liye browser storage chahiye. Is browser mein storage available honi chahiye.',
      ur: 'اس کے لیے براؤزر اسٹوریج درکار ہے۔ اس براؤزر میں اسٹوریج دستیاب ہونی چاہیے۔'
    }
  };

  function permissionMessage(permission, language) {
    var group = PERMISSION_MESSAGES[permission];
    if (!group) {
      if (language === 'roman' || language === 'ur') {
        return 'Is ke liye "' + permission + '" ki permission chahiye.';
      }
      return 'Permission "' + permission + '" is needed for this.';
    }
    return group[language] || group.en;
  }

  function fileMessage(fileKind, language) {
    if (language === 'ur') {
      return 'اس کام کے لیے ایک ' + fileKind + ' فائل درکار ہے۔';
    }
    if (language === 'roman') {
      return 'Is kaam ke liye ek ' + fileKind + ' file chahiye.';
    }
    return 'A ' + fileKind + ' file is needed for this.';
  }

  function langOf(ctx) {
    var l = ctx && ctx.language ? lower(ctx.language) : 'en';
    if (l === 'roman' || l === 'roman-urdu' || l === 'ur' || l === 'urdu') return l === 'ur' || l === 'urdu' ? 'ur' : 'roman';
    return 'en';
  }

  /* ------------------------------------------------------------------ */
  /* Request / context normalisation                                     */
  /* ------------------------------------------------------------------ */

  function normRequest(request) {
    if (typeof request === 'string') {
      return { text: request, kind: '', operation: '', files: [] };
    }
    if (!isPlainObject(request)) return { text: '', kind: '', operation: '', files: [] };
    return {
      text: asString(request.text || request.query || request.command || ''),
      kind: lower(request.kind || request.type || ''),
      operation: lower(request.operation || request.action || ''),
      files: Array.isArray(request.files) ? request.files : []
    };
  }

  function ctxPermissions(ctx) {
    if (ctx && isPlainObject(ctx.permissions)) return ctx.permissions;
    return {};
  }

  function ctxFiles(ctx) {
    if (ctx && Array.isArray(ctx.files)) return ctx.files;
    return [];
  }

  function allFiles(request, ctx) {
    var out = cloneArray(request.files);
    var extra = ctxFiles(ctx);
    var i;
    for (i = 0; i < extra.length; i++) out.push(extra[i]);
    return out;
  }

  function fileKindOf(file) {
    if (typeof file === 'string') return lower(file);
    if (!isPlainObject(file)) return '';
    var name = lower(file.name || '');
    var kind = lower(file.kind || file.type || '');
    if (kind) return kind;
    var m = name.match(/\.([a-z0-9]+)$/);
    return m ? m[1] : name;
  }

  /* A needed file kind matches a supplied file when the kind word
     appears in the file kind/name, or the need is 'any-file'. */
  function fileSatisfied(need, files) {
    var want = lower(need);
    var i;
    if (want === 'any-file' || want === 'file' || want === 'document') {
      return files.length > 0;
    }
    for (i = 0; i < files.length; i++) {
      var fk = fileKindOf(files[i]);
      if (fk.indexOf(want) !== -1 || want.indexOf(fk) !== -1) return true;
      if (want === 'spreadsheet' && (fk === 'xlsx' || fk === 'xls' || fk === 'csv')) return true;
      if (want === 'image' && (fk === 'jpg' || fk === 'jpeg' || fk === 'png' || fk === 'gif' || fk === 'webp')) return true;
      if (want === 'pdf' && fk === 'pdf') return true;
      if (want === 'word' && (fk === 'docx' || fk === 'doc')) return true;
    }
    return false;
  }

  /* Request kind -> tool category. Definition / conversation / general
     requests need no special tool: they route to the normal answer. */
  var KIND_TO_CATEGORY = {
    seo: 'seo',
    monitor: 'monitor',
    agents: 'agents',
    voice: 'voice',
    file: 'files',
    files: 'files',
    build: 'build',
    website: 'build',
    research: 'research',
    write: 'writing',
    writing: 'writing',
    definition: 'answer',
    conversation: 'answer',
    general: 'answer'
  };

  /* ------------------------------------------------------------------ */
  /* Registry                                                            */
  /* ------------------------------------------------------------------ */

  function createToolRegistry() {
    var tools = {};   /* name -> tool record */
    var order = [];   /* names in registration order */

    function validate(tool) {
      if (!isPlainObject(tool)) return 'tool must be an object';
      if (!trim(tool.name)) return 'tool.name is required';
      if (!Array.isArray(tool.operations)) return 'tool.operations must be an array';
      if (!Array.isArray(tool.needsPermissions)) return 'tool.needsPermissions must be an array';
      if (!Array.isArray(tool.needsFiles)) return 'tool.needsFiles must be an array';
      if (!trim(tool.description)) return 'tool.description is required';
      return '';
    }

    function register(tool) {
      var err = validate(tool);
      if (err) return { ok: false, reason: err };
      var name = trim(tool.name);
      if (tools[name]) return { ok: false, reason: 'duplicate tool name: ' + name };
      var record = {
        name: name,
        category: lower(tool.category || ''),
        operations: cloneArray(tool.operations),
        needsPermissions: cloneArray(tool.needsPermissions),
        needsFiles: cloneArray(tool.needsFiles),
        description: asString(tool.description),
        keywords: Array.isArray(tool.keywords) ? cloneArray(tool.keywords) : [],
        handler: asString(tool.handler || ''),
        endpoint: asString(tool.endpoint || '')
      };
      tools[name] = record;
      order.push(name);
      return { ok: true, tool: record };
    }

    function get(name) {
      return tools[trim(name)] || null;
    }

    function list() {
      var out = [], i;
      for (i = 0; i < order.length; i++) out.push(tools[order[i]]);
      return out;
    }

    function listByCategory(category) {
      var out = [], i, all = list();
      for (i = 0; i < all.length; i++) {
        if (all[i].category === lower(category)) out.push(all[i]);
      }
      return out;
    }

    function count() {
      return order.length;
    }

    return {
      register: register,
      get: get,
      list: list,
      listByCategory: listByCategory,
      count: count
    };
  }

  /* ------------------------------------------------------------------ */
  /* Builtins — every real capability, by its real name/handler         */
  /* ------------------------------------------------------------------ */

  /* keywords are OPERATION words only — never topic words. */
  var BUILTIN_TOOLS = [
    /* 9 SEO tools (05-seo-tools.js, window.EnzoSeoTools). */
    { name: 'seo-audit', category: 'seo', operations: ['audit', 'check-site'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Site Audit: checks a live site for technical issues, speed, HTTPS, robots and sitemap.',
      keywords: ['audit', 'seo', 'check', 'site', 'website'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/audit' },
    { name: 'seo-onpage', category: 'seo', operations: ['onpage-check'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'On-Page SEO Checker: title, meta, headings, links and word count of one page.',
      keywords: ['onpage', 'on-page', 'seo', 'check', 'page'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/onpage' },
    { name: 'seo-backlinks', category: 'seo', operations: ['backlinks'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Backlink Analysis: verified backlinks and referring domains for a site.',
      keywords: ['backlinks', 'backlink', 'links', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/backlinks' },
    { name: 'seo-keywords', category: 'seo', operations: ['keyword-research'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Keyword Research: terms actually seen in the crawled pages of a site.',
      keywords: ['keywords', 'keyword', 'research', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/keywords' },
    { name: 'seo-explorer', category: 'seo', operations: ['explore-domain'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Site / Domain Explorer: overview and top pages of a domain.',
      keywords: ['explorer', 'explore', 'domain', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/explorer' },
    { name: 'seo-rank', category: 'seo', operations: ['rank-track'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Rank Tracker: a domain position for a keyword in the ENZO SERP view.',
      keywords: ['rank', 'ranking', 'position', 'seo', 'tracker'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/rank' },
    { name: 'seo-competitors', category: 'seo', operations: ['competitor-analysis'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Competitor Analysis: other domains in the same search results, each audited the same way.',
      keywords: ['competitors', 'competitor', 'compare', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/competitors' },
    { name: 'seo-content-gap', category: 'seo', operations: ['content-gap'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Content Gap: terms a competitor uses that the target site never uses.',
      keywords: ['gap', 'content', 'missing', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/content-gap' },
    { name: 'seo-serp', category: 'seo', operations: ['serp-analysis'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'SERP Analysis: results and domains for a search query in the ENZO SERP view.',
      keywords: ['serp', 'results', 'search', 'seo'],
      handler: 'parseSeoCommand', endpoint: '/api/v2/seo/serp' },
    /* Writing (05-seo-tools.js local templates). */
    { name: 'guest-post-pitch', category: 'writing', operations: ['write-pitch'],
      needsPermissions: [], needsFiles: [],
      description: 'Guest Post Pitch: a ready-to-send pitch draft for one site.',
      keywords: ['pitch', 'guest', 'post', 'write'],
      handler: 'buildPitch', endpoint: '' },
    { name: 'write-article', category: 'writing', operations: ['write-article', 'write'],
      needsPermissions: [], needsFiles: [],
      description: 'Write an Article: an article outline and checklist for a topic.',
      keywords: ['article', 'write', 'draft'],
      handler: 'buildArticleOutline', endpoint: '' },
    /* Monitor controls (window.EnzoMonitor + POST /api/v2/tasks/{id}/...). */
    { name: 'monitor-live-view', category: 'monitor', operations: ['open-live-view', 'show-progress'],
      needsPermissions: [], needsFiles: [],
      description: 'Live view: opens the fullscreen monitor for the running task and shows real progress.',
      keywords: ['live', 'monitor', 'progress', 'show', 'status'],
      handler: 'EnzoMonitor.openTask', endpoint: '' },
    { name: 'monitor-pause', category: 'monitor', operations: ['pause-task'],
      needsPermissions: [], needsFiles: [],
      description: 'Pause the whole running task.',
      keywords: ['pause', 'stop', 'wait'],
      handler: 'EnzoMonitor.pause', endpoint: '/api/v2/tasks/{id}/pause' },
    { name: 'monitor-resume', category: 'monitor', operations: ['resume-task'],
      needsPermissions: [], needsFiles: [],
      description: 'Resume a paused task.',
      keywords: ['resume', 'continue', 'restart'],
      handler: 'EnzoMonitor.resume', endpoint: '/api/v2/tasks/{id}/resume' },
    { name: 'monitor-cancel', category: 'monitor', operations: ['cancel-task'],
      needsPermissions: [], needsFiles: [],
      description: 'Cancel the whole running task.',
      keywords: ['cancel', 'stop', 'abort'],
      handler: 'EnzoMonitor.cancel', endpoint: '/api/v2/tasks/{id}/cancel' },
    { name: 'monitor-modify', category: 'monitor', operations: ['modify-task', 'guide-task'],
      needsPermissions: [], needsFiles: [],
      description: 'Guide the running task: send a new instruction while it runs.',
      keywords: ['modify', 'guide', 'change', 'focus'],
      handler: 'EnzoMonitor.modify', endpoint: '/api/v2/tasks/{id}/modify' },
    /* Agents (06-agents.js, window.EnzoAgents). */
    { name: 'agents-parallel', category: 'agents', operations: ['split-parallel-assemble'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Agents: split long work into parts, run one agent per part in parallel, assemble one result.',
      keywords: ['agents', 'parallel', 'split', 'parts'],
      handler: 'EnzoAgents.runSplitParallelAssemble', endpoint: '' },
    { name: 'agents-guidance', category: 'agents', operations: ['guide-agent'],
      needsPermissions: [], needsFiles: [],
      description: 'Agent guidance: target one agent by number or part and tell it what to change.',
      keywords: ['agent', 'guide', 'agents'],
      handler: 'EnzoAgents.parseAgentGuidance', endpoint: '/api/v2/tasks/{id}/modify' },
    /* Voice (mic live call, spoken answers, window.EnzoVoiceID). */
    { name: 'voice-call', category: 'voice', operations: ['start-call', 'listen'],
      needsPermissions: ['microphone', 'voice-id'], needsFiles: [],
      description: 'Live voice call: speak with ENZO through the microphone.',
      keywords: ['call', 'speak', 'listen', 'voice', 'mic', 'microphone'],
      handler: 'startVoiceCall', endpoint: '' },
    { name: 'voice-speak', category: 'voice', operations: ['speak-answer'],
      needsPermissions: [], needsFiles: [],
      description: 'Spoken answer: read the answer aloud.',
      keywords: ['speak', 'read', 'voice', 'aloud'],
      handler: 'speakAnswer', endpoint: '' },
    { name: 'voice-id-gate', category: 'voice', operations: ['verify-voice'],
      needsPermissions: ['microphone', 'voice-id'], needsFiles: [],
      description: 'Voice identification: check that the speaker is the owner before voice input is accepted.',
      keywords: ['verify', 'voice', 'identify', 'owner'],
      handler: 'EnzoVoiceID.gateAndRoute', endpoint: '' },
    /* AI Tools menu (artifact TOOL_DEFS / TOOLS, openTool(id)). */
    { name: 'file-pdf', category: 'files', operations: ['analyse-pdf', 'read-file'],
      needsPermissions: ['file-access'], needsFiles: ['pdf'],
      description: 'PDF Analysis: read a PDF in the browser — text, pages, word counts, summary.',
      keywords: ['pdf', 'analyse', 'analyze', 'read', 'document'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-word', category: 'files', operations: ['analyse-document', 'read-file'],
      needsPermissions: ['file-access'], needsFiles: ['word'],
      description: 'Word Document Analysis: read a .docx document — full text, counts and structure.',
      keywords: ['word', 'docx', 'document', 'analyse', 'analyze', 'read'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-excel', category: 'files', operations: ['analyse-spreadsheet', 'read-file'],
      needsPermissions: ['file-access'], needsFiles: ['spreadsheet'],
      description: 'Excel Spreadsheet Analysis: open a spreadsheet — table view plus totals and averages.',
      keywords: ['excel', 'spreadsheet', 'xlsx', 'csv', 'data', 'analyse', 'analyze'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-image', category: 'files', operations: ['describe-image', 'read-file'],
      needsPermissions: ['file-access'], needsFiles: ['image'],
      description: 'Image Understanding: describe what is in an image.',
      keywords: ['image', 'picture', 'photo', 'describe', 'analyse', 'analyze'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-summarize', category: 'files', operations: ['summarize'],
      needsPermissions: [], needsFiles: ['any-file'],
      description: 'Document Summarization: paste text or load a document and get a summary of the key points.',
      keywords: ['summarize', 'summary', 'shorten'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-code', category: 'files', operations: ['explain-code', 'fix-code'],
      needsPermissions: [], needsFiles: [],
      description: 'Code Assistance: explain code, find and fix bugs, clean it up, or add comments.',
      keywords: ['code', 'explain', 'fix', 'bug', 'debug'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-data', category: 'files', operations: ['analyse-data'],
      needsPermissions: [], needsFiles: ['spreadsheet'],
      description: 'Data Analysis: paste CSV or load a sheet — real totals, averages and a chart.',
      keywords: ['data', 'analyse', 'analyze', 'chart', 'totals', 'csv'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-imagegen', category: 'files', operations: ['generate-image'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Image Generation: describe a picture and ENZO creates it.',
      keywords: ['generate', 'image', 'picture', 'create'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-translate', category: 'files', operations: ['translate'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Translation: translate text between languages.',
      keywords: ['translate', 'translation', 'language'],
      handler: 'openTool', endpoint: '' },
    { name: 'file-writing', category: 'files', operations: ['write-text', 'improve-text'],
      needsPermissions: [], needsFiles: [],
      description: 'Writing Assistance: emails, applications, and improving or polishing text.',
      keywords: ['write', 'writing', 'email', 'improve', 'polish'],
      handler: 'openTool', endpoint: '' },
    /* Build flow (08) + universal preset (07). */
    { name: 'build-website', category: 'build', operations: ['build', 'create-website'],
      needsPermissions: [], needsFiles: [],
      description: 'Build: think, research, ask what is missing, then build the requested thing.',
      keywords: ['build', 'create', 'make', 'website', 'app'],
      handler: 'EnzoBuildFlow.createBuildSession', endpoint: '' },
    { name: 'build-preset', category: 'build', operations: ['resolve-kind'],
      needsPermissions: [], needsFiles: [],
      description: 'Universal preset: resolve what kind of thing was asked for and what it needs.',
      keywords: ['preset', 'template', 'kind', 'build'],
      handler: 'EnzoUniversalPreset.resolveBuildKind', endpoint: '' },
    /* Research + normal answer (askQuestion / computeRoute). */
    { name: 'deep-research', category: 'research', operations: ['research', 'investigate'],
      needsPermissions: ['network'], needsFiles: [],
      description: 'Deep Research: search in batches, read real pages, write a sourced report.',
      keywords: ['research', 'investigate', 'sources', 'deep', 'find'],
      handler: 'computeRoute', endpoint: '/api/v2/tasks' },
    { name: 'normal-answer', category: 'answer', operations: ['answer'],
      needsPermissions: [], needsFiles: [],
      description: 'Normal answer: answer directly from knowledge, no research run.',
      keywords: ['answer', 'explain', 'tell', 'what', 'how', 'why'],
      handler: 'askQuestion', endpoint: '' }
  ];

  function registerBuiltins(registry) {
    if (!registry || typeof registry.register !== 'function') {
      return { registered: 0, skipped: ['no registry supplied'] };
    }
    var registered = 0, skipped = [], i, res;
    for (i = 0; i < BUILTIN_TOOLS.length; i++) {
      res = registry.register(BUILTIN_TOOLS[i]);
      if (res.ok) registered += 1;
      else skipped.push(BUILTIN_TOOLS[i].name + ': ' + res.reason);
    }
    return { registered: registered, skipped: skipped };
  }

  var defaultRegistry = null;

  function getDefaultRegistry() {
    if (!defaultRegistry) {
      defaultRegistry = createToolRegistry();
      registerBuiltins(defaultRegistry);
    }
    return defaultRegistry;
  }

  function registryFor(ctx) {
    if (ctx && ctx.registry && typeof ctx.registry.list === 'function') return ctx.registry;
    return getDefaultRegistry();
  }

  /* ------------------------------------------------------------------ */
  /* Permission check (user's language)                                  */
  /* ------------------------------------------------------------------ */

  function checkPermissions(tool, ctx) {
    var lang = langOf(ctx);
    var perms = ctxPermissions(ctx);
    var missing = [];
    var i, p;
    if (!tool) return { tool: null, granted: false, missing: missing };
    var needed = tool.needsPermissions || [];
    for (i = 0; i < needed.length; i++) {
      p = needed[i];
      if (!perms[p]) {
        missing.push({ permission: p, message: permissionMessage(p, lang) });
      }
    }
    return { tool: tool.name, granted: missing.length === 0, missing: missing };
  }

  /* ------------------------------------------------------------------ */
  /* Evaluation                                                          */
  /* ------------------------------------------------------------------ */

  function evaluateTool(tool, request, ctx) {
    var req = normRequest(request);
    var lang = langOf(ctx);
    var files = allFiles(req, ctx);
    var reasons = [];
    var blockedBy = [];
    var score = 0;

    if (!tool) {
      return { tool: null, score: 0, necessity: 0, reasons: ['No tool was given to evaluate.'], blockedBy: blockedBy };
    }

    var tokens = tokensOf(req.text);
    var hits = countKeywordHits(tokens, tool.keywords || []);
    var wantedCategory = KIND_TO_CATEGORY[req.kind] || '';
    var operationSupported = !!req.operation && tool.operations &&
      tool.operations.indexOf(req.operation) !== -1;

    /* necessity 0-30: kind match, keyword hits, or a supported
       operation. A request with none of the three has zero necessity
       for this tool — selectTool refuses to pick on a zero-necessity
       best match (see below). */
    var necessity = 0;
    if (wantedCategory && tool.category === wantedCategory) {
      necessity = 30;
      reasons.push('Request kind matches this tool category (' + tool.category + ').');
    } else if (hits > 0) {
      necessity = Math.min(30, hits * 8);
      reasons.push(hits + ' operation word(s) in the request match this tool.');
    } else if (operationSupported) {
      necessity = 20;
      reasons.push('Requested operation is supported by this tool.');
    } else {
      reasons.push('No operation word in the request matches this tool.');
    }
    score += necessity;

    /* suitability 0-25 */
    var suitability = 0;
    if (wantedCategory && tool.category === wantedCategory) {
      suitability = 25;
    } else if (hits >= 2) {
      suitability = 20;
      reasons.push('Several operation words match; this tool fits the request.');
    } else if (hits === 1) {
      suitability = 10;
      reasons.push('One operation word matches; this tool partly fits the request.');
    } else {
      suitability = 0;
    }
    score += suitability;

    /* operation support 0-20 */
    var operation = 0;
    if (!req.operation) {
      operation = 10;
      reasons.push('No specific operation was requested; operation support is neutral.');
    } else if (operationSupported) {
      operation = 20;
      reasons.push('Requested operation "' + req.operation + '" is supported.');
    } else {
      operation = 0;
      reasons.push('Requested operation "' + req.operation + '" is not supported by this tool.');
      blockedBy.push({ type: 'operation', name: req.operation,
        message: 'This tool does not support the operation "' + req.operation + '".' });
    }
    score += operation;

    /* permissions 0-15 */
    var permCheck = checkPermissions(tool, ctx);
    var permScore = 0;
    if (permCheck.granted) {
      permScore = 15;
    } else {
      var j;
      for (j = 0; j < permCheck.missing.length; j++) {
        blockedBy.push({ type: 'permission', name: permCheck.missing[j].permission,
          message: permCheck.missing[j].message });
      }
      reasons.push('Missing permission(s): ' + permCheck.missing.map(function (m) { return m.permission; }).join(', ') + '.');
    }
    score += permScore;

    /* files 0-10 */
    var fileScore = 0;
    var neededFiles = tool.needsFiles || [];
    if (neededFiles.length === 0) {
      fileScore = 10;
    } else {
      var missingFiles = [];
      var k;
      for (k = 0; k < neededFiles.length; k++) {
        if (!fileSatisfied(neededFiles[k], files)) missingFiles.push(neededFiles[k]);
      }
      if (missingFiles.length === 0) {
        fileScore = 10;
        reasons.push('Required file(s) are present.');
      } else {
        fileScore = 0;
        for (k = 0; k < missingFiles.length; k++) {
          blockedBy.push({ type: 'files', name: missingFiles[k],
            message: fileMessage(missingFiles[k], lang) });
        }
        reasons.push('Missing file(s): ' + missingFiles.join(', ') + '.');
      }
    }
    score += fileScore;

    return { tool: tool.name, score: score, necessity: necessity, reasons: reasons, blockedBy: blockedBy };
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                           */
  /* ------------------------------------------------------------------ */

  function selectTool(request, ctx) {
    var registry = registryFor(ctx);
    var tools = registry.list();
    var evaluated = [];
    var i, ev;
    for (i = 0; i < tools.length; i++) {
      ev = evaluateTool(tools[i], request, ctx);
      evaluated.push({ tool: tools[i], evaluation: ev });
    }
    evaluated.sort(function (a, b) { return b.evaluation.score - a.evaluation.score; });

    var best = evaluated.length > 0 ? evaluated[0] : null;
    var lang = langOf(ctx);

    function honestAlternative(message, needs, substitute) {
      return { available: false, message: message, needs: needs || [], substitute: substitute || null };
    }

    if (!best) {
      return { tool: null, score: 0, reasons: ['No tools are registered.'],
        blockedBy: [], alternative: honestAlternative(
          lang === 'ur' ? 'کوئی ٹول دستیاب نہیں ہے۔' :
          lang === 'roman' ? 'Koi tool available nahi hai.' :
          'No tool is available.', [], null) };
    }

    /* Zero necessity means nothing in the request actually points at
       any tool: no kind match, no operation word, no supported
       operation. Picking the least-bad tool then would be a guess
       dressed as a selection, so no tool is picked. */
    if (best.evaluation.necessity === 0) {
      var zeroMsg = lang === 'en'
        ? 'No tool matches this request. Say what the job is — for example research, check a site, analyse a file, build something, or pause a task — and the right tool will be picked.'
        : 'Is request ke liye koi tool match nahi karta. Kaam batayein — jaise research, site check, file analyse, kuch banana, ya task pause — aur sahi tool chun liya jayega.';
      return { tool: null, score: best.evaluation.score,
        reasons: best.evaluation.reasons, blockedBy: [],
        alternative: honestAlternative(zeroMsg, [], null) };
    }

    /* Best tool is usable: return it. */
    if (best.evaluation.blockedBy.length === 0 && best.evaluation.score >= MIN_SELECT_SCORE) {
      return { tool: best.tool.name, score: best.evaluation.score,
        reasons: best.evaluation.reasons, blockedBy: [],
        alternative: { available: true, message: '', needs: [], substitute: null } };
    }

    /* Best tool is blocked: say so honestly, name what is missing. */
    if (best.evaluation.blockedBy.length > 0) {
      var needs = [];
      var b;
      for (b = 0; b < best.evaluation.blockedBy.length; b++) {
        needs.push(best.evaluation.blockedBy[b].message);
      }
      /* Substitute only: same category, unblocked, strong enough. */
      var substitute = null;
      var s;
      for (s = 1; s < evaluated.length; s++) {
        var cand = evaluated[s];
        if (cand.tool.category === best.tool.category &&
            cand.evaluation.blockedBy.length === 0 &&
            cand.evaluation.score >= MIN_SUBSTITUTE_SCORE) {
          substitute = cand.tool.name;
          break;
        }
      }
      var msg;
      if (lang === 'ur') {
        msg = '"' + best.tool.name + '" abhi available nahi hai — ' + needs.join(' ');
      } else if (lang === 'roman') {
        msg = '"' + best.tool.name + '" abhi available nahi hai — ' + needs.join(' ');
      } else {
        msg = '"' + best.tool.name + '" is not available right now — ' + needs.join(' ');
      }
      if (substitute) {
        msg += lang === 'en'
          ? ' A related tool that can help is "' + substitute + '".'
          : ' Is se milta-julta tool "' + substitute + '" madad kar sakta hai.';
      }
      return { tool: null, score: best.evaluation.score,
        reasons: best.evaluation.reasons, blockedBy: best.evaluation.blockedBy,
        alternative: honestAlternative(msg, needs, substitute) };
    }

    /* Nothing scored high enough: no tool matches this request. */
    var lowMsg = lang === 'en'
      ? 'No tool matches this request closely enough. Ask for the job directly and the right tool will be picked.'
      : 'Is request ke liye koi tool theek se match nahi karta. Kaam seedha batayein, sahi tool chun liya jayega.';
    return { tool: null, score: best.evaluation.score,
      reasons: best.evaluation.reasons, blockedBy: [],
      alternative: honestAlternative(lowMsg, [], null) };
  }

  /* ------------------------------------------------------------------ */
  /* Result tracking — success / relevance / satisfaction over time      */
  /* ------------------------------------------------------------------ */

  var toolHistory = [];

  function clampNum(v, min, max, fallback) {
    var n = Number(v);
    if (isNaN(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function recordToolResult(tool, result) {
    var name = typeof tool === 'string' ? tool : (tool && tool.name ? tool.name : '');
    var r = isPlainObject(result) ? result : {};
    var entry = {
      tool: name,
      success: r.success === true,
      relevance: clampNum(r.relevance, 0, 5, 0),
      satisfaction: clampNum(r.satisfaction, 0, 5, 0),
      at: new Date().toISOString()
    };
    toolHistory.push(entry);
    return entry;
  }

  function getToolHistory() {
    return cloneArray(toolHistory);
  }

  function getToolStats(name) {
    var uses = 0, successes = 0, relSum = 0, satSum = 0, i;
    for (i = 0; i < toolHistory.length; i++) {
      if (toolHistory[i].tool === name) {
        uses += 1;
        if (toolHistory[i].success) successes += 1;
        relSum += toolHistory[i].relevance;
        satSum += toolHistory[i].satisfaction;
      }
    }
    if (uses === 0) {
      return { tool: name, uses: 0, successes: 0, avgRelevance: 0, avgSatisfaction: 0 };
    }
    return {
      tool: name,
      uses: uses,
      successes: successes,
      avgRelevance: Math.round((relSum / uses) * 100) / 100,
      avgSatisfaction: Math.round((satSum / uses) * 100) / 100
    };
  }

  function resetHistoryForTest() {
    toolHistory = [];
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    createToolRegistry: createToolRegistry,
    registerBuiltins: registerBuiltins,
    evaluateTool: evaluateTool,
    selectTool: selectTool,
    checkPermissions: checkPermissions,
    recordToolResult: recordToolResult,
    getToolHistory: getToolHistory,
    getToolStats: getToolStats,
    _resetHistoryForTest: resetHistoryForTest
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalTools = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalTools = api;
  } catch (e) { /* exposure is best-effort */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
