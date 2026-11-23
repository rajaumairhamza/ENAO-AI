
/* PIECE 43 — EnzoHearFix43 transliteration retry (enao-hear-fix, v64-voice-live). Own <script>, inert until onHeard runs from onresult. Includes the top-level ORIGINAL_SITE_1 / REPLACEMENT_SITE_1 vars — the module references them. */
var ORIGINAL_SITE_1 = `      var gateRes55 = window.EnzoVoiceFix42 ? window.EnzoVoiceFix42.gateMicQuestion(heard, {source:'call'}) : (window.EnzoVoiceID ? window.EnzoVoiceID.gateAndRoute(heard, {source:'call'}) : {proceed:true});
      if(!gateRes55.proceed){
if(gateRes55.decision && gateRes55.decision.decision==='refuse' && gateRes55.decision.speak && gateRes55.decision.refusal && !gateRes55.refusalSpoken){
  try{ maybeSpeak({plain: gateRes55.decision.refusal, viaVoice:true, lang: (window.EnzoLang47?window.EnzoLang47.normaliseRefusalLang(gateRes55.decision.refusalLang):(gateRes55.decision.refusalLang==='ur' ? 'urdu' : gateRes55.decision.refusalLang))}); }catch(e){}
}
        return;
      }`;

/* --------------------------------------------------------------------------
 * SITE 1 — REPLACEMENT. Identical to the original above, plus the fix43
 * hook inserted after the gate block and before the busy-queue branch
 * (base line 12362: `if(state.isGenerating || state.isSpeaking){`).
 * `heard` is `var heard = finalTxt.trim()` (line 12350), so reassigning
 * it feeds the decoded text into the existing queue/send code unchanged.
 * The hook is fully guarded: if the module failed to load, or throws,
 * the original flow continues with the undecoded transcript.
 * -------------------------------------------------------------------------- */
var REPLACEMENT_SITE_1 = `      var gateRes55 = window.EnzoVoiceFix42 ? window.EnzoVoiceFix42.gateMicQuestion(heard, {source:'call'}) : (window.EnzoVoiceID ? window.EnzoVoiceID.gateAndRoute(heard, {source:'call'}) : {proceed:true});
      if(!gateRes55.proceed){
if(gateRes55.decision && gateRes55.decision.decision==='refuse' && gateRes55.decision.speak && gateRes55.decision.refusal && !gateRes55.refusalSpoken){
  try{ maybeSpeak({plain: gateRes55.decision.refusal, viaVoice:true, lang: (window.EnzoLang47?window.EnzoLang47.normaliseRefusalLang(gateRes55.decision.refusalLang):(gateRes55.decision.refusalLang==='ur' ? 'urdu' : gateRes55.decision.refusalLang))}); }catch(e){}
}
        return;
      }
      /* fix43 (piece 43): transliteration-gibberish retry. Runs AFTER the
         voice-ID gate passes and BEFORE the busy-queue / send branches, so
         a decoded transcript is queued/sent exactly like a normal one.
         onHeard() switches recognition.lang to en-US immediately and
         returns the decoded English when the whole transcript decodes;
         otherwise it returns the original text unchanged. */
      if(window.EnzoHearFix43){
        try{
          var fix43 = window.EnzoHearFix43.onHeard(heard, { recognition: (typeof recognition !== 'undefined' ? recognition : null), state: state, langFor: (window.EnzoLang46 ? window.EnzoLang46.recognitionLangFor : null) });
          if(fix43 && fix43.retried){ heard = fix43.text; }
        }catch(e){}
      }`;

/* --------------------------------------------------------------------------
 * VERIFIED, NO CHANGE — askQuestion (base line 11646-11648) and backendAsk
 * (base lines 20803-20805). Quoted here so the assembler can confirm they
 * already do the right thing once the sent text is decoded English.
 *   var lang = (window.EnzoLang45 ? window.EnzoLang45.askLang(text, state.langPref, detectLang) : detectLang(text));
 *   state.lastAnswerLang = lang;
 *   try{ if(typeof recognition!=='undefined' && recognition && state.voiceLive && window.EnzoLang46) recognition.lang = window.EnzoLang46.recognitionLangFor(lang); }catch(e){}
 * -------------------------------------------------------------------------- */

