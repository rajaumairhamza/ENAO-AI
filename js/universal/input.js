
/* ============================================================================
   ENAO AI universal-intel — PIECE 10: universal input understanding
   File: 10-input.js
   Artifact: enao-ai (web_static). Builds on live v56-universal.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. DO NOT EDIT ANY OTHER FILE.

   PURPOSE
   -------
   Root cause (AUDIT.md §2): input handling is regex lists per language.
   No typo tolerance beyond a few folds, no mixed-language sentence
   handling, no incomplete-message repair, no unseen-request reasoning.
   A request outside the known patterns falls to 'general' with no
   analysis of what it actually needs. This piece is the single front
   door for raw user text: it normalises, detects language per segment,
   spots incomplete messages, splits multi-step requests, resolves
   references through the conversation piece, and extracts content
   words — for ANY subject, in English, Urdu script, Roman Urdu and
   transliterated Hindi. No topic names appear anywhere in this file.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   normalizeInput(text)
     -> { original, text, language, script, mixed, segments }
     text is the folded normalised form (lower-cased Latin, spelling
     folds + typo folds applied, punctuation turned to spaces,
     whitespace collapsed, digits folded to Latin). language is the
     primary language ('en' | 'roman' | 'urdu' | 'hindi' | 'mixed' |
     'unknown'). script is 'latin' | 'urdu' | 'devanagari' | 'mixed' |
     'none'. segments come from detectLanguageDetailed.
   detectLanguageDetailed(text)
     -> { language, script, mixed, segments }
     segments is [{ text, language, script, start, end }] — one entry
     per run of same-language tokens, so a mixed-language sentence
     yields one segment per language run. A lone content word embedded
     in a run of another language joins that run (smoothing), so a
     foreign subject word does not shatter a sentence into segments.
   isIncomplete(text) -> boolean
     True for a short / fragment message that names no action and no
     object: empty text, a bare topic name, a demonstrative + verb with
     no referent, a pronoun-only object ("research it" with no topic
     in the message itself). False for greetings, for any message with
     a question word + a content word, and for any message with an
     action verb + an object.
   splitMultiStep(text) -> [step, ...]
     Splits a multi-step request into ordered steps, keeping the
     connector that introduces each step ("then", "phir", "after
     that", "next", "secondly", numbers, "step 1:"). One step -> the
     original text trimmed, in a one-element array. Empty -> [].
   extractReferences(text, ctx)
     -> { resolvedText, topic, pronounResolved, isTopicChange,
          alreadyAnswered, source }
     DELEGATES to EnaoConversation.resolveFollowUp when that function
     exists (browser assembly or a stub in tests) and returns its
     result verbatim, tagged source 'EnaoConversation.resolveFollowUp'.
     It never re-implements pronoun resolution: when the conversation
     piece is absent it returns the text unchanged with the topic
     taken from ctx (if any) and source 'fallback-no-conversation-piece'.
   summarizeIntentWords(text) -> [word, ...]
     Content words minus stopwords, in order, de-duplicated, across
     all four language paths. The topic-neutral vocabulary the
     reasoning piece and the context piece build on.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing v53/v54/v55/v56 file style. Zero emojis.
   ========================================================================== */

(function (root) {

var VERSION = '10-input v1.0 (enao-universal-intel, 22 Nov 2026)';

/* ---------- small helpers ---------- */
function inTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function inHasUrdu(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }
function inHasDevanagari(s) { return /[\u0900-\u097F]/.test(String(s || '')); }
function inFoldDigits(s) {
  var out = '', i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0x660 && c <= 0x669) out += String.fromCharCode(48 + c - 0x660);
    else if (c >= 0x6F0 && c <= 0x6F9) out += String.fromCharCode(48 + c - 0x6F0);
    else if (c >= 0x0966 && c <= 0x096F) out += String.fromCharCode(48 + c - 0x0966);
    else out += s.charAt(i);
  }
  return out;
}
function inWordCount(s) {
  var t = inTrim(s);
  return t ? t.split(/\s+/).length : 0;
}
function inClip(s, max) {
  var t = inTrim(s);
  if (t.length <= max) return t;
  var cut = t.slice(0, max);
  var sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut + '...';
}

