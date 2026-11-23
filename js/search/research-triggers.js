
/* ==========================================================================
 * PIECE 31 — Universal research triggers + clarifying-gate repair
 * ENAO AI live-defect fix track (artifact slug: enao-ai). Defects 1, A, B.
 *
 * DEFECT (evidence: Raja's screenshot, 22 Nov 2026 4:07 PM PKT):
 *   User typed exactly: "100 websites per dakho SEO kasy karty han"
 *   ENZO replied with a "Normal" badge and an ENGLISH clarifying question:
 *   'Just to be sure — did you ask this: "websites per dakho seo kasy
 *   karty han"? Say yes, or tell me what you meant.'
 *   That is a CLEAR research order being clarified, in the wrong language.
 *
 * ROOT CAUSE (verified against the live export enao-ai.html):
 *   1. The outer askQuestion wrapper (~line 14043) runs BEFORE
 *      classifyIntent ever sees the message. It calls garbledScore(text)
 *      (~line 13961), which counts "common words" from a list that does
 *      not contain dakho / kasy / karty / han / per / websites / seo, so
 *      the ratio is 0 and the Roman Urdu order scores as "garbled".
 *      The wrapper then fires CONFIRM_T.ask (~line 13983).
 *   2. The wrapper picks the template by detectLang(text) (~line 2389),
 *      whose Roman-word list also lacks dakho / kasy / karty / han, so
 *      it returns 'en' and the ENGLISH template is used. (Correction to
 *      the task brief: CONFIRM_T.ask is NOT English-only — it already
 *      has roman and urdu functions. The bug is detection + gating, not
 *      the template map. This piece still ships canonical templates so
 *      the assembler has one source of truth going forward.)
 *   3. classifyIntent / intIsResearch (~line 23034 / 22720) would have
 *      caught "100 websites" via the source-count rule — but it never
 *      runs, because the confirm wrapper returns first. And without the
 *      number ("websites per dakho SEO kasy karty han") even the
 *      classifiers miss it: no dakho/dekho order rule, no "kasy karty
 *      han" (kaise karte hain) fold, no "per dakho" order rule.
 *   4. Backend classifier (enao-platform/intent/classifier.py) verified
 *      22 Nov 2026 by direct run: "100 websites per dakho SEO kasy
 *      karty han" -> research ONLY via the source count; the same order
 *      without the number -> normal; "is par research karo" -> normal;
 *      "SEO kasy karty han dikhao" -> normal. The backend has its own
 *      trigger lists and does NOT delegate to a shared list, so a Python
 *      mirror (pieces/31-triggers.py) is supplied and must be wired in.
 *
 * THE RULE (locked by this piece):
 *   A research order with a clear topic is NEVER ambiguous. It goes
 *   straight to research mode: never a clarifying question, never a
 *   Normal badge, never a "did you ask this?" confirmation.
 *   The clarifying gate may ONLY fire when the request is genuinely
 *   ambiguous AND not a research order. When it does fire, the question
 *   is in the user's own language (Roman Urdu / Urdu script / English).
 *
 * WHAT "RESEARCH ORDER" MEANS HERE (meaning, not bare keywords):
 *   An explicit research verb / order phrase PLUS one of:
 *     (a) a concrete topic/object word ("SEO", "websites", "phone"),
 *     (b) a source count ("100 websites", "50 sources"),
 *     (c) a topic already known in this chat (context.currentTopic),
 *     (d) a bare imperative with no object at all ("research karo",
 *         "dhoond ke do", "nikaal ke do") — settled P1/P5 behaviour:
 *         a bare imperative is an order to act, and the research flow
 *         asks for the missing topic itself (see needsTopic).
 *   A demonstrative-only object ("is par", "ye", "us") with NO known
 *   topic names nothing to research, so it is NOT counted as a research
 *   order here: the gate MAY ask "kis topic par?" — in the user's own
 *   language. This is a deliberate tightening of the old P1/P5 split
 *   (which clarified "research it" but researched bare "dhoond do");
 *   one uniform rule now covers every verb family.
 *   NO topic names appear anywhere in this file (Bitcoin lesson).
 *
 * PUBLIC API (pure functions, no DOM, no network, no dependencies):
 *   detectLanguage(text) -> 'urdu' | 'punjabi' | 'hindi' | 'roman' | 'en'
 *   isResearchOrder(text, context?)
 *     -> { research:boolean, reason:string, topic:string|null,
 *          lang:string, needsTopic:boolean, matched:string|null,
 *          source:string|null, sources:string[], deep?:boolean }
 *   detectSource(text) -> { source:string|null, sources:string[] }
 *     First named place in the message (canonical), or null = the
 *     default: the whole internet + relevant sources. A name counts
 *     only when named AS the place to search from (se/par/pe/from/
 *     on/via/... beside it); a bare mention that is the TOPIC
 *     ("YouTube kya hai") returns null. Priority: explicit platform
 *     > google > social media > news > internet > video; two names
 *     in one class -> the first named wins.
 *     context is optional: { currentTopic } or { state:{ currentTopic } }.
 *   clarifyQuestion(text, reason, lang) -> string (user's language)
 *   shouldClarify(text, context?)
 *     -> { clarify:boolean, lang:string, reason:string,
 *          question:string|null, research:object }
 *     THE SINGLE FUNCTION THE GATE CALLS FIRST (see WIRING below).
 *   extractTopic(text) -> string|null (best-effort topic, advisory only)
 *
 * WIRING (assembler — this piece wires nothing itself, never edits the
 * artifact, never deploys):
 *   1. FRONTEND, askQuestion confirm wrapper (~line 14043): call
 *      EnzoResearchTriggers.shouldClarify(text) FIRST, before
 *      garbledScore / CONFIRM_T / isDestructive. If clarify === false,
 *      proceed — never confirm, never ask "did you ask this?".
 *      If clarify === true, show result.question (already in the
 *      user's language) instead of CONFIRM_T.ask.
 *   2. FRONTEND, Rule-48 gate wrapper (~line 15422): call
 *      shouldClarify(raw) FIRST, before vagueCheck / classifyIntent.
 *      If clarify === false, skip the gate entirely (a research order
 *      must also never receive the "Normal" badge — the badge/kind must
 *      be derived from the trigger result, not the general default).
 *      If clarify === true, use result.question via clarifyQuestion().
 *   3. BACKEND, intent/classifier.py step 6: call is_research_order()
 *      from pieces/31-triggers.py (same trigger set) before the
 *      definition step, after the definition-of-research guard, so
 *      frontend and backend agree. intent/clarification.py _detect_lang
 *      should use detect_language() from the same mirror (its Roman
 *      marker list has the same dakho/kasy gap).
 *   4. Never re-introduce a research-vs-normal choice question. The
 *      templates in clarifyQuestion() name the missing topic/referent
 *      only; they never ask the user to choose a mode.
 *
 * STYLE: plain ES5, var + function declarations, no modules, matching
 * the existing artifact style. Zero emojis.
 * ========================================================================== */
/* v61 addendum (22 Nov 2026, Raja ~4:55-4:57 PM PKT):
 * - Four-language deep-research triggers (R13-R16): EN / Urdu script /
 *   Punjabi Shahmukhi / Roman Urdu. Any of these in Raja's sentence is a
 *   DEEP research order: research starts at once, never a clarifying
 *   question. The research flow asks for the topic itself when none is
 *   named. The trigger words are never the topic: they are stripped
 *   from the extracted topic, and the topic comes from the rest of the
 *   sentence.
 * - Source/place extraction (detectSource): the sentence's place is
 *   read together with the trigger (YouTube se / Google se / internet
 *   par / social media se / ...). A name counts only as the PLACE
 *   (se/par/pe/from/on/via/... beside it); a bare mention that is the
 *   TOPIC returns null. result.source is the highest-priority named
 *   place (explicit platform > google > social > news > internet >
 *   video; first named wins inside one class), result.sources lists
 *   all named places in position order, and null means the default:
 *   the whole internet + relevant sources. Bare 'video' is the source
 *   only when no place was named at all.
 * - Bare-find exclusion (Raja's decision, 22 Nov ~4:57 PM): bare
 *   "Find the best laptops" (English find + object, no research word)
 *   is NOT research - a normal answer. Only explicit research orders
 *   research. R10 keeps "find ... karo" and "look up"; bare "find out
 *   ... about ..." is NOT research (Raja, 22 Nov 2026): it is a bare
 *   find, like "find the best X". This aligns the
 *   mirror with the artifact's intIsResearch and the backend
 *   classifier, neither of which ever treated bare find as research.
 * - Punjabi Shahmukhi is a fourth detected language ('punjabi').
 */
(function (global) {
'use strict';

/* ---------- normalisation ---------- */
function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function foldDigits(s) {
  var out = '', i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0x660 && c <= 0x669) out += String.fromCharCode(48 + c - 0x660);
    else if (c >= 0x6F0 && c <= 0x6F9) out += String.fromCharCode(48 + c - 0x6F0);
    else if (c >= 0x966 && c <= 0x96F) out += String.fromCharCode(48 + c - 0x966);
    else out += s.charAt(i);
  }
  return out;
}

/* Roman-Urdu spelling folds. Applied to a lower-cased copy used ONLY for
   trigger matching — never to the text shown to the user. The folds that
   fix this defect: dakho->dekho, kasy/kaisy->kaise, karty->karte,
   han->hain, per->par, dhoondh/dhund->dhoond, kro->karo, kr->kar. */
var ROMAN_FOLDS = [
  [/\bkia\b/g, 'kya'], [/\bha\b/g, 'hai'], [/\bhen\b/g, 'hain'],
  [/\brahay\b/g, 'rahe'], [/\brahy\b/g, 'rahe'], [/\bjaa\b/g, 'ja'],
  [/\bkidher\b/g, 'kidhar'], [/\bkonsa\b/g, 'kaunsa'],
  [/\bkesay\b/g, 'kaise'], [/\bkese\b/g, 'kaise'],
  [/\bkasy\b/g, 'kaise'], [/\bkaisy\b/g, 'kaise'],
  [/\bdhoondh\b/g, 'dhoond'], [/\bdhund\b/g, 'dhoond'],
  [/\bkarty\b/g, 'karte'], [/\bkrty\b/g, 'karte'],
  [/\bkro\b/g, 'karo'], [/\bkr\b/g, 'kar'],
  [/\bdakho\b/g, 'dekho'], [/\bdekhao\b/g, 'dikhao'],
  [/\bper\b/g, 'par'], [/\bhan\b/g, 'hain'],
  [/\bbtao\b/g, 'batao'], [/\bbtau\b/g, 'batao']
];

