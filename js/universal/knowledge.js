
/* ============================================================================
   ENAO AI — universal-intel PIECE D1: universal knowledge (section 7)
   File: 16-knowledge.js
   Artifact: enao-ai (web_static). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
   DO NOT EDIT ANY OTHER FILE. No backend change needed.

   PURPOSE
   -------
   Universal knowledge, research and information quality. This piece
   decides, from the request plus explicit caller flags, what state the
   knowledge for a request is in — and it never guesses. A pure function
   cannot know what the answering model knows, so "known" is only ever
   the default for a stable request with no flag saying otherwise; any
   doubt comes from an explicit flag in ctx, an explicit research order
   in the words, a time-sensitive need, or a marker in the request
   itself (an assumption marker, a private/unknowable ask). Nothing
   here names a subject: no topic list, no topic literal. The same
   rules apply to any subject.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   classifyKnowledgeState(text, ctx)
     -> { state, reason }. state is one of 'known' | 'needs-verification'
        | 'needs-research' | 'unverifiable' | 'assumption'. reason is a
        short English string. ctx flags (all optional, all explicit):
        ctx.knowledgeState (one of the five states — honoured as given),
        ctx.verified / ctx.known / ctx.unknownTopic / ctx.needsResearch /
        ctx.needsVerification / ctx.currentFact / ctx.explicitResearch /
        ctx.assumption / ctx.unverifiable / ctx.sources (array) /
        ctx.sourceCount. A request that carries an assumption marker
        ("I assume", "probably", "maybe") is an assumption, not a fact
        to verify. A private or unknowable ask (own password, mind
        reading, an exact far-future fact) is unverifiable: no search
        and no knowledge can answer it.
   evaluateSource(source)
     -> { score, verdict, reasons }. score is 0-100, built only from
        fields actually present on the source: publisher identity,
        named author, a date, original evidence, references, editorial
        standards / peer review, corroboration, primary-source status.
        A missing field adds nothing and is listed as a reason — it is
        never filled in by guessing. verdict is 'credible' (>= 70),
        'uncertain' (40-69) or 'unreliable' (< 40).
   crossCheck(claims, sources)
     -> { supported, conflicting, unsupported, detail }. claims is an
        array of strings or { id, text } objects. sources is an array
        of { id, supports: [...], contradicts: [...], originalId /
        copiedFrom / publisher / url }. A claim is supported only when
        at least TWO INDEPENDENT sources support it: copied versions
        of one original (same originalId / copiedFrom, or the same
        publisher and URL) count as ONE source, never two. A claim with
        at least one supporter and at least one contradictor is
        conflicting. Anything else is unsupported.
   honestLimitation(state, lang)
     -> one honest sentence in the user's language ('en' | 'roman' |
        'urdu'), naming what cannot be verified AND what can still be
        offered — never a fabricated fact. state may be a state string
        or { state, lang }. Returns null for 'known' (there is no
        limitation to state) and for an empty state.
   shouldResearch(text, ctx)
     -> { research, reason }. Research activates only on an explicit
        order, a current-fact need, or a flagged-unknown topic. Never
        for greetings, small talk, questions about ENZO itself, stable
        definitions, opinions, assumptions, or unknowable asks.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing piece style. Zero emojis.
   ========================================================================== */

