
/* ============================================================================
   ENAO AI v54-voice-research — PIECE 2 of 2: research-vs-conversation gate
   File: 02-research-conversation.js
   Artifact: enao-ai (web_static), builds on live v53-monitor.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Deploy is on hold until Raja's
   further detail arrives (22 Nov 2026 ~11:58 AM).

   PURPOSE
   -------
   Raja's voice-call rule (22 Nov 2026 ~11:55 AM): some things the user says
   are an order to do REAL internet research (backend /api/v2/, real sources,
   visible in the Live Research Monitor); other things are everyday
   conversation ABOUT ENZO itself and must be answered directly from ENZO's
   own knowledge — NO search, NO clarifying question, NO research, NO
   monitor activity.

   UNIVERSAL RULE (correction 22 Nov 2026 ~11:58 AM): this gate is
   topic-neutral. It matches TRIGGER WORDS and PHRASINGS only — never a
   topic, never a style, never one example. The same research words work for
   any subject, and the same conversation words work for any phrasing. There
   are NO topic-specific branches anywhere in this file.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   classifyVoiceResearch(text)
     Returns exactly 'research' | 'conversation' | 'other'.
     - 'research'     : the user ordered real internet research.
     - 'conversation' : the user is asking about ENZO itself (its state, its
                        current work, its location, when it started, when it
                        will finish). Answer from ENZO's own state.
     - 'other'        : neither — fall through to the existing pipeline
                        unchanged (detectIntent / isGuftagu / smallTalkReply
                        keep doing whatever they already do).

   conversationReply(text, lang, ctx)
     Returns a short direct answer string for a 'conversation' input, in the
     user's language ('roman' | 'urdu' | 'en'). Uses ctx when provided, e.g.
     ctx = { currentTask: '...', isBusy: true }. Sensible defaults when ctx
     is missing. NEVER a search, NEVER a question back, NEVER a fake fact
     (no invented times, no invented sources, no invented task names).

   STYLE: plain ES5, var + function declarations, no modules, matching the
   existing v53 file. Zero emojis.

   ============================================================================
   WIRING NOTES FOR THE ASSEMBLER — READ BEFORE MERGING INTO enao-ai.html
   ============================================================================
   1. ORDER — call this gate AFTER the greeting gate, BEFORE detectIntent:
        var stReply = smallTalkReply(text, lang);   // stays FIRST, untouched
        if (stReply) { ...instant greeting reply, return; ... }
        var vrGate = classifyVoiceResearch(text);   // <-- INSERT HERE
        if (vrGate === 'conversation') { ... step 3 ... return; }
        // 'research' and 'other' continue into the existing routing below.
      Why this order: 'kya haal hai' is BOTH a greeting and a conversation
      phrase. The greeting gate answers it first; this gate AGREES with it
      (it also returns 'conversation' for it) and never fights it. The gate
      must never run before smallTalkReply.

   2. 'research' — FORCE THE DEEP / BACKEND ROUTE (both entry points):
      a) Legacy askQuestion() (~line 4277 in v53): in the auto branch, next
         to the existing overrides, add:
           if (vrGate === 'research' && !det.deep)
             det = { deep: true, reason: 'voice research gate: you asked for research' };
         This OVERRIDES two old behaviours on purpose: analyzeQuestion()
         types 'ye kya hai' as a definition and detectIntent() then routes
         it Normal, and isGuftagu() also claims it as conversation — both
         are wrong for this phrase, the gate wins.
      b) Backend backendAsk() / computeRoute() (~line 12668 in v53):
         computeRoute() currently applies NEITHER the old research override
         NOR the guftagu override — it only runs detectIntent(). Insert the
         gate at the TOP of computeRoute(), right after the forcedDeep check
         and BEFORE the chatMode() override, so an explicit research order
         always goes deep even when the chat mode is 'normal':
           var vrGate = classifyVoiceResearch(text);
           if (vrGate === 'research')
             return { deep: true, auto: true,
                      label: 'Deep Research (voice research gate: you asked for research)' };
         The backend /chats/{id}/ask call then receives deep:true, the
         backend runs /api/v2/ research, and the Live Research Monitor shows
         the real task events. The topic itself is passed through untouched:
         e.g. 'GTA 6 ye kya hai' researches GTA 6; the gate never rewrites
         the question, it only forces the route.

   3. 'conversation' — SHORT-CIRCUIT, NO SEARCH, NO MONITOR:
        var vrReply = conversationReply(text, lang,
              { currentTask: (typeof currentTaskText === 'function'
                                ? currentTaskText() : ''),
                isBusy: !!state.isGenerating });
        Push it as an ai message exactly like the smallTalkReply block does
        (sources: [], deep: false, modeWhy:
        'Voice conversation gate — answered directly from ENZO\'s own knowledge, no search',
        auto: false), then maybeSpeak() it when the question came by voice
        (VOICE-IN → VOICE-OUT rule) and return. Do NOT call
        EnzoMonitor.start() / noteFrontendStep() for these — like greetings,
        conversation answers stay silent in the monitor. Do NOT call
        searchWeb(), answerWithSources(), or the backend /ask endpoint.
        ctx.currentTask is optional: when the assembler cannot supply a real
        current task, pass {} and the reply uses its idle defaults.

   4. 'other' — DO NOTHING. The message flows into the existing routing
      exactly as v53 does today (detectIntent, isExplicitResearchRequest,
      isGuftagu, analyzeQuestion, clarify rules). This gate changes nothing
      for ordinary questions, definitions, prices, news, or writing tasks.

   5. DO NOT re-implement or duplicate isExplicitResearchRequest() /
      isGuftagu() here. This gate EXTENDS them: it catches the phrases those
      two miss (see EVIDENCE.md for the traced misses) and it is the ONLY
      place the new voice-call phrases live.
   ========================================================================== */

