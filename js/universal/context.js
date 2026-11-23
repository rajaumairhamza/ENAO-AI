
/* ============================================================================
   ENAO AI universal-intel — PIECE 11: universal context + memory
   File: 11-context.js
   Artifact: enao-ai (web_static). Builds on live v56-universal.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. DO NOT EDIT ANY OTHER FILE.

   PURPOSE
   -------
   Root cause (AUDIT.md §3): there is no context/memory intelligence.
   The live per-chat state tracks a topic and decided topics only. No
   entity tracking, no preference store, no active-task record, no
   continuation-vs-new-request detection, no long-conversation
   summarisation. History is passed raw (last N turns) or not at all.
   This piece is the single memory for a chat: it records entities and
   preferences from each turn, tracks active tasks, remembers what the
   user already provided so the caller never re-asks it, tells a
   continuation from a new request, and keeps long history as a rolling
   summary instead of raw turns. Topic-neutral: entities, preferences
   and tasks are extracted from the user's own words, never from a
   list of subjects. No topic names appear anywhere in this file.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   createContextState()
     -> { entities, preferences, activeTasks, decidedTopics, history,
          summary, currentTopic, turnCount }
     entities is a map lower-cased name -> { name, mentions,
     firstTurn, lastTurn }. preferences is an array of extracted
     preference strings (de-duplicated, most recent last).
     activeTasks is an array of { id, title, status, startedTurn,
     completedTurn }. decidedTopics maps a normalised topic to the
     kind decided for it ('research' | 'normal' | ...). history is
     capped (see updateContext). summary is the rolling summary of
     turns that fell off the history cap.
   updateContext(state, turn)
     Mutates and returns state. turn is a string (a user turn) or an
     object { role, text, kind, topic, taskStatus }. It extracts
     entities and preferences from the turn, records a task start or
     completion, updates the current topic and decided topics, appends
     the turn to history, and — when history passes the cap — moves
     the oldest turns into summary instead of dropping them.
   isContinuation(text, state) -> boolean
     True when the message continues an active task or the current
     topic: a pronoun / demonstrative referring back, a content-word
     overlap with the current topic or an active task, or a short
     fragment / ellipsis ("and its advantages?", "tell me more")
     while a topic is active. False for a new request naming a
     different subject, or when there is no prior context at all.
   getMissingInfo(text, state)
     -> [{ slot, value }, ...]
     The slots the user ALREADY provided, so the caller never re-asks
     them: topic, language, detail level, format, sources, time
     limit, and any recorded preference / active task. A slot is
     listed only when its value is actually known from the state
     (or the message itself); unknown slots are never listed.
   contextPack(state, text)
     -> { currentTopic, activeTasks, decidedTopics, relevantHistory,
          preferences, knownSlots, summary, language }
     A compact pack for the answer pipeline: the current topic, the
     titles of active tasks, the decided-topics map, up to 6 relevant
     history turns (most recent first), the preferences, the
     already-known slots, and the rolling summary.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing v53/v54/v55/v56 file style. Zero emojis.
   ========================================================================== */

