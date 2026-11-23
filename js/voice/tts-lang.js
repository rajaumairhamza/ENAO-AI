
/* ============================================================================
   ENAO AI P3 — TTS lang/voice mapping + honest no-voice fallback
   (46-lang-tts.js)
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines,
   meta v61-deep-triggers-4lang). DO NOT deploy from this file alone;
   the coordinator assembles and deploys it. Do NOT edit the artifact
   from this piece.

   SPEC: ~/workspace/enao-voice-fix/LANGUAGE-SPEC.md, section P3
   (spec sections P3a-P3f). Implements EXACTLY P3 and nothing else.

   DEFECT (Raja, 22 Nov 2026 ~6:49 PM PKT): TTS must use the correct
   voice per language. Live v61, as audited:
   - speakText L7584: u.lang = Punjabi -> 'en-US' (Punjabi text read
     with an English voice); no per-language u.voice selection.
   - playerSpeakChunk L7664: identical mapping.
   - Saved enao_voice_uri is forced onto EVERY language by the
     speechSynthesis.speak wrapper L18030-18040.
   - Nothing checks whether a voice exists for the requested language.
   - buildRecognition L7718: r.lang='ur-PK' hardcoded, so English and
     Punjabi voice input is transcribed as Urdu.

   WHAT THIS PIECE OWNS (language/voice selection feeding into the
   speak path ONLY — the race/heartbeat/retry logic of speakText is
   piece 41's and is NOT touched here):
   P3a  TTS_LANG / TTS_FALLBACK_LANG maps + ttsLangFor(lang).
   P3b  pickVoiceForLang(lang, voices, savedUri) — best voice for the
        language; never returns a voice whose language family does
        not match the request; never fakes availability.
   P3c  Patch helpers the assembler wires at L7584 (speakText) and
        L7664 (playerSpeakChunk): setupUtterance() sets u.lang and
        u.voice and fires the honest fallback note.
   P3d  noteTtsFallback() — ONE short toast in the ANSWER language
        (spec P4d strings, verbatim) when the requested language has
        no exact voice; the nearest voice may still be used for the
        audio, but the message says plainly the requested voice is
        not on this device.
   P3e  TTS_TEST_SENTENCES + testSentenceForLang() — the voice test
        speaks in the language of the currently selected voice, not
        hardcoded English. (Test sentences are this piece's own
        wording; the spec names the map, not the sentences.)
   P3f  recognitionLangFor(lang) + patchBuildRecognition() — live-call
        recognition uses the resolved language instead of hardcoded
        'ur-PK'; recognitionLangFromState() threads piece 44's
        resolver (resolveAnswerLang) and state.lastAnswerLang.

   DEPENDENCY: piece 44 (44-lang-resolver.js, resolveAnswerLang)
   does NOT exist yet at build time. This piece codes against its
   spec'd interface only: resolveAnswerLang(text, pref) returning
   one of en/urdu/roman/punjabi/roman-punjabi. The resolver is an
   OPTIONAL argument to recognitionLangFromState(); when it is not
   supplied, recognition falls back to state.lastAnswerLang, then
   to 'ur-PK'. Nothing in this piece calls the resolver itself.

   normaliseLang() below is a LOCAL copy of the P1 mapping (piece 44
   owns the canonical one). It matches the reference module
   (~/workspace/enao-voice-fix/tests/language-reference.cjs)
   exactly; assembly must use piece 44's copy at the call sites and
   this copy only as the fallback inside this piece.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies).

   LIVE ANCHORS (verified by grep against the live v61 file)
   - speakText u.lang assignment .................... L7584
     (spec says L7583; the assignment is on L7584 in the live file)
   - playerSpeakChunk u.lang assignment ............. L7664
   - buildRecognition r.lang='ur-PK' ................ L7718
   - __enzoVoicePatched speak wrapper ............... L18030-18040
   - fillVoices / voice test ........................ L17991 / L18016
   - playerStart toast (speechSynthesis missing) .... L7689
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'v46-lang-tts';

  /* P3a — TTS lang tags, spec section 0 + P3a, verbatim. */
  var TTS_LANG = {
    en: 'en-US',
    urdu: 'ur-PK',
    roman: 'ur-PK',
    punjabi: 'pa-PK',
    'roman-punjabi': 'pa-PK',
    hindi: 'hi-IN'
  };
  var TTS_FALLBACK_LANG = {
    punjabi: 'ur-PK',
    'roman-punjabi': 'ur-PK'
  };
  var LANG_NAME = {
    en: 'English',
    urdu: 'Urdu',
    roman: 'Roman Urdu',
    punjabi: 'Punjabi',
    'roman-punjabi': 'Roman Punjabi',
    hindi: 'Hindi'
  };
  var LANG_CODES = ['en', 'urdu', 'roman', 'punjabi', 'roman-punjabi', 'hindi'];

  /* Local copy of the P1 mapping (see header note). Legacy values map
     to canonical; anything unknown maps to 'en'. */
  function normaliseLang(code){
    if(code === 'ur') return 'urdu';
    if(code === 'pa') return 'punjabi';
    if(code === 'english') return 'en';
    if(LANG_CODES.indexOf(code) !== -1) return code;
    return 'en';
  }

  function langPrefix(tag){
    return String(tag || '').split(/[-_]/)[0].toLowerCase();
  }

  /* P3a — TTS lang tag for a canonical language code. */
  function ttsLangFor(lang){
    return TTS_LANG[normaliseLang(lang)] || 'en-US';
  }

  /* P3b — best voice for the language, given speechSynthesis.getVoices().
     voices: array of {name, lang, voiceURI} (any entry may be missing
     fields; entries are never assumed well-formed).
     savedUri: the saved enao_voice_uri string, or null/''.
     Returns {voice, matched, available}:
       matched 'exact'   — a voice of the requested language family
                           exists; voice is it (the saved voice when
                           it matches the family, else the first match).
       matched 'nearest' — no voice of the requested family, but a
                           voice of TTS_FALLBACK_LANG[lang] exists;
                           voice is that nearest voice, available is
                           FALSE: there is no voice for the requested
                           language itself, so the caller must say so
                           (P3d) even though the audio can still play.
       matched 'none'    — no voice in either family; voice is null,
                           available is FALSE.
     It NEVER returns a voice whose language family mismatches the
     request: a saved English voice is never chosen for Punjabi text.
     An empty / missing voices list returns {voice:null, matched:'none',
     available:false} without throwing. */
  function pickVoiceForLang(lang, voices, savedUri){
    var code = normaliseLang(lang);
    var want = langPrefix(TTS_LANG[code] || 'en-US');
    var list = Array.isArray(voices) ? voices : [];
    var i, v, firstExact = null;
    for(i = 0; i < list.length; i++){
      v = list[i];
      if(!v) continue;
      if(langPrefix(v.lang) === want){
        if(!firstExact) firstExact = v;
        if(savedUri && v.voiceURI === savedUri) return { voice: v, matched: 'exact', available: true };
      }
    }
    if(firstExact) return { voice: firstExact, matched: 'exact', available: true };
    var fb = TTS_FALLBACK_LANG[code];
    if(fb){
      var fbPrefix = langPrefix(fb);
      for(i = 0; i < list.length; i++){
        v = list[i];
        if(!v) continue;
        if(langPrefix(v.lang) === fbPrefix) return { voice: v, matched: 'nearest', available: false };
      }
    }
    return { voice: null, matched: 'none', available: false };
  }

  /* Alias: the task brief names this function pickVoiceFor. */
  function pickVoiceFor(lang, voices, savedUri){
    return pickVoiceForLang(lang, voices, savedUri);
  }

  /* P4d — honest no-voice message, in the ANSWER language.
     Spec strings verbatim (LANGUAGE-SPEC.md P4d), with {Lang} and
     {Used} filled in. Call as noVoiceMessage(lang) for the common
     case: the requested language is the answer language and the
     voice actually used is the spec fallback family (Urdu for
     Punjabi/Roman Punjabi, English otherwise).
     Full form: noVoiceMessage(answerLang, requestedLang, usedTtsLang)
     where usedTtsLang is a BCP tag such as 'ur-PK' or 'en-US'.
     The message NEVER claims the requested language's voice is
     speaking when it is not. */
  var NO_VOICE_TEMPLATES = {
    en: 'This device has no voice for {Lang} installed, so I am reading this in the closest available voice ({Used}). The written answer above is complete.',
    urdu: 'اس ڈیوائس پر {Lang} کی آواز موجود نہیں ہے، اس لیے قریبی آواز ({Used}) میں سنا رہا ہوں — لکھا ہوا جواب مکمل ہے۔',
    roman: 'Is device par {Lang} ki awaz nahi hai, is liye qareebi awaz ({Used}) mein suna raha hoon — likha hua jawab poora hai.',
    punjabi: 'ایس ڈیوائس تے {Lang} دی آواز نہیں اے، ایس لئی قریبی آواز ({Used}) وچ سنا رہیا واں — لکھیا ہویا جواب پورا اے۔',
    'roman-punjabi': 'Is device te {Lang} di awaz nahi hai, is layi qareebi awaz ({Used}) vich suna reha haan — likheya hoya jawab poora hai.'
  };
  /* {Lang} in the message's own language. */
  var NO_VOICE_LANG_NAME = {
    en: { en: 'English', urdu: 'Urdu', roman: 'Roman Urdu', punjabi: 'Punjabi', 'roman-punjabi': 'Roman Punjabi', hindi: 'Hindi' },
    urdu: { en: 'انگریزی', urdu: 'اردو', roman: 'رومن اردو', punjabi: 'پنجابی', 'roman-punjabi': 'رومن پنجابی', hindi: 'ہندی' },
    roman: { en: 'English', urdu: 'Urdu', roman: 'Roman Urdu', punjabi: 'Punjabi', 'roman-punjabi': 'Roman Punjabi', hindi: 'Hindi' },
    punjabi: { en: 'انگریزی', urdu: 'اردو', roman: 'رومن اردو', punjabi: 'پنجابی', 'roman-punjabi': 'رومن پنجابی', hindi: 'ہندی' },
    'roman-punjabi': { en: 'English', urdu: 'Urdu', roman: 'Roman Urdu', punjabi: 'Punjabi', 'roman-punjabi': 'Roman Punjabi', hindi: 'Hindi' }
  };
  /* {Used} in the message's own language, keyed by BCP tag. */
  var NO_VOICE_USED_NAME = {
    en: { 'ur-PK': 'Urdu', 'en-US': 'English', 'pa-PK': 'Punjabi', 'hi-IN': 'Hindi' },
    urdu: { 'ur-PK': 'اردو', 'en-US': 'انگریزی', 'pa-PK': 'پنجابی', 'hi-IN': 'ہندی' },
    roman: { 'ur-PK': 'Urdu', 'en-US': 'English', 'pa-PK': 'Punjabi', 'hi-IN': 'Hindi' },
    punjabi: { 'ur-PK': 'اردو', 'en-US': 'انگریزی', 'pa-PK': 'پنجابی', 'hi-IN': 'ہندی' },
    'roman-punjabi': { 'ur-PK': 'Urdu', 'en-US': 'English', 'pa-PK': 'Punjabi', 'hi-IN': 'Hindi' }
  };

  function defaultUsedTag(requestedCode){
    return TTS_FALLBACK_LANG[requestedCode] || 'en-US';
  }

  function noVoiceMessage(answerLang, requestedLang, usedTtsLang){
    var a = normaliseLang(answerLang);
    var r = (requestedLang == null || requestedLang === '') ? a : normaliseLang(requestedLang);
    var usedTag = usedTtsLang || defaultUsedTag(r);
    var tpl = NO_VOICE_TEMPLATES[a] || NO_VOICE_TEMPLATES.en;
    var langName = (NO_VOICE_LANG_NAME[a] && NO_VOICE_LANG_NAME[a][r]) || LANG_NAME[r] || r;
    var usedName = (NO_VOICE_USED_NAME[a] && NO_VOICE_USED_NAME[a][usedTag]) || usedTag;
    return tpl.replace('{Lang}', langName).replace('{Used}', usedName);
  }

  /* P3d — show the honest fallback note ONCE per (language, matched)
     pair. matched 'exact' never toasts. Returns the message string
     when a toast was fired, else null. toastFn is the live toast(msg)
     (L5209); when omitted, the message is returned but not shown.
     resetNoVoiceSeen() clears the once-only memory (harness + the
     assembler, e.g. per new answer). */
  var noVoiceSeen = {};
  function resetNoVoiceSeen(){
    noVoiceSeen = {};
  }
  function noteTtsFallback(lang, matched, usedTtsLang, toastFn){
    if(matched === 'exact') return null;
    if(matched !== 'nearest' && matched !== 'none') return null;
    var code = normaliseLang(lang);
    var key = code + ':' + matched;
    if(noVoiceSeen[key]) return null;
    noVoiceSeen[key] = true;
    var usedTag = usedTtsLang || defaultUsedTag(code);
    var msg = noVoiceMessage(code, code, usedTag);
    var showToast = null;
    if(typeof toastFn === 'function') showToast = toastFn;
    else if(root && typeof root.toast === 'function') showToast = root.toast;
    if(showToast){ try{ showToast(msg); }catch(e){} }
    return msg;
  }

  /* Language-family prefix a lang value asks for. Canonical codes
     (incl. 'roman-punjabi') resolve through TTS_LANG first; a BCP
     tag such as 'pa-PK' resolves from its own prefix; anything else
     goes through normaliseLang. */
  function wantPrefixForLang(lang){
    var s = String(lang || '');
    if(TTS_LANG[s]) return langPrefix(TTS_LANG[s]);
    if(s.indexOf('-') !== -1 || s.indexOf('_') !== -1) return langPrefix(s);
    return langPrefix(TTS_LANG[normaliseLang(s)] || 'en-US');
  }

  /* Saved-voice guard (the L18030-18040 wrapper fix).
     The saved enao_voice_uri applies ONLY when the saved voice's
     language family matches the utterance's language family.
     savedVoiceForLang(savedUri, voices, lang) returns the saved
     voice object when it matches, else null.
     shouldApplySavedVoice(savedUri, utteranceLang, voices) is the
     boolean form; utteranceLang may be a canonical code ('punjabi')
     or a BCP tag ('pa-PK').
     guardSavedVoice(utterance, savedUri, voices) is the drop-in for
     the wrapper body: if the utterance already carries a voice (the
     per-language pick from P3b), it is left alone; otherwise the
     saved voice is set ONLY when its family matches the utterance
     lang. Returns the utterance. */
  function savedVoiceForLang(savedUri, voices, lang){
    if(!savedUri) return null;
    var list = Array.isArray(voices) ? voices : [];
    var want = wantPrefixForLang(lang);
    var i, v;
    for(i = 0; i < list.length; i++){
      v = list[i];
      if(!v) continue;
      if(v.voiceURI === savedUri){
        return (langPrefix(v.lang) === want) ? v : null;
      }
    }
    return null;
  }
  function shouldApplySavedVoice(savedUri, utteranceLang, voices){
    if(!savedUri) return false;
    var want = wantPrefixForLang(utteranceLang);
    var list = Array.isArray(voices) ? voices : [];
    var i, v;
    for(i = 0; i < list.length; i++){
      v = list[i];
      if(!v) continue;
      if(v.voiceURI === savedUri) return langPrefix(v.lang) === want;
    }
    return false;
  }
  function guardSavedVoice(utterance, savedUri, voices){
    if(!utterance) return utterance;
    if(utterance.voice) return utterance;
    if(!savedUri) return utterance;
    var list = Array.isArray(voices) ? voices : [];
    var want = langPrefix(utterance.lang);
    var i, v;
    for(i = 0; i < list.length; i++){
      v = list[i];
      if(!v) continue;
      if(v.voiceURI === savedUri){
        if(langPrefix(v.lang) === want) utterance.voice = v;
        break;
      }
    }
    return utterance;
  }

  /* P3c — patch helpers the assembler wires at the two live sites.
     applyTtsLang(u, lang) replaces the L7584 / L7664 assignment:
       u.lang = ttsLangFor(lang).
     applyTtsVoice(u, lang, voices, savedUri) runs the P3b pick and
       sets u.voice when a voice exists (exact or nearest); returns
       the pick result {voice, matched, available}.
     setupUtterance(u, lang, voices, savedUri, opts) does both, then
       fires noteTtsFallback once when matched is not 'exact'
       (opts.toast overrides the live toast). It touches ONLY u.lang
       and u.voice — never rate, pitch, volume, or any retry/race
       logic (piece 41 owns those).
     applySpeakTextPatch / applyPlayerChunkPatch are the named
     site aliases for the assembler (L7584 and L7664). */
  function applyTtsLang(u, lang){
    if(!u) return u;
    u.lang = ttsLangFor(lang);
    return u;
  }
  function applyTtsVoice(u, lang, voices, savedUri){
    if(!u) return { voice: null, matched: 'none', available: false };
    var pick = pickVoiceForLang(lang, voices, savedUri);
    if(pick.voice) u.voice = pick.voice;
    return pick;
  }
  function setupUtterance(u, lang, voices, savedUri, opts){
    var o = opts || {};
    if(!u) return { voice: null, matched: 'none', available: false };
    applyTtsLang(u, lang);
    var pick = applyTtsVoice(u, lang, voices, savedUri);
    if(pick.matched !== 'exact'){
      var usedTag = pick.voice ? pick.voice.lang : null;
      noteTtsFallback(lang, pick.matched, usedTag, o.toast);
    }
    return pick;
  }
  function applySpeakTextPatch(u, lang, voices, savedUri, opts){
    return setupUtterance(u, lang, voices, savedUri, opts);
  }
  function applyPlayerChunkPatch(u, playerLang, voices, savedUri, opts){
    return setupUtterance(u, playerLang, voices, savedUri, opts);
  }

  /* P3e — voice test sentence in the language of the selected voice.
     Sentences are this piece's own wording (the spec names the map
     TTS_TEST_SENTENCES, not the sentences). */
  var TTS_TEST_SENTENCES = {
    en: 'Hello, this is ENZO speaking. Can you hear me clearly?',
    urdu: 'السلام علیکم، میں اینزو ہوں۔ کیا آپ مجھے صاف سن سکتے ہیں؟',
    roman: 'Assalam-o-Alaikum, main ENZO hoon. Kya aap mujhe saaf sun sakte hain?',
    punjabi: 'ست سری اکال، میں اینزو ہاں۔ کی تسی مینوں صاف سن سکدے او؟',
    'roman-punjabi': 'Sat Sri Akal, main ENZO haan. Ki tusi mainu saaf sun sakde o?',
    hindi: 'नमस्ते, मैं एन्ज़ो हूँ। क्या आप मुझे साफ सुन सकते हैं?'
  };
  function testSentenceForLang(lang){
    return TTS_TEST_SENTENCES[normaliseLang(lang)] || TTS_TEST_SENTENCES.en;
  }
  /* Given a selected voice object, return the test sentence matching
     its language family; a voice with no usable lang falls back to
     the English sentence. */
  function testSentenceForVoice(voice){
    if(!voice || !voice.lang) return TTS_TEST_SENTENCES.en;
    var p = langPrefix(voice.lang);
    var code = null;
    var k;
    for(k in TTS_LANG){
      if(Object.prototype.hasOwnProperty.call(TTS_LANG, k) && langPrefix(TTS_LANG[k]) === p){ code = k; break; }
    }
    return code ? TTS_TEST_SENTENCES[code] : TTS_TEST_SENTENCES.en;
  }

  /* P3f — recognition language. Same tags as TTS, but the default
     for an unknown / empty language is 'ur-PK' (spec P3f), NOT
     'en-US': the live default today is Urdu, and an unknown language
     must keep behaving as it does today rather than silently
     switching the recogniser to English. Legacy codes 'ur' and 'pa'
     map to their families. */
  function recognitionLangFor(lang){
    if(lang == null || lang === '') return 'ur-PK';
    if(lang === 'ur') return 'ur-PK';
    if(lang === 'pa') return 'pa-PK';
    if(lang === 'english') return 'en-US';
    if(TTS_LANG[lang]) return TTS_LANG[lang];
    return 'ur-PK';
  }

  /* Patch for buildRecognition L7718: set r.lang from the resolved
     language instead of the hardcoded 'ur-PK'. Accepts a canonical
     code, a legacy code, or a BCP tag. Returns r. */
  function patchBuildRecognition(r, lang){
    if(!r) return r;
    r.lang = recognitionLangFor(lang);
    return r;
  }
  function applyRecognitionLang(r, lang){
    return patchBuildRecognition(r, lang);
  }

  /* P3f resolver threading. state is the live state object.
     Priority: state.lastAnswerLang (written by P2a when a question
     is sent) -> piece 44's resolveAnswerLang(state.lastHeardLang
     or state.lastQuestionText, state.langPref) when the resolver
     function is supplied -> 'ur-PK'. The resolver argument is
     optional: this piece never requires piece 44 to exist. */
  function recognitionLangFromState(state, resolveAnswerLang){
    if(state && state.lastAnswerLang) return recognitionLangFor(state.lastAnswerLang);
    var text = '';
    if(state){
      if(state.lastHeardLang) text = state.lastHeardLang;
      else if(state.lastQuestionText) text = state.lastQuestionText;
    }
    /* No last text at all means the language is unknown: keep the
       live default 'ur-PK' rather than letting the resolver's
       empty-input default ('en') silently switch the recogniser
       to English. */
    if(!String(text).trim()) return 'ur-PK';
    if(typeof resolveAnswerLang === 'function' && state){
      try{
        var resolved = resolveAnswerLang(text, state.langPref);
        if(resolved) return recognitionLangFor(resolved);
      }catch(e){}
    }
    return 'ur-PK';
  }
  function patchBuildRecognitionFromState(r, state, resolveAnswerLang){
    if(!r) return r;
    r.lang = recognitionLangFromState(state, resolveAnswerLang);
    return r;
  }

  var EnzoLang46 = {
    VERSION: VERSION,
    TTS_LANG: TTS_LANG,
    TTS_FALLBACK_LANG: TTS_FALLBACK_LANG,
    LANG_NAME: LANG_NAME,
    NO_VOICE_TEMPLATES: NO_VOICE_TEMPLATES,
    TTS_TEST_SENTENCES: TTS_TEST_SENTENCES,
    normaliseLang: normaliseLang,
    wantPrefixForLang: wantPrefixForLang,
    ttsLangFor: ttsLangFor,
    pickVoiceForLang: pickVoiceForLang,
    pickVoiceFor: pickVoiceFor,
    noVoiceMessage: noVoiceMessage,
    noteTtsFallback: noteTtsFallback,
    resetNoVoiceSeen: resetNoVoiceSeen,
    savedVoiceForLang: savedVoiceForLang,
    shouldApplySavedVoice: shouldApplySavedVoice,
    guardSavedVoice: guardSavedVoice,
    applyTtsLang: applyTtsLang,
    applyTtsVoice: applyTtsVoice,
    setupUtterance: setupUtterance,
    applySpeakTextPatch: applySpeakTextPatch,
    applyPlayerChunkPatch: applyPlayerChunkPatch,
    testSentenceForLang: testSentenceForLang,
    testSentenceForVoice: testSentenceForVoice,
    recognitionLangFor: recognitionLangFor,
    patchBuildRecognition: patchBuildRecognition,
    applyRecognitionLang: applyRecognitionLang,
    recognitionLangFromState: recognitionLangFromState,
    patchBuildRecognitionFromState: patchBuildRecognitionFromState
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoLang46 = EnzoLang46;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoLang46;

})(typeof window !== 'undefined' ? window : this);
