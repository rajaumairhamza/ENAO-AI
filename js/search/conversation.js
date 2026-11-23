
/* ============================================================================
   ENAO AI — master-intel PIECE P2: conversation intelligence
   File: 02-conversation.js
   Artifact: enao-ai (web_static). Builds on live v53/v54.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. DO NOT EDIT ANY OTHER FILE.

   PURPOSE
   -------
   Master instruction (from Raja, 22 Nov 2026): natural, continuous
   conversation. ENZO must understand context, answer follow-ups, never
   repeat a question already answered in this chat, and always attempt a
   useful answer instead of a dead-end. This piece handles everything
   about ANSWERING normal conversation. It consumes the classification
   from sibling piece P1 (01-intent.js: classifyIntent / createIntelState /
   updateIntelState) plus the chat history, and it works standalone when
   P1 has not merged yet — every P1 input arrives through ctx and is
   optional (see "ctx" notes below).

   TOPIC-NEUTRAL BY DESIGN. Nothing in this file names a subject, a
   style, or one example. Topics are extracted from the user's own words
   (content words minus stopwords) and from the chat history; the same
   pronoun, follow-up, search and uncertainty rules apply to any subject.

   MASTER RULES ENFORCED HERE (in behaviour, not just in comments)
   ----------------------------------------------------------------
   1. Always attempt a useful answer. Own knowledge + reasoning first;
      search only when the answer genuinely needs it (see shouldSearch).
   2. Never fabricate sources, counts, or facts. This file invents no
      facts at all: it resolves, routes and frames — the answering model
      (callAIKnowledge / answerWithSources / backend /ask) supplies facts.
   3. Never echo the user's question back, and never repeat a question
      already answered in this chat (resolveFollowUp.alreadyAnswered /
      isRepeatQuestion). The assembler answers a repeat with a short
      pointer to the earlier answer, not a second full answer.
   4. Explain uncertainty honestly (honestUncertainty): one short
      sentence, in the user's language, naming what is unknown AND what
      can still be offered. Never a bare dead-end, never a fabricated
      answer to cover the gap.
   5. Ask a relevant follow-up ONLY when it genuinely helps the
      conversation (suggestFollowUp: broad openers only — never after a
      greeting, never after a precise factual question, never twice for
      the same question).
   6. Tone follows the conversation: buildAnswerContext reports the
      dominant language of the history so the answer matches it.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   detectLanguage(text)
     'roman' | 'urdu' | 'en'. Same approach as v54: Urdu script -> urdu,
     Roman Urdu markers -> roman, anything else -> en.

   resolveFollowUp(text, ctx)
     -> {resolvedText, topic, isTopicChange, pronounResolved,
         alreadyAnswered}
     ctx = {currentTopic, history:[{role, text}...], intelState}.
     currentTopic may also arrive as ctx.topic or
     ctx.intelState.currentTopic / .topic / .lastTopic. history may also
     arrive as ctx.messages, or as bare strings. When ctx is missing the
     topic is taken from the text alone. Pronouns and ellipses are
     resolved from history ("Who created it?" after an explanation ->
     resolvedText names the topic, topic unchanged). A brand-new topic
     ("Let's discuss electric cars" after another subject) ->
     isTopicChange true, topic switches, old research context is dropped
     by the assembler (conversational memory — the history itself — is
     kept). Works in English, Roman Urdu and Urdu script.

   shouldSearch(text, ctx)
     -> {search:boolean, reason}. reason is a short English string for
     the modeWhy line. Search ONLY when the question needs current /
     time-sensitive information (latest news, prices, today's events),
     when the user explicitly ordered research, or when the topic is
     flagged as genuinely outside own knowledge (ctx.unknownTopic, or
     ctx.intelState.unknownTopic / .known === false — an explicit flag
     from the caller, never a guessed topic list). NEVER search for
     greetings, small talk, questions about ENZO itself, definitions of
     stable concepts, opinions, or follow-ups answerable from context.

   honestUncertainty(text, ctx)
     -> string | null. One short honest sentence in the user's language
     when the assistant genuinely does not know something (an
     unknowable-in-principle question, or a topic flagged unknown):
     states what is unknown AND what it can still offer (search, or
     the closest supported help). Never a bare dead-end, never a
     fabricated fact. Returns null when the question is answerable.

   buildAnswerContext(text, history)
     -> {resolvedQuestion, topic, contextSummary, tone}. A compact pack
     for the answering model: the resolved question, the current topic,
     and a short summary of the relevant prior turns (max 6 turns, most
     recent first). history may be an array or a ctx object with
     .history / .messages. tone is the dominant language of the history
     ('roman' | 'urdu' | 'en').

   shortAnswer(text, lang)
     -> string | null. The narrow "conversation about ENZO itself"
     kinds are owned by the v54 piece (conversationReply). This piece
     MUST NOT duplicate those replies: shortAnswer only delegates to
     conversationReply when that function exists in the assembled page
     and the text is an ENZO-self question; otherwise it returns null
     so the caller falls through to the normal answering path.

   isRepeatQuestion(text, ctx) -> boolean.
     True when the same resolved question was already asked AND
     answered (an ai turn follows it) earlier in this chat. Same
     question in another language counts as the same question
     ("What is X?" vs "X kya hai?"). The current message itself never
     counts. Greetings never count.

   suggestFollowUp(text, ctx) -> string | null.
     One relevant follow-up question in the user's language, or null.
     Only for broad openers ("Tell me about X", "Explain X").

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing v53/v54 file style. Zero emojis.

   ============================================================================
   WIRING NOTES FOR THE ASSEMBLER — READ BEFORE MERGING INTO enao-ai.html
   ============================================================================
   The piece exposes one namespace: window.EnaoConversation (browser) /
   module.exports (Node). In the artifact call it as e.g.
   EnaoConversation.resolveFollowUp(text, cvCtx). It needs NO P1 merge:
   pass intelState only when P1 has landed; until then pass
   {history: chat.messages} and the topic comes from the history.

   1. WHERE — legacy askQuestion() (~line 4224 in the export), AFTER the
      smallTalkReply gate and AFTER the v54 conversation gate
      (classifyVoiceResearch === 'conversation' -> conversationReply),
      BEFORE EnzoMonitor.start():
        var cvCtx = { history: chat.messages,
                      intelState: (typeof intelState === 'object' ? intelState : null) };
        var cvFollow = EnaoConversation.resolveFollowUp(text, cvCtx);
        var cvSearch = EnaoConversation.shouldSearch(cvFollow.resolvedText, cvCtx);
        var cvAnswer = EnaoConversation.buildAnswerContext(text, chat.messages);
      chat.messages already holds the current user message (pushed at the
      top of askQuestion); resolveFollowUp and buildAnswerContext both
      ignore that last turn when deriving the topic / summary, so pass
      chat.messages as-is.

   2. ALREADY ANSWERED — right after step 1, before any search:
        if (cvFollow.alreadyAnswered) {
          push an ai message (same shape as the smallTalkReply block:
          sources: [], deep: false, auto: false,
          modeWhy: 'Already answered above in this chat — pointing back
          instead of repeating the answer'), maybeSpeak it when the
          question came by voice, and return. Never run the search
          pipeline for a repeat.

   3. SEARCH ROUTE — in the Auto branch, next to the existing overrides:
        var det = detectIntent(text);
        if (cvSearch.search && !det.deep)
          det = { deep: true, reason: cvSearch.reason };
      shouldSearch is a ONE-WAY force toward search: true forces Deep,
      false never overrides an existing Deep decision (an explicit
      research order from P1 / the v54 gate still wins). Do NOT use it
      to force Normal.

   4. RESOLVED QUESTION INTO THE PIPELINE — pass the resolved question,
      not the raw pronoun, into the model/search calls, and use the
      context pack instead of the hand-built historyText:
        var historyText = cvAnswer.contextSummary
          || '(No previous conversation.)';
        var searchText = cvAnswer.resolvedQuestion + fileCtx;
        ... searchWeb(cvAnswer.resolvedQuestion, deep) ...
        ... answerWithSources(cvAnswer.resolvedQuestion, ...) ...
        ... callAIKnowledge(cvAnswer.resolvedQuestion, lang, deep, historyText) ...
      The stored user message keeps the ORIGINAL text; only the
      pipeline input is resolved. buildAnswerContext already caps the
      summary at 6 turns, most recent first.

   5. HONEST UNCERTAINTY — never a dead-end, never a bare clarifying
      question when there is nothing to clarify. In the .then handler,
      where clarifyText is built (liveCount < 2), and in the .catch
      fallback where fallbackAnswer(text, ...) may come back empty:
        var cvUncertain = EnaoConversation.honestUncertainty(text, cvCtx);
        if (cvUncertain) deliver cvUncertain as the ai message
          (sources: [], deep: false,
           modeWhy: 'Honest uncertainty — no answer available, offered
           the next step') INSTEAD of the clarify question / error-only
          reply. When it returns null the existing clarify / retry flow
          runs unchanged.

   6. SHORT ANSWER — safety net only, right after the v54 conversation
      block:
        var cvShort = EnaoConversation.shortAnswer(text, lang);
        if (cvShort) { ...push it like the smallTalkReply block and return; }
      In practice this returns null: ENZO-self kinds are already handled
      by conversationReply above. Never call it for general/definition
      questions.

   7. FOLLOW-UP — after a successful answer is delivered, ONE optional
      follow-up, only when it genuinely helps:
        var cvFollowUp = EnaoConversation.suggestFollowUp(text, cvCtx);
        if (cvFollowUp) msg.followups = (msg.followups || []).concat([cvFollowUp]);
      (msg.followups is otherwise built by makeFollowups(text, lang).)
      Never add a follow-up after a greeting, a repeat, or an
      uncertainty reply.

   8. BACKEND PATH — computeRoute(text, chat, forcedDeep) (~line 12679):
      insert after the vrGate2 'research' check:
        var cvFollowB = EnaoConversation.resolveFollowUp(text, { history: chat.messages });
        var cvSearchB = EnaoConversation.shouldSearch(cvFollowB.resolvedText, { history: chat.messages });
        if (cvSearchB.search)
          return { deep: true, auto: true,
                   label: 'Deep Research (' + cvSearchB.reason + ')' };
      And in backendAsk(), pass the resolved question to the backend:
        v2post('/chats/' + bid + '/ask',
               { question: cvFollowB.resolvedText, ... })
      instead of question: text. When handleAskResp(ctx, resp) or
      fallbackLegacy(ctx) finds no answer text, call
      honestUncertainty(ctx.text, { history: ctx.chat.messages }) and
      deliver its line through deliverAnswer(ctx, line, [], 'normal',
      null) instead of an empty answer.

   9. TOPIC CHANGE — when cvFollow.isTopicChange is true the assembler
      drops the old research context (do not reuse the previous deep
      sources / monitor task for the new question). Conversational
      memory is NOT dropped: chat.messages stays whole, and
      buildAnswerContext still summarises the prior turns.
   ========================================================================== */