/* ---------- small helpers ---------- */
function knTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function knIsObj(v) { return v !== null && typeof v === 'object' && !(v instanceof Array); }
function knHasUrdu(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }
function knNorm(text) {
  return ' ' + String(text || '').toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
}
function knLang(text, ctx) {
  if (ctx && (ctx.lang === 'roman' || ctx.lang === 'urdu' || ctx.lang === 'en')) return ctx.lang;
  if (ctx && (ctx.language === 'roman' || ctx.language === 'urdu' || ctx.language === 'en')) return ctx.language;
  var s = String(text || '');
  if (knHasUrdu(s)) return 'urdu';
  var words = s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  var romanWords = ['kya', 'kia', 'hai', 'hain', 'ka', 'ki', 'ke', 'mein',
    'batao', 'samjhao', 'konsa', 'kaunsa', 'kyun', 'kab', 'kaisa', 'mera',
    'mujhe', 'aap', 'yeh', 'woh', 'nahi', 'aur', 'tha', 'thi', 'kar',
    'karo', 'chahiye', 'wala', 'wali', 'aj', 'aaj', 'kal', 'bohat',
    'acha', 'theek', 'kidhar', 'kahan', 'kitne', 'tum', 'abhi', 'kis',
    'kaise', 'matlab', 'shukriya'];
  var hits = 0, i;
  for (i = 0; i < words.length; i++) {
    if (romanWords.indexOf(words[i]) > -1) hits++;
  }
  if (hits >= 2) return 'roman';
  if (hits >= 1 && words.length <= 6) return 'roman';
  return 'en';
}
function knStateOf(v) {
  var s = knTrim(v).toLowerCase();
  if (s === 'known' || s === 'needs-verification' || s === 'needs-research' ||
      s === 'unverifiable' || s === 'assumption') return s;
  return '';
}
/* A greeting / small-talk message, phrasing only, never a topic. */
function knIsGreeting(text) {
  var n = knNorm(text);
  var t = knTrim(n);
  if (!t) return false;
  if (t.split(/\s+/).length > 10) return false;
  var phrases = [' hello ', ' hi ', ' hey ', ' salam ', ' assalamualaikum ',
    ' good morning ', ' good afternoon ', ' good evening ', ' good night ',
    ' how are you ', ' kya haal hai ', ' kia haal hai ', ' kesay ho ',
    ' kaise ho ', ' thank you ', ' thanks ', ' shukriya ', ' bye ',
    ' goodbye ', ' allah hafiz ', ' khuda hafiz ', ' acha ', ' theek hai '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/سلام|کیا حال ہے|شکریہ|اللہ حافظ/.test(String(text || ''))) return true;
  return false;
}
/* A question about ENZO itself: 2nd-person forms only, so a question
   about a third party or a place does NOT match. */
function knIsAboutSelf(text) {
  var n = knNorm(text);
  var phrases = [' what are you doing ', ' how are you ', ' who are you ',
    ' kya kar rahe ho ', ' kya karte ho ', ' kaise ho ', ' kesay ho ',
    ' kahan ho ', ' kidhar ho ', ' tum kaun ho ', ' aap kaun ho ',
    ' kab start kiya ', ' kitna time lagega ', ' how long will it take '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/کیا کر رہے ہو|کیسے ہو|تم کون ہو|آپ کون ہو/.test(String(text || ''))) return true;
  return false;
}
/* An explicit research order in the words themselves. */
function knExplicitResearch(text) {
  var n = knNorm(text);
  if (/\b(research|tehqeeq)\b/.test(n)) return true;
  if (/\b(dhoond|dhund|search|talaash|talash|google)\b.{0,24}\b(kar|karo|karke|kardo|do|de|dena|batao|nikal|nikalo|chahiye)\b/.test(n)) return true;
  if (/\b(internet|online|web)\b.{0,14}\b(dhoond|search|research)\b/.test(n)) return true;
  if (/ریسرچ|تحقیق\s*(کرو|کر)|ڈھونڈ\s*(دو|کے|کر)|تلاش\s*(کرو|کر)/.test(String(text || ''))) return true;
  return false;
}
/* Needs current / time-sensitive information: latest news, prices,
   today's events, weather, scores. A bare time-of-day ask is not one. */
/* A demand to VERIFY a claim with evidence ("is it true", "show the
   evidence", "what is still uncertain") — topic-neutral, EN + Roman
   Urdu + Urdu script. A verification demand is not a stable definition:
   it needs sources, not an answer from own knowledge alone. */
