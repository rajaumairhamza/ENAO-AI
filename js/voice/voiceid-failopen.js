
/* ============================================================================
   ENAO AI — PIECE 42: voice-id fail-open (42-voiceid-failopen.js)
   Artifact slug: enao-ai, web_static. Built against live v61-deep-triggers-4lang
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines).
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   DEFECT (Raja, 22 Nov 2026 ~6:42 PM PKT): mic question -> ENZO never
   answers in voice. Root cause H1 (AUDIT.md section 4 F1, AUDIT-V54-MECHANICS.md
   section 5.1): the v55 voice-ID gate can swallow a mic question entirely.

   WHAT THIS PIECE DOES — and ONLY this (it does NOT touch speakText, the
   v54 funnel, or voice-profile enrollment / matching itself):
   1. Wraps gateAndRoute (gateMicQuestion) so a verdict based on MISSING /
      EMPTY measurement fails OPEN: the question is allowed through, marked
      {voiceCheck:'unmeasured'}, because a measurement failure is NOT
      evidence the voice is not Raja's. A MEASURED mismatch (real features
      present, similarity below threshold) still fails CLOSED with the
      existing varied professional refusal, exactly as today.
   2. A low-energy 'ignore' verdict is never silent any more: a short
      honest "couldn't hear that clearly — please say it again" prompt is
      surfaced through the existing toast (+ spoken, voice-in -> voice-out).
   3. The 15 s refusal cooldown may suppress REPEATED refusals, but the
      FIRST refusal the user would hear in a window is always delivered:
      if the gate paced it away, this wrapper speaks + toasts it once.
   4. flushVoiceQueueFixed checks allowQueued BEFORE clearing
      state.voiceQueue, so a gate-rejected queued utterance is KEPT in the
      queue (not silently lost) and the same honest handling as (2)/(3)
      is surfaced once for it.

   LOCKED RULES THIS PIECE PRESERVES (do not change in assembly)
   - ENZO listens ONLY to Raja's voice and follows ONLY his instructions.
   - A genuinely MEASURED non-Raja voice is still refused, professionally
     and with VARIED wording (the gate's own rotating refusal pool is used;
     this piece never invents a fixed refusal sentence, except for one
     clearly-marked last-resort fallback when the gate exposes no refusal
     text and no rotation function at all).
   - Authority is Raja's alone; conversation with others is allowed,
     commands are not (a 'chat' / guest-conversation verdict still
     proceeds, unchanged).
   - No profile enrolled -> never blocks (unchanged).
   - Zero emojis anywhere in this file.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies).

   LIVE ANCHORS (verified by grep/read against the live v61 file)
   - mic onresult gate call ......................... L7751
     var gateRes55 = window.EnzoVoiceID
       ? window.EnzoVoiceID.gateAndRoute(heard, {source:'call'})
       : {proceed:true};
   - onresult drop branch .......................... L7752-L7758
     if(!gateRes55.proceed){ ...maybeSpeak(refusal)...; return; }
   - flushVoiceQueue (clear-before-gate bug) ........ L7476-L7484
     state.voiceQueue='';   // L7480 — cleared BEFORE the gate check
     if(window.EnzoVoiceID && !window.EnzoVoiceID.allowQueued(q)){ return; } // L7483
   - toast(msg) (existing toast helper) ............. L5209
   - maybeSpeak / speakText ......................... L7486 / L7576

   GATE ANCHORS (~/workspace/enao-master-intel/pieces/04-voice-id.js)
   - DEFAULT_THRESHOLD = 0.65 ...................... L115
   - REFUSAL_COOLDOWN_MS = 15000 ................... L120
   - gateVoiceInput step 1: low energy -> 'ignore' . L845
   - gateVoiceInput step 2: no profile -> accept .... L852
   - gateVoiceInput step 3: no features -> fail closed 'no-features', score null
   - gateVoiceInput step 5: mismatch -> refuse, score = v.score (a number)
   - currentWindowFeatures() null when window empty or stale > 3 s
   - gateAndRoute: refuse -> handleRefusal (speak + toast), 'ignore' -> silent
   - allowQueued / checkQueued / nextRefusal exported for this piece to use

   ASSEMBLER NOTES
   - Replace the L7751 gate call with:
       var gateRes55 = window.EnzoVoiceFix42
         ? window.EnzoVoiceFix42.gateMicQuestion(heard, {source:'call'})
         : (window.EnzoVoiceID
             ? window.EnzoVoiceID.gateAndRoute(heard, {source:'call'})
             : {proceed:true});
     gateMicQuestion returns the same {proceed, decision} shape plus
     voiceCheck ('measured' | 'unmeasured' | 'no-profile' | 'guest' |
     'no-gate'), so the existing `if(!gateRes55.proceed)` branch keeps
     working unchanged. Internally it prefers the gate's side-effect-free
     gateVoiceText (verdict only, no speech) and owns all surfacing
     itself; it falls back to gateAndRoute only on a gate build without
     gateVoiceText. This matters: gateAndRoute speaks a refusal before
     returning, so a fail-open 'no-features' verdict reached through it
     would be heard as a refusal followed by an answer to the same
     question. When proceed is true with voiceCheck 'unmeasured',
     the UI may show a small honest note (e.g. "voice not verified — answered
     anyway") if the assembler wants; the answer itself must not be blocked.
     The existing L7754 maybeSpeak fallback for a refusal stays as a
     backstop; gateMicQuestion already delivers the first refusal itself,
     and the _v54Spoken-style double-delivery is avoided because the
     wrapper records what it spoke (see speakRefusalOnce).
   - Replace the body of flushVoiceQueue (L7476-L7484) with a call to:
       window.EnzoVoiceFix42.flushVoiceQueueFixed(state, {
         send: function(q){ ...existing send body (input fill + sendCurrent)... }
       });
     The existing busy early-return and the existing send body are preserved
     inside the piece; only the clear-before-gate ordering changes.
   - Held-queue note: a gate-rejected utterance stays in state.voiceQueue
     (by design — it must not be silently lost). While it sits there, new
     voice input appends to it (live onresult behaviour) and allowQueued
     will keep rejecting the combined string, so the assembler SHOULD wire
     EnzoVoiceFix42.discardVoiceQueue(state) to the input-clear / mic-off
     path so Raja can clear a held queue. The piece surfaces the hold
     once (toast), never repeatedly.
   ============================================================================ */
