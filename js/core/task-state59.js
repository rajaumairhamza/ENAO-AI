
/* ============================================================================
 * v59-live-research-fix ADDITIONS — three fixes in one place:
 *
 * 1) EnzoTaskState59 — ONE single source of truth for active-task state.
 *    The 'Searching...' typing indicator, the 'ENZO IS WORKING' status pill,
 *    the Live Screen button empty state, and the Live Video control ON/OFF
 *    state ALL read this same state (the pill reads it via the source patch
 *    in currentStatus(); the button and the live controls read it here).
 *    Rules: no active task = no 'Searching...', no 'ENZO IS WORKING', Live
 *    Video OFF. A task exists = the Live Screen opens that task. A video or
 *    search request registers a real (local) task here the moment it starts
 *    and clears it the moment it ends, fails or is cancelled.
 *    HARNESS NOTE: indicator state and monitor empty-state must agree for
 *    the same task id — for any task id, (typing indicator visible OR pill
 *    WORKING) implies EnzoTaskState59.activeTask() is non-null, and
 *    activeTask() === null implies no 'Searching...' indicator, pill not
 *    WORKING, Live Video OFF, and the Live Screen button may show its
 *    (localised) no-task message.
 *
 * 2) Play/video orders ('youtube per sidhu musy wala chalao', 'Sidhu Moose
 *    Wala ka gana chalao', 'play a video of cats on youtube', 'youtube par
 *    cricket highlights dikhao') are MEDIA orders, not research questions:
 *    they run EnzoVideo.searchVideos directly, create a real task in
 *    EnzoTaskState59, and deliver playable results in the chat. They are
 *    never blocked by the research-task gate and never produce the
 *    'start a research question first' message.
 *
 * 3) Capabilities self-description: 'aap kya kya kar sakte ho' and its
 *    family (English / Urdu script / Roman Urdu) are answered DIRECTLY from
 *    the ONE inventory below (EnzoCapabilities59.INVENTORY) — full detail,
 *    in the user's language, honest limits included. Never research mode,
 *    never a clarifying question.
 * Style: plain ES5, no modules, zero emojis.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1) EnzoTaskState59 — single source of truth for active-task state   */
  /* ------------------------------------------------------------------ */
  var TERMINAL59 = { completed: 1, partially_completed: 1, failed: 1, cancelled: 1, done: 1 };
  var backendTask59 = null;      /* {taskId, kind, at} — real backend task */
  var localTasks59 = {};         /* localId -> {kind, at} — video/search tasks created on this page */
  var localSeq59 = 0;
  var searchInFlight59 = 0;
  var searchKind59 = 'search';
  var videoPlaying59 = false;
  var genObservedSince59 = null;
  var STUCK_MS59 = 90000;

  function beginBackendTask(taskId) {
    if (taskId) backendTask59 = { taskId: String(taskId), kind: 'research', at: Date.now() };
  }
  function endBackendTask(taskId) {
    if (backendTask59 && (!taskId || backendTask59.taskId === String(taskId))) backendTask59 = null;
  }
  function beginLocalTask(kind) {
    var id = 'local-' + (++localSeq59) + '-' + Date.now();
    localTasks59[id] = { kind: kind || 'search', at: Date.now() };
    return id;
  }
  function endLocalTask(id) { if (id) delete localTasks59[id]; }
  function firstLocal59() {
    for (var k in localTasks59) {
      if (Object.prototype.hasOwnProperty.call(localTasks59, k)) {
        return { taskId: null, kind: localTasks59[k].kind, local: true, localId: k };
      }
    }
    return null;
  }
  function activeTask() {
    if (backendTask59) return { taskId: backendTask59.taskId, kind: backendTask59.kind, backend: true };
    var t = window.__v2Task;
    if (t && t.taskId && (t.state === 'running' || t.state === 'paused')) {
      return { taskId: String(t.taskId), kind: 'research', backend: true };
    }
    try {
      var st = (window.EnzoMonitor && typeof window.EnzoMonitor.getState === 'function') ? window.EnzoMonitor.getState() : null;
      if (st && st.activeTaskId) {
        var e = st.tasks && st.tasks[st.activeTaskId];
        var s = e && e.task && e.task.state;
        if (!s || !TERMINAL59[s]) return { taskId: String(st.activeTaskId), kind: 'research', backend: true };
      }
    } catch (e) {}
    var lt = firstLocal59();
    if (lt) return lt;
    if (searchInFlight59 > 0) return { taskId: null, kind: searchKind59, local: true };
    if (videoPlaying59) return { taskId: null, kind: 'video', local: true };
    try {
      if (window.state && window.state.isGenerating) return { taskId: null, kind: 'answer', local: true };
    } catch (e) {}
    return null;
  }
  function isActive() { return !!activeTask(); }
  window.EnzoTaskState59 = {
    activeTask: activeTask,
    isActive: isActive,
    beginBackendTask: beginBackendTask,
    endBackendTask: endBackendTask,
    beginLocalTask: beginLocalTask,
    endLocalTask: endLocalTask,
    VERSION: 'v59-live-research-fix'
  };

  /* Every live search through window.searchWeb is a real task while it runs. */
  try {
    if (typeof window.searchWeb === 'function') {
      var prevSW59 = window.searchWeb;
      window.searchWeb = function (q, deep) {
        searchInFlight59++;
        searchKind59 = /\b(video|youtube|song|gana|music)\b/i.test(String(q || '')) ? 'video' : 'search';
        var done59 = false;
        function dec59() { if (!done59) { done59 = true; searchInFlight59 = Math.max(0, searchInFlight59 - 1); } }
        try {
          var r59 = prevSW59.apply(this, arguments);
          if (r59 && typeof r59.then === 'function') r59.then(dec59, dec59); else dec59();
          return r59;
        } catch (e) { dec59(); throw e; }
      };
    }
  } catch (e) {}

  /* A video actually playing is a live video task. */
  document.addEventListener('play', function (e) { if (e && e.target && e.target.tagName === 'VIDEO') videoPlaying59 = true; }, true);
  document.addEventListener('pause', function (e) { if (e && e.target && e.target.tagName === 'VIDEO') videoPlaying59 = false; }, true);
  document.addEventListener('ended', function (e) { if (e && e.target && e.target.tagName === 'VIDEO') videoPlaying59 = false; }, true);

  /* ON-state styling for the live controls (View Live Research / Live Screen). */
  try {
    var css59 = document.createElement('style');
    css59.id = 'enzoV59LiveOnCss';
    css59.textContent = '#enzoMonitorBtn[data-on="true"],#enzoLiveScreenBtn[data-on="true"]{box-shadow:0 0 0 2px #22c55e inset}';
    document.head.appendChild(css59);
  } catch (e) {}

  /* Sync loop: Live Video / live controls derive ON/OFF from the SAME
     active-task state — never an independent flag, never reversed, never
     stale. Plus the stuck-state watchdog: generating with NO task behind
     it for over 90 s is cleared at this one choke point (indicator off,
     generating off, centre state idle), so 'Searching...' and
     'ENZO IS WORKING' can never outlive the task they belong to. */
  function sync59() {
    var act = activeTask();
    var on = !!act;
    try {
      var ids59 = ['enzoMonitorBtn', 'enzoLiveScreenBtn'];
      for (var i = 0; i < ids59.length; i++) {
        var b = document.getElementById(ids59[i]);
        if (b) b.setAttribute('data-on', on ? 'true' : 'false');
      }
      var lv = document.querySelectorAll('[data-live-video]');
      for (var j = 0; j < lv.length; j++) lv[j].setAttribute('data-on', on ? 'true' : 'false');
    } catch (e) {}
    try {
      var gen = !!(window.state && window.state.isGenerating);
      var backed = !!(act && (act.backend || act.taskId || act.localId || searchInFlight59 > 0 || videoPlaying59));
      if (gen && !backed) {
        if (!genObservedSince59) genObservedSince59 = Date.now();
        if (Date.now() - genObservedSince59 > STUCK_MS59) {
          genObservedSince59 = null;
          if (typeof hideTyping === 'function') hideTyping();
          if (typeof setGenerating === 'function') setGenerating(false);
          if (typeof setCentreEnzo === 'function') setCentreEnzo('idle');
        }
      } else {
        genObservedSince59 = null;
      }
    } catch (e) {}
  }
  EnzoPollLoop.registerPoller('sync59-watchdog', sync59, 5000, { kind: 'idle', jitter: false });
  sync59();   /* keep the immediate first sync */

  /* ------------------------------------------------------------------ */
  /* Shared chat-delivery helpers (same message shapes the page uses)    */
  /* ------------------------------------------------------------------ */
  function tl59() {
    try { return timeLabelFor(Date.now()); } catch (e) { return { daypart: '', daypartRoman: '', full: '' }; }
  }
  function langOf59(text) {
    var l = 'en';
    try { l = detectLang(text || ''); } catch (e) {}
    if (l === 'english') l = 'en';
    return (l === 'roman' || l === 'urdu') ? l : 'en';
  }
  function getChat59(text) {
    var chat = null;
    try { chat = activeChat(); } catch (e) {}
    if (!chat) { try { chat = createChat(String(text || '').slice(0, 42)); } catch (e) {} }
    return chat;
  }
  function pushUser59(chat, text, lang, viaVoice) {
    var tl = tl59();
    chat.messages.push({ role: 'user', text: text, lang: lang, viaVoice: !!viaVoice, ts: Date.now(), daypart: tl.daypart, daypartRoman: tl.daypartRoman, timeLabel: tl.full, files: [] });
  }
  function pushAi59(chat, text, lang, viaVoice, question, html, modeWhy) {
    var tl = tl59();
    var full = html || ((typeof mdToHtml === 'function') ? mdToHtml(text) : text);
    var m = { role: 'ai', html: full, plain: text, viaVoice: !!viaVoice, question: question, sources: [], deep: false, modeWhy: modeWhy || '', auto: false, followups: [], lang: lang, ts: Date.now(), daypart: tl.daypart, daypartRoman: tl.daypartRoman, timeLabel: tl.full, _fullHtml: full };
    chat.messages.push(m);
    return m;
  }
  function render59() {
    try { renderChatList(); } catch (e) {}
    try { renderMessages(true); } catch (e) {}
    try { saveChats(); } catch (e) {}
  }
  function speak59(m) {
    try {
      if (window.EnaoV54Voice) window.EnaoV54Voice.patchDirectSpeak(m, answersMode());
      else if (typeof maybeSpeak === 'function') maybeSpeak(m);
    } catch (e) {}
  }
  function esc59(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }

  /* ------------------------------------------------------------------ */
  /* 3) Capabilities — ONE inventory, kept in this single place          */
  /* ------------------------------------------------------------------ */
  var INVENTORY59 = {
    can: [
      { en: 'Live internet research with real sources: real links, publication dates, and only the source counts that were actually verified.',
        roman: 'Live internet research asal sources ke saath: asal links, publication dates, aur sirf wohi source counts jo asal mein verify hue hon.',
        urdu: 'لائیو انٹرنیٹ ریسرچ اصل ذرائع کے ساتھ: اصل لنکس، اشاعت کی تاریخیں، اور صرف وہی ذرائع گنتی جو اصل میں تصدیق شدہ ہو۔' },
      { en: 'Deep research: a big question is split into parts, my own agents work on the parts, and the progress is visible in the Live Research Monitor and the Live Screen.',
        roman: 'Deep research: bara sawal hisson mein bantta hai, mere apne agents un hisson par kaam karte hain, aur progress Live Research Monitor aur Live Screen mein nazar aati hai.',
        urdu: 'ڈیپ ریسرچ: بڑا سوال حصوں میں بٹتا ہے، میرے اپنے ایجنٹس ان حصوں پر کام کرتے ہیں، اور پیش رفت لائیو ریسرچ مانیٹر اور لائیو اسکرین میں نظر آتی ہے۔' },
      { en: 'Normal conversation and explanations from my own knowledge, without any search.',
        roman: 'Aam guftagu aur wazahatain mere apne ilm se, baghair kisi search ke.',
        urdu: 'عام گفتگو اور وضاحتیں میرے اپنے علم سے، بغیر کسی تلاش کے۔' },
      { en: 'Voice: a question asked by voice is answered by voice; a typed question is answered in text. Live call conversation is also available.',
        roman: 'Voice: voice se poocha gaya sawal voice mein jawab pata hai; likha hua sawal text mein. Live call par guftagu bhi ho sakti hai.',
        urdu: 'آواز: آواز سے پوچھا گیا سوال آواز میں جواب پاتا ہے؛ لکھا ہوا سوال متن میں۔ لائیو کال پر گفتگو بھی ہو سکتی ہے۔' },
      { en: 'Reminders: I can set reminders myself, and I speak them when they are due.',
        roman: 'Reminders: main khud reminders laga sakta hoon, aur waqt par bol kar batata hoon.',
        urdu: 'یاد دہانیاں: میں خود یاد دہانیاں لگا سکتا ہوں، اور وقت پر بول کر بتاتا ہوں۔' },
      { en: 'Learning: I learn from our conversations; what I have learned is visible in Settings and can be deleted there.',
        roman: 'Learning: main hamari guftagu se seekhta hoon; jo seekha hai wo Settings mein nazar aata hai aur wahan se delete bhi ho sakta hai.',
        urdu: 'سیکھنا: میں ہماری گفتگو سے سیکھتا ہوں؛ جو سیکھا ہے وہ سیٹنگز میں نظر آتا ہے اور وہاں سے حذف بھی ہو سکتا ہے۔' },
      { en: 'Videos: I can find and play videos from YouTube, Vimeo and Dailymotion with real links and thumbnails, and a playable player where the platform allows embedding.',
        roman: 'Videos: main YouTube, Vimeo aur Dailymotion se videos dhoond kar chala sakta hoon — asal links aur thumbnails ke saath, aur jahan platform ijazat de wahan chalne wala player bhi.',
        urdu: 'ویڈیوز: میں یوٹیوب، ویمیو اور ڈیلی موشن سے ویڈیوز ڈھونڈ کر چلا سکتا ہوں — اصل لنکس اور تھمب نیلز کے ساتھ، اور جہاں پلیٹ فارم اجازت دے وہاں چلنے والا پلیئر بھی۔' },
      { en: 'Social research on public content only: I can read public RSS/Atom feeds — YouTube channels, public subreddit feeds, Telegram channels, Threads, TikTok and Pinterest where they publish one. Facebook, Instagram and X cannot be read: their public pages are login- and JavaScript-gated and bot-protected, and their APIs are paid or review-gated — I say so plainly instead of pretending. Snapchat cannot be searched.',
        roman: 'Social research sirf public content par: main public RSS/Atom feeds parh sakta hoon — YouTube channels, public subreddit feeds, Telegram channels, Threads, TikTok aur Pinterest jahan wo feed publish karte hain. Facebook, Instagram aur X nahi parhe ja sakte: un ke public pages login- aur JavaScript-gated hain aur bot-protected hain, aur un ki APIs paid ya review-gated hain — main ye saaf kehta hoon, jhoota daawa nahi karta. Snapchat search nahi ho sakta.',
        urdu: 'سوشل ریسرچ صرف پبلک مواد پر: میں پبلک RSS/Atom فیڈز پڑھ سکتا ہوں — یوٹیوب چینلز، پبلک سب ریڈٹ فیڈز، ٹیلیگرام چینلز، تھریڈز، ٹک ٹاک اور پنٹرسٹ جہاں وہ فیڈ شائع کرتے ہیں۔ فیس بک، انسٹاگرام اور ایکس نہیں پڑھے جا سکتے: ان کے پبلک صفحات لاگ ان اور جاوا اسکرپٹ گیٹڈ ہیں اور بوٹ پروٹیکٹڈ ہیں، اور ان کی APIs پیڈ یا ریویو گیٹڈ ہیں — میں یہ صاف کہتا ہوں، جھوٹا دعویٰ نہیں کرتا۔ سنیپ چیٹ تلاش نہیں ہو سکتی۔' },
      { en: 'My own SEO toolkit: 9 tools with my own 0 to 100 scores. DA, DR, PA, PR and traffic figures are not available to me.',
        roman: 'Mera apna SEO toolkit: 9 tools, mere apne 0 se 100 scores ke saath. DA, DR, PA, PR aur traffic ke figures mere paas available nahi hain.',
        urdu: 'میرا اپنا ایس ای او ٹول کٹ: 9 ٹولز، میرے اپنے 0 سے 100 اسکورز کے ساتھ۔ DA، DR، PA، PR اور ٹریفک کے اعداد میرے پاس دستیاب نہیں ہیں۔' },
      { en: 'Building: websites and apps from a one-line order, built by my own agents and watchable live while they work. Everything I create is kept in the Library.',
        roman: 'Building: ek line ke order par websites aur apps — mere apne agents banate hain aur kaam live dekha ja sakta hai. Jo kuch main banata hoon wo Library mein mehfooz rehta hai.',
        urdu: 'تعمیر: ایک سطر کے حکم پر ویب سائٹس اور ایپس — میرے اپنے ایجنٹس بناتے ہیں اور کام لائیو دیکھا جا سکتا ہے۔ جو کچھ میں بناتا ہوں وہ لائبریری میں محفوظ رہتا ہے۔' },
      { en: 'Settings, including voice ID: voice ID accepts only Raja\'s commands.',
        roman: 'Settings, voice ID samait: voice ID sirf Raja ke commands qabool karti hai.',
        urdu: 'سیٹنگز، وائس آئی ڈی سمیت: وائس آئی ڈی صرف راجہ کے احکامات قبول کرتی ہے۔' }
    ],
    limits: [
      { en: 'I cannot read a whole website fully: I fetch one page at a time, about 6,000 characters per fetch.',
        roman: 'Main poori website mukammal nahi parh sakta: ek waqt mein ek page, har fetch mein takreeban 6,000 characters.',
        urdu: 'میں پوری ویب سائٹ مکمل نہیں پڑھ سکتا: ایک وقت میں ایک صفحہ، ہر فیچ میں تقریباً 6,000 حروف۔' },
      { en: 'I cannot control your own browser or computer. The Live Screen shows my own research environment, not your device.',
        roman: 'Main aap ke apne browser ya computer ko control nahi kar sakta. Live Screen mera apna research environment dikhati hai, aap ka device nahi.',
        urdu: 'میں آپ کے اپنے براؤزر یا کمپیوٹر کو کنٹرول نہیں کر سکتا۔ لائیو اسکرین میرا اپنا ریسرچ ماحول دکھاتی ہے، آپ کا آلہ نہیں۔' },
      { en: 'I cannot see private accounts, private messages or WhatsApp chats.',
        roman: 'Main private accounts, private messages ya WhatsApp chats nahi dekh sakta.',
        urdu: 'میں پرائیویٹ اکاؤنٹس، پرائیویٹ پیغامات یا واٹس ایپ چیٹس نہیں دیکھ سکتا۔' },
      { en: 'My SEO scores will not equal Ahrefs, Semrush or Moz scores: the data and the method are different.',
        roman: 'Mere SEO scores Ahrefs, Semrush ya Moz ke scores ke barabar nahi honge: data aur tareeqa mukhtalif hai.',
        urdu: 'میرے ایس ای او اسکورز Ahrefs، Semrush یا Moz کے اسکورز کے برابر نہیں ہوں گے: ڈیٹا اور طریقہ مختلف ہے۔' },
      { en: 'Voice ID and some mic behaviours are not yet verified on your device.',
        roman: 'Voice ID aur kuch mic behaviours abhi aap ke device par verified nahi hain.',
        urdu: 'وائس آئی ڈی اور کچھ مائیک رویے ابھی آپ کے آلے پر تصدیق شدہ نہیں ہیں۔' },
      { en: 'Video durations are mostly unknown: no free source provides them.',
        roman: 'Videos ki durations aksar maloom nahi hotin: koi free source ye nahi deta.',
        urdu: 'ویڈیوز کی مدت اکثر معلوم نہیں ہوتی: کوئی مفت ذریعہ یہ نہیں دیتا۔' }
    ]
  };
  var CAP_HEADS59 = {
    en: { intro: 'Here is, in full detail, what I can do — and, just as plainly, where my limits are.', can: 'What I can do', limits: 'My limits' },
    roman: { intro: 'Poori tafseel mein ye hai ke main kya kya kar sakta hoon — aur bilkul saaf taur par ye bhi ke meri limits kahan hain.', can: 'Main kya kar sakta hoon', limits: 'Meri limits' },
    urdu: { intro: 'پوری تفصیل میں یہ ہے کہ میں کیا کیا کر سکتا ہوں — اور بالکل صاف طور پر یہ بھی کہ میری حدود کہاں ہیں۔', can: 'میں کیا کر سکتا ہوں', limits: 'میری حدود' }
  };
  function capAnswer59(lang) {
    var L = (lang === 'urdu') ? 'urdu' : (lang === 'roman') ? 'roman' : 'en';
    var H = CAP_HEADS59[L];
    var lines = [H.intro, '', '**' + H.can + '**'];
    INVENTORY59.can.forEach(function (it) { lines.push('- ' + it[L]); });
    lines.push('', '**' + H.limits + '**');
    INVENTORY59.limits.forEach(function (it) { lines.push('- ' + it[L]); });
    return lines.join('\n');
  }
  var CAP_RE59 = [
    /what (all )?(can|could) (you|u) do\b/,
    /what (can|could) enzo do\b/,
    /(your|ur) (capabilit|abilit|features|functions)\b/,
    /(tumhare|tumhari|aapke|aapki|tumhara) features\b/,
    /features (kya|kia) (hain|hai)\b/,
    /(kya|kia) (kya|kia) kar (sakte|sakty|sakta) (ho|hain|hai)\b/,
    /(aap|tum|tu) (kya|kia) kar (sakte|sakty|sakta) (ho|hain|hai)\b/,
    /(aap|tum) (kya|kia) (kya|kia) kar (sakte|sakty|sakta)/,
    /kis kis kaam (mein|mai) (madad|tum|aap)/,
    /madad kar (sakte|sakty|sakta)/,
    /(آپ|تم) کیا کیا کر سکتے/,
    /کیا کیا کر سکتے (ہو|ہیں)/,
    /آپ کیا کر سکتے ہیں/,
    /تم کیا کر سکتے ہو/,
    /فیچرز کیا ہیں/,
    /کس کس کام میں مدد کر سکتے/
  ];
  function isCapabilitiesQuestion59(text) {
    var raw = String(text || '');
    var t = ' ' + raw.toLowerCase().replace(/\s+/g, ' ') + ' ';
    for (var i = 0; i < CAP_RE59.length; i++) {
      if (CAP_RE59[i].test(t) || CAP_RE59[i].test(raw)) return true;
    }
    return false;
  }
  function deliverCapabilities59(text, viaVoice) {
    var lang = langOf59(text);
    var chat = getChat59(text);
    if (!chat) return false;
    pushUser59(chat, text, lang, viaVoice);
    var m = pushAi59(chat, capAnswer59(lang), lang, viaVoice, text, null, 'Capabilities — answered from ENZO\'s own capability inventory (conversation, no research)');
    render59();
    try { if (typeof setCentreEnzo === 'function') setCentreEnzo('idle'); } catch (e) {}
    speak59(m);
    return true;
  }
  window.EnzoCapabilities59 = { INVENTORY: INVENTORY59, isQuestion: isCapabilitiesQuestion59, answer: capAnswer59 };

  /* ------------------------------------------------------------------ */
  /* 2) Play/video orders — media orders, never research questions       */
  /* ------------------------------------------------------------------ */
  function playTopic59(text) {
    var t = String(text || '').toLowerCase();
    t = t.replace(/\b(youtube|yt|video|videos|gana|gaana|song|songs|geet|music|movie|film|please|plz|zara|bhai|yaar)\b/g, ' ');
    t = t.replace(/\b(chalao|chala do|chalado|bajao|baja do|sunao|suna do|dikhao|dikha do|dekho|dekhna|play|show|watch|me|per|par|pe|pr|ka|ki|ke|a|an|the|of|on|for|mein|main)\b/g, ' ');
    t = t.replace(/(یوٹیوب|ویڈیو|گانا|گانے|چلاؤ|چلا دو|بجاؤ|سناؤ|دکھاؤ|دیکھو|پر|کا|کی|کے)/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (t) return t;
    var m = String(text || '').toLowerCase().match(/\b(youtube|yt|video|videos|instagram|tiktok|facebook|twitter|reddit|linkedin|pinterest|snapchat|telegram|threads|vimeo|dailymotion|reels|reel|shorts|short|stories|story|clips|clip|live|stream|gana|gaana|song|songs|geet|music|movie|film)\b/g);
    if (m && m.length) return m.join(' ');
    return String(text || '').trim();
  }
  function isPlayOrder59(text) {
    var raw = String(text || '');
    var t = ' ' + raw.toLowerCase() + ' ';
    if (/live\s+(screen|research|view|monitor)/.test(t)) return false;
    var playVerb = /\b(chalao|chala do|chalado|bajao|baja do|sunao|suna do|play)\b/.test(t);
    var showVerb = /\b(dikhao|dikha do|dekho|dekhna|show|watch)\b/.test(t);
    var mediaWord = /\b(youtube|yt|video|videos|instagram|tiktok|facebook|twitter|reddit|linkedin|pinterest|snapchat|telegram|threads|vimeo|dailymotion|reels|reel|shorts|short|stories|story|clips|clip|live|stream|gana|gaana|song|songs|geet|music|movie|film)\b/.test(t);
    var urduPlay = /(چلاؤ|چلا دو|بجاؤ|سناؤ|دکھاؤ)/.test(raw);
    var urduShow = /(دکھاؤ|دیکھو)/.test(raw);
    var urduMedia = /(یوٹیوب|ویڈیو|گانا|گانے|موسیقی|انسٹاگرام|ٹک ٹاک|فیس بک|ریلز|شارٹس|سٹوریز|کلپ|فلم|مووی)/.test(raw);
    var topic = playTopic59(raw);
    var hasTopic = topic.length >= 3;
    if (urduPlay && (urduMedia || hasTopic)) return true;
    if (urduShow && urduMedia) return true;
    if (playVerb && (mediaWord || hasTopic)) return true;
    if (showVerb && mediaWord) return true;
    return false;
  }
  var VIDEO_TXT59 = {
    en: { found: 'Here are the videos I found. Tap a result to play it.', none: 'I could not find a playable video for that — the video search returned no real video links. Try another name and I will search again.', fail: 'The video search could not run just now. Nothing was made up — try again in a moment.' },
    roman: { found: 'Ye rahi videos jo mili. Chalane ke liye kisi result par tap karein.', none: 'Is par koi chalne wali video nahi mili — video search ne koi asal video link nahi diya. Koi aur naam bata dein, main dobara dhoond dunga.', fail: 'Video search is waqt nahi chal saki. Kuch banaya nahi gaya — thodi dair mein dobara koshish karein.' },
    urdu: { found: 'یہ رہی ویڈیوز جو ملیں۔ چلانے کے لیے کسی نتیجے پر ٹیپ کریں۔', none: 'اس پر کوئی چلنے والی ویڈیو نہیں ملی — ویڈیو تلاش نے کوئی اصل ویڈیو لنک نہیں دیا۔ کوئی اور نام بتا دیں، میں دوبارہ ڈھونڈ دوں گا۔', fail: 'ویڈیو تلاش اس وقت نہیں چل سکی۔ کچھ بنایا نہیں گیا — تھوڑی دیر میں دوبارہ کوشش کریں۔' }
  };
  function runVideoOrder59(text, viaVoice) {
    if (!window.EnzoVideo || typeof window.EnzoVideo.searchVideos !== 'function') return false;
    var lang = langOf59(text);
    var topic = playTopic59(text);
    var chat = getChat59(text);
    if (!chat) return false;
    if (chat.messages.length === 0) { try { chat.title = String(text || '').slice(0, 42); } catch (e) {} }
    pushUser59(chat, text, lang, viaVoice);
    render59();
    var localId = beginLocalTask('video');
    try {
      if (typeof setGenerating === 'function') setGenerating(true);
      if (typeof showTyping === 'function') showTyping();
      if (typeof setTypingStatus === 'function') setTypingStatus('Searching…');
      if (typeof setCentreEnzo === 'function') setCentreEnzo('researching');
    } catch (e) {}
    var deps = window.__enzoResearchDeps || {};
    var opts = { query: topic, maxResults: 6 };
    if (typeof deps.fetchJson === 'function') opts.fetchJson = deps.fetchJson;
    if (typeof deps.fetchText === 'function') opts.fetchText = deps.fetchText;
    function finish59(out, failed) {
      endLocalTask(localId);
      var T = VIDEO_TXT59[lang] || VIDEO_TXT59.en;
      var results = (out && Array.isArray(out.results)) ? out.results : [];
      var plain, html = null;
      if (results.length) {
        plain = T.found + '\n' + results.map(function (r, i) { return (i + 1) + '. ' + (r.title || r.url || '') + (r.url ? ' — ' + r.url : ''); }).join('\n');
        html = '<p>' + esc59(T.found) + '</p>';
        results.forEach(function (r) {
          try { html += window.EnzoVideo.videoCardHtml(r); }
          catch (e) { if (r && r.url) html += '<p><a href="' + esc59(r.url) + '" target="_blank" rel="noopener">' + esc59(r.title || r.url) + '</a></p>'; }
        });
      } else {
        plain = failed ? T.fail : T.none;
      }
      var m = pushAi59(chat, plain, lang, viaVoice, text, html, 'Video order — ENZO video search (media task, not a research task)');
      try {
        if (typeof hideTyping === 'function') hideTyping();
        if (typeof setGenerating === 'function') setGenerating(false);
        if (typeof setCentreEnzo === 'function') setCentreEnzo('idle');
      } catch (e) {}
      render59();
      speak59(m);
    }
    try {
      window.EnzoVideo.searchVideos(opts).then(function (out) { finish59(out, false); }, function () { finish59(null, true); });
    } catch (e) {
      finish59(null, true);
    }
    return true;
  }
  window.EnzoPlayOrder59 = { isPlayOrder: isPlayOrder59, topic: playTopic59 };

  /* ------------------------------------------------------------------ */
  /* Outermost ask wrapper: capabilities first, then play/video orders.  */
  /* Both are conversation/media paths — never research, never clarify.  */
  /* ------------------------------------------------------------------ */
  var prevAsk59 = window.askQuestion;
  if (typeof prevAsk59 === 'function') {
    window.askQuestion = function (text, viaVoice, forcedDeep) {
      try {
        if (text && typeof forcedDeep !== 'boolean') {
          var chat0 = null;
          try { chat0 = activeChat(); } catch (e) {}
          var pending0 = !!(chat0 && (chat0.pendingConfirm || chat0.pendingClarify || chat0.pendingClarifyLocal || chat0.pendingReminder));
          var hasFiles = false;
          try { hasFiles = !!(window.state && window.state.pendingFiles && window.state.pendingFiles.length); } catch (e) {}
          if (!pending0 && !hasFiles) {
            if (isCapabilitiesQuestion59(text)) {
              if (deliverCapabilities59(text, viaVoice)) return;
            }
            if (isPlayOrder59(text)) {
              if (runVideoOrder59(text, viaVoice)) return;
            }
          }
        }
      } catch (e) {}
      return prevAsk59(text, viaVoice, forcedDeep);
    };
  }
})();
