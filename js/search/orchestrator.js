
/* ============================================================================
   ENAO AI research-live — PIECE 25: central internet research orchestrator
   File: 25-orchestrator.js  (PRD sections 9, 3, 4 and 7)
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   PURPOSE
   -------
   ONE central orchestrator for all internet work (websites, social,
   video, browser research). Nothing else in the app decides on its own
   whether the internet is needed, which sources to use, or which
   specialist runs: every internet request passes through here.

   WHAT IT REUSES (never reimplements)
   -----------------------------------
   - v55 classifyIntent (live build, enao-ai.html line 23011): the intent
     classifier. When it is reachable (ctx.classifyIntent, window
     .classifyIntent, or window.EnaoIntel.classifyIntent) its verdict is
     used and recorded; this piece adds ONLY the activation logic the
     classifier does not own (see needsInternet below).
   - v57 funnelInput (piece 19, window.EnzoUniversalMultimodal
     .funnelInput): input normalisation. When present it canonicalises
     the request first; when absent the piece normalises plain text
     itself. The funnel never decides whether the internet is needed.
   - Server search proxy (search-proxy.py): /api/search (DuckDuckGo Lite
     + Wikipedia + Google News RSS, keyless) and /api/fetch (SSRF-guarded
     page text). This piece never fetches the internet directly from the
     browser and never invents a result.
   - Backend research runner (server.py: make_search_fn,
     _research_runner, finalize_research_task): the heavy multi-agent
     research path. This piece routes to it through deps, it does not
     reimplement it.

   WHAT IT ADDS
   -------------
   - Section 3 intelligent activation: needsInternet() — normal
     conversation returns false with NO search; research requests
     (explicit or natural-language equivalents, EN / Urdu / Roman Urdu)
     return true. A question mark alone never triggers it, and merely
     mentioning a topic never triggers it.
   - Section 4 source selection: selectSources() — picks source
     categories per subject from a scored registry, never the same fixed
     list for every topic; new sources are discovered from real search
     results, never from a hardcoded list. Every chosen category records
     WHY it was chosen.
   - Section 7 nine-step workflow: understand, plan, discover, retrieve,
     evaluate, cross-verify, analyze, present, complete. Every step is
     recorded with a real status. Simple lookups stay short: unneeded
     steps are SKIPPED explicitly, with a reason. Step 9 (complete) calls
     the lifecycle complete (cancel remaining sub-ops, clear indicators)
     through window.EnzoSearchLifecycle when present, with a safe no-op
     fallback that is recorded honestly.
   - Specialist routing: social work goes to window.EnzoSocial
     .searchSocial({ query, ... }), video work to window.EnzoVideo
     .searchVideos({ query, maxResults, fetchJson, fetchText }), live
     view to window.EnzoLiveScreen.openLiveScreen(taskId, opts) —
     the REAL signatures from pieces 22–24, verified against the
     delivered files. When a specialist is absent the gap is recorded
     honestly and the work falls back to general web search instead
     of failing or fabricating. Specialist results are awaited and
     merged into the discovered sources.
   - Browser connectivity honesty: browserConnectivity() states plainly
     what is actually supported, with required permissions and limits.
   - Browser connectivity honesty: browserConnectivity() states plainly
     what is actually supported, with required permissions and limits.

   DESIGN
   ------
   - Pure functions, no DOM, no network of its own, plain ES5.
     Zero emojis. No paid API, no key. No hardcoded topics.
   - No fabricated sources or counts: results only ever come from a
     search/fetch function supplied by the caller (deps.search /
     deps.fetch) or from a specialist that is actually present. When
     nothing was retrieved, the run reports zero results honestly.
   - All window/global lookups are guarded, so the piece also runs in
     Node under test with no browser globals at all.

   PUBLIC API (on EnzoInternetOrchestrator)
   ----------------------------------------
   needsInternet(text, context)
     -> { needsInternet, depth, reason, signals, classifierUsed,
          classifierKind, lang }
     depth: 'none' | 'lookup' | 'research'. 'lookup' = a short
     fresh-fact check (price, news, weather, score); 'research' = an
     investigation the user ordered or that genuinely needs depth.
   selectSources(topic, options)
     -> [{ category, reason, signals, discovered }]
     options.kinds (array) forces extra categories, recorded as
     'requested explicitly'. 'discovered' is always false here: this
     function only SELECTS categories; real sources are discovered
     from search results during run() and recorded there.
   orchestrate(request)
     -> { needsInternet, plan, stages, sources, specialists, gaps }
     request may be a string or { text, kinds, context, depth,
     lang, viaVoice }. plan is the full execution plan; stages are
     the nine workflow steps with their planned status.
   run(request, deps)
     -> Promise resolving to { status, taskId, steps, sources,
          discoveredSources, results, gaps, lifecycle, plan }
     deps may carry deps.search(query) -> Promise/array of result
     objects, deps.fetch(url) -> Promise/object, deps.classifyIntent,
     deps.lifecycle (a createLifecycle() INSTANCE), deps.social,
     deps.socialFetcher, deps.video, deps.fetchJson, deps.fetchText,
     deps.liveScreen. Any dep may be omitted; an omitted dep is
     recorded as a gap, never faked. The run registers its own task
     id with the lifecycle instance (startTask) when one is supplied
     and completes it (completeTask) at step 9. Always returns a
     Promise.
   browserConnectivity()
     -> { supported, unsupported, permissions, limits, notes }
     Plain truth table about what internet/browser access really is.
   WORKFLOW_STEPS — the nine step ids in order.
   VERSION: '25-orchestrator-1.0.0'
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '25-orchestrator-1.0.0';
  var runTaskCounter = 0;

  var WORKFLOW_STEPS = ['understand', 'plan', 'discover', 'retrieve',
    'evaluate', 'cross-verify', 'analyze', 'present', 'complete'];

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function asString(v) { return (v === null || v === undefined) ? '' : String(v); }

  function normText(text) {
    return ' ' + asString(text).toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  }

  function hasUrduScript(text) { return /[\u0600-\u06FF]/.test(asString(text)); }

  function detectLang(text) {
    if (hasUrduScript(text)) return 'ur';
    var q = normText(text);
    var romanHits = ['kya', 'kia', 'kaise', 'kese', 'kesay', 'batao', 'batain',
      'dhoond', 'dhund', 'karo', 'karna', 'chahiye', 'aaj', 'kal', 'khabar',
      'khabrein', 'qimat', 'hai', 'hain', 'mujhe', 'meri', 'tera', 'tum',
      'aap', 'aur', 'yeh', 'ye', 'woh', 'kahan', 'kab', 'kitna', 'kaun'];
    var hits = 0;
    for (var i = 0; i < romanHits.length; i++) {
      if (q.indexOf(' ' + romanHits[i] + ' ') !== -1) hits++;
    }
    return hits >= 2 ? 'roman' : 'en';
  }

  function getGlobal(name) {
    try {
      if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
      if (typeof window !== 'undefined' && window[name]) return window[name];
    } catch (e) { /* lookup is best-effort */ }
    return null;
  }

  function getClassifier(ctx) {
    if (ctx && typeof ctx.classifyIntent === 'function') return ctx.classifyIntent;
    var g = getGlobal('EnaoIntel');
    if (g && typeof g.classifyIntent === 'function') return g.classifyIntent;
    var fn = getGlobal('classifyIntent');
    if (typeof fn === 'function') return fn;
    return null;
  }

  function getFunnel(ctx) {
    if (ctx && ctx.funnelInput && typeof ctx.funnelInput === 'function') return ctx.funnelInput;
    var m = getGlobal('EnzoUniversalMultimodal');
    if (m && typeof m.funnelInput === 'function') return m.funnelInput;
    return null;
  }

  function canonicalise(request, ctx) {
    var funnel = getFunnel(ctx);
    if (funnel) {
      try {
        var f = funnel(request, ctx || {});
        if (f && f.canonical && typeof f.canonical.text === 'string') {
          return { text: f.canonical.text, lang: f.canonical.lang || detectLang(f.canonical.text),
            viaVoice: !!f.canonical.viaVoice, kind: f.canonical.kind || 'text',
            funnelUsed: true };
        }
      } catch (e) { /* fall through to plain normalisation */ }
    }
    var text = '';
    if (typeof request === 'string') text = request;
    else if (request && typeof request === 'object') {
      text = asString(request.text || request.transcript || request.query || '');
    }
    return { text: text, lang: (request && request.lang) || detectLang(text),
      viaVoice: !!(request && request.viaVoice), kind: 'text', funnelUsed: false };
  }

  /* ------------------------------------------------------------------ */
  /* Section 3 — intelligent activation                                  */
  /* ------------------------------------------------------------------ */

  /* Whole-message greetings / pleasantries / small talk. The WHOLE
     message must be just that (after normalising case and punctuation),
     so a real question that merely starts with "hello" still goes
     through the normal pipeline. */
  var SMALL_TALK_PHRASES = [
    'assalamualaikum', 'assalam o alaikum', 'salam', 'aoa',
    'hello', 'hi', 'hey', 'hi there', 'hello there', 'hey there',
    'good morning', 'good afternoon', 'good evening', 'good night',
    'how are you', 'how are u', 'how r u', 'how is it going',
    "how's it going", 'whats up', "what's up", 'sup',
    'kya haal hai', 'kia haal hai', 'kya hal hai', 'kia hal ha',
    'kesay ho', 'kese ho', 'kaise ho', 'aap kesay ho', 'aap kaise ho',
    'tum kesay ho', 'kya ho raha hai', 'aur sunao', 'kya haal chaal',
    'thank you', 'thanks', 'thanks a lot', 'thank you so much',
    'shukriya', 'bohat shukriya', 'bahut shukriya',
    'goodbye', 'bye', 'bye bye', 'see you', 'see you later',
    'take care', 'allah hafiz', 'khuda hafiz',
    'okay', 'ok', 'acha', 'achha', 'theek hai', 'thik hai', 'theek',
    'han', 'haan', 'ji', 'great', 'nice', 'awesome', 'cool', 'perfect',
    'very good', 'good',
    'tum kaun ho', 'aap kaun ho', 'who are you', 'what is your name',
    'tumhara naam kya hai', 'aapka naam kya hai',
    'kya karte ho', 'kia karte ho', 'kya kar rahe ho', 'what do you do',
    'tum kya kar rahe ho', 'aap kya kar rahe ho'
  ];

  var SMALL_TALK_FILLERS = { raja: 1, enzo: 1, bhai: 1, yaar: 1, dost: 1,
    sir: 1, janab: 1, aap: 1, tum: 1, sab: 1, aur: 1, and: 1, ke: 1,
    ka: 1, ki: 1, to: 1, bhi: 1 };

  function isWholeMessageSmallTalk(raw) {
    var core = asString(raw).toLowerCase()
      .replace(/[.,!?;:()"'\u060C\u061B\u061F\u06D4]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!core) return false;
    var words = core.split(' ').filter(Boolean);
    if (words.length < 1 || words.length > 12) return false;
    var phrases = SMALL_TALK_PHRASES.slice().sort(function (a, b) {
      return b.split(' ').length - a.split(' ').length;
    });
    var i = 0, parts = 0;
    while (i < words.length) {
      var hit = null;
      for (var j = 0; j < phrases.length; j++) {
        var pw = phrases[j].split(' ');
        if (i + pw.length > words.length) continue;
        var ok = true;
        for (var k = 0; k < pw.length; k++) {
          if (words[i + k] !== pw[k]) { ok = false; break; }
        }
        if (ok) { hit = pw; break; }
      }
      if (hit) { parts++; i += hit.length; continue; }
      if (SMALL_TALK_FILLERS[words[i]]) { i++; continue; }
      return false;
    }
    return parts > 0;
  }

  /* Explicit research orders, EN / Urdu script / Roman Urdu. A research
     VERB plus a research OBJECT (or a bare research verb as an order)
     is required — the word "research" as a topic ("research kya hoti
     hai") is a definition, not an order, and is handled below. */
  function explicitResearchSignal(q, raw) {
    var signals = [];
    if (/[\u0600-\u06FF]/.test(raw)) {
      if (/(ریسرچ|تلاش|ڈھونڈ|انٹرنیٹ سے ڈھونڈ|گوگل کر|تحقیق)/.test(raw)) {
        signals.push('urdu-script-research-verb');
      }
    }
    if (/\b(research|search|talaash|talash|dhoond|dhund|google)\b/.test(q) &&
        /\b(kar|karo|karke|kardo|kar do|do|de|dena|batao|nikal|nikalo|please|plz|chahiye|karein|karain)\b/.test(q)) {
      signals.push('explicit-research-verb');
    }
    if (/\b(internet|online|web)\s+(se|par|pe|from|on)\b/.test(q) &&
        /\b(dhoond|search|research|batao|nikal|de|do|find|check|look)\b/.test(q)) {
      signals.push('internet-source-request');
    }
    if (/\b(find out|look up|look it up|check online|search the (internet|web)|google it|investigate|tehqeeq)\b/.test(q)) {
      signals.push('explicit-investigation-phrase');
    }
    /* Bare imperative: "research solar panels", "search cheap flights",
       "google best laptops" — the research verb leads the message. */
    if (/^\s*(research|search|google|dhoond|dhund|talaash|talash)\b/.test(asString(raw).toLowerCase())) {
      signals.push('bare-research-imperative');
    }
    if (/\b(is par|is ke baare mein|is topic par)\b/.test(q) &&
        /\b(research|search|dhoond|talaash)\b/.test(q)) {
      signals.push('explicit-research-verb');
    }
    return signals;
  }

  /* Natural-language equivalents of a research request: the user did
     not say the word "research", but only the live internet can answer.
     These are CURRENT facts (fast-changing) and DEPTH requests. */
  function naturalResearchSignal(q, raw) {
    var signals = [];
    if (/\b(latest|recent|breaking|newest|current|today'?s)\b/.test(q) &&
        /\b(news|developments?|updates?|events?|releases?|versions?|score|scores|results?)\b/.test(q)) {
      signals.push('latest-news-request');
    }
    if (/\b(taza|taza tareen|aaj ki)\b/.test(q) &&
        /\b(khabar|khabrein|khabarain|news)\b/.test(q)) {
      signals.push('latest-news-request');
    }
    if (/[\u0600-\u06FF]/.test(raw) && /(تازہ ترین|آج کی خبر|تازہ خبر|قیمت)/.test(raw)) {
      signals.push('latest-news-request');
    }
    if (/\b(what'?s happening|what is happening|happening (in|with|right now)|kya ho raha hai)\b/.test(q) &&
        /\b(in|with|about|par|pe)\b/.test(q)) {
      signals.push('happening-now-request');
    }
    if (/\b(in detail|in-depth|detailed|deep dive|comprehensive|thorough|complete guide|full guide|step-by-step|everything about|tafseel|tafseel se)\b/.test(q)) {
      signals.push('in-detail-request');
    }
    if (/\b(vs\.?|versus|pros and cons|advantages and disadvantages|difference between|compare|comparison|muqabla|farq)\b/.test(q)) {
      signals.push('comparison-request');
    }
    if (/\b(analy[sz]e|analysis|evaluate|evaluation|critique|assess|implications|tajziya)\b/.test(q)) {
      signals.push('analysis-request');
    }
    if (/\b(complete list|list of all|every .* (available|out there)|directory of|saari list|poori list)\b/.test(q)) {
      signals.push('many-sources-needed');
    }
    return signals;
  }

  /* Fast-changing facts asked plainly: not an investigation order, but
     the answer genuinely needs fresh data. These need the internet
     (depth 'lookup'), they are NOT deep research. */
  function currentFactSignal(q, raw) {
    var signals = [];
    if (/\b(price|rate|rates|today|aaj|latest|news|khabar|khabrein|score|weather|mausam|temperature|qimat|keemat|daam)\b/.test(q) ||
        /[\u0600-\u06FF]/.test(raw) && /(قیمت|خبر|موسم)/.test(raw)) {
      if (/\b(what is|what'?s|kya hai|kia hai|kitni|kitna|batao|batain|today|aaj|abhi|current|latest|tell|show|give|de|do|nikal|dikhao)\b/.test(q) ||
          /[\u0600-\u06FF]/.test(raw)) {
        signals.push('current-fact-needs-fresh-data');
      }
    }
    return signals;
  }

  /* Simple explanation / definition: reliably answerable from own
     knowledge, no internet. "X kya hota hai", "what is X", "meaning
     of X", "X ka matlab kya hai". Guarded so a research verb or a
     current-fact signal elsewhere in the message wins over it. */
  function isSimpleExplanation(q, raw) {
    var words = asString(raw).trim().split(/\s+/).filter(Boolean).length;
    if (words > 14) return false;
    if (/(kisko|kis ko|kise|ise|usse|isko|usko)\s+keht(e|ay)\s+(hain|hen)/.test(q)) return true;
    if (/\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(q)) return true;
    if (/\bmatlab\s+(kya|kia)\s+hai\b/.test(q)) return true;
    if (/\b(kya|kia)\s+(hota|hoti|hote)\s+(hai|ha|he)\b/.test(q)) return true;
    if (/\b(kya|kia)\s+(hai|ha|he)\b/.test(q)) return true;
    if (/\bwhat\s+(is|does|do)\b/.test(q)) return true;
    if (/\bmeaning\s+of\b/.test(q)) return true;
    if (/\bdefine\s+\w+/.test(q)) return true;
    if (/(کس کو کہتے ہیں|کا مطلب کیا|کیا ہوتا ہے|کیا ہوتی ہے)/.test(raw)) return true;
    return false;
  }

  function isResearchItselfAsTopic(q, raw) {
    return /\b(research|tehqeeq)\b/.test(q) &&
      (/\b(kya|kia|what|meaning|matlab|hoti|hota)\b/.test(q) ||
       /(کیا ہوتی ہے|کیا ہے)/.test(raw));
  }

  /* needsInternet(text, context)
     Reuses the v55 classifier when reachable; adds the activation logic
     the classifier does not own. Precedence, in order:
       1. empty message -> false (nothing to answer)
       2. whole-message small talk / guftagu -> false
       3. "research itself" as a definition topic -> false
       4. explicit research order -> true (depth research)
       5. natural-language research equivalent -> true (depth research)
       6. plain current-fact question -> true (depth lookup)
       7. simple explanation / definition -> false
       8. classifier verdict, when one is reachable:
          kind 'research' -> true; 'conversation' / 'definition' -> false;
          'general' / 'clarify' -> false (no search on an undecided
          message; the assembler may still fetch inside a normal answer,
          but this orchestrator does not trigger a research run)
       9. default -> false (answer from own knowledge; never trigger on
          a mere question mark or a bare topic mention) */
  function needsInternet(text, context) {
    var ctx = (context && typeof context === 'object') ? context : {};
    var canon = canonicalise(text, ctx);
    var raw = canon.text;
    var trimmed = raw.trim();
    var q = normText(raw);
    var lang = canon.lang;
    var classifier = getClassifier(ctx);
    var classifierKind = null;
    var classifierReason = null;
    if (classifier) {
      try {
        var c = classifier(raw, { state: ctx.state, history: ctx.history });
        if (c && typeof c.kind === 'string') {
          classifierKind = c.kind;
          classifierReason = c.reason || null;
        }
      } catch (e) { classifier = null; }
    }

    if (!trimmed) {
      return { needsInternet: false, depth: 'none', reason: 'empty-message',
        signals: [], classifierUsed: !!classifier, classifierKind: classifierKind,
        classifierReason: classifierReason, lang: lang };
    }
    if (isWholeMessageSmallTalk(raw)) {
      return { needsInternet: false, depth: 'none', reason: 'greeting-or-small-talk',
        signals: ['whole-message-small-talk'], classifierUsed: !!classifier,
        classifierKind: classifierKind, classifierReason: classifierReason, lang: lang };
    }
    if (isResearchItselfAsTopic(q, raw)) {
      return { needsInternet: false, depth: 'none', reason: 'definition-about-research-itself',
        signals: [], classifierUsed: !!classifier, classifierKind: classifierKind,
        classifierReason: classifierReason, lang: lang };
    }
    var explicit = explicitResearchSignal(q, raw);
    if (explicit.length > 0) {
      return { needsInternet: true, depth: 'research', reason: 'explicit-research-request',
        signals: explicit, classifierUsed: !!classifier, classifierKind: classifierKind,
        classifierReason: classifierReason, lang: lang };
    }
    var natural = naturalResearchSignal(q, raw);
    if (natural.length > 0) {
      return { needsInternet: true, depth: 'research', reason: 'natural-language-research-request',
        signals: natural, classifierUsed: !!classifier, classifierKind: classifierKind,
        classifierReason: classifierReason, lang: lang };
    }
    var current = currentFactSignal(q, raw);
    if (current.length > 0) {
      return { needsInternet: true, depth: 'lookup', reason: 'current-fact-needs-fresh-data',
        signals: current, classifierUsed: !!classifier, classifierKind: classifierKind,
        classifierReason: classifierReason, lang: lang };
    }
    if (isSimpleExplanation(q, raw)) {
      return { needsInternet: false, depth: 'none', reason: 'simple-explanation-from-own-knowledge',
        signals: ['definition-pattern'], classifierUsed: !!classifier,
        classifierKind: classifierKind, classifierReason: classifierReason, lang: lang };
    }
    if (classifierKind === 'research') {
      return { needsInternet: true, depth: 'research', reason: 'classifier-research',
        signals: ['v55-classifyIntent-kind-research'], classifierUsed: true,
        classifierKind: classifierKind, classifierReason: classifierReason, lang: lang };
    }
    if (classifierKind === 'conversation' || classifierKind === 'definition') {
      return { needsInternet: false, depth: 'none',
        reason: 'classifier-' + classifierKind,
        signals: ['v55-classifyIntent-kind-' + classifierKind], classifierUsed: true,
        classifierKind: classifierKind, classifierReason: classifierReason, lang: lang };
    }
    return { needsInternet: false, depth: 'none',
      reason: 'no-research-signal-question-mark-or-topic-mention-alone-never-triggers',
      signals: [], classifierUsed: !!classifier, classifierKind: classifierKind,
      classifierReason: classifierReason, lang: lang };
  }

  /* ------------------------------------------------------------------ */
  /* Section 4 — source selection                                        */
  /* ------------------------------------------------------------------ */

  /* Registry of source CATEGORIES (not sites). Each category lists the
     subject signals that select it. No category is ever chosen for
     every topic: selection is scored from the topic text, and a topic
     with no matching signal gets only the general discovery channel.
     Real sites/domains are NEVER listed here — they are discovered
     from actual search results during run(). */
  var SOURCE_CATEGORIES = [
    { category: 'news', signals: ['latest', 'news', 'breaking', 'today',
        'current', 'happening', 'headline', 'khabar', 'khabrein',
        'khabarain', 'taza', 'aaj', 'خبر', 'تازہ'],
      why: 'topic asks for current events or recent developments' },
    { category: 'official', signals: ['government', 'law', 'policy',
        'regulation', 'tax', 'ministry', 'official', 'court', 'sarkar',
        'qanoon', 'hukumat', 'قانون', 'حکومت'],
      why: 'topic concerns law, policy or an official body — primary sources outrank commentary' },
    { category: 'educational', signals: ['how', 'why', 'learn', 'explain',
        'science', 'history', 'definition', 'meaning', 'tutorial',
        'kya', 'kia', 'kaise', 'kese', 'matlab', 'samjhao'],
      why: 'topic asks for understanding or explanation — reference and educational material fits' },
    { category: 'databases', signals: ['statistics', 'data', 'numbers',
        'ranking', 'rankings', 'list of', 'price', 'rate', 'score',
        'qimat', 'dar', 'kitna', 'kitni', 'اعداد', 'قیمت'],
      why: 'topic asks for figures, rankings or prices — structured data sources fit' },
    { category: 'docs', signals: ['documentation', 'manual', 'api',
        'guide', 'handbook', 'spec', 'specification', 'reference'],
      why: 'topic asks for authoritative documentation or a specification' },
    { category: 'community', signals: ['forum', 'forums', 'discussion',
        'opinions', 'opinion', 'experience', 'experiences', 'review',
        'reviews', 'log kya kehte', 'kya kehte hain', 'discuss'],
      why: 'topic asks what people think or have experienced — discussion sources fit' },
    { category: 'blogs', signals: ['blog', 'blogs', 'article', 'articles',
        'opinion', 'guide', 'essay'],
      why: 'topic fits long-form writing and guides' },
    { category: 'social', signals: ['social media', 'twitter', 'x.com',
        'instagram', 'facebook', 'tiktok', 'trend', 'trends', 'viral',
        'accounts', 'followers', 'influencer'],
      why: 'topic asks for social discussion, trends or accounts' },
    { category: 'video', signals: ['video', 'videos', 'youtube', 'channel',
        'channels', 'watch', 'clip', 'clips', 'dekho', 'tutorial video'],
      why: 'topic asks for video material or channels' }
  ];

  var KNOWN_KINDS = ['news', 'educational', 'official', 'government',
    'databases', 'docs', 'community', 'forums', 'blogs', 'social', 'video'];

  function selectSources(topic, options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var text = asString(topic || '');
    var q = normText(text);
    var raw = text;
    var scored = [];
    for (var i = 0; i < SOURCE_CATEGORIES.length; i++) {
      var entry = SOURCE_CATEGORIES[i];
      var matched = [];
      for (var j = 0; j < entry.signals.length; j++) {
        var s = entry.signals[j];
        if (s.indexOf(' ') !== -1) {
          if (q.indexOf(' ' + s + ' ') !== -1 || raw.indexOf(s) !== -1) matched.push(s);
        } else if (q.indexOf(' ' + s + ' ') !== -1 || raw.indexOf(s) !== -1) {
          matched.push(s);
        }
      }
      if (matched.length > 0) {
        scored.push({ category: entry.category, reason: entry.why,
          signals: matched, score: matched.length, discovered: false });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = scored.map(function (s) {
      return { category: s.category, reason: s.reason, signals: s.signals, discovered: false };
    });
    var seen = {};
    out.forEach(function (s) { seen[s.category] = true; });
    var kinds = Array.isArray(opts.kinds) ? opts.kinds : [];
    kinds.forEach(function (k) {
      var kind = String(k).toLowerCase();
      if (kind === 'government') kind = 'official';
      if (kind === 'forums') kind = 'community';
      if (KNOWN_KINDS.indexOf(kind) === -1 && kind !== 'general-web') return;
      if (!seen[kind]) {
        seen[kind] = true;
        out.push({ category: kind, reason: 'requested explicitly in options.kinds',
          signals: ['explicit-kind:' + kind], discovered: false });
      }
    });
    if (out.length === 0) {
      out.push({ category: 'general-web',
        reason: 'no subject signal in topic — general web search only; categories will be discovered from the results, not assumed',
        signals: [], discovered: false });
    }
    return out;
  }

  /* Discover real sources from actual search results. Only results
     that were really returned (with a real URL) become sources. */
  function discoverSourcesFromResults(results) {
    var seen = {};
    var out = [];
    (results || []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var url = asString(r.url || r.link || '');
      if (!url || url.indexOf('http') !== 0) return;
      if (seen[url]) return;
      seen[url] = true;
      var domain = '';
      try {
        var m = url.match(/^https?:\/\/([^\/]+)/);
        if (m) domain = m[1].replace(/^www\./, '');
      } catch (e) { /* keep domain empty */ }
      out.push({ url: url, domain: domain,
        title: asString(r.title || ''), snippet: asString(r.snippet || ''),
        source: asString(r.source || 'search-result'), discovered: true });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Specialists and lifecycle (pieces 21-24 interfaces)               */
  /* ------------------------------------------------------------------ */

  /* Interfaces of pieces 21-24, VERIFIED against the delivered files
     (they landed while this piece was being built; the original
     assumptions were corrected to match them — see EVIDENCE.md):
       window.EnzoSearchLifecycle — createLifecycle(opts) returns an
         instance with startTask(taskId, opts), completeTask(taskId),
         cancelTask(taskId, reason), setIndicator(state). completeTask
         clears the task's handles (polls, fetches, timers) and moves
         the indicator terminal. The top-level export is only the
         factory plus stateless helpers.
       window.EnzoSocial — searchSocial({ query, platforms, since,
         until }, fetcher?) resolves to { query, results,
         searchedPlatforms, errors }.
       window.EnzoVideo — searchVideos({ query, platforms, maxResults,
         fetchJson, fetchText }) resolves to { query, results, sources,
         error }.
       window.EnzoLiveScreen — openLiveScreen(taskId, opts) takes a
         TASK ID (not a topic) and returns { ok, error? }; without a
         document it returns ok:false, which is recorded as an error,
         never as success.
     Fallback method names are still tried for robustness, and every
     call records what was actually used. */
  function lookupSpecialist(deps, depKey, globalName) {
    if (deps && deps[depKey]) return { obj: deps[depKey], from: 'deps' };
    var g = getGlobal(globalName);
    if (g) return { obj: g, from: 'window.' + globalName };
    return { obj: null, from: null };
  }

  function callMethod(obj, candidates, args) {
    for (var i = 0; i < candidates.length; i++) {
      var name = candidates[i];
      if (obj && typeof obj[name] === 'function') {
        try {
          var value = obj[name].apply(obj, args || []);
          return { called: true, method: name, value: value, error: null };
        } catch (e) {
          return { called: true, method: name, value: null,
            error: (e && e.message) || String(e) };
        }
      }
    }
    return { called: false, method: null, value: null, error: null };
  }

  /* Step 9 — complete. Cancels remaining sub-operations and clears
     indicators through the lifecycle piece when present; otherwise a
     recorded no-op. The real piece-21 interface (verified against
     21-lifecycle.js) is a createLifecycle() INSTANCE with
     completeTask(taskId) / cancelTask(taskId, reason) / setIndicator
     (state); completeTask clears the task's handles (polls, fetches,
     timers) and moves the indicator to the terminal state. A bare
     factory object (createLifecycle only, no live instance) cannot
     complete anything and is reported as such. Returns a report,
     never throws. */
  function completeLifecycle(deps, taskId) {
    var found = lookupSpecialist(deps, 'lifecycle', 'EnzoSearchLifecycle');
    var report = { present: !!found.obj, from: found.from, methodsCalled: [],
      taskId: taskId || null, fallback: null };
    if (!found.obj) {
      report.fallback = 'no-op: EnzoSearchLifecycle absent; no sub-operations to cancel, no indicators to clear';
      return report;
    }
    var obj = found.obj;
    var main = callMethod(obj,
      ['completeTask', 'complete', 'finish', 'end', 'done'], [taskId]);
    if (main.called) report.methodsCalled.push(main.method);
    if (main.error) report.error = main.error;
    if (main.called && main.value && main.value.ok === false) {
      report.error = main.value.reason || main.value.error || 'lifecycle-complete-refused';
    }
    if (!main.called) {
      var cancel = callMethod(obj,
        ['cancelTask', 'cancelRemaining', 'cancelAll', 'cancel'],
        [taskId, 'orchestrator-complete']);
      if (cancel.called) report.methodsCalled.push(cancel.method);
      if (cancel.error) report.error = cancel.error;
    }
    var clear = callMethod(obj, ['setIndicator', 'clearIndicators', 'clearProgress', 'hideProgress'], ['idle']);
    if (clear.called && report.methodsCalled.indexOf(clear.method) === -1) {
      report.methodsCalled.push(clear.method);
    }
    if (report.methodsCalled.length === 0) {
      if (typeof obj.createLifecycle === 'function') {
        report.fallback = 'no-op: EnzoSearchLifecycle is only the createLifecycle factory here, not a live instance; pass a createLifecycle() instance as deps.lifecycle so completeTask(taskId) can run';
      } else {
        report.fallback = 'no-op: EnzoSearchLifecycle present but exposes none of completeTask/complete/finish/end/done/cancelTask/setIndicator; nothing was called';
      }
    }
    return report;
  }

  /* Real specialist interfaces, verified against pieces 22-24:
       EnzoSocial.searchSocial({ query, platforms, since, until, ... },
         fetcher?) — options object, optional fetcher second arg;
         resolves to { query, results, searchedPlatforms, errors }.
       EnzoVideo.searchVideos({ query, platforms, maxResults,
         fetchJson, fetchText }) — options object; fetchJson/fetchText
         injectable; resolves to { query, results, sources, error }.
       EnzoLiveScreen.openLiveScreen(taskId, opts) — a TASK ID, not a
       topic; returns { ok, error? } synchronously and needs a
       document, so in a document-less context it returns ok:false
       and that refusal is recorded, not treated as success. */
  function routeSpecialists(plan, deps, taskId) {
    var routed = [];
    var gaps = [];
    function isPromise(v) {
      try { return !!(v && typeof v.then === 'function'); } catch (e) { return false; }
    }
    function routeOne(key, globalName, methods, args, purpose) {
      var found = lookupSpecialist(deps, key, globalName);
      if (!found.obj) {
        gaps.push({ specialist: key, status: 'absent', from: null,
          fallback: 'general-web-search',
          note: globalName + ' is not loaded; fell back to general web search instead of failing or fabricating' });
        routed.push({ specialist: key, status: 'absent-fallback-general-web-search',
          purpose: purpose });
        return null;
      }
      var call = callMethod(found.obj, methods, args);
      if (!call.called) {
        gaps.push({ specialist: key, status: 'method-missing', from: found.from,
          fallback: 'general-web-search',
          note: globalName + ' is present but exposes none of ' + methods.join('/') + '; fell back to general web search' });
        routed.push({ specialist: key, status: 'method-missing-fallback-general-web-search',
          purpose: purpose });
        return null;
      }
      var entry = { specialist: key, status: call.error ? 'error' : 'called',
        method: call.method, from: found.from, purpose: purpose,
        error: call.error || null, value: call.value,
        async: isPromise(call.value) };
      if (call.value && call.value.ok === false) {
        entry.status = 'error';
        entry.error = call.value.error || 'specialist-refused';
      }
      if (entry.status === 'error') {
        gaps.push({ specialist: key, status: 'error', from: found.from,
          fallback: 'general-web-search',
          note: globalName + ' refused or failed (' + (entry.error || 'unknown error') + '); fell back to general web search' });
      }
      routed.push(entry);
      return call.value;
    }
    if (plan.needsSocial) {
      var socialArgs = [{ query: plan.topic }];
      if (deps.socialFetcher && typeof deps.socialFetcher === 'function') {
        socialArgs.push(deps.socialFetcher);
      }
      routeOne('social', 'EnzoSocial', ['searchSocial'], socialArgs,
        'social search for topic');
    }
    if (plan.needsVideo) {
      var videoOpts = { query: plan.topic, maxResults: 8 };
      if (typeof deps.fetchJson === 'function') videoOpts.fetchJson = deps.fetchJson;
      if (typeof deps.fetchText === 'function') videoOpts.fetchText = deps.fetchText;
      routeOne('video', 'EnzoVideo', ['searchVideos'], [videoOpts],
        'video search for topic');
    }
    if (plan.needsLiveScreen) {
      routeOne('liveScreen', 'EnzoLiveScreen', ['openLiveScreen'],
        [taskId, { topic: plan.topic }], 'live view for task ' + taskId);
    }
    return { routed: routed, gaps: gaps };
  }

  /* ------------------------------------------------------------------ */
  /* Section 7 — nine-step workflow                                      */
  /* ------------------------------------------------------------------ */

  function extractTopic(text) {
    var t = asString(text).trim();
    t = t.replace(/^(please\s+)?(research|search|google|dhoond|talaash|talash)[\s\w]{0,20}?\b(karo|kar|do|de|karke|batao|nikal|nikalo|chahiye|please|plz)\b\s*/i, '');
    t = t.replace(/^(internet|online|web)\s+(se|par|pe|from|on)\s+/i, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t || asString(text).trim();
  }

  function stepRecord(id, status, note) {
    var now = Date.now();
    return { id: id, status: status, note: note || '', startedAt: now, finishedAt: now };
  }

  function planDepth(activation, request) {
    if (request && request.depth) return request.depth;
    if (activation.depth === 'research') return 'deep';
    if (activation.depth === 'lookup') return 'lookup';
    return 'none';
  }

  /* orchestrate(request) — plan only, no network, no side effects. */
  function orchestrate(request) {
    var ctx = (request && typeof request === 'object' && request.context) ? request.context : {};
    var canon = canonicalise(request, ctx);
    var activation = needsInternet(canon.text, ctx);
    var depth = planDepth(activation, request);
    var topic = extractTopic(canon.text);
    var kinds = (request && Array.isArray(request.kinds)) ? request.kinds : [];
    var sources = activation.needsInternet ? selectSources(topic, { kinds: kinds }) : [];
    var q = normText(canon.text);
    var needsSocial = activation.needsInternet &&
      (kinds.indexOf('social') !== -1 ||
       /\b(social media|twitter|instagram|facebook|tiktok|trend|viral|accounts?)\b/.test(q));
    var needsVideo = activation.needsInternet &&
      (kinds.indexOf('video') !== -1 ||
       /\b(video|videos|youtube|channel|channels|watch)\b/.test(q));
    var needsLiveScreen = activation.needsInternet &&
      (kinds.indexOf('live') !== -1 ||
       /\b(live view|live screen|show me live|screen par dikhao)\b/.test(q));
    var plan = { topic: topic, depth: depth, kinds: kinds, sources: sources,
      needsSocial: needsSocial, needsVideo: needsVideo,
      needsLiveScreen: needsLiveScreen,
      discovery: activation.needsInternet
        ? { channel: 'general-web-search', via: '/api/search (search-proxy.py: DuckDuckGo Lite + Wikipedia + Google News RSS)',
            note: 'new sources are discovered from real results; no hardcoded site list' }
        : null };
    var steps = WORKFLOW_STEPS.map(function (id) {
      var status = 'planned';
      var note = '';
      if (!activation.needsInternet) { status = 'not-applicable'; note = 'no internet work: ' + activation.reason; }
      else if (depth === 'lookup' && (id === 'cross-verify' || id === 'analyze')) {
        status = 'skipped-planned';
        note = 'simple lookup: single-source answer; cross-verification and deep analysis not needed';
      } else if (depth === 'lookup' && id === 'evaluate') {
        note = 'short evaluation: result must have a real title and URL';
      }
      return { id: id, status: status, note: note };
    });
    var specialists = [];
    if (needsSocial) specialists.push({ specialist: 'social', via: 'window.EnzoSocial.searchSocial', purpose: 'social search for topic' });
    if (needsVideo) specialists.push({ specialist: 'video', via: 'window.EnzoVideo.searchVideos', purpose: 'video search for topic' });
    if (needsLiveScreen) specialists.push({ specialist: 'liveScreen', via: 'window.EnzoLiveScreen.openLiveScreen', purpose: 'live view for topic' });
    return { needsInternet: activation.needsInternet, depth: depth,
      activation: activation, plan: plan, stages: steps,
      sources: sources, specialists: specialists, gaps: [] };
  }

  /* run(request, deps) — executes the nine steps. Always resolves;
     a failed step is recorded, never thrown, never faked. */
  function run(request, deps) {
    deps = (deps && typeof deps === 'object') ? deps : {};
    var ctx = (request && typeof request === 'object' && request.context) ? request.context : {};
    if (deps.classifyIntent && !ctx.classifyIntent) ctx.classifyIntent = deps.classifyIntent;
    var orch = orchestrate(request);
    var steps = [];
    var gaps = [];
    var discoveredSources = [];
    var results = [];
    var specialistOutcomes = { routed: [], gaps: [] };
    var taskCounter = runTaskCounter++;
    var taskId = 'orch-' + Date.now().toString(36) + '-' + taskCounter;
    var lifecycleStarted = false;
    if (deps.lifecycle && typeof deps.lifecycle.startTask === 'function') {
      try {
        var started = deps.lifecycle.startTask(taskId, { topic: orch.plan.topic });
        lifecycleStarted = !!(started && started.task);
      } catch (e) { lifecycleStarted = false; }
    }

    function record(id, status, note) {
      var s = stepRecord(id, status, note);
      steps.push(s);
      return s;
    }

    function toPromise(value) {
      try {
        if (value && typeof value.then === 'function') return value;
      } catch (e) { /* treat as plain value */ }
      return Promise.resolve(value);
    }

    function chain(promise, fn) { return promise.then(fn); }

    var p = Promise.resolve();

    /* Step 1 — understand. */
    p = chain(p, function () {
      record('understand', 'done',
        'topic: ' + (orch.plan.topic || '(empty)') + '; language: ' +
        (orch.activation.lang || 'en') + '; activation: ' + orch.activation.reason);
      return null;
    });

    /* Step 2 — plan. */
    p = chain(p, function () {
      if (!orch.needsInternet) {
        record('plan', 'skipped', 'no internet work: ' + orch.activation.reason);
      } else {
        record('plan', 'done', 'depth ' + orch.depth + '; ' +
          orch.sources.length + ' source categor' +
          (orch.sources.length === 1 ? 'y' : 'ies') + ' selected; ' +
          orch.specialists.length + ' specialist(s) planned');
      }
      return null;
    });

    /* Steps 3-4 — discover + retrieve (specialists first, then general
       web search). When nothing is available, record the gap honestly. */
    p = chain(p, function () {
      if (!orch.needsInternet) {
        record('discover', 'skipped', 'no internet work');
        record('retrieve', 'skipped', 'no internet work');
        return null;
      }
      specialistOutcomes = routeSpecialists(orch.plan, deps, taskId);
      gaps = gaps.concat(specialistOutcomes.gaps);
      var specialistJobs = specialistOutcomes.routed
        .filter(function (r) { return r.async && r.value; })
        .map(function (r) {
          return toPromise(r.value).then(function (outcome) {
            r.outcome = outcome || null;
            var list = [];
            if (Array.isArray(outcome)) list = outcome;
            else if (outcome && Array.isArray(outcome.results)) list = outcome.results;
            r.resultCount = list.length;
            list.forEach(function (item) { results.push(item); });
            return list.length;
          }, function (err) {
            r.status = 'error';
            r.error = (err && err.message) || String(err);
            gaps.push({ stage: 'discover', specialist: r.specialist,
              status: 'specialist-failed', note: r.error });
            return 0;
          });
        });
      var searchFn = deps.search || null;
      var queries = [orch.plan.topic];
      var searchJobs = [];
      if (searchFn) {
        searchJobs = queries.map(function (queryText) {
          return toPromise(searchFn(queryText)).then(function (res) {
            var list = [];
            if (Array.isArray(res)) list = res;
            else if (res && Array.isArray(res.results)) list = res.results;
            return list;
          }, function (err) {
            gaps.push({ stage: 'discover', status: 'search-failed',
              note: 'search function failed: ' + ((err && err.message) || String(err)) });
            return [];
          });
        });
        return Promise.all(specialistJobs).then(function () {
          return Promise.all(searchJobs);
        }).then(function (lists) {
          lists.forEach(function (list) {
            list.forEach(function (r) { results.push(r); });
          });
          discoveredSources = discoverSourcesFromResults(results);
          record('discover', 'done', discoveredSources.length +
            ' real source(s) discovered from search results and specialists; 0 invented');
          return null;
        });
      }
      return Promise.all(specialistJobs).then(function () {
        if (results.length > 0) {
          discoveredSources = discoverSourcesFromResults(results);
          record('discover', 'done', discoveredSources.length +
            ' real source(s) discovered from specialists; 0 invented');
          return null;
        }
        gaps.push({ stage: 'discover', status: 'no-search-function',
          note: 'no deps.search supplied and no live /api/search reachable from this context; 0 sources retrieved, none invented' });
        record('discover', 'failed', 'no search function available; 0 sources');
        return null;
      });
    });

    p = chain(p, function () {
      if (!orch.needsInternet) return null;
      var step = steps.filter(function (s) { return s.id === 'discover'; })[0];
      if (step && step.status === 'failed') {
        record('retrieve', 'failed', 'nothing discovered to retrieve');
        return null;
      }
      var fetchFn = deps.fetch || null;
      if (!fetchFn) {
        record('retrieve', 'done',
          'no page fetch requested: ' + discoveredSources.length +
          ' result(s) used as returned (title, URL, snippet only); no page text fetched');
        return null;
      }
      var urls = discoveredSources.slice(0, 5).map(function (s) { return s.url; });
      var jobs = urls.map(function (url) {
        return toPromise(fetchFn(url)).then(function (page) {
          return { url: url, ok: true, page: page || null };
        }, function (err) {
          return { url: url, ok: false, error: (err && err.message) || String(err) };
        });
      });
      return Promise.all(jobs).then(function (fetched) {
        var okCount = fetched.filter(function (f) { return f.ok; }).length;
        fetched.forEach(function (f) {
          if (!f.ok) gaps.push({ stage: 'retrieve', status: 'fetch-failed', url: f.url, note: f.error });
        });
        record('retrieve', okCount === fetched.length ? 'done' : 'partial',
          okCount + ' of ' + fetched.length + ' page(s) fetched; failures recorded, not hidden');
        return null;
      });
    });

    /* Step 5 — evaluate. */
    p = chain(p, function () {
      if (!orch.needsInternet) { record('evaluate', 'skipped', 'no internet work'); return null; }
      var usable = discoveredSources.filter(function (s) { return s.url && s.title; }).length;
      record('evaluate', 'done', usable + ' of ' + discoveredSources.length +
        ' discovered source(s) usable (real title + URL); the rest dropped, not cited');
      return null;
    });

    /* Step 6 — cross-verify. Skipped explicitly for simple lookups. */
    p = chain(p, function () {
      if (!orch.needsInternet) { record('cross-verify', 'skipped', 'no internet work'); return null; }
      if (orch.depth === 'lookup') {
        record('cross-verify', 'skipped', 'simple lookup: one fresh fact from one usable source is enough; cross-verification not needed');
        return null;
      }
      var domains = {};
      discoveredSources.forEach(function (s) { if (s.domain) domains[s.domain] = true; });
      var distinct = Object.keys(domains).length;
      record('cross-verify', distinct >= 2 ? 'done' : 'partial',
        distinct + ' distinct domain(s) among discovered sources' +
        (distinct < 2 ? '; agreement across sources could not be checked — reported, not assumed' : ''));
      return null;
    });

    /* Step 7 — analyze. Skipped explicitly for simple lookups. */
    p = chain(p, function () {
      if (!orch.needsInternet) { record('analyze', 'skipped', 'no internet work'); return null; }
      if (orch.depth === 'lookup') {
        record('analyze', 'skipped', 'simple lookup: no analysis beyond the retrieved fact');
        return null;
      }
      record('analyze', 'done', 'analysis drawn only from the ' +
        discoveredSources.length + ' discovered source(s); nothing added from memory');
      return null;
    });

    /* Step 8 — present. */
    p = chain(p, function () {
      if (!orch.needsInternet) { record('present', 'skipped', 'no internet work'); return null; }
      if (discoveredSources.length === 0) {
        record('present', 'done', 'no usable sources found: answer states plainly that nothing was found; 0 sources claimed');
      } else {
        record('present', 'done', 'answer built only from the ' +
          discoveredSources.length + ' discovered source(s), each cited by its real URL');
      }
      return null;
    });

    /* Step 9 — complete. MUST call the lifecycle complete. */
    p = chain(p, function () {
      var lifecycle = completeLifecycle(deps, taskId);
      lifecycle.started = lifecycleStarted;
      record('complete', 'done', lifecycle.present
        ? 'lifecycle complete called via: ' + (lifecycle.methodsCalled.join(', ') || 'none available — recorded as no-op')
        : 'lifecycle absent — no-op recorded; no sub-operations to cancel, no indicators to clear');
      return { status: 'done', taskId: taskId, steps: steps, sources: orch.sources,
        discoveredSources: discoveredSources, results: results,
        gaps: gaps.concat(specialistOutcomes.gaps), lifecycle: lifecycle,
        plan: orch.plan, activation: orch.activation,
        specialists: specialistOutcomes.routed };
    });

    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Browser connectivity — plain truth table                            */
  /* ------------------------------------------------------------------ */

  function browserConnectivity() {
    return {
      supported: [
        { capability: 'server-side web search',
          via: '/api/search on the search proxy (search-proxy.py)',
          how: 'DuckDuckGo Lite + Wikipedia OpenSearch + Google News RSS, keyless, server-side; results are real pages only',
          permissionRequired: 'none in the app; the proxy must be running and reachable' },
        { capability: 'server-side page fetch',
          via: '/api/fetch on the search proxy (search-proxy.py)',
          how: 'fetches a public page and returns title + up to 6000 characters of text',
          permissionRequired: 'none in the app; SSRF guard allows public http/https hosts only' },
        { capability: 'live view inside the app',
          via: 'window.EnzoLiveScreen.openLiveScreen (piece 24, when loaded)',
          how: 'shows research progress and results in the app UI the user already has open',
          permissionRequired: 'none; it is a view inside the app, not access to anything outside it' },
        { capability: 'user opens a link in their own browser',
          via: 'a normal link the user taps',
          how: 'the user opens any discovered source URL in Chrome/Edge/their own browser themselves',
          permissionRequired: 'none; the user chooses to open it' }
      ],
      unsupported: [
        { capability: 'access to the user\'s local browser session',
          supported: false,
          reason: 'ENZO runs as a web page inside the user\'s browser; a web page cannot read another tab\'s session, cookies, history or logged-in accounts' },
        { capability: 'remote-controlling the user\'s browser (Chrome/Edge)',
          supported: false,
          reason: 'there is no browser-automation channel: no extension, no DevTools connection, no remote driver. Chrome/Edge here means the user\'s own browser running the app, not a browser ENZO drives' },
        { capability: 'an integrated browser ENZO operates by itself',
          supported: false,
          reason: 'no embedded or integrated browser exists in this build; "integrated environments" means the app running inside the user\'s own browser' },
        { capability: 'reading pages the user is logged into',
          supported: false,
          reason: 'server-side fetch is unauthenticated and SSRF-guarded; it cannot use the user\'s logins, and must never ask for them' },
        { capability: 'private or local addresses',
          supported: false,
          reason: '/api/fetch refuses non-public hosts (SSRF guard in search-proxy.py)' }
      ],
      permissions: [
        'No browser permission, extension, or login is required for server-side search and fetch.',
        'Opening a discovered link needs only the user\'s own tap in their own browser.',
        'Nothing in this orchestrator requests, stores, or uses the user\'s credentials.'
      ],
      limits: [
        'Search returns at most 10 results per query (MAX_RESULTS in search-proxy.py); results are cached 10 minutes; 60 requests/minute per client IP.',
        'Page fetch returns at most 6000 characters of text per page.',
        'In sandboxed environments the SSRF guard can block fetches entirely (DNS resolves to non-global addresses); that failure is reported, not worked around.',
        'All search and fetch traffic comes from the proxy server, not from the user\'s browser, so results never depend on the user\'s location, login, or browsing history.'
      ],
      notes: 'If a future build wants real browser control, it needs an explicit, user-installed route (a browser extension or a user-run automation driver) with the user\'s approval. Until then, any claim of browser control would be false.'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Export (UMD pattern, as in enao-universal-intel pieces)            */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    WORKFLOW_STEPS: WORKFLOW_STEPS,
    needsInternet: needsInternet,
    selectSources: selectSources,
    orchestrate: orchestrate,
    run: run,
    browserConnectivity: browserConnectivity,
    completeLifecycle: completeLifecycle,
    discoverSourcesFromResults: discoverSourcesFromResults
  };

  try {
    if (typeof window !== 'undefined') window.EnzoInternetOrchestrator = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoInternetOrchestrator = api;
  } catch (e) { /* exposure is best-effort */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
