
/* ============================================================================
   ENAO AI master-intel — PIECE 01: root-cause intent classifier
   File: 01-intent.js
   Artifact: enao-ai (web_static), builds on live v54-voice-research.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   PURPOSE
   -------
   Replace the scattered, contradictory routing in the live build
   (detectIntent / isGuftagu / isExplicitResearchRequest / analyzeQuestion /
   the v54 classifyVoiceResearch gate / the backend classifier) with ONE
   deterministic, topic-neutral intent classifier that the assembler calls
   first, before any of the old paths. The bug it fixes: the assistant
   repeatedly asks the user to choose between research and normal
   discussion — even for plain definition questions, and even after the
   user already answered that question. See 01-intent.EVIDENCE.md for the
   full root-cause audit (every place the question can be produced, with
   live line numbers).

   DESIGN (short version — full design in the EVIDENCE file)
   ---------------------------------------------------------
   - Meaning, not keywords alone. "Research" fires only on an EXPLICIT
     investigation order (a research verb with a concrete object, a source
     count, a report/comparison deliverable, a verify-the-latest order).
     A bare definition ("What is X?", "X kya hai?", "ye kya hai", "Tell me
     more about X") is NEVER research.
   - "ye kya hai" is a DEFINITION here. This deliberately CORRECTS v54,
     which forced it to research. The master rule is that definitions are
     answered directly; the demonstrative "ye" does not turn a definition
     into an investigation order.
   - Clarify is a last resort, never a default. It fires only for a
     genuinely ambiguous message (two plausible meanings, a missing
     essential research parameter, a destructive/send/delete action on an
     unclear target, a bare topic fragment, an empty message). It NEVER
     fires for definitions or ordinary questions, and the clarification
     question it returns NEVER asks the user to choose between research
     and normal discussion — that question is the loop itself.
   - Anti-loop state. classifyIntent reads per-chat state (ctx) and NEVER
     returns 'clarify' for a question whose clarification was already
     asked and answered, for a topic the user already settled on normal
     conversation, or for research whose parameters were already given.
     Normal-conversation state and research-task state are kept separate
     (createIntelState / updateIntelState): a new topic resets research
     context but keeps conversational memory, and normal talk never
     inherits research state.
   - Multilingual by construction: English, Urdu script, Roman Urdu and
     transliterated Hindi share one normalised path. No topic names
     appear anywhere in this file; the same phrasing classifies the same
     way for any subject.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   classifyIntent(text, ctx)
     -> { kind, reason, params, clarifyQuestion }
     kind is exactly one of 'research' | 'conversation' | 'definition' |
     'general' | 'clarify'. params is extractResearchParams(text).
     clarifyQuestion is a string only when kind is 'clarify', else null.
     ctx is optional; when given it carries per-chat state — either the
     state object itself (from createIntelState) or { state: state }.
     classifyIntent never mutates ctx; call updateIntelState afterwards.
   extractResearchParams(text)
     -> { topic, sources, timeMinutes, wordCount, pageCount, depth,
          geoScope, period, format, sites, categories, quality }
     Missing params are null (sites/categories are [] when none).
   createIntelState()
     -> { mode, currentTopic, currentResearchTaskId, lastClarification,
          decidedTopics, history, lastResearchParams }
     mode is 'normal' | 'researching' | 'awaiting_clarification'.
   updateIntelState(state, text, decision)
     Applies one classified message to the state (mutates and returns
     it). decision is a classifyIntent result object or a kind string.
   isLoopRisk(state, text) -> boolean
     True when answering this message with a clarification now would
     repeat one already asked in this chat.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing v53/v54 file style. Zero emojis.
   ========================================================================== */

/* ---------- normalisation ---------- */
function intTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function intFoldDigits(s) {
  var out = '', i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0x660 && c <= 0x669) out += String.fromCharCode(48 + c - 0x660);
    else if (c >= 0x6F0 && c <= 0x6F9) out += String.fromCharCode(48 + c - 0x6F0);
    else out += s.charAt(i);
  }
  return out;
}
function intNormRoman(text) {
  var s = ' ' + String(text || '').toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
  s = s.replace(/\bkia\b/g, 'kya');
  s = s.replace(/\bha\b/g, 'hai');
  s = s.replace(/\bhen\b/g, 'hain');
  s = s.replace(/\brahay\b/g, 'rahe');
  s = s.replace(/\brahy\b/g, 'rahe');
  s = s.replace(/\bjaa\b/g, 'ja');
  s = s.replace(/\bkidher\b/g, 'kidhar');
  s = s.replace(/\bkonsa\b/g, 'kaunsa');
  s = s.replace(/\bkesay\b/g, 'kaise');
  s = s.replace(/\bkese\b/g, 'kaise');
  s = s.replace(/\bdhoondh\b/g, 'dhoond');
  s = s.replace(/\bdhund\b/g, 'dhoond');
  s = s.replace(/\btalaash\b/g, 'talaash');
  s = s.replace(/\s+/g, ' ');
  return s;
}
function intHasUrdu(text) { return /[\u0600-\u06FF]/.test(String(text || '')); }
function intHasDevanagari(text) { return /[\u0900-\u097F]/.test(String(text || '')); }
function intWordCount(normed) {
  var t = intTrim(normed);
  return t ? t.split(/\s+/).length : 0;
}
function intDetectLang(text) {
  var raw = String(text || '');
  if (intHasUrdu(raw)) return 'urdu';
  if (intHasDevanagari(raw)) return 'hindi';
  if (/\b(kya|kia|hai|hain|karo|kar|batao|samjhao|kaam|kidhar|kahan|kab|tum|aap|mera|meri|mujhe|ye|yeh|wo|woh|shodh|khoj|jaanch|kaisa|kaise|matlab|baare|bare|mein|nahi|abhi|aur|bhi|zara|theek|kaisa|chahiye)\b/i.test(raw)) return 'roman';
  return 'en';
}
function intStateFromCtx(ctx) {
  if (!ctx) return null;
  if (ctx.state) return ctx.state;
  if (ctx.intelState) return ctx.intelState;
  if (ctx.mode && ctx.decidedTopics) return ctx;
  return null;
}
function intTopicKey(topic) {
  return intTrim(String(topic || '').toLowerCase()).replace(/\s+/g, ' ');
}