function knIsVerificationDemand(text) {
  var t = String(text || '');
  return /\bis it true\b/i.test(t) || /\bis that true\b/i.test(t) ||
    /\bis this true\b/i.test(t) || /\bshow (me )?(the )?evidence\b/i.test(t) ||
    /\bprove it\b/i.test(t) || /\bverify (that|whether|if|this|the)\b/i.test(t) ||
    /\bcheck whether\b/i.test(t) || /\bconfirm whether\b/i.test(t) ||
    /\bwhat is still uncertain\b/i.test(t) || /\bis it really\b/i.test(t) ||
    /\btrue or (false|not)\b/i.test(t) ||
    /kya ye sach hai/i.test(t) || /sach hai ya nahi/i.test(t) ||
    /ye sach hai/i.test(t) || /saboot dikhao/i.test(t) ||
    /\u06a9\u06cc\u0627 \u06cc\u06c1 \u0633\u0686 \u06c1\u06d2/.test(t) ||
    /\u062b\u0628\u0648\u062a \u062f\u06a9\u06be\u0627\u0624/.test(t);
}

function knIsTimeSensitive(text) {
  var raw = String(text || '');
  if (/what (is|was) the time|time now|waqt kya hai|time kya hai/i.test(raw)) return false;
  var n = knNorm(raw);
  if (/\b(today|tonight|latest|breaking|recent|live|happening|current|news|weather|score|price|rates?|stock|updates?|this week|this month|this year)\b/.test(n)) return true;
  if (/\b(now|currently)\b/.test(n) && /\b(happening|going on|around)\b/.test(n)) return true;
  if (/\b(aaj|taza|tazaa|haliya|khabar|khabrein|khabrain|mausam|qeemat|keemat|taza tareen)\b/.test(n)) return true;
  if (/آج|تازہ|حالیہ|خبر|موسم|قیمت/.test(raw)) return true;
  return false;
}
/* Unknowable in principle: no search and no knowledge can answer it. */
function knUnknowableKind(text) {
  var raw = String(text || '');
  var n = knNorm(raw);
  if (/what am i thinking|read my mind|mere dimagh mein kya|mere zehen mein kya|what is in my mind|میں کیا سوچ رہا|میرے دماغ میں کیا/.test(n + ' ' + raw)) return 'mind';
  if (/my password|mera password|what is my (cnic|phone|account|bank).{0,16}number|mera cnic|my pin|mera pin|mera account number|میرا پاس ورڈ/.test(n + ' ' + raw)) return 'secret';
  if (/\bexact\b.{0,32}\b(price|date|day|score|number|time)\b/.test(n) &&
      /\b(203\d|204\d|205\d|next year|agle saal|future|mustaqbil)\b/.test(n)) return 'future-exact';
  if (/\bwhat will\b.{0,40}\b(exactly|exact)\b/.test(n)) return 'future-exact';
  if (/\b(lottery|lotto)\b.{0,24}\b(number|numbers|win|jeet)\b/.test(n)) return 'future-exact';
  return null;
}
/* Assumption markers in the request itself: the user is stating a
   guess, not asking for a checked fact. */
function knIsAssumption(text) {
  var n = knNorm(text);
  var phrases = [' i assume ', ' assuming ', ' i guess ', ' i suppose ',
    ' probably ', ' maybe ', ' perhaps ', ' i think ', ' mujhe lagta hai ',
    ' shayad ', ' lagta hai '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/شاید|لگتا ہے/.test(String(text || ''))) return true;
  return false;
}
/* A stable definition or an opinion: answered from own knowledge,
   never a research trigger. */
function knIsDefinitionOrOpinion(text) {
  var n = knNorm(text);
  var phrases = [' what is ', ' what are ', ' what does ', ' meaning of ',
    ' define ', ' kya hai ', ' kia hai ', ' kya hota hai ', ' matlab kya ',
    ' what do you think ', ' in your opinion ', ' do you like ',
    ' which is better ', ' tumhara kya khayal ', ' aap ka kya khayal '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/کا مطلب کیا|کیا ہوتا ہے|آپ کی رائے|تمہارا کیا خیال/.test(String(text || ''))) return true;
  return false;
}
function knCtxFlag(ctx, name) {
  if (!ctx) return false;
  if (ctx[name] === true) return true;
  if (ctx.intelState && ctx.intelState[name] === true) return true;
  return false;
}