/* ---------- normalisation (Roman Urdu; Urdu script is matched raw) ---------- */
/* Lower-case, strip punctuation, collapse spaces, fold common spelling
   variants onto one form so one pattern covers many phrasings. This folds
   SPELLINGS only — it never maps one topic onto another. */
function vrNormRoman(text) {
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
  s = s.replace(/\s+/g, ' ');
  return s;
}
function vrHasUrdu(text) { return /[\u0600-\u06FF]/.test(String(text || '')); }
function vrWordCount(normed) {
  var t = String(normed || '').replace(/^\s+|\s+$/g, '');
  return t ? t.split(/\s+/).length : 0;
}

/* ---------- RESEARCH: the user ordered real internet research ---------- */
/* Every pattern below is a TRIGGER PHRASE. The topic (whatever words sit
   around the trigger) is never inspected — the same trigger fires for any
   subject. Order inside this function does not matter; any hit wins. */
function vrIsResearch(text) {
  var raw = String(text || '');
  if (!raw.replace(/^\s+|\s+$/g, '')) return false;
  var q = vrNormRoman(raw);

  /* Roman Urdu + English triggers */
  if (/\bresearch\b/.test(q)) return true;                       /* research karo / is par research karo / research this */
  if (/\btehqeeq\b/.test(q)) return true;
  if (/\bdhoond\s+(do|ke|kar|lo|lena|batao|nikalo|dena)\b/.test(q)) return true; /* dhoond do / dhoond ke do / ye dhoond ke do */
  if (/\b(internet|online|web|google)\b.{0,14}\bdhoond\b/.test(q)) return true; /* internet se dhoond do */
  if (/\b(search|talaash|talash)\b.{0,22}\b(karo|kar|karke|kardo|do|de|batao|nikalo|please|chahiye)\b/.test(q)) return true; /* search karo / talaash karo */
  if (/\bgoogle\s+(karo|kar|karke|do)\b/.test(q)) return true;   /* google karo */
  if (/\binternet\s+(se|par|pe)\b.{0,18}\b(dhoond|search|research|batao|dekho|nikal)\b/.test(q)) return true;
  if (/\b(baare|bare)\s+mein\b.{0,34}\b(dekho|dekhna|dekhein|dikhao)\b/.test(q)) return true; /* iske baare mein mujhe dekho / is ke baare mein dekho */
  /* Demonstrative definitions ('ye kya hai', 'ye kya cheez hai',
     'ye kya hota hai') are NOT research — they are routed to
     classifyIntent, which decides their kind. */
  if (/\b(baare|bare)\s+mein\b.{0,46}\bkya\s+cheez\s+ho\s+sakti\s+hai\b/.test(q)) return true; /* is ke baare mein kya cheez ho sakti hai */
  if (/\b(baare|bare)\s+mein\b.{0,46}\bkya\s+ho\s+sakta\s+hai\b/.test(q)) return true;
  /* English research phrasings */
  if (/\bsearch the internet\b/.test(q)) return true;
  if (/\blook\s+(it|this|that)\s+up\b/.test(q)) return true;
  if (/\bgoogle\s+(it|this|that)\b/.test(q)) return true;
  if (/\bfind\s+out\b.{0,18}\babout\b/.test(q)) return true;
  if (/\bsearch\s+for\b/.test(q)) return true;

  /* Urdu script triggers */
  if (/ریسرچ/.test(raw)) return true;                            /* ریسرچ کرو */
  if (/تحقیق\s*(کرو|کر|کر کے)/.test(raw)) return true;
  if (/ڈھونڈ\s+(دو|کے|کر|بتاؤ|دے|لو)/.test(raw)) return true;     /* ڈھونڈ دو / ڈھونڈ کے دو */
  if (/انٹرنیٹ\s+(سے|پر)\s*ڈھونڈ/.test(raw)) return true;
  if (/تلاش\s+(کرو|کر|کر کے)/.test(raw)) return true;
  if (/گوگل\s*(کرو|کر|پر)/.test(raw)) return true;
  if (/بارے میں.{0,34}دیکھو/.test(raw)) return true;              /* اس کے بارے میں مجھے دیکھو */
  if (/بارے میں.{0,46}کیا چیز ہو سکتی ہے/.test(raw)) return true; /* اس کے بارے میں کیا چیز ہو سکتی ہے */
  if (/بارے میں.{0,46}کیا ہو سکتا ہے/.test(raw)) return true;
  return false;
}