(function(root){
  'use strict';

  var VERSION = 'fix43-transliteration-retry-v1';

  /* Frequent English words as the ur-PK recogniser renders them in Urdu
     script. Deliberately small and high-confidence: every entry must be a
     word whose Urdu-script form is (a) actually produced for that English
     word and (b) not a genuine Urdu/Punjabi word on its own. Deliberately
     EXCLUDED: 'ہو' (genuine "are/have" — vetoed anyway), 'گو', 'سو', 'مچ'
     (ambiguous with genuine Urdu words). 'وائن' is Raja's reported form
     of "want" (want without the final t); 'وانٹ' is the fuller form. */
  var TRANSLITERATION_DICT = {
    'ہیلو': 'hello',
    'ہائی': 'hi',
    'ڈو': 'do',
    'یو': 'you',
    'وائن': 'want',
    'وانٹ': 'want',
    'وونٹ': 'want',
    'ڈونٹ': "don't",
    'واٹ': 'what',
    'واٹس': "what's",
    'ہاؤ': 'how',
    'آر': 'are',
    'از': 'is',
    'ایم': 'am',
    'دی': 'the',
    'کین': 'can',
    'پلیز': 'please',
    'ٹیل': 'tell',
    'می': 'me',
    'مائی': 'my',
    'نیم': 'name',
    'یور': 'your',
    'دس': 'this',
    'دیٹ': 'that',
    'گڈ': 'good',
    'مارننگ': 'morning',
    'تھینک': 'thank',
    'تھینکس': 'thanks',
    'یس': 'yes',
    'نو': 'no',
    'اوکے': 'okay',
    'ریسرچ': 'research',
    'ویڈیو': 'video',
    'چینل': 'channel',
    'وائی': 'why',
    'وین': 'when',
    'ویئر': 'where',
    'ٹوڈے': 'today',
    'ہیلپ': 'help',
    'گیو': 'give',
    'شو': 'show',
    'ایکسپلین': 'explain',
    'اباؤٹ': 'about',
    'بیسٹ': 'best',
    'نیو': 'new',
    'میک': 'make',
    'آئی': 'I',
    'ٹو': 'to',
    'اینزو': 'Enzo',
    'سٹاپ': 'stop',
    'سٹارٹ': 'start'
  };

  /* Genuine Urdu (script) / Shahmukhi Punjabi words. VETO: if ANY token
     is in this list, the transcript is genuine Urdu/Punjabi and NO retry
     happens, whatever else it contains. Checked BEFORE the dictionary,
     so a collision (e.g. 'ہو') can never fire. Covers function words
     plus the common content words in Raja's reported genuine utterances
     ("تسی کیدا کر رہے ہو", "کیا حال ہے") and everyday greetings
     ("سلام", "شکریہ"). */
  var GENUINE_WORDS = {
    'کیا': 1, 'ہے': 1, 'ہیں': 1, 'کا': 1, 'کی': 1, 'کے': 1, 'میں': 1,
    'مجھے': 1, 'آپ': 1, 'یہ': 1, 'وہ': 1, 'نہیں': 1, 'اور': 1, 'پر': 1,
    'سے': 1, 'کو': 1, 'بھی': 1, 'تھا': 1, 'تھی': 1, 'کر': 1, 'کرو': 1,
    'رہے': 1, 'رہا': 1, 'رہی': 1, 'ہو': 1, 'ہوں': 1, 'تسی': 1,
    'مینوں': 1, 'تینوں': 1, 'کیدا': 1, 'کدھر': 1, 'کتھے': 1, 'کیوں': 1,
    'کب': 1, 'کیسا': 1, 'کیسی': 1, 'میرا': 1, 'میری': 1, 'حال': 1,
    'چاہیے': 1, 'بولو': 1, 'بتاؤ': 1, 'سمجھاؤ': 1, 'آج': 1, 'کل': 1,
    'بہت': 1, 'اچھا': 1, 'ٹھیک': 1, 'کرنا': 1, 'جاؤ': 1, 'آؤ': 1,
    'دسو': 1, 'سنو': 1, 'دیکھو': 1, 'کرتے': 1, 'کرتا': 1, 'کیتی': 1,
    'ہور': 1, 'جانا': 1, 'آنا': 1, 'بول': 1, 'سن': 1, 'دے': 1, 'لو': 1,
    'گیا': 1, 'گئی': 1, 'نے': 1, 'تو': 1, 'جو': 1, 'جب': 1, 'اگر': 1,
    'پھر': 1, 'اب': 1, 'اس': 1, 'ان': 1, 'تم': 1, 'ہم': 1, 'وہاں': 1,
    'یہاں': 1, 'کس': 1, 'کون': 1, 'کہاں': 1, 'کتنا': 1, 'کیسے': 1,
    'سلام': 1, 'شکریہ': 1, 'اللہ': 1, 'خدا': 1, 'جانتا': 1, 'کرو؟': 1
  };

  /* Per page load. switchedFor: the transcript text a switch was already
     done for (one switch per distinct transcript). switches: how many
     lang switches actually happened (test hook: must stay <= 1 while
     recognition.lang is already the target). decodes: full decodes done. */
  var retryState = { switchedFor: null, switches: 0, decodes: 0 };

  function hasArabicScript(text){
    return /[\u0600-\u06FF]/.test(String(text || ''));
  }

  /* Normalise one token: strip Arabic diacritics/tatweel, unify Arabic
     Yeh/Kaf/Heh to their Urdu forms (Chrome's ur-PK output varies). */
  function normaliseToken(tok){
    return String(tok || '')
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/\u064A/g, '\u06CC')
      .replace(/\u0643/g, '\u06A9')
      .replace(/\u0647/g, '\u06C1')
      .replace(/[^\u0600-\u06FF]/g, '');
  }

  function tokenize(text){
    var out = [];
    String(text || '').split(/\s+/).forEach(function(raw){
      var t = normaliseToken(raw);
      if(t) out.push(t);
    });
    return out;
  }

  /* Conservative detector. Fires ONLY when: the text is Urdu-script AND
     no token is a genuine Urdu/Punjabi word AND the dictionary covers
     the transcript (single token: that token is in the dictionary;
     multi-token: >= 2 dictionary hits and >= 50% coverage). A genuine
     Urdu sentence that happens to contain one transliterated loanword
     therefore never fires (veto, or < 2 hits, or < 50% coverage). */
  function isTransliteratedEnglish(text){
    if(!hasArabicScript(text)) return false;
    var toks = tokenize(text);
    if(!toks.length) return false;
    var i, hits = 0;
    for(i = 0; i < toks.length; i++){
      if(GENUINE_WORDS[toks[i]]) return false;
      if(TRANSLITERATION_DICT[toks[i]]) hits++;
    }
    if(toks.length === 1) return hits === 1;
    return hits >= 2 && (hits / toks.length) >= 0.5;
  }

  /* Full decode only: every token must map, otherwise null (never invent
     words for unknown tokens — the caller then sends the original). */
  function decodeTransliteratedEnglish(text){
    if(!isTransliteratedEnglish(text)) return null;
    var toks = tokenize(text);
    var i;
    for(i = 0; i < toks.length; i++){
      if(!TRANSLITERATION_DICT[toks[i]]) return null;
    }
    return toks.map(function(t){ return TRANSLITERATION_DICT[t]; }).join(' ');
  }

  /* Wiring entry point, called from onresult after the gate passes.
     ctx: { recognition, state, langFor } — langFor is
     EnzoLang46.recognitionLangFor when present, else the 'en-US'
     fallback is used directly (the map is proven correct; this piece
     never re-implements it). Returns { text, retried, decoded,
     fromLang, toLang, switched } where `text` is what onresult should
     use as `heard` from here on. Never throws. */
  function onHeard(heard, ctx){
    ctx = ctx || {};
    var result = { text: heard, retried: false, decoded: null,
      fromLang: null, toLang: null, switched: false };
    try{
      if(!isTransliteratedEnglish(heard)) return result;
      var rec = ctx.recognition || null;
      var fromLang = (rec && rec.lang) ? rec.lang : 'ur-PK';
      var target = 'en-US';
      if(typeof ctx.langFor === 'function'){
        try{ target = ctx.langFor('en') || 'en-US'; }catch(e){ target = 'en-US'; }
      }
      result.fromLang = fromLang;
      result.toLang = target;
      result.retried = true;
      /* ONE retry: switch at most once per distinct transcript, and
         only when the recogniser is not already on the target language.
         No stop()/start() — see header: the continuous loop's natural
         restart picks the new lang up, and the send path re-asserts it. */
      if(rec && rec.lang !== target && retryState.switchedFor !== heard){
        try{
          rec.lang = target;
          retryState.switchedFor = heard;
          retryState.switches++;
          result.switched = true;
        }catch(e){}
      }
      /* Record the outcome so the switch sticks, via the existing
         lastAnswerLang path — but only in Auto mode. With a fixed
         language setting the send path recomputes from the setting
         anyway, and this piece must not fight the user's setting. */
      if(ctx.state && (!ctx.state.langPref || ctx.state.langPref === 'auto')){
        try{ ctx.state.lastAnswerLang = 'en'; }catch(e){}
      }
      var decoded = decodeTransliteratedEnglish(heard);
      if(decoded){
        retryState.decodes++;
        result.decoded = decoded;
        result.text = decoded;
      }
      /* Partial decode (decoded === null): text stays the original
         gibberish — never invent words — but the lang switch above
         still applies to the next listen. */
      return result;
    }catch(e){
      return { text: heard, retried: false, decoded: null,
        fromLang: null, toLang: null, switched: false };
    }
  }

  function resetForTest(){
    retryState.switchedFor = null;
    retryState.switches = 0;
    retryState.decodes = 0;
  }

  var api = {
    VERSION: VERSION,
    TRANSLITERATION_DICT: TRANSLITERATION_DICT,
    GENUINE_WORDS: GENUINE_WORDS,
    retryState: retryState,
    hasArabicScript: hasArabicScript,
    tokenize: tokenize,
    isTransliteratedEnglish: isTransliteratedEnglish,
    decodeTransliteratedEnglish: decodeTransliteratedEnglish,
    onHeard: onHeard,
    resetForTest: resetForTest,
    ORIGINAL_SITE_1: ORIGINAL_SITE_1,
    REPLACEMENT_SITE_1: REPLACEMENT_SITE_1
  };

  if(typeof root !== 'undefined') root.EnzoHearFix43 = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