/* ---------- definition topic extraction (topic of a what-is question) ---------- */
function intCleanTopic(s) {
  var t = intTrim(String(s || '')
    .replace(/[?!.,;:'"()\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' '));
  t = t.replace(/\s+(in simple words|in detail|in short|briefly|tafseel se|vistaar se|gehrai se)\s*$/i, '');
  t = intTrim(t);
  if (!t) return null;
  if (/^(it|that|this|these|those|them|ye|yeh|wo|woh|us|is|isi|usi)$/i.test(t)) return null;
  return t;
}
function intDefinitionTopic(text) {
  var raw = String(text || '');
  var m;
  m = raw.match(/^\s*(?:what\s+is|what\s+are|what\s+was|what\s+were)\s+(?:the\s+)?(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^\s*(?:explain|define|describe|samjhao|samjhaein|samjhaen)\s+(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^\s*tell\s+me\s+(?:more\s+)?about\s+(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^(.+?)\s+(?:kya|kia)\s+(?:hai|ha|hota|hoti|hote)\s*(?:hai|ha)?\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^(.+?)\s+ke\s+baare\s+mein\s+(?:batao|batayein|samjhao|samjhaein)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^(.+?)\s+(?:ka|ki|ke)\s+matlab\s+(?:kya|kia)\s*(?:hai|ha)?\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^(.+?)\s+(?:kise|kis ko|kisko)\s+kehte\s+hain\s*$/i);
  if (m) return intCleanTopic(m[1]);
  if (intHasUrdu(raw)) {
    m = raw.match(/^(.+?)\s*کیا\s*ہے\s*$/);
    if (m) return intCleanTopic(m[1]);
    m = raw.match(/^(.+?)\s*کا\s*مطلب\s*کیا\s*ہے\s*$/);
    if (m) return intCleanTopic(m[1]);
    m = raw.match(/^(.+?)\s*کیا\s*ہوتا\s*ہے\s*$/);
    if (m) return intCleanTopic(m[1]);
    m = raw.match(/^(.+?)\s*کے\s*بارے\s*میں\s*بتاؤ\s*$/);
    if (m) return intCleanTopic(m[1]);
    m = raw.match(/^\s*سمجھاؤ\s+(.+?)\s*$/);
    if (m) return intCleanTopic(m[1]);
  }
  m = raw.match(/^\s*how\s+does\s+(.+?)\s+work\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = raw.match(/^\s*why\s+(?:is|are|does|do|did)\s+(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  if (intHasDevanagari(raw)) {
    m = raw.match(/^(.+?)\s*क्या\s*है\s*$/);
    if (m) return intCleanTopic(m[1]);
    m = raw.match(/^\s*समझाओ\s+(.+?)\s*$/);
    if (m) return intCleanTopic(m[1]);
  }
  return null;
}

/* ---------- research parameter extraction ---------- */
function intStripParamClauses(s) {
  var t = String(s || '');
  t = t.replace(/\bwithin\s+\d+\s*(?:minutes?|mins?|minute)\b/gi, ' ');
  t = t.replace(/\bin\s+\d+\s*(?:minutes?|mins?|minute)\b/gi, ' ');
  t = t.replace(/\b\d+\s*(?:minute|mint|min)\s*(?:mein|main|ke\s+andar)\b/gi, ' ');
  t = t.replace(/\b\d+\s*منٹ\b/g, ' ');
  t = t.replace(/\b\d+\s*(?:authentic|reliable|genuine|credible|trustworthy|real|mustand)?\s*(?:sources?|websites?|web\s*sites?|sites?|references?|research\s*papers?|papers?)\b/gi, ' ');
  t = t.replace(/\b\d+\s*(?:مستند|قابل\s*اعتماد)?\s*(?:ذرائع|ویب\s*سائٹس?|حوالہ\s*جات?)\b/g, ' ');
  t = t.replace(/\band\s+prepare\s+a\s+detailed\s+report\b/gi, ' ');
  t = t.replace(/\bprepare\s+a\s+detailed\s+report\b/gi, ' ');
  t = t.replace(/\band\s+compare\s+their\s+findings\b/gi, ' ');
  t = t.replace(/\bcompare\s+their\s+findings\b/gi, ' ');
  t = t.replace(/\band\s+verify\b/gi, ' ');
  t = t.replace(/\bbut\s+do\s+not\s+use\b.*$/gi, ' ');
  t = t.replace(/\bbut\s+.*$/gi, ' ');
  t = t.replace(/\bdo\s+not\s+use\b.*$/gi, ' ');
  t = t.replace(/\bthe\s+latest\s+developments\s+in\b/gi, ' ');
  t = t.replace(/\blatest\s+developments\s+in\b/gi, ' ');
  t = t.replace(/\b(the\s+)?latest\s+developments\b/gi, ' ');
  t = t.replace(/\bsearch\s+the\s+internet\s+for\b/gi, ' ');
  t = t.replace(/\bthe\s+internet\s+for\b/gi, ' ');
  t = t.replace(/\bcompare\s+findings\s+from\s+different\s+reliable\s+sources\b/gi, ' ');
  t = t.replace(/\b\d+\s*(?:pages?|words?)\b/gi, ' ');
  t = t.replace(/\b(worldwide|globally)\b/gi, ' ');
  t = t.replace(/\b(last|past)\s+\d+\s*(years?|months?|weeks?|days?)\b/gi, ' ');
  t = t.replace(/\b\d{4}\s*[-–]\s*\d{4}\b/g, ' ');
  t = t.replace(/\bin\s+(pakistan|india|usa|america|united states|uk|britain|england)\b/gi, ' ');
  t = t.replace(/\b(a|an|the)\s+detailed\s+report\b/gi, ' ');
  t = t.replace(/\breport\s+on\b/gi, ' ');
  t = t.replace(/\b(summary|summarise|summarize)\s+(about|on|par)\b/gi, ' ');
  t = t.replace(/\b(?:authentic|reliable)\s+(?:research\s+)?papers?\s+(?:about|on|par)\b/gi, ' ');
  t = t.replace(/\bresearch\s+papers?\s+(?:about|on|par)\b/gi, ' ');
  t = t.replace(/\bin\s+detail\b/gi, ' ');
  t = t.replace(/\busing\b/gi, ' ');
  return t;
}
function intExtractTopic(text) {
  var raw = String(text || '');
  /* A definition question's topic is its subject, not its question words. */
  var defFirst = intDefinitionTopic(raw);
  if (defFirst) return defFirst;
  var t = intStripParamClauses(raw);
  var m;
  t = t.replace(/\b(i\s+want\s+to|i\s+would\s+like\s+to|i\s+need\s+to)\s+(research|investigate|find|search|look\s+into)\s+/gi, ' ');
  t = t.replace(/^\s*(?:deep\s+)?research\s+(?:on|about|par|ke\s+baare\s+mein)\s+/i, '');
  /* Urdu-script leading triggers first (raw, not normalised). */
  t = t.replace(/^\s*(?:اس\s+پر\s+|اس\s+کے\s+بارے\s+میں\s+|اس\s+کے\s+بارے\s+میں\s+مجھے\s+)?(?:ریسرچ|تحقیق)\s*(?:کرو|کر|کریں|کر\s+کے)?\s*/g, '');
  t = t.replace(/^\s*(?:ڈھونڈ|تلاش|گوگل)\s*(?:دو|کے|کر|کرو)?\s*/g, '');
  t = t.replace(/^\s*(?:انٹرنیٹ\s+سے\s+)?(?:ڈھونڈ|تلاش)\s*(?:دو|کے|کر|کرو)?\s*/g, '');
  /* Devanagari leading triggers. */
  t = t.replace(/^\s*(?:शोध|खोज|जांच)\s*(?:करो|कर|करें)?\s*/g, '');
  /* Roman / English leading command words, stripped one token at a time. */
  var cmd = { please: 1, research: 1, investigate: 1, investigation: 1, find: 1, search: 1, explore: 1, look: 1, up: 1, google: 1, dhoond: 1, dhund: 1, khoj: 1, shodh: 1, tehqeeq: 1, tahqeeq: 1, jaanch: 1, talaash: 1, talash: 1, karo: 1, kar: 1, karke: 1, do: 1, ke: 1, out: 1, give: 1, prepare: 1, make: 1, write: 1, it: 0 };
  var words = intTrim(t).split(/\s+/).filter(Boolean);
  var i = 0;
  while (i < words.length && cmd[String(words[i]).toLowerCase().replace(/[^a-z]/g, '')]) i++;
  words = words.slice(i);
  t = words.join(' ');
  /* Leading prepositions / articles / demonstratives. */
  t = t.replace(/^(?:about|on|par|ke\s+baare\s+mein|bare\s+mein|baare\s+mein|is\s+par|us\s+par|the|a|an|in|of|for|ko|ka|ki|ke|per|me)\s+/i, '');
  t = t.replace(/^(?:about|on|par|ke\s+baare\s+mein|bare\s+mein|baare\s+mein|is\s+par|us\s+par|the|a|an|in|of|for|me)\s+/i, '');
  /* Trailing command tails. */
  t = t.replace(/\s+(?:karo|kar|do|ke\s+do|kar\s+ke\s+do)\s*$/i, '');
  var def = intDefinitionTopic(raw);
  var cleaned = intCleanTopic(t);
  if (cleaned && /^(hello|hi|hey|salam|assalamualaikum|aoa|shukriya|thanks|thank\s+you|bye|good\s+morning|good\s+afternoon|good\s+evening)$/i.test(cleaned)) return null;
  if (cleaned) return cleaned;
  return def;
}
function extractResearchParams(text) {
  var raw = intFoldDigits(String(text || ''));
  var out = { topic: null, sources: null, timeMinutes: null, wordCount: null,
    pageCount: null, depth: null, geoScope: null, period: null, format: null,
    sites: [], categories: [], quality: null };
  var m, i;
  m = raw.match(/(\d{1,4})\s*(?:authentic|reliable|genuine|credible|trustworthy|real|mustand)?\s*(?:sources?|websites?|web\s*sites?|sites?|references?|research\s*papers?|papers?)\b/i);
  if (!m) m = raw.match(/(\d{1,4})\s*(?:مستند|قابل\s*اعتماد)?\s*(?:ذرائع|ویب\s*سائٹس?|حوالہ\s*جات?)/);
  if (m) out.sources = parseInt(m[1], 10);
  m = raw.match(/(?:within|in|under)\s*(\d{1,4})\s*(?:minutes?|mins?|minute)\b/i);
  if (!m) m = raw.match(/(\d{1,4})\s*(?:minute|mint|min)\s*(?:mein|main|ke\s+andar)\b/i);
  if (!m) m = raw.match(/(\d{1,4})\s*منٹ/);
  if (m) out.timeMinutes = parseInt(m[1], 10);
  m = raw.match(/(\d{1,5})\s*(?:words?|alfaz|الفاظ)\b/i);
  if (m) out.wordCount = parseInt(m[1], 10);
  m = raw.match(/(\d{1,5})\s*(?:pages?|safhe|صفحات)\b/i);
  if (m) out.pageCount = parseInt(m[1], 10);
  if (/\b(deep|detailed|in[ -]detail|in[ -]depth|comprehensive|thorough|tafseel|vistaar se|gehrai se|تفصیل)\b/i.test(raw)) out.depth = 'deep';
  else if (/\b(simple|brief|short|mukhtasar|asaan|easy|in simple words)\b/i.test(raw)) out.depth = 'brief';
  m = raw.match(/\b(pakistan|india|usa|america|united states|uk|britain|england|world|worldwide|globally)\b/i);
  if (!m) m = raw.match(/(پاکستان|بھارت|امریکہ|دنیا بھر)/);
  if (m) out.geoScope = String(m[1]).toLowerCase();
  m = raw.match(/(?:last|past)\s*(\d{1,2})\s*(years?|months?|weeks?|days?)/i);
  if (m) out.period = 'last ' + m[1] + ' ' + String(m[2]).toLowerCase();
  else {
    m = raw.match(/(\d{4})\s*[-–]\s*(\d{4})/);
    if (m) out.period = m[1] + '-' + m[2];
    else if (/\b(latest|recent|recently|current|taza|haal hi)\b/i.test(raw)) out.period = 'latest';
  }
  if (/\b(detailed\s+report|report)\b/i.test(raw)) out.format = 'report';
  else if (/\b(comparison|compare|pros\s+and\s+cons|advantages\s+and\s+disadvantages|muqabla|mukabla)\b/i.test(raw)) out.format = 'comparison';
  else if (/\blist\b/i.test(raw)) out.format = 'list';
  else if (/\b(summary|summarise|summarize|khulasa|خلاصہ)\b/i.test(raw)) out.format = 'summary';
  var siteRe = /(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\/\S*)?)/gi;
  var seen = {};
  var sm;
  while ((sm = siteRe.exec(raw)) !== null) {
    var dom = String(sm[1]).toLowerCase().replace(/\/$/, '');
    if (!seen[dom] && dom.indexOf('.') > 0) { seen[dom] = 1; out.sites.push(dom); }
  }
  /* Aspect list: "include advantages/disadvantages/future" and friends. */
  var cats = [];
  function addCats(chunk) {
    if (!chunk) return;
    var parts = String(chunk).split(/[\/,;]+|\s+and\s+/i);
    for (var j = 0; j < parts.length; j++) {
      var w = intTrim(parts[j]).toLowerCase().replace(/[^a-z ]/g, '');
      w = intTrim(w);
      if (w && w.length > 2 && cats.indexOf(w) === -1 && cats.length < 6) cats.push(w);
    }
  }
  m = raw.match(/\b(?:include|including|cover|covering)\s+([^.,;]+)/i);
  if (m) addCats(m[1]);
  m = raw.match(/\b(advantages\s*\/\s*disadvantages(?:\s*\/\s*[a-z]+)?)/i);
  if (m) addCats(m[1]);
  out.categories = cats;
  if (/\b(authentic|reliable|credible|trustworthy|genuine|mustand|مستند|قابل\s*اعتماد)\b/i.test(raw) &&
      (/\b(sources?|websites?|sites?)\b/i.test(raw) || /\b(do\s+not\s+use|don't\s+use|avoid|no\s+spam|spam)\b/i.test(raw))) out.quality = 'authentic-only';
  else if (/\b(do\s+not\s+use|don't\s+use|avoid)\b[^.,;]{0,40}\b(spam|unreliable)\b/i.test(raw)) out.quality = 'authentic-only';
  out.topic = intExtractTopic(text);
  return out;
}

/* ---------- the "definition of research itself" guard ---------- */
/* "What is research?", "Explain deep research", "research ka matlab kya
   hai" are questions ABOUT the word research. They are definitions, and
   must never trip the research-word rule. */
function intIsDefinitionOfResearch(raw, norm) {
  if (/\bwhat\s+(is|are|was|were)\b[^.?!]{0,40}\bresearch\b/.test(norm)) return true;
  if (/\b(explain|define|describe)\b[^.?!]{0,30}\bresearch\b/.test(norm)) return true;
  if (/\bresearch\b[^.?!]{0,30}\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(norm)) return true;
  if (/\bresearch\b[^.?!]{0,30}\b(kya|kia)\s+(hai|hota|hoti)\b/.test(norm)) return true;
  if (/ریسرچ\s*(کا\s*مطلب\s*کیا|کیا\s*ہے)/.test(raw)) return true;
  if (/تحقیق\s*(کا\s*مطلب\s*کیا|کیا\s*ہے)/.test(raw)) return true;
  if (/\btell\s+me\s+about\s+research\s*[?!.]*$/.test(norm)) return true;
  return false;
}

/* ---------- RESEARCH: explicit investigation intent only ---------- */
/* Returns a reason string, or null. Meaning, not keywords alone: a research
   verb needs a concrete object, a source count, a report deliverable, or a
   verify-the-latest order. A lone research word, a pronoun-only object
   ("research it" with no topic in state), and a definition of the word
   research itself are all NOT research here. */
function intIsResearch(raw, norm, st) {
  var hasTopic = !!(st && (st.currentTopic || (st.lastClarification && st.lastClarification.topic)));
  if (!intTrim(raw)) return null;
  /* Source count is an investigation by itself ("50 authentic sources"). */
  if (/(\d{1,4})\s*(authentic|reliable|genuine|credible|trustworthy|real|mustand)?\s*(sources|websites|web\s*sites|sites|references|research\s*papers|papers)\b/.test(norm)) return 'explicit-source-count';
  if (/(\d{1,4})\s*(مستند|قابل\s*اعتماد)?\s*(ذرائع|ویب\s*سائٹس|حوالہ\s*جات)/.test(raw)) return 'explicit-source-count';
  /* Research verbs with a concrete object or an imperative. */
  if (/\bresearch\b/.test(norm)) {
    if (intTrim(norm) !== 'research' && !/\bresearch\s+(it|that|this|them)\s*$/.test(norm)) return 'explicit-research-verb';
    if (/\bresearch\s+(it|that|this|them)\b/.test(norm) && hasTopic) return 'explicit-research-verb-pronoun-with-known-topic';
  }
  if (/\b(tehqeeq|tahqeeq|shodh)\b/.test(norm)) return 'explicit-research-verb';
  if (/\binvestigat(e|ion|ing)\b/.test(norm) && !/\binvestigat(e|ion|ing)\s+(it|that|this|them)\s*$/.test(norm)) return 'explicit-research-verb';
  if (/\b(jaanch|taftish)\b/.test(norm)) return 'explicit-research-verb';
  if (/\bdhoond\s+(do|ke|kar|lo|batao|nikalo|dena|karo)\b/.test(norm)) return 'explicit-search-order';
  if (/\b(khoj|talaash|talash)\s+(karo|kar|karke|do)\b/.test(norm)) return 'explicit-search-order';
  if (/\bsearch\s+(karo|kar|karke|do)\b/.test(norm)) return 'explicit-search-order';
  if (/\bsearch\s+the\s+internet\b/.test(norm)) return 'explicit-search-order';
  if (/\bsearch\s+for\s+(?!(it|that|this|them)\b)\S/.test(norm)) return 'explicit-search-order';
  if (/\bgoogle\s+(karo|kar|karke|do)\b/.test(norm)) return 'explicit-search-order';
  if (/\bgoogle\s+(?!(it|that|this|them)\s*$)\S/.test(norm) && !/\bgoogle\s+(it|that|this|them)\s*$/.test(norm)) return 'explicit-search-order';
  if (/\b(internet|online|web|google)\b.{0,14}\bdhoond\b/.test(norm)) return 'explicit-search-order';
  if (/\binternet\s+(se|par|pe)\b.{0,18}\b(dhoond|search|research|dekho|nikal)\b/.test(norm)) return 'explicit-search-order';
  if (/\b(baare|bare)\s+mein\b.{0,34}\b(dekho|dekhna|dekhein|dikhao)\b/.test(norm)) return 'explicit-look-into-order';
  if (/\blook\s+(it|this|that)\s+up\b/.test(norm) && hasTopic) return 'explicit-search-order';
  if (/\blook\s+up\s+(?!(it|that|this|them)\b)\S/.test(norm)) return 'explicit-search-order';
  if (/\bfind\s+out\b.{0,18}\babout\b/.test(norm) && !/\babout\s+(it|that|this|them)\s*$/.test(norm)) return 'explicit-find-out';
  if (/\bfind\b.{0,30}\b(authentic|reliable)\b.{0,30}\b(sources|papers|research\s+papers)\b/.test(norm)) return 'explicit-source-count';
  /* Report / comparison deliverables and verification orders. */
  if (/\b(prepare|give|make|banayo|taiyar\s+karo)\b.{0,24}\b(detailed\s+)?report\b/.test(norm)) return 'explicit-report-deliverable';
  if (/\bdetailed\s+report\b/.test(norm) && /\b(on|about|par|ke\s+baare)\b/.test(norm)) return 'explicit-report-deliverable';
  if (/\bcompare\b.{0,40}\b(findings|results)\b.{0,30}\b(sources|reliable|different)\b/.test(norm)) return 'explicit-compare-findings';
  if (/\b(latest|recent)\b.{0,30}\b(developments?|news|updates?)\b.{0,20}\b(verify|check|confirm)\b/.test(norm)) return 'explicit-verify-latest';
  if (/\b(verify|fact[\s-]?check|cross[\s-]?check)\b.{0,30}\b(?!(it|that|this|them)\s*$)\S/.test(norm) && !/\b(verify|fact[\s-]?check)\s+(it|that|this|them)\s*$/.test(norm)) return 'explicit-verify-order';
  if (/\bdeep\s+research\b/.test(norm)) return 'explicit-research-verb';
  /* Urdu script triggers. */
  if (/ریسرچ\s*(کرو|کر|کریں|کر\s*کے)/.test(raw)) return 'explicit-research-verb';
  if (/تحقیق\s*(کرو|کر|کریں|کر\s*کے)/.test(raw)) return 'explicit-research-verb';
  if (/ڈھونڈ\s*(دو|کے|کر|بتاؤ|دے|لو)/.test(raw)) return 'explicit-search-order';
  if (/تلاش\s*(کرو|کر|کر\s*کے)/.test(raw)) return 'explicit-search-order';
  if (/گوگل\s*(کرو|کر)/.test(raw)) return 'explicit-search-order';
  if (/انٹرنیٹ\s*(سے|پر)\s*ڈھونڈ/.test(raw)) return 'explicit-search-order';
  if (/بارے\s*میں.{0,34}دیکھو/.test(raw)) return 'explicit-look-into-order';
  if (/تفصیلی\s*رپورٹ/.test(raw) && /(تیار|بنا)/.test(raw)) return 'explicit-report-deliverable';
  /* Devanagari triggers. */
  if (/शोध\s*(करो|कर|करें)/.test(raw)) return 'explicit-research-verb';
  if (/खोज\s*(करो|कर)/.test(raw)) return 'explicit-search-order';
  if (/ढूंढ\s*(दो|कर)/.test(raw)) return 'explicit-search-order';
  if (/इंटरनेट\s*से\s*ढूंढ/.test(raw)) return 'explicit-search-order';
  return null;
}

/* ---------- CONVERSATION: everyday talk / questions about the assistant ---------- */
/* Subsumes the v54 vrConversationKind coverage (nine kinds + greetings),
   in English, Roman Urdu, Urdu script and transliterated Hindi. All
   patterns are 2nd-person / self-directed, so third-party questions
   ("Lahore kahan hai", "match kab start hoga") do NOT match. */
function intConversationKind(raw, norm) {
  var words = intWordCount(norm);
  if (/\b(assalamualaikum|assalamu alaikum|aoa|salam|hello|hi|hey|good\s+(morning|afternoon|evening)|shukriya|thank\s+you|thanks|bye|allah\s+hafiz|khuda\s+hafiz|namaste|namaskar)\b/.test(norm)) return 'greeting';
  if (/السلام علیکم|شکریہ|خدا حافظ|اللہ حافظ/.test(raw)) return 'greeting';
  if (/नमस्ते|नमस्कार|धन्यवाद/.test(raw)) return 'greeting';
  if (/\bkya\s+ha+l\s+hai\b/.test(norm)) return 'howru';
  if (/\bkaise\s+ho\b/.test(norm)) return 'howru';
  if (/\baur\s+sunao\b/.test(norm)) return 'howru';
  if (/\bhow are you\b/.test(norm)) return 'howru';
  if (/\bwhats?\s+up\b/.test(norm)) return 'howru';
  if (/\bhow\s+was\s+your\s+day\b/.test(norm)) return 'howru';
  if (/\bhow\s+is\s+your\s+day\b/.test(norm)) return 'howru';
  if (/\bkya\s+kar\s+rahe\s+ho\b/.test(norm)) return 'doing';
  if (/\bkya\s+karte\s+ho\b/.test(norm)) return 'doing';
  if (/\bwhat are you doing\b/.test(norm)) return 'doing';
  if (/\bwhat\s+did\s+you\s+do\s+today\b/.test(norm)) return 'doing';
  if (/\b(kidhar|kahan)\s+ja\s+rahe\s+ho\b/.test(norm)) return 'going';
  if (/\bwhere are you going\b/.test(norm)) return 'going';
  if (/(^|\s)(tum\s+|aap\s+|tu\s+)?(kahan|kidhar)\s+ho(\s|$)/.test(norm)) return 'where';
  if (/\btu\s+kahan\s+hai\b/.test(norm)) return 'where';
  if (/\bwhere are you\s*[?!.]*$/.test(norm)) return 'where';
  if (/\bkaunsa\s+kaam\s+kar\s+rahe\s+ho\b/.test(norm)) return 'whichwork';
  if (/\bkaun\s+sa\s+kaam\s+kar\s+rahe\s+ho\b/.test(norm)) return 'whichwork';
  if (/\bkis\s+kaam\s+(par|mein)\s+ho\b/.test(norm)) return 'whichwork';
  if (/\bwhat work are you doing\b/.test(norm)) return 'whichwork';
  if (/\bkis\s+tarah\s+(ka\s+)?kar\s+rahe\s+ho\b/.test(norm)) return 'how';
  if (/\bkaise\s+kar\s+rahe\s+ho\b/.test(norm)) return 'how';
  if (/\bhow are you doing\s+(it|this|that)\b/.test(norm)) return 'how';
  if (/\bkab\s+(start|shuru)\s+kiya\s+(hai|tha)\b/.test(norm)) return 'started';
  if (/\bkab\s+se\s+(start|shuru)\s+kiya\b/.test(norm)) return 'started';
  if (/\bwhen did you start\b/.test(norm)) return 'started';
  if (/\bkitne\s+time\s+mein\s+ho\s+jayega\b/.test(norm)) return 'done';
  if (/\bkitna\s+time\s+lagega\b/.test(norm)) return 'done';
  if (/\b(ye|yeh)\s+kaam\s+kab\s+ho\s+jayega\b/.test(norm)) return 'done';
  if (/\bkab\s+tak\s+ho\s+jayega\b/.test(norm)) return 'done';
  if (/\bkitni\s+der\s+mein\s+ho\s+jayega\b/.test(norm)) return 'done';
  if (/\bhow long will\s+(it|this|that)\s+take\b/.test(norm)) return 'done';
  if (/\bwhen will\s+(it|this|that)\s+be done\b/.test(norm)) return 'done';
  if (/\b(tum|aap)\s+kaun\s+ho\b/.test(norm)) return 'who';
  if (/\bwho are you\s*[?!.]*$/.test(norm)) return 'who';
  if (/\bwhat\s+is\s+your\s+name\s*[?!.]*$/.test(norm)) return 'who';
  if (words <= 8 && /\bkya\s+ho\s+raha\s+hai\b/.test(norm)) return 'howru';
  if (/کیا حال ہے/.test(raw)) return 'howru';
  if (/کیسے ہو/.test(raw)) return 'howru';
  if (/اور سناؤ/.test(raw)) return 'howru';
  if (/کیا کر رہے ہو/.test(raw)) return 'doing';
  if (/کیا کرتے ہو/.test(raw)) return 'doing';
  if (/کدھر جا رہے ہو/.test(raw)) return 'going';
  if (/کہاں جا رہے ہو/.test(raw)) return 'going';
  if (/کہاں ہو/.test(raw)) return 'where';
  if (/کدھر ہو/.test(raw)) return 'where';
  if (/کونسا کام کر رہے ہو/.test(raw)) return 'whichwork';
  if (/کس کام پر ہو/.test(raw)) return 'whichwork';
  if (/کس طرح کا کر رہے ہو/.test(raw)) return 'how';
  if (/کیسے کر رہے ہو/.test(raw)) return 'how';
  if (/کب سٹارٹ کیا ہے/.test(raw)) return 'started';
  if (/کب شروع کیا ہے/.test(raw)) return 'started';
  if (/کتنے ٹائم میں ہو جائے گا/.test(raw)) return 'done';
  if (/کتنا ٹائم لگے گا/.test(raw)) return 'done';
  if (/یہ کام کب ہو جائے گا/.test(raw)) return 'done';
  if (/کب تک ہو جائے گا/.test(raw)) return 'done';
  if (/تم کون ہو/.test(raw)) return 'who';
  if (/آپ کون ہو/.test(raw)) return 'who';
  if (words <= 8 && /کیا ہو رہا ہے/.test(raw)) return 'howru';
  if (/क्या हाल है/.test(raw)) return 'howru';
  if (/कैसे हो/.test(raw)) return 'howru';
  if (/क्या कर रहे हो/.test(raw)) return 'doing';
  if (/कहाँ हो/.test(raw)) return 'where';
  if (/तुम कौन हो/.test(raw)) return 'who';
  if (/कब शुरू किया/.test(raw)) return 'started';
  return null;
}

/* ---------- DEFINITION: what-is / explain / why / how-it-works ---------- */
function intIsDefinition(raw, norm) {
  if (!intTrim(raw)) return null;
  /* "What is the best way to ..." is advice, not a definition. */
  if (/^\s*what\s+is\s+the\s+best\b/i.test(raw)) return null;
  if (/\bwhat\s+(is|are|was|were)\b/.test(norm)) return 'definition-what-is';
  if (/\bwhat\s+does\b.{0,30}\bmean\b/.test(norm)) return 'definition-meaning';
  if (/\bmeaning\s+of\b/.test(norm)) return 'definition-meaning';
  if (/^\s*(explain|define|describe)\b/.test(norm)) return 'definition-explain';
  if (/\b(explain|define|describe|samjhao|samjhaein|samjhaen)\b/.test(norm) && !/\b(explain|define)\s+(deep\s+)?research\b/.test(norm)) return 'definition-explain';
  if (/\b(kya|kia)\s+(hai|ha|hota|hoti|hote)\b/.test(norm)) return 'definition-kya-hai';
  if (/\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(norm)) return 'definition-meaning';
  if (/\b(kise|kis\s+ko|kisko)\s+keht(e|ay)\s+(hain|hen)\b/.test(norm)) return 'definition-kise-kehte-hain';
  if (/\bkya\s+cheez\s+(hai|ho\s+sakti\s+hai)\b/.test(norm)) return 'definition-kya-cheez';
  if (/\b(baare|bare)\s+mein\s+(batao|batayein|samjhao)\b/.test(norm) && !/\babout\s+(it|that|this|them)\s*$/.test(norm)) return 'definition-tell-about';
  if (/\btell\s+me\s+(more\s+)?about\s+(?!(it|that|this|them)\b)\S/.test(norm)) return 'definition-tell-about';
  if (/\bhow\s+does\b.{0,40}\bwork\b/.test(norm)) return 'definition-how-it-works';
  if (/\bwhy\s+(is|are|does|do|did)\b/.test(norm)) return 'definition-why';
  if (/\b(kyun|kyu)\b/.test(norm) && /\b(hai|hota|hoti|tha|thi)\b/.test(norm)) return 'definition-why';
  if (/(کیا ہے|کیا ہوتا ہے|کیا ہوتی ہے|کا مطلب کیا|کس کو کہتے ہیں|سمجھاؤ|بتاؤ)/.test(raw)) return 'definition-urdu';
  if (/(کیا چیز ہے|کیا چیز ہو سکتی ہے)/.test(raw)) return 'definition-urdu';
  if (/(کیا ہے)/.test(raw) && !/(یہ کیا ہے|یہ کیا چیز ہے)/.test(raw)) return 'definition-urdu';
  if (/(کیا ہے)/.test(raw)) return 'definition-urdu';
  if (/(क्या है|क्या होता है|समझाओ|बताओ)/.test(raw)) return 'definition-hindi';
  return null;
}

/* ---------- CLARIFY: only when genuinely necessary ---------- */
/* Returns { why, options } or null. options are up to two recent topics
   from state history, used to name both meanings when there are two.
   NOTE: a definition, a conversation phrase, a research order and any
   ordinary full sentence never reach this function — classifyIntent
   checks them first. */
function intRecentTopics(st) {
  var out = [], seen = {}, i, h, t;
  if (!st || !st.history) return out;
  for (i = st.history.length - 1; i >= 0 && out.length < 2; i--) {
    h = st.history[i];
    t = h && h.topic ? intTrim(h.topic) : '';
    if (t && !seen[t.toLowerCase()] && t.toLowerCase() !== 'it') { seen[t.toLowerCase()] = 1; out.push(t); }
  }
  return out;
}
function intWouldClarify(raw, norm, st) {
  var t = intTrim(raw);
  if (!t) return { why: 'empty-message', options: [] };
  var hasTopic = !!(st && (st.currentTopic || (st.lastClarification && st.lastClarification.topic)));
  var words = intWordCount(norm);
  /* Lone research/search word with no object and no topic. */
  if (/^(research|search|tehqeeq|shodh|khoj)$/.test(intTrim(norm))) return { why: 'research-word-no-topic', options: intRecentTopics(st) };
  /* Pronoun-only references: the thing is never named. */
  if (/\b(research|search|find|look\s+up|google|verify|check)\s+(it|that|this|them)\s*[?!.]*$/.test(norm) && !hasTopic) return { why: 'pronoun-only-no-topic', options: intRecentTopics(st) };
  if (/\btell\s+me\s+(more\s+)?about\s+(it|that|this|them)\s*[?!.]*$/.test(norm) && !hasTopic) return { why: 'pronoun-only-no-topic', options: intRecentTopics(st) };
  if (/^\s*what\s+about\s+(it|that|this|them)\s*[?!.]*$/.test(norm) && !hasTopic) return { why: 'pronoun-only-no-topic', options: intRecentTopics(st) };
  if (/^\s*tell\s+me\s+more\s*[?!.]*$/.test(norm) && !hasTopic) return { why: 'tell-more-no-topic', options: intRecentTopics(st) };
  /* Demonstrative + verb + filler only: "wo wala kaam kar do", "ye kar do",
     "do it", "fix it". A single concrete content word makes it real. */
  var demoW = { wo: 1, woh: 1, ye: 1, yeh: 1, us: 1, uss: 1, iss: 1, un: 1, wohi: 1, yehi: 1, usi: 1, isi: 1, that: 1, this: 1, it: 1, those: 1, these: 1, same: 1, wala: 1, wali: 1, wale: 1, cheez: 1, thing: 1, stuff: 1, kaam: 1, kam: 1, kuch: 1, something: 1, anything: 1, doosra: 1, dusra: 1, pehla: 1, pahla: 1, another: 1, other: 1, pichla: 1, agla: 1 };
  var verbW = { kar: 1, karo: 1, karna: 1, kardo: 1, karke: 1, kiya: 1, do: 1, does: 1, did: 1, de: 1, dena: 1, dedo: 1, bana: 1, banao: 1, banana: 1, theek: 1, thik: 1, fix: 1, handle: 1, sort: 1, bhej: 1, bhejo: 1, bhejna: 1, send: 1, laga: 1, lagao: 1, khol: 1, kholo: 1, band: 1, start: 1, stop: 1, chala: 1, chalao: 1, rakh: 1, rakho: 1, nikal: 1, nikalo: 1, le: 1, lo: 1, lena: 1, ao: 1, aao: 1, jao: 1, ja: 1, batao: 1, bata: 1, batana: 1, tell: 1, show: 1, dikhao: 1, dikha: 1, get: 1, give: 1, make: 1, ho: 1, hua: 1, jaye: 1, gaya: 1, complete: 1, finish: 1, run: 1, play: 1, delete: 1, remove: 1, erase: 1, clear: 1, bola: 1, kaha: 1 };
  var fillW = { please: 1, plz: 1, zara: 1, bhai: 1, yaar: 1, ab: 1, abhi: 1, jaldi: 1, mera: 1, meri: 1, mere: 1, mujhe: 1, mujhay: 1, aap: 1, tum: 1, ko: 1, se: 1, ka: 1, ki: 1, ke: 1, hai: 1, hain: 1, tha: 1, thi: 1, na: 1, bhi: 1, to: 1, aur: 1, and: 1, the: 1, a: 1, an: 1, my: 1, me: 1, you: 1, just: 1, now: 1, right: 1, for: 1, of: 1, on: 1, in: 1, up: 1, out: 1, is: 1, are: 1, was: 1, were: 1, kya: 1, kia: 1, kyu: 1, kyun: 1, kab: 1, kahan: 1, kidhar: 1, kaise: 1, kaisa: 1, konsa: 1, kaun: 1, who: 1, what: 1, when: 1, where: 1, why: 1, how: 1, which: 1 };
  var toks = intTrim(norm).split(/\s+/).filter(Boolean);
  if (toks.length <= 14 && toks.length > 0) {
    var hasDemo = false, content = 0, i, w;
    for (i = 0; i < toks.length; i++) {
      w = toks[i];
      if (demoW[w] || /^(وہ|یہ|اس|اسی|وہی|یہی|ان|کام|چیز|کر|کرو|دو|دینا|والا|والی|کچھ|ٹھیک|بھیج|بنا|بتاؤ|لگا|میرا|میری|مجھے|آپ|کو|سے|کا|کی|کے|ہے|ہیں|بھی|اور|اب|بس)$/.test(w)) { hasDemo = true; continue; }
      if (verbW[w] || fillW[w]) continue;
      if (w.length < 3) continue;
      content++;
    }
    if (content === 0 && (hasDemo || toks.length <= 5)) {
      /* Destructive / send / delete on an unnamed target is the sharpest
         case: never guess what to delete or send. */
      if (/\b(delete|remove|erase|clear|send|bhej|bhejo|delete\s+kar|remove\s+kar)\b/.test(norm)) return { why: 'destructive-unclear-target', options: intRecentTopics(st) };
      return { why: 'no-referent', options: intRecentTopics(st) };
    }
  }
  /* Bare topic fragment: a name with no verb and no question word. */
  var commonVerbs = { is: 1, are: 1, was: 1, were: 1, do: 1, does: 1, did: 1, can: 1, could: 1, will: 1, would: 1, should: 1, explain: 1, tell: 1, find: 1, search: 1, research: 1, give: 1, show: 1, make: 1, write: 1, help: 1, think: 1, like: 1, want: 1, need: 1, get: 1, know: 1, mean: 1, work: 1, happen: 1, go: 1, come: 1, say: 1, see: 1, hai: 1, hain: 1, karo: 1, kar: 1, kya: 1, kia: 1, ka: 1, ki: 1, ke: 1, mein: 1, batao: 1, samjhao: 1 };
  if (words >= 1 && words <= 3) {
    var hasVerb = false;
    for (var j = 0; j < toks.length; j++) { if (commonVerbs[toks[j]]) { hasVerb = true; break; } }
    if (!hasVerb && !intConversationKind(raw, norm)) return { why: 'bare-topic-fragment', options: [] };
  }
  return null;
}

/* ---------- clarification answers (replies to a pending question) ---------- */
/* Returns 'normal' | 'research' | null. Only meaningful while a
   clarification is pending; classifyIntent checks that first. A bare
   "yes" affirms the proposed action (research); a bare "no" declines it
   (normal) — the same convention as the backend clarification manager. */
function intAnswerToClarification(raw) {
  var norm = intNormRoman(raw);
  if (/\b(discuss\s+(it|this)?\s*normally|just\s+(discuss|chat|talk)|chat\s+normally|just\s+talk|no\s+research|normally|normal\s+baat|aam\s+guftagu|bas\s+bata\s*(do|dein)?|just\s+tell\s+me|bata\s+do)\b/.test(norm)) return 'normal';
  if (/^(no|nope|nahi|nahin)\s*[?!.]*$/.test(intTrim(norm))) return 'normal';
  if (/^(\s*(normal|aam)\s*)$/.test(norm)) return 'normal';
  if (/\bresearch\s+(it|this|that|online|on\s+the\s+internet)\b/.test(norm)) return 'research';
  if (/\b(research|internet|online)\b/.test(norm) && /\b(karo|kar|do|please|go\s+ahead)\b/.test(norm)) return 'research';
  if (/^(yes|yeah|yep|sure|ok|okay|go\s+ahead|do\s+it|haan|han|ji|jee|theek\s+hai)\s*[?!.]*$/.test(intTrim(norm))) return 'research';
  if (/\bsearch\s+(it|online|the\s+web|the\s+internet)\b/.test(norm)) return 'research';
  if (/\blook\s+it\s+up\b/.test(norm)) return 'research';
  if (/^(ریسرچ|تحقیق)\s*(کرو|کر)/.test(raw)) return 'research';
  if (/^(نہیں|نہی)\s*$/.test(intTrim(raw))) return 'normal';
  if (/^(ہاں|جی|ٹھیک ہے)\s*$/.test(intTrim(raw))) return 'research';
  return null;
}

/* ---------- the clarification question (ONE short question, never the mode question) ---------- */
/* Every template below is a single interrogative sentence. It never asks
   the user to choose between research and normal discussion — that
   question IS the loop this piece removes. */
function intClarifyQuestion(raw, why, lang, options) {
  var a = options && options[0] ? options[0] : null;
  var b = options && options[1] ? options[1] : null;
  if (why === 'empty-message') {
    if (lang === 'urdu') return 'آپ کیا کروانا چاہتے ہیں؟';
    if (lang === 'hindi') return 'आप क्या करवाना चाहते हैं?';
    if (lang === 'roman') return 'Aap kya karwana chahte hain?';
    return 'What would you like me to do?';
  }
  if (why === 'destructive-unclear-target') {
    if (lang === 'urdu') return 'آپ کیا حذف یا بھیجنا چاہتے ہیں؟';
    if (lang === 'hindi') return 'आप क्या हटाना या भेजना चाहते हैं?';
    if (lang === 'roman') return 'Aap kya delete ya send karna chahte hain?';
    return 'What exactly do you want me to delete or send?';
  }
  if (why === 'research-word-no-topic' || why === 'pronoun-only-no-topic' || why === 'tell-more-no-topic') {
    if (lang === 'urdu') return 'میں کس موضوع پر کام کروں؟';
    if (lang === 'hindi') return 'मैं किस विषय पर काम करूँ?';
    if (lang === 'roman') return 'Main kis topic par kaam karoon?';
    return 'Which topic should I look into?';
  }
  if (why === 'bare-topic-fragment') {
    var topic = intTrim(String(raw || '').replace(/[?!.,]+$/g, ''));
    if (lang === 'urdu') return '"' + topic + '" کے بارے میں آپ کیا جاننا چاہتے ہیں؟';
    if (lang === 'hindi') return '"' + topic + '" के बारे में आप क्या जानना चाहते हैं?';
    if (lang === 'roman') return '"' + topic + '" ke baare mein aap kya jaanna chahte hain?';
    return 'What would you like to know about "' + topic + '"?';
  }
  /* no-referent: name both meanings when two recent topics are known. */
  if (a && b) {
    if (lang === 'urdu') return 'آپ کا مطلب "' + a + '" ہے یا "' + b + '"؟';
    if (lang === 'hindi') return 'आपका मतलब "' + a + '" है या "' + b + '"?';
    if (lang === 'roman') return 'Aap ka matlab "' + a + '" hai ya "' + b + '"?';
    return 'Do you mean "' + a + '" or "' + b + '"?';
  }
  if (lang === 'urdu') return 'آپ کس کام کی بات کر رہے ہیں؟';
  if (lang === 'hindi') return 'आप किस काम की बात कर रहे हैं?';
  if (lang === 'roman') return 'Aap kis kaam ki baat kar rahe hain?';
  return 'Which task do you mean?';
}

/* ---------- topic of a message (for state / anti-loop) ---------- */
function intTopicOf(text) {
  var p = extractResearchParams(text);
  if (p.topic) return p.topic;
  var norm = intNormRoman(text);
  var m = String(text || '').match(/^\s*(?:i\s+want\s+to|i\s+would\s+like\s+to|let'?s|can\s+we)\s+(?:talk|discuss|chat)\s+(?:about|on)\s+(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  m = String(text || '').match(/^\s*(?:talk|discuss|chat)\s+(?:about|on)\s+(.+?)\s*$/i);
  if (m) return intCleanTopic(m[1]);
  var toks = intTrim(norm).split(/\s+/).filter(Boolean);
  if (toks.length >= 1 && toks.length <= 3) {
    var joined = intTrim(String(text || '').replace(/[?!.,]+$/g, ''));
    if (joined && !/^(research|search|hello|hi|hey|salam)$/i.test(joined)) return joined;
  }
  return null;
}
function intMergeParams(base, over) {
  var out = {}, k;
  var keys = ['topic', 'sources', 'timeMinutes', 'wordCount', 'pageCount', 'depth', 'geoScope', 'period', 'format', 'sites', 'categories', 'quality'];
  for (var i = 0; i < keys.length; i++) {
    k = keys[i];
    var bv = base ? base[k] : null;
    var ov = over ? over[k] : null;
    if (ov !== null && ov !== undefined && !(ov instanceof Array && ov.length === 0)) out[k] = ov;
    else if (bv !== null && bv !== undefined) out[k] = bv;
    else out[k] = (k === 'sites' || k === 'categories') ? [] : null;
  }
  return out;
}

/* ---------- PUBLIC: classifyIntent ---------- */
function classifyIntent(text, ctx) {
  var raw = String(text == null ? '' : text);
  var trimmed = intTrim(raw);
  var norm = intNormRoman(raw);
  var lang = intDetectLang(raw);
  var st = intStateFromCtx(ctx);
  var params = extractResearchParams(raw);
  var topic = params.topic || intDefinitionTopic(raw);
  var topicKey = topic ? intTopicKey(topic) : null;

  /* 0. Empty message: nothing to answer. */
  if (!trimmed) {
    return { kind: 'clarify', reason: 'empty-message', params: params,
      clarifyQuestion: intClarifyQuestion(raw, 'empty-message', lang, []) };
  }

  /* 1. A clarification is pending in this chat. */
  if (st && st.mode === 'awaiting_clarification' && st.lastClarification && !st.lastClarification.answered) {
    /* 1a. This message answers the pending question — resolve it, never
       re-ask. The answer itself is classified, not clarified. */
    var ans = intAnswerToClarification(raw);
    if (ans === 'research') {
      var rParams = intMergeParams(st.lastResearchParams, params);
      if (!rParams.topic) rParams.topic = st.lastClarification.topic || topic;
      return { kind: 'research', reason: 'clarification-answer-research', params: rParams, clarifyQuestion: null };
    }
    if (ans === 'normal') {
      var nParams = params;
      if (!nParams.topic) nParams.topic = st.lastClarification.topic || topic;
      return { kind: 'general', reason: 'clarification-answer-normal', params: nParams, clarifyQuestion: null };
    }
    /* 1b. Same question again while it is still pending: the user is
       repeating, not clarifying. Answer generally instead of re-asking. */
    if (intTrim(st.lastClarification.text || '') && intNormRoman(st.lastClarification.text) === norm) {
      return { kind: 'general', reason: 'anti-loop-clarification-already-pending', params: params, clarifyQuestion: null };
    }
    /* 1c. Anything else is a fresh message: it supersedes the pending
       question. Fall through to the normal classification below. */
  }

  /* 2. A question about the word research itself is a definition. */
  if (intIsDefinitionOfResearch(raw, norm)) {
    return { kind: 'definition', reason: 'definition-about-research-itself', params: params, clarifyQuestion: null };
  }

  /* 3. Explicit investigation order. */
  var researchReason = intIsResearch(raw, norm, st);
  if (researchReason) {
    var rTopic = params.topic || (st && st.currentTopic) || null;
    var rOut = extractResearchParams(raw);
    if (!rOut.topic) rOut.topic = rTopic;
    return { kind: 'research', reason: researchReason, params: rOut, clarifyQuestion: null };
  }

  /* 4. Everyday talk / questions about the assistant itself. */
  var convKind = intConversationKind(raw, norm);
  if (convKind) {
    return { kind: 'conversation', reason: 'conversation-' + convKind, params: params, clarifyQuestion: null };
  }

  /* 5. Definition / explanation. */
  var defReason = intIsDefinition(raw, norm);
  if (defReason) {
    return { kind: 'definition', reason: defReason, params: params, clarifyQuestion: null };
  }

  /* 6. Genuinely ambiguous — clarify, but only once per chat/question. */
  var wc = intWouldClarify(raw, norm, st);
  if (wc) {
    /* Anti-loop: already asked (same text, same topic, or a topic the
       user already settled on normal) — downgrade, never re-ask. */
    if (st) {
      var alreadyAsked = false;
      if (st.lastClarification && st.lastClarification.askedCount >= 1) {
        if (intNormRoman(st.lastClarification.text || '') === norm) alreadyAsked = true;
        if (topicKey && st.lastClarification.topic && intTopicKey(st.lastClarification.topic) === topicKey) alreadyAsked = true;
      }
      if (st.history) {
        for (var hi = 0; hi < st.history.length; hi++) {
          if (st.history[hi] && st.history[hi].kind === 'clarify' && intNormRoman(st.history[hi].text || '') === norm) { alreadyAsked = true; break; }
        }
      }
      if (alreadyAsked) {
        return { kind: 'general', reason: 'anti-loop-clarification-already-asked', params: params, clarifyQuestion: null };
      }
      if (topicKey && st.decidedTopics && st.decidedTopics[topicKey] === 'normal') {
        return { kind: 'general', reason: 'anti-loop-topic-already-decided-normal', params: params, clarifyQuestion: null };
      }
      if (topicKey && st.decidedTopics && st.decidedTopics[topicKey] === 'research') {
        var merged = intMergeParams(st.lastResearchParams, params);
        if (!merged.topic) merged.topic = topic;
        return { kind: 'research', reason: 'anti-loop-topic-already-decided-research', params: merged, clarifyQuestion: null };
      }
    }
    return { kind: 'clarify', reason: 'clarify-' + wc.why, params: params,
      clarifyQuestion: intClarifyQuestion(raw, wc.why, lang, wc.options) };
  }

  /* 7. Everything else ordinary: opinions, advice, creative work,
     problem-solving, how-to, current facts asked plainly. Default to
     answering, never to asking. A current fact (price, news, weather)
     asked plainly is 'general' here: needing a fresh fact is not the
     same as ordering an investigation, and the assembler may still
     fetch it inside a normal answer. */
  return { kind: 'general', reason: 'general-default-answer-directly', params: params, clarifyQuestion: null };
}

/* ---------- PUBLIC: state ---------- */
function createIntelState() {
  return { mode: 'normal', currentTopic: null, currentResearchTaskId: null,
    lastClarification: null, decidedTopics: {}, history: [], lastResearchParams: null };
}
function updateIntelState(state, text, decision) {
  if (!state) state = createIntelState();
  var raw = String(text == null ? '' : text);
  var kind = (typeof decision === 'string') ? decision : (decision && decision.kind) || 'general';
  var params = (decision && decision.params) ? decision.params : extractResearchParams(raw);
  var topic = intTopicOf(raw) || params.topic || null;

  /* A reply that ANSWERS a pending clarification belongs to the pending
     question's topic, not to the reply's own words ("discuss normally"
     has no topic of its own). Resolve it against that topic and do not
     treat the reply as a topic change. */
  var pendingAns = null;
  if (state.mode === 'awaiting_clarification' && state.lastClarification && !state.lastClarification.answered) {
    pendingAns = intAnswerToClarification(raw);
    if (pendingAns) topic = state.lastClarification.topic || topic;
  }

  /* Topic-change detection: a new topic resets RESEARCH context but
     keeps conversational memory (history and decidedTopics survive). */
  if (topic) {
    var newKey = intTopicKey(topic);
    var oldKey = state.currentTopic ? intTopicKey(state.currentTopic) : null;
    if (oldKey && newKey !== oldKey) {
      state.currentResearchTaskId = null;
      if (state.mode === 'researching') state.mode = 'normal';
    }
    state.currentTopic = topic;
  }

  state.history = state.history || [];
  state.history.push({ text: raw, kind: kind, topic: topic });
  if (state.history.length > 20) state.history = state.history.slice(state.history.length - 20);

  if (kind === 'research') {
    state.mode = 'researching';
    if (topic) state.decidedTopics[intTopicKey(topic)] = 'research';
    if (params && (params.sources !== null || params.timeMinutes !== null || params.topic)) {
      state.lastResearchParams = intMergeParams(state.lastResearchParams, params);
    }
    if (state.lastClarification && !state.lastClarification.answered) {
      state.lastClarification.answered = true;
      state.lastClarification.resolution = 'research';
    }
  } else if (kind === 'clarify') {
    var prev = state.lastClarification;
    var askedCount = 1;
    if (prev && intNormRoman(prev.text || '') === intNormRoman(raw)) askedCount = (prev.askedCount || 0) + 1;
    state.mode = 'awaiting_clarification';
    state.lastClarification = { text: raw, topic: topic, question: (decision && decision.clarifyQuestion) || null,
      askedCount: askedCount, answered: false, resolution: null };
  } else {
    /* conversation / definition / general: normal talk. It never inherits
       research state, and it never leaks an old research task into the
       new turn. The running backend task id (if any) lives with the
       assembler's poll state, not here. */
    var wasPending = state.mode === 'awaiting_clarification' && state.lastClarification && !state.lastClarification.answered;
    if (wasPending) {
      var ans = intAnswerToClarification(raw);
      if (ans === 'research') {
        state.lastClarification.answered = true;
        state.lastClarification.resolution = 'research';
        state.mode = 'researching';
        if (topic) state.decidedTopics[intTopicKey(topic)] = 'research';
      } else if (ans === 'normal' || (topic && state.lastClarification.topic && intTopicKey(state.lastClarification.topic) === intTopicKey(topic))) {
        state.lastClarification.answered = true;
        state.lastClarification.resolution = 'normal';
        state.mode = 'normal';
        if (topic) state.decidedTopics[intTopicKey(topic)] = 'normal';
      } else {
        /* Fresh clear message: supersedes the pending question. The
           record is kept (so the same question is never asked again)
           but marked superseded. */
        state.lastClarification.superseded = true;
        state.mode = 'normal';
      }
    } else {
      state.mode = 'normal';
    }
    state.currentResearchTaskId = null;
  }
  return state;
}
function isLoopRisk(state, text) {
  if (!state || text == null) return false;
  var raw = String(text);
  var norm = intNormRoman(raw);
  var topic = intTopicOf(raw);
  var topicKey = topic ? intTopicKey(topic) : null;
  if (state.lastClarification && !state.lastClarification.answered) {
    if (intNormRoman(state.lastClarification.text || '') === norm) return true;
    if (topicKey && state.lastClarification.topic && intTopicKey(state.lastClarification.topic) === topicKey) {
      if (intWouldClarify(raw, norm, state)) return true;
    }
  }
  if (state.lastClarification && state.lastClarification.answered) {
    if (intNormRoman(state.lastClarification.text || '') === norm) return true;
  }
  if (state.history) {
    for (var i = 0; i < state.history.length; i++) {
      if (state.history[i] && state.history[i].kind === 'clarify' && intNormRoman(state.history[i].text || '') === norm) return true;
    }
  }
  if (topicKey && state.decidedTopics && state.decidedTopics[topicKey] === 'normal') {
    var def = intIsDefinition(raw, norm);
    var conv = intConversationKind(raw, norm);
    if (def || conv) return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyIntent: classifyIntent,
    extractResearchParams: extractResearchParams,
    createIntelState: createIntelState,
    updateIntelState: updateIntelState,
    isLoopRisk: isLoopRisk };
}