(function (root) {

var VERSION = '02-conversation v1.0 (enao-master-intel, 22 Nov 2026)';

/* ---------- small helpers ---------- */
function cvTrim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '');
}
function cvHasUrdu(s) {
  return /[\u0600-\u06FF]/.test(String(s || ''));
}
/* Lower-case, strip punctuation, collapse spaces, fold common spelling
   variants onto one form so one pattern covers many phrasings. Folds
   SPELLINGS only — it never maps one topic onto another. */
function cvNorm(text) {
  var s = ' ' + String(text || '').toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
  s = s.replace(/\bkia\b/g, ' kya ');
  s = s.replace(/\bha\b/g, ' hai ');
  s = s.replace(/\bhen\b/g, ' hain ');
  s = s.replace(/\brahay\b/g, ' rahe ');
  s = s.replace(/\brahy\b/g, ' rahe ');
  s = s.replace(/\bkidher\b/g, ' kidhar ');
  s = s.replace(/\bkonsa\b/g, ' kaunsa ');
  s = s.replace(/\bkesay\b/g, ' kaise ');
  s = s.replace(/\bkese\b/g, ' kaise ');
  s = s.replace(/\bdhoondh\b/g, ' dhoond ');
  s = s.replace(/\bdhund\b/g, ' dhoond ');
  return s.replace(/\s+/g, ' ');
}
function cvWordCount(s) {
  var t = cvTrim(s);
  return t ? t.split(/\s+/).length : 0;
}
function cvClip(s, max) {
  var t = cvTrim(s);
  if (t.length <= max) return t;
  var cut = t.slice(0, max);
  var sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut + '...';
}
function cvEndsWith(s, tail) {
  return String(s).slice(-tail.length) === tail;
}

/* ---------- PUBLIC: language detection ---------- */
/* Same approach as v54: Urdu script -> urdu, Roman Urdu markers -> roman,
   anything else -> en. The Roman marker list is the v53 detectLang list
   plus the extra markers v54 uses; the English-word guard is v53's. */
function detectLanguage(text) {
  var s = String(text || '');
  if (cvHasUrdu(s)) return 'urdu';
  var romanWords = ['kya', 'kia', 'hai', 'hain', 'ka', 'ki', 'ke', 'mein',
    'batao', 'samjhao', 'konsa', 'kaunsa', 'kyun', 'kab', 'kaisa', 'mera',
    'mujhe', 'aap', 'yeh', 'woh', 'nahi', 'aur', 'par', 'se', 'ko', 'bhi',
    'tha', 'thi', 'kar', 'karo', 'chahiye', 'wala', 'wali', 'aj', 'aaj',
    'kal', 'bohat', 'acha', 'theek', 'rahe', 'ho', 'kidhar', 'kahan',
    'kitne', 'tum', 'abhi', 'kis', 'kaise', 'kesay', 'kese', 'faide',
    'nuqsanat', 'banaya', 'sunao', 'shukriya', 'pehle', 'chalo', 'matlab',
    'kehte'];
  var words = s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  var hits = 0;
  var i;
  for (i = 0; i < words.length; i++) {
    if (romanWords.indexOf(words[i]) > -1) hits++;
  }
  if (hits >= 2 || (hits >= 1 && words.length <= 6 && /[aeiou]/.test(s))) {
    var enWords = ['what', 'is', 'the', 'how', 'why', 'when', 'best',
      'explain', 'tell', 'about', 'please', 'give', 'show'];
    var enHits = 0;
    for (i = 0; i < words.length; i++) {
      if (enWords.indexOf(words[i]) > -1) enHits++;
    }
    if (enHits > hits) return 'en';
    return 'roman';
  }
  return 'en';
}

/* ---------- stopwords: what is NOT a topic ---------- */
/* Question words, verbs, fillers and function words in all three
   languages. A topic is whatever content words are left after these are
   removed — so the extractor never needs a list of subjects. */