/* ---------- PUBLIC: classifyKnowledgeState ---------- */
function classifyKnowledgeState(text, ctx) {
  var raw = String(text == null ? '' : text);
  if (!knTrim(raw)) {
    return { state: 'unverifiable', reason: 'empty request — there is nothing to check' };
  }
  /* 1. An explicit state handed in by the caller wins: the caller
     (classifier, research pipeline, assembler) decided it, this piece
     only reports it. */
  if (ctx) {
    var given = knStateOf(ctx.knowledgeState || ctx.state || '');
    if (given) return { state: given, reason: 'state supplied by the caller' };
    if (ctx.intelState) {
      given = knStateOf(ctx.intelState.knowledgeState || ctx.intelState.state || '');
      if (given) return { state: given, reason: 'state supplied by the caller' };
    }
  }
  /* 2. Unknowable in principle beats everything else: no source can
     settle a private detail, a thought, or an exact far-future fact. */
  if (knCtxFlag(ctx, 'unverifiable') || knUnknowableKind(raw)) {
    return { state: 'unverifiable', reason: 'cannot be verified by any source — private or unknowable in principle' };
  }
  /* 3. An assumption is a guess, not a fact to check. */
  if (knCtxFlag(ctx, 'assumption') || knIsAssumption(raw)) {
    return { state: 'assumption', reason: 'the request states a guess or assumption, not a fact to verify' };
  }
  /* 4. A verified claim stays known: at least two independent sources
     already checked it, or the caller flagged it verified. */
  if (knCtxFlag(ctx, 'verified')) {
    return { state: 'known', reason: 'already verified by the caller' };
  }
  if (ctx && ctx.sources instanceof Array && ctx.sources.length >= 2) {
    return { state: 'known', reason: 'supported by two or more sources supplied by the caller' };
  }
  if (ctx && typeof ctx.sourceCount === 'number' && ctx.sourceCount >= 2) {
    return { state: 'known', reason: 'supported by two or more sources supplied by the caller' };
  }
  /* 5. A current fact that has not been verified needs verification,
     not a fresh research run. */
  if (knCtxFlag(ctx, 'needsVerification') || knCtxFlag(ctx, 'currentFact') ||
      knIsTimeSensitive(raw)) {
    return { state: 'needs-verification', reason: 'current or time-sensitive detail that has not been verified yet' };
  }
  /* 5b. An explicit demand to verify a claim with evidence needs
     verification even when the topic itself is stable. */
  if (knIsVerificationDemand(raw)) {
    return { state: 'needs-verification', reason: 'user asks to verify a claim with evidence' };
  }
  /* 6. Genuinely outside own knowledge, or an explicit research order:
     needs research. The unknown flag comes only from the caller — a
     pure function never guesses a topic list. */
  if (knCtxFlag(ctx, 'unknownTopic') || knCtxFlag(ctx, 'needsResearch') ||
      knCtxFlag(ctx, 'explicitResearch') || knExplicitResearch(raw)) {
    return { state: 'needs-research', reason: 'topic flagged outside own knowledge, or research explicitly ordered' };
  }
  if (ctx && ctx.known === false) {
    return { state: 'needs-research', reason: 'topic flagged outside own knowledge' };
  }
  /* 7. Default: a stable request with no flag saying otherwise is
     answerable from own knowledge. This is the absence of a doubt
     signal, not a claim about any particular subject. */
  return { state: 'known', reason: 'stable request with no verification or research flag' };
}