/* ---------- spelling + typo folds (word forms only, never topics) ---------- */
/* Maps variant spellings and common typos of FUNCTION words and of the
   generic action verbs onto one form, so one pattern covers many
   phrasings. It never maps one subject onto another. */
var IN_FOLDS = {
  kia: 'kya', ha: 'hai', hen: 'hain', rahay: 'rahe', rahy: 'rahe',
  jaa: 'ja', kidher: 'kidhar', konsa: 'kaunsa', kesay: 'kaise',
  kese: 'kaise', dhoondh: 'dhoond', dhund: 'dhoond', talaash: 'talaash',
  tahqeeq: 'tehqeeq', shodh: 'shodh', khoj: 'khoj', jaanch: 'jaanch',
  reserch: 'research', reasearch: 'research', reseach: 'research',
  reaserch: 'research', resarch: 'research', reserach: 'research',
  definision: 'definition', definetion: 'definition', definaton: 'definition',
  explian: 'explain', explan: 'explain', explane: 'explain',
  writting: 'writing', writen: 'written', seperate: 'separate',
  summarise: 'summarize', summarised: 'summarized', summarising: 'summarizing',
  anaylse: 'analyse', analize: 'analyze', comparision: 'comparison',
  pls: 'please', plz: 'please', info: 'information', thru: 'through',
  bcz: 'because', cuz: 'because', wanna: 'want to', gonna: 'going to',
  kinda: 'kind of', sorta: 'sort of', alot: 'a lot', cannot: 'can not'
};
function inFoldWord(w) {
  var f = IN_FOLDS[w];
  if (f) return f;
  /* Collapse a run of 3+ identical letters to one ("pleease" ->
     "please" is caught by the 3+ rule only for the tripled letter;
     ordinary doubles such as "book" are left alone). */
  if (/(.)\1\1/.test(w)) return w.replace(/(.)\1\1+/g, '$1');
  return w;
}
/* Folded normalised form: lower-cased Latin, digits folded, punctuation
   turned to spaces, word folds applied, whitespace collapsed. Urdu and
   Devanagari text is kept as-is apart from digit folding and spacing. */
function inFoldText(text) {
  var raw = inFoldDigits(String(text == null ? '' : text));
  var parts = raw.split(/\s+/);
  var out = [];
  var i, w, folded;
  for (i = 0; i < parts.length; i++) {
    w = parts[i];
    if (!w) continue;
    if (/[a-zA-Z]/.test(w)) {
      folded = w.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      folded = inTrim(folded);
      if (!folded) continue;
      var sub = folded.split(/\s+/);
      var j;
      for (j = 0; j < sub.length; j++) out.push(inFoldWord(sub[j]));
    } else {
      folded = w.replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ');
      folded = inTrim(folded);
      if (folded) out.push(folded);
    }
  }
  return out.join(' ');
}

