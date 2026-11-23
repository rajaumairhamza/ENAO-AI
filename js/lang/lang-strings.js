
/* ============================================================================
   ENAO AI — PIECE 47: clarifying / Listen Aloud / call / small-talk
   strings in all four languages (47-lang-strings.js)
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines,
   meta v61-deep-triggers-4lang) + LANGUAGE-SPEC.md P4.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   ORDER (Raja, 22 Nov 2026 ~6:49 PM PKT): clarifying questions, the
   "Listen Aloud" button, and call conversation must all work in all
   four languages (English, Urdu script, Roman Urdu, Punjabi Shahmukhi
   + Roman Punjabi).

   WHAT THIS PIECE DOES — and ONLY this (SPEC P4):
   1. STRINGS: every P4 string in all five language values
      en / urdu / roman / punjabi / roman-punjabi. Clarify strings are
      copied verbatim from live CLARIFY_T (L1518-1590) for en/urdu/roman/
      punjabi, and use the spec's EXACT Roman Punjabi strings (P4a).
      Listen Aloud / Pause / Resume labels are the spec's EXACT P4c
      strings. TTS_NO_VOICE messages are the spec's EXACT P4d strings.
      Conversation / small-talk / emotion / follow-up Punjabi strings
      are line-for-line translations of the live Roman Urdu sets
      (conversationReply R-table L48224, smallTalkReply R L5138,
      EMO_LINES L16803, makeFollowups L6702) — no new meanings invented.
      The spec's exact Punjabi Shahmukhi + Roman Punjabi `howru` lines
      (P4e) are used verbatim. No key has an English fall-through for
      Punjabi: every key has a real Punjabi value.
   2. t(key, lang, vars): lookup with the spec's fallback order —
      exact language, then the script sibling (punjabi -> urdu,
      roman-punjabi -> roman, the nearest family per P3's
      TTS_FALLBACK_LANG), then LOUD FAILURE (throw). It NEVER falls
      back to English for punjabi / roman-punjabi, and never silently
      for any language: a missing string is a bug, not a default.
   3. Patch functions the assembler wires at the exact live sites
      (see PATCH FUNCTIONS below): clarify callers pass the resolved
      language; backendAsk L16167 hardcoded English fallback replaced;
      Listen Aloud / Pause / Resume labels rendered via t(); small-talk
      / conversation / emotion / follow-up functions take the resolved
      language and use STRINGS instead of their en/roman/urdu-only
      branches; refusalLang normalised (P4f).
   4. Backend clarify is NOT touched here (P2 worker owns backend
      files). The backend defect is documented as a patch note in
      47-lang-strings.EVIDENCE.md (dead duplicated Punjabi branches +
      no `language` in the clarify payload).

   DEPENDENCY — piece 44 (44-lang-resolver.js, `resolveAnswerLang`):
   piece 44 did NOT exist yet when this piece was built, so this piece
   codes against its SPEC'D interface only:
   `resolveAnswerLang(text, pref)` -> one of
   en / urdu / roman / punjabi / roman-punjabi (hindi passes through).
   Every function here that needs a resolved language takes the resolver
   as an injected argument (or reads window.EnzoLang44.resolveAnswerLang
   when present) and NEVER calls legacy detectLang for it. If no
   resolver is available, the caller-supplied language is used as-is
   (normalised) — this piece never invents its own detector.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies). Zero emojis.

   LIVE ANCHORS (verified by grep/read against the live v61 file)
   - CLARIFY_T ................................. L1518-1590
   - clarifyQuestion + allow-list .............. L1591-1602
   - backendAsk hardcoded fallback ............. L16167
     deliverClarify(ctx, (route.intent && route.intent.clarifyQuestion)
       || 'What would you like me to do?');
   - Listen Aloud button templates ............. L5586, L5724
   - syncVoiceBar labels ....................... L7647
     ('Pause' / 'Resume' / 'Listen Aloud')
   - smallTalkReply ............................ L5138 (R table + rLang L5177)
   - vrReplyLang ............................... L48212-48219
   - conversationReply R-table ................. L48224+
   - EMO_LINES + fallback ...................... L16803-16817, L16839
     (EMO_LINES[emo][msg.lang] || EMO_LINES[emo].en)
   - makeFollowups ............................. L6702-6706
   - refusal path .............................. L7754 (refusalLang -> speakText)
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'p47-lang-strings-v1';

  /* Canonical language values (LANGUAGE-SPEC.md section 0). `hindi`
     is NOT in Raja's four; it is kept out of STRINGS on purpose and
     normaliseLang maps it through unchanged where it already exists. */
  var LANGS = ['en', 'urdu', 'roman', 'punjabi', 'roman-punjabi'];

  /* Script-sibling fallback (nearest family, same script — mirrors
     P3 TTS_FALLBACK_LANG: Punjabi's nearest real voice family is
     Urdu). This is the ONLY fallback t() ever performs. There is no
     English fallback step anywhere in this file. */
  var SIBLING = { 'punjabi': 'urdu', 'roman-punjabi': 'roman' };

  /* ------------------------------------------------------------------
     STRINGS — every P4 string, every language. Placeholders:
       {t}    clarify topic (bare-topic-fragment)
       {a} {b} clarify options (no-referent, two-option form)
       {name} small-talk name (Raja, from loadPref('enao_name'))
       {task} conversation current task (doing-busy / whichwork-busy)
       {Lang} {Used} no-voice message: requested language / voice used
     Values are plain strings (never functions) so the harness can
     assert completeness, script, and placeholder substitution over
     the whole table without executing live code.
     ------------------------------------------------------------------ */
  var STRINGS = {
    /* --- P4a. Clarifying questions (10 reason groups, live CLARIFY_T
       L1518-1590 verbatim for en/urdu/roman/punjabi; spec-exact
       Roman Punjabi strings from P4a). `no-referent-single` is the
       live a&&b-false form ("Which task do you mean?"). --- */
    'clarify.empty-message': {
      en: 'What would you like me to do?',
      roman: 'Aap kya karwana chahte hain?',
      urdu: 'آپ کیا کروانا چاہتے ہیں؟',
      punjabi: 'تسی کی کروانا چاہندے او؟',
      'roman-punjabi': 'Tusi ki karwana chahnde o?'
    },
    'clarify.research-word-no-topic': {
      en: 'Which topic should I look into?',
      roman: 'Main kis topic par kaam karoon?',
      urdu: 'میں کس موضوع پر کام کروں؟',
      punjabi: 'میں کس موضوع تے کم کراں؟',
      'roman-punjabi': 'Main kis topic te kam karaan?'
    },
    'clarify.pronoun-only-no-topic': {
      en: 'Which topic should I look into?',
      roman: 'Main kis topic par kaam karoon?',
      urdu: 'میں کس موضوع پر کام کروں؟',
      punjabi: 'میں کس موضوع تے کم کراں؟',
      'roman-punjabi': 'Main kis topic te kam karaan?'
    },
    'clarify.tell-more-no-topic': {
      en: 'Which topic should I look into?',
      roman: 'Main kis topic par kaam karoon?',
      urdu: 'میں کس موضوع پر کام کروں؟',
      punjabi: 'میں کس موضوع تے کم کراں؟',
      'roman-punjabi': 'Main kis topic te kam karaan?'
    },
    'clarify.research-verb-pronoun-no-topic': {
      en: 'Which topic should I look into?',
      roman: 'Main kis topic par kaam karoon?',
      urdu: 'میں کس موضوع پر کام کروں؟',
      punjabi: 'میں کس موضوع تے کم کراں؟',
      'roman-punjabi': 'Main kis topic te kam karaan?'
    },
    'clarify.chahiye-no-topic': {
      en: 'Which topic should I look into?',
      roman: 'Main kis topic par kaam karoon?',
      urdu: 'میں کس موضوع پر کام کروں؟',
      punjabi: 'میں کس موضوع تے کم کراں؟',
      'roman-punjabi': 'Main kis topic te kam karaan?'
    },
    'clarify.bare-topic-fragment': {
      en: 'What would you like to know about "{t}"?',
      roman: '"{t}" ke baare mein aap kya jaanna chahte hain?',
      urdu: '"{t}" کے بارے میں آپ کیا جاننا چاہتے ہیں؟',
      punjabi: '"{t}" دے بارے وچ تسی کی جاننا چاہندے او؟',
      'roman-punjabi': '"{t}" de baare vich tusi ki janna chahnde o?'
    },
    'clarify.no-referent': {
      en: 'Do you mean "{a}" or "{b}"?',
      roman: 'Aap ka matlab "{a}" hai ya "{b}"?',
      urdu: 'آپ کا مطلب "{a}" ہے یا "{b}"؟',
      punjabi: 'تواڈا مطلب "{a}" اے یا "{b}"؟',
      'roman-punjabi': 'Tuhada matlab "{a}" ae ya "{b}"?'
    },
    'clarify.no-referent-single': {
      en: 'Which task do you mean?',
      roman: 'Aap kis kaam ki baat kar rahe hain?',
      urdu: 'آپ کس کام کی بات کر رہے ہیں؟',
      punjabi: 'تسی کس کم دی گل کر رہے او؟',
      'roman-punjabi': 'Tusi kis kam di gal kar rahe o?'
    },
    'clarify.destructive-unclear-target': {
      en: 'What exactly do you want me to delete or send?',
      roman: 'Aap kya delete ya send karna chahte hain?',
      urdu: 'آپ کیا حذف یا بھیجنا چاہتے ہیں؟',
      punjabi: 'تسی کی حذف یا بھیجنا چاہندے او؟',
      'roman-punjabi': 'Tusi ki delete ya send karna chahnde o?'
    },
    'clarify.generic': {
      en: 'Could you say a little more about what you would like me to do?',
      roman: 'Aap kis baare mein baat kar rahe hain?',
      urdu: 'آپ کس بارے میں بات کر رہے ہیں؟',
      punjabi: 'تسی کس بارے وچ گل کر رہے او؟',
      'roman-punjabi': 'Tusi kis baare vich gal kar rahe o?'
    },

    /* --- P4c. Listen Aloud labels (spec-exact). --- */
    'listen.listen': {
      en: 'Listen Aloud',
      roman: 'Awaz mein suno',
      urdu: 'آواز میں سنو',
      punjabi: 'آواز وچ سنو',
      'roman-punjabi': 'Awaz vich suno'
    },
    'listen.pause': {
      en: 'Pause',
      roman: 'Roko',
      urdu: 'روکیں',
      punjabi: 'روکو',
      'roman-punjabi': 'Roko'
    },
    'listen.resume': {
      en: 'Resume',
      roman: 'Jari rakho',
      urdu: 'جاری رکھیں',
      punjabi: 'جاری رکھو',
      'roman-punjabi': 'Jari rakho'
    },

    /* --- P4d. TTS_NO_VOICE messages (spec-exact). {Lang} = requested
       language name in the answer language; {Used} = voice actually
       used, in the answer language. Never claims a Punjabi voice is
       speaking when it is Urdu/English. --- */
    'ttsNoVoice': {
      en: 'This device has no voice for {Lang} installed, so I am reading this in the closest available voice ({Used}). The written answer above is complete.',
      roman: 'Is device par {Lang} ki awaz nahi hai, is liye qareebi awaz ({Used}) mein suna raha hoon — likha hua jawab poora hai.',
      urdu: 'اس ڈیوائس پر {Lang} کی آواز موجود نہیں ہے، اس لیے قریبی آواز ({Used}) میں سنا رہا ہوں — لکھا ہوا جواب مکمل ہے۔',
      punjabi: 'ایس ڈیوائس تے {Lang} دی آواز نہیں اے، ایس لئی قریبی آواز ({Used}) وچ سنا رہیا واں — لکھیا ہویا جواب پورا اے۔',
      'roman-punjabi': 'Is device te {Lang} di awaz nahi hai, is layi qareebi awaz ({Used}) vich suna reha haan — likheya hoya jawab poora hai.'
    },

    /* --- Language names, in each language (for {Lang} / {Used}). --- */
    'langName.punjabi': {
      en: 'Punjabi',
      roman: 'Punjabi',
      urdu: 'پنجابی',
      punjabi: 'پنجابی',
      'roman-punjabi': 'Punjabi'
    },
    'langName.urdu': {
      en: 'Urdu',
      roman: 'Urdu',
      urdu: 'اردو',
      punjabi: 'اردو',
      'roman-punjabi': 'Urdu'
    },
    'langName.english': {
      en: 'English',
      roman: 'English',
      urdu: 'انگریزی',
      punjabi: 'انگریزی',
      'roman-punjabi': 'English'
    },

    /* --- P4e. Conversation replies (conversationReply R-table L48224,
       9 kinds; doing / whichwork have a busy variant with {task}).
       `howru` Punjabi lines are the spec's EXACT P4e strings; the
       rest are line-for-line translations of the live Roman Urdu set. --- */
    'conv.howru': {
      en: 'I am doing great, thank you for asking. Tell me, how can I help you.',
      roman: 'Main bilkul theek hoon, shukriya poochne ke liye. Aap batayein, main aap ki kya madad kar sakta hoon.',
      urdu: 'میں بالکل ٹھیک ہوں، پوچھنے کا شکریہ۔ آپ بتائیں، میں آپ کی کیا مدد کر سکتا ہوں۔',
      punjabi: 'میں بالکل ٹھیک ہاں، پوچھن دا شکریہ۔ تسی دسو، میں تہاڈی کی مدد کر سکدا واں۔',
      'roman-punjabi': 'Main bilkul theek haan, puchhan da shukriya. Tusi dasso, main tuhadi ki madad kar sakda haan.'
    },
    'conv.doing': {
      en: 'I am right here, talking with you. Let me know if you need anything.',
      roman: 'Main yahin hoon, aap se baat kar raha hoon. Koi kaam ho to batayein.',
      urdu: 'میں یہیں ہوں، آپ سے بات کر رہا ہوں۔ کوئی کام ہو تو بتائیں۔',
      punjabi: 'میں ایتھے ای واں، تہاڈے نال گل کر رہیا واں۔ کوئی کم ہووے تے دسو۔',
      'roman-punjabi': 'Main ethe hi haan, tuhade naal gal kar reha haan. Koi kam hove te dasso.'
    },
    'conv.doing-busy': {
      en: 'I am working on {task} right now.',
      roman: 'Main abhi {task} par kaam kar raha hoon.',
      urdu: 'میں ابھی {task} پر کام کر رہا ہوں۔',
      punjabi: 'میں ہلے {task} تے کم کر رہیا واں۔',
      'roman-punjabi': 'Main hale {task} te kam kar reha haan.'
    },
    'conv.going': {
      en: 'I am not going anywhere, I am right here with you.',
      roman: 'Main kahin nahi ja raha, yahin hoon aap ke saath.',
      urdu: 'میں کہیں نہیں جا رہا، یہیں ہوں آپ کے ساتھ۔',
      punjabi: 'میں کتے نہیں جا رہیا، ایتھے ای واں تہاڈے نال۔',
      'roman-punjabi': 'Main kite nahi ja reha, ethe hi haan tuhade naal.'
    },
    'conv.where': {
      en: 'I am right here, talking with you.',
      roman: 'Main yahin hoon, aap ke saath baat kar raha hoon.',
      urdu: 'میں یہیں ہوں، آپ کے ساتھ بات کر رہا ہوں۔',
      punjabi: 'میں ایتھے ای واں، تہاڈے نال گل کر رہیا واں۔',
      'roman-punjabi': 'Main ethe hi haan, tuhade naal gal kar reha haan.'
    },
    'conv.whichwork': {
      en: 'I am not working on anything specific right now. Tell me what you would like done.',
      roman: 'Abhi main kisi khaas kaam par nahi hoon. Aap batayein, kya karna hai.',
      urdu: 'ابھی میں کسی خاص کام پر نہیں ہوں۔ آپ بتائیں، کیا کرنا ہے۔',
      punjabi: 'ہلے میں کسے خاص کم تے نہیں واں۔ تسی دسو، کی کرنا اے۔',
      'roman-punjabi': 'Hale main kise khaas kam te nahi haan. Tusi dasso, ki karna hai.'
    },
    'conv.whichwork-busy': {
      en: 'Right now I am working on {task}.',
      roman: 'Abhi main {task} kar raha hoon.',
      urdu: 'ابھی میں {task} کر رہا ہوں۔',
      punjabi: 'ہلے میں {task} کر رہیا واں۔',
      'roman-punjabi': 'Hale main {task} kar reha haan.'
    },
    'conv.how': {
      en: 'I work step by step, calmly and with full attention.',
      roman: 'Main kaam step by step karta hoon, aaram se aur poori tawajjo se.',
      urdu: 'میں کام قدم بہ قدم کرتا ہوں، آرام سے اور پوری توجہ سے۔',
      punjabi: 'میں کم قدم بہ قدم کردا واں، آرام نال تے پوری توجہ نال۔',
      'roman-punjabi': 'Main kam kadam ba kadam karda haan, araam naal te poori tawajjo naal.'
    },
    'conv.started': {
      en: 'I have already started working on this, and I am on it right now.',
      roman: 'Main ne is kaam par kaam shuru kar diya hai, aur abhi is par laga hua hoon.',
      urdu: 'میں نے اس کام پر کام شروع کر دیا ہے، اور ابھی اس پر لگا ہوا ہوں۔',
      punjabi: 'میں ایس کم تے کم شروع کر دتا اے، تے ہلے ایسے تے لگیا ہویا واں۔',
      'roman-punjabi': 'Main is kam te kam shuru kar ditta hai, te hale ise te laggeya hoya haan.'
    },
    'conv.done': {
      en: 'This will be finished soon, I am working on it.',
      roman: 'Ye kaam jald mukammal ho jayega, main is par laga hua hoon.',
      urdu: 'یہ کام جلد مکمل ہو جائے گا، میں اس پر لگا ہوا ہوں۔',
      punjabi: 'اے کم جلدی مکمل ہو جاوے گا، میں ایس تے لگیا ہویا واں۔',
      'roman-punjabi': 'Eh kam jaldi mukammal ho javega, main is te laggeya hoya haan.'
    },
    'conv.who': {
      en: 'I am ENZO, your assistant. I am right here to help you.',
      roman: 'Main ENZO hoon, aap ka assistant. Main yahin hoon aap ki madad ke liye.',
      urdu: 'میں اینزو ہوں، آپ کا اسسٹنٹ۔ میں یہیں ہوں آپ کی مدد کے لیے۔',
      punjabi: 'میں اینزو واں، تہاڈا اسسٹنٹ۔ میں ایتھے ای واں تہاڈی مدد لئی۔',
      'roman-punjabi': 'Main ENZO haan, tuhada assistant. Main ethe hi haan tuhadi madad layi.'
    },
    'conv.general': {
      en: 'I am right here, talking with you.',
      roman: 'Main yahin hoon, aap se baat kar raha hoon.',
      urdu: 'میں یہیں ہوں، آپ سے بات کر رہا ہوں۔',
      punjabi: 'میں ایتھے ای واں، تہاڈے نال گل کر رہیا واں۔',
      'roman-punjabi': 'Main ethe hi haan, tuhade naal gal kar reha haan.'
    },

    /* --- P4e. Small talk (smallTalkReply R L5138, 7 categories
       {name} is the first name from loadPref('enao_name','Raja')).
       Punjabi lines are line-for-line translations of the live
       Roman Urdu set. `satsriakal` is an 8th category added by this
       piece: "Sat Sri Akal" is a Sikh greeting, NOT a Muslim salam —
       answering it with "Waalaikum Assalam" would be a wrong-language
       / wrong-greeting reply (standing accuracy rule, 22 Nov 2026
       ~6:57 PM PKT), so it gets its own accurate reply. --- */
    'smalltalk.satsriakal': {
      en: 'Sat Sri Akal, {name}! Good to see you. How can I help you today?',
      roman: 'Sat Sri Akal, {name}! Khushi hui tuhade naal gal karke. Main tuhadi ki madad kar sakda haan?',
      urdu: 'ست سری اکال، {name}! تہاڈے نال گل کر کے خوشی ہوئی۔ میں تہاڈی کی مدد کر سکدا واں؟',
      punjabi: 'ست سری اکال، {name}! تہاڈے نال گل کر کے خوشی ہوئی۔ میں تہاڈی کی مدد کر سکدا واں؟',
      'roman-punjabi': 'Sat Sri Akal, {name}! Khushi hui tuhade naal gal karke. Main tuhadi ki madad kar sakda haan?'
    },
    'smalltalk.salamhowru': {
      en: 'Waalaikum Assalam, {name}! I am doing great, thank you for asking. How are you doing? And how can I help you today?',
      roman: 'Waalaikum Assalam, {name}! Main bilkul theek hoon, shukriya poochne ke liye. Aap sunayein, kya haal hai? Main aap ki kya madad kar sakta hoon?',
      urdu: 'وعلیکم السلام، {name}! میں بالکل ٹھیک ہوں، پوچھنے کا شکریہ۔ آپ سنائیں، کیا حال ہے؟ میں آپ کی کیا مدد کر سکتا ہوں؟',
      punjabi: 'وعلیکم السلام، {name}! میں بالکل ٹھیک واں، پوچھن دا شکریہ۔ تسی دسو، کی حال اے؟ میں تہاڈی کی مدد کر سکدا واں؟',
      'roman-punjabi': 'Waalaikum Assalam, {name}! Main bilkul theek haan, puchhan da shukriya. Tusi dasso, ki haal hai? Main tuhadi ki madad kar sakda haan?'
    },
    'smalltalk.salam': {
      en: 'Waalaikum Assalam, {name}! Good to see you. How can I help you today?',
      roman: 'Waalaikum Assalam, {name}! Khushi hui aap se baat karke. Main aap ki kya madad kar sakta hoon?',
      urdu: 'وعلیکم السلام، {name}! آپ سے بات کر کے خوشی ہوئی۔ میں آپ کی کیا مدد کر سکتا ہوں؟',
      punjabi: 'وعلیکم السلام، {name}! تہاڈے نال گل کر کے خوشی ہوئی۔ میں تہاڈی کی مدد کر سکدا واں؟',
      'roman-punjabi': 'Waalaikum Assalam, {name}! Tuhade naal gal kar ke khushi hoyi. Main tuhadi ki madad kar sakda haan?'
    },
    'smalltalk.greet': {
      en: 'Hello, {name}! Good to see you. How can I help you today?',
      roman: 'Hello, {name}! Khushi hui aap se baat karke. Main aap ki kya madad kar sakta hoon?',
      urdu: 'السلام علیکم، {name}! آپ سے بات کر کے خوشی ہوئی۔ میں آپ کی کیا مدد کر سکتا ہوں؟',
      punjabi: 'ہیلو، {name}! تہاڈے نال گل کر کے خوشی ہوئی۔ میں تہاڈی کی مدد کر سکدا واں؟',
      'roman-punjabi': 'Hello, {name}! Tuhade naal gal kar ke khushi hoyi. Main tuhadi ki madad kar sakda haan?'
    },
    'smalltalk.howru': {
      en: 'I am doing great, thank you for asking! How are you doing? And how can I help you today?',
      roman: 'Main bilkul theek hoon, shukriya! Aap sunayein, kya haal hai? Main aap ki kya madad kar sakta hoon?',
      urdu: 'میں بالکل ٹھیک ہوں، شکریہ! آپ سنائیں، کیا حال ہے؟ میں آپ کی کیا مدد کر سکتا ہوں؟',
      punjabi: 'میں بالکل ٹھیک واں، شکریہ! تسی دسو، کی حال اے؟ میں تہاڈی کی مدد کر سکدا واں؟',
      'roman-punjabi': 'Main bilkul theek haan, shukriya! Tusi dasso, ki haal hai? Main tuhadi ki madad kar sakda haan?'
    },
    'smalltalk.thanks': {
      en: 'You are most welcome! If anything else comes up, just ask.',
      roman: 'Koi baat nahi! Aur kuch chahiye ho to bas keh dein.',
      urdu: 'کوئی بات نہیں! اور کچھ چاہیے ہو تو بس کہہ دیں۔',
      punjabi: 'کوئی گل نہیں! ہور کچھ چاہیدا ہووے تے بس دس دیو۔',
      'roman-punjabi': 'Koi gal nahi! Hor kuch chahida hove te bas das deyo.'
    },
    'smalltalk.bye': {
      en: 'Goodbye for now, {name}! I am right here whenever you need me.',
      roman: 'Allah Hafiz, {name}! Jab bhi zaroorat ho, main yahin hoon.',
      urdu: 'اللہ حافظ، {name}! جب بھی ضرورت ہو، میں یہیں ہوں۔',
      punjabi: 'اللہ حافظ، {name}! جدوں وی ضرورت ہووے، میں ایتھے ای واں۔',
      'roman-punjabi': 'Allah Hafiz, {name}! Jadon vi zaroorat hove, main ethe hi haan.'
    },
    'smalltalk.ack': {
      en: 'Got it. Anything else you would like to ask?',
      roman: 'Theek hai. Aur kuch poochna ho to bas likh dein.',
      urdu: 'ٹھیک ہے۔ اور کچھ پوچھنا ہو تو بس لکھ دیں۔',
      punjabi: 'ٹھیک اے۔ ہور کچھ پوچھنا ہووے تے بس لکھ دیو۔',
      'roman-punjabi': 'Theek hai. Hor kuch puchhna hove te bas likh deyo.'
    },

    /* --- P4e. Emotion lines (EMO_LINES L16803, humble/loving/angry;
       Punjabi lines translate the live Roman Urdu lines). --- */
    'emo.humble': {
      en: 'You are right — that was my mistake, and I am sorry. Thank you for correcting me.',
      roman: 'Aap theek keh rahe hain — ye meri ghalti thi, mujhe maaf karein. Batane ka shukriya.',
      urdu: 'آپ ٹھیک کہہ رہے ہیں — یہ میری غلطی تھی، مجھے معاف کریں۔ بتانے کا شکریہ۔',
      punjabi: 'تسی ٹھیک کہہ رہے او — اے میری غلطی سی، مینوں معاف کرو۔ دسن دا شکریہ۔',
      'roman-punjabi': 'Tusi theek keh rahe o — eh meri ghalti si, mainu maaf karo. Dasan da shukriya.'
    },
    'emo.loving': {
      en: 'I am right here with you — we will work through this together, step by step.',
      roman: 'Main yahin hoon aap ke saath — hum mil kar isay aaram se hal kar lein ge, qadam ba qadam.',
      urdu: 'میں یہیں ہوں آپ کے ساتھ — ہم مل کر اسے آرام سے حل کر لیں گے، قدم بہ قدم۔',
      punjabi: 'میں ایتھے ای واں تہاڈے نال — اسیں رل کے اینوں آرام نال حل کر لواں گے، قدم بہ قدم۔',
      'roman-punjabi': 'Main ethe hi haan tuhade naal — asin ral ke ainu araam naal hal kar lavange, kadam ba kadam.'
    },
    'emo.angry': {
      en: 'I will be honest — that stung a little. But I am still here, and I will still help you properly.',
      roman: 'Sach kahoon to thoda bura laga — lekin main yahin hoon, aur aap ki madad bhi poori karunga.',
      urdu: 'سچ کہوں تو تھوڑا برا لگا — لیکن میں یہیں ہوں، اور آپ کی مدد بھی پوری کروں گا۔',
      punjabi: 'سچ کہواں تے تھوڑا برا لگیا — پر میں ایتھے ای واں، تے تہاڈی مدد وی پوری کراں گا۔',
      'roman-punjabi': 'Sach kahwan te thoda bura laggeya — par main ethe hi haan, te tuhadi madad vi poori karanga.'
    },

    /* --- P4e. Follow-ups (makeFollowups L6702, 3 each; Punjabi
       lines translate the live Roman Urdu follow-ups). --- */
    'followup.1': {
      en: 'Tell me more detail about this',
      roman: 'Is ki mazeed tafseel batao',
      urdu: 'اس کی مزید تفصیل بتائیں',
      punjabi: 'ایس دی ہور تفصیل دسو',
      'roman-punjabi': 'Is di hor tafseel dasso'
    },
    'followup.2': {
      en: 'What are the pros and cons?',
      roman: 'Is ke fayde aur nuqsan kya hain?',
      urdu: 'اس کے فائدے اور نقصان کیا ہیں؟',
      punjabi: 'ایس دے فائدے تے نقصان کی ہن؟',
      'roman-punjabi': 'Is de fayde te nuqsan ki han?'
    },
    'followup.3': {
      en: 'Give me a simple example',
      roman: 'Is ki ek asaan misal do',
      urdu: 'اس کی ایک آسان مثال دیں',
      punjabi: 'ایس دی اک سوکھی مثال دیو',
      'roman-punjabi': 'Is di ik sokhi misaal deyo'
    }
  };

  /* The 10 live CLARIFY_T reason groups (L1518-1590). `no-referent`
     has the two-option form; the single form lives under
     `clarify.no-referent-single`. */
  var CLARIFY_REASONS = ['empty-message', 'research-word-no-topic',
    'pronoun-only-no-topic', 'tell-more-no-topic',
    'research-verb-pronoun-no-topic', 'chahiye-no-topic',
    'bare-topic-fragment', 'no-referent', 'destructive-unclear-target',
    'generic'];

  /* Punjabi greeting markers (P4e): Shahmukhi patterns for the
     small-talk `cat` regexes, and Roman markers for the rLang step.
     `shukriya` is shared with Roman Urdu, so it never decides
     Punjabi on its own — it only counts together with a distinctive
     Punjabi marker. */
  /* Distinctive Shahmukhi Punjabi markers ONLY (the v61 detectLanguage
     Punjabi set, LANGUAGE-SPEC.md section 1) — shared words like
     شکریہ / اللہ حافظ are Urdu too and must NEVER decide Punjabi on
     their own. Used wherever a LANGUAGE (not a category) is decided. */
  var PUNJABI_DISTINCT_RE = /لبھو|ویکھو|چھڈو|چکو|وکھ|توں|تسی|تواڈا|ایس\s+دے|پاسے|ست سری اکال|کی حال اے|کی حال اے|تہاڈے|تہاڈی|مینوں|تینوں/;
  var ROMAN_PUNJABI_RE = /\b(sat sri akal|waheguru|ki haal|kiddan|kidda|tusi|tussi|vekho|labho|dasso|daso|mainu|tainu|tuhanu|tuhada|twada|saada|changa|kive|kiwen)\b/i;
  var ROMAN_URDU_RE = /(^|\s)(kia|kya|kesay|kese|kaise|aur sunao|shukriya|bohat|bahut|mehrbani|acha|achha|theek|thik|han|haan|allah hafiz|khuda hafiz)(\s|$)/;

  /* ------------------------------------------------------------------
     normaliseLang(code) — P1 canonical mapping, local copy. Piece 44
     owns the canonical version; the assembler MUST prefer
     window.EnzoLang44.normaliseLang when it exists (see
     getResolver / normaliseLang below). This copy is byte-identical
     in behaviour so the piece works standalone in the harness.
     'pa' -> 'punjabi' is the P4f refusal-path mapping (live L7754
     refusalLang may carry 'pa'); 'ur' -> 'urdu' is the legacy value.
     Unknown / missing -> 'en'. No logging, no toast.
     ------------------------------------------------------------------ */
  function normaliseLang(code){
    var c = String(code == null ? '' : code).toLowerCase().replace(/^\s+|\s+$/g, '');
    if(c === 'ur') return 'urdu';
    if(c === 'pa') return 'punjabi';
    if(c === 'english') return 'en';
    if(c === 'en' || c === 'urdu' || c === 'roman' || c === 'punjabi' || c === 'roman-punjabi' || c === 'hindi') return c;
    return 'en';
  }

  /* Resolve the piece-44 resolver when it is available:
     window.EnzoLang44.resolveAnswerLang (assembled build) or an
     injected function passed as `resolver`. Returns null when neither
     exists — callers then use the supplied language as-is. */
  function getResolver(resolver){
    if(typeof resolver === 'function') return resolver;
    if(root && root.EnzoLang44 && typeof root.EnzoLang44.resolveAnswerLang === 'function') return root.EnzoLang44.resolveAnswerLang;
    return null;
  }

  /* Resolve the answer language for a text: piece 44 wins; without
     it, the caller's language (normalised) is used — never legacy
     detectLang, never a home-made detector. */
  function resolveLangFor(text, pref, resolver){
    var r = getResolver(resolver);
    if(r){
      try{ return normaliseLang(r(text, pref)); }catch(e){}
    }
    return normaliseLang(pref && pref !== 'auto' ? pref : 'en');
  }

  /* Substitute {placeholders} in a string from vars. Unknown keys
     are left untouched so a caller bug is visible, never silent. */
  function fill(str, vars){
    var v = vars || {};
    return String(str).replace(/\{([a-zA-Z]+)\}/g, function(m, k){
      return (typeof v[k] !== 'undefined' && v[k] !== null) ? String(v[k]) : m;
    });
  }

  /* ------------------------------------------------------------------
     t(key, lang, vars) — the lookup. Fallback order (spec):
       1. exact language
       2. script sibling (punjabi -> urdu, roman-punjabi -> roman)
       3. LOUD FAILURE: throw. Never English for punjabi /
          roman-punjabi, never silent for any language.
     `lang` is normalised first (so 'pa' / 'ur' / 'english' resolve).
     An unknown key throws too. vars fills {t}/{a}/{b}/{name}/{task}/
     {Lang}/{Used}; a missing var leaves the token visible.
     ------------------------------------------------------------------ */
  function t(key, lang, vars){
    var entry = STRINGS[key];
    if(!entry) throw new Error('EnzoLang47: unknown string key "' + key + '"');
    var L = normaliseLang(lang);
    var val = entry[L];
    if(typeof val === 'string' && val !== '') return fill(val, vars);
    var sib = SIBLING[L];
    if(sib && typeof entry[sib] === 'string' && entry[sib] !== '') return fill(entry[sib], vars);
    throw new Error('EnzoLang47: missing string for key "' + key + '" in language "' + L + '" (no English fallback for Punjabi)');
  }

  /* Language-name helper for the {Lang} / {Used} slots of
     ttsNoVoice: the name of `code` written in language `inLang`. */
  function langNameIn(code, inLang){
    var c = normaliseLang(code);
    if(c === 'punjabi') return t('langName.punjabi', inLang);
    if(c === 'urdu' || c === 'roman') return t('langName.urdu', inLang);
    return t('langName.english', inLang);
  }

  /* P4d (used by P3d noteTtsFallback): the honest no-voice message in
     the ANSWER language. `requested` is the language asked for
     (usually 'punjabi' / 'roman-punjabi'); `used` is the voice family
     actually used ('urdu' or 'english'). */
  function noVoiceMessage(lang, requested, used){
    var L = normaliseLang(lang);
    return t('ttsNoVoice', L, {
      Lang: langNameIn(requested || L, L),
      Used: langNameIn(used || 'urdu', L)
    });
  }

  /* P4c: the Listen Aloud label for a player state in a language.
     state: 'idle' (Listen Aloud) | 'playing' (Pause) | 'paused'
     (Resume). `lang` is the MESSAGE's language (m.lang) at render
     time, or player.lang in syncVoiceBar. */
  function listenLabel(state, lang){
    if(state === 'playing') return t('listen.pause', lang);
    if(state === 'paused') return t('listen.resume', lang);
    return t('listen.listen', lang);
  }

  /* ==================================================================
     PATCH FUNCTIONS — for the assembler to wire at the exact live
     sites. Each one is pure (or DOM-scoped and guarded) and returns
     what it rendered so the harness can assert it without a browser.
     ================================================================== */

  /* PATCH C1 — clarifyQuestion replacement (live L1591-1602).
     Drop-in replacement for live clarifyQuestion(text, reason, lang,
     options): the allow-list now includes 'roman-punjabi' (P4a), the
     reason falls back to 'generic' exactly as live, and every string
     comes from STRINGS via t(). `options` is [a, b] for no-referent.
     Hindi (out of scope) is delegated to the original live function
     when passed as the 5th argument — see the code.
     Assembler: replace the live clarifyQuestion body with a call to
     EnzoLang47.clarifyQuestion47, or inline this body at L1591.
       BEFORE: var L = (lang === 'urdu' || ... || lang === 'punjabi')
                       ? lang : 'en';
       AFTER:  var L = EnzoLang47.clarifyLang(lang);
     and every g[L] template read becomes EnzoLang47.t(...). */
  function clarifyLang(lang){
    var L = normaliseLang(lang);
    if(L === 'en' || L === 'urdu' || L === 'roman' || L === 'punjabi' || L === 'roman-punjabi') return L;
    if(L === 'hindi') return 'hindi'; /* kept as-is (out of P4 scope):
      clarifyQuestion47 delegates Hindi to liveFallback, never to STRINGS */
    return 'en';
  }

  function clarifyQuestion47(text, reason, lang, options, liveFallback){
    var L = clarifyLang(lang);
    if(L === 'hindi'){
      /* Hindi is NOT in Raja's four and STRINGS carries no Hindi
         templates (spec section 4: keep working where it exists, do
         not remove it). The assembler passes the ORIGINAL live
         clarifyQuestion as liveFallback so Hindi keeps its live
         templates; without one, English is used (never a crash). */
      if(typeof liveFallback === 'function'){
        try{ return liveFallback(text, reason, 'hindi', options); }catch(e){}
      }
      L = 'en';
    }
    var group = CLARIFY_T_HAS(reason) ? reason : 'generic';
    var topic = String(text || '').replace(/[?!.,]+$/g, '').replace(/^\s+|\s+$/g, '');
    var a = options && options[0] ? options[0] : null;
    var b = options && options[1] ? options[1] : null;
    if(group === 'bare-topic-fragment') return t('clarify.bare-topic-fragment', L, { t: topic });
    if(group === 'no-referent'){
      if(a && b) return t('clarify.no-referent', L, { a: a, b: b });
      return t('clarify.no-referent-single', L);
    }
    return t('clarify.' + group, L);
  }

  function CLARIFY_T_HAS(reason){
    return CLARIFY_REASONS.indexOf(reason) !== -1;
  }

  /* PATCH C2 — clarify callers pass the resolved language (P4a / G11).
     resolveClarifyLang(text, pref, resolver) returns the language the
     clarify call must use: piece 44's resolveAnswerLang when present
     (pref = state.langPref), else the supplied pref, else 'en'.
     Assembler: in shouldClarify (L1654+) and every other caller that
     builds a clarify question, replace the v61 `detectLanguage(raw)`
     / legacy `detectLang(text)` value with
       var lang = EnzoLang47.resolveClarifyLang(raw, state.langPref);
     and pass that lang to clarifyQuestion47. This is what makes the
     live CLARIFY_T Punjabi templates (L1518-1590) actually reachable —
     today the legacy path never passes 'punjabi'. */
  function resolveClarifyLang(text, pref, resolver){
    var r = getResolver(resolver);
    if(r){
      try{ return clarifyLang(r(text, pref)); }catch(e){}
    }
    if(pref && pref !== 'auto') return clarifyLang(pref);
    return 'en';
  }

  /* PATCH C3 — backendAsk L16167 hardcoded English fallback (P4b).
     BEFORE: deliverClarify(ctx, (route.intent && route.intent.clarifyQuestion)
                              || 'What would you like me to do?');
     AFTER:  deliverClarify(ctx, (route.intent && route.intent.clarifyQuestion)
                              || EnzoLang47.backendClarifyFallback(lang));
     `lang` is the resolved language already in scope in backendAsk
     (P2a: resolveAnswerLang(text, state.langPref)). The fallback uses
     the v61 templates via clarifyQuestion47, already in the user's
     language — including the new Roman Punjabi strings. */
  function backendClarifyFallback(lang){
    return clarifyQuestion47('', 'empty-message', lang);
  }

  /* PATCH C4 — Listen Aloud labels (P4c).
     patchSyncVoiceBar(wrapEl, playerState, lang): DOM patch for live
     syncVoiceBar L7640-7647. playerState: 'playing' | 'paused' |
     'idle' (derived from player.el/player.playing/player.paused at
     the call site); lang: the message's language (m.lang at render
     time) or player.lang. Replaces the three hardcoded English
     textContent assignments with listenLabel().
     BEFORE (L7647): if(lbl) lbl.textContent='Listen Aloud';
     AFTER:          EnzoLang47.patchSyncVoiceBar(wrapEl, playerState, lang);
     The two button templates (L5586, L5724) render the initial label
     from the message language at render time:
       <span> + EnzoLang47.listenLabel('idle', m.lang) + </span>
     instead of the hardcoded '<span>Listen Aloud</span>'.
     Returns the label written (or null when there is no button). */
  function patchSyncVoiceBar(wrapEl, playerState, lang){
    var label = listenLabel(playerState, lang);
    if(!wrapEl || typeof wrapEl.querySelector !== 'function') return label;
    try{
      var play = wrapEl.querySelector('[data-act="vbPlay"]');
      if(!play) return label;
      var lbl = play.querySelector('span');
      if(lbl) lbl.textContent = label;
    }catch(e){}
    return label;
  }

  /* PATCH C5 — vrReplyLang (live L48212-48219, P4e).
     BEFORE: explicit lang wins only for urdu/roman/en; Roman Urdu
             markers -> 'roman'; anything else -> 'en'.
     AFTER:  'punjabi' / 'roman-punjabi' pass through at the top, and
             a Roman Punjabi marker test + the Shahmukhi Punjabi regex
             run BEFORE the final `return 'en'`.
     `text` is the user's message; `lang` is the resolved language
     (piece 44) when the caller has it. Returns a canonical code. */
  function vrReplyLang47(text, lang){
    /* Explicit language wins ONLY when one was actually supplied.
       A missing / 'auto' language must fall through to detection
       from the message itself — returning 'en' here would silently
       answer a Punjabi message in English (standing accuracy rule). */
    var c = String(lang == null ? '' : lang).toLowerCase().replace(/^\s+|\s+$/g, '');
    if(c === 'ur') c = 'urdu';
    if(c === 'pa') c = 'punjabi';
    if(c === 'english') c = 'en';
    if(c === 'punjabi' || c === 'roman-punjabi' || c === 'urdu' || c === 'roman' || c === 'en') return c;
    var s = String(text || '');
    if(PUNJABI_DISTINCT_RE.test(s)) return 'punjabi';
    if(/[\u0600-\u06FF]/.test(s)) return 'urdu';
    if(ROMAN_PUNJABI_RE.test(s)) return 'roman-punjabi';
    if(/\b(kya|kia|kar|rahe|rahe ho|ho|hai|kaam|kidhar|kahan|kab|kitne|tum|aap|abhi|kaunsa|konsa|kis|kaise|kesay)\b/i.test(s)) return 'roman';
    return 'en';
  }

  /* PATCH C6 — conversationReply (live L48224+, P4e).
     conversationReply47(text, lang, ctx): same contract as live
     conversationReply(text, lang, {currentTask, isBusy}), but the
     R-table is STRINGS (all 5 languages) instead of the live
     roman/urdu/en table. `kind` is detected by the live
     vrConversationKind when present; the harness passes ctx.kind
     directly (test hook — the kind detector itself is NOT this
     piece's scope). Unknown kind -> 'general', exactly as live.
     `task` is ctx.currentTask, trimmed to 120 chars as live
     vrCleanTask does. */
  function conversationReply47(text, lang, ctx){
    var c = ctx || {};
    var kind = c.kind;
    if(!kind && root && typeof root.vrConversationKind === 'function'){
      try{ kind = root.vrConversationKind(text) || 'general'; }catch(e){ kind = 'general'; }
    }
    if(!kind) kind = 'general';
    var L = vrReplyLang47(text, lang);
    var task = String(c.currentTask || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 120);
    var busy = !!c.isBusy && !!task;
    var key = 'conv.' + kind;
    if((kind === 'doing' || kind === 'whichwork') && busy) key = 'conv.' + kind + '-busy';
    if(!STRINGS[key]) key = 'conv.general';
    return t(key, L, { task: task });
  }

  /* PATCH C7 — smallTalkReply (live L5138+, P4e).
     smallTalkReply47(text, lang, name, resolver): same contract as
     live smallTalkReply(text, lang) plus the name (default 'Raja',
     live: first word of loadPref('enao_name','Raja')) and the
     resolver (piece 44) for the reply language. Punjabi greeting
     patterns are added to the `cat` step: Shahmukhi
     'ست سری اکال' / 'کی حال اے' / 'شکریہ' variants and Roman
     'sat sri akal' / 'ki haal' / 'tusi ki haal' — and the rLang step
     resolves a Shahmukhi Punjabi greeting to 'punjabi' and a Roman
     Punjabi greeting to 'roman-punjabi' BEFORE falling back to
     roman / english. Returns null when the text is not small talk
     (exactly as live: core empty, >80 chars, or no category).
     The category regexes below are the live ones verbatim, plus the
     Punjabi additions; the live comboSmallTalkCat fallback is kept
     as a guarded call when it exists. */
  function smallTalkCat47(core){
    var cat = null;
    if(/^(assalam ?o? ?alaikum|assalamualaikum|assalam u alaikum|salam alaikum|aoa|salam|سلام|السلام علیکم|السلام علیکم ورحمتہ اللہ)$/.test(core)) cat = 'salam';
    else if(/^(hi+|hello+|hey+|hii+|hi there|hello there|hey there|hi enzo|hello enzo|hey enzo|namaste|hola|good morning|good afternoon|good evening)$/.test(core)) cat = 'greet';
    else if(/^(how are you|how are u|how r u|how is it going|how's it going|whats up|what's up|sup|kia hal ha|kia haal ha|kia hal hai|kya haal hai|kya hal hai|kia haal hai|kesay ho|kese ho|kaise ho|aap kesay ho|aap kaise ho|tum kesay ho|kya ho raha hai|aur sunao|kya haal chaal|کیا حال ہے|کیا حال ہیں|آپ کیسے ہیں|کیسے ہو)$/.test(core)) cat = 'howru';
    else if(/^(hello|hi|hey|salam) (how are you|kia hal ha|kya haal hai|kesay ho|kaise ho)$/.test(core)) cat = 'howru';
    else if(/^(thanks|thank you|thank you so much|thanks a lot|shukriya|bohat shukriya|bahut shukriya|mehrbani|شکریہ|بہت شکریہ)$/.test(core)) cat = 'thanks';
    else if(/^(bye|goodbye|bye bye|good night|allah hafiz|khuda hafiz|see you|see you later|take care|اللہ حافظ|خدا حافظ)$/.test(core)) cat = 'bye';
    else if(/^(ok|okay|acha|achha|theek hai|thik hai|theek|han|haan|ji|great|nice|awesome|cool|perfect|good|very good)$/.test(core)) cat = 'ack';
    /* P4e Punjabi additions (same categories, Punjabi greetings).
       "Sat Sri Akal" / "Waheguru" get their own category (see the
       satsriakal STRINGS note) — never the Muslim salam reply. */
    else if(/^(sat sri akal|sat sri akaal|waheguru|ست سری اکال)$/.test(core)) cat = 'satsriakal';
    else if(/^(ki haal|ki haal ae|tusi ki haal|tusi kiddan|kiddan ho|ki haal chaal|کی حال اے|کی حال اے|تسی کی حال اے|تسی کِدّاں او|کی حال چال)$/.test(core)) cat = 'howru';
    else if(/^(shukriya|شکریہ|بہت شکریہ|bohat shukriya|bahut shukriya|mehrbani|دھنواد)$/.test(core)) cat = 'thanks';
    else if(/^(bye|اللہ حافظ|خدا حافظ|رَبّ راکھا|rab rakha)$/.test(core)) cat = 'bye';
    if(!cat && root && typeof root.comboSmallTalkCat === 'function'){
      try{ cat = root.comboSmallTalkCat(core); }catch(e){}
    }
    return cat;
  }

  function smallTalkRLang47(core, lang, resolver){
    var r = getResolver(resolver);
    if(r){
      try{
        var resolved = r(core, lang);
        if(resolved) return clarifyLang(resolved);
      }catch(e){}
    }
    var L = normaliseLang(lang);
    /* Shahmukhi Punjabi greeting -> 'punjabi' first (before the
       live Urdu-script rule, which would otherwise swallow it) —
       but ONLY on a distinctive Punjabi marker; a shared word like
       شکریہ stays Urdu, exactly as live. */
    if(PUNJABI_DISTINCT_RE.test(core)) return 'punjabi';
    if(/[\u0600-\u06FF]/.test(core)) return 'urdu';
    /* Roman Punjabi greeting -> 'roman-punjabi' before Roman Urdu. */
    if(ROMAN_PUNJABI_RE.test(core)) return 'roman-punjabi';
    if(ROMAN_URDU_RE.test(core)) return 'roman';
    if(L === 'punjabi' || L === 'roman-punjabi' || L === 'urdu' || L === 'roman' || L === 'en') return L;
    return 'en';
  }

  function smallTalkReply47(text, lang, name, resolver){
    var core = String(text || '').toLowerCase().replace(/[.!?,~…:;"()«»]+/g, ' ').replace(/\s+/g, ' ').trim();
    if(!core || core.length > 80) return null;
    var cat = smallTalkCat47(core);
    if(!cat) return null;
    var n = String(name || 'Raja').split(' ')[0] || 'Raja';
    var rLang = smallTalkRLang47(core, lang, resolver);
    return t('smalltalk.' + cat, rLang, { name: n });
  }

  /* PATCH C8 — EMO_LINES (live L16803 + L16839, P4e).
     BEFORE (L16839): var line = EMO_LINES[emo][msg.lang] || EMO_LINES[emo].en;
     AFTER:  var line = EnzoLang47.emoLine47(emo, msg.lang);
     emoLine47 returns the line in the message's language; a missing
     emotion or language throws (loud failure) instead of silently
     falling back to English — every emo kind has all 5 languages. */
  function emoLine47(emo, lang){
    return t('emo.' + emo, lang);
  }

  /* PATCH C9 — makeFollowups (live L6702-6706, P4e).
     BEFORE: if(lang==='urdu')...; if(lang==='roman')...; return [en...];
     AFTER:  return EnzoLang47.followups47(lang);
     Returns the 3 follow-ups in the resolved language (Punjabi gets
     Punjabi follow-ups, not English ones). */
  function followups47(lang){
    return [t('followup.1', lang), t('followup.2', lang), t('followup.3', lang)];
  }

  /* PATCH C10 — call flow, refusal language (P4f, live L7754).
     normaliseRefusalLang(code): maps the refusal language through
     normaliseLang before maybeSpeak, so 'ur' -> 'urdu' and 'pa' ->
     'punjabi' (a 'pa'/'punjabi' refusal no longer lands in speakText
     as en-US — P3 maps it to pa-PK). Assembler: at L7754, replace
     the refusalLang pass-through with
       EnzoLang47.normaliseRefusalLang(refusalLang).
     maybeSpeak (L7486-7495) already passes msg.lang through — no
     change there once msg.lang is canonical (P2a).
     NOTE (P4f, checked, not guessed): the setVoiceState('on',
     'Answer ready…') status line at L7495 is a developer status
     line rendered through the centre-face state machine, not a
     user-facing chat string — it is left English by this piece, as
     the spec allows ("leave English only if it is a developer
     status line"). */
  function normaliseRefusalLang(code){
    return normaliseLang(code);
  }

  var EnzoLang47 = {
    VERSION: VERSION,
    LANGS: LANGS,
    STRINGS: STRINGS,
    CLARIFY_REASONS: CLARIFY_REASONS,
    t: t,
    fill: fill,
    normaliseLang: normaliseLang,
    langNameIn: langNameIn,
    noVoiceMessage: noVoiceMessage,
    listenLabel: listenLabel,
    clarifyLang: clarifyLang,
    clarifyQuestion47: clarifyQuestion47,
    resolveClarifyLang: resolveClarifyLang,
    resolveLangFor: resolveLangFor,
    backendClarifyFallback: backendClarifyFallback,
    patchSyncVoiceBar: patchSyncVoiceBar,
    vrReplyLang47: vrReplyLang47,
    conversationReply47: conversationReply47,
    smallTalkCat47: smallTalkCat47,
    smallTalkRLang47: smallTalkRLang47,
    smallTalkReply47: smallTalkReply47,
    emoLine47: emoLine47,
    followups47: followups47,
    normaliseRefusalLang: normaliseRefusalLang
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoLang47 = EnzoLang47;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoLang47;

})(typeof window !== 'undefined' ? window : this);