function cvStopTable(list) {
  var t = {};
  var i;
  for (i = 0; i < list.length; i++) t[list[i]] = 1;
  return t;
}
var CV_STOP_EN = cvStopTable(('what is are was were who whom whose when where why how which ' +
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
var CV_STOP_ROMAN = cvStopTable(('kya kia hai ha hain hen ka ki ke ko se mein me par pe ' +
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
var CV_STOP_URDU = cvStopTable(('کیا ہے ہیں کا کی کے کو سے میں پر بتاؤ بتائیں سمجھاؤ کونسا ' +
  'کیوں کب کیسا میرا مجھے آپ یہ وہ نہیں اور تھا تھی کر کرو چاہیے والا والی ' +
  'آج کل بہت اچھا ٹھیک رہے ہو اس کس نے بنایا مطلب کہتے پہلے اب چلو بات چیز ' +
  'ہوتا ہوتی سناؤ شکریہ نہ ہی تو پھر بھی یا جو جس جن رہا رہی گا گی ہوں کتنے ' +
  'کتنا کہاں کدھر کون ایسا ایسے تھوڑا زیادہ کرنا کرنے جانا آنا دینا لینا ملنا ' +
  'ہوگا ہوگی گیا گئی گئے آیا آئی آئے').split(' '));
/* Aspect / filler words: real words, but they describe a SIDE of a topic
   ("its disadvantages", "the history of X", "in simple words") rather
   than naming a topic. Excluded from topic extraction only. */
var CV_ASPECT = cvStopTable(('advantages disadvantages benefits drawbacks pros cons ' +
  'features history meaning definition price prices founder creator inventor ' +
  'faide fayde fayda nuqsanat nuqsan tareekh qeemat keemat simple words ' +
  'detail detailed easy briefly short quick فائدے نقصانات تاریخ مطلب قیمت').split(' '));

/* Content words: tokens left after stopwords. Kept in order. */
function cvContentWords(text) {
  var tokens = cvNorm(text).replace(/^\s+|\s+$/g, '').split(/\s+/);
  var out = [];
  var i;
  for (i = 0; i < tokens.length; i++) {
    var w = tokens[i];
    if (!w) continue;
    if (CV_STOP_EN[w] || CV_STOP_ROMAN[w] || CV_STOP_URDU[w]) continue;
    out.push(w);
  }
  return out;
}
/* The topic named by a message: content words minus aspect/filler words
   and numbers, first four, joined. Lower-case normalised label. '' when
   the message names no topic (a pure follow-up: "What are its
   disadvantages?" / "is ke nuqsanat kya hain?"). */
function cvExtractTopic(text) {
  var words = cvContentWords(text);
  var out = [];
  var i;
  for (i = 0; i < words.length && out.length < 4; i++) {
    var w = words[i];
    if (CV_ASPECT[w]) continue;
    if (/^\d+$/.test(w)) continue;
    if (w.length < 2 && w !== 'ai') continue;
    out.push(w);
  }
  return out.join(' ');
}
function cvStem(w) {
  w = String(w || '');
  if (w.length > 3 && w.slice(-1) === 's') return w.slice(0, -1);
  return w;
}
function cvTopicsShare(a, b) {
  var aw = String(a || '').split(/\s+/);
  var bw = String(b || '').split(/\s+/);
  var i, j;
  for (i = 0; i < aw.length; i++) {
    for (j = 0; j < bw.length; j++) {
      if (aw[i] && cvStem(aw[i]) === cvStem(bw[j])) return true;
    }
  }
  return false;
}

/* ---------- question-kind checks (phrasing only, never a topic) ---------- */
var CV_GREET = ['assalamualaikum warahmatullahi wabarakatuh',
  'assalam o alaikum', 'assalamualaikum', 'salam alaikum', 'salam', 'aoa',
  'good morning', 'good afternoon', 'good evening', 'hi there',
  'hello there', 'hey there', 'hi enzo', 'hello enzo', 'hey enzo', 'hi',
  'hello', 'hey', 'namaste', 'hola', 'how are you', 'how are u',
  'how r u', 'how is it going', "how's it going", 'whats up', "what's up",
  'sup', 'kya haal hai', 'kia haal hai', 'kya hal hai', 'kia hal hai',
  'kesay ho', 'kese ho', 'kaise ho', 'aap kesay ho', 'aap kaise ho',
  'tum kesay ho', 'kya ho raha hai', 'aur sunao', 'kya haal chaal',
  'thank you so much', 'thanks a lot', 'thank you', 'thanks', 'shukriya',
  'bohat shukriya', 'bahut shukriya', 'mehrbani', 'good night',
  'allah hafiz', 'khuda hafiz', 'bye bye', 'goodbye', 'bye',
  'see you later', 'see you', 'take care', 'okay', 'ok', 'acha', 'achha',
  'theek hai', 'thik hai', 'theek', 'han', 'haan', 'ji', 'great', 'nice',
  'awesome', 'cool', 'perfect', 'very good', 'good',
  'السلام علیکم', 'سلام', 'کیا حال ہے', 'کیا حال ہیں', 'آپ کیسے ہیں',
  'کیسے ہو', 'شکریہ', 'بہت شکریہ', 'اللہ حافظ', 'خدا حافظ'];
var CV_FILL = { raja: 1, enzo: 1, bhai: 1, yaar: 1, dost: 1, sir: 1,
  janab: 1, aap: 1, tum: 1, sab: 1, aur: 1, and: 1, ke: 1, ka: 1, ki: 1 };
/* Whole-message greeting, same consumption approach as v53
   comboSmallTalkCat: the message is consumed phrase by phrase (longest
   first); only when every word belongs to a greeting phrase or a polite
   filler does it count, so a real question that merely opens with
   "hello" still goes through the normal pipeline. */
function cvIsGreeting(text) {
  var core = String(text || '').toLowerCase()
    .replace(/[.!?,~…:;\"()«»؟۔،؛]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!core || core.length > 80) return false;
  var words = core.split(/\s+/);
  if (words.length > 12) return false;
  var list = [];
  var i, j, k;
  for (i = 0; i < CV_GREET.length; i++) {
    list.push({ w: CV_GREET[i].split(' ') });
  }
  list.sort(function (a, b) { return b.w.length - a.w.length; });
  i = 0;
  var parts = 0;
  while (i < words.length) {
    var hit = null;
    for (j = 0; j < list.length; j++) {
      var pw = list[j].w;
      if (i + pw.length > words.length) continue;
      var ok = true;
      for (k = 0; k < pw.length; k++) {
        if (words[i + k] !== pw[k]) { ok = false; break; }
      }
      if (ok) { hit = list[j]; break; }
    }
    if (hit) { parts++; i += hit.w.length; continue; }
    if (CV_FILL[words[i]]) { i++; continue; }
    return false;
  }
  return parts > 0;
}
/* A question ABOUT ENZO itself (2nd-person / self-directed): its state,
   current work, location, start time, finish time. Answered from ENZO's
   own state, never from the internet. The phrases use 2nd-person verb
   forms, so a question about a third party or a place does NOT match. */
var CV_ENZO_PHRASES = ['kya haal hai', 'kya haal chaal', 'kaise ho',
  'kesay ho', 'kese ho', 'aur sunao', 'how are you', 'how r u',
  'how are u', 'whats up', 'what s up', 'kya kar rahe ho',
  'kya karte ho', 'what are you doing', 'kidhar ja rahe ho',
  'kahan ja rahe ho', 'where are you going', 'kahan ho', 'kidhar ho',
  'tu kahan hai', 'kaunsa kaam kar rahe ho', 'kaun sa kaam kar rahe ho',
  'kis kaam par ho', 'kis kaam mein ho', 'kis kaam par lage ho',
  'what work are you doing', 'kis tarah ka kar rahe ho',
  'kis tarah kar rahe ho', 'kaise kar rahe ho', 'how are you doing it',
  'how are you doing this', 'kab start kiya hai', 'kab start kiya tha',
  'kab shuru kiya hai', 'kab se start kiya', 'when did you start',
  'kitne time mein ho jayega', 'kitna time lagega',
  'ye kaam kab ho jayega', 'kab tak ho jayega',
  'kitni der mein ho jayega', 'kitna time aur lagega',
  'how long will it take', 'when will it be done', 'tum kaun ho',
  'aap kaun ho', 'who are you', 'tum kya karte ho', 'aap kya karte ho',
  'tum ne kab start kiya', 'tumne kab start kiya'];
var CV_ENZO_URDU = ['کیا حال ہے', 'کیا حال ہیں', 'کیا حال چال ہے',
  'کیسے ہو', 'آپ کیسے ہیں', 'اور سناؤ', 'کیا کر رہے ہو', 'کیا کرتے ہو',
  'کدھر جا رہے ہو', 'کہاں جا رہے ہو', 'کہاں ہو', 'کدھر ہو', 'تو کہاں ہے',
  'کونسا کام کر رہے ہو', 'کون سا کام کر رہے ہو', 'کس کام پر ہو',
  'کس کام میں لگے ہو', 'کس طرح کا کر رہے ہو', 'کس طرح کر رہے ہو',
  'کیسے کر رہے ہو', 'کب سٹارٹ کیا ہے', 'کب شروع کیا ہے',
  'کب سے سٹارٹ کیا ہے', 'تم نے کب سٹارٹ کیا',
  'کتنے ٹائم میں ہو جائے گا', 'کتنا ٹائم لگے گا',
  'یہ کام کب ہو جائے گا', 'کب تک ہو جائے گا',
  'کتنی دیر میں ہو جائے گا', 'کتنا ٹائم اور لگے گا', 'تم کون ہو',
  'آپ کون ہو', 'توں کون ایں', 'توں کون اے', 'تسی کون او'];
function cvIsAboutEnzo(text) {
  var raw = String(text || '');
  if (!cvTrim(raw)) return false;
  var n = cvNorm(raw);
  var i;
  for (i = 0; i < CV_ENZO_PHRASES.length; i++) {
    if (n.indexOf(' ' + CV_ENZO_PHRASES[i] + ' ') !== -1) return true;
  }
  for (i = 0; i < CV_ENZO_URDU.length; i++) {
    if (raw.indexOf(CV_ENZO_URDU[i]) !== -1) return true;
  }
  var t = cvTrim(n);
  if (t === 'where are you' || cvEndsWith(t, ' where are you')) return true;
  /* 'kya ho raha hai' is a greeting in the v53 greeting gate, so it is
     about-ENZO here too — but ONLY as a short bare phrase. With a topic
     or a long message it is a real question and stays out. */
  if (cvWordCount(raw) <= 8 &&
      (n.indexOf(' kya ho raha hai ') !== -1 ||
       raw.indexOf('کیا ہو رہا ہے') !== -1)) return true;
  return false;
}
/* Definition of a stable concept ("what is X", "X kya hai", "meaning
   of X", "define X"). Stable concepts do not need a search. */
function cvIsDefinition(text) {
  var raw = String(text || '');
  var n = cvNorm(raw);
  var phrases = [' what is ', ' what are ', ' what does ', ' what do ',
    ' meaning of ', ' define ', ' kya hai ', ' kia hai ',
    ' kya hota hai ', ' kya hoti hai ', ' kya hote hain ',
    ' kya cheez hai ', ' matlab kya hai ', ' matlab kia hai ',
    ' ka matlab kya ', ' ki matlab kya ', ' ke matlab kya ',
    ' kisko kehte hain ', ' kis ko kehte hain ', ' kise kehte hain ',
    ' ise kehte hain ', ' usse kehte hain ', ' isko kehte hain ',
    ' usko kehte hain ', ' kehte hain '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/کس کو کہتے ہیں|کا مطلب کیا|کیا ہوتا ہے|کیا ہوتی ہے|کیا ہے/
      .test(raw)) return true;
  return false;
}
/* An opinion: the user asks what ENZO thinks, likes, or prefers. An
   opinion is answered from own reasoning, never searched. */
function cvIsOpinion(text) {
  var raw = String(text || '');
  var n = cvNorm(raw);
  var phrases = [' what do you think ', ' in your opinion ',
    ' do you like ', ' which is better ', ' what is your opinion ',
    ' tumhara kya khayal hai ', ' tumhara kya khayal ',
    ' aap ka kya khayal hai ', ' aap ka kya khayal ',
    ' tumhe kya pasand hai ', ' aap ko kya pasand hai ', ' tumhari rai ',
    ' aap ki rai '];
  var i;
  for (i = 0; i < phrases.length; i++) {
    if (n.indexOf(phrases[i]) !== -1) return true;
  }
  if (/آپ کی رائے|تمہارا کیا خیال|تمہاری رائے/.test(raw)) return true;
  return false;
}
/* Needs current / time-sensitive information: latest news, prices,
   today's events, weather, scores. A bare "now" only counts when paired
   with something actually happening; the time of day is local clock
   knowledge, not a search. */
function cvIsTimeSensitive(text) {
  var raw = String(text || '');
  if (/what (is|was) the time|time now|waqt kya hai|time kya hai/i
      .test(raw)) return false;
  var n = cvNorm(raw);
  if (/\b(today|tonight|latest|breaking|recent|live|happening|current|news|weather|score|price|rates?|stock|updates?|this week|this month|this year)\b/.test(n)) return true;
  if (/\b(now|currently)\b/.test(n) &&
      /\b(happening|going on|in pakistan|in lahore|in india|in the world|around)\b/.test(n)) return true;
  if (/\b(aaj|taza|tazaa|haliya|khabar|khabrein|khabrain|mausam|qeemat|keemat|taza tareen)\b/.test(n)) return true;
  if (/آج|تازہ|حالیہ|خبر|موسم|قیمت/.test(raw)) return true;
  return false;
}
/* The user explicitly ordered real research ("research karo",
   "dhoond do", "search karo", ...). An explicit order is honoured even
   when the words alone look like a definition. */
function cvExplicitResearch(text) {
  var raw = String(text || '');
  var n = cvNorm(raw);
  if (/\b(research|tehqeeq)\b/.test(n)) return true;
  if (/\b(dhoond|dhund|search|talaash|talash|google)\b.{0,24}\b(kar|karo|karke|kardo|do|de|dena|batao|nikal|nikalo|please|chahiye)\b/.test(n)) return true;
  if (/\b(internet|online|web)\b.{0,14}\b(dhoond|search|research)\b/.test(n)) return true;
  if (/ریسرچ|تحقیق\s*(کرو|کر)|ڈھونڈ\s*(دو|کے|کر)|تلاش\s*(کرو|کر)/.test(raw)) return true;
  return false;
}
/* Unknowable-in-principle: no search and no knowledge can answer these.
   Returns the kind ('mind' | 'secret' | 'future-exact') or null. */
function cvUnknowableKind(text) {
  var raw = String(text || '');
  var n = cvNorm(raw);
  if (/what am i thinking|read my mind|mere dimagh mein kya|mere zehen mein kya|what is in my mind|میں کیا سوچ رہا|میرے دماغ میں کیا/.test(n + ' ' + raw)) return 'mind';
  if (/what is my password|mera password|what is my (cnic|phone|account|bank).{0,16}number|mera cnic|my pin|mera pin|mera account number|میرا پاس ورڈ/.test(n + ' ' + raw)) return 'secret';
  if (/\bexact\b.{0,32}\b(price|date|day|score|number|time)\b/.test(n) &&
      /\b(203\d|204\d|205\d|next year|agle saal|future|mustaqbil)\b/.test(n)) return 'future-exact';
  if (/\bwhat will\b.{0,40}\b(exactly|exact)\b/.test(n)) return 'future-exact';
  if (/\bwhat will happen on\b/.test(n) && /\b(203\d|204\d|205\d)\b/.test(n)) return 'future-exact';
  if (/\b(lottery|lotto)\b.{0,24}\b(number|numbers|win|jeet)\b/.test(n)) return 'future-exact';
  return null;
}
/* Genuinely outside own knowledge — ONLY via an explicit flag from the
   caller (P1's intelState, or ctx.unknownTopic). This file never guesses
   a topic list: a pure function cannot know what the answering model
   knows, so absence from a list is not treated as ignorance. */
function cvUnknownTopic(ctx) {
  if (!ctx) return false;
  if (ctx.unknownTopic === true) return true;
  if (ctx.intelState) {
    if (ctx.intelState.unknownTopic === true) return true;
    if (ctx.intelState.known === false) return true;
  }
  return false;
}

/* ---------- history helpers ---------- */
/* Normalise a history into [{role, text}] whatever shape it arrived in:
   an array of {role, text|plain} objects, an array of bare strings, or a
   ctx object with .history / .messages. Empty turns are dropped. */
function cvHistoryTurns(hist) {
  var arr = hist;
  if (arr && typeof arr === 'object' && !(arr instanceof Array)) {
    arr = arr.history || arr.messages || [];
  }
  if (!(arr instanceof Array)) return [];
  var out = [];
  var i;
  for (i = 0; i < arr.length; i++) {
    var item = arr[i];
    var role = 'user';
    var text = '';
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      role = (item.role === 'ai' || item.role === 'assistant')
        ? 'ai' : 'user';
      text = item.text || item.plain || '';
    }
    if (cvTrim(text)) out.push({ role: role, text: String(text) });
  }
  return out;
}
/* The current topic of the conversation. Priority: explicit ctx fields
   (P1's state wins when present), then the most recent user turn in the
   history that names a topic. The CURRENT message itself is skipped
   (its normalised text equals rawText) — otherwise a topic-change
   message would set its own topic and the change would be missed. */
function cvCurrentTopic(ctx, hist, rawText) {
  if (ctx) {
    if (typeof ctx.currentTopic === 'string' && cvTrim(ctx.currentTopic)) {
      return cvTrim(ctx.currentTopic).toLowerCase();
    }
    if (typeof ctx.topic === 'string' && cvTrim(ctx.topic)) {
      return cvTrim(ctx.topic).toLowerCase();
    }
    if (ctx.intelState && typeof ctx.intelState === 'object') {
      var st = ctx.intelState;
      if (typeof st.currentTopic === 'string' && cvTrim(st.currentTopic)) {
        return cvTrim(st.currentTopic).toLowerCase();
      }
      if (typeof st.topic === 'string' && cvTrim(st.topic)) {
        return cvTrim(st.topic).toLowerCase();
      }
      if (typeof st.lastTopic === 'string' && cvTrim(st.lastTopic)) {
        return cvTrim(st.lastTopic).toLowerCase();
      }
    }
  }
  var rawNorm = cvNorm(rawText || '');
  var i;
  for (i = hist.length - 1; i >= 0; i--) {
    if (hist[i].role !== 'user') continue;
    if (rawText && cvNorm(hist[i].text) === rawNorm) continue;
    var t = cvExtractTopic(hist[i].text);
    if (t) return t;
  }
  return '';
}
/* Was a user turn at index i answered? Some later turn is an ai turn
   with real text. */
function cvWasAnswered(hist, i) {
  var j;
  for (j = i + 1; j < hist.length; j++) {
    if (hist[j].role === 'ai' && cvTrim(hist[j].text)) return true;
  }
  return false;
}
/* Canonical question kind for repeat matching: what/who/when/where/
   why/how/tell, in all three languages, so the same question asked in
   another language still counts as the same question. */
function cvQuestionKind(text) {
  var n = cvNorm(text);
  if (/\b(kya|kia|what)\b/.test(n)) return 'what';
  if (/\b(kaun|kon|kisne|who)\b/.test(n)) return 'who';
  if (/\b(kab|when)\b/.test(n)) return 'when';
  if (/\b(kahan|kidhar|where)\b/.test(n)) return 'where';
  if (/\b(kyun|why)\b/.test(n)) return 'why';
  if (/\b(kaise|kesay|kese|kis tarah|how)\b/.test(n)) return 'how';
  if (/\b(tell|explain|discuss|research|batao|batayein|samjhao|samjhaen|talk)\b/.test(n)) return 'tell';
  if (/بتاؤ|بتائیں|سمجھاؤ/.test(String(text || ''))) return 'tell';
  return '';
}
/* Repeat key: question kind + sorted unique content words. Two messages
   with the same key ask the same thing ("What is X?" and "X kya hai?"
   both key as "what | X"). '' when there is nothing to match on. */
function cvRepeatKey(text) {
  var words = cvContentWords(text);
  if (!words.length) return '';
  var seen = {};
  var uniq = [];
  var i;
  for (i = 0; i < words.length; i++) {
    if (!seen[words[i]]) { seen[words[i]] = 1; uniq.push(words[i]); }
  }
  uniq.sort();
  return cvQuestionKind(text) + '|' + uniq.join(' ');
}
/* True when resolvedText matches an EARLIER user turn that was answered.
   The current message itself (last user turn, identical text) never
   counts. Greetings never count. */
function cvIsRepeat(resolvedText, rawText, hist) {
  if (cvIsGreeting(resolvedText)) return false;
  var key = cvRepeatKey(resolvedText);
  if (!key) return false;
  var rawNorm = cvNorm(rawText || '');
  var i;
  for (i = 0; i < hist.length; i++) {
    if (hist[i].role !== 'user') continue;
    /* Skip the current message itself: the last user turn whose text
       is the message being answered. */
    if (rawText && i === hist.length - 1 &&
        cvNorm(hist[i].text) === rawNorm) continue;
    if (cvRepeatKey(hist[i].text) === key && cvWasAnswered(hist, i)) {
      return true;
    }
  }
  return false;
}
function cvHistoryTone(hist) {
  var counts = { roman: 0, urdu: 0, en: 0 };
  var last = '';
  var i;
  for (i = 0; i < hist.length; i++) {
    if (hist[i].role !== 'ai') continue;
    var L = detectLanguage(hist[i].text);
    counts[L]++;
    last = L;
  }
  if (!counts.roman && !counts.urdu && !counts.en) return 'en';
  if (counts.roman >= counts.urdu && counts.roman >= counts.en) {
    return counts.roman ? 'roman' : last;
  }
  if (counts.urdu >= counts.en) return 'urdu';
  return 'en';
}

/* ---------- pronouns, ellipses, topic-change prefixes ---------- */
function cvHasPronoun(text, lang) {
  var raw = String(text || '');
  if (lang === 'urdu' || cvHasUrdu(raw)) {
    return /اس کے|اس کا|اس کی|اس کو|اسے|اس نے|اس سے|یہ|اسی|اس/.test(raw);
  }
  if (lang === 'roman') {
    return /\b(is\s+ke|is\s+ka|is\s+ki|is\s+ko|is\s+ne|is\s+se|isko|ise|iska|iske|iski|us\s+ke|us\s+ka|us\s+ki|us\s+ko|us\s+ne|us\s+se|usko|usse|uska|uske|uski|ye\s+kya|yeh\s+kya|isi|usi)\b/i.test(raw);
  }
  return /\b(it|its|this|that|they|them|their|he|she|his|her|him)\b/i.test(raw);
}
/* A fragment, not a full question: "and its advantages?", "aur faide?",
   "tell me more", "more". Only short messages count, so a real
   sentence that happens to contain "more" is never treated as one. */
function cvIsEllipsis(text) {
  var n = cvNorm(text);
  var words = cvTrim(n).split(/\s+/).filter(function (w) { return !!w; });
  if (words.length > 6) return false;
  if (/tell me more|aur batao|aur batayein|مزید بتائیں|اور بتائیں/.test(n)) return true;
  if (/^\s*(more|aur|مزید)\s*\??\s*$/.test(n)) return true;
  if (/^\s*(and\s+)?(its\s+|the\s+|aur\s+)?(advantages|disadvantages|benefits|drawbacks|pros|cons|features|history|meaning|faide|fayde|nuqsanat|tareekh|matlab|فائدے|نقصانات|تاریخ|مطلب)\s*\??\s*$/.test(n)) return true;
  return false;
}
var CV_NOUN_GUARD = cvStopTable(('very really quite just also not so too more most best first second new old good bad big small').split(' '));
/* Replace pronouns / demonstratives with the topic, longest forms
   first so "is ke" is replaced before a bare "is" could be touched
   (a bare "is"/"us" is never replaced: "is waqt" means "at this time",
   not a pronoun). */
function cvResolvePronouns(text, topic, lang) {
  var s = String(text || '');
  if (lang === 'urdu' || cvHasUrdu(s)) {
    s = s.replace(/اس کے/g, topic + ' کے');
    s = s.replace(/اس کا/g, topic + ' کا');
    s = s.replace(/اس کی/g, topic + ' کی');
    s = s.replace(/اس کو/g, topic + ' کو');
    s = s.replace(/اس نے/g, topic + ' نے');
    s = s.replace(/اس سے/g, topic + ' سے');
    s = s.replace(/اسے/g, topic);
    s = s.replace(/یہ کیا ہے/g, topic + ' کیا ہے');
    s = s.replace(/اسی/g, topic);
    s = s.replace(/یہ/g, topic);
    s = s.replace(/اس/g, topic);
    return s;
  }
  if (lang === 'roman') {
    s = s.replace(/\bis\s+ke\b/gi, topic + ' ke');
    s = s.replace(/\bis\s+ka\b/gi, topic + ' ka');
    s = s.replace(/\bis\s+ki\b/gi, topic + ' ki');
    s = s.replace(/\bis\s+ko\b/gi, topic + ' ko');
    s = s.replace(/\bis\s+ne\b/gi, topic + ' ne');
    s = s.replace(/\bis\s+se\b/gi, topic + ' se');
    s = s.replace(/\bisko\b/gi, topic + ' ko');
    s = s.replace(/\bise\b/gi, topic);
    s = s.replace(/\biska\b/gi, topic + ' ka');
    s = s.replace(/\biske\b/gi, topic + ' ke');
    s = s.replace(/\biski\b/gi, topic + ' ki');
    s = s.replace(/\bus\s+ke\b/gi, topic + ' ke');
    s = s.replace(/\bus\s+ka\b/gi, topic + ' ka');
    s = s.replace(/\bus\s+ki\b/gi, topic + ' ki');
    s = s.replace(/\bus\s+ko\b/gi, topic + ' ko');
    s = s.replace(/\bus\s+ne\b/gi, topic + ' ne');
    s = s.replace(/\bus\s+se\b/gi, topic + ' se');
    s = s.replace(/\busse\b/gi, topic + ' se');
    s = s.replace(/\buska\b/gi, topic + ' ka');
    s = s.replace(/\buske\b/gi, topic + ' ke');
    s = s.replace(/\buski\b/gi, topic + ' ki');
    s = s.replace(/\b(ye|yeh)\s+kya\s+hai\b/gi, topic + ' kya hai');
    s = s.replace(/\bisi\b/gi, topic);
    s = s.replace(/\busi\b/gi, topic);
    return s;
  }
  /* English: aspect first ("its disadvantages" -> "the disadvantages
     of X"), then who-created-it, then a generic aspect ("its moons" ->
     "the moons of X"), then a bare pronoun. */
  s = s.replace(/\bits\s+(disadvantages|advantages|benefits|drawbacks|pros|cons|features|history|meaning|price|founder|creator|inventor)\b/gi, 'the $1 of ' + topic);
  s = s.replace(/\bwho\s+(created|made|invented|founded|discovered)\s+(it|this|that)\b/gi, function (m, verb) {
    return m.slice(0, 3) + ' ' + verb + ' ' + topic;
  });
  s = s.replace(/\bits\s+([a-z]+)\b/gi, function (m, w) {
    if (CV_NOUN_GUARD[w.toLowerCase()]) return m;
    return 'the ' + w + ' of ' + topic;
  });
  s = s.replace(/\btheir\s+(disadvantages|advantages|benefits|names|features)\b/gi, 'the $1 of ' + topic);
  s = s.replace(/\b(it|this|that)\b/gi, topic);
  s = s.replace(/\b(they|them)\b/gi, topic);
  s = s.replace(/\btheir\b/gi, topic);
  s = s.replace(/\b(he|she)\b/gi, topic);
  s = s.replace(/\b(his|her|him)\b/gi, topic);
  return s;
}
function cvTellMeAbout(topic, lang) {
  if (lang === 'urdu') return topic + ' کے بارے میں بتائیں۔';
  if (lang === 'roman') return topic + ' ke baare mein batao.';
  return 'Tell me about ' + topic + '.';
}
function cvTellMeMore(topic, lang) {
  if (lang === 'urdu') return topic + ' کے بارے میں مزید بتائیں۔';
  if (lang === 'roman') return topic + ' ke baare mein aur batao.';
  return 'Tell me more about ' + topic + '.';
}
/* Expand a fragment into a full question about the topic. */
function cvExpandEllipsis(text, topic, lang) {
  var n = cvNorm(text);
  if (/tell me more|aur batao|aur batayein|مزید بتائیں|اور بتائیں/.test(n) ||
      /^\s*(more|aur|مزید)\s*\??\s*$/.test(n)) {
    return cvTellMeMore(topic, lang);
  }
  if (lang === 'urdu' || cvHasUrdu(text)) {
    if (/فائدے/.test(n)) return topic + ' کے فائدے کیا ہیں؟';
    if (/نقصانات/.test(n)) return topic + ' کے نقصانات کیا ہیں؟';
    if (/تاریخ/.test(n)) return topic + ' کی تاریخ کیا ہے؟';
    if (/مطلب/.test(n)) return topic + ' کا مطلب کیا ہے؟';
    return cvTellMeMore(topic, lang);
  }
  if (lang === 'roman') {
    if (/\b(faide|fayde)\b/.test(n)) return topic + ' ke faide kya hain?';
    if (/\bnuqsanat\b/.test(n)) return topic + ' ke nuqsanat kya hain?';
    if (/\btareekh\b/.test(n)) return topic + ' ki tareekh kya hai?';
    if (/\bmatlab\b/.test(n)) return topic + ' ka matlab kya hai?';
    return cvTellMeMore(topic, lang);
  }
  if (/\bdisadvantages\b/.test(n)) return 'What are the disadvantages of ' + topic + '?';
  if (/\badvantages\b/.test(n)) return 'What are the advantages of ' + topic + '?';
  if (/\bbenefits\b/.test(n)) return 'What are the benefits of ' + topic + '?';
  if (/\bdrawbacks\b/.test(n)) return 'What are the drawbacks of ' + topic + '?';
  if (/\bpros\b/.test(n) || /\bcons\b/.test(n)) return 'What are the pros and cons of ' + topic + '?';
  if (/\bfeatures\b/.test(n)) return 'What are the main features of ' + topic + '?';
  if (/\bhistory\b/.test(n)) return 'What is the history of ' + topic + '?';
  if (/\bmeaning\b/.test(n)) return 'What is the meaning of ' + topic + '?';
  return cvTellMeMore(topic, lang);
}
/* Strip topic-change markers from the front of a message ("actually,
   first ...", "let's discuss ...", "ab ...", "pehle ..."). Instruction
   verbs ("explain", "tell me about") are KEPT: the resolved question
   should still read as a question. */
function cvStripTopicPrefix(text, lang) {
  var s = String(text || '');
  var hadDiscuss = false;
  var hadPrefix = false;
  var m;
  m = s.match(/^\s*(actually|asal mein|darasal)[,\s]+(first|pehle)?[,\s]*/i);
  if (m) { s = s.slice(m[0].length); hadPrefix = true; }
  m = s.match(/^\s*(first|pehle)[,\s]+/i);
  if (m) { s = s.slice(m[0].length); hadPrefix = true; }
  m = s.match(/^\s*(let's|let us)\s+(discuss|talk about)\s+/i);
  if (m) { s = s.slice(m[0].length); hadDiscuss = true; hadPrefix = true; }
  m = s.match(/^\s*(change of topic|new topic|on a new topic)[,:]?\s+/i);
  if (m) { s = s.slice(m[0].length); hadPrefix = true; }
  if (lang === 'roman') {
    m = s.match(/^\s*(ab|chalo)\b\s*/i);
    if (m) { s = s.slice(m[0].length); hadPrefix = true; }
  }
  m = s.match(/^\s*(اب|چلو)\s*/);
  if (m) { s = s.slice(m[0].length); hadPrefix = true; }
  return { cleaned: cvTrim(s), hadDiscuss: hadDiscuss, hadPrefix: hadPrefix };
}

/* ---------- PUBLIC: resolveFollowUp ---------- */
function resolveFollowUp(text, ctx) {
  var raw = String(text || '');
  var trimmed = cvTrim(raw);
  if (!trimmed) {
    return { resolvedText: '', topic: '', isTopicChange: false,
      pronounResolved: false, alreadyAnswered: false };
  }
  var lang = detectLanguage(raw);
  var hist = cvHistoryTurns(ctx);
  var currentTopic = cvCurrentTopic(ctx, hist, raw);
  var newTopic = cvExtractTopic(raw);
  var prefix = cvStripTopicPrefix(raw, lang);
  var hasPronoun = cvHasPronoun(raw, lang);
  var isEllipsis = cvIsEllipsis(raw);

  /* A message that refers back with a pronoun or a fragment is a
     follow-up about the CURRENT topic, never a topic change — its
     "new" words name a side of the old topic ("its moons", "aur
     faide"), not a new subject. Only a pronoun-free message naming a
     genuinely different subject changes the topic. */
  var isChange = false;
  if (!hasPronoun && !isEllipsis && newTopic && currentTopic &&
      !cvTopicsShare(newTopic, currentTopic)) {
    isChange = true;
  }

  var topic = currentTopic;
  var resolved = raw;
  var pronounResolved = false;
  if (isChange) {
    topic = newTopic;
    if (prefix.hadDiscuss || !cvTrim(prefix.cleaned)) {
      resolved = cvTellMeAbout(newTopic, lang);
    } else {
      resolved = prefix.cleaned;
    }
  } else if ((hasPronoun || isEllipsis) && currentTopic) {
    if (isEllipsis) {
      resolved = cvExpandEllipsis(raw, currentTopic, lang);
    } else {
      resolved = cvResolvePronouns(raw, currentTopic, lang);
    }
    pronounResolved = (resolved !== raw);
    topic = currentTopic;
  } else {
    topic = newTopic || currentTopic;
  }

  return {
    resolvedText: resolved,
    topic: topic,
    isTopicChange: isChange,
    pronounResolved: pronounResolved,
    alreadyAnswered: cvIsRepeat(resolved, raw, hist)
  };
}

/* ---------- PUBLIC: shouldSearch ---------- */
function shouldSearch(text, ctx) {
  var raw = String(text || '');
  if (!cvTrim(raw)) {
    return { search: false, reason: 'empty message — nothing to search' };
  }
  var follow = resolveFollowUp(raw, ctx);
  var q = follow.resolvedText || raw;
  if (cvIsGreeting(q)) {
    return { search: false, reason: 'greeting or small talk — no search needed' };
  }
  if (cvIsAboutEnzo(q)) {
    return { search: false, reason: 'question about ENZO itself — answered from own state' };
  }
  if (cvExplicitResearch(q)) {
    return { search: true, reason: 'user asked for research' };
  }
  if (cvUnknowableKind(q)) {
    return { search: false, reason: 'cannot be answered by search — private or unknowable' };
  }
  if (cvIsTimeSensitive(q)) {
    return { search: true, reason: 'needs current information' };
  }
  if (cvUnknownTopic(ctx)) {
    return { search: true, reason: 'topic is outside own knowledge' };
  }
  if (follow.pronounResolved) {
    return { search: false, reason: 'follow-up answerable from conversation context' };
  }
  if (cvIsDefinition(q)) {
    return { search: false, reason: 'stable definition — answer from own knowledge' };
  }
  if (cvIsOpinion(q)) {
    return { search: false, reason: 'opinion — answer from own knowledge' };
  }
  return { search: false, reason: 'stable fact — answer from own knowledge' };
}

/* ---------- PUBLIC: honestUncertainty ---------- */
/* One short honest sentence in the user's language: what is unknown AND
   what can still be offered. Never a bare dead-end, never a fabricated
   fact. Null when the question is answerable (greeting, ENZO-self,
   definition, opinion, or anything with no unknown/unknowable signal).
   NOTE: the assembler calls this when no answer could be produced —
   after a search came back empty, or when no search was used — not as
   a replacement for searching. */
var CV_UNCERTAIN = {
  unknown: {
    en: 'I do not know that exact detail, but I can search for the latest information on it if you would like.',
    roman: 'Ye exact detail mujhe maloom nahi hai, lekin main is par abhi search karke batane ki koshish kar sakta hoon.',
    urdu: 'یہ درست تفصیل مجھے معلوم نہیں ہے، لیکن میں اس پر ابھی تلاش کر کے بتانے کی کوشش کر سکتا ہوں۔'
  },
  mind: {
    en: 'I cannot know what you are thinking right now, but I can help you write your thoughts down or talk through them if you would like.',
    roman: 'Aap is waqt kya soch rahe hain, ye main nahi jaan sakta, lekin aap chahein to main aap ki soch ko likhne ya us par baat karne mein madad kar sakta hoon.',
    urdu: 'آپ اس وقت کیا سوچ رہے ہیں، یہ میں نہیں جان سکتا، لیکن آپ چاہیں تو میں آپ کی سوچ کو لکھنے یا اس پر بات کرنے میں مدد کر سکتا ہوں۔'
  },
  secret: {
    en: 'I do not have access to your private details like that, and I cannot look them up, but I can help you find where you saved them or how to reset them if you would like.',
    roman: 'Aap ki aisi private detail tak meri rasai nahi hai aur main use dekh bhi nahi sakta, lekin aap chahein to main aap ko batane mein madad kar sakta hoon ke wo kahan save ho sakti hai ya use kaise reset kiya jata hai.',
    urdu: 'آپ کی ایسی نجی تفصیل تک میری رسائی نہیں ہے اور میں اسے دیکھ بھی نہیں سکتا، لیکن آپ چاہیں تو میں آپ کو بتانے میں مدد کر سکتا ہوں کہ وہ کہاں محفوظ ہو سکتی ہے یا اسے کیسے ری سیٹ کیا جاتا ہے۔'
  },
  'future-exact': {
    en: 'Nobody can know that exact future detail in advance, but I can share the latest forecasts and the most likely possibilities if you would like.',
    roman: 'Mustaqbil ki ye exact detail pehle se koi nahi jaan sakta, lekin aap chahein to main latest andaze aur sab se zyada mumkin suratein bata sakta hoon.',
    urdu: 'مستقبل کی یہ درست تفصیل پہلے سے کوئی نہیں جان سکتا، لیکن آپ چاہیں تو میں تازہ ترین اندازے اور سب سے زیادہ ممکن صورتیں بتا سکتا ہوں۔'
  }
};
function honestUncertainty(text, ctx) {
  var raw = String(text || '');
  if (!cvTrim(raw)) return null;
  if (cvIsGreeting(raw) || cvIsAboutEnzo(raw)) return null;
  var kind = cvUnknowableKind(raw);
  if (!kind && cvUnknownTopic(ctx)) kind = 'unknown';
  if (!kind) return null;
  var lang = detectLanguage(raw);
  var set = CV_UNCERTAIN[kind] || CV_UNCERTAIN.unknown;
  return set[lang] || set.en;
}

/* ---------- PUBLIC: buildAnswerContext ---------- */
/* Compact pack for the answering model: resolved question, current
   topic, and the relevant prior turns (max 6, most recent first). The
   current message itself is left out of the summary. tone is the
   dominant language of the history, so the answer can match it. */
function buildAnswerContext(text, history) {
  var raw = String(text || '');
  var hist = cvHistoryTurns(history);
  var follow = resolveFollowUp(raw, { history: hist });
  var qWords = cvContentWords(follow.resolvedText);
  var rawNorm = cvNorm(raw);

  /* Score each prior turn by shared content words with the resolved
     question, then walk from the most recent turn backwards, keeping
     turns that share a word plus the last 2 turns regardless, up to 6.
     The kept list is already most-recent-first. */
  var kept = [];
  var i, j;
  for (i = hist.length - 1; i >= 0 && kept.length < 6; i--) {
    var turn = hist[i];
    if (turn.role === 'user' && i === hist.length - 1 &&
        cvNorm(turn.text) === rawNorm) continue;
    var shared = 0;
    var tw = cvContentWords(turn.text);
    for (j = 0; j < tw.length; j++) {
      if (qWords.indexOf(tw[j]) !== -1) { shared++; break; }
    }
    var isRecent = (hist.length - 1 - i) < 2;
    if (shared > 0 || isRecent) kept.push(turn);
  }
  var lines = [];
  for (i = 0; i < kept.length; i++) {
    lines.push((kept[i].role === 'ai' ? 'ENZO: ' : 'User: ') +
      cvClip(kept[i].text, 140));
  }
  return {
    resolvedQuestion: follow.resolvedText,
    topic: follow.topic,
    contextSummary: lines.join('\n'),
    tone: cvHistoryTone(hist)
  };
}

/* ---------- PUBLIC: shortAnswer (delegate only, never duplicate) ---------- */
/* The narrow "conversation about ENZO itself" kinds are owned by the
   v54 piece (conversationReply). This function MUST NOT re-implement
   those replies: it delegates to conversationReply when that function
   exists in the assembled page and the text is an ENZO-self question,
   and returns null otherwise — so the caller falls through to the
   normal answering path for general / definition questions. */
function shortAnswer(text, lang) {
  var raw = String(text || '');
  if (!cvTrim(raw)) return null;
  if (cvIsAboutEnzo(raw) && typeof conversationReply === 'function') {
    try {
      return conversationReply(raw, lang, {});
    } catch (e) {
      return null;
    }
  }
  return null;
}

/* ---------- PUBLIC: isRepeatQuestion ---------- */
function isRepeatQuestion(text, ctx) {
  var follow = resolveFollowUp(text, ctx);
  return !!follow.alreadyAnswered;
}

/* ---------- PUBLIC: suggestFollowUp ---------- */
/* One relevant follow-up, ONLY when it genuinely helps: broad openers
   ("Tell me about X", "Explain X") where going deeper or comparing is
   a real next step. Null after greetings, ENZO-self questions, precise
   factual questions, and repeats — a follow-up there would be noise. */
function suggestFollowUp(text, ctx) {
  var raw = String(text || '');
  if (!cvTrim(raw)) return null;
  if (cvIsGreeting(raw) || cvIsAboutEnzo(raw)) return null;
  var follow = resolveFollowUp(raw, ctx);
  if (follow.alreadyAnswered) return null;
  if (!follow.topic) return null;
  var n = cvNorm(raw);
  var broad = /\b(tell me about|explain|discuss|talk about|overview|introduce|samjhao|samjhaen|batao|batayein)\b/.test(n) ||
    /بتاؤ|بتائیں|سمجھاؤ/.test(raw);
  if (!broad) return null;
  var lang = detectLanguage(raw);
  if (lang === 'urdu') {
    return 'کیا آپ چاہتے ہیں کہ میں ' + follow.topic + ' پر مزید تفصیل سے بتاؤں، یا اس کا کسی اور چیز سے موازنہ کروں؟';
  }
  if (lang === 'roman') {
    return 'Kya aap chahte hain ke main ' + follow.topic + ' par aur tafseel se bataun, ya is ka kisi aur cheez se muqabla karun?';
  }
  return 'Would you like me to go deeper into ' + follow.topic + ', or compare it with something else?';
}

/* ---------- export tail (guarded) ---------- */
var EnaoConversation = {
  VERSION: VERSION,
  detectLanguage: detectLanguage,
  resolveFollowUp: resolveFollowUp,
  shouldSearch: shouldSearch,
  honestUncertainty: honestUncertainty,
  buildAnswerContext: buildAnswerContext,
  shortAnswer: shortAnswer,
  isRepeatQuestion: isRepeatQuestion,
  suggestFollowUp: suggestFollowUp
};

if (typeof root !== 'undefined') root.EnaoConversation = EnaoConversation;
if (typeof module !== 'undefined' && module.exports) module.exports = EnaoConversation;

})(typeof window !== 'undefined' ? window : this);