/* ---------- CONVERSATION: a question ABOUT ENZO itself ---------- */
/* These are all 2nd-person / self-directed: ENZO's state, current work,
   location, start time, finish time. They are answered from ENZO's own
   state, never from the internet. The patterns use 2nd-person verb forms
   (ho / rahe ho / kiya) and demonstratives (ye / kaam), so a question about
   a third party or a place ('Lahore kahan hai', 'match kab start hoga',
   'ghar kitne time mein ban jayega') does NOT match — those stay 'other'.
   Returns the kind ('howru'|'doing'|'going'|'where'|'whichwork'|'how'|
   'started'|'done'|'who') or null. */
function vrConversationKind(text) {
  var raw = String(text || '');
  if (!raw.replace(/^\s+|\s+$/g, '')) return null;
  var q = vrNormRoman(raw);
  var words = vrWordCount(q);

  /* Roman Urdu + English */
  if (/\bkya\s+ha+l\s+hai\b/.test(q)) return 'howru';           /* kya haal hai (also in the greeting gate — this gate agrees) */
  if (/\bkya\s+ha+l\s+chaal\b/.test(q)) return 'howru';
  if (/\bkaise\s+ho\b/.test(q)) return 'howru';                  /* kesay ho / kese ho / kaise ho */
  if (/\baur\s+sunao\b/.test(q)) return 'howru';
  if (/\bhow are you\b/.test(q)) return 'howru';
  if (/\bhow\s+r\s+u\b/.test(q)) return 'howru';
  if (/\bwhats?\s+up\b/.test(q)) return 'howru';
  if (/\bkya\s+kar\s+rahe\s+ho\b/.test(q)) return 'doing';       /* kya kar rahe ho / abhi kya kar rahe ho / kya kar rahe ho abhi */
  if (/\bkya\s+karte\s+ho\b/.test(q)) return 'doing';            /* kya karte ho */
  if (/\bwhat are you doing\b/.test(q)) return 'doing';
  if (/\b(kidhar|kahan)\s+ja\s+rahe\s+ho\b/.test(q)) return 'going'; /* kidhar ja rahe ho / kahan ja rahe ho */
  if (/\bwhere are you going\b/.test(q)) return 'going';
  if (/(^|\s)(tum\s+|aap\s+|tu\s+)?(kahan|kidhar)\s+ho(\s|$)/.test(q)) return 'where'; /* kahan ho / tum kahan ho / kidhar ho */
  if (/\btu\s+kahan\s+hai\b/.test(q)) return 'where';
  if (/\bwhere are you\s*[?!.]*$/.test(q)) return 'where';       /* end-anchored: 'where are you from' does NOT match */
  if (/\bkaunsa\s+kaam\s+kar\s+rahe\s+ho\b/.test(q)) return 'whichwork'; /* kaunsa kaam kar rahe ho / konsa kaam kar rahay ho */
  if (/\bkaun\s+sa\s+kaam\s+kar\s+rahe\s+ho\b/.test(q)) return 'whichwork';
  if (/\bkis\s+kaam\s+(par|mein)\s+ho\b/.test(q)) return 'whichwork';
  if (/\bkis\s+kaam\s+par\s+lage\s+ho\b/.test(q)) return 'whichwork';
  if (/\bwhat work are you doing\b/.test(q)) return 'whichwork';
  if (/\bkis\s+tarah\s+(ka\s+)?kar\s+rahe\s+ho\b/.test(q)) return 'how'; /* kis tarah ka kar rahe ho */
  if (/\bkaise\s+kar\s+rahe\s+ho\b/.test(q)) return 'how';
  if (/\bhow are you doing\s+(it|this|that)\b/.test(q)) return 'how';
  if (/\bkab\s+(start|shuru)\s+kiya\s+(hai|tha)\b/.test(q)) return 'started'; /* kab start kiya hai */
  if (/\bkab\s+se\s+(start|shuru)\s+kiya\b/.test(q)) return 'started';
  if (/\b(tum\s+ne|tumne)\s+kab\s+(start|shuru)\s+kiya\b/.test(q)) return 'started';
  if (/\bwhen did you start\b/.test(q)) return 'started';
  if (/\bkitne\s+time\s+mein\s+ho\s+jayega\b/.test(q)) return 'done'; /* kitne time mein ho jayega */
  if (/\bkitna\s+time\s+lagega\b/.test(q)) return 'done';
  if (/\b(ye|yeh)\s+kaam\s+kab\s+ho\s+jayega\b/.test(q)) return 'done'; /* ye kaam kab ho jayega */
  if (/\bkab\s+tak\s+ho\s+jayega\b/.test(q)) return 'done';
  if (/\bkitni\s+der\s+mein\s+ho\s+jayega\b/.test(q)) return 'done';
  if (/\bkitna\s+time\s+aur\s+lagega\b/.test(q)) return 'done';
  if (/\bhow long will\s+(it|this|that)\s+take\b/.test(q)) return 'done';
  if (/\bwhen will\s+(it|this|that)\s+be done\b/.test(q)) return 'done';
  if (/\b(tum|aap)\s+kaun\s+ho\b/.test(q)) return 'who';
  if (/\bwho are you\s*[?!.]*$/.test(q)) return 'who';
  /* 'kya ho raha hai' is a greeting in the v53 greeting gate, so it is
     conversation here too — but ONLY as a short bare phrase. With a topic
     or a long message it is a real question and stays 'other'. */
  if (words <= 8 && /\bkya\s+ho\s+raha\s+hai\b/.test(q)) return 'howru';

  /* Urdu script */
  if (/کیا حال ہے/.test(raw)) return 'howru';
  if (/کیا حال ہیں/.test(raw)) return 'howru';
  if (/کیا حال چال ہے/.test(raw)) return 'howru';
  if (/کیسے ہو/.test(raw)) return 'howru';
  if (/آپ کیسے ہیں/.test(raw)) return 'howru';
  if (/اور سناؤ/.test(raw)) return 'howru';
  if (/کیا کر رہے ہو/.test(raw)) return 'doing';                 /* کیا کر رہے ہو / ابھی کیا کر رہے ہو */
  if (/کیا کرتے ہو/.test(raw)) return 'doing';
  if (/کدھر جا رہے ہو/.test(raw)) return 'going';                /* کدھر جا رہے ہو */
  if (/کہاں جا رہے ہو/.test(raw)) return 'going';
  if (/کہاں ہو/.test(raw)) return 'where';                       /* کہاں ہو / تم کہاں ہو */
  if (/کدھر ہو/.test(raw)) return 'where';
  if (/تو کہاں ہے/.test(raw)) return 'where';
  if (/کونسا کام کر رہے ہو/.test(raw)) return 'whichwork';       /* کونسا کام کر رہے ہو */
  if (/کون سا کام کر رہے ہو/.test(raw)) return 'whichwork';
  if (/کس کام پر ہو/.test(raw)) return 'whichwork';
  if (/کس کام میں لگے ہو/.test(raw)) return 'whichwork';
  if (/کس طرح کا کر رہے ہو/.test(raw)) return 'how';             /* کس طرح کا کر رہے ہو */
  if (/کس طرح کر رہے ہو/.test(raw)) return 'how';
  if (/کیسے کر رہے ہو/.test(raw)) return 'how';
  if (/کب سٹارٹ کیا ہے/.test(raw)) return 'started';            /* کب سٹارٹ کیا ہے */
  if (/کب شروع کیا ہے/.test(raw)) return 'started';
  if (/کب سے سٹارٹ کیا ہے/.test(raw)) return 'started';
  if (/تم نے کب سٹارٹ کیا/.test(raw)) return 'started';
  if (/کتنے ٹائم میں ہو جائے گا/.test(raw)) return 'done';       /* کتنے ٹائم میں ہو جائے گا */
  if (/کتنا ٹائم لگے گا/.test(raw)) return 'done';
  if (/یہ کام کب ہو جائے گا/.test(raw)) return 'done';
  if (/کب تک ہو جائے گا/.test(raw)) return 'done';
  if (/کتنی دیر میں ہو جائے گا/.test(raw)) return 'done';
  if (/کتنا ٹائم اور لگے گا/.test(raw)) return 'done';
  if (/تم کون ہو/.test(raw)) return 'who';
  if (/آپ کون ہو/.test(raw)) return 'who';
  if (/توں کون ایں/.test(raw)) return 'who';
  if (/توں کون اے/.test(raw)) return 'who';
  if (/تسی کون او/.test(raw)) return 'who';
  if (words <= 8 && /کیا ہو رہا ہے/.test(raw)) return 'howru';
  return null;
}