function normRoman(text) {
  var s = ' ' + foldDigits(String(text || '').toLowerCase())
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
  var i;
  for (i = 0; i < ROMAN_FOLDS.length; i++) s = s.replace(ROMAN_FOLDS[i][0], ' ' + ROMAN_FOLDS[i][1] + ' ');
  return s.replace(/\s+/g, ' ').replace(/^ | $/g, ' ') ;
}

function normPadded(text) { return ' ' + normRoman(text).replace(/^ +| +$/g, '') + ' '; }
function tokensOf(normed) {
  var t = trim(normed);
  return t ? t.split(/\s+/) : [];
}
function hasUrdu(text) { return /[\u0600-\u06FF]/.test(String(text || '')); }
function hasDevanagari(text) { return /[\u0900-\u097F]/.test(String(text || '')); }

/* ---------- language detection ----------
   The artifact's detectLang missed dakho/kasy/karty/han and returned 'en'
   for a Roman Urdu order. Any ONE Roman-Urdu marker word is enough: these
   words do not occur in plain English text. (Pure English content words
   such as "websites" or "SEO" never cancel a Roman marker.) */
var ROMAN_MARKER_RE = /\b(kya|kia|hai|hain|karo|kar|karke|batao|samjhao|kaam|kidhar|kahan|kab|tum|aap|mera|meri|mujhe|mujhay|ye|yeh|wo|woh|matlab|baare|bare|mein|nahi|nahin|abhi|aur|bhi|zara|theek|chahiye|dhoond\w*|dhund\w*|talaash|talash|khoj|dakho|dikha\w*|dekh\w*|nikaal\w*|nikal\w*|kasy|kaise|kaisy|karty|karte|par|pe|ko|ki|ke|ka|tha|thi|wala|wali|kahan|kidhar|kisko|kaunsa|konsa|kyun|kyu|kaisa|aj|kal|bohat|acha|achi|jaldi|bhai|yaar|shodh|tehqeeq|tahqeeq|jaanch|taftish|naye|naya|sab|acha|bata|labho|vekho|tusi|tussi|se|seekho|sikho|faida|uthao|nazarandaz)\b/i;

function detectLanguage(text) {
  var raw = String(text || '');
  if (hasUrdu(raw)) {
    if (/لبھو|ویکھو|چھڈو|چکو|وکھ|توں|تسی|تواڈا|ایس\s+دے|پاسے|(?:^|\s)(وچ|نال|دا|وی|تے)(?:\s|$|[؟۔،؛!?.])/.test(raw)) return 'punjabi';
    return 'urdu';
  }
  if (hasDevanagari(raw)) return 'hindi';
  if (ROMAN_MARKER_RE.test(raw)) return 'roman';
  return 'en';
}

/* ---------- word sets for the object verdict ----------
   DEMO: demonstratives / generic nouns — they name nothing to research.
   VERB: order verbs + auxiliaries — stripped when judging the object.
   FILLER: particles, pronouns, question words — stripped likewise.
   MODIFIER: adjectives that carry no topic ("latest", "deep").
   The Urdu-script set covers the same roles in Urdu script; the
   Devanagari set covers the same roles in Hindi script. */
var DEMO_W = { wo: 1, woh: 1, ye: 1, yeh: 1, us: 1, uss: 1, iss: 1, un: 1,
  wohi: 1, yehi: 1, usi: 1, isi: 1, unhi: 1, inhi: 1, that: 1, this: 1,
  it: 1, those: 1, these: 1, them: 1, same: 1, wala: 1, wali: 1, wale: 1,
  waala: 1, cheez: 1, thing: 1, stuff: 1, idea: 1, kaam: 1, kam: 1, kuch: 1,
  something: 1, anything: 1, doosra: 1, dusra: 1, doosri: 1, pehla: 1,
  pahla: 1, pehli: 1, another: 1, other: 1, pichla: 1, pichli: 1,
  agla: 1, agli: 1, jo: 1, is: 1, topic: 1, subject: 1, baat: 1,
  mawzu: 1, mozuh: 1, dono: 1,
  'یہ': 1, 'وہ': 1, 'اس': 1, 'اسی': 1, 'وہی': 1, 'یہی': 1, 'ایس': 1, 'ان': 1,
  'کام': 1, 'چیز': 1, 'کچھ': 1, 'والا': 1, 'والی': 1, 'دوسرا': 1,
  'پہلا': 1, 'نمبر': 1, 'موضوع': 1, 'بات': 1,
  'यह': 1, 'वह': 1, 'इस': 1, 'उस': 1, 'काम': 1, 'चीज़': 1, 'बात': 1 };
var VERB_W = { kar: 1, karo: 1, kr: 1, kro: 1, karna: 1, krna: 1, kardo: 1,
  karde: 1, karke: 1, kiya: 1, karte: 1, karta: 1, karti: 1, karen: 1,
  karain: 1, karein: 1, do: 1, does: 1, did: 1, de: 1, dena: 1, dedo: 1,
  bana: 1, banao: 1, banana: 1, theek: 1, thik: 1, fix: 1, handle: 1,
  sort: 1, bhej: 1, bhejo: 1, bhejna: 1, send: 1, laga: 1, lagao: 1,
  khol: 1, kholo: 1, band: 1, start: 1, stop: 1, chala: 1, chalao: 1,
  rakh: 1, rakho: 1, nikal: 1, nikalo: 1, nikaal: 1, nikaalo: 1, le: 1,
  lo: 1, lena: 1, ao: 1, aao: 1, jao: 1, ja: 1, batao: 1, bata: 1,
  batana: 1, tell: 1, show: 1, dikhao: 1, dikha: 1, get: 1, give: 1,
  make: 1, write: 1, ho: 1, hua: 1, jaye: 1, gaya: 1, complete: 1,
  finish: 1, run: 1, play: 1, delete: 1, remove: 1, erase: 1, clear: 1,
  bola: 1, kaha: 1, dekho: 1, dekh: 1, dekhao: 1, dakho: 1,
  dhoond: 1, dhoondh: 1, dhund: 1, talaash: 1, talash: 1, khoj: 1,
  research: 1, investigate: 1, investigates: 1, investigated: 1,
  explore: 1, browse: 1, discover: 1, analyze: 1, analyse: 1,
  investigation: 1, comparison: 1, seekho: 1, sikho: 1, labho: 1, vekho: 1,
  learn: 1, study: 1, gather: 1, faida: 1, uthao: 1, nazarandaz: 1,
  collect: 1, collects: 1, collected: 1, collecting: 1,
  assemble: 1, assembles: 1, assembled: 1, assembling: 1,
  compile: 1, compiles: 1, compiled: 1, compiling: 1,
  akathi: 1, ikathi: 1, akatha: 1, ikatha: 1, jama: 1, jamma: 1,
  search: 1, google: 1, find: 1, check: 1, verify: 1, compare: 1,
  tehqeeq: 1, tahqeeq: 1, shodh: 1, jaanch: 1, taftish: 1,
  chahiye: 1, milega: 1, milegi: 1, milenge: 1, milta: 1, milti: 1,
  mile: 1,
  'کر': 1, 'کرو': 1, 'دو': 1, 'دینا': 1, 'بھیج': 1, 'بھیجو': 1,
  'بنا': 1, 'بناؤ': 1, 'بتاؤ': 1, 'بتا': 1, 'لگا': 1, 'لگاؤ': 1,
  'دیکھو': 1, 'دکھاؤ': 1, 'ڈھونڈ': 1, 'تلاش': 1, 'ریسرچ': 1,
  'تحقیق': 1, 'گوگل': 1, 'چاہیے': 1, 'تیار': 1, 'کرو': 1, 'کر': 1,
  'کے': 1, 'کرکے': 1, 'سرچ': 1, 'سیکھو': 1, 'جانچ': 1, 'دریافت': 1,
  'موازنہ': 1, 'فائدہ': 1, 'اٹھاؤ': 1, 'لبھو': 1, 'ویکھو': 1,
  'اکٹھی': 1, 'اکٹھا': 1, 'اکٹھے': 1, 'جمع': 1,
  'سکھو': 1, 'چکو': 1, 'چھڈو': 1,
  'करो': 1, 'कर': 1, 'दो': 1, 'ढूंढ': 1, 'खोज': 1, 'शोध': 1 };
var FILLER_W = { please: 1, plz: 1, zara: 1, bhai: 1, yaar: 1, ab: 1, let: 1, lets: 1,
  abhi: 1, jaldi: 1, mera: 1, meri: 1, mere: 1, mujhe: 1, mujhay: 1,
  aap: 1, tum: 1, tu: 1, ko: 1, se: 1, ka: 1, ki: 1, ke: 1, hai: 1,
  hain: 1, tha: 1, thi: 1, na: 1, bhi: 1, to: 1, aur: 1, and: 1,
  the: 1, koi: 1, ya: 1, a: 1, an: 1, my: 1, me: 1, you: 1, just: 1, now: 1, right: 1,
  for: 1, of: 1, on: 1, in: 1, up: 1, out: 1, is: 1, are: 1, was: 1,
  were: 1, kya: 1, kia: 1, kyu: 1, kyun: 1, kab: 1, kahan: 1,
  kidhar: 1, kaise: 1, kaisa: 1, konsa: 1, kaunsa: 1, kaun: 1,
  who: 1, what: 1, when: 1, where: 1, why: 1, how: 1, which: 1,
  par: 1, per: 1, pe: 1, mein: 1, baare: 1, bare: 1, about: 1, mat: 1,
  'پر': 1, 'سے': 1, 'کو': 1, 'کا': 1, 'کی': 1, 'کے': 1, 'ہے': 1,
  'ہیں': 1, 'میں': 1, 'بارے': 1, 'مجھے': 1, 'میرا': 1, 'میری': 1,
  'آپ': 1, 'کیسے': 1, 'کرتے': 1, 'ہیں': 1, 'یہ': 1, 'وہ': 1, 'مت': 1, 'کوئی': 1, 'یا': 1, 'بھی': 1, 'نال': 1, 'وچ': 1, 'تے': 1, 'وی': 1, 'نہ': 1,
  'पर': 1, 'से': 1, 'को': 1, 'का': 1, 'की': 1, 'के': 1, 'में': 1, 'है': 1 };
var MODIFIER_W = { deep: 1, detailed: 1, latest: 1, recent: 1, newest: 1,
  taaza: 1, taza: 1, 'تفصیلی': 1, 'تازہ': 1, 'تازہ ترین': 1,
  thoroughly: 1, deeply: 1, continuously: 1, everything: 1, every: 1,
  all: 1, possible: 1, possibilities: 1, possibility: 1,
  worldwide: 1, related: 1, available: 1, different: 1, various: 1,
  entire: 1, whole: 1, complete: 1, angle: 1, angles: 1, aspect: 1,
  potential: 1, world: 1, around: 1,
  tamam: 1, har: 1, pehlu: 1, duniya: 1, bhar: 1, mojood: 1, mumkin: 1,
  'مکمل': 1, 'تمام': 1, 'ہر': 1, 'ممکن': 1,
  'دنیا': 1, 'بھر': 1, 'موجود': 1, 'متعلق': 1, 'پہلو': 1, 'پاسے': 1,
  'پوری': 1, 'حل': 1, 'علم': 1, 'دستیاب': 1, 'ذرائع': 1, 'حاصل': 1 };

