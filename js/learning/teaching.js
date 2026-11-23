/* ==========================================================================
 * PIECE 41 — Teaching-intent detection (4 languages) + learned store
 * ENAO AI learning track (artifact slug: enao-ai, live build
 * v61-deep-triggers-4lang). This piece wires nothing itself, never edits
 * the artifact, never deploys.
 *
 * WHAT IT DOES
 *   Detects when Raja TEACHES ENZO something ("learn this", "ye seekh
 *   lo", "یہ سیکھ لو", "ایہ سکھ لو", ...) and when he CORRECTS ENZO
 *   ("ye ghalat hai, sahi ye hai ..."), stores the taught item in a NEW
 *   localStorage key, and builds a compact prompt block so answers
 *   honour what was taught. It does NOT change the existing
 *   `enao_learned_v1` shape (langs / lengthPref / topics / corrections)
 *   — other code reads that shape, and this piece leaves it alone.
 *
 * THE STORE (new, separate key):
 *   localStorage key `enao_learned_items_v1` — an array of items:
 *   { id, kind:'fact'|'preference'|'correction'|'skill', text, detail,
 *     lang, source:'taught', ts, topic? }
 *   Items survive reload and new chats (localStorage). `detail` holds
 *   the wrong part of a correction; `text` holds the right part (or the
 *   wrong part when no right part was given).
 *
 * THE RULES (locked by this piece):
 *   - A teaching order is an explicit teaching trigger PLUS taught
 *     content. A bare trigger with nothing taught ("remember this"
 *     alone) stores nothing.
 *   - A correction outranks teaching: it is checked first and is
 *     stored with kind 'correction'.
 *   - Ordinary questions, research orders and bare "find me..." are
 *     NEVER teaching, even when they share a word with a trigger
 *     ("Do you remember this song?", "I want to learn French").
 *   - The confirmation line is ONE short line in the user's language
 *     and never echoes the taught content back.
 *   - buildLearnedNote puts corrections first, then preferences, then
 *     facts/skills; max 12 items, 120 chars each; the oldest items are
 *     dropped from the NOTE only, never from storage.
 *
 * PUBLIC API (pure functions, no DOM, no network, no dependencies):
 *   detectTeaching(text)
 *     -> { isTeaching:true, kind, content, lang, matched } | null
 *   detectCorrection(text)
 *     -> { isCorrection:true, wrongPart, rightPart, lang } | null
 *   createLearnedStore(storage?)
 *     -> { addItem, getItems, deleteItem, clearAll, findByTopic }
 *     storage defaults to localStorage, with a shared in-memory
 *     fallback when localStorage is absent (Node). Pass the same
 *     storage object to share one store across instances.
 *   confirmLine(item, lang?) -> one short line, user's language
 *   buildLearnedNote(items) -> prompt block string ('' when empty)
 *   applyTeaching(text, deps?)
 *     -> { learned:item|null, confirm:string|null, isCorrection:bool }
 *     deps: { store } or { storage }; defaults to the shared store.
 *   detectTeachLang(text) -> 'en' | 'roman' | 'urdu' | 'punjabi'
 *
 * WIRING (assembler — this piece wires nothing itself):
 *   1. FRONTEND, message-send path, BEFORE intent routing: call
 *      EnzoTeaching.applyTeaching(text). If result.learned is set,
 *      show result.confirm as the reply and do NOT route the message
 *      as a question / research order / normal answer.
 *   2. FRONTEND, learnedPrefs / learnedNote (~line 16351): read the
 *      items store as well — call EnzoTeaching.buildLearnedNote(
 *      EnzoTeaching.createLearnedStore().getItems()) and append its
 *      block to the prompt, so corrections and taught facts reach
 *      answer generation. The existing `enao_learned_v1` note stays
 *      as-is; this block is additional.
 *   3. FRONTEND, Settings "what ENZO has learned" panel: list the
 *      items store (getItems) with per-item Delete (deleteItem) and a
 *      Delete-everything (clearAll), next to the existing learned
 *      panel. Learned things are shown there and deletable, per the
 *      learning rule.
 *
 * STYLE: plain ES5, var + function declarations, no modules, matching
 * the existing artifact style and the piece-31 trigger style (regex
 * families per language, guarded UMD export). Zero emojis. No topic
 * names anywhere in this file.
 * ========================================================================== */