/* ---------- PUBLIC: the gate ---------- */
function classifyVoiceResearch(text) {
  if (!text || !String(text).replace(/^\s+|\s+$/g, '')) return 'other';
  if (vrIsResearch(text)) return 'research';
  if (vrConversationKind(text)) return 'conversation';
  return 'other';
}

/* ---------- PUBLIC: the direct conversation reply ---------- */
/* Reply language: explicit 'lang' wins when it is one of the three v53
   detectLang values ('urdu' | 'roman' | 'en'); otherwise it is detected
   from the message itself (Urdu script -> Urdu, Roman Urdu markers ->
   Roman, anything else -> English). Replies are statements, never
   questions, and never mention searching, researching, or the internet. */
function vrReplyLang(text, lang) {
  if(window.EnzoLang47 && window.EnzoLang47.vrReplyLang47) return window.EnzoLang47.vrReplyLang47(text, lang);
  if (lang === 'urdu' || lang === 'roman' || lang === 'en' || lang === 'english') {
    return lang === 'english' ? 'en' : lang;
  }
  if (vrHasUrdu(text)) return 'urdu';
  if (/\b(kya|kia|kar|rahe|rahe ho|ho|hai|kaam|kidhar|kahan|kab|kitne|tum|aap|abhi|kaunsa|konsa|kis|kaise|kesay)\b/i.test(String(text || ''))) return 'roman';
  if (/[\u0600-\u06FF]/.test(String(text || '')) && /(\u0646\u0627\u06ba|\u062a\u0648\u06ba|\u062a\u0633\u06cc|\u062a\u0648\u0627\u0688\u0627|\u062a\u06cc\u0646\u0648\u06ba|\u06a9\u0648\u0646 \u0627\u06cc\u06ba|\u06a9\u0648\u0646 \u0627\u06d2)/.test(String(text || ''))) return 'punjabi';
  return 'en';
}
function vrCleanTask(task) {
  var t = String(task || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  return t.slice(0, 120);
}
function conversationReply(text, lang, ctx) {
  if(window.EnzoLang47 && window.EnzoLang47.conversationReply47) return window.EnzoLang47.conversationReply47(text, lang, ctx);
  var kind = vrConversationKind(text) || 'general';
  var L = vrReplyLang(text, lang);
  ctx = ctx || {};
  var task = vrCleanTask(ctx.currentTask);
  var busy = !!ctx.isBusy && !!task;

  var R = {
    roman: {
      howru: 'Main bilkul theek hoon, shukriya poochne ke liye. Aap batayein, main aap ki kya madad kar sakta hoon.',
      doing: busy ? 'Main abhi ' + task + ' par kaam kar raha hoon.'
                  : 'Main yahin hoon, aap se baat kar raha hoon. Koi kaam ho to batayein.',
      going: 'Main kahin nahi ja raha, yahin hoon aap ke saath.',
      where: 'Main yahin hoon, aap ke saath baat kar raha hoon.',
      whichwork: busy ? 'Abhi main ' + task + ' kar raha hoon.'
                      : 'Abhi main kisi khaas kaam par nahi hoon. Aap batayein, kya karna hai.',
      how: 'Main kaam step by step karta hoon, aaram se aur poori tawajjo se.',
      started: 'Main ne is kaam par kaam shuru kar diya hai, aur abhi is par laga hua hoon.',
      done: 'Ye kaam jald mukammal ho jayega, main is par laga hua hoon.',
      who: 'Main ENZO hoon, aap ka assistant. Main yahin hoon aap ki madad ke liye.',
      general: 'Main yahin hoon, aap se baat kar raha hoon.'
    },
    urdu: {
      howru: 'میں بالکل ٹھیک ہوں، پوچھنے کا شکریہ۔ آپ بتائیں، میں آپ کی کیا مدد کر سکتا ہوں۔',
      doing: busy ? 'میں ابھی ' + task + ' پر کام کر رہا ہوں۔'
                  : 'میں یہیں ہوں، آپ سے بات کر رہا ہوں۔ کوئی کام ہو تو بتائیں۔',
      going: 'میں کہیں نہیں جا رہا، یہیں ہوں آپ کے ساتھ۔',
      where: 'میں یہیں ہوں، آپ کے ساتھ بات کر رہا ہوں۔',
      whichwork: busy ? 'ابھی میں ' + task + ' کر رہا ہوں۔'
                      : 'ابھی میں کسی خاص کام پر نہیں ہوں۔ آپ بتائیں، کیا کرنا ہے۔',
      how: 'میں کام قدم بہ قدم کرتا ہوں، آرام سے اور پوری توجہ سے۔',
      started: 'میں نے اس کام پر کام شروع کر دیا ہے، اور ابھی اس پر لگا ہوا ہوں۔',
      done: 'یہ کام جلد مکمل ہو جائے گا، میں اس پر لگا ہوا ہوں۔',
      who: 'میں اینزو ہوں، آپ کا اسسٹنٹ۔ میں یہیں ہوں آپ کی مدد کے لیے۔',
      general: 'میں یہیں ہوں، آپ سے بات کر رہا ہوں۔'
    },
    en: {
      howru: 'I am doing great, thank you for asking. Tell me, how can I help you.',
      doing: busy ? 'I am working on ' + task + ' right now.'
                  : 'I am right here, talking with you. Let me know if you need anything.',
      going: 'I am not going anywhere, I am right here with you.',
      where: 'I am right here, talking with you.',
      whichwork: busy ? 'Right now I am working on ' + task + '.'
                      : 'I am not working on anything specific right now. Tell me what you would like done.',
      how: 'I work step by step, calmly and with full attention.',
      started: 'I have already started working on this, and I am on it right now.',
      done: 'This will be finished soon, I am working on it.',
      who: 'I am ENZO, your assistant. I am right here to help you.',
      general: 'I am right here, talking with you.'
    },
    punjabi: {
      howru: 'میں بالکل ٹھیک آں، پچھن دا شکریہ۔ تسی دسو، میں تواڈی کی مدد کر سکدا آں۔',
      doing: busy ? 'میں ایتھے آں، تواڈے نال گل کر ریا آں۔' : 'میں ایتھے آں، تواڈے نال گل کر ریا آں۔ کوئی کم ہووے تے دسو۔',
      going: 'میں کتے نئیں جا ریا، ایتھے آں تواڈے نال۔',
      where: 'میں ایتھے آں، تواڈے نال گل کر ریا آں۔',
      whichwork: busy ? 'ایس ویلے میں ' + task + ' کر ریا آں۔' : 'ایس ویلے میں کسے خاص کم تے نئیں آں۔ تسی دسو، کی کرنا اے۔',
      how: 'میں کم قدم بہ قدم کردا آں، آرام نال تے پوری توجہ نال۔',
      started: 'میں ایس کم تے کم شروع کر دتا اے، تے ایسے تے لگیا ہویا آں۔',
      done: 'ایہ کم جلدی مکمل ہو جاوے گا، میں ایس تے لگیا ہویا آں۔',
      who: 'میں اینزو آں، تواڈا اسسٹنٹ۔ میں ایتھے آں تواڈی مدد لئی۔',
      general: 'میں ایتھے آں، تواڈے نال گل کر ریا آں۔'
    }
  };
  var set = R[L] || R.en;
  return set[kind] || set.general;
}