/* ---------- PUBLIC: evaluateSource ---------- */
function evaluateSource(source) {
  if (!knIsObj(source)) {
    return { score: 0, verdict: 'unreliable', reasons: ['no source supplied'] };
  }
  var score = 0;
  var reasons = [];
  var publisher = knTrim(source.publisher || source.publisherName || source.site || '');
  var author = knTrim(source.author || source.authorName || '');
  var date = knTrim(source.date || source.publishedAt || source.published || source.checked_at || '');
  var url = knTrim(source.url || source.source_url || '');
  var hasRefs = source.hasReferences === true ||
    (source.references instanceof Array && source.references.length > 0) ||
    (typeof source.referenceCount === 'number' && source.referenceCount > 0);
  var hasEvidence = source.originalEvidence === true || source.hasOriginalEvidence === true ||
    source.citesOriginal === true || source.isPrimary === true || source.primarySource === true;
  var hasStandards = source.editorialStandards === true || source.peerReviewed === true ||
    source.hasEditorialPolicy === true || source.factChecked === true;
  var corroboration = 0;
  if (typeof source.corroborationCount === 'number') corroboration = source.corroborationCount;
  else if (source.corroborated === true) corroboration = 1;
  else if (source.corroboratingSources instanceof Array) corroboration = source.corroboratingSources.length;

  if (publisher) { score += 15; reasons.push('publisher identified: ' + publisher); }
  else { reasons.push('no publisher identified'); }
  if (author) { score += 10; reasons.push('named author: ' + author); }
  else { reasons.push('no named author'); }
  if (date) { score += 10; reasons.push('dated: ' + date); }
  else { reasons.push('no date given'); }
  if (url) { score += 5; reasons.push('source address given'); }
  else { reasons.push('no source address given'); }
  if (hasEvidence) { score += 15; reasons.push('cites original evidence or is a primary source'); }
  else { reasons.push('no original evidence cited'); }
  if (hasRefs) { score += 10; reasons.push('references listed'); }
  else { reasons.push('no references listed'); }
  if (hasStandards) { score += 15; reasons.push('editorial standards or peer review stated'); }
  else { reasons.push('no editorial standards stated'); }
  if (corroboration >= 2) { score += 15; reasons.push('corroborated by ' + corroboration + ' independent sources'); }
  else if (corroboration === 1) { score += 7; reasons.push('corroborated by 1 other source'); }
  else { reasons.push('no corroboration reported'); }
  if (source.isPrimary === true || source.primarySource === true) { score += 5; reasons.push('primary source'); }
  if (score > 100) score = 100;
  var verdict = score >= 70 ? 'credible' : (score >= 40 ? 'uncertain' : 'unreliable');
  return { score: score, verdict: verdict, reasons: reasons };
}

/* ---------- cross-check helpers ---------- */
function knClaimId(claim) {
  if (typeof claim === 'string') return knTrim(claim);
  if (knIsObj(claim)) return knTrim(claim.id || claim.text || claim.claim || '');
  return '';
}
function knClaimText(claim) {
  if (typeof claim === 'string') return knTrim(claim);
  if (knIsObj(claim)) return knTrim(claim.text || claim.claim || claim.id || '');
  return '';
}
function knNormKey(s) {
  return knTrim(s).toLowerCase().replace(/\s+/g, ' ');
}
/* Two sources are independent only when they are not copies of one
   original: the same originalId / copiedFrom, or the same publisher
   together with the same URL, is one source, never two. A missing
   original marker does not prove independence — two sources with no
   shared marker and different publishers/URLs count as independent. */
function knSourceGroup(src) {
  if (!knIsObj(src)) return 'unknown';
  var orig = knTrim(src.originalId || src.originalSourceId || src.copiedFrom || src.copied_from || '');
  if (orig) return 'orig:' + knNormKey(orig);
  var pub = knNormKey(src.publisher || src.site || '');
  var url = knNormKey(src.url || src.source_url || '');
  if (pub && url) return 'pub-url:' + pub + '|' + url;
  if (url) return 'url:' + url;
  if (pub) return 'pub:' + pub;
  return 'id:' + knNormKey(src.id || '');
}
function knListMatches(list, claimId, claimText) {
  var out = false;
  var i;
  if (!(list instanceof Array)) return false;
  var idKey = knNormKey(claimId);
  var textKey = knNormKey(claimText);
  for (i = 0; i < list.length; i++) {
    var item = list[i];
    var key = knNormKey(typeof item === 'string' ? item : (knIsObj(item) ? (item.id || item.text || '') : String(item)));
    if (key && (key === idKey || (textKey && key === textKey))) { out = true; break; }
  }
  return out;
}