/* ---------- language / script detection ---------- */
var IN_ROMAN_MARKERS = {
  kya: 1, kia: 1, hai: 1, ha: 1, hain: 1, hen: 1, ka: 1, ki: 1, ke: 1,
  ko: 1, se: 1, mein: 1, me: 1, par: 1, pe: 1, batao: 1, batayein: 1,
  samjhao: 1, samjhaen: 1, konsa: 1, kaunsa: 1, kyun: 1, kab: 1, kaisa: 1,
  mera: 1, meri: 1, mere: 1, mujhe: 1, aap: 1, tum: 1, tu: 1, yeh: 1,
  ye: 1, woh: 1, wo: 1, nahi: 1, nahin: 1, aur: 1, tha: 1, thi: 1,
  kar: 1, karo: 1, karein: 1, chahiye: 1, wala: 1, wali: 1, aj: 1,
  aaj: 1, kal: 1, bohat: 1, bahut: 1, acha: 1, achha: 1, theek: 1,
  thik: 1, rahe: 1, rahay: 1, ho: 1, kidhar: 1, kahan: 1, kitne: 1,
  kitna: 1, kitni: 1, abhi: 1, kis: 1, kaise: 1, kesay: 1, kese: 1,
  faide: 1, fayde: 1, nuqsanat: 1, banaya: 1, sunao: 1, shukriya: 1,
  pehle: 1, chalo: 1, matlab: 1, kehte: 1, dhoond: 1, tehqeeq: 1,
  talaash: 1, talash: 1, phir: 1, uske: 1, baad: 1, zara: 1,
  hota: 1, hoti: 1, hote: 1, gaya: 1, gayi: 1, aaya: 1, hoon: 1,
  hun: 1, hoga: 1, hogi: 1, lagta: 1, jayega: 1, cheez: 1, kaam: 1,
  is: 1, us: 1, baare: 1, bare: 1
};
var IN_HINDI_MARKERS = {
  kya: 1, hai: 1, hain: 1, ka: 1, ki: 1, ke: 1, ko: 1, se: 1, mein: 1,
  batao: 1, samjhao: 1, kaunsa: 1, kyun: 1, kab: 1, kaisa: 1, mera: 1,
  mujhe: 1, aap: 1, tum: 1, yeh: 1, woh: 1, nahi: 1, aur: 1, tha: 1,
  thi: 1, kar: 1, karo: 1, chahiye: 1, wala: 1, aaj: 1, kal: 1,
  bahut: 1, achha: 1, theek: 1, rahe: 1, ho: 1, kidhar: 1, kahan: 1,
  kitne: 1, abhi: 1, kis: 1, kaise: 1, faide: 1, shodh: 1, khoj: 1,
  jaanch: 1, phir: 1, baad: 1, hota: 1, hoti: 1, gaya: 1, aaya: 1,
  hoga: 1, cheez: 1, kaam: 1, matlab: 1
};
function inScriptOfToken(tok) {
  if (inHasUrdu(tok)) return 'urdu';
  if (inHasDevanagari(tok)) return 'devanagari';
  if (/[a-zA-Z]/.test(tok)) return 'latin';
  return 'other';
}
function inLangOfLatinToken(tok, scriptLang) {
  var w = tok.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 'en';
  /* Transliterated Hindi shares most Roman Urdu markers; the script
     of the surrounding text decides between 'roman' and 'hindi' —
     the caller passes scriptLang ('roman' or 'hindi') when the
     sentence already has Devanagari, else markers mean Roman Urdu. */
  if (IN_ROMAN_MARKERS[w]) return scriptLang || 'roman';
  if (IN_HINDI_MARKERS[w]) return scriptLang || 'roman';
  return 'en';
}
/* PUBLIC: detectLanguageDetailed */
function detectLanguageDetailed(text) {
  var raw = String(text == null ? '' : text);
  if (!inTrim(raw)) {
    return { language: 'unknown', script: 'none', mixed: false, segments: [] };
  }
  var hasUrdu = inHasUrdu(raw);
  var hasDeva = inHasDevanagari(raw);
  var scriptLang = hasDeva ? 'hindi' : 'roman';
  /* Tokenise on whitespace, keeping each token's start offset so the
     assembler can map a segment back to the original text. */
  var tokens = [];
  var re = /\S+/g;
  var m;
  while ((m = re.exec(raw)) !== null) {
    var tok = m[0];
    var sc = inScriptOfToken(tok);
    var lang;
    if (sc === 'urdu') lang = 'urdu';
    else if (sc === 'devanagari') lang = 'hindi';
    else if (sc === 'latin') lang = inLangOfLatinToken(tok, scriptLang);
    else lang = 'en';
    tokens.push({ text: tok, language: lang, script: sc, start: m.index, end: m.index + tok.length });
  }
  if (!tokens.length) {
    return { language: 'unknown', script: 'none', mixed: false, segments: [] };
  }
  /* Group consecutive same-language tokens into segments. */
  var groups = [];
  var i, g;
  for (i = 0; i < tokens.length; i++) {
    g = groups[groups.length - 1];
    if (g && g.language === tokens[i].language) {
      g.tokens.push(tokens[i]);
      g.end = tokens[i].end;
    } else {
      groups.push({ language: tokens[i].language, tokens: [tokens[i]], start: tokens[i].start, end: tokens[i].end });
    }
  }
  /* Smoothing: a single-token segment flanked on both sides by the
     same language joins that language. A foreign subject word inside
     a sentence ("Explain photosynthesis, phir is ke faide batao" —
     "photosynthesis" is an English token inside Roman Urdu) must not
     shatter the sentence; a real language switch is never a lone
     token flanked by one language on both sides. */
  var merged = [];
  for (i = 0; i < groups.length; i++) {
    g = groups[i];
    var prev = merged[merged.length - 1];
    var next = groups[i + 1];
    if (g.tokens.length === 1 && prev && next && prev.language === next.language &&
        (g.language === 'en' || prev.language === 'en' || g.language === 'roman' || g.language === 'hindi')) {
      prev.tokens = prev.tokens.concat(g.tokens);
      prev.end = g.end;
      continue;
    }
    merged.push(g);
  }
  var segments = [];
  var langsSeen = {};
  var scriptsSeen = {};
  /* Final coalesce: smoothing can leave two adjacent segments of the
     same language (a merged middle token joins the left run while the
     right run stays separate). Join them so a segment is always one
     maximal same-language run. */
  var coalesced = [];
  for (i = 0; i < merged.length; i++) {
    g = merged[i];
    var lastC = coalesced[coalesced.length - 1];
    if (lastC && lastC.language === g.language) {
      lastC.tokens = lastC.tokens.concat(g.tokens);
      lastC.end = g.end;
    } else {
      coalesced.push(g);
    }
  }
  merged = coalesced;
  for (i = 0; i < merged.length; i++) {
    g = merged[i];
    var segText = raw.slice(g.start, g.end);
    var segScript = g.language === 'urdu' ? 'urdu' : (g.language === 'hindi' ? 'devanagari' : 'latin');
    segments.push({ text: segText, language: g.language, script: segScript, start: g.start, end: g.end });
    langsSeen[g.language] = 1;
    scriptsSeen[segScript] = 1;
  }
  var langKeys = [];
  var k;
  for (k in langsSeen) { if (langsSeen.hasOwnProperty(k)) langKeys.push(k); }
  var scriptKeys = [];
  for (k in scriptsSeen) { if (scriptsSeen.hasOwnProperty(k)) scriptKeys.push(k); }
  var mixed = langKeys.length > 1;
  var language;
  if (mixed) language = 'mixed';
  else language = langKeys[0];
  /* A Latin-only sentence with no Roman/Hindi marker is English;
     a sentence whose only non-English tokens are Urdu-script is
     Urdu even if a Latin subject word sits inside it. */
  if (!mixed && language === 'en' && hasUrdu) language = 'urdu';
  if (!mixed && language === 'en' && hasDeva) language = 'hindi';
  var script = scriptKeys.length > 1 ? 'mixed' : scriptKeys[0];
  return { language: language, script: script, mixed: mixed, segments: segments };
}