(function (root) {
'use strict';

/* ---------- small helpers ---------- */
function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

/* ---------- language detection ----------
   Mirrors the artifact's detectLang, extended with Punjabi Shahmukhi
   (the artifact returns 'urdu' for all Arabic-script text). Punjabi
   markers: ایہ / اگوں / توں / تسی / لبھو / ویکھو / سکھو / کردا /
   چاہندا / کھلدا / آں / وچ / مینوں, and a standalone اے as the
   copula (Urdu uses ہے instead). Roman Punjabi markers: tusi /
   vekho / labho / sikho / eh / aggon. */
var PUNJABI_SCRIPT_RE = /ایہ|اگوں|توں|تسی|تواڈا|لبھو|ویکھو|سکھو|چکو|چھڈو|کردا|چاہندا|کھلدا|آں|مینوں| وچ | نال |(^|\s)اے(\s|$|[؟۔،؛!?.،,])/;
var ROMAN_PUNJABI_RE = /\b(tusi|tussi|vekho|labho|sikho|eh|aggon|tuada|meinu|tainu)\b/;
var ROMAN_MARKER_RE = /\b(kya|kia|hai|hain|yaad|seekh|aage|mera|meri|mujhe|batao|karo|chahiye|hamesha|pasand|ghalat|galat|sahi|kuch|aur|nahi|kab|kaise|kyun)\b/;

function detectTeachLang(text) {
  var raw = String(text || '');
  if (/[\u0600-\u06FF]/.test(raw)) {
    if (PUNJABI_SCRIPT_RE.test(raw)) return 'punjabi';
    return 'urdu';
  }
  var low = ' ' + raw.toLowerCase() + ' ';
  if (ROMAN_PUNJABI_RE.test(low)) return 'punjabi';
  if (ROMAN_MARKER_RE.test(low)) return 'roman';
  return 'en';
}

/* ---------- teaching triggers ----------
   Ordered longest-first inside each language family so the longest
   phrase wins the match (e.g. "ye yaad rakhna" before "yaad rakhna",
   "from now on do it like this" before "from now on"). `kind` is the
   trigger's default; content-based preference signals can still
   promote a fact to a preference (see isPreferenceContent). */
var TEACH_PATTERNS = [
  /* English */
  { re: /from now on(?:,)?\s+do it like this/i, kind: 'preference' },
  { re: /from now on/i, kind: 'preference' },
  { re: /learn how to/i, kind: 'skill' },
  { re: /learn this/i, kind: 'fact' },
  { re: /learn that/i, kind: 'fact' },
  { re: /remember this/i, kind: 'fact' },
  { re: /remember that/i, kind: 'fact' },
  { re: /keep in mind/i, kind: 'preference' },
  { re: /note this down/i, kind: 'fact' },
  { re: /make a note of this/i, kind: 'fact' },
  { re: /note this/i, kind: 'fact' },
  /* Roman Urdu */
  { re: /aage se aisa karna/i, kind: 'preference' },
  { re: /aage se aisa karo/i, kind: 'preference' },
  { re: /ye yaad rakhna/i, kind: 'fact' },
  { re: /yeh yaad rakhna/i, kind: 'fact' },
  { re: /yaad rakhna/i, kind: 'fact' },
  { re: /yaad rakho/i, kind: 'fact' },
  { re: /ye seekh lo/i, kind: 'fact' },
  { re: /yeh seekh lo/i, kind: 'fact' },
  /* Urdu script (specific phrases first) */
  { re: /آگے سے ایسا کرنا/, kind: 'preference' },
  { re: /یہ یاد رکھنا/, kind: 'fact' },
  { re: /یہ سیکھ لو/, kind: 'fact' },
  /* Punjabi Shahmukhi (specific phrases first) */
  { re: /اگوں توں ایداں کرنا/, kind: 'preference' },
  { re: /اگوں توں ایداں کرو/, kind: 'preference' },
  { re: /ایہ یاد رکھنا/, kind: 'fact' },
  { re: /ایہ یاد رکھو/, kind: 'fact' },
  { re: /ایہ سکھ لو/, kind: 'fact' },
  /* Shared Urdu-script phrases (same words in Urdu and Punjabi) */
  { re: /یاد رکھنا/, kind: 'fact' },
  { re: /یاد رکھو/, kind: 'fact' }
];

/* Preference signals in the taught content itself: "I always want
   short answers" is a preference even when the trigger was "learn
   this". Checked on the extracted content, not the whole message. */
function isPreferenceContent(content) {
  var low = ' ' + String(content).toLowerCase() + ' ';
  if (/\b(always|never|from now on|i (like|prefer|love|hate|want)|i don'?t (like|want|eat))\b/.test(low)) return true;
  if (/\b(hamesha|pasand|chahta|chahti|chahiye|kabhi nahi)\b/.test(low)) return true;
  if (/(ہمیشہ|پسند|چاہتا|چاہتی|چاہندا|چاہیے|کبھی نہیں)/.test(content)) return true;
  return false;
}

/* Strip the trigger phrase's surrounding separators and a leading
   connector word ("ke" / "کہ" / "that") from the extracted content. */
function cleanContent(s) {
  var out = trim(s);
  out = out.replace(/^[:\-–—,\.،؛؛\s]+/, '');
  out = out.replace(/[:\-–—,\.،؛؛\s]+$/, '');
  out = out.replace(/^(ke|کہ|that)\s+/i, '');
  return trim(out);
}

function detectTeaching(text) {
  var raw = String(text == null ? '' : text);
  var trimmed = trim(raw);
  if (!trimmed) return null;
  /* A question is never teaching, even when it shares a trigger word
     ("Do you remember this song?"). Teaching orders are imperatives
     or statements, never questions. */
  if (/\?\s*$/.test(trimmed)) return null;
  if (/\bdo you remember\b/i.test(trimmed)) return null;
  /* The user wanting to learn something himself is not teaching ENZO
     ("I want to learn French", "teach me how to cook"). */
  if (/^(teach me|help me learn|can you teach)\b/i.test(trimmed)) return null;
  if (/\b(i want|i need|i would like|i'?d like|help me|teach me)\b[^.?!]*\b(to )?learn\b/i.test(trimmed)) return null;

  var i, m, pat, after, before, content, kind;
  for (i = 0; i < TEACH_PATTERNS.length; i++) {
    pat = TEACH_PATTERNS[i];
    m = pat.re.exec(raw);
    if (!m) continue;
    /* Content usually follows the trigger ("learn this: X"); when
       the trigger comes last ("X, remember this") it precedes it. */
    after = trim(raw.slice(m.index + m[0].length));
    before = trim(raw.slice(0, m.index));
    content = cleanContent(after || before);
    if (!content) return null; /* bare trigger, nothing taught */
    kind = pat.kind;
    if (isPreferenceContent(content)) kind = 'preference';
    return { isTeaching: true, kind: kind, content: content,
      lang: detectTeachLang(raw), matched: m[0] };
  }
  return null;
}

/* ---------- corrections (higher priority than teaching) ----------
   A correction names what was wrong and, usually, what is right:
   "ye ghalat hai, sahi ye hai ke ..." / "that's wrong, the right
   thing is ...". The separator phrase splits right from wrong; when
   there is no separator, the whole remainder (minus the "wrong"
   phrase) is the wrong part and rightPart is ''. */
var CORR_WRONG_RES = [
  /that'?s wrong/i, /that is wrong/i, /that'?s not right/i,
  /that'?s incorrect/i, /that is incorrect/i,
  /ye ghalat hai/i, /yeh ghalat hai/i, /ye galat hai/i, /yeh galat hai/i,
  /یہ غلط ہے/, /ایہ غلط اے/, /غلط ہے/, /غلط اے/
];
var CORR_SEP_RES = [
  /the right thing is/i, /the correct (thing|answer) is/i,
  /sahi ye hai/i, /sahi yeh hai/i, /asal ye hai/i, /asal yeh hai/i,
  /صحیح یہ ہے/, /اصل یہ ہے/, /صحیح ایہ اے/, /اصل ایہ اے/
];

function stripWrongPhrases(s) {
  var out = String(s == null ? '' : s), i;
  for (i = 0; i < CORR_WRONG_RES.length; i++) out = out.replace(CORR_WRONG_RES[i], ' ');
  out = out.replace(/^(no|nahi|nahin|نہیں|نئیں)[,\s]+/i, '');
  return cleanContent(out);
}

function detectCorrection(text) {
  var raw = String(text == null ? '' : text);
  var trimmed = trim(raw);
  if (!trimmed) return null;
  var i, m, sep = null, hasWrong = false;
  for (i = 0; i < CORR_WRONG_RES.length; i++) {
    if (CORR_WRONG_RES[i].test(raw)) { hasWrong = true; break; }
  }
  for (i = 0; i < CORR_SEP_RES.length; i++) {
    m = CORR_SEP_RES[i].exec(raw);
    if (m) { sep = m; break; }
  }
  if (!hasWrong && !sep) return null;
  var wrongPart, rightPart;
  if (sep) {
    rightPart = cleanContent(raw.slice(sep.index + sep[0].length));
    wrongPart = stripWrongPhrases(trim(raw.slice(0, sep.index)));
  } else {
    wrongPart = stripWrongPhrases(trimmed);
    rightPart = '';
  }
  return { isCorrection: true, wrongPart: wrongPart, rightPart: rightPart,
    lang: detectTeachLang(raw) };
}

/* ---------- the learned store ----------
   Storage adapter injected via deps; default is localStorage with a
   shared in-memory fallback (Node / no-localStorage). The fallback is
   module-level so repeated default stores share one memory copy. */
var ITEMS_KEY = 'enao_learned_items_v1';
var _counter = 0;
var _fallbackStorage = null;

function memoryStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem) return localStorage;
  } catch (e) {}
  if (!_fallbackStorage) _fallbackStorage = memoryStorage();
  return _fallbackStorage;
}

function createLearnedStore(storage) {
  var store = storage || defaultStorage();

  function read() {
    try {
      var j = JSON.parse(store.getItem(ITEMS_KEY) || 'null');
      if (j && Object.prototype.toString.call(j) === '[object Array]') return j;
    } catch (e) {}
    return [];
  }
  function write(items) {
    try { store.setItem(ITEMS_KEY, JSON.stringify(items)); } catch (e) {}
  }

  function addItem(item) {
    if (!item || !trim(String(item.text || ''))) return null;
    var items = read();
    _counter++;
    var now = Date.now();
    var saved = {
      id: 'li_' + now + '_' + _counter,
      kind: item.kind || 'fact',
      text: String(item.text).slice(0, 500),
      detail: item.detail ? String(item.detail).slice(0, 500) : '',
      lang: item.lang || 'en',
      source: 'taught',
      ts: item.ts || now
    };
    if (item.topic) saved.topic = String(item.topic).slice(0, 100);
    items.push(saved);
    write(items);
    return saved;
  }
  function getItems() { return read(); }
  function deleteItem(id) {
    var items = read();
    var kept = items.filter(function (it) { return it.id !== id; });
    if (kept.length === items.length) return false;
    write(kept);
    return true;
  }
  function clearAll() {
    write([]);
    try { store.removeItem(ITEMS_KEY); } catch (e) {}
  }
  function findByTopic(topic) {
    var q = trim(String(topic == null ? '' : topic)).toLowerCase();
    if (!q) return [];
    return read().filter(function (it) {
      var hay = ((it.text || '') + ' ' + (it.detail || '') + ' ' + (it.topic || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  return { addItem: addItem, getItems: getItems, deleteItem: deleteItem,
    clearAll: clearAll, findByTopic: findByTopic, key: ITEMS_KEY };
}

/* ---------- confirmation line ----------
   ONE short line in the user's language. Never echoes the taught
   content back. */
var CONFIRM_LINES = {
  en: { learned: "Got it — I've learned that.", correction: "Got it — I've corrected that." },
  roman: { learned: "Samajh gaya — ye seekh liya hai.", correction: "Samajh gaya — ghalti theek kar li hai." },
  urdu: { learned: "سمجھ گیا — یہ سیکھ لیا ہے۔", correction: "سمجھ گیا — غلطی ٹھیک کر لی ہے۔" },
  punjabi: { learned: "سمجھ گیا — ایہ سکھ لیا اے۔", correction: "سمجھ گیا — غلطی ٹھیک کر لئی اے۔" }
};

function confirmLine(item, lang) {
  var l = lang || (item && item.lang) || 'en';
  if (!CONFIRM_LINES[l]) l = 'en';
  var kind = (item && item.kind === 'correction') ? 'correction' : 'learned';
  return CONFIRM_LINES[l][kind];
}

/* ---------- prompt block for answer generation ----------
   Corrections FIRST (highest priority), then preferences, then facts
   and skills. Newest first inside each group. Max 12 items, 120
   chars of item text each. Items dropped from the note are the
   oldest of the lowest-priority group — storage is never trimmed
   here. Returns '' when there is nothing to note. */
var NOTE_MAX_ITEMS = 12;
var NOTE_MAX_CHARS = 120;

function noteLine(item) {
  var text = trim(String(item.text || '')).slice(0, NOTE_MAX_CHARS);
  var detail = trim(String(item.detail || '')).slice(0, NOTE_MAX_CHARS);
  if (item.kind === 'correction') {
    if (detail) return 'CORRECTION: never say "' + detail + '" again; say "' + text + '" instead.';
    return 'CORRECTION: "' + text + '" is wrong — never say it again.';
  }
  if (item.kind === 'preference') return 'PREFERENCE: ' + text + '.';
  if (item.kind === 'skill') return 'SKILL: ' + text + '.';
  return 'FACT: ' + text + '.';
}

function buildLearnedNote(items) {
  var list = (items || []).slice(0);
  if (!list.length) return '';
  var rank = { correction: 0, preference: 1, fact: 2, skill: 2 };
  list.sort(function (a, b) {
    var ra = rank[a.kind] == null ? 2 : rank[a.kind];
    var rb = rank[b.kind] == null ? 2 : rank[b.kind];
    if (ra !== rb) return ra - rb;
    return (b.ts || 0) - (a.ts || 0);
  });
  var lines = list.slice(0, NOTE_MAX_ITEMS).map(noteLine);
  return '[What ENZO has learned from you — apply silently:\n' +
    lines.map(function (l) { return '- ' + l; }).join('\n') + '\n]';
}

/* ---------- wiring entry ----------
   Correction first, then teaching. Returns the stored item (or null)
   plus the one-line confirmation. A bare trigger, a question, a
   research order or a greeting stores nothing. */
function applyTeaching(text, deps) {
  deps = deps || {};
  var store = deps.store || createLearnedStore(deps.storage);
  var corr = detectCorrection(text);
  if (corr) {
    var saved = store.addItem({
      kind: 'correction',
      text: corr.rightPart || corr.wrongPart,
      detail: corr.rightPart ? corr.wrongPart : '',
      lang: corr.lang || detectTeachLang(text)
    });
    return { learned: saved, confirm: saved ? confirmLine(saved) : null, isCorrection: true };
  }
  var t = detectTeaching(text);
  if (!t) return { learned: null, confirm: null, isCorrection: false };
  var saved2 = store.addItem({
    kind: t.kind, text: t.content, detail: '', lang: t.lang
  });
  return { learned: saved2, confirm: saved2 ? confirmLine(saved2) : null, isCorrection: false };
}

/* ---------- exports (guarded UMD, piece-31 style) ---------- */
var api = {
  detectTeaching: detectTeaching,
  detectCorrection: detectCorrection,
  detectTeachLang: detectTeachLang,
  createLearnedStore: createLearnedStore,
  confirmLine: confirmLine,
  buildLearnedNote: buildLearnedNote,
  applyTeaching: applyTeaching,
  ITEMS_KEY: ITEMS_KEY,
  NOTE_MAX_ITEMS: NOTE_MAX_ITEMS,
  NOTE_MAX_CHARS: NOTE_MAX_CHARS
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.EnzoTeaching = api;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