/* ---------- PUBLIC: crossCheck ---------- */
function crossCheck(claims, sources) {
  var result = { supported: [], conflicting: [], unsupported: [], detail: {} };
  if (!(claims instanceof Array)) return result;
  if (!(sources instanceof Array)) sources = [];
  var i, j;
  for (i = 0; i < claims.length; i++) {
    var claim = claims[i];
    var id = knClaimId(claim);
    var text = knClaimText(claim);
    if (!id && !text) continue;
    var key = id || text;
    var groups = {};
    var groupList = [];
    var supporting = [];
    var contradicting = [];
    for (j = 0; j < sources.length; j++) {
      var src = sources[j];
      if (!knIsObj(src)) continue;
      var supports = knListMatches(src.supports || src.claims || src.supportedClaims, id, text);
      var contradicts = knListMatches(src.contradicts || src.contradictedClaims, id, text);
      if (supports) {
        supporting.push(knTrim(src.id || src.url || ('source-' + j)));
        var g = knSourceGroup(src);
        if (!groups[g]) { groups[g] = 1; groupList.push(g); }
      }
      if (contradicts) {
        contradicting.push(knTrim(src.id || src.url || ('source-' + j)));
      }
    }
    var status;
    if (supporting.length && contradicting.length) status = 'conflicting';
    else if (groupList.length >= 2) status = 'supported';
    else status = 'unsupported';
    result.detail[key] = {
      supportingIndependent: groupList.length,
      supportingSources: supporting,
      contradictingSources: contradicting,
      status: status
    };
    if (status === 'supported') result.supported.push(key);
    else if (status === 'conflicting') result.conflicting.push(key);
    else result.unsupported.push(key);
  }
  return result;
}

/* ---------- PUBLIC: honestLimitation ---------- */
var KN_LIMITATIONS = {
  'needs-verification': {
    en: 'I cannot verify that detail yet, but I can check a reliable source for it if you would like.',
    roman: 'Ye detail main abhi verify nahi kar sakta, lekin aap chahein to main kisi reliable source se check karke bata sakta hoon.',
    urdu: 'یہ تفصیل میں ابھی تصدیق نہیں کر سکتا، لیکن آپ چاہیں تو میں کسی قابل اعتماد ذریعے سے جانچ کر بتا سکتا ہوں۔'
  },
  'needs-research': {
    en: 'I do not have reliable information on that yet, but I can research it properly and come back with sources if you would like.',
    roman: 'Is par mere paas abhi reliable maloomat nahi hai, lekin aap chahein to main is par proper research karke sources ke saath wapas aa sakta hoon.',
    urdu: 'اس پر میرے پاس ابھی قابل اعتماد معلومات نہیں ہیں، لیکن آپ چاہیں تو میں اس پر مکمل تحقیق کر کے ذرائع کے ساتھ واپس آ سکتا ہوں۔'
  },
  unverifiable: {
    en: 'That cannot be verified from any source I can reach, but I can help with the closest thing I can actually do if you would like.',
    roman: 'Ye kisi bhi source se verify nahi ho sakta jis tak meri rasai hai, lekin aap chahein to main us ke qareeb tareen kaam mein madad kar sakta hoon jo main asal mein kar sakta hoon.',
    urdu: 'یہ کسی بھی ایسے ذریعے سے تصدیق نہیں ہو سکتا جس تک میری رسائی ہے، لیکن آپ چاہیں تو میں اس سے قریب ترین کام میں مدد کر سکتا ہوں جو میں واقعی کر سکتا ہوں۔'
  },
  assumption: {
    en: 'That is a guess rather than a checked fact, so I will not present it as certain, but I can check what is actually known about it if you would like.',
    roman: 'Ye aik andaza hai, checked fact nahi, is liye main ise yaqeeni tor par pesh nahi karunga, lekin aap chahein to main check kar sakta hoon ke is bare mein asal mein kya maloom hai.',
    urdu: 'یہ ایک اندازہ ہے، جانچا ہوا حق نہیں، اس لیے میں اسے یقینی طور پر پیش نہیں کروں گا، لیکن آپ چاہیں تو میں جانچ سکتا ہوں کہ اس بارے میں اصل میں کیا معلوم ہے۔'
  }
};
function honestLimitation(state, lang) {
  var st = '';
  var lg = 'en';
  if (typeof state === 'string') st = knStateOf(state);
  else if (knIsObj(state)) {
    st = knStateOf(state.state || state.knowledgeState || '');
    lg = knLang('', state);
  }
  if (typeof lang === 'string' && (lang === 'roman' || lang === 'urdu' || lang === 'en')) lg = lang;
  if (!st || st === 'known') return null;
  var table = KN_LIMITATIONS[st];
  if (!table) return null;
  return table[lg] || table.en;
}