/* PUBLIC: normalizeInput */
function normalizeInput(text) {
  var raw = String(text == null ? '' : text);
  var det = detectLanguageDetailed(raw);
  return {
    original: raw,
    text: inFoldText(raw),
    language: det.language,
    script: det.script,
    mixed: det.mixed,
    segments: det.segments
  };
}

/* ---------- stopwords: what is NOT a content word ---------- */
function inStopTable(list) {
  var t = {};
  var i;
  for (i = 0; i < list.length; i++) t[list[i]] = 1;
  return t;
}
var IN_STOP_EN = inStopTable(('what is are was were who whom whose when where why how which ' +
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
var IN_STOP_ROMAN = inStopTable(('kya kia hai ha hain hen ka ki ke ko se mein me par pe ' +
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
var IN_STOP_URDU = inStopTable(('کیا ہے ہیں کا کی کے کو سے میں پر بتاؤ بتائیں سمجھاؤ کونسا ' +
  'کیوں کب کیسا میرا مجھے آپ یہ وہ نہیں اور تھا تھی کر کرو چاہیے والا والی ' +
  'آج کل بہت اچھا ٹھیک رہے ہو اس کس نے بنایا مطلب کہتے پہلے اب چلو بات چیز ' +
  'ہوتا ہوتی سناؤ شکریہ نہ ہی تو پھر بھی یا جو جس جن رہا رہی گا گی ہوں کتنے ' +
  'کتنا کہاں کدھر کون ایسا ایسے تھوڑا زیادہ کرنا کرنے جانا آنا دینا لینا ملنا ' +
  'ہوگا ہوگی گیا گئی گئے آیا آئی آئے پھر بعد').split(' '));
var IN_STOP_HINDI = inStopTable(('क्या है हैं का की के को से में पर बताओ बताएँ समझाओ कौनसा ' +
  'क्यों कब कैसा मेरा मुझे आप यह वह नहीं और था थी कर करो चाहिए वाला वाली ' +
  'आज कल बहुत अच्छा ठीक रहे हो इस किस ने बनाया मतलब कहते पहले अब चलो बात चीज ' +
  'होता होती सुनाओ शुक्रिया न ही तो फिर भी या जो जिस जिन रहा रही गा गी हूँ कितने ' +
  'कितना कहाँ किधर कौन ऐसा ऐसे थोड़ा ज्यादा करना करने जाना आना देना लेना मिलना ' +
  'होगा होगी गया गई गए आया आई आए फिर बाद').split(' '));

/* PUBLIC: summarizeIntentWords */
function summarizeIntentWords(text) {
  var folded = inFoldText(text);
  if (!folded) return [];
  var tokens = folded.split(/\s+/);
  var out = [];
  var seen = {};
  var i, w;
  for (i = 0; i < tokens.length; i++) {
    w = tokens[i];
    if (!w) continue;
    if (IN_STOP_EN[w] || IN_STOP_ROMAN[w] || IN_STOP_URDU[w] || IN_STOP_HINDI[w]) continue;
    if (/^\d+$/.test(w)) continue;
    if (w.length < 2 && w !== 'ai') continue;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  }
  return out;
}

/* ---------- question / action vocabulary (phrasing only, never a topic) ---------- */
var IN_QUESTION_WORDS = {
  what: 1, why: 1, how: 1, when: 1, where: 1, who: 1, which: 1, whom: 1,
  kya: 1, kia: 1, kaun: 1, kon: 1, kab: 1, kahan: 1, kidhar: 1,
  kaise: 1, kesay: 1, kese: 1, kyun: 1, kyu: 1, konsa: 1, kaunsa: 1,
  'کیا': 1, 'کب': 1, 'کہاں': 1, 'کدھر': 1, 'کیسے': 1, 'کیوں': 1, 'کون': 1,
  'क्या': 1, 'कब': 1, 'कहाँ': 1, 'किधर': 1, 'कैसे': 1, 'क्यों': 1, 'कौन': 1
};
var IN_ACTION_VERBS = {
  research: 1, investigate: 1, explain: 1, tell: 1, write: 1, make: 1,
  build: 1, create: 1, prepare: 1, find: 1, search: 1, compare: 1,
  summarize: 1, summarise: 1, describe: 1, define: 1, give: 1,
  show: 1, list: 1, analyse: 1, analyze: 1, check: 1, verify: 1,
  design: 1, develop: 1, discuss: 1, talk: 1, help: 1, learn: 1,
  teach: 1, read: 1, translate: 1, calculate: 1, plan: 1, fix: 1,
  send: 1, open: 1, play: 1, run: 1, change: 1, update: 1, delete: 1,
  karo: 1, kar: 1, batao: 1, samjhao: 1, dhoond: 1, likho: 1, banao: 1,
  nikalo: 1, dikhao: 1, karo: 1, tehqeeq: 1, shodh: 1, khoj: 1,
  'ریسرچ': 1, 'تحقیق': 1, 'بتاؤ': 1, 'سمجھاؤ': 1, 'ڈھونڈ': 1, 'لکھو': 1,
  'بناؤ': 1, 'تلاش': 1, 'शोध': 1, 'खोज': 1, 'बताओ': 1, 'समझाओ': 1,
  'लिखो': 1, 'बनाओ': 1
};
var IN_PRONOUNS = {
  it: 1, this: 1, that: 1, them: 1, they: 1, he: 1, she: 1, his: 1, her: 1,
  ye: 1, yeh: 1, wo: 1, woh: 1, is: 1, us: 1, isko: 1, usko: 1, ise: 1,
  usse: 1, isi: 1, usi: 1, 'یہ': 1, 'وہ': 1, 'اس': 1, 'اسی': 1, 'उस': 1,
  'यह': 1, 'वह': 1, 'इस': 1
};
var IN_DEMONSTRATIVES = {
  ye: 1, yeh: 1, wo: 1, woh: 1, is: 1, us: 1, isi: 1, usi: 1,
  this: 1, that: 1, these: 1, those: 1, wala: 1, wali: 1, wale: 1,
  'یہ': 1, 'وہ': 1, 'اس': 1, 'اسی': 1, 'وہی': 1, 'یہی': 1,
  'यह': 1, 'वह': 1, 'इस': 1
};
var IN_GREETINGS = {
  hello: 1, hi: 1, hey: 1, salam: 1, aoa: 1, namaste: 1, thanks: 1,
  shukriya: 1, bye: 1, 'السلام علیکم': 1, 'سلام': 1, 'شکریہ': 1,
  'नमस्ते': 1, 'धन्यवाद': 1
};
function inHasWord(table, tokens) {
  var i;
  for (i = 0; i < tokens.length; i++) if (table[tokens[i]]) return true;
  return false;
}
function inIsGreeting(text) {
  var folded = inFoldText(text);
  var tokens = folded ? folded.split(/\s+/) : [];
  if (!tokens.length || tokens.length > 6) return false;
  var i, hits = 0;
  for (i = 0; i < tokens.length; i++) {
    if (IN_GREETINGS[tokens[i]]) hits++;
    else if (tokens[i] === 'assalamualaikum' || tokens[i] === 'good' || tokens[i] === 'morning' || tokens[i] === 'allah' || tokens[i] === 'hafiz' || tokens[i] === 'khuda') hits++;
    else return false;
  }
  return hits > 0;
}

/* PUBLIC: isIncomplete */
function isIncomplete(text) {
  var raw = String(text == null ? '' : text);
  if (!inTrim(raw)) return true;
  if (inIsGreeting(raw)) return false;
  var folded = inFoldText(raw);
  var tokens = folded ? folded.split(/\s+/) : [];
  if (!tokens.length) return true;
  var content = summarizeIntentWords(raw);
  /* Content words that ARE the action verb do not count as an object:
     "delete it" and "research it" name no object — the verb alone
     is not one. */
  var contentNoVerb = [];
  var ci;
  for (ci = 0; ci < content.length; ci++) {
    if (!IN_ACTION_VERBS[content[ci]]) contentNoVerb.push(content[ci]);
  }
  var hasQuestion = inHasWord(IN_QUESTION_WORDS, tokens);
  var hasAction = inHasWord(IN_ACTION_VERBS, tokens);
  var hasPronoun = inHasWord(IN_PRONOUNS, tokens);
  var hasDemo = inHasWord(IN_DEMONSTRATIVES, tokens);
  /* A single word (other than a greeting) names no action and no
     object. Two or three words with no verb and no question word are
     a bare fragment, not a request. */
  if (tokens.length === 1) return true;
  if (tokens.length <= 3 && !hasQuestion && !hasAction) return true;
  /* Pronoun-only object ("research it", "tell me about it", "delete
     it") names nothing on its own — checked before the verb+object
     rule, because the verb itself is not an object. */
  if (hasAction && hasPronoun && contentNoVerb.length === 0) return true;
  if (hasPronoun && contentNoVerb.length === 0 && tokens.length <= 6) return true;
  /* Question word + content word is a complete question; action verb
     + content word is a complete order. */
  if (hasQuestion && contentNoVerb.length >= 1) return false;
  if (hasAction && contentNoVerb.length >= 1) return false;
  /* Demonstrative + verb with no content word has no referent. */
  if (hasDemo && hasAction && contentNoVerb.length === 0) return true;
  /* No content words at all and no question: nothing to act on. */
  if (contentNoVerb.length === 0 && !hasQuestion) return true;
  return false;
}

/* ---------- PUBLIC: splitMultiStep ---------- */
/* Split points, in scan order. Each match is a boundary: the matched
   connector is kept as the start of the following step (a leading
   comma is dropped). Numbered steps keep their number. */
var IN_STEP_SPLIT = /(?:\s*(?:step\s+)?\d+\s*[:.)]\s+)|(?:;\s*)|(?:\s*,\s*then\s+)|(?:\s+and\s+then\s+)|(?:\s+then\s+)|(?:\s+after\s+that\s*,?\s+)|(?:\s+phir\s+)|(?:\s+uske\s+baad\s+)|(?:\s+next\s*,?\s+)|(?:\s+secondly\s*,?\s+)|(?:\s+thirdly\s*,?\s+)|(?:\s+finally\s*,?\s+)|(?:\s+پھر\s+)|(?:\s+اس\s+کے\s+بعد\s+)|(?:\s+फिर\s+)|(?:\s+उसके\s+बाद\s+)|(?:\s*,\s*(?:and\s+)?(?=compare\b|tell\b|write\b|list\b|find\b|check\b|give\b|make\b|show\b|explain\b|create\b|build\b|send\b|prepare\b|calculate\b|analy[sz]e\b|summari[sz]e\b|describe\b|suggest\b|recommend\b|verify\b|research\b|search\b|fetch\b|draft\b|plan\b|design\b|test\b|fix\b|translate\b|convert\b|add\b|remove\b|delete\b|update\b|open\b|start\b|call\b|email\b|batao\b|bataen\b|likho\b|dikhao\b|banao\b|dhoondo\b|dhoondho\b|bhejo\b))/gi;
/* A comma followed by an imperative verb starts a new step
   ("find X, compare it, and tell me Y" is three steps). A bare "and"
   still never splits ("pros and cons" stays one step) — only a comma
   boundary plus an action verb splits. */
function splitMultiStep(text) {
  var raw = String(text == null ? '' : text);
  var trimmed = inTrim(raw);
  if (!trimmed) return [];
  IN_STEP_SPLIT.lastIndex = 0;
  var steps = [];
  var last = 0;
  var m;
  var pendingPrefix = '';
  while ((m = IN_STEP_SPLIT.exec(trimmed)) !== null) {
    var head = inTrim(trimmed.slice(last, m.index));
    if (head) steps.push(head);
    var delim = m[0];
    /* A numbered boundary starts a new step with its number; a
       semicolon starts a bare new step; a connector word starts a
       new step carrying that connector. */
    if (/^\s*(?:step\s+)?\d+\s*[:.)]\s+$/i.test(delim)) pendingPrefix = inTrim(delim) + ' ';
    else if (/^[,;]\s*$/.test(delim)) pendingPrefix = '';
    else pendingPrefix = inTrim(delim.replace(/^,/, '')) + ' ';
    last = m.index + m[0].length;
    /* The connector belongs to the NEXT step, so prepend it to the
       text that follows: fold it into last by remembering it and
       applying it when the next head is cut. We do that by pushing
       a marker step part below via pendingPrefix on the next cut. */
    steps._pending = pendingPrefix;
  }
  var tail = inTrim(trimmed.slice(last));
  if (tail) {
    var prefix = steps._pending || '';
    steps.push(prefix + tail);
  }
  delete steps._pending;
  /* The loop above stored only the LAST pending prefix; repair the
     middle steps: re-scan with a simpler pass when more than one
     boundary was found. */
  if (steps.length > 1) {
    /* Rebuild cleanly: split again, this time keeping each delimiter
       attached to the following piece. */
    var parts = [];
    var re2 = /(?:\s*(?:step\s+)?\d+\s*[:.)]\s+)|(?:;\s*)|(?:\s*,\s*then\s+)|(?:\s+and\s+then\s+)|(?:\s+then\s+)|(?:\s+after\s+that\s*,?\s+)|(?:\s+phir\s+)|(?:\s+uske\s+baad\s+)|(?:\s+next\s*,?\s+)|(?:\s+secondly\s*,?\s+)|(?:\s+thirdly\s*,?\s+)|(?:\s+finally\s*,?\s+)|(?:\s+پھر\s+)|(?:\s+اس\s+کے\s+بعد\s+)|(?:\s+फिर\s+)|(?:\s+उसके\s+बाद\s+)|(?:\s*,\s*(?:and\s+)?(?=compare\b|tell\b|write\b|list\b|find\b|check\b|give\b|make\b|show\b|explain\b|create\b|build\b|send\b|prepare\b|calculate\b|analy[sz]e\b|summari[sz]e\b|describe\b|suggest\b|recommend\b|verify\b|research\b|search\b|fetch\b|draft\b|plan\b|design\b|test\b|fix\b|translate\b|convert\b|add\b|remove\b|delete\b|update\b|open\b|start\b|call\b|email\b|batao\b|bataen\b|likho\b|dikhao\b|banao\b|dhoondo\b|dhoondho\b|bhejo\b))/gi;
    var idx = 0;
    var mm;
    var cur = '';
    while ((mm = re2.exec(trimmed)) !== null) {
      var piece = inTrim(trimmed.slice(idx, mm.index));
      if (piece) parts.push(cur + piece);
      cur = inTrim(mm[0].replace(/^,/, '')) + ' ';
      if (/^[,;]\s*$/.test(mm[0])) cur = '';
      idx = mm.index + mm[0].length;
    }
    var lastPiece = inTrim(trimmed.slice(idx));
    if (lastPiece) parts.push(cur + lastPiece);
    if (parts.length > 1) return parts;
  }
  if (!steps.length) return [trimmed];
  /* Single-boundary case: the first step is steps[0], the tail
     already carries its connector. */
  return steps;
}

/* ---------- PUBLIC: extractReferences (delegate, never duplicate) ---------- */
function inCtxTopic(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  if (typeof ctx.currentTopic === 'string' && inTrim(ctx.currentTopic)) return inTrim(ctx.currentTopic);
  if (typeof ctx.topic === 'string' && inTrim(ctx.topic)) return inTrim(ctx.topic);
  if (ctx.intelState && typeof ctx.intelState === 'object') {
    var st = ctx.intelState;
    if (typeof st.currentTopic === 'string' && inTrim(st.currentTopic)) return inTrim(st.currentTopic);
    if (typeof st.topic === 'string' && inTrim(st.topic)) return inTrim(st.topic);
    if (typeof st.lastTopic === 'string' && inTrim(st.lastTopic)) return inTrim(st.lastTopic);
  }
  return '';
}
function extractReferences(text, ctx) {
  var raw = String(text == null ? '' : text);
  var topic = inCtxTopic(ctx);
  /* The conversation piece owns pronoun / demonstrative resolution.
     When it is present (assembled page, or a stub in tests) hand the
     whole job to it and return its result verbatim. */
  var conv = null;
  try {
    if (typeof EnaoConversation !== 'undefined' && EnaoConversation && typeof EnaoConversation.resolveFollowUp === 'function') {
      conv = EnaoConversation;
    }
  } catch (e) { conv = null; }
  if (conv) {
    var res = conv.resolveFollowUp(raw, ctx || {});
    return {
      resolvedText: res && typeof res.resolvedText === 'string' ? res.resolvedText : raw,
      topic: res && typeof res.topic === 'string' ? res.topic : topic,
      pronounResolved: !!(res && res.pronounResolved),
      isTopicChange: !!(res && res.isTopicChange),
      alreadyAnswered: !!(res && res.alreadyAnswered),
      source: 'EnaoConversation.resolveFollowUp'
    };
  }
  /* No conversation piece loaded: do NOT re-implement its logic.
     Return the text unchanged and the topic from ctx, so the caller
     can see nothing was resolved and fall back to asking or to the
     raw text. */
  return {
    resolvedText: raw,
    topic: topic,
    pronounResolved: false,
    isTopicChange: false,
    alreadyAnswered: false,
    source: 'fallback-no-conversation-piece'
  };
}

/* ---------- export tail (guarded) ---------- */
var EnzoUniversalInput = {
  VERSION: VERSION,
  normalizeInput: normalizeInput,
  detectLanguageDetailed: detectLanguageDetailed,
  isIncomplete: isIncomplete,
  splitMultiStep: splitMultiStep,
  extractReferences: extractReferences,
  summarizeIntentWords: summarizeIntentWords
};

if (typeof root !== 'undefined') root.EnzoUniversalInput = EnzoUniversalInput;
if (typeof module !== 'undefined' && module.exports) module.exports = EnzoUniversalInput;

})(typeof window !== 'undefined' ? window : this);