(function(root){
  'use strict';

  var VERSION = 'fix42-voiceid-failopen-v1';

  /* Same pacing as the v55 gate (04-voice-id.js L120). Only used to decide
     whether a refusal this wrapper delivers is the FIRST in its window. */
  var REFUSAL_COOLDOWN_MS = 15000;

  /* Short honest prompts for a low-energy / unheard mic result. The
     default is the English wording from the defect brief; pass
     opts.lang to pick the user's language: 'roman' for the Roman Urdu
     wording, 'urdu'/'ur' for Urdu script, 'punjabi'/'roman-punjabi'/
     'pa' for Roman Punjabi. Anything else (incl. no lang) is English. */
  var SAY_AGAIN_EN = 'I couldn\'t hear that clearly — please say it again.';
  var SAY_AGAIN_ROMAN = 'Main theek se sun nahi saka — please dobara bolain.';

  /* P5 loop guard (45-loop-guard.js): after SAY_AGAIN_GUARD_AFTER
     consecutive say-again failures the spoken prompt stops repeating
     (toast only) and a persistent typed fallback is shown instead.
     The counter lives in the fix42 module state (site 2) and resets
     on any successful hearing (site 5 + sites 8/9). */
  var SAY_AGAIN_GUARD_AFTER = 2;
  var TYPED_FALLBACK_ROMAN = 'Mic sun nahi pa raha — type karke bhej dein, wohi jawab milega.';
  var TYPED_FALLBACK_EN = 'The mic is having trouble hearing — please type your question, it works the same.';
  var TYPED_FALLBACK_UR = 'مائیک سن نہیں پا رہا — براہ کرم اپنا سوال ٹائپ کر کے بھیج دیں، وہی جواب ملے گا۔';
  var TYPED_FALLBACK_PUNJABI = 'Mic theek se sun nahi sakya — type karke bhej deyo, ohi jawab milega.';
  var SAY_AGAIN_URDU = 'میں ٹھیک سے سن نہیں سکا — براہ کرم دوبارہ بولیں۔';
  var SAY_AGAIN_PUNJABI = 'Main theek se sun nahi sakya — please dobara bolo.';

  /* Last-resort fallback refusal text, used ONLY when the gate exposes
     neither a refusal string for this utterance nor its rotating
     nextRefusal function (i.e. the varied pool is unreachable). In the
     live build the gate always supplies one of those, so this line is
     not expected to be heard. */
  var FALLBACK_REFUSAL = 'That voice is not authorized — only Raja\'s commands are followed.';

  /* Module state (per page load; reset by resetFix42, used by the harness).
     lastRefusalSpokenAt: ms timestamp of the last refusal the user
       actually heard (spoken by the gate or by this wrapper). Drives (3).
     refusalByText: the last few measured refusals, keyed by heard text,
       so flushVoiceQueueFixed can toast the SAME varied refusal the gate
       already chose instead of inventing a new sentence.
     refusalRotation: rotation state for the nextRefusal fallback path.
     lastQueuedNotice: "text|kind" key of the last held-queue notice
       surfaced, so a held utterance is announced once, not on every flush. */
  var state = {
    lastRefusalSpokenAt: null,
    refusalByText: [],
    refusalRotation: { idx: { en: -1, roman: -1, ur: -1 }, lastText: '' },
    lastQueuedNotice: null,
    sayAgainCount: 0,
    typedFallbackShown: false,
    typedFallbackText: null
  };

  function nowOf(o){
    if(o && typeof o.now === 'function') return o.now();
    return Date.now();
  }

  function getVoiceID(o){
    if(o && o.voiceID) return o.voiceID;
    if(typeof root !== 'undefined' && root && root.EnzoVoiceID) return root.EnzoVoiceID;
    return null;
  }

  function getToast(o){
    if(o && typeof o.toast === 'function') return o.toast;
    if(typeof root !== 'undefined' && root && typeof root.toast === 'function') return root.toast;
    return null;
  }

  function getSpeak(o){
    if(o && typeof o.speakText === 'function') return o.speakText;
    if(o && typeof o.speak === 'function') return o.speak;
    if(typeof root !== 'undefined' && root && typeof root.speakText === 'function') return root.speakText;
    return null;
  }

  function langForSpeech(refusalLang){
    if(refusalLang === 'en') return 'en-US';
    return 'ur-PK'; /* Roman Urdu and Urdu script are both spoken with the Urdu voice */
  }

  function pickSayAgain(o){
    var lang = o && o.lang;
    if(lang === 'roman') return SAY_AGAIN_ROMAN;
    if(lang === 'urdu' || lang === 'ur') return SAY_AGAIN_URDU;
    if(lang === 'punjabi' || lang === 'roman-punjabi' || lang === 'pa') return SAY_AGAIN_PUNJABI;
    return SAY_AGAIN_EN;
  }

  /* TTS voice for the say-again prompt ONLY, mirroring the live
     TTS_LANG map (L55302-55309): English -> en-US, Urdu script /
     Roman Urdu -> ur-PK, Punjabi / Roman Punjabi -> pa-PK. Anything
     else (incl. 'hindi', for which no say-again variant exists)
     falls back to en-US. Used ONLY by surfaceSayAgain below. */
  function sayAgainTtsLang(o){
    var lang = o && o.lang;
    if(lang === 'roman' || lang === 'urdu' || lang === 'ur') return 'ur-PK';
    if(lang === 'punjabi' || lang === 'roman-punjabi' || lang === 'pa') return 'pa-PK';
    return 'en-US';
  }

  function toastIt(o, text){
    var t = getToast(o);
    if(!t || !text) return false;
    try{ t(text); return true; }catch(e){ return false; }
  }

  function speakIt(o, text, speechLang){
    var s = getSpeak(o);
    if(!s || !text) return false;
    try{ s(text, speechLang); return true; }catch(e){ return false; }
  }

  /* Deliver one spoken + toasted line through the existing page paths:
     toast always, speak when a speak function is available (voice-in ->
     voice-out). Returns true when at least the toast went out. */
  function deliverLine(o, text, speechLang){
    var toasted = toastIt(o, text);
    var spoken = speakIt(o, text, speechLang);
    return { toasted: toasted, spoken: spoken };
  }

  /* ------------------------------------------------------------------
     (1) MEASURED vs UNMEASURED — the core distinction.
     measureStatus(decision, voiceID) -> {unmeasured, cause}
     - reason 'no-features' ............ unmeasured (gate step 3: the
       feature window was empty/stale, so nothing was ever measured).
     - score is a number ............... MEASURED. A mismatch refusal
       carries score = v.score (gate step 5); a match carries its score.
       A real number means real features were present at gate time.
     - reason 'low-energy' ............. unmeasured (noise, not a voice).
     - score missing + feature window empty / analyser throwing ->
       unmeasured ('window-empty' / 'analyser-unavailable').
     - score missing for any other reason -> unmeasured ('no-score'):
       a verdict with no measurement behind it is not evidence the
       voice is not Raja's.
     ------------------------------------------------------------------ */
  function measureStatus(decision, voiceID){
    if(!decision) return { unmeasured: true, cause: 'no-decision' };
    if(decision.reason === 'no-features') return { unmeasured: true, cause: 'no-features' };
    if(typeof decision.score === 'number') return { unmeasured: false, cause: 'measured' };
    if(decision.reason === 'low-energy') return { unmeasured: true, cause: 'low-energy' };
    if(voiceID && typeof voiceID.currentWindowFeatures === 'function'){
      try{
        var w = voiceID.currentWindowFeatures();
        if(!w || !w.vector) return { unmeasured: true, cause: 'window-empty' };
      }catch(e){
        return { unmeasured: true, cause: 'analyser-unavailable' };
      }
    }
    return { unmeasured: true, cause: 'no-score' };
  }

  function rememberRefusal(text, decision, spoken){
    state.refusalByText.push({
      text: String(text || '').trim(),
      refusal: decision.refusal || null,
      refusalLang: decision.refusalLang || null,
      spoken: !!spoken
    });
    if(state.refusalByText.length > 10) state.refusalByText.shift();
  }

  function findRefusal(text){
    var q = String(text || '').trim();
    if(!q) return null;
    var i, e;
    for(i = state.refusalByText.length - 1; i >= 0; i--){
      e = state.refusalByText[i];
      if(e && e.text && (q.indexOf(e.text) !== -1 || e.text.indexOf(q) !== -1)) return e;
    }
    return null;
  }

  /* ------------------------------------------------------------------
     (3) FIRST REFUSAL ALWAYS GOES THROUGH.
     speakRefusalOnce(decision, o, nowMs, gateAlreadySpoke) ->
       {spoken, first, via}
     - gateAlreadySpoke true (the gateAndRoute path, where the gate
       itself already spoke this refusal): record it, do NOT speak again.
     - decision.speak === true and the gate did NOT already speak it
       (the gateVoiceText path): deliver it now.
     - decision.speak === false (or missing): the gate paced it away.
       If no refusal has been heard in this cooldown window, THIS is
       the first refusal the user would hear, so deliver it (speak +
       toast) and record it. If one was already heard inside the
       window, suppress the repeat.
     ------------------------------------------------------------------ */
  function speakRefusalOnce(decision, o, nowMs, gateAlreadySpoke){
    var cooldown = (o && typeof o.refusalCooldownMs === 'number')
      ? o.refusalCooldownMs : REFUSAL_COOLDOWN_MS;
    if(decision.speak === true && gateAlreadySpoke){
      state.lastRefusalSpokenAt = nowMs;
      return { spoken: true, first: true, via: 'gate' };
    }
    if(decision.speak === true){
      var lang = langForSpeech(decision.refusalLang);
      deliverLine(o, decision.refusal, lang);
      state.lastRefusalSpokenAt = nowMs;
      return { spoken: true, first: true, via: 'fix42' };
    }
    if(state.lastRefusalSpokenAt === null ||
      (nowMs - state.lastRefusalSpokenAt) >= cooldown){
      var lang2 = langForSpeech(decision.refusalLang);
      deliverLine(o, decision.refusal, lang2);
      state.lastRefusalSpokenAt = nowMs;
      return { spoken: true, first: true, via: 'fix42' };
    }
    return { spoken: false, first: false, via: 'cooldown' };
  }

  /* (2) Low-energy prompt. Toast + speak the honest "say it again" line. */
  /* P5 — typed-fallback text in the user's language. Same lang
     vocabulary as pickSayAgain after P4: 'en'/'english' -> English,
     'urdu'/'ur' -> Urdu script, 'punjabi'/'roman-punjabi'/'pa' ->
     Roman Punjabi. Everything else (incl. 'roman' and NO lang at
     all) -> Roman Urdu, which is the default: live call sites pass
     no lang, and Raja's working language is Roman Urdu. Does NOT
     change pickSayAgain (P4 owns the say-again line's language). */
  function pickTypedFallback(o){
    var lang = o && o.lang;
    if(lang === 'en' || lang === 'english') return TYPED_FALLBACK_EN;
    if(lang === 'urdu' || lang === 'ur') return TYPED_FALLBACK_UR;
    if(lang === 'punjabi' || lang === 'roman-punjabi' || lang === 'pa') return TYPED_FALLBACK_PUNJABI;
    return TYPED_FALLBACK_ROMAN;
  }

  function getDocument(o){
    if(o && o.document) return o.document;
    if(typeof root !== 'undefined' && root && root.document) return root.document;
    if(typeof document !== 'undefined') return document;
    return null;
  }

  /* P5 — show the persistent typed fallback. Visible without opening
     any menu: a chip inserted in .composer-inner, directly above the
     composer box, so it sits on screen next to the text field.
     Created once, re-shown with new text only if the text changed.
     Tapping it focuses the text field. opts.onShowTypedFallback(text),
     when supplied (harness / assembler wiring), replaces the DOM
     path. Returns true when the fallback is (now) visible or recorded. */
  function showTypedFallback(o, text){
    var already = state.typedFallbackShown && state.typedFallbackText === text;
    state.typedFallbackShown = true;
    state.typedFallbackText = text;
    if(already) return true;
    if(o && typeof o.onShowTypedFallback === 'function'){
      try{ o.onShowTypedFallback(text); }catch(e){}
      return true;
    }
    var doc = getDocument(o);
    if(!doc) return false;
    try{
      var el = doc.getElementById('enaoTypedFallback');
      if(!el){
        el = doc.createElement('div');
        el.id = 'enaoTypedFallback';
        el.setAttribute('role', 'status');
        el.style.display = 'block';
        el.style.margin = '0 0 8px 0';
        el.style.padding = '10px 12px';
        el.style.borderRadius = '12px';
        el.style.border = '1px solid var(--line, #d8d8d8)';
        el.style.background = 'var(--surface, #ffffff)';
        el.style.color = 'var(--ink, #111111)';
        el.style.fontSize = '14px';
        el.style.lineHeight = '1.5';
        el.style.cursor = 'text';
        el.onclick = function(){
          try{ var inp = doc.getElementById('input'); if(inp) inp.focus(); }catch(e2){}
        };
        var anchor = doc.querySelector ? doc.querySelector('.composer-inner') : null;
        var box = (anchor && anchor.querySelector) ? anchor.querySelector('.composer-box') : null;
        if(anchor && box) anchor.insertBefore(el, box);
        else if(anchor) anchor.appendChild(el);
        else if(doc.body) doc.body.appendChild(el);
        else return false;
      }
      el.textContent = text;
      el.style.display = 'block';
      return true;
    }catch(e){ return false; }
  }

  function hideTypedFallback(o){
    state.typedFallbackShown = false;
    state.typedFallbackText = null;
    if(o && typeof o.onHideTypedFallback === 'function'){
      try{ o.onHideTypedFallback(); }catch(e){}
      return true;
    }
    var doc = getDocument(o);
    if(!doc) return false;
    try{
      var el = doc.getElementById('enaoTypedFallback');
      if(el) el.style.display = 'none';
      return true;
    }catch(e){ return false; }
  }

  /* P5 — reset the loop guard. Called on ANY successful hearing (every
     proceed:true return in gateMicQuestion, site 5) and on any question
     send (askQuestion / backendAsk, sites 8/9, which covers typed sends
     too). Hides the persistent fallback. Returns whether anything was
     actually reset, so callers can tell a live guard from a fresh one. */
  function resetSayAgainLoop(o){
    if(state.sayAgainCount === 0 && !state.typedFallbackShown) return { reset: false, sayAgainCount: 0 };
    state.sayAgainCount = 0;
    hideTypedFallback(o);
    return { reset: true, sayAgainCount: 0 };
  }

  /* P5 loop guard on the (2) low-energy prompt: the first
     SAY_AGAIN_GUARD_AFTER (2) consecutive failures speak + toast
     exactly as before. From the 3rd consecutive failure on, the
     spoken line STOPS (toast only) and the persistent typed fallback
     is shown instead, until a hearing succeeds. The refusal cooldown
     is untouched — this guard is only for say-again. */
  function surfaceSayAgain(o){
    var text = pickSayAgain(o);
    state.sayAgainCount++;
    if(state.sayAgainCount > SAY_AGAIN_GUARD_AFTER){
      var fb = pickTypedFallback(o);
      showTypedFallback(o, fb);
      var toasted = toastIt(o, text);
      return { text: text, toasted: toasted, spoken: false, guarded: true,
        sayAgainCount: state.sayAgainCount, typedFallbackShown: true, fallbackText: fb };
    }
    var res = deliverLine(o, text, sayAgainTtsLang(o));
    return { text: text, toasted: res.toasted, spoken: res.spoken, guarded: false,
      sayAgainCount: state.sayAgainCount, typedFallbackShown: state.typedFallbackShown,
      fallbackText: state.typedFallbackText };
  }

  /* Surface the honest handling for a HELD queued utterance (4).
     'refuse' -> toast the SAME varied refusal the gate already chose
       for this text (recorded by gateMicQuestion); if none was recorded
       (the refusal came through another entry point), build one from
       the gate's own rotating nextRefusal pool; only if the gate
       exposes neither do we use the marked fallback line. Never
       re-speak here: the first refusal was already spoken at gate time
       (rule 3); the toast makes the hold visible.
     'ignore' / unknown -> the "say it again" prompt. */
  function surfaceHeldQueue(text, kind, o, nowMs){
    if(kind === 'refuse'){
      var rec = findRefusal(text);
      if(rec && rec.refusal){
        toastIt(o, rec.refusal);
        return { surfaced: 'refusal-toast', refusal: rec.refusal };
      }
      var voiceID = getVoiceID(o);
      if(voiceID && typeof voiceID.nextRefusal === 'function'){
        var r;
        try{
          r = voiceID.nextRefusal('roman', state.refusalRotation);
        }catch(e){ r = null; }
        if(r && r.text){
          var d = { decision: 'refuse', refusal: r.text, refusalLang: r.lang, speak: false };
          var s = speakRefusalOnce(d, o, nowMs, false);
          return { surfaced: s.spoken ? 'refusal' : 'refusal-suppressed-cooldown', refusal: r.text };
        }
      }
      toastIt(o, FALLBACK_REFUSAL);
      return { surfaced: 'refusal-fallback', refusal: FALLBACK_REFUSAL };
    }
    var again = surfaceSayAgain(o);
    return { surfaced: 'say-again', prompt: again.text, guarded: again.guarded,
      sayAgainCount: again.sayAgainCount, typedFallbackShown: again.typedFallbackShown,
      fallbackText: again.fallbackText || null };
  }

  /* ------------------------------------------------------------------
     gateMicQuestion(text, opts) — drop-in replacement for the live
     L7751 gateAndRoute call in recognition onresult.
     opts: {source, lang, voiceID, speakText, speak, toast, now,
            refusalCooldownMs}
     Returns {proceed, decision, voiceCheck, surfaced, refusalSpoken,
              refusal, firstRefusal, note, text}.
     voiceCheck: 'measured' | 'unmeasured' | 'no-profile' | 'guest' |
       'no-gate' | 'empty'.
     ------------------------------------------------------------------ */
  function gateMicQuestion(text, opts){
    var o = opts || {};
    var heard = String(text || '').trim();
    var nowMs = nowOf(o);
    var out = {
      proceed: true, decision: null, voiceCheck: 'no-gate',
      surfaced: null, refusalSpoken: false, refusal: null,
      firstRefusal: false, note: null, text: heard,
      guarded: false, sayAgainCount: 0, typedFallbackShown: false, fallbackText: null,
      spoken: false, toasted: false
    };
    if(!heard){
      out.proceed = false;
      out.voiceCheck = 'empty';
      return out;
    }
    var voiceID = getVoiceID(o);
    if(!voiceID || (typeof voiceID.gateAndRoute !== 'function' &&
      typeof voiceID.gateVoiceText !== 'function')){
      out.voiceCheck = 'no-gate';
      resetSayAgainLoop(o);
      return out; /* no gate installed: proceed, exactly like live L7751 */
    }
    /* Prefer gateVoiceText when the gate exposes it: it returns the
       verdict WITHOUT speaking or toasting anything, so this wrapper
       owns all surfacing. That matters for fail-open: an unmeasured
       'no-features' refusal must never be spoken first and then
       overridden by an answer — the user would hear a refusal followed
       by an answer to the same question. gateVoiceText also remembers
       the decision, so allowQueued keeps working for the queue path.
       Fall back to gateAndRoute (which speaks refusals itself) only
       on a gate build that does not expose gateVoiceText. */
    var useTextPath = (typeof voiceID.gateVoiceText === 'function');
    var gateAlreadySpoke = !useTextPath;
    var res;
    try{
      if(useTextPath){
        var d0 = voiceID.gateVoiceText(heard, { source: o.source || 'call', lang: o.lang });
        res = {
          proceed: !!d0 && (d0.decision === 'accept' || d0.decision === 'chat'),
          decision: d0 || null
        };
      }else{
        res = voiceID.gateAndRoute(heard, { source: o.source || 'call', lang: o.lang });
      }
    }catch(e){
      /* The gate itself threw (e.g. analyser unavailable mid-call):
         that is a measurement failure, not a non-Raja verdict. */
      out.proceed = true;
      out.voiceCheck = 'unmeasured';
      out.note = 'fail-open:gate-error';
      resetSayAgainLoop(o);
      return out;
    }
    if(!res){
      out.proceed = true;
      out.voiceCheck = 'unmeasured';
      out.note = 'fail-open:no-result';
      resetSayAgainLoop(o);
      return out;
    }
    var d = res.decision || null;
    out.decision = d;
    if(res.proceed){
      if(d && d.decision === 'chat') out.voiceCheck = 'guest';
      else if(d && d.reason === 'no-profile') out.voiceCheck = 'no-profile';
      else out.voiceCheck = 'measured';
      resetSayAgainLoop(o);
      return out;
    }
    /* proceed:false — decide WHY before deciding whether to block. */
    if(d && d.decision === 'ignore'){
      /* P2 (42-transcript-fails-open) + P5 loop guard: a non-empty final
         transcript is evidence of hearing. The gate's low-energy reading
         is taken at final-result time, i.e. on the trailing silence after
         the user stopped speaking (AUDIT RC1), so it must not discard real
         words. Fail OPEN: the question proceeds to normal handling. Only
         a genuinely empty/missing transcript may still take the say-again
         path (defensive else below; unreachable today because the empty
         early return above already drops empty input silently — AUDIT
         §1.6 — but kept so a future refactor of that early return cannot
         silently reintroduce the block). A fail-open proceed IS a
         successful hearing, so the loop guard resets (P5). */
      if(heard){
        out.proceed = true;
        out.voiceCheck = 'unmeasured';
        out.note = 'fail-open:ignore-with-transcript';
        resetSayAgainLoop(o);
        return out;
      }
      /* No transcript at all: the original low-energy prompt still applies. */
      out.proceed = false;
      out.voiceCheck = 'unmeasured';
      var again = surfaceSayAgain(o);
      out.surfaced = 'say-again';
      out.guarded = again.guarded;
      out.sayAgainCount = again.sayAgainCount;
      out.typedFallbackShown = again.typedFallbackShown;
      out.fallbackText = again.fallbackText || null;
      out.spoken = again.spoken;
      out.toasted = again.toasted;
      return out;
    }
    if(d && d.decision === 'refuse'){
      var ms = measureStatus(d, voiceID);
      if(ms.unmeasured){
        /* (1) No measurement behind the refusal: fail OPEN. It is
           Raja's own mic tap in his own browser session, and there is
           no evidence it is not him. The note lets the UI say so. */
        out.proceed = true;
        out.voiceCheck = 'unmeasured';
        out.note = 'fail-open:' + ms.cause;
        resetSayAgainLoop(o);
        return out;
      }
      /* MEASURED non-Raja voice: fail CLOSED, varied refusal, and the
         first refusal in the window is always delivered (3). */
      out.proceed = false;
      out.voiceCheck = 'measured';
      out.refusal = d.refusal || null;
      var spoken = speakRefusalOnce(d, o, nowMs, gateAlreadySpoke);
      out.refusalSpoken = spoken.spoken;
      out.firstRefusal = spoken.first;
      out.surfaced = spoken.spoken ? 'refusal' : 'refusal-suppressed-cooldown';
      rememberRefusal(heard, d, spoken.spoken);
      return out;
    }
    /* Unknown decision kind: fail open rather than drop a question on
       a verdict this wrapper cannot interpret. */
    out.proceed = true;
    out.voiceCheck = 'unmeasured';
    out.note = 'fail-open:unknown-decision';
    resetSayAgainLoop(o);
    return out;
  }


  /* ------------------------------------------------------------------
     flushVoiceQueueFixed(stateObj, opts) — replacement for live
     flushVoiceQueue (L7476-L7484). The ONLY ordering change: the
     allowQueued gate check now runs BEFORE state.voiceQueue is
     cleared. A rejected utterance stays queued (kept:true) and its
     honest handling is surfaced once; an allowed utterance is sent
     and the queue is cleared.
     opts: {voiceID, speakText, speak, toast, now, refusalCooldownMs,
            send} — send(q) performs the existing send body (fill the
       input, set nextAskViaVoice, sendCurrent). When send is omitted,
       the piece falls back to the live page globals ($('input'),
       sendCurrent) exactly as the old function did.
     Returns {sent, reason, kept, queued, kind, surfaced}.
     ------------------------------------------------------------------ */
  function flushVoiceQueueFixed(stateObj, opts){
    var o = opts || {};
    var st = stateObj || {};
    var nowMs = nowOf(o);
    var q = String(st.voiceQueue || '').trim();
    if(!q) return { sent: false, reason: 'empty', kept: false, queued: '', kind: null, surfaced: null };
    if(st.isGenerating || st.isSpeaking){
      return { sent: false, reason: 'busy', kept: true, queued: q, kind: null, surfaced: null };
    }
    var voiceID = getVoiceID(o);
    if(voiceID && typeof voiceID.allowQueued === 'function'){
      var allowed = false;
      try{ allowed = !!voiceID.allowQueued(q); }catch(e){ allowed = false; }
      /* P2 (42-transcript-fails-open): a remembered 'ignore' verdict must
         not block a real queued transcript. gateVoiceText remembers every
         verdict (including 'ignore', from the trailing-silence energy
         read — AUDIT RC1/RC3), and allowQueued returns false for it, so
         without this the speech queued while ENZO was busy would
         re-surface the same "couldn't hear" line on flush even though
         the words were heard. A non-empty queued transcript therefore
         fails open here, exactly as gateMicQuestion does above. A
         remembered 'refuse' (measured non-Raja voice) is NOT affected:
         allowQueued stays false for it and the held-queue refusal
         handling below still runs. (q is guaranteed non-empty here by
         the early return above; checkQueued returns null for empty.) */
      if(!allowed && typeof voiceID.checkQueued === 'function'){
        try{ if(voiceID.checkQueued(q) === 'ignore') allowed = true; }catch(e){}
      }
      if(!allowed){
        /* (4) DO NOT clear the queue: the utterance is kept, not lost. */
        st.voiceQueue = q;
        var kind = 'unknown';
        if(typeof voiceID.checkQueued === 'function'){
          try{
            var cq = voiceID.checkQueued(q);
            if(cq) kind = cq;
          }catch(e){}
        }
        var surfaced = null;
        var noticeKey = q + '|' + kind;
        if(state.lastQueuedNotice !== noticeKey){
          state.lastQueuedNotice = noticeKey;
          surfaced = surfaceHeldQueue(q, kind, o, nowMs).surfaced;
        }
        return { sent: false, reason: 'gate-rejected', kept: true, queued: q, kind: kind, surfaced: surfaced };
      }
    }
    /* Allowed (or no gate): clear first, then send — the old order,
       now safe because the gate already passed. */
    st.voiceQueue = '';
    if(typeof o.send === 'function'){
      try{ o.send(q); }catch(e){}
    }else if(typeof root !== 'undefined' && root){
      try{
        if(typeof root.$ === 'function' && root.$('input')) root.$('input').value = q;
        if(typeof root.sendCurrent === 'function'){
          st.nextAskViaVoice = true;
          setTimeout(function(){ root.sendCurrent(); }, 200);
        }
      }catch(e){}
    }
    return { sent: true, reason: 'sent', kept: false, queued: '', kind: null, surfaced: null };
  }

  /* Clear a held queue (assembler: wire to input-clear / mic-off).
     Also clears the once-only notice so a future hold is announced. */
  function discardVoiceQueue(stateObj){
    if(stateObj) stateObj.voiceQueue = '';
    state.lastQueuedNotice = null;
    return { ok: true };
  }

  /* Test / harness hook: reset module state between cases. */
  function resetFix42(){
    state.lastRefusalSpokenAt = null;
    state.refusalByText = [];
    state.refusalRotation = { idx: { en: -1, roman: -1, ur: -1 }, lastText: '' };
    state.lastQueuedNotice = null;
    state.sayAgainCount = 0;
    state.typedFallbackShown = false;
    state.typedFallbackText = null;
    hideTypedFallback(null);
    return { ok: true };
  }

  var EnzoVoiceFix42 = {
    VERSION: VERSION,
    LOOP_GUARD_VERSION: '45-loop-guard-v1',
    REFUSAL_COOLDOWN_MS: REFUSAL_COOLDOWN_MS,
    SAY_AGAIN_EN: SAY_AGAIN_EN,
    SAY_AGAIN_ROMAN: SAY_AGAIN_ROMAN,
    SAY_AGAIN_URDU: SAY_AGAIN_URDU,
    SAY_AGAIN_PUNJABI: SAY_AGAIN_PUNJABI,
    SAY_AGAIN_GUARD_AFTER: SAY_AGAIN_GUARD_AFTER,
    TYPED_FALLBACK_ROMAN: TYPED_FALLBACK_ROMAN,
    TYPED_FALLBACK_EN: TYPED_FALLBACK_EN,
    TYPED_FALLBACK_UR: TYPED_FALLBACK_UR,
    TYPED_FALLBACK_PUNJABI: TYPED_FALLBACK_PUNJABI,
    measureStatus: measureStatus,
    gateMicQuestion: gateMicQuestion,
    flushVoiceQueueFixed: flushVoiceQueueFixed,
    discardVoiceQueue: discardVoiceQueue,
    surfaceSayAgain: surfaceSayAgain,
    surfaceHeldQueue: surfaceHeldQueue,
    speakRefusalOnce: speakRefusalOnce,
    showTypedFallback: showTypedFallback,
    hideTypedFallback: hideTypedFallback,
    resetSayAgainLoop: resetSayAgainLoop,
    pickTypedFallback: pickTypedFallback,
    sayAgainState: function(){ return { count: state.sayAgainCount, typedFallbackShown: state.typedFallbackShown, typedFallbackText: state.typedFallbackText }; },
    resetFix42: resetFix42
  };
;

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoVoiceFix42 = EnzoVoiceFix42;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoVoiceFix42;

})(typeof window !== 'undefined' ? window : this);
/* === MODULE-START: EnzoHearFix46 (piece 46) === */
(function(root){
  'use strict';

  var VERSION = 'hearfix46-interim-honest-v1';

  /* Honest handling fires this long after the LAST interim result when no
     final result has arrived. Chrome normally delivers a final within ~1-2 s
     of a pause, so 4 s means the final is (almost certainly) never coming.
     Trade-off, stated plainly: a user who pauses mid-sentence for more
     than 4 s hears the partial message once, then can keep speaking; the
     message never claims nothing was heard, it quotes what was heard. */
  var PARTIAL_TIMEOUT_MS = 4000;
  var PARTIAL_MAX_CHARS = 120;

  /* Say-again wording — identical to fix42 L53903-L53904, so the
     no-interim fallback speaks exactly the normal say-again line. */
  var SAY_AGAIN_EN = 'I couldn\'t hear that clearly — please say it again.';
  var SAY_AGAIN_ROMAN = 'Main theek se sun nahi saka — please dobara bolain.';

  var st = { partial: '', partialAt: 0, timer: null, surfacedFor: '', lastOpts: null };

  function nowOf(o){
    if(o && typeof o.now === 'function') return o.now();
    return Date.now();
  }

  function getToast(o){
    if(o && typeof o.toast === 'function') return o.toast;
    if(typeof root !== 'undefined' && root && typeof root.toast === 'function') return root.toast;
    return null;
  }

  function getSpeak(o){
    if(o && typeof o.speakText === 'function') return o.speakText;
    if(o && typeof o.speak === 'function') return o.speak;
    if(typeof root !== 'undefined' && root && typeof root.speakText === 'function') return root.speakText;
    return null;
  }

  function getFix42(){
    if(typeof root !== 'undefined' && root && root.EnzoVoiceFix42) return root.EnzoVoiceFix42;
    if(typeof window !== 'undefined' && window.EnzoVoiceFix42) return window.EnzoVoiceFix42;
    if(typeof global !== 'undefined' && global.EnzoVoiceFix42) return global.EnzoVoiceFix42;
    return null;
  }

  function setTimer(o, fn, ms){
    if(o && typeof o.setTimeout === 'function') return o.setTimeout(fn, ms);
    return setTimeout(fn, ms);
  }

  function clearTimer(o, id){
    if(id === null || id === undefined) return;
    if(o && typeof o.clearTimeout === 'function'){ try{ o.clearTimeout(id); }catch(e){} return; }
    clearTimeout(id);
  }

  /* Map page state to the exact two codes fix42 pickSayAgain understands
     (L53958-L53961: 'roman' or 'ur' -> Roman Urdu wording, else English).
     Reads state.lastAnswerLang first, then state.langPref; 'urdu' maps to
     'ur'. Anything else (including 'auto', 'en', 'punjabi') returns
     undefined, which is pickSayAgain's English default. */
  function sayAgainLangFor(stateObj){
    var s = stateObj || {};
    var cands = [s.lastAnswerLang, s.langPref];
    var i, c;
    for(i = 0; i < cands.length; i++){
      c = cands[i];
      if(c === 'roman') return 'roman';
      if(c === 'urdu' || c === 'ur') return 'ur';
    }
    return undefined;
  }

  /* The partial text is quoted verbatim, only whitespace-collapsed and
     capped (truncation is not invention; a cut is marked with ...). */
  function trimPartial(p){
    var t = String(p || '').trim().replace(/\s+/g, ' ');
    if(t.length > PARTIAL_MAX_CHARS) t = t.slice(0, PARTIAL_MAX_CHARS).trim() + '...';
    return t;
  }

  function partialText(o, partial){
    var shown = trimPartial(partial);
    var lang = o && o.lang;
    if(lang === 'roman' || lang === 'ur'){
      return 'Main poora theek se sun nahi saka — maine sirf ye suna: \u201c' + shown + '\u201d. Please dobara bolain, ya type kar dain.';
    }
    return 'I heard part of that — \u201c' + shown + '\u201d — but I didn\'t catch the rest. Please say it again, or finish it by typing.';
  }

  function speechLangFor(o){
    var lang = o && o.lang;
    if(lang === 'roman' || lang === 'ur') return 'ur-PK';
    return 'en-US';
  }

  /* Deliver one spoken + toasted line through the existing page paths,
     exactly like fix42 deliverLine: toast always, speak when a speak
     function is available (voice-in -> voice-out). */
  function deliver(o, text, speechLang){
    var toasted = false, spoken = false;
    var t = getToast(o);
    if(t && text){ try{ t(text); toasted = true; }catch(e){} }
    var s = getSpeak(o);
    if(s && text){ try{ s(text, speechLang); spoken = true; }catch(e){} }
    return { toasted: toasted, spoken: spoken };
  }

  /* Shared fire path for the timer and the error event. Returns
     {surfaced:'partial', text, partial, toasted, spoken} on delivery,
     otherwise {surfaced:null, reason, partial?}. */
  function firePartial(o){
    var partial = st.partial;
    if(!partial) return { surfaced: null, reason: 'no-partial' };
    if(st.surfacedFor === partial) return { surfaced: null, reason: 'already-surfaced', partial: partial };
    if(o && typeof o.live === 'function'){
      var live = false;
      try{ live = !!o.live(); }catch(e){ live = false; }
      if(!live){ clearInterim(); return { surfaced: null, reason: 'not-live' }; }
    }
    if(o && typeof o.currentInput === 'function'){
      var cur = null;
      try{ cur = o.currentInput(); }catch(e){ cur = null; }
      if(typeof cur === 'string'){
        if(!cur.trim() || cur.indexOf(partial) === -1){
          /* Composer no longer holds the partial (sent, cleared, or typed
             over): the partial is stale, do not announce it. */
          clearInterim();
          return { surfaced: null, reason: 'composer-changed' };
        }
      }
    }
    var text = partialText(o, partial);
    var res = deliver(o, text, speechLangFor(o));
    st.surfacedFor = partial;
    st.timer = null;
    return { surfaced: 'partial', text: text, partial: partial, toasted: res.toasted, spoken: res.spoken };
  }

  /* Remember the partial text and arm (or re-arm) the honest-message
     timer. opts: {lang, toast, speakText, live, currentInput, timeoutMs,
     now, setTimeout, clearTimeout}. Returns {recorded, partial, armed,
     timeoutMs}. A new interim batch resets surfacedFor so a fresh stall
     can be announced once. */
  function recordInterim(text, opts){
    var o = opts || {};
    var partial = String(text || '').trim();
    if(!partial) return { recorded: false, partial: '' };
    var timeoutMs = (typeof o.timeoutMs === 'number' && o.timeoutMs > 0) ? o.timeoutMs : PARTIAL_TIMEOUT_MS;
    clearTimer(o, st.timer);
    st.timer = null;
    st.partial = partial;
    st.partialAt = nowOf(o);
    st.surfacedFor = '';
    st.lastOpts = o;
    var selfOpts = o;
    st.timer = setTimer(o, function(){ firePartial(selfOpts); }, timeoutMs);
    return { recorded: true, partial: partial, armed: true, timeoutMs: timeoutMs };
  }

  /* A final result arrived (or the utterance is otherwise complete):
     the partial timer is no longer needed. */
  function clearInterim(opts){
    clearTimer(opts || st.lastOpts, st.timer);
    st.timer = null;
    st.partial = '';
    st.partialAt = 0;
    st.surfacedFor = '';
    st.lastOpts = null;
    return { ok: true };
  }

  /* Surface the honest partial message now (error path). */
  function surfacePartial(opts){
    return firePartial(opts || {});
  }

  /* The normal say-again prompt, with the same wording as fix42.
     Used when an error fires and nothing at all was heard. */
  function surfaceSayAgainFallback(o){
    var lang = o && o.lang;
    var text = (lang === 'roman' || lang === 'ur') ? SAY_AGAIN_ROMAN : SAY_AGAIN_EN;
    var res = deliver(o, text, speechLangFor(o));
    return { surfaced: 'say-again', text: text, toasted: res.toasted, spoken: res.spoken };
  }

  /* Recognition error handler. Only 'no-speech' and 'network' are handled
     here — the existing code already owns 'not-allowed',
     'service-not-allowed', 'audio-capture' (and 'aborted' stays transient).
     With interim text: the honest partial message. Without any interim:
     the NORMAL say-again path — fix42 surfaceSayAgain when present (same
     wording, same language selection), otherwise the built-in fallback.
     Never silent, never the partial message when there is no partial. */
  function onRecognitionError(error, opts){
    var o = opts || {};
    if(error !== 'no-speech' && error !== 'network'){
      return { surfaced: null, reason: 'not-handled', error: error };
    }
    if(st.partial){
      var r = firePartial(o);
      if(r.surfaced) return r;
      if(r.reason === 'already-surfaced') return { surfaced: null, reason: 'already-surfaced', partial: st.partial };
      return { surfaced: null, reason: r.reason, partial: null };
    }
    var fix42 = getFix42();
    if(fix42 && typeof fix42.surfaceSayAgain === 'function'){
      var res = null;
      try{ res = fix42.surfaceSayAgain(o); }catch(e){ res = null; }
      if(res && res.text) return { surfaced: 'say-again', text: res.text, toasted: res.toasted, spoken: res.spoken, via: 'fix42' };
    }
    var fb = surfaceSayAgainFallback(o);
    fb.via = 'fallback';
    return fb;
  }

  /* Test / harness hook: reset module state between cases. */
  function reset(){
    clearTimer(st.lastOpts, st.timer);
    st.timer = null;
    st.partial = '';
    st.partialAt = 0;
    st.surfacedFor = '';
    st.lastOpts = null;
    return { ok: true };
  }

  /* ------------------------------------------------------------------
     ASSEMBLY_SITES — exact originals (byte-identical to the live
     v63-voice-lang file) and exact replacements for the assembler.
     The Node self-test verifies every `original` occurs verbatim in
     the base file. Site 3's replacement is the four anchor lines plus
     the module IIFE in this file (MODULE-START..MODULE-END).
     ------------------------------------------------------------------ */
  var ASSEMBLY_SITES = [
    {
      site: 1,
      where: "buildRecognition r.onerror — live file L12331-L12340",
      original: [
        "  r.onerror=function(e){",
        "    if(e.error==='not-allowed' || e.error==='service-not-allowed'){",
        "      showMicBlocked();",
        "    }",
        "    else if(e.error==='audio-capture'){",
        "      turnMicOff();",
        "      toast('No microphone was found on this device — typing works normally');",
        "    }",
        "    /* 'network' / 'no-speech' / 'aborted' are transient — the live loop restarts listening on its own */",
        "  };"
      ].join("\n"),
      replacement: [
        "  function hearFix46Opts(){",
        "    var lang = window.EnzoHearFix46 ? window.EnzoHearFix46.sayAgainLangFor(state) : undefined;",
        "    return {",
        "      lang: lang,",
        "      toast: (typeof toast === 'function' ? toast : null),",
        "      speakText: (typeof speakText === 'function' ? speakText : null),",
        "      live: function(){ return !!state.voiceLive; },",
        "      currentInput: function(){ try{ return $('input').value; }catch(e){ return null; } }",
        "    };",
        "  }",
        "  r.onerror=function(e){",
        "    if(e.error==='not-allowed' || e.error==='service-not-allowed'){",
        "      showMicBlocked();",
        "    }",
        "    else if(e.error==='audio-capture'){",
        "      turnMicOff();",
        "      toast('No microphone was found on this device — typing works normally');",
        "    }",
        "    else if(e.error==='no-speech' || e.error==='network'){",
        "      // P46: no longer silent. Interim text heard -> honest partial",
        "      // message; nothing heard at all -> the normal say-again prompt.",
        "      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.onRecognitionError(e.error, hearFix46Opts()); }catch(err){}",
        "    }",
        "    /* 'aborted' is transient — the live loop restarts listening on its own */",
        "  };"
      ].join("\n")
    },
    {
      site: 2,
      where: "buildRecognition r.onresult interim/final split — live file L12341-L12348",
      original: [
        "  r.onresult=function(ev){",
        "    var interim='', finalTxt='';",
        "    for(var i=ev.resultIndex;i<ev.results.length;i++){",
        "      if(ev.results[i].isFinal) finalTxt+=ev.results[i][0].transcript;",
        "      else interim+=ev.results[i][0].transcript;",
        "    }",
        "    /* Live transcription fills the box as you speak — but never overwrites text the user is typing right now */",
        "    if(interim && (Date.now()-(state.lastTypeAt||0)>2500)){ $('input').value=interim; autoGrow(); syncSendBtn(); }"
      ].join("\n"),
      replacement: [
        "  r.onresult=function(ev){",
        "    var interim='', finalTxt='';",
        "    for(var i=ev.resultIndex;i<ev.results.length;i++){",
        "      if(ev.results[i].isFinal) finalTxt+=ev.results[i][0].transcript;",
        "      else interim+=ev.results[i][0].transcript;",
        "    }",
        "    /* Live transcription fills the box as you speak — but never overwrites text the user is typing right now */",
        "    if(interim && (Date.now()-(state.lastTypeAt||0)>2500)){ $('input').value=interim; autoGrow(); syncSendBtn(); }",
        "    if(interim){",
        "      // P46: remember the partial text and arm the honest-message timer.",
        "      // If no final result ever arrives, the timer surfaces what was",
        "      // partially heard instead of leaving silence.",
        "      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.recordInterim(interim, hearFix46Opts()); }catch(err){}",
        "    }",
        "    if(finalTxt.trim()){",
        "      // P46: a final result arrived, so the partial timer is not needed.",
        "      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.clearInterim(); }catch(err){}",
        "    }"
      ].join("\n")
    },
    {
      site: 3,
      where: "fix42 export tail + IIFE close — live file L54327-L54330",
      original: [
        "  if(typeof root !== 'undefined') root.EnzoVoiceFix42 = EnzoVoiceFix42;",
        "  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoVoiceFix42;",
        "",
        "})(typeof window !== 'undefined' ? window : this);"
      ].join("\n"),
      replacement: "SAME FOUR ANCHOR LINES, THEN THE WHOLE EnzoHearFix46 MODULE IIFE FROM THIS FILE (MODULE-START..MODULE-END, VERBATIM)."
    }
  ];

  var EnzoHearFix46 = {
    VERSION: VERSION,
    PARTIAL_TIMEOUT_MS: PARTIAL_TIMEOUT_MS,
    PARTIAL_MAX_CHARS: PARTIAL_MAX_CHARS,
    SAY_AGAIN_EN: SAY_AGAIN_EN,
    SAY_AGAIN_ROMAN: SAY_AGAIN_ROMAN,
    sayAgainLangFor: sayAgainLangFor,
    recordInterim: recordInterim,
    clearInterim: clearInterim,
    surfacePartial: surfacePartial,
    onRecognitionError: onRecognitionError,
    reset: reset,
    ASSEMBLY_SITES: ASSEMBLY_SITES
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoHearFix46 = EnzoHearFix46;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoHearFix46;

})(typeof window !== 'undefined' ? window : this);
/* === MODULE-END: EnzoHearFix46 (piece 46) === */