/* ---------- PUBLIC: shouldResearch ---------- */
function shouldResearch(text, ctx) {
  var raw = String(text == null ? '' : text);
  if (!knTrim(raw)) {
    return { research: false, reason: 'empty message — nothing to research' };
  }
  if (knIsGreeting(raw)) {
    return { research: false, reason: 'greeting or small talk — no research needed' };
  }
  if (knIsAboutSelf(raw)) {
    return { research: false, reason: 'question about ENZO itself — answered from own state' };
  }
  if (knUnknowableKind(raw) || knCtxFlag(ctx, 'unverifiable')) {
    return { research: false, reason: 'cannot be answered by research — private or unknowable' };
  }
  if (knCtxFlag(ctx, 'assumption') || knIsAssumption(raw)) {
    return { research: false, reason: 'an assumption, not a fact to research' };
  }
  if (knCtxFlag(ctx, 'explicitResearch') || knCtxFlag(ctx, 'needsResearch') || knExplicitResearch(raw)) {
    return { research: true, reason: 'user asked for research' };
  }
  if (knCtxFlag(ctx, 'currentFact') || knCtxFlag(ctx, 'needsVerification') || knIsTimeSensitive(raw)) {
    return { research: true, reason: 'needs current information' };
  }
  if (knCtxFlag(ctx, 'unknownTopic')) {
    return { research: true, reason: 'topic is outside own knowledge' };
  }
  if (ctx && ctx.known === false) {
    return { research: true, reason: 'topic is outside own knowledge' };
  }
  if (knIsVerificationDemand(raw)) {
    return { research: true, reason: 'user asks to verify a claim with evidence' };
  }
  if (knIsDefinitionOrOpinion(raw)) {
    return { research: false, reason: 'stable definition or opinion — answer from own knowledge' };
  }
  return { research: false, reason: 'stable request — answer from own knowledge' };
}

/* ---------- export tail (guarded) ---------- */
var VERSION = '16-knowledge v1.0 (enao-universal-intel, 22 Nov 2026)';

var EnzoUniversalKnowledge = {
  VERSION: VERSION,
  classifyKnowledgeState: classifyKnowledgeState,
  evaluateSource: evaluateSource,
  crossCheck: crossCheck,
  honestLimitation: honestLimitation,
  shouldResearch: shouldResearch
};

(function (root) {
  if (typeof root !== 'undefined') root.EnzoUniversalKnowledge = EnzoUniversalKnowledge;
  if (typeof module !== 'undefined' && module.exports) module.exports = EnzoUniversalKnowledge;
})(typeof window !== 'undefined' ? window : this);