/* SOURCE_W: place/platform words. A place is not a topic: these are
   stripped by objectVerdict like verbs. 'news' is deliberately NOT
   here - news is a subject as often as a place ("latest news" is a
   topic). 'web' is deliberately NOT here either - "web development"
   is a topic, and the default search already is the whole web.
   Phrases (social media, فیس بک, ...) are handled by regex in
   detectSource / extractTopic, not by this token set. */
var SOURCE_W = { youtube: 1, yt: 1, google: 1, instagram: 1, facebook: 1,
  fb: 1, tiktok: 1, twitter: 1, reddit: 1, linkedin: 1, pinterest: 1,
  snapchat: 1, telegram: 1, threads: 1, vimeo: 1, dailymotion: 1,
  wikipedia: 1, wiki: 1, internet: 1, online: 1, x: 1,
  'یوٹیوب': 1, 'گوگل': 1, 'انٹرنیٹ': 1, 'انسٹاگرام': 1, 'فیسبک': 1,
  'ٹکٹاک': 1, 'ٹویٹر': 1, 'ایکس': 1, 'ریڈٹ': 1, 'پنٹرسٹ': 1,
  'تھریڈز': 1, 'ویمیو': 1, 'وکیپیڈیا': 1 };

/* Source/place patterns, in canonical form. A 'free' pattern is a
   place by itself (bare 'online', 'duniya bhar'); a 'video' pattern
   is the fallback source, counted only when no place was named.
   Every other pattern counts only when named AS the place to search
   from — see placeMarkerNear below. detectSource returns the
   highest-priority named place (source) plus ALL named places in
   position order (sources). null means the default: the whole
   internet + relevant sources. */
var SOURCE_PATTERNS = [
  { re: /social\s+media/gi, canon: 'social-media' },
  { re: /\byoutube\b/gi, canon: 'youtube' },
  { re: /\byt\b/gi, canon: 'youtube' },
  { re: /\bgoogle\b/gi, canon: 'google' },
  { re: /\binstagram\b/gi, canon: 'instagram' },
  { re: /\bfacebook\b/gi, canon: 'facebook' },
  { re: /\bfb\b/gi, canon: 'facebook' },
  { re: /\btiktok\b/gi, canon: 'tiktok' },
  { re: /\btwitter\b/gi, canon: 'x' },
  { re: /\bx\b/gi, canon: 'x' },
  { re: /\breddit\b/gi, canon: 'reddit' },
  { re: /\blinkedin\b/gi, canon: 'linkedin' },
  { re: /\bpinterest\b/gi, canon: 'pinterest' },
  { re: /\bsnapchat\b/gi, canon: 'snapchat' },
  { re: /\btelegram\b/gi, canon: 'telegram' },
  { re: /\bthreads\b/gi, canon: 'threads' },
  { re: /\bvimeo\b/gi, canon: 'vimeo' },
  { re: /\bdailymotion\b/gi, canon: 'dailymotion' },
  { re: /\bwikipedia\b/gi, canon: 'wikipedia' },
  { re: /\bwiki\b/gi, canon: 'wikipedia' },
  { re: /\binternet\b/gi, canon: 'internet', free: true },
  { re: /\bonline\b/gi, canon: 'internet', free: true },
  { re: /\bweb\b/gi, canon: 'internet' },
  { re: /\bworldwide\b/gi, canon: 'internet', free: true },
  { re: /duniya\s+bhar/gi, canon: 'internet', free: true },
  { re: /\bnews\b/gi, canon: 'news' },
  { re: /\bvideos?\b/gi, canon: 'video', video: true },
  { re: /سوشل\s+میڈیا/g, canon: 'social-media' },
  { re: /یوٹیوب/g, canon: 'youtube' },
  { re: /گوگل/g, canon: 'google' },
  { re: /انسٹاگرام/g, canon: 'instagram' },
  { re: /فیس\s+بک|فیسبک/g, canon: 'facebook' },
  { re: /ٹک\s+ٹاک|ٹکٹاک/g, canon: 'tiktok' },
  { re: /ٹویٹر|ایکس/g, canon: 'x' },
  { re: /ریڈٹ/g, canon: 'reddit' },
  { re: /لنکڈ\s+ان/g, canon: 'linkedin' },
  { re: /پنٹرسٹ/g, canon: 'pinterest' },
  { re: /سنیپ\s+چیٹ/g, canon: 'snapchat' },
  { re: /ٹیلی\s+گرام/g, canon: 'telegram' },
  { re: /تھریڈز/g, canon: 'threads' },
  { re: /ویمیو/g, canon: 'vimeo' },
  { re: /ڈیلی\s+موشن/g, canon: 'dailymotion' },
  { re: /وکیپیڈیا/g, canon: 'wikipedia' },
  { re: /انٹرنیٹ/g, canon: 'internet', free: true },
  { re: /آن\s*لائن/g, canon: 'internet', free: true },
  { re: /دنیا\s*بھر/g, canon: 'internet', free: true },
  { re: /نیوز|خبریں|خبروں/g, canon: 'news' },
  { re: /ویڈیو/g, canon: 'video', video: true }
];

/* Place markers. A named place counts only when named AS the place to
   search from. Markers AFTER the name: se / par / pe (Roman 'per' is
   folded to 'par'), from / via / through, Urdu سے / پر / پے,
   Punjabi توں / تے / وچ (Roman Punjabi ton / toon / te). Markers
   BEFORE the name: from / on / via / through / in / at, allowing
   'the' between marker and name ("from the internet"). Two extras:
   'google' followed by karo/kar/do names Google as a verb, and a
   platform followed by video/videos names it as the source of those
   videos — but only in an order (a search/show verb in the sentence),
   never in a definition question. */
var PLACE_AFTER = { se: 1, par: 1, pe: 1, from: 1, via: 1, through: 1,
  'سے': 1, 'پر': 1, 'پے': 1, 'توں': 1, 'تے': 1, 'وچ': 1,
  ton: 1, toon: 1, te: 1 };
var PLACE_BEFORE = { from: 1, on: 1, via: 1, through: 1, in: 1, at: 1 };
var VIDEO_AFTER_W = { video: 1, videos: 1, 'ویڈیو': 1 };
var ORDER_VERB_RE = /\b(dhoond\w*|dhund\w*|talaash|talash|khoj|search|find|show|play|chalao|chala|dikhao|dikha|dekho|dekh|nikal\w*|nikaal\w*|chahiye|batao|seekho|labho|vekho|research|google)\b/i;
var ORDER_VERB_URDU_RE = /ڈھونڈ|دکھاؤ|دیکھو|تلاش|چاہیے|سیکھو|لبھو|ویکھو|چلاؤ|بتاؤ|ریسرچ|تحقیق/;