(function (root) {

var VERSION = '11-context v1.0 (enao-universal-intel, 22 Nov 2026)';
var CTX_HISTORY_CAP = 20;
var CTX_SUMMARY_CAP = 1200;
var CTX_MAX_ENTITIES = 40;
var CTX_MAX_PREFERENCES = 20;

/* ---------- small helpers ---------- */
function cxTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function cxHasUrdu(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }
function cxHasDevanagari(s) { return /[\u0900-\u097F]/.test(String(s || '')); }
function cxClip(s, max) {
  var t = cxTrim(s);
  if (t.length <= max) return t;
  var cut = t.slice(0, max);
  var sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut + '...';
}
function cxNormKey(s) {
  return cxTrim(String(s || '').toLowerCase()).replace(/\s+/g, ' ');
}
function cxStem(w) {
  w = String(w || '');
  if (w.length > 3 && w.slice(-1) === 's') return w.slice(0, -1);
  return w;
}

/* ---------- stopwords (shared with piece 10's approach, standalone) ---------- */
function cxStopTable(list) {
  var t = {};
  var i;
  for (i = 0; i < list.length; i++) t[list[i]] = 1;
  return t;
}
var CX_STOP_EN = cxStopTable(('what is are was were who whom whose when where why how which ' +
  'that this it its the a an of about tell me please explain in simple words ' +
  'define definition meaning do does did you your think know can could would ' +
  'should give list and or for to on with by from as at first also more some ' +
  'any all new lets let us discuss talk research using sources actually ' +
  'change topic per anymore again just like want need go deeper into compare ' +
  'something else be been being have has had there here they them their he ' +
  'she his her we our i my am not no yes if then than so but very really ' +
  'quite only even still already now today second create creates created ' +
  'make makes made invent invents invented found founded discover discovers ' +
  'discovered write writes wrote written build builds built develop develops ' +
  'developed produce produces produced cause causes caused happen happens ' +
  'happened work works worked use uses used come comes came goes went take ' +
  'takes took get gets got gives gave say says said see sees saw knows knew ' +
  'thinks thought feel feels felt live lives lived grow grows grew help helps ' +
  'helped show shows showed play plays played run runs ran start starts ' +
  'started stop stops stopped changes changed mean means meant call calls ' +
  'called name names named set sets put puts keep keeps kept find finds ask ' +
  'asks asked answer answers answered learn learns learned study studies ' +
  'studied teach teaches taught read reads speak speaks spoke listen listens ' +
  'listened watch watches watched look looks looked try tries tried needs ' +
  'needed wants wanted likes liked love loves loved become becomes became ' +
  'seem seems seemed will shall may might must').split(' '));
var CX_STOP_ROMAN = cxStopTable(('kya kia hai ha hain hen ka ki ke ko se mein me par pe ' +
  'batao batayein bataen samjhao samjhaen samjhaein konsa kaunsa kyun kab ' +
  'kaisa mera meri mere mujhe aap ap tum tu yeh ye woh wo nahi nahin aur tha ' +
  'thi the kar karo karein chahiye wala wali aj aaj kal bohat bahut acha ' +
  'achha theek thik rahe rahay rahy ho is us isko usko iska iske iski uska ' +
  'uske uski kis kisne ne banaya banaye banata karta karte karti karna karne ' +
  'hona hone jana jane aana aane dena dene lena lene milna milne matlab kehte ' +
  'kehtay pehle ab chalo baat zara cheez hota hoti hote sunao shukriya na hi ' +
  'toh to phir bhi ya jo jis jin raha rahi ga gi ge jayega jayegi lage ' +
  'lagega time kitne kitna kitni kahan kidhar kaun kon konsi kaunsi aisi ' +
  'aisay aise waisay aisa waisa thora thoda zyada kam hoon hun gaya gayi ' +
  'gaye aaya aayi aaye lagta lagti lagte hoga hogi').split(' '));
var CX_STOP_URDU = cxStopTable(('کیا ہے ہیں کا کی کے کو سے میں پر بتاؤ بتائیں سمجھاؤ کونسا ' +
  'کیوں کب کیسا میرا مجھے آپ یہ وہ نہیں اور تھا تھی کر کرو چاہیے والا والی ' +
  'آج کل بہت اچھا ٹھیک رہے ہو اس کس نے بنایا مطلب کہتے پہلے اب چلو بات چیز ' +
  'ہوتا ہوتی سناؤ شکریہ نہ ہی تو پھر بھی یا جو جس جن رہا رہی گا گی ہوں کتنے ' +
  'کتنا کہاں کدھر کون ایسا ایسے تھوڑا زیادہ کرنا کرنے جانا آنا دینا لینا ملنا ' +
  'ہوگا ہوگی گیا گئی گئے آیا آئی آئے پھر بعد').split(' '));
var CX_STOP_HINDI = cxStopTable(('क्या है हैं का की के को से में पर बताओ बताएँ समझाओ कौनसा ' +
  'क्यों कब कैसा मेरा मुझे आप यह वह नहीं और था थी कर करो चाहिए वाला वाली ' +
  'आज कल बहुत अच्छा ठीक रहे हो इस किस ने बनाया मतलब कहते पहले अब चलो बात चीज ' +
  'होता होती सुनाओ शुक्रिया न ही तो फिर भी या जो जिस जिन रहा रही गा गी हूँ कितने ' +
  'कितना कहाँ किधर कौन ऐसा ऐसे थोड़ा ज्यादा करना करने जाना आना देना लेना मिलना ' +
  'होगा होगी गया गई गए आया आई आए फिर बाद').split(' '));
function cxContentWords(text) {
  var s = ' ' + String(text || '').toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
  s = s.replace(/\bkia\b/g, ' kya ');
  s = s.replace(/\bha\b/g, ' hai ');
  s = s.replace(/\bhen\b/g, ' hain ');
  var tokens = cxTrim(s).split(/\s+/);
  var out = [];
  var i, w;
  for (i = 0; i < tokens.length; i++) {
    w = tokens[i];
    if (!w) continue;
    if (CX_STOP_EN[w] || CX_STOP_ROMAN[w] || CX_STOP_URDU[w] || CX_STOP_HINDI[w]) continue;
    if (/^\d+$/.test(w)) continue;
    if (w.length < 2 && w !== 'ai') continue;
    out.push(w);
  }
  return out;
}
function cxTopicOf(text) {
  var words = cxContentWords(text);
  /* Aspect / filler words describe a SIDE of a topic ("in detail",
     "a summary of X", "its advantages"), never the topic itself. */
  var out = [];
  var i;
  for (i = 0; i < words.length && out.length < 4; i++) {
    if (CX_ASPECT[words[i]]) continue;
    out.push(words[i]);
  }
  return out.join(' ');
}
var CX_ASPECT = cxStopTable(('advantages disadvantages benefits drawbacks pros cons ' +
  'features history meaning price prices detail detailed simple brief briefly ' +
  'short quick summary report list faide fayde nuqsanat tareekh qeemat ' +
  'فائدے نقصانات تاریخ مطلب قیمت').split(' '));
function cxWordsShare(a, b) {
  var aw = String(a || '').split(/\s+/);
  var bw = String(b || '').split(/\s+/);
  var i, j;
  for (i = 0; i < aw.length; i++) {
    for (j = 0; j < bw.length; j++) {
      if (aw[i] && cxStem(aw[i]) === cxStem(bw[j])) return true;
    }
  }
  return false;
}
function cxDetectLang(text) {
  var s = String(text || '');
  if (cxHasUrdu(s)) return 'urdu';
  if (cxHasDevanagari(s)) return 'hindi';
  var words = s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  var hits = 0, i;
  var markers = ['kya', 'kia', 'hai', 'hain', 'ka', 'ki', 'ke', 'mein',
    'batao', 'samjhao', 'konsa', 'kaunsa', 'kyun', 'kab', 'kaisa', 'mera',
    'mujhe', 'aap', 'yeh', 'woh', 'nahi', 'aur', 'par', 'se', 'ko', 'bhi',
    'tha', 'thi', 'kar', 'karo', 'chahiye', 'wala', 'wali', 'aj', 'aaj',
    'kal', 'bohat', 'acha', 'theek', 'rahe', 'ho', 'kidhar', 'kahan',
    'kitne', 'tum', 'abhi', 'kis', 'kaise', 'matlab', 'kehte'];
  for (i = 0; i < words.length; i++) if (markers.indexOf(words[i]) > -1) hits++;
  if (hits >= 2 || (hits >= 1 && words.length <= 6)) return 'roman';
  return 'en';
}

/* ---------- PUBLIC: createContextState ---------- */
function createContextState() {
  return {
    entities: {},
    preferences: [],
    activeTasks: [],
    decidedTopics: {},
    history: [],
    summary: '',
    currentTopic: null,
    turnCount: 0
  };
}

/* ---------- entity extraction (from the user's own words only) ---------- */
function cxAddEntity(state, name, turnNo) {
  var key = cxNormKey(name);
  if (!key || key.length < 2) return;
  var count = 0, k;
  for (k in state.entities) { if (state.entities.hasOwnProperty(k)) count++; }
  if (!state.entities[key] && count >= CTX_MAX_ENTITIES) return;
  if (!state.entities[key]) {
    state.entities[key] = { name: key, mentions: 0, firstTurn: turnNo, lastTurn: turnNo };
  }
  state.entities[key].mentions++;
  state.entities[key].lastTurn = turnNo;
}
function cxExtractEntities(state, text, turnNo) {
  var raw = String(text || '');
  var m, i;
  /* Quoted phrases name an entity exactly as the user wrote it. */
  var qre = /["“”]([^"“”]{2,60})["“”]/g;
  while ((m = qre.exec(raw)) !== null) cxAddEntity(state, m[1], turnNo);
  /* Capitalised runs in Latin text ("New York", "Solar System"). */
  var cre = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  while ((m = cre.exec(raw)) !== null) {
    var phrase = m[1];
    /* A capital at the very start of a sentence is not an entity
       on its own; a multi-word capitalised run is. */
    if (phrase.indexOf(' ') === -1 && m.index === 0) continue;
    if (/^(I|What|Why|How|When|Where|Who|Which|Tell|Explain|Please|Research|First|Then|Next)$/.test(phrase)) continue;
    cxAddEntity(state, phrase, turnNo);
  }
  /* The topic phrase of the turn (content words) is an entity too,
     and so is each single content word in it — a later turn that
     names just one of those words must still match the memory. */
  var topic = cxTopicOf(raw);
  if (topic) cxAddEntity(state, topic, turnNo);
  var words = cxContentWords(raw);
  for (i = 0; i < words.length; i++) {
    if (words[i].length >= 3 && !CX_ASPECT[words[i]]) cxAddEntity(state, words[i], turnNo);
  }
  return;
}

/* ---------- preference extraction (generic phrasing, never a topic) ---------- */
function cxAddPreference(state, pref) {
  var p = cxTrim(String(pref || '').toLowerCase()).replace(/\s+/g, ' ');
  if (!p || p.length < 3) return;
  if (state.preferences.indexOf(p) > -1) return;
  state.preferences.push(p);
  if (state.preferences.length > CTX_MAX_PREFERENCES) {
    state.preferences = state.preferences.slice(state.preferences.length - CTX_MAX_PREFERENCES);
  }
}
function cxExtractPreferences(state, text) {
  var raw = String(text || '');
  var low = raw.toLowerCase();
  var m;
  m = low.match(/\bi\s+(like|love|prefer|enjoy)\s+([^.,;]{2,60})/);
  if (m) cxAddPreference(state, 'likes ' + cxTrim(m[2]));
  m = low.match(/\bi\s+(do\s+not|don\'t|never)\s+(like|want)\s+([^.,;]{2,60})/);
  if (m) cxAddPreference(state, 'dislikes ' + cxTrim(m[3]));
  m = raw.match(/مجھے\s+([^۔،؛]{2,60}?)\s+پسند\s+ہے/);
  if (m) cxAddPreference(state, 'likes ' + cxTrim(m[1]));
  m = low.match(/\bmujhe\s+([^.,;]{2,60}?)\s+pasand\s+hai\b/);
  if (m) cxAddPreference(state, 'likes ' + cxTrim(m[1]));
  m = low.match(/\b(always|hamesha)\s+([^.,;]{2,60})/);
  if (m) cxAddPreference(state, 'always ' + cxTrim(m[2]));
  m = low.match(/\b(never|kabhi\s+nahi|kabhi\s+nai)\s+([^.,;]{2,60})/);
  if (m) cxAddPreference(state, 'never ' + cxTrim(m[2]));
  if (/\bin simple words\b/.test(low)) cxAddPreference(state, 'detail: simple words');
  if (/\bin detail\b|\btafseel se\b|تفصیل سے/.test(low)) cxAddPreference(state, 'detail: in detail');
  if (/\bbriefly\b|\bin short\b|\bmukhtasar\b|مختصر/.test(low)) cxAddPreference(state, 'detail: brief');
  if (/\bin roman urdu\b/.test(low)) cxAddPreference(state, 'language: roman urdu');
  if (/\bin english\b/.test(low)) cxAddPreference(state, 'language: english');
  if (/اردو میں/.test(raw)) cxAddPreference(state, 'language: urdu');
  if (/\b(report|detailed report)\b/.test(low)) cxAddPreference(state, 'format: report');
  if (/\b(list)\b/.test(low)) cxAddPreference(state, 'format: list');
  if (/\b(summary|summarise|summarize)\b/.test(low)) cxAddPreference(state, 'format: summary');
}

/* ---------- task detection ---------- */
var CX_TASK_VERBS = /^\s*(?:please\s+)?(research|investigate|write|make|build|create|prepare|find|search|compare|summarize|summarise|describe|define|design|develop|check|verify|analyse|analyze|explain|translate|calculate|plan|fix|dhoond|likho|banao|taiyar\s+karo|research\s+karo)\b/i;
var CX_TASK_WANT = /\b(i\s+want\s+to|i\s+need\s+to|i\s+would\s+like\s+to|mujhe\s+.+\s+(karna|chahiye|hai))\b/i;
function cxTaskTitle(text) {
  var topic = cxTopicOf(text);
  if (topic) return topic;
  return cxClip(text, 60);
}
function cxIsCompletion(text, role) {
  var low = String(text || '').toLowerCase();
  var folded = ' ' + low.replace(/[?!.,;]+/g, ' ') + ' ';
  if (role === 'user') {
    if (/^\s*(done|finished|complete|completed|ho gaya|mukammal|khatam|bas|stop|ruk jao|theek hai)\b/.test(low)) return 'completed';
    if (/\b(stop|cancel|ruk|band karo)\b/.test(low) && /\b(task|kaam|ye|yeh|wo|woh|it|this|that)\b/.test(low)) return 'cancelled';
  }
  if (role === 'ai') {
    if (/^\s*(done|completed|finished|here is|here\'s|ye raha|yeh raha)\b/.test(low)) return 'completed';
  }
  return null;
}

/* ---------- PUBLIC: updateContext ---------- */
function updateContext(state, turn) {
  if (!state || typeof state !== 'object') state = createContextState();
  if (!state.entities) state.entities = {};
  if (!state.preferences) state.preferences = [];
  if (!state.activeTasks) state.activeTasks = [];
  if (!state.decidedTopics) state.decidedTopics = {};
  if (!state.history) state.history = [];
  if (typeof state.summary !== 'string') state.summary = '';
  if (typeof state.turnCount !== 'number') state.turnCount = 0;

  var role = 'user';
  var text = '';
  var kind = null;
  var topic = null;
  var taskStatus = null;
  if (typeof turn === 'string') {
    text = turn;
  } else if (turn && typeof turn === 'object') {
    role = (turn.role === 'ai' || turn.role === 'assistant') ? 'ai' : 'user';
    text = turn.text || turn.plain || '';
    if (typeof turn.kind === 'string') kind = turn.kind;
    if (typeof turn.topic === 'string') topic = turn.topic;
    if (typeof turn.taskStatus === 'string') taskStatus = turn.taskStatus;
    if (typeof turn.decided === 'string' && topic) {
      state.decidedTopics[cxNormKey(topic)] = turn.decided;
    }
  }
  text = String(text == null ? '' : text);
  if (!cxTrim(text)) return state;
  state.turnCount++;

  var turnNo = state.turnCount;
  var entryTopic = topic || cxTopicOf(text) || null;

  /* Current topic: a user turn that names a topic sets it; a
     pronoun-only / aspect-only follow-up ("What are its
     disadvantages?", "aur faide?") keeps the previous one — its
     words name a side of the old topic, not a new subject. */
  var hasPronoun = /\b(it|its|this|that|they|them|their|he|she|his|her|him|ye|yeh|wo|woh|is|us|isko|usko|ise|usse|isi|usi)\b/i.test(text) || /اس|یہ|وہ|اسی/.test(text);
  var aspectOnly = false;
  if (entryTopic) {
    var ew = cxContentWords(text);
    aspectOnly = ew.length > 0;
    var ei;
    for (ei = 0; ei < ew.length; ei++) if (!CX_ASPECT[ew[ei]]) { aspectOnly = false; break; }
  }
  if (role === 'user' && entryTopic && !hasPronoun && !aspectOnly) state.currentTopic = entryTopic;

  /* Decided topics: a classified kind attached to a topic is
     remembered, so a later turn on the same topic never re-asks
     how it should be handled. */
  if (kind && entryTopic) {
    state.decidedTopics[cxNormKey(entryTopic)] = kind;
  }

  /* Entities and preferences come from user turns only: the
     assistant's own wording must not become the user's memory. */
  if (role === 'user') {
    cxExtractEntities(state, text, turnNo);
    cxExtractPreferences(state, text);
  }

  /* Task start: an action verb (or "I want to ...") with an object,
     or an explicit taskStatus of 'started'. A new task on a different
     subject does not cancel the old one — both stay listed until one
     is completed or cancelled. */
  var completion = taskStatus === 'complete' || taskStatus === 'completed' ? 'completed' :
    (taskStatus === 'cancel' || taskStatus === 'cancelled' ? 'cancelled' : cxIsCompletion(text, role));
  if (completion && state.activeTasks.length) {
    var target = null;
    var i;
    for (i = state.activeTasks.length - 1; i >= 0; i--) {
      if (state.activeTasks[i].status === 'active') { target = state.activeTasks[i]; break; }
    }
    if (target) {
      /* A completion names the most recent active task unless the
         turn names a different one. A bare completion ("done") or an
         explicit taskStatus always applies to the most recent task:
         "done" is not a topic, and the caller already decided. */
      var isBareCompletion = /^\s*(done|finished|complete|completed|ho gaya|mukammal|khatam|bas)\s*[?!.]*$/i.test(text);
      var namesOther = entryTopic && target.title && !cxWordsShare(entryTopic, target.title);
      if (!namesOther || isBareCompletion || taskStatus) {
        target.status = completion;
        target.completedTurn = turnNo;
      }
    }
  } else if (role === 'user' && (taskStatus === 'started' || CX_TASK_VERBS.test(text) || CX_TASK_WANT.test(text))) {
    var title = cxTaskTitle(text);
    var exists = false;
    var j;
    for (j = 0; j < state.activeTasks.length; j++) {
      if (state.activeTasks[j].status === 'active' && state.activeTasks[j].title === title) { exists = true; break; }
    }
    if (!exists) {
      state.activeTasks.push({ id: 'task-' + turnNo, title: title, status: 'active', startedTurn: turnNo, completedTurn: null });
    }
  }

  /* History, capped, with a rolling summary of the oldest turns. */
  state.history.push({ role: role, text: text, turn: turnNo, topic: entryTopic });
  while (state.history.length > CTX_HISTORY_CAP) {
    var old = state.history.shift();
    var line = (old.role === 'ai' ? 'ENZO: ' : 'User: ') + cxClip(old.text, 140);
    state.summary = state.summary ? state.summary + '\n' + line : line;
    if (state.summary.length > CTX_SUMMARY_CAP) {
      state.summary = state.summary.slice(state.summary.length - CTX_SUMMARY_CAP);
      var nl = state.summary.indexOf('\n');
      if (nl > -1) state.summary = state.summary.slice(nl + 1);
    }
  }
  return state;
}

/* ---------- PUBLIC: isContinuation ---------- */
function isContinuation(text, state) {
  var raw = String(text == null ? '' : text);
  if (!cxTrim(raw)) return false;
  if (!state || typeof state !== 'object') return false;
  var hasContext = !!(state.currentTopic ||
    (state.activeTasks && state.activeTasks.length) ||
    (state.history && state.history.length) ||
    (state.entities && Object.keys(state.entities).length));
  if (!hasContext) return false;

  var folded = ' ' + raw.toLowerCase().replace(/[?!.,;:'"()\[\]{}]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  var content = cxContentWords(raw);
  var topic = state.currentTopic || '';

  /* Explicit new-topic markers with a fresh subject: a new request,
     not a continuation. */
  var newTopicMarker = /\b(actually|let'?s discuss|let us discuss|change of topic|new topic|pehle|first)\b/.test(folded) ||
    /اب|پہلے/.test(raw);
  if (newTopicMarker && content.length) {
    var shares = false;
    if (topic && cxWordsShare(content.join(' '), topic)) shares = true;
    var t;
    for (t = 0; state.activeTasks && t < state.activeTasks.length; t++) {
      if (state.activeTasks[t].status === 'active' && cxWordsShare(content.join(' '), state.activeTasks[t].title)) shares = true;
    }
    if (!shares) return false;
  }

  /* Pronoun / demonstrative referring back to the current topic. */
  var pronounRe = /\b(it|its|this|that|they|them|their|he|she|his|her|him|ye|yeh|wo|woh|is|us|isko|usko|ise|usse|isi|usi)\b/;
  if (pronounRe.test(folded) || /اس|یہ|وہ|اسی/.test(raw)) return true;

  /* Content-word overlap with the current topic or an active task. */
  if (topic && content.length && cxWordsShare(content.join(' '), topic)) return true;
  var a;
  for (a = 0; state.activeTasks && a < state.activeTasks.length; a++) {
    if (state.activeTasks[a].status === 'active' && content.length && cxWordsShare(content.join(' '), state.activeTasks[a].title)) return true;
  }
  /* Overlap with a remembered entity. */
  var k;
  for (k in state.entities) {
    if (state.entities.hasOwnProperty(k) && content.length && cxWordsShare(content.join(' '), k)) return true;
  }

  /* A short fragment / ellipsis while a topic is active ("and its
     advantages?", "aur faide?", "tell me more", "more") continues
     the conversation even though it names nothing new. */
  var words = cxTrim(folded).split(/\s+/).filter(function (w) { return !!w; });
  if (words.length <= 6 && topic) {
    var aspect = /\b(advantages|disadvantages|benefits|drawbacks|pros|cons|features|history|meaning|faide|fayde|nuqsanat|tareekh|matlab|more|aur|مزید|فائدے|نقصانات)\b/.test(folded);
    if (aspect || /tell me more|aur batao|مزید بتائیں/.test(folded)) return true;
    if (content.length === 0) return true;
  }
  return false;
}

/* ---------- PUBLIC: getMissingInfo (already-known slots) ---------- */
function getMissingInfo(text, state) {
  var out = [];
  var seen = {};
  function add(slot, value) {
    if (!value) return;
    var v = cxTrim(String(value));
    if (!v) return;
    if (seen[slot]) return;
    seen[slot] = 1;
    out.push({ slot: slot, value: v });
  }
  if (!state || typeof state !== 'object') return out;
  var raw = String(text == null ? '' : text);

  if (state.currentTopic) add('topic', state.currentTopic);
  var decided = state.decidedTopics || {};
  var dk;
  for (dk in decided) {
    if (decided.hasOwnProperty(dk)) { add('decidedTopic', dk + ' -> ' + decided[dk]); break; }
  }
  var a;
  for (a = 0; state.activeTasks && a < state.activeTasks.length; a++) {
    if (state.activeTasks[a].status === 'active') add('activeTask', state.activeTasks[a].title);
  }
  /* Language: only what the STATE already knows — the dominant
     language of the history, or a recorded language preference.
     The current message alone does not make a slot "already
     provided": an empty state must report no slots at all. */
  var lang = null;
  if (state.history && state.history.length) {
    var counts = { en: 0, roman: 0, urdu: 0, hindi: 0 };
    var h;
    for (h = 0; h < state.history.length; h++) {
      counts[cxDetectLang(state.history[h].text)]++;
    }
    var best = 'en', bestN = 0, kk;
    for (kk in counts) { if (counts.hasOwnProperty(kk) && counts[kk] > bestN) { bestN = counts[kk]; best = kk; } }
    if (bestN > 0) lang = best;
  }
  if (lang) add('language', lang);
  /* Preferences already recorded. */
  var p;
  for (p = 0; state.preferences && p < state.preferences.length; p++) {
    var pref = state.preferences[p];
    if (pref.indexOf('detail:') === 0) add('detailLevel', pref.slice(7));
    else if (pref.indexOf('format:') === 0) add('format', pref.slice(7));
    else if (pref.indexOf('language:') === 0) add('language', pref.slice(9));
    else add('preference', pref);
  }
  /* Numbers the user already gave: sources and a time limit, from
     any history turn (and the current message). */
  var allText = raw;
  var hh;
  for (hh = 0; state.history && hh < state.history.length; hh++) allText += ' ' + state.history[hh].text;
  var m = allText.match(/(\d{1,4})\s*(?:authentic|reliable)?\s*(?:sources|websites|sites|references)/i);
  if (m) add('sources', m[1]);
  m = allText.match(/(?:within|in|under)\s*(\d{1,4})\s*(?:minutes?|mins?)/i);
  if (!m) m = allText.match(/(\d{1,4})\s*(?:minutes?|mins?|minute)\s*(?:mein|main|ke\s+andar)/i);
  if (!m) m = allText.match(/(\d{1,4})\s*منٹ/);
  if (m) add('timeLimitMinutes', m[1]);
  m = allText.match(/(\d{1,5})\s*(?:words?|alfaz|الفاظ)/i);
  if (m) add('wordCount', m[1]);
  return out;
}

/* ---------- PUBLIC: contextPack ---------- */
function contextPack(state, text) {
  var raw = String(text == null ? '' : text);
  var empty = {
    currentTopic: '',
    activeTasks: [],
    decidedTopics: {},
    relevantHistory: [],
    preferences: [],
    knownSlots: [],
    summary: '',
    language: 'en'
  };
  if (!state || typeof state !== 'object') return empty;
  var content = cxContentWords(raw);
  var relevant = [];
  var hist = state.history || [];
  var i;
  /* Most recent first; a turn is relevant when it shares a content
     word with the message, plus the last 2 turns regardless. */
  for (i = hist.length - 1; i >= 0 && relevant.length < 6; i--) {
    var turn = hist[i];
    var shares = content.length && cxWordsShare(content.join(' '), turn.text);
    var isRecent = i >= hist.length - 2;
    if (shares || isRecent) {
      relevant.push({ role: turn.role, text: turn.text, turn: turn.turn });
    }
  }
  var tasks = [];
  for (i = 0; state.activeTasks && i < state.activeTasks.length; i++) {
    if (state.activeTasks[i].status === 'active') tasks.push(state.activeTasks[i].title);
  }
  var decided = {};
  var k;
  for (k in (state.decidedTopics || {})) {
    if (state.decidedTopics.hasOwnProperty(k)) decided[k] = state.decidedTopics[k];
  }
  var known = getMissingInfo(raw, state);
  var lang = 'en';
  for (i = 0; i < known.length; i++) if (known[i].slot === 'language') lang = known[i].value;
  return {
    currentTopic: state.currentTopic || '',
    activeTasks: tasks,
    decidedTopics: decided,
    relevantHistory: relevant,
    preferences: (state.preferences || []).slice(),
    knownSlots: known,
    summary: state.summary || '',
    language: lang
  };
}

/* ---------- export tail (guarded) ---------- */
var EnzoUniversalContext = {
  VERSION: VERSION,
  createContextState: createContextState,
  updateContext: updateContext,
  isContinuation: isContinuation,
  getMissingInfo: getMissingInfo,
  contextPack: contextPack
};

if (typeof root !== 'undefined') root.EnzoUniversalContext = EnzoUniversalContext;
if (typeof module !== 'undefined' && module.exports) module.exports = EnzoUniversalContext;

})(typeof window !== 'undefined' ? window : this);
