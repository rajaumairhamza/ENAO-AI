
/* ============================================================================
 * ENAO AI — Live Research Monitor: FULL-SCREEN LIVE VIEW + LIVE GUIDANCE
 * Piece P6 (03-monitor-fullscreen.js)
 * ----------------------------------------------------------------------------
 * REPLACES the v53 480px right slide-over (M2, 02-monitor-ui.js/css).
 * Standing replacement rule: the slide-over mode is REMOVED, not kept
 * alongside — both must never run together. This piece is the only opener:
 * the same "View Live Research" button (same label, #enzoMonitorBtn)
 * now opens the live view FULL-SCREEN.
 *
 * What it does:
 *  - Full-screen: clicking "View Live Research" adds the body class
 *    `enzo-live-fullscreen`. Under that class the CSS hides BOTH the left
 *    sidebar (#sidebar) and the right companion panel (#enzoPanel, plus
 *    the floating #enzoFab) and the centre column (main.main), and the
 *    monitor container (#enzoMonitorPanel, built by M2) covers the whole
 *    viewport (fixed inset:0, opaque, full width/height). The whole
 *    screen is only the live research view: dashboard, live timeline,
 *    expandable activities, verification badges, controls, sources,
 *    final report — all clearly visible. Closing (close button + Escape)
 *    removes the class and restores the normal 3-column layout exactly
 *    as before. Monitor state/history is preserved across open/close:
 *    this piece never touches window.EnzoMonitor state, localStorage,
 *    or M2's expanded/view state — it only toggles visibility/classes.
 *  - NO dim overlay: there is no backdrop element in full-screen
 *    mode at all (the M2 backdrop is hidden and never shown here), and
 *    the CSS contains no backdrop filter property, no soft-focus
 *    filter, and no
 *    semi-transparent dim layer over the content. The screen is clean
 *    and sharp, exactly like the normal laptop screen.
 *  - Live guidance / training: a guidance bar mounted INSIDE the live
 *    view (first child of #enzoMonitorBody) with BOTH a MIC button
 *    (browser Web Speech API) and a TYPING input + send button. Either
 *    way the instruction reaches the running research task and is ACTED
 *    on through a REAL backend endpoint — never just written into chat.
 *    `parseGuidance(text)` (pure) classifies the intent; `applyGuidance`
 *    dispatches it.
 *
 * Real endpoints used (all same-origin /api/v2, verified in
 * ~/workspace/enao-platform/server/server.py — see EVIDENCE):
 *  - POST /api/v2/tasks/{id}/pause   (empty body tolerated)
 *  - POST /api/v2/tasks/{id}/resume  (empty body tolerated)
 *  - POST /api/v2/tasks/{id}/cancel  (empty body tolerated)
 *    These three go through the M1 data layer (window.EnzoMonitor
 *    pauseTask/resumeTask/cancelTask), which calls exactly these URLs.
 *  - POST /api/v2/tasks/{id}/modify  body {"instruction": "<directive>"} — the id is the current task id (activeTaskId via currentTaskId()), never a hard-coded id.
 *    The steer endpoint EXISTS (server.py _route_tasks, handle_task_control
 *    -> _modify_task -> control.py TaskController.modify_task). There is
 *    NO steer-endpoint gap. Directives are built in English using the
 *    exact keyword shapes the P7 classifier (_classify_modify) and the
 *    server-side normaliser (_normalize_modify_instruction) understand:
 *    "Focus first on X" (change_priorities), "Only focus on X" /
 *    "Limit the scope to X" (narrow_scope), "Add a topic about X"
 *    (add_topic), "Remove the subtask about X" (remove_subtask),
 *    "Expand the research on X" (expand_research), "Compare X and Y"
 *    (request_comparison), "Find more sources on X" (more_sources),
 *    "Give more detail on X" (more_detail). The backend answers 400
 *    when it cannot understand a directive and 409 when the task is in
 *    a terminal / non-modifiable state; both are shown plainly, never
 *    pretended as success. Modify is allowed in states queued, planning,
 *    running, waiting AND paused (control.py MODIFIABLE_STATES).
 *
 * Guidance events are logged in the monitor timeline as real activities
 * via EnzoMonitor.noteFrontendStep({kind:'guidance', ...}) — kind
 * "client:guidance", source: user guidance.
 *
 * Voice-identification note: the mic uses the browser Web Speech API,
 * which has NO speaker verification — it transcribes whoever is speaking
 * within mic range. Raja-only voice identification (22 Nov 2026 ~12:28 PM
 * voice call) is a separate concern for the voice piece; this piece does
 * NOT claim it. See EVIDENCE.md.
 *
 * Style: plain ES5, no dependencies, no emojis anywhere. UI strings are
 * English in code comments; user-facing confirmation lines are in the
 * user's language (Urdu script / Roman Urdu / English), detected from
 * the instruction text.
 *
 * Assembler contract (what to REMOVE from M2 — full list in EVIDENCE):
 *  - 02-monitor-ui.js: the backdrop element + show/hide in open()/close(),
 *    the `enzo-monitor-open` slide transform handling, and M2's own
 *    open()/close() bodies — replaced by delegates to
 *    window.EnzoMonitorFullscreen.open()/close(). The button click and
 *    the Tools-entry click must call EnzoMonitorFullscreen.open().
 *  - 02-monitor-ui.css: #enzoMonitorBackdrop rules, the #enzoMonitorPanel
 *    slide-over positioning (width 480px, right:0, translateX), and the
 *    mobile bottom:118px rule. Everything else in M2 stays: buildPanel
 *    (panel DOM + timeline/sources/report/controls/render), buildButton,
 *    mount/subscribe, setActiveTask.
 * This piece reuses M2's #enzoMonitorPanel DOM and all its children; it
 * does not rebuild the timeline, sources, or report views.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var API_BASE = window.EnzoPagesBackend.getBackendBase();
  var BODY_CLASS = 'enzo-live-fullscreen';
  var PANEL_ID = 'enzoMonitorPanel';
  var BACKDROP_ID = 'enzoMonitorBackdrop';
  var CLOSE_BTN_ID = 'enzoMonitorClose';
  var BODY_ID = 'enzoMonitorBody';
  var BUTTON_ID = 'enzoMonitorBtn';
  var TOOLS_ENTRY_ID = 'enzoMonitorToolsEntry';

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

  function getMonitorUI() {
    try {
      var w = root();
      return (w && w.EnzoMonitorUI) ? w.EnzoMonitorUI : null;
    } catch (e) { return null; }
  }

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  /* Normalise for matching: lower-case, collapse whitespace, strip
     surrounding punctuation, collapse repeated spaces. Original text is
     kept separately for display and for the raw instruction. */
  function normText(text) {
    var s = asString(text).toLowerCase();
    s = s.replace(/[\u0600-\u06FF]+/g, function (m) { return ' ' + m + ' '; });
    s = s.replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  /* True when the text contains Urdu-script characters. */
  function hasUrduScript(text) {
    return /[\u0600-\u06FF]/.test(asString(text));
  }

  /* Language of the user's instruction, for confirmation lines:
     'ur' (Urdu script), 'roman' (Roman Urdu), 'en' (English). */
  var ROMAN_URDU_WORDS = [
    'ruk', 'jao', 'jayo', 'band', 'karo', 'kar', 'do', 'dobara', 'shuru',
    'phir', 'se', 'zyada', 'dhyaan', 'sirf', 'thora', 'thodi', 'der',
    'dair', 'jaari', 'rakho', 'chor', 'hata', 'nikal', 'aur', 'bhi',
    'is', 'ye', 'yeh', 'par', 'pe', 'ka', 'ki', 'ko', 'mein', 'mera',
    'kya', 'kis', 'kuch', 'bas', 'pehle', 'gehrai', 'tafseel', 'muqabla'
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
  var isOpenFlag = false;
  var lastFocused = null;
  var guidanceBuilt = false;
  var listening = false;
  var recognizer = null;
  var inFlight = false;
  var els = {};
  var fetchFnOverride = null; /* tests only: stub fetch layer */
  var monitorOverride = null; /* tests only: stub EnzoMonitor */

  function getFetch() {
    if (fetchFnOverride) return fetchFnOverride;
    var w = root();
    return (w && typeof w.fetch === 'function') ? w.fetch : null;
  }

  function getMonitorOrOverride() {
    return monitorOverride || getMonitor();
  }

  /* ------------------------------------------------------------------ */
  /* parseGuidance(text) — pure function.                                */
  /*                                                                     */
  /* Returns { intent, action, subintent, topic, directive, raw, lang } */
  /*  intent:    'stop' | 'pause' | 'resume' | 'redirect' | 'empty'     */
  /*  action:    'cancel' | 'pause' | 'resume' | 'modify' | null        */
  /*  subintent: for redirect — 'focus' | 'change-source' |             */
  /*    'scope-limit' | 'add-topic' | 'expand' | 'compare' |             */
  /*    'more-sources' | 'more-detail' | 'remove-topic' |               */
  /*    'generic-steer'                                                  */
  /*  topic:     extracted topic string ('' when none could be found)   */
  /*  directive: English instruction sent to POST .../modify — built    */
  /*    with the exact keyword shapes the P7 classifier understands.    */
  /*    Empty for stop/pause/resume (those use their own endpoints).    */
  /*                                                                     */
  /* Order matters: pause-specific phrasings are checked BEFORE bare    */
  /* "ruk jao" (which means stop); "stop using X" is a source change,  */
  /* not a task stop, so it is checked before the generic stop words.   */
  /* ------------------------------------------------------------------ */

  /* Words stripped when extracting a topic: verbs, politeness, and the
     trigger words themselves. What is left should be the subject. */
  var TOPIC_STRIP = [
    'please', 'zara', 'thoda', 'thora', 'thodi', 'kuch', 'der', 'dair',
    'zyada', 'ziyada', 'focus', 'karo', 'kar', 'karna', 'do', 'dein',
    'den', 'lo', 'le', 'lo', 'jao', 'jayo', 'rakho', 'rakh', 'shuru',
    'dobara', 'phir', 'se', 'is', 'ye', 'yeh', 'us', 'iss', 'par', 'pe',
    'ko', 'ka', 'ki', 'ke', 'mein', 'aur', 'bhi', 'sirf', 'only', 'just',
    'on', 'about', 'the', 'a', 'an', 'this', 'that', 'it', 'to', 'for',
    'more', 'add', 'include', 'cover', 'research', 'topic', 'sources',
    'source', 'detail', 'details', 'depth', 'compare', 'comparison',
    'expand', 'broaden', 'widen', 'limit', 'scope', 'narrow', 'remove',
    'drop', 'delete', 'skip', 'chor', 'choro', 'hata', 'nikal', 'band',
    'stop', 'pause', 'resume', 'continue', 'prioritise', 'prioritize',
    'focus', 'dhyaan', 'tawajah', 'gehrai', 'tafseel', 'muqabla'
  ];

  function extractTopic(raw, extraStrip) {
    var s = normText(raw);
    var words = s.split(' ').filter(function (w) { return w !== ''; });
    var strip = TOPIC_STRIP.slice();
    if (extraStrip) {
      for (var i = 0; i < extraStrip.length; i++) {
        if (strip.indexOf(extraStrip[i]) === -1) strip.push(extraStrip[i]);
      }
    }
    var kept = [];
    for (var j = 0; j < words.length; j++) {
      if (strip.indexOf(words[j]) === -1) kept.push(words[j]);
    }
    var topic = kept.join(' ').replace(/^\s+|\s+$/g, '');
    if (topic.length > 120) topic = topic.slice(0, 120);
    return topic;
  }

  /* Topic after a marker phrase ("focus on X", "is par X", "about X"). */
  function topicAfter(raw, markers) {
    var s = normText(raw);
    for (var i = 0; i < markers.length; i++) {
      var idx = s.indexOf(markers[i]);
      if (idx !== -1) {
        var rest = s.slice(idx + markers[i].length);
        var topic = extractTopic(rest, []);
        if (topic) return topic;
      }
    }
    return '';
  }

  function parseGuidance(text) {
    var raw = asString(text);
    var lang = detectLanguage(raw);
    var n = normText(raw);
    var base = {
      raw: raw, lang: lang, topic: '', directive: '',
      intent: 'redirect', action: 'modify', subintent: 'generic-steer'
    };
    if (!n) {
      base.intent = 'empty';
      base.action = null;
      base.subintent = null;
      return base;
    }

    /* ---- "stop using / checking X" is a source change, not a stop -- */
    var stopUsing = n.match(/\bstop\s+(using|checking|reading|going to)\s+(.+)$/);
    if (stopUsing) {
      var dropTopic = extractTopic(stopUsing[2], ['website', 'site']);
      base.intent = 'redirect';
      base.action = 'modify';
      base.subintent = 'remove-topic';
      base.topic = dropTopic;
      base.directive = dropTopic
        ? ('Remove the subtask about ' + dropTopic)
        : 'Remove the subtask about this source';
      return base;
    }

    /* ---- PAUSE (checked before bare "ruk jao", which means stop) ---- */
    var pauseRe = new RegExp(
      '\\bpause\\b|' +
      'ruk jao thodi|' +
      'ruk jao kuch|' +
      'thodi der|' +
      'thodi dair|' +
      'kuch der|' +
      'thora ruk|' +
      'wait a (while|bit)|' +
      '\\bhold on\\b|' +
      'تھوڑی دیر|' +
      'وقفہ');
    if (pauseRe.test(n) || pauseRe.test(raw)) {
      base.intent = 'pause';
      base.action = 'pause';
      base.subintent = null;
      return base;
    }

    /* ---- STOP / CANCEL ---------------------------------------------- */
    var stopRe = new RegExp(
      '\\bstop\\b|' +
      '\\bcancel\\b|' +
      'band kar do|' +
      'band karo|' +
      'ruk jao|' +
      'ruk jayo|' +
      'rok do|' +
      'khatam kar do|' +
      'منسوخ|' +
      'بند کر دو|' +
      'رک جاؤ|' +
      'روک دو|' +
      'ختم کر دو');
    if (stopRe.test(n) || stopRe.test(raw)) {
      base.intent = 'stop';
      base.action = 'cancel';
      base.subintent = null;
      return base;
    }

    /* ---- RESUME ------------------------------------------------------ */
    var resumeRe = new RegExp(
      '\\bresume\\b|' +
      '\\bcontinue\\b|' +
      'dobara shuru|' +
      'dobara shuru karo|' +
      'phir se shuru|' +
      'phir shuru|' +
      'jaari rakho|' +
      'jari rakho|' +
      'shuru karo|' +
      'chalu karo|' +
      'دوبارہ شروع|' +
      'جاری رکھو|' +
      'شروع کرو');
    if (resumeRe.test(n) || resumeRe.test(raw)) {
      base.intent = 'resume';
      base.action = 'resume';
      base.subintent = null;
      return base;
    }

    /* ---- REDIRECT / STEER (all go through POST .../modify) ---------- */
    base.intent = 'redirect';
    base.action = 'modify';

    /* remove-topic: "remove the X section", "ye source chor do",
       "is topic ko hata do", "skip X". */
    var removeRe = new RegExp(
      '\\b(remove|drop|delete|skip)\\b|' +
      'chor do|' +
      'چھوڑ دو|' +
      'ہٹا دو|' +
      'hata do|' +
      'nikal do|' +
      'نکال دو');
    if (removeRe.test(n) || removeRe.test(raw)) {
      var rTopic = topicAfter(raw, ['chor do', 'hata do', 'nikal do',
        'چھوڑ دو', 'ہٹا دو', 'نکال دو']) ||
        topicAfter(raw, ['remove the', 'remove', 'drop the', 'drop',
          'delete the', 'delete', 'skip the', 'skip']) ||
        extractTopic(raw, []);
      /* "ye source chor do, is par jao" — the part after "par jao" is
         the new direction, not the removed topic. */
      var redirectPart = topicAfter(raw, ['par jao', 'is par jao', 'us par jao']);
      base.subintent = 'remove-topic';
      base.topic = rTopic;
      if (redirectPart) {
        base.directive = (rTopic
          ? ('Remove the subtask about ' + rTopic)
          : 'Remove the subtask about this source') +
          ' and add a topic about ' + redirectPart;
        base.topic = redirectPart;
      } else {
        base.directive = rTopic
          ? ('Remove the subtask about ' + rTopic)
          : 'Remove the subtask about this source';
      }
      return base;
    }

    /* change-source: "sirf official sources lo", "only official
       sources", "use government sources", "is source ko chor do". */
    var sourceRe = new RegExp(
      'official sources|' +
      'government sources|' +
      'sirf .*sources?|' +
      'only .*sources?|' +
      'use .*sources?|' +
      'sources? chor|' +
      'ذرائع');
    if (sourceRe.test(n) || sourceRe.test(raw)) {
      var sTopic = topicAfter(raw, ['official sources', 'government sources']) ||
        extractTopic(raw, ['lo', 'len', 'use', 'istemal']);
      base.subintent = 'change-source';
      base.topic = sTopic || 'official sources';
      base.directive = (n.indexOf('official') !== -1 ||
        raw.indexOf('official') !== -1)
        ? 'Only focus on official sources'
        : (sTopic ? ('Only focus on ' + sTopic + ' sources')
          : 'Only focus on official sources');
      return base;
    }

    /* scope-limit: "sirf X par", "only X", "limit the scope to X",
       "bas X hi", "صرف X". */
    var scopeRe = new RegExp(
      '\\bonly\\b|' +
      '\\blimit\\b|' +
      '\\bnarrow\\b|' +
      '\\bbas\\b|' +
      'sirf|' +
      'bas .* hi|' +
      'صرف');
    if (scopeRe.test(n) || scopeRe.test(raw)) {
      var scTopic = topicAfter(raw, ['sirf', 'only', 'limit the scope to',
        'limit scope to', 'صرف', 'bas']) || extractTopic(raw, []);
      base.subintent = 'scope-limit';
      base.topic = scTopic;
      base.directive = scTopic
        ? ('Only focus on ' + scTopic)
        : 'Limit the scope to the current topic';
      return base;
    }

    /* focus: "is par zyada focus karo", "focus on X", "zyada dhyaan
       do", "prioritise X", "pehle X", "زیادہ توجہ". */
    var focusRe = new RegExp(
      '\\bfocus\\b|' +
      'zyada dhyaan|' +
      'ziyada dhyaan|' +
      '\\bpriorit|' +
      'pehle|' +
      'زیادہ توجہ|' +
      'توجہ');
    if (focusRe.test(n) || focusRe.test(raw)) {
      var fTopic = topicAfter(raw, ['focus on', 'focus', 'zyada dhyaan',
        'ziyada dhyaan', 'pehle', 'زیادہ توجہ', 'توجہ']) ||
        topicAfter(raw, ['is par', 'iss par', 'us par']) ||
        extractTopic(raw, []);
      base.subintent = 'focus';
      base.topic = fTopic;
      base.directive = fTopic
        ? ('Focus first on ' + fTopic)
        : 'Focus first on the current topic';
      return base;
    }

    /* compare: "compare X and Y", "X vs Y", "muqabla karo". */
    var compareRe = new RegExp(
      '\\bcompar|' +
      '\\bvs\\b|' +
      '\\bversus\\b|' +
      'muqabla|' +
      'موازنہ');
    if (compareRe.test(n) || compareRe.test(raw)) {
      var cTopic = topicAfter(raw, ['compare', 'muqabla', 'موازنہ']) ||
        extractTopic(raw, []);
      base.subintent = 'compare';
      base.topic = cTopic;
      base.directive = cTopic
        ? ('Compare ' + cTopic)
        : 'Compare the options found so far';
      return base;
    }

    /* more-sources: "aur sources lao", "more sources", "zyada sources". */
    var moreSrcRe = new RegExp(
      'more sources|' +
      'additional sources|' +
      'more references|' +
      'extra sources|' +
      'aur sources|' +
      'zyada sources|' +
      'مزید ذرائع');
    if (moreSrcRe.test(n) || moreSrcRe.test(raw)) {
      var msTopic = topicAfter(raw, ['more sources', 'aur sources',
        'zyada sources']) || extractTopic(raw, []);
      base.subintent = 'more-sources';
      base.topic = msTopic;
      base.directive = msTopic
        ? ('Find more sources on ' + msTopic)
        : 'Find more sources on the current topic';
      return base;
    }

    /* more-detail / expand: "zyada detail do", "go deeper", "gehrai
       mein jao", "expand the research on X". */
    var detailRe = new RegExp(
      'more detail|' +
      'zyada detail|' +
      'go deeper|' +
      'go into detail|' +
      'elaborate|' +
      'gehrai|' +
      'تفصیل|' +
      'expand|' +
      'broaden|' +
      'widen');
    if (detailRe.test(n) || detailRe.test(raw)) {
      var dTopic = topicAfter(raw, ['zyada detail', 'more detail',
        'go deeper on', 'expand the research on', 'expand on',
        'gehrai mein', 'تفصیل']) || extractTopic(raw, []);
      base.subintent = (n.indexOf('expand') !== -1 ||
        n.indexOf('broaden') !== -1 || n.indexOf('widen') !== -1)
        ? 'expand' : 'more-detail';
      base.topic = dTopic;
      base.directive = base.subintent === 'expand'
        ? (dTopic ? ('Expand the research on ' + dTopic)
          : 'Expand the research on the current topic')
        : (dTopic ? ('Give more detail on ' + dTopic)
          : 'Give more detail on the current topic');
      return base;
    }

    /* add-topic: "add a topic about X", "is par bhi research karo",
       "aur X bhi cover karo", "include X", "شامل کرو". */
    var addRe = new RegExp(
      '\\badd\\b|' +
      '\\binclude\\b|' +
      '\\bcover\\b|' +
      'look into|' +
      'bhi (research|cover|add)|' +
      'aur .* bhi|' +
      'شامل');
    if (addRe.test(n) || addRe.test(raw)) {
      var aTopic = topicAfter(raw, ['add a topic about', 'add a topic',
        'add', 'include', 'cover', 'look into', 'شامل']) ||
        extractTopic(raw, []);
      base.subintent = 'add-topic';
      base.topic = aTopic;
      base.directive = aTopic
        ? ('Add a topic about ' + aTopic)
        : 'Add a topic about the current question';
      return base;
    }

    /* Generic steer: send the instruction as-is. The server-side
       normaliser rewrites common phrasings ("include X" / "cover X" /
       "research X" -> "add a topic about X") before the P7 classifier
       runs; if it still cannot understand it, the backend answers 400
       and applyGuidance shows that error plainly. */
    base.subintent = 'generic-steer';
    base.topic = extractTopic(raw, []);
    base.directive = raw.replace(/^\s+|\s+$/g, '');
    return base;
  }

  /* ------------------------------------------------------------------ */
  /* Confirmation lines, in the user's language.                         */
  /* ------------------------------------------------------------------ */

  var CONFIRM = {
    stop: {
      ur: 'Ruk gaya — aap ki instruction par research band kar di gayi hai.',
      roman: 'Ruk gaya — aap ki instruction par research band kar di gayi hai.',
      en: 'Stopped — research cancelled on your instruction.'
    },
    pause: {
      ur: 'Ruk gaya — aap ki instruction par research ruki hui hai.',
      roman: 'Ruk gaya — aap ki instruction par research ruki hui hai.',
      en: 'Paused — research is paused on your instruction.'
    },
    resume: {
      ur: 'Dobara shuru ho gaya — research phir se chal rahi hai.',
      roman: 'Dobara shuru ho gaya — research phir se chal rahi hai.',
      en: 'Resumed — research is running again.'
    },
    redirect: {
      ur: 'Theek hai — research ko aap ki instruction ke mutabiq adjust kar diya gaya hai.',
      roman: 'Theek hai — research ko aap ki instruction ke mutabiq adjust kar diya gaya hai.',
      en: 'Done — research has been adjusted as you instructed.'
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

  function confirmText(intent, kind, lang) {
    var group = CONFIRM[intent] || CONFIRM.redirect;
    if (kind === 'error') group = CONFIRM.error;
    if (kind === 'noTask') group = CONFIRM.noTask;
    if (kind === 'sending') group = CONFIRM.sending;
    return group[lang] || group.en;
  }

  /* ------------------------------------------------------------------ */
  /* Backend calls (real endpoints only)                                 */
  /* ------------------------------------------------------------------ */

  function postModify(taskId, directive) {
    /* taskId is the current task id (activeTaskId) */
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

  function currentTaskId() {
    var m = getMonitorOrOverride();
    if (!m) return null;
    try {
      var st = (typeof m.getState === 'function') ? m.getState() : null;
      if (st && st.activeTaskId) return st.activeTaskId;
      if (st && st.tasks) {
        var keys = Object.keys(st.tasks);
        for (var i = 0; i < keys.length; i++) {
          var t = st.tasks[keys[i]] && st.tasks[keys[i]].task;
          if (t && (t.state === 'running' || t.state === 'paused')) {
            return t.task_id;
          }
        }
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  /* Log the guidance as a real timeline activity (source: user guidance).
     Uses the M1 hook noteFrontendStep; never invents backend data. */
  function logGuidance(taskId, parsed, result) {
    var m = getMonitorOrOverride();
    if (!m || typeof m.noteFrontendStep !== 'function') return null;
    var detail = 'Instruction: "' + parsed.raw + '"';
    if (parsed.directive) detail += ' Sent as: "' + parsed.directive + '".';
    if (result && result.modified === false && result.clarification_question) {
      detail += ' Backend asked: "' + result.clarification_question + '"';
    } else if (result && result.message) {
      detail += ' Backend: "' + result.message + '"';
    }
    try {
      return m.noteFrontendStep({
        title: 'Guidance from Raja: ' + parsed.raw,
        detail: detail,
        kind: 'guidance',
        taskId: taskId
      });
    } catch (e) { return null; }
  }

  /* Dispatch a parsed instruction to the running task. Returns a promise
     resolving to { parsed, result } or rejecting with an Error whose
     message is the real backend message. */
  function applyGuidance(text, taskId) {
    var parsed = parseGuidance(text);
    if (parsed.intent === 'empty') {
      return Promise.reject(new Error('empty'));
    }
    var id = taskId || currentTaskId();
    if (!id) {
      setStatus(confirmText('redirect', 'noTask', parsed.lang));
      return Promise.reject(new Error('no-active-task'));
    }
    var m = getMonitorOrOverride();
    var work = null;
    if (parsed.action === 'cancel') {
      if (!m || typeof m.cancelTask !== 'function') {
        return Promise.reject(new Error('EnzoMonitor.cancelTask is not available'));
      }
      work = m.cancelTask(id);
    } else if (parsed.action === 'pause') {
      if (!m || typeof m.pauseTask !== 'function') {
        return Promise.reject(new Error('EnzoMonitor.pauseTask is not available'));
      }
      work = m.pauseTask(id);
    } else if (parsed.action === 'resume') {
      if (!m || typeof m.resumeTask !== 'function') {
        return Promise.reject(new Error('EnzoMonitor.resumeTask is not available'));
      }
      work = m.resumeTask(id);
    } else if (parsed.action === 'modify') {
      work = postModify(id, parsed.directive);
    } else {
      return Promise.reject(new Error('unknown action'));
    }
    inFlight = true;
    setStatus(confirmText(parsed.intent, 'sending', parsed.lang));
    setGuidanceDisabled(true);
    return Promise.resolve(work).then(function (result) {
      inFlight = false;
      setGuidanceDisabled(false);
      logGuidance(id, parsed, result);
      if (result && result.modified === false &&
          result.clarification_question) {
        /* Backend understood the call but needs a clarification before
           changing anything — show its exact question, in its words. */
        setStatus(result.clarification_question);
      } else {
        setStatus(confirmText(parsed.intent, 'ok', parsed.lang));
      }
      return { parsed: parsed, result: result };
    }, function (err) {
      inFlight = false;
      setGuidanceDisabled(false);
      var msg = (err && err.message) ? err.message : 'Task control failed.';
      setStatus(confirmText(parsed.intent, 'error', parsed.lang) + ' (' + msg + ')');
      throw err;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Guidance bar (mounted INSIDE the live view)                         */
  /* ------------------------------------------------------------------ */

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function setGuidanceDisabled(disabled) {
    if (els.micBtn) els.micBtn.disabled = disabled;
    if (els.sendBtn) els.sendBtn.disabled = disabled;
    if (els.input) els.input.disabled = disabled;
  }

  function speechRecognitionCtor() {
    var w = root();
    if (!w) return null;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function micLang() {
    try {
      var lang = (typeof navigator !== 'undefined' && navigator.language)
        ? navigator.language : 'en-US';
      /* Urdu speech (including Roman Urdu spoken aloud) is recognised
         best with the Urdu locale; anything else keeps the browser's. */
      if (lang && lang.toLowerCase().indexOf('ur') === 0) return 'ur-PK';
      return lang;
    } catch (e) { return 'en-US'; }
  }

  function stopListening() {
    if (recognizer) {
      try { recognizer.stop(); } catch (e) { /* already stopped */ }
    }
    listening = false;
    if (els.micBtn) {
      els.micBtn.setAttribute('aria-pressed', 'false');
      els.micBtn.classList.remove('enzo-monitor-guide-listening');
    }
  }

  function startListening() {
    var Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setStatus('Voice input is not supported in this browser — type the instruction instead.');
      return;
    }
    if (listening) { stopListening(); return; }
    var rec = null;
    try {
      rec = new Ctor();
    } catch (e) {
      setStatus('Voice input could not start — type the instruction instead.');
      return;
    }
    recognizer = rec;
    rec.lang = micLang();
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (event) {
      var transcript = '';
      try {
        var res = event.results[event.results.length - 1];
        if (res && res[0]) transcript = res[0].transcript || '';
      } catch (e) { transcript = ''; }
      stopListening();
      if (!transcript) {
        setStatus('Nothing was heard — type the instruction instead.');
        return;
      }
      if (els.input) els.input.value = transcript;
      /* v55 P7 wiring (G3): the live-view guidance mic is gated by
         EnzoVoiceID before anything is sent — when proceed is false a
         refusal has already been spoken by the gate. */
      if (typeof window !== 'undefined' && window.EnzoVoiceID) {
        var gate55 = window.EnzoVoiceID.gateAndRoute(transcript, { source: 'live-view' });
        if (!gate55.proceed) return;
      }
      submitGuidance(transcript);
    };
    rec.onerror = function () {
      stopListening();
      setStatus('Voice input failed — type the instruction instead.');
    };
    rec.onend = function () {
      if (listening) stopListening();
    };
    try {
      rec.start();
      listening = true;
      if (els.micBtn) {
        els.micBtn.setAttribute('aria-pressed', 'true');
        els.micBtn.classList.add('enzo-monitor-guide-listening');
      }
      setStatus('Listening — speak your instruction…');
    } catch (e) {
      listening = false;
      setStatus('Voice input could not start — type the instruction instead.');
    }
  }

  function submitGuidance(text) {
    var value = asString(text !== undefined ? text : (els.input ? els.input.value : ''));
    if (!value.replace(/^\s+|\s+$/g, '')) return;
    /* v55 P9 wiring (assembler seam): agent-targeted guidance is tried
       FIRST; when no agent is named ('no-agent-target') whole-task
       guidance above owns the instruction. */
    var work55;
    if (typeof window !== 'undefined' && window.EnzoAgents && typeof window.EnzoAgents.applyAgentGuidance === 'function') {
      var agents55 = (typeof window.EnzoAgents.getAgents === 'function') ? window.EnzoAgents.getAgents() : [];
      work55 = window.EnzoAgents.applyAgentGuidance(value, undefined, agents55).catch(function (err) {
        if (err && err.message === 'no-agent-target') return applyGuidance(value);
        throw err;
      });
    } else {
      work55 = applyGuidance(value);
    }
    work55.then(function () {
      if (els.input) els.input.value = '';
    }, function () { /* status line already shows the error */ });
  }

  function buildGuidanceBar() {
    if (guidanceBuilt) return els.bar || null;
    var body = $(BODY_ID);
    if (!body) return null;
    var bar = el('div', 'enzo-monitor-guidance');
    bar.id = 'enzoMonitorGuidance';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Live guidance — steer the running research');

    var label = el('div', 'enzo-monitor-guide-label',
      'Guide this research live — speak or type, and ENZO adjusts at once.');
    bar.appendChild(label);

    var row = el('div', 'enzo-monitor-guide-row');

    var micBtn = el('button', 'enzo-monitor-guide-mic', null);
    micBtn.type = 'button';
    micBtn.id = 'enzoMonitorGuideMic';
    micBtn.setAttribute('aria-label', 'Speak an instruction');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.setAttribute('title', 'Speak an instruction');
    micBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor"/>' +
      '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg><span>Mic</span>';
    micBtn.addEventListener('click', function () { startListening(); });
    if (!speechRecognitionCtor()) {
      micBtn.disabled = true;
      micBtn.setAttribute('title',
        'Voice input is not supported in this browser — type the instruction instead.');
    }
    row.appendChild(micBtn);
    els.micBtn = micBtn;

    var input = el('input', 'enzo-monitor-guide-input');
    input.type = 'text';
    input.id = 'enzoMonitorGuideInput';
    input.setAttribute('placeholder',
      'Type an instruction — e.g. stop, pause, focus more on official sources…');
    input.setAttribute('aria-label', 'Type an instruction for the running research');
    input.addEventListener('keydown', function (e) {
      if (e && e.key === 'Enter') {
        if (e.preventDefault) e.preventDefault();
        submitGuidance();
      }
    });
    row.appendChild(input);
    els.input = input;

    var sendBtn = el('button', 'enzo-monitor-guide-send', 'Send');
    sendBtn.type = 'button';
    sendBtn.id = 'enzoMonitorGuideSend';
    sendBtn.setAttribute('aria-label', 'Send instruction');
    sendBtn.addEventListener('click', function () { submitGuidance(); });
    row.appendChild(sendBtn);
    els.sendBtn = sendBtn;

    bar.appendChild(row);

    var status = el('p', 'enzo-monitor-guide-status', null);
    status.id = 'enzoMonitorGuideStatus';
    status.setAttribute('aria-live', 'polite');
    bar.appendChild(status);
    els.status = status;

    /* First child of the monitor body: always visible at the top of the
       live view, above the dashboard and the timeline. */
    if (body.firstChild) body.insertBefore(bar, body.firstChild);
    else body.appendChild(bar);
    els.bar = bar;
    guidanceBuilt = true;
    return bar;
  }

  /* ------------------------------------------------------------------ */
  /* Full-screen open / close                                            */
  /*                                                                     */
  /* Works on the M2 panel DOM (#enzoMonitorPanel). The slide-over must */
  /* already be gone (assembler removes it from M2); open() still      */
  /* defensively closes any slide-over state first, so the button keeps */
  /* working even if the assembler has not rewired it yet.             */
  /* ------------------------------------------------------------------ */

  function panelNode() {
    return $(PANEL_ID);
  }

  function closeSlideOverState() {
    /* Defensive only: if M2's slide-over is still present and open,
       shut it before going full-screen, so the two modes never run
       together. */
    var ui = getMonitorUI();
    if (ui && typeof ui.isOpen === 'function') {
      try {
        if (ui.isOpen()) ui.close();
      } catch (e) { /* best-effort */ }
    }
    var panel = panelNode();
    if (panel && panel.classList) {
      panel.classList.remove('enzo-monitor-open');
    }
    var backdrop = $(BACKDROP_ID);
    if (backdrop) backdrop.hidden = true;
  }

  function wireCloseButton() {
    var closeBtn = $(CLOSE_BTN_ID);
    if (!closeBtn || closeBtn.getAttribute('data-enzo-fullscreen-wired')) return;
    closeBtn.setAttribute('data-enzo-fullscreen-wired', '1');
    closeBtn.addEventListener('click', function () { close(); });
  }

  function open(taskId) {
    if (!mounted) mount();
    /* Make sure M2 built its panel DOM (mount is idempotent). */
    var ui = getMonitorUI();
    if (ui && typeof ui.mount === 'function') {
      try { ui.mount(); } catch (e) { /* panel may already exist */ }
    }
    var panel = panelNode();
    if (!panel) return false;
    closeSlideOverState();
    if (taskId && ui && typeof ui.setActiveTask === 'function') {
      try { ui.setActiveTask(taskId); } catch (e) { /* best-effort */ }
    }
    lastFocused = (typeof document !== 'undefined')
      ? document.activeElement : null;
    if (document.body && document.body.classList) {
      document.body.classList.add(BODY_CLASS);
    }
    panel.hidden = false;
    if (panel.classList) panel.classList.add('enzo-monitor-fullscreen');
    isOpenFlag = true;
    buildGuidanceBar();
    wireCloseButton();
    var closeBtn = $(CLOSE_BTN_ID);
    if (closeBtn && closeBtn.focus) {
      try { closeBtn.focus(); } catch (e) { /* focus is best-effort */ }
    }
    return true;
  }

  function close() {
    if (!isOpenFlag && !panelNode()) return;
    stopListening();
    if (document.body && document.body.classList) {
      document.body.classList.remove(BODY_CLASS);
    }
    var panel = panelNode();
    if (panel) {
      if (panel.classList) panel.classList.remove('enzo-monitor-fullscreen');
      panel.hidden = true;
    }
    var backdrop = $(BACKDROP_ID);
    if (backdrop) backdrop.hidden = true;
    isOpenFlag = false;
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) { /* focus is best-effort */ }
    }
    lastFocused = null;
  }

  function onKeyDown(e) {
    if (!e) return;
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpenFlag) {
      if (e.preventDefault) e.preventDefault();
      close();
    }
  }

  function onDocumentClick(e) {
    /* Fallback wiring until the assembler rewires the button: any click
       on the "View Live Research" button or the Tools-menu entry opens
       the FULL-SCREEN view. open() closes slide-over state first, so
       even if M2's own handler also ran, only full-screen stays open. */
    if (!e || !e.target) return;
    var t = e.target;
    var id = t.id || '';
    if (t.closest) {
      var hit = t.closest('#' + BUTTON_ID + ', #' + TOOLS_ENTRY_ID);
      if (hit) { open(); return; }
    } else if (id === BUTTON_ID || id === TOOLS_ENTRY_ID) {
      open();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mount / unmount                                                     */
  /* ------------------------------------------------------------------ */

  function mount() {
    if (mounted) return true;
    if (typeof document === 'undefined' || !document.body) return false;
    try {
      var ui = getMonitorUI();
      if (ui && typeof ui.mount === 'function') {
        try { ui.mount(); } catch (e) { /* panel build is best-effort */ }
      }
      buildGuidanceBar();
      wireCloseButton();
      if (document.addEventListener) {
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('click', onDocumentClick);
      }
      mounted = true;
      return true;
    } catch (e) {
      mounted = false;
      return false;
    }
  }

  function unmount() {
    if (document && document.removeEventListener) {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick);
    }
    stopListening();
    if (isOpenFlag) close();
    var bar = $('enzoMonitorGuidance');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    els = {};
    guidanceBuilt = false;
    mounted = false;
    isOpenFlag = false;
  }

  var api = {
    mount: mount,
    unmount: unmount,
    open: open,
    close: close,
    toggle: function () { if (isOpenFlag) close(); else open(); },
    isOpen: function () { return isOpenFlag; },
    parseGuidance: parseGuidance,
    applyGuidance: applyGuidance,
    detectLanguage: detectLanguage,
    confirmText: confirmText,
    /* Test-only seams (not for production use): */
    _setFetchForTest: function (fn) { fetchFnOverride = fn || null; },
    _setMonitorForTest: function (m) { monitorOverride = m || null; },
    _bodyClass: BODY_CLASS
  };

  try {
    if (typeof window !== 'undefined') window.EnzoMonitorFullscreen = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoMonitorFullscreen = api;
  } catch (e) { /* exposure is best-effort */ }

  function initEnzoMonitorFullscreen() {
    if (typeof document === 'undefined') return false;
    if (document.readyState === 'loading' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', function () { mount(); });
      return true;
    }
    return mount();
  }

  try {
    if (typeof window !== 'undefined') window.initEnzoMonitorFullscreen = initEnzoMonitorFullscreen;
    if (typeof globalThis !== 'undefined') globalThis.initEnzoMonitorFullscreen = initEnzoMonitorFullscreen;
  } catch (e) { /* ignore */ }

  initEnzoMonitorFullscreen();

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