function cleanTok(tok) {
  return String(tok).toLowerCase()
    .replace(/^[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, '')
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+$/g, '');
}
function tokensAfter(text, end) {
  var parts = text.slice(end, end + 40).split(/\s+/), out = [], i, c;
  for (i = 0; i < parts.length; i++) {
    c = cleanTok(parts[i]);
    if (c) out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}
function tokensBefore(text, start) {
  var parts = text.slice(Math.max(0, start - 28), start).split(/\s+/), out = [], i, c;
  for (i = parts.length - 1; i >= 0; i--) {
    c = cleanTok(parts[i]);
    if (c) out.unshift(c);
    if (out.length >= 3) break;
  }
  return out;
}
function hasOrderVerb(text) {
  return ORDER_VERB_RE.test(text) || ORDER_VERB_URDU_RE.test(text);
}
function placeMarkerNear(text, start, end, canon) {
  var after = tokensAfter(text, end), before = tokensBefore(text, start), i;
  for (i = 0; i < after.length; i++) if (PLACE_AFTER[after[i]]) return true;
  for (i = 0; i < before.length; i++) {
    if (before[i] !== 'the' && PLACE_BEFORE[before[i]]) return true;
  }
  if (canon === 'google' && after.length &&
      (after[0] === 'karo' || after[0] === 'kar' || after[0] === 'do' || after[0] === 'karke')) return true;
  return false;
}

/* Priority: an explicitly named platform beats google, google beats
   generic social media, social beats news, news beats the internet,
   and bare video is last. Two names in one class -> first named wins. */
var PLATFORM_CANON = { youtube: 1, instagram: 1, facebook: 1, tiktok: 1,
  x: 1, reddit: 1, linkedin: 1, pinterest: 1, snapchat: 1, telegram: 1,
  threads: 1, vimeo: 1, dailymotion: 1, wikipedia: 1 };
function sourceRank(canon) {
  if (PLATFORM_CANON[canon]) return 0;
  if (canon === 'google') return 1;
  if (canon === 'social-media') return 2;
  if (canon === 'news') return 3;
  if (canon === 'internet') return 4;
  return 5;
}

function detectSource(text) {
  var raw = String(text || '');
  /* Roman 'per' is the same marker as 'par'; folding it here keeps
     every index intact (same length), so match positions still refer
     to the original text. */
  var folded = raw.replace(/\bper\b/gi, 'par');
  var found = [], i, m, re, pat;
  for (i = 0; i < SOURCE_PATTERNS.length; i++) {
    pat = SOURCE_PATTERNS[i];
    re = pat.re;
    re.lastIndex = 0;
    while ((m = re.exec(folded)) !== null) {
      found.push({ index: m.index, end: m.index + m[0].length,
        canon: pat.canon, free: !!pat.free, video: !!pat.video });
      if (m[0].length === 0) break;
    }
  }
  found.sort(function (a, b) { return a.index - b.index; });
  var orderVerb = hasOrderVerb(folded);
  var kept = [], f, after;
  for (i = 0; i < found.length; i++) {
    f = found[i];
    if (f.free) { kept.push(f); continue; }
    if (f.video) continue;
    if (placeMarkerNear(folded, f.index, f.end, f.canon)) { kept.push(f); continue; }
    if (PLATFORM_CANON[f.canon] || f.canon === 'google') {
      after = tokensAfter(folded, f.end);
      if (after.length && VIDEO_AFTER_W[after[0]] && orderVerb) kept.push(f);
    }
  }
  /* Bare video is the source only when no place was named at all. */
  if (!kept.length) {
    for (i = 0; i < found.length; i++) {
      f = found[i];
      if (!f.video) continue;
      if (placeMarkerNear(folded, f.index, f.end, f.canon) || orderVerb) { kept.push(f); break; }
    }
  }
  var sources = [], seen = {}, best = null, bestRank = 99;
  for (i = 0; i < kept.length; i++) {
    if (!seen[kept[i].canon]) { seen[kept[i].canon] = true; sources.push(kept[i].canon); }
    if (sourceRank(kept[i].canon) < bestRank) { bestRank = sourceRank(kept[i].canon); best = kept[i].canon; }
  }
  return { source: best, sources: sources };
}

/* Information nouns: the "chahiye" (want) family is a research order
   only when the wanted thing is information (websites, sources, videos,
   a report). "mujhe paani chahiye" (I want water) is not research. */
var INFO_NOUN_RE = /\b(websites?|web\s*sites?|sites?|sources?|references?|papers?|videos?|report|articles?|links?|info|information|knowledge|data|list|names?|numbers?|prices?|news|details?|detail|tafseel|maloomat)\b/;
var INFO_NOUN_URDU_RE = /ویب\s*سائٹس?|ذرائع|ویڈیو|رپورٹ|مضمون|لنک|معلومات|فہرست|علم/;

/* ---------- object verdict ----------
   After stripping demo / verb / filler / modifier words, what is left?
   'content' — a real topic/object (or a known chat topic standing in
     for a demonstrative); 'demo' — only a demonstrative, no known topic;
     'bare' — a bare imperative with no object at all. */
function contextTopic(context) {
  if (!context) return null;
  if (typeof context.currentTopic === 'string' && trim(context.currentTopic)) return trim(context.currentTopic);
  if (context.state && typeof context.state.currentTopic === 'string' && trim(context.state.currentTopic)) return trim(context.state.currentTopic);
  if (context.intelState && typeof context.intelState.currentTopic === 'string' && trim(context.intelState.currentTopic)) return trim(context.intelState.currentTopic);
  return null;
}

function objectVerdict(normed, ctxTopic) {
  var toks = tokensOf(normed), i, w, content = [], hasDemo = false;
  for (i = 0; i < toks.length; i++) {
    w = toks[i];
    if (DEMO_W[w]) { hasDemo = true; continue; }
    if (VERB_W[w] || FILLER_W[w] || MODIFIER_W[w] || SOURCE_W[w]) continue;
    if (w.length < 2 && !/^\d+$/.test(w)) continue;
    content.push(w);
  }
  if (content.length) return { kind: 'content', content: content };
  if (hasDemo) {
    if (ctxTopic) return { kind: 'content', content: [ctxTopic], viaContext: true };
    return { kind: 'demo', content: [] };
  }
  return { kind: 'bare', content: [] };
}

/* A verb-family order resolves through the object verdict:
   content -> research (topic = the content, refined by extractTopic);
   demo    -> NOT research (reason: pronoun-no-topic; gate may clarify);
   bare    -> research with needsTopic = true (bare imperative order). */
function orderVerdict(normed, ctxTopic, reason, matched) {
  var v = objectVerdict(normed, ctxTopic);
  if (v.kind === 'content') {
    return { research: true, reason: reason, topic: null, needsTopic: false, matched: matched, _content: v.content };
  }
  if (v.kind === 'demo') {
    return { research: false, reason: 'research-verb-pronoun-no-topic', topic: null, needsTopic: false, matched: matched, _content: [] };
  }
  return { research: true, reason: reason, topic: null, needsTopic: true, matched: matched, _content: [] };
}

/* A deep-research order (R13-R16) resolves WITHOUT the demo rule:
   even a pronoun-only or bare object is research - the research flow
   asks for the missing topic itself. That is the 22 Nov 2026 rule for
   these explicit phrases ("Search for it", "research it thoroughly"):
   they never clarify, never go normal. */
function deepOrderVerdict(normed, ctxTopic, reason, matched) {
  var v = objectVerdict(normed, ctxTopic);
  if (v.kind === 'content') {
    return { research: true, reason: reason, topic: null, needsTopic: false, matched: matched, _content: v.content, _deep: true };
  }
  return { research: true, reason: reason, topic: null, needsTopic: true, matched: matched, _content: [], _deep: true };
}

/* ---------- topic extraction (best effort, advisory only) ---------- */
function extractTopic(text) {
  var t = ' ' + foldDigits(String(text || '')) + ' ';
  /* Topic-less negative orders name no topic: strip the phrase so
     the topic comes back null and the research flow asks for it. */
  t = t.replace(/\bdon'?t\s+leave\s+any\s+(possibility|possibilities)\s+unexplored\b/gi, ' ');
  t = t.replace(/\bleave\s+no\s+stone\s+unturned\b/gi, ' ');
  t = t.replace(/\b(within|in|under)\s+\d{1,4}\s*(minutes?|mins?|minute)\b/gi, ' ');
  t = t.replace(/\b\d{1,4}\s*(minute|mint|min)\s*(mein|main|ke\s+andar)\b/gi, ' ');
  t = t.replace(/\b(please|braah|baraah)\b/gi, ' ');
  t = t.replace(/\b(deep\s+)?research\s+(on|about|par|ke\s+baare\s+mein)\s+/gi, ' ');
  t = t.replace(/^\s*(is\s+par|us\s+par|is\s+ke\s+baare\s+mein|اس\s+پر|اس\s+کے\s+بارے\s+میں)\s*(research|ریسرچ|تحقیق)\s*(karo|kar|karke|kar\s+ke\s+do|کرو|کر|کریں|کر\s*کے)?\s*/gi, ' ');
  t = t.replace(/^\s*find\s+out\s+(about\s+)?/gi, ' ');
  t = t.replace(/^\s*(research|investigate|investigation|find|search|explore|look\s+up|google|dhoond\w*|dhund\w*|khoj|shodh|tehqeeq|tahqeeq|jaanch|taftish|talaash|talash|ریسرچ|تحقیق|ڈھونڈ\S*|تلاش|گوگل|शोध|खोज|ढूंढ)\s*(karo|kar|karke|do|ke\s+do|kar\s+ke\s+do|کرو|کر|کریں|کر\s*کے|دو|کے|بتاؤ|دے|لو|करो|कर|करें|दो)?\s*/gi, ' ');
  t = t.replace(/\b(per|par|pe)\s+(dakho|dikhao|dekho|dekh|دیکھو|دکھاؤ)\b/gi, ' ');
  t = t.replace(/\b(kasy|kaise|kaisy|kesay|kese)\s+(karty|karte)\s+(han|hain)\b/gi, ' ');
  t = t.replace(/\b(kaise|kaisy)\s+(karte|karti)\s+(hain|hai)\b/gi, ' ');
  t = t.replace(/\s+(karo|kar|do|ke\s+do|kar\s+ke\s+do|karke|کرو|کر|دو|کر\s*کے)\s*$/gi, ' ');
  t = t.replace(/\s+(batao|batayein|dikhao|dekho|دیکھو|دکھاؤ|بتاؤ)\s*$/gi, ' ');
  /* v61 strip pass: trigger words, quantifiers and source words are
     never the topic. Bare 'search' / 'find' are NOT stripped here:
     they are nouns as often as verbs ("search engines", "find the
     best...") and the object verdict rejects a leftover verb. Source
     words ARE stripped: the source is captured separately by
     detectSource, so the topic keeps only the subject. */
  t = t.replace(/\b(dhoond\w*|dhund\w*|talaash|talash|khoj|research|researching|investigat\w*|explore\w*|brows\w*|discover\w*|analy[sz]\w*|learn\w*|study\w*|gather\w*|collect\w*|assembl\w*|compil\w*|akathi|ikathi|akatha|ikatha|jama|jamma|bary|baare|bare|seekho|sikho|labho|vekho|check|compare|verify|dikhao|dikha|dekho|dekh|nikaal\w*|nikal\w*|tehqeeq|tahqeeq|shodh|jaanch|taftish|chahiye|karo|kar|karke|do|k|ke|de|dena|batao|investigation|comparison|websites?|sources?|resources?|find|thoroughly|deeply|continuously|everything|every|all|possible|possibilities|possibility|options?|solutions?|information|knowledge|worldwide|related|available|different|various|entire|whole|complete|faida|uthao|nazarandaz|mat|angles?|aspect|about|for|on|maloomat|social\s+media|around|search\s+(karo|kar|karke|do|ke\s+do)|google\s+(karo|kar|karke|do)|find\s+(karo|kar|karke|do|ke\s+do)|youtube|yt|google|instagram|facebook|fb|tiktok|twitter|reddit|linkedin|pinterest|snapchat|telegram|threads|vimeo|dailymotion|wikipedia|wiki|internet|online|x)\b/gi, ' ');
  t = t.replace(/(سرچ|سیکھو|جانچ|دریافت|موازنہ|فائدہ|اٹھاؤ|نظر|انداز|لبھو|ویکھو|سکھو|چکو|چھڈو|مکمل|تمام|ہر|ممکن\S*|معلومات|جانکاری|اکٹھ\w*|جمع|دنیا|بھر|موجود|متعلق|پہلو|پاسے|مختلف|وکھ|سارے|امکانات|امکان|ویب\s*سائٹس?|ڈھونڈ\S*|تلاش|تحقیق|ریسرچ|چاہیے|دیکھو|دکھاؤ|کرو|کر|دو|دے|دینا|بتاؤ|یوٹیوب|گوگل|انٹرنیٹ|انسٹاگرام|فیسبک|فیس\s+بک|ٹک\s+ٹاک|ٹکٹاک|ٹویٹر|ایکس|ریڈٹ|لنکڈ\s+ان|پنٹرسٹ|سنیپ\s+چیٹ|ٹیلی\s+گرام|تھریڈز|ویمیو|ڈیلی\s+موشن|وکیپیڈیا|سوشل\s+میڈیا|آن\s+لائن)/g, ' ');
  t = t.replace(/^\s*(?:(the|a|an|for|from|in|about|on|par|per|pe|se)\s+)+/gi, ' ');
  t = t.replace(/^\s*(?:(سے|پر|پے|کا|کی|کے|کو|میں|بارے|توں|تے|وچ|دے|نال|دی|دا)\s+)+/g, ' ');
  t = t.replace(/(\s+(se|sy|par|pe|per|ka|ki|ke|ko|mein|main|ma|about|on|from|for|of))+\s*$/gi, ' ');
  t = t.replace(/(\s+(سے|پر|پے|کا|کی|کے|کو|میں|بارے|توں|تے|وچ|دے|نال|دی|دا))+\s*$/g, ' ');
  t = trim(t.replace(/[?!.,;:'"()\[\]{}]+/g, ' ').replace(/\s+/g, ' '));
  if (!t) return null;
  if (/^(it|that|this|these|those|them|ye|yeh|wo|woh|us|is|isi|usi)$/i.test(t)) return null;
  var v = objectVerdict(normRoman(t), null);
  if (v.kind !== 'content') return null;
  return t.slice(0, 100);
}

/* ---------- guards ---------- */
function isDefinitionOfResearch(text, normed) {
  var n = normed;
  if (/\bwhat\s+(is|are|was|were)\b[^.?!]{0,40}\bresearch\b/.test(n)) return true;
  if (/\b(explain|define|describe)\b[^.?!]{0,30}\bresearch\b/.test(n)) return true;
  if (/\bresearch\b[^.?!]{0,30}\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(n)) return true;
  if (/\bresearch\b[^.?!]{0,30}\b(kya|kia)\s+(hai|hota|hoti)\b/.test(n)) return true;
  if (/\btell\s+me\s+about\s+research\s*[?!.]*$/.test(n)) return true;
  if (/ریسرچ\s*(کا\s*مطلب\s*کیا|کیا\s*ہے)/.test(text)) return true;
  if (/تحقیق\s*(کا\s*مطلب\s*کیا|کیا\s*ہے)/.test(text)) return true;
  return false;
}

/* Independent order verbs that rescue a message from the
   definition-of-research guard (e.g. "research ka matlab kya hai,
   dhoond ke do" still orders a search). */
function hasIndependentOrder(normed, raw) {
  if (/\b(dhoond\w*|dhund\w*|talaash|talash|khoj|search|google|nikal\w*|nikaal\w*|compare|verify|check|explore\w*|brows\w*|discover\w*|analy[sz]\w*|learn\w*|study|gather|seekho|sikho|labho|vekho)\b/.test(normed)) return true;
  if (/سرچ|سیکھو|جانچ|دریافت|موازنہ|لبھو|ویکھو|سکھو/.test(raw)) return true;
  if (/\b(dekho|dekh|dikhao|dikha|dekhna|dekhein)\b/.test(normed)) return true;
  if (/\d{1,4}\s*(sources?|websites?|sites?|references?|papers?)\b/.test(normed)) return true;
  if (/ڈھونڈ|تلاش|گوگل|دیکھو|دکھاؤ|ریسرچ\s*(کرو|کر)/.test(raw)) return true;
  if (/\b(detailed\s+)?report\b/.test(normed)) return true;
  if (/تفصیلی\s*رپورٹ/.test(raw)) return true;
  return false;
}

/* ---------- conversation (guftagu) ----------
   Greetings and everyday talk about the assistant itself, in English,
   Roman Urdu, Urdu script and Hindi. These NEVER research and NEVER
   clarify. All patterns are 2nd-person / self-directed, so third-party
   questions ("Lahore kahan hai", "match kab start hoga") stay out. */
var CONVERSATION_RES = [
  [/\b(assalamualaikum|assalamu alaikum|aoa|salam|hello|hi|hey|namaste|namaskar)\b/, 'greeting'],
  [/\bgood\s+(morning|afternoon|evening)\b/, 'greeting'],
  [/\b(thank you|thanks|shukriya)\b/, 'greeting'],
  [/\b(bye|allah hafiz|khuda hafiz)\b/, 'greeting'],
  [/\bkya\s+ha+l\s+hai\b/, 'howru'],
  [/\bkaise\s+ho\b/, 'howru'],
  [/\baur\s+sunao\b/, 'howru'],
  [/\bhow are you\b/, 'howru'],
  [/\bwhats?\s+up\b/, 'howru'],
  [/\bhow\s+(was|is)\s+your\s+day\b/, 'howru'],
  [/\bkya\s+kar\s+rahe\s+ho\b/, 'doing'],
  [/\bkya\s+karte\s+ho\b/, 'doing'],
  [/\bwhat are you doing\b/, 'doing'],
  [/\bwhat\s+did\s+you\s+do\s+today\b/, 'doing'],
  [/\b(kidhar|kahan)\s+ja\s+rahe\s+ho\b/, 'going'],
  [/\bwhere are you going\b/, 'going'],
  [/(^|\s)(tum\s+|aap\s+|tu\s+)?(kahan|kidhar)\s+ho(\s|$)/, 'where'],
  [/\btu\s+kahan\s+hai\b/, 'where'],
  [/\bwhere are you\s*[?!.]*$/, 'where'],
  [/\bkaunsa\s+kaam\s+kar\s+rahe\s+ho\b/, 'whichwork'],
  [/\bkaun\s+sa\s+kaam\s+kar\s+rahe\s+ho\b/, 'whichwork'],
  [/\bkis\s+kaam\s+(par|mein)\s+ho\b/, 'whichwork'],
  [/\bwhat work are you doing\b/, 'whichwork'],
  [/\bkis\s+tarah\s+(ka\s+)?kar\s+rahe\s+ho\b/, 'how'],
  [/\bkaise\s+kar\s+rahe\s+ho\b/, 'how'],
  [/\bhow are you doing\s+(it|this|that)\b/, 'how'],
  [/\bkab\s+(start|shuru)\s+kiya\s+(hai|tha)\b/, 'started'],
  [/\bkab\s+se\s+(start|shuru)\s+kiya\b/, 'started'],
  [/\bwhen did you start\b/, 'started'],
  [/\bkitne\s+time\s+mein\s+ho\s+jayega\b/, 'done'],
  [/\bkitna\s+time\s+lagega\b/, 'done'],
  [/\b(ye|yeh)\s+kaam\s+kab\s+ho\s+jayega\b/, 'done'],
  [/\bkab\s+tak\s+ho\s+jayega\b/, 'done'],
  [/\bkitni\s+der\s+mein\s+ho\s+jayega\b/, 'done'],
  [/\bhow long will\s+(it|this|that)\s+take\b/, 'done'],
  [/\bwhen will\s+(it|this|that)\s+be done\b/, 'done'],
  [/\b(tum|aap)\s+kaun\s+ho\b/, 'who'],
  [/\bwho are you\s*[?!.]*$/, 'who'],
  [/\bwhat is your name\s*[?!.]*$/, 'who'],
  [/\bkya\s+ho\s+raha\s+hai\b/, 'howru']
];
var CONVERSATION_SCRIPT_RES = [
  [/السلام علیکم|شکریہ|خدا حافظ|اللہ حافظ/, 'greeting'],
  [/کیا حال ہے/, 'howru'], [/کیسے ہو/, 'howru'], [/اور سناؤ/, 'howru'],
  [/کیا کر رہے ہو/, 'doing'], [/کیا کرتے ہو/, 'doing'],
  [/کدھر جا رہے ہو/, 'going'], [/کہاں جا رہے ہو/, 'going'],
  [/کہاں ہو/, 'where'], [/کدھر ہو/, 'where'],
  [/کونسا کام کر رہے ہو/, 'whichwork'], [/کس کام پر ہو/, 'whichwork'],
  [/کس طرح کا کر رہے ہو/, 'how'], [/کیسے کر رہے ہو/, 'how'],
  [/کب سٹارٹ کیا ہے/, 'started'], [/کب شروع کیا ہے/, 'started'],
  [/کتنے ٹائم میں ہو جائے گا/, 'done'], [/کتنا ٹائم لگے گا/, 'done'],
  [/یہ کام کب ہو جائے گا/, 'done'], [/کب تک ہو جائے گا/, 'done'],
  [/تم کون ہو/, 'who'], [/آپ کون ہو/, 'who'], [/کیا ہو رہا ہے/, 'howru'],
  [/क्या हाल है/, 'howru'], [/कैसे हो/, 'howru'],
  [/क्या कर रहे हो/, 'doing'], [/कहाँ हो/, 'where'],
  [/तुम कौन हो/, 'who'], [/कब शुरू किया/, 'started'],
  [/नमस्ते|नमस्कार|धन्यवाद/, 'greeting']
];

function conversationKind(text, normed) {
  var i;
  for (i = 0; i < CONVERSATION_RES.length; i++) {
    if (CONVERSATION_RES[i][0].test(normed)) return CONVERSATION_RES[i][1];
  }
  for (i = 0; i < CONVERSATION_SCRIPT_RES.length; i++) {
    if (CONVERSATION_SCRIPT_RES[i][0].test(text)) return CONVERSATION_SCRIPT_RES[i][1];
  }
  return null;
}

/* ---------- definition / explanation ----------
   "what is / kya hai / explain / samjhao / tell me more about X /
   how does X work / why ..." — including "ye kya hai" and its Urdu
   script and Hindi equivalents. Direct answer, never clarify, never
   research — unless an explicit research order verb is also present
   (isResearchOrder runs first; this guard only matters when it is not). */
function isDefinition(text, normed) {
  var n = normed;
  if (/^\s*what\s+is\s+the\s+best\b/.test(n)) return false;
  if (/\bwhat\s+(is|are|was|were)\b/.test(n)) return true;
  if (/\bwhat\s+does\b.{0,30}\bmean\b/.test(n)) return true;
  if (/\bmeaning\s+of\b/.test(n)) return true;
  if (/^\s*(explain|define|describe)\b/.test(n)) return true;
  if (/\b(explain|define|describe|samjhao|samjhaein|samjhaen)\b/.test(n)) return true;
  if (/\b(kya|kia)\s+(hai|ha|hota|hoti|hote)\b/.test(n)) return true;
  if (/\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(n)) return true;
  if (/\b(kise|kis\s+ko|kisko)\s+keht(e|ay)\s+(hain|hen)\b/.test(n)) return true;
  if (/\bkya\s+cheez\s+(hai|ho\s+sakti\s+hai)\b/.test(n)) return true;
  if (/\b(baare|bare)\s+mein\s+(batao|batayein|samjhao)\b/.test(n)) return true;
  if (/\btell\s+me\s+(more\s+)?about\s+(?!(it|that|this|them)\b)\S/.test(n)) return true;
  if (/\bhow\s+does\b.{0,40}\bwork\b/.test(n)) return true;
  if (/\bwhy\s+(is|are|does|do|did)\b/.test(n)) return true;
  if (/\b(kyun|kyu)\b/.test(n) && /\b(hai|hota|hoti|tha|thi)\b/.test(n)) return true;
  if (/(کیا ہے|کیا ہوتا ہے|کیا ہوتی ہے|کا مطلب کیا|کس کو کہتے ہیں|سمجھاؤ|بتاؤ)/.test(text)) return true;
  if (/(کیا چیز ہے|کیا چیز ہو سکتی ہے)/.test(text)) return true;
  if (/(क्या है|क्या होता है|समझाओ|बताओ)/.test(text)) return true;
  return false;
}

/* ---------- the research-order check (the canonical trigger set) ---------- */
function isResearchOrder(text, context) {
  var raw = String(text == null ? '' : text);
  var lang = detectLanguage(raw);
  var normed = normPadded(raw);
  var n = normed;
  var folded = foldDigits(raw);
  var ctxTopic = contextTopic(context);
  var src = detectSource(raw);
  var none = { research: false, reason: 'no-research-signal', topic: null, lang: lang, needsTopic: false, matched: null, source: src.source, sources: src.sources };
  if (!trim(raw)) return none;

  /* Guard: a question ABOUT the word research is a definition, unless
     an independent order verb is also present. */
  if (isDefinitionOfResearch(raw, n) && !hasIndependentOrder(n, raw)) {
    return { research: false, reason: 'definition-of-research', topic: null, lang: lang, needsTopic: false, matched: null, source: src.source, sources: src.sources };
  }

  var v;
  /* Lone research/search word with no object and no topic ("research",
     "dhoond") names nothing to investigate: NOT research. The gate may
     ask which topic. This guard must run before the verb families, or
     the bare-imperative rule below would claim the lone word. */
  if (/^(research|search|tehqeeq|tahqeeq|shodh|khoj|dhoond|dhund|talaash|talash|google|find|check|verify|compare|explore|browse|discover|analy[sz]e|learn|study|gather|collect|assemble|compile|akathi|ikathi|jama|seekho|sikho|labho|vekho)\.?$/.test(trim(n)) ||
      /^(ریسرچ|تحقیق|ڈھونڈ|تلاش|گوگل|سرچ|سیکھو|جانچ|دریافت|موازنہ|لبھو|ویکھو|سکھو|اکٹھی|جمع|शोध|खोज|ढूंढ)$/.test(trim(raw))) {
    return { research: false, reason: 'research-word-no-topic', topic: null, lang: lang, needsTopic: false, matched: null, source: src.source, sources: src.sources };
  }
  /* R1. Source count on its own ("100 websites", "50 authentic
     sources", "۱۰۰ ویب سائٹس"). The screenshot order fires here. */
  if (/\d{1,4}\s+(authentic|reliable|genuine|credible|trustworthy|real|mustand)?\s*(sources?|websites?|web\s*sites?|sites?|references?|research\s*papers?|papers?)\b/.test(n)) {
    return finish(true, 'explicit-source-count', raw, lang, ctxTopic, 'source-count');
  }
  if (/(\d{1,4})\s*(مستند|قابل\s*اعتماد)?\s*(ذرائع|ویب\s*سائٹس?|حوالہ\s*جات?)/.test(folded)) {
    return finish(true, 'explicit-source-count', raw, lang, ctxTopic, 'source-count-urdu');
  }
  if (/\d{1,4}\s*(zaraye|hawale|websites?|sources?)\b/.test(n)) {
    return finish(true, 'explicit-source-count', raw, lang, ctxTopic, 'source-count-roman');
  }

  /* Definition guard (coordinator fix, 22 Nov 2026): a definition /
     explanation question is NOT a research order even when it contains
     a trigger word ("How does search work?", "Tell me about search
     engines"). Runs AFTER the explicit source-count rule (an explicit
     count is an order that wins) and BEFORE the verb families — this
     matches the backend classifier, where step 6b (source count) still
     runs after the mirror guard. */
  if (isDefinition(raw, n)) {
    return { research: false, reason: 'definition-question', topic: null, lang: lang, needsTopic: false, matched: null, source: src.source, sources: src.sources };
  }

  /* "What is the best ..." is a recommendation question, never a
     deep-research order - it asks for the best way/thing, not for
     research. The deep families below skip it; the old families
     still run. */
  var bestQ = /^\s*(what\s+is|what's|which\s+is)\s+the\s+best\b/.test(n);
  /* R13-R16. Four-language deep-research triggers (22 Nov 2026, Raja):
     any of these phrases is a DEEP research order in any language.
     They run BEFORE R2-R12 on purpose: the old families return
     NOT-research for a pronoun-only object ("research it"), but these
     explicit phrases research anyway (deepOrderVerdict) - the research
     flow asks for the missing topic itself. Never a clarifying
     question, never a normal answer. */
  /* R13. English deep triggers. */
  if (!bestQ && (/\bsearch\s+for\s+(it|that|this|them)\b/.test(n) ||
      (/\b(research|investigat\w*)\b/.test(n) && /\b(thoroughly|deeply|everything|worldwide|in\s+depth|every|all|possibilities|options|har|pehlu|angle)\b/.test(n)) ||
      /\bcompare\b.{0,24}\b(different|multiple|various|all)\b.{0,16}\bsources?\b/.test(n) ||
      /\bsearch\b.{0,16}\b(deeply|thoroughly|in\s+depth)\b/.test(n) ||
      /\bexplore\b.{0,30}\b(internet|web|websites?|sources?|options|possibilities|everything|all|deeply|thoroughly|about|related|worldwide)\b/.test(n) ||
      /\b(internet|web)\b.{0,20}\bexplore\b/.test(n) ||
      /\bbrows\w*\b.{0,24}\b(websites?|web|internet|different)\b/.test(n) ||
      /\bstudy\b.{0,30}\b(online|internet|web|resources?|sources?|material)\b/.test(n) ||
      /\blearn\b.{0,24}\b(from|through|via)\b.{0,24}\b(internet|online|web)\b/.test(n) ||
      /\blearn\b.{0,20}\b(continuously|always)\b/.test(n) ||
      /\bdiscover\w*\b.{0,30}\b(information|possibilities|everything|all|options|solutions|available)\b/.test(n) ||
      /\banaly[sz]\w*\b.{0,24}\b(everything|all|data|information|options|results)\b/.test(n) ||
      /\bgather\b.{0,24}\b(knowledge|information|data|sources?)\b/.test(n) ||
      /\bfind\b.{0,24}\b(every|all)\b.{0,16}\b(possible\s+)?(solutions?|options?|possibilities|answers?)\b/.test(n) ||
      /\bdon\s*t\s+leave\s+any\b.{0,30}\b(unexplored|unresearched|unchecked)\b/.test(n) ||
      /\bleave\s+no\b.{0,24}\b(stone\s+unturned|possibility\s+unexplored)\b/.test(n))) {
    v = deepOrderVerdict(n, ctxTopic, 'explicit-deep-research', 'deep-research-en');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R14. Urdu-script deep triggers. */
  if (!bestQ && (/سرچ\s*(کرو|کر|کریں)/.test(raw) || /انٹرنیٹ\s*(پر|سے)\s*سرچ/.test(raw) ||
      /انٹرنیٹ\s*سے\s*سیکھو/.test(raw) || /آن\s*لائن\s*(ذرائع\s*سے)?\s*سیکھو/.test(raw) ||
      /معلومات\s*حاصل\s*(کرو|کر|کریں)/.test(raw) ||
      /جانچ\s*(کرو|کر|کریں)/.test(raw) || /دریافت\s*(کرو|کر|کریں)/.test(raw) ||
      /موازنہ\s*(کرو|کر|کریں)/.test(raw) ||
      (/فائدہ\s*(اٹھاؤ|اٹھائیں)/.test(raw) && /(علم|معلومات)/.test(raw)) ||
      (/نظر\s*انداز\s*مت\s*کرو/.test(raw) && /(امکان|معلومات|حل|کوئی)/.test(raw)))) {
    v = deepOrderVerdict(n, ctxTopic, 'explicit-deep-research', 'deep-research-urdu');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R15. Punjabi Shahmukhi deep triggers. A bare vekho / sikho + topic
     is a research order too (41-fix, 22 Nov 2026): the noun/source
     qualifier was dropping "vekho X" and "sikho X". A lone vekho /
     sikho is still caught by the lone-word guard above, never here. */
  if (!bestQ && (/لبھو/.test(raw) ||
      /ویکھو/.test(raw) ||
      /سکھو/.test(raw) ||
      (/فائدہ\s*چکو/.test(raw) && /(علم|معلومات)/.test(raw)) ||
      (/نہ\s*چھڈو/.test(raw) && /(امکان|معلومات|حل|کوئی)/.test(raw)))) {
    v = deepOrderVerdict(n, ctxTopic, 'explicit-deep-research', 'deep-research-punjabi');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R16. Roman Urdu deep triggers (incl. Roman Punjabi labho/vekho). */
  if (!bestQ && ((/\bexplore\b.{0,12}\b(karo|kar|ke\s+do|kar\s+ke\s+do)\b/.test(n) ||
      /\bexplore\b.{0,30}\b(internet|web|websites?|sources?|options|possibilities|everything|all|deeply|thoroughly|about|related|worldwide)\b/.test(n)) ||
      /\b(seekho|sikho)\b/.test(n) ||
      /\bcomparison\b.{0,12}\b(karo|kar|ke\s+do|kar\s+ke\s+do)\b/.test(n) ||
      (/\bfaida\b.{0,20}\buthao\b/.test(n) && /\b(knowledge|information|ilm|maloomat)\b/.test(n)) ||
      (/\bnazarandaz\s+mat\s+karo\b/.test(n) && /\b(possibility|information|solution|koi)\b/.test(n)) ||
      /\blabho\b/.test(n) ||
      /\bvekho\b/.test(n))) {
    v = deepOrderVerdict(n, ctxTopic, 'explicit-deep-research', 'deep-research-roman');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }

  /* R17. Collection orders (Job 4, 23 Nov 2026, Raja): "information
     akathi karo / collect information (from the internet)" and
     equivalents are research orders BY MEANING — a collection order
     is a research order. Four languages. The info noun is required
     for the verb+object forms: a bare "collect the parcel" (no
     information noun) is an errand, not research. The bare
     collection verbs (akathi / اکٹھی) are unambiguous, so they fire
     on their own; the ambiguous ones (jama / جمع — also "add up")
     need the info noun. Uses orderVerdict, so a pronoun-only object
     ("collect it") with no topic in context still does NOT research;
     a collection order with no topic researches with needsTopic (the
     flow asks for the topic itself). Mirror of R17 in
     intent/research_triggers.py — keep the two in sync. */
  if (!bestQ && (
      /* R17a. English: collect|assemble|compile + information|
         data|details|facts|knowledge|sources, either order.
         (gather + information is already R13 deep; R13 runs first.) */
      /\b(collect|assemble|compile)\b.{0,30}\b(information|data|details|facts|knowledge|sources?)\b/.test(n) ||
      /\b(information|data|details|facts|knowledge)\b.{0,20}\b(collect|gather|assemble|compile)\b/.test(n) ||
      /* R17b. Roman Urdu / Roman Punjabi: maloomat|information +
         akathi|ikathi|jama, either order; bare akathi|ikathi + karo. */
      /\b(maloomat|information)\b.{0,24}\b(akathi|ikathi|akatha|ikatha|jama|jamma)\b/.test(n) ||
      /\b(akathi|ikathi|akatha|ikatha|jama|jamma)\b.{0,24}\b(maloomat|information)\b/.test(n) ||
      /\b(akathi|ikathi)\b.{0,12}\b(karo|kar|karke|kar\s+ke\s+do)\b/.test(n) ||
      /* R17c. Urdu script / Punjabi Shahmukhi: معلومات|جانکاری +
         اکٹھی|جمع, either order; bare اکٹھی + کرو. */
      /(معلومات|جانکاری)\s*(اکٹھ\w*|جمع)/.test(raw) ||
      /(اکٹھ\w*|جمع)\s*(کرو|کر|کریں|کر\s*کے)?\s*(معلومات|جانکاری)/.test(raw) ||
      /اکٹھ\w*\s*(کرو|کر|کریں|کر\s*کے)/.test(raw))) {
    v = orderVerdict(n, ctxTopic, 'explicit-collect-order', 'collect-order');
    if (v.research && extractTopic(raw) === null && !ctxTopic) {
      /* The only content was the info noun itself ("information
         akathi karo" with no topic): research, but the flow must ask
         which topic — an empty _content makes finish set needsTopic. */
      v = { research: v.research, reason: v.reason, topic: v.topic,
            needsTopic: v.needsTopic, matched: v.matched, _content: [] };
    }
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }

  /* R13b. Bare explore / discover / analyze + topic (EN/Roman): the
     deep patterns above need a qualifier (internet, everything, ...);
     a plain verb + a real topic is still a research order. Placed
     AFTER R13-R16 so the deep rules keep first shot at their phrases.
     Uses orderVerdict, so a lone verb or a demonstrative-only object
     still does NOT research; "the best" after the verb stays a bare
     find-style recommendation, not research. Runs after the definition
     guard, so "explore ka matlab kya hai" stays a definition. */
  if (!bestQ && /\b(explore|discover|analy[sz]e)\b/.test(n) &&
      !/\b(explore|discover|analy[sz]e)\b[^.]{0,20}\bthe\s+best\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-explore-order', 'explore-order');
    /* Demonstrative-only object ("explore this idea", "let's explore
       this idea") is guftagu, not an order: return the neutral
       no-signal result, NOT the pronoun-no-topic reason, or the gate
       would ask "which topic?" for a casual remark. A real topic
       still researches; a bare verb still researches with needsTopic. */
    if (!v.research) return none;
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R6b. "comparison" noun: "make a comparison of X and Y" is the
     same order as "compare X and Y". (R6 below keeps the verb.) */
  if (/\bcomparison\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-verify-order', 'verify-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }

  /* R2. Research verbs: research / investigate / tehqeeq / shodh (+ karo
     / kar / kar ke do / on / about / par + topic). */
  if (/\b(research|investigat\w*|tehqeeq|tahqeeq|shodh|jaanch|taftish)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-research-verb', 'research-verb');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R3. Search orders: dhoond / dhoondh / dhoondo / talaash / khoj /
     search / google (+ do / ke do / kar / karo / lo / batao / nikalo). */
  if (/\b(dhoond\w*|dhund\w*|talaash|talash|khoj|search|google)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-search-order', 'search-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R4. Look-into / show orders: "is ke baare mein mujhe dekho",
     "websites per dakho", "SEO kasy karty han dikhao", "X dikhao". */
  if (/\b(baare|bare)\s+mein\b.{0,34}\b(dekho|dekhna|dekhein|dikhao|dekh)\b/.test(n) ||
      /\b(dekho|dekh|dikhao|dikha|dekhna|dekhein)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-look-into-order', 'look-into-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R5. Nikaal orders: nikaal ke do / nikaalo / nikal kar do. */
  if (/\b(nikaal\w*|nikal\w*)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-find-order', 'nikaal-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R6. Compare / verify / check orders (+ karo / kar / ke do). */
  if (/\b(compare|verify|fact[\s-]?check|cross[\s-]?check|check)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-verify-order', 'verify-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R7. Report deliverables: detailed report / report on X. */
  if (/\b(prepare|give|make|write|banayo|taiyar\s+karo)\b.{0,24}\b(detailed\s+)?report\b/.test(n) ||
      /\bdetailed\s+report\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-report-deliverable', 'report-deliverable');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R8. "chahiye" orders — only when the wanted thing is information
     (websites / sources / videos / report / ...), or a chat topic is
     known. Bare "ye mujhe chahiye" names nothing: not research. */
  /* R8 fix (22 Nov 2026): when the wanted thing IS an info noun
     ("mujhe ye websites chahiye", "مجھے یہ ذرائع چاہیے"), a demo
     verdict only means no subject was named - the info noun is a
     real object, so the order still researches and the flow asks
     which topic (needsTopic = true, topic = null). */
  if (/\bchahiye\b/.test(n)) {
    var infoNoun = INFO_NOUN_RE.test(n) || INFO_NOUN_URDU_RE.test(raw);
    if (infoNoun || ctxTopic) {
      v = orderVerdict(n, ctxTopic, 'explicit-want-order', 'chahiye-order');
      if (!v.research && infoNoun) {
        v = { research: true, reason: 'explicit-want-order', matched: 'chahiye-order', _content: [] };
      }
      return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
    }
    return { research: false, reason: 'chahiye-no-topic', topic: null, lang: lang, needsTopic: false, matched: 'chahiye-order', source: src.source, sources: src.sources };
  }
  /* R9. Where-to-find orders: "batao kahan se milega", "kahan milega". */
  if (/\bkahan\b.{0,24}\b(milega|milegi|milenge|milta|milti|mile)\b/.test(n) ||
      /\b(milega|milegi|milenge)\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-where-to-find', 'where-to-find');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R10. Find / look-up orders (English). Bare "find the best X" is
     NOT research (Raja's decision, 22 Nov 2026 ~4:57 PM): only the
     explicit forms below research - "find out ... about ...",
     "find ... karo", and "look up". ("Find out about X" names an
     explicit subject to investigate, unlike a bare "find the best";
     "find out" is itself the discovery verb, like "discover".) */
  if (/\bfind\s+out\b.{0,18}\babout\b/.test(n) ||
      /\bfind\b.{0,30}\b(karo|kar|ke\s+do|kar\s+ke\s+do)\b/.test(n) ||
      /\b(karo|kar)\b.{0,30}\bfind\b/.test(n) ||
      /\blook\s+up\b/.test(n)) {
    v = orderVerdict(n, ctxTopic, 'explicit-find-order', 'find-order');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R11. Urdu-script orders. */
  if (/ریسرچ\s*(کرو|کر|کریں|کر\s*کے)/.test(raw) || /تحقیق\s*(کرو|کر|کریں|کر\s*کے)/.test(raw)) {
    v = orderVerdict(n, ctxTopic, 'explicit-research-verb', 'research-verb-urdu');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  if (/ڈھونڈ/.test(raw) || /تلاش\s*(کرو|کر|کر\s*کے)/.test(raw) ||
      /گوگل\s*(کرو|کر)/.test(raw) || /انٹرنیٹ\s*(سے|پر)\s*ڈھونڈ/.test(raw)) {
    v = orderVerdict(n, ctxTopic, 'explicit-search-order', 'search-order-urdu');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  if (/بارے\s*میں.{0,34}دیکھو/.test(raw) || /دیکھو|دکھاؤ/.test(raw)) {
    v = orderVerdict(n, ctxTopic, 'explicit-look-into-order', 'look-into-order-urdu');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  if (/تفصیلی\s*رپورٹ/.test(raw)) {
    v = orderVerdict(n, ctxTopic, 'explicit-report-deliverable', 'report-deliverable-urdu');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  if (/مجھے.{0,20}چاہیے/.test(raw) && (INFO_NOUN_URDU_RE.test(raw) || ctxTopic)) {
    v = orderVerdict(n, ctxTopic, 'explicit-want-order', 'chahiye-order-urdu');
    if (!v.research && INFO_NOUN_URDU_RE.test(raw)) {
      v = { research: true, reason: 'explicit-want-order', matched: 'chahiye-order-urdu', _content: [] };
    }
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  /* R12. Devanagari orders (mirrors the backend classifier). */
  if (/शोध\s*(करो|कर|करें)/.test(raw) || /खोज\s*(करो|कर)/.test(raw) ||
      /ढूंढ\s*(दो|कर)/.test(raw) || /इंटरनेट\s*से\s*ढूंढ/.test(raw)) {
    v = orderVerdict(n, ctxTopic, 'explicit-search-order', 'search-order-hindi');
    return finish(v.research, v.reason, raw, lang, ctxTopic, v.matched, v);
  }
  return none;

  function finish(research, reason, textArg, langArg, ctx, matched, verdict) {
    var topic = null, needsTopic = false;
    var s = detectSource(textArg);
    if (research) {
      topic = extractTopic(textArg);
      if (!topic && ctx) topic = ctx;
      if (verdict && verdict._content && verdict._content.length && verdict.viaContext) topic = ctx;
      needsTopic = !topic;
      if (verdict && verdict.research && verdict._content && verdict._content.length === 0) needsTopic = true;
      if (topic) needsTopic = false;
    }
    var out = { research: research, reason: reason, topic: topic, lang: langArg, needsTopic: needsTopic, matched: matched, source: s.source, sources: s.sources };
    if (verdict && verdict._deep) out.deep = true;
    return out;
  }
}

/* ---------- clarification questions (user's own language) ----------
   ONE short, specific question per unclear reason. Never a
   research-vs-normal choice — that question IS the loop this piece
   removes. Templates exist for roman + urdu + en (+ hindi, mirroring
   the backend clarification manager). */
var CLARIFY_T = {
  'empty-message': {
    en: function () { return 'What would you like me to do?'; },
    roman: function () { return 'Aap kya karwana chahte hain?'; },
    urdu: function () { return 'آپ کیا کروانا چاہتے ہیں؟'; },
    hindi: function () { return 'आप क्या करवाना चाहते हैं?'; },
    punjabi: function () { return 'تسی کی کروانا چاہندے او؟'; }
  },
  'research-word-no-topic': {
    en: function () { return 'Which topic should I look into?'; },
    roman: function () { return 'Main kis topic par kaam karoon?'; },
    urdu: function () { return 'میں کس موضوع پر کام کروں؟'; },
    hindi: function () { return 'मैं किस विषय पर काम करूँ?'; },
    punjabi: function () { return 'میں کس موضوع تے کم کراں؟'; }
  },
  'pronoun-only-no-topic': {
    en: function () { return 'Which topic should I look into?'; },
    roman: function () { return 'Main kis topic par kaam karoon?'; },
    urdu: function () { return 'میں کس موضوع پر کام کروں؟'; },
    hindi: function () { return 'मैं किस विषय पर काम करूँ?'; },
    punjabi: function () { return 'میں کس موضوع تے کم کراں؟'; }
  },
  'tell-more-no-topic': {
    en: function () { return 'Which topic should I look into?'; },
    roman: function () { return 'Main kis topic par kaam karoon?'; },
    urdu: function () { return 'میں کس موضوع پر کام کروں؟'; },
    hindi: function () { return 'मैं किस विषय पर काम करूँ?'; },
    punjabi: function () { return 'میں کس موضوع تے کم کراں؟'; }
  },
  'research-verb-pronoun-no-topic': {
    en: function () { return 'Which topic should I look into?'; },
    roman: function () { return 'Main kis topic par kaam karoon?'; },
    urdu: function () { return 'میں کس موضوع پر کام کروں؟'; },
    hindi: function () { return 'मैं किस विषय पर काम करूँ?'; },
    punjabi: function () { return 'میں کس موضوع تے کم کراں؟'; }
  },
  'chahiye-no-topic': {
    en: function () { return 'Which topic should I look into?'; },
    roman: function () { return 'Main kis topic par kaam karoon?'; },
    urdu: function () { return 'میں کس موضوع پر کام کروں؟'; },
    hindi: function () { return 'मैं किस विषय पर काम करूँ?'; },
    punjabi: function () { return 'میں کس موضوع تے کم کراں؟'; }
  },
  'bare-topic-fragment': {
    en: function (t) { return 'What would you like to know about "' + t + '"?'; },
    roman: function (t) { return '"' + t + '" ke baare mein aap kya jaanna chahte hain?'; },
    urdu: function (t) { return '"' + t + '" کے بارے میں آپ کیا جاننا چاہتے ہیں؟'; },
    hindi: function (t) { return '"' + t + '" के बारे में आप क्या जानना चाहते हैं?'; },
    punjabi: function (t) { return '"' + t + '" دے بارے وچ تسی کی جاننا چاہندے او؟'; }
  },
  'no-referent': {
    en: function (a, b) { return a && b ? 'Do you mean "' + a + '" or "' + b + '"?' : 'Which task do you mean?'; },
    roman: function (a, b) { return a && b ? 'Aap ka matlab "' + a + '" hai ya "' + b + '"?' : 'Aap kis kaam ki baat kar rahe hain?'; },
    urdu: function (a, b) { return a && b ? 'آپ کا مطلب "' + a + '" ہے یا "' + b + '"؟' : 'آپ کس کام کی بات کر رہے ہیں؟'; },
    hindi: function (a, b) { return a && b ? 'आपका मतलब "' + a + '" है या "' + b + '"?' : 'आप किस काम की बात कर रहे हैं?'; },
    punjabi: function (a, b) { return a && b ? 'تواڈا مطلب "' + a + '" اے یا "' + b + '"؟' : 'تسی کس کم دی گل کر رہے او؟'; }
  },
  'destructive-unclear-target': {
    en: function () { return 'What exactly do you want me to delete or send?'; },
    roman: function () { return 'Aap kya delete ya send karna chahte hain?'; },
    urdu: function () { return 'آپ کیا حذف یا بھیجنا چاہتے ہیں؟'; },
    hindi: function () { return 'आप क्या हटाना या भेजना चाहते हैं?'; },
    punjabi: function () { return 'تسی کی حذف یا بھیجنا چاہندے او؟'; }
  },
  'generic': {
    en: function () { return 'Could you say a little more about what you would like me to do?'; },
    roman: function () { return 'Aap kis baare mein baat kar rahe hain?'; },
    urdu: function () { return 'آپ کس بارے میں بات کر رہے ہیں؟'; },
    hindi: function () { return 'आप किस बारे में बात कर रहे हैं?'; },
    punjabi: function () { return 'تسی کس بارے وچ گل کر رہے او؟'; }
  }
};

function clarifyQuestion(text, reason, lang, options) {
  function origClarify47(text, reason, lang, options){
      var L = (lang === 'urdu' || lang === 'hindi' || lang === 'roman' || lang === 'punjabi') ? lang : 'en';
      var group = CLARIFY_T[reason] ? reason : 'generic';
      var g = CLARIFY_T[group];
      var fn = g[L] || g.en;
      var topic = trim(String(text || '').replace(/[?!.,]+$/g, ''));
      var a = options && options[0] ? options[0] : null;
      var b = options && options[1] ? options[1] : null;
      if (group === 'bare-topic-fragment') return fn(topic);
      if (group === 'no-referent') return fn(a, b);
      return fn();
  }
  if(window.EnzoLang47 && window.EnzoLang47.clarifyQuestion47) return window.EnzoLang47.clarifyQuestion47(text, reason, lang, options, origClarify47);
  return origClarify47(text, reason, lang, options);
}

/* ---------- genuinely-ambiguous reasons (clarify is a last resort) ---------- */
var COMMON_VERBS = { is: 1, are: 1, was: 1, were: 1, do: 1, does: 1,
  did: 1, can: 1, could: 1, will: 1, would: 1, should: 1, explain: 1,
  tell: 1, find: 1, search: 1, research: 1, give: 1, show: 1, make: 1,
  write: 1, help: 1, think: 1, like: 1, want: 1, need: 1, get: 1,
  know: 1, mean: 1, work: 1, happen: 1, go: 1, come: 1, say: 1, see: 1,
  hai: 1, hain: 1, karo: 1, kar: 1, kya: 1, kia: 1, ka: 1, ki: 1, ke: 1,
  mein: 1, batao: 1, samjhao: 1 };

function ambiguousReason(text, normed, ctxTopic) {
  var t = trim(text), n = normed;
  if (!t) return 'empty-message';
  if (/^(research|search|tehqeeq|tahqeeq|shodh|khoj|dhoond|dhund|talaash|talash|google|find|check|verify|compare|explore|browse|discover|analy[sz]e|learn|study|gather|collect|assemble|compile|akathi|ikathi|jama|seekho|sikho|labho|vekho)\.?$/.test(trim(n))) return 'research-word-no-topic';
  if (/^(ریسرچ|تحقیق|ڈھونڈ|تلاش|گوگل|سرچ|سیکھو|جانچ|دریافت|موازنہ|لبھو|ویکھو|سکھو|اکٹھی|جمع|शोध|खोज|ढूंढ)$/.test(t)) return 'research-word-no-topic';
  if (!ctxTopic) {
    if (/\b(research|search|find|look\s+up|google|verify|check)\s+(it|that|this|them)\s*[?!.]*$/.test(n)) return 'pronoun-only-no-topic';
    if (/^\s*tell\s+me\s+(more\s+)?about\s+(it|that|this|them)\s*[?!.]*$/.test(n)) return 'pronoun-only-no-topic';
    if (/^\s*what\s+about\s+(it|that|this|them)\s*[?!.]*$/.test(n)) return 'pronoun-only-no-topic';
    if (/^\s*tell\s+me\s+more\s*[?!.]*$/.test(n)) return 'tell-more-no-topic';
  }
  if (/\b(delete|remove|erase|clear|send|bhej|bhejo)\b.{0,25}\b(it|that|this|them|that one)\b/.test(n)) return 'destructive-unclear-target';
  if (/^(delete|remove|send|bhej|bhejo)\s+(it|that|this|them|kar|karo|do)\b/.test(n)) return 'destructive-unclear-target';
  if (/^(یہ|وہ|اس|اسی)\s+(والا\s+)?کام\s+کر\s+دو/.test(t)) return 'no-referent';
  if (/^یہ\s+کر\s+دو/.test(t) || /^وہ\s+کر\s+دو/.test(t)) return 'no-referent';
  var toks = tokensOf(n);
  if (toks.length > 0 && toks.length <= 14) {
    var v = objectVerdict(n, ctxTopic);
    /* A "let's ..." suggestion ("let's explore this idea") is guftagu,
       not an unclear referent: never clarify it. (41-fix: 'let' is a
       filler word, so such a sentence verdicts as demo here.) */
    if (v.kind === 'demo' && !/^\s*let\s+s\s/.test(n)) return 'no-referent';
  }
  if (toks.length >= 1 && toks.length <= 3) {
    var hasVerb = false, j;
    for (j = 0; j < toks.length; j++) { if (COMMON_VERBS[toks[j]]) { hasVerb = true; break; } }
    if (!hasVerb && !conversationKind(text, n)) return 'bare-topic-fragment';
  }
  return null;
}

/* ---------- the gate hook: the ONE function the gate calls FIRST ----------
   shouldClarify(text, context) -> { clarify, lang, reason, question,
   research }. The assembler calls this before garbledScore/CONFIRM_T
   and before vagueCheck/classifyIntent. clarify === false means:
   proceed — never confirm, never clarify, never badge as Normal when
   research.research is true. clarify === true means: show question
   (already in the user's language) and nothing else. */
function shouldClarify(text, context) {
  var raw = String(text == null ? '' : text);
  var lang = (window.EnzoLang47 ? window.EnzoLang47.resolveClarifyLang(raw, (typeof state!=='undefined' && state ? state.langPref : 'auto')) : detectLanguage(raw));
  var normed = normPadded(raw);
  var ctxTopic = contextTopic(context);
  var r = isResearchOrder(raw, context);
  if (r.research) {
    return { clarify: false, lang: lang, reason: 'research-order:' + r.reason, question: null, research: r };
  }
  if (r.reason === 'research-verb-pronoun-no-topic' || r.reason === 'chahiye-no-topic' || r.reason === 'research-word-no-topic') {
    return { clarify: true, lang: lang, reason: r.reason, question: clarifyQuestion(raw, r.reason, lang), research: r };
  }
  if (conversationKind(raw, normed)) {
    return { clarify: false, lang: lang, reason: 'conversation', question: null, research: r };
  }
  if (isDefinition(raw, normed)) {
    return { clarify: false, lang: lang, reason: 'definition', question: null, research: r };
  }
  var amb = ambiguousReason(raw, normed, ctxTopic);
  if (amb) {
    return { clarify: true, lang: lang, reason: amb, question: clarifyQuestion(raw, amb, lang), research: r };
  }
  return { clarify: false, lang: lang, reason: 'general-default', question: null, research: r };
}

/* ---------- exports ---------- */
var api = {
  detectLanguage: detectLanguage,
  isResearchOrder: isResearchOrder,
  clarifyQuestion: clarifyQuestion,
  shouldClarify: shouldClarify,
  extractTopic: extractTopic,
  detectSource: detectSource,
  normRoman: normRoman,
  conversationKind: conversationKind,
  isDefinition: isDefinition
};
global.EnzoResearchTriggers = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
