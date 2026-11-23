
/* ============================================================================
   ENAO AI — Piece 41: robust speakText (41-speaktext-robust.js)
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines).
   DO NOT DEPLOY from this file alone. Do NOT edit the artifact.
   The coordinator assembles and deploys it later.

   DEFECT (Raja, 22 Nov 2026 ~6:42 PM PKT): mic question -> ENZO never
   answers in voice.
   ROOT CAUSE (proven by audit harness on the real extracted code —
   ~/workspace/enao-voice-fix/AUDIT.md section 4 finding F2 and
   ~/workspace/enao-voice-fix/AUDIT-V54-MECHANICS.md sections 3.2-3.3):
   live speakText (L7576-L7612) calls speechSynthesis.cancel() and then
   speak() only 60 ms later, guarded by `if (currentUtterance === u)`.
   If the previous utterance's onerror fires after the cancel, it sets
   currentUtterance = null, the guard fails, and the new utterance is
   NEVER spoken — no event, no retry, no error shown. Meanwhile the
   unconditional setTimeout(beginSpeak, 120) still fires, wedging
   state.isSpeaking = true forever (the safety timeout is also gated on
   currentUtterance === u, so it never rescues). Stuck isSpeaking blocks
   flushVoiceQueue (L7477-L7478), queues all later voice input (L7759),
   and stops recognition restarts — the mic is dead for voice-only use
   until a mic toggle or a typed question.

   WHAT THIS PIECE DOES
   A DROP-IN REPLACEMENT for speakText with the same name and signature
   speakText(text, lang). It replaces ONLY the live function at
   L7576-L7612. Same globals, same preserved behaviour (see below).
   Fixes, and ONLY these:
   1. NO LOST UTTERANCE. cancel() is skipped when nothing is speaking /
      pending / paused. When something IS live, cancel() is followed by
      a settle poll (every 50 ms, max ~300 ms) that waits until
      speaking / pending / paused are all clear before speak(). And at
      speak time, if currentUtterance was cleared by an intervening
      error before the first speak() of this utterance, it is restored
      and the speak is re-issued (see the documented limit in the
      issueSpeak comment: after speak() has been issued, a cleared
      currentUtterance means an external stop, and is NOT re-spoken).
      Old utterances' handlers are stale-guarded by attempt + uid, so
      a late onerror from a cancelled utterance can never clear the
      new utterance's slot. The utterance is spoken, or an honest
      failure is surfaced — never silently dropped.
   2. NO STUCK isSpeaking. beginSpeak only ever runs from a real
      onstart / onboundary, or from the +120 ms early-state timer
      which now requires currentUtterance === u AND (speaking === true
      OR a speak() call was just issued); it never fires blindly.
      Every exit path (onend, onerror, safety timeout, cancel path,
      watchdog failure) clears state through afterSpeaking(), exactly
      once per attempt. The safety timeout ALSO rescues the paused
      state: paused past the whole expected duration -> cancel +
      clear + one honest notice.
   3. RESUME HEARTBEAT. While an utterance is live, a ~2 s poll calls
      resume() when speechSynthesis.paused is true. First paused tick
      resumes once; if still paused on the next tick, the utterance is
      cancelled, state is cleared, and one honest notice is shown.
      The heartbeat stops on onend / onerror / timeout / failure.
   4. ONSTART WATCHDOG + ONE RETRY. If onstart / onboundary has not
      fired within ~1.5 s of speak() and nothing is speaking, the
      speak is retried ONCE with a fresh utterance (same text). If the
      retry also fails to start, state is cleared and ONE honest toast
      is shown in the user's language (toast / toast2 when present,
      else the window.__enzoVoiceFail hook the assembler can wire).
      Never silent.
   5. PRESERVED BEHAVIOUR. 900-char truncation, rate / pitch / volume
      (including the emotion block), speechOwner = 'auto',
      pauseRecognitionForSpeech(), setVoiceState('speaking'),
      afterSpeaking() on completion. Typed questions still never
      auto-speak — that decision stays in the v54 funnel (maybeSpeak /
      speakIfVoice); this piece only makes speakText itself reliable.

   WHAT THIS PIECE DOES NOT CHANGE (separate owners)
   - The u.lang mapping line (live L7584) is copied VERBATIM. A
     separate language piece owns language mapping.
   - The v54 funnel, maybeSpeak, answersMode, afterSpeaking,
     stopSpeaking, flushVoiceQueue, the answer player, and the
     voice-id gate are untouched.
   - No new dependencies, no network, no DOM writes of its own.

   ASSEMBLY
   Replace the whole live function speakText at L7576-L7612 with the
   speakText function exported here (same name, same 2-arg call
   sites). This file does NOT install itself over window.speakText on
   load — it only exposes window.EnzoVoiceFix41.speakText (plus
   module.exports for the Node harness). The optional 3rd argument
   (deps) is harness-only: live callers keep calling speakText(text,
   lang) with two arguments. deps may supply { synth, Utterance,
   setTimeout, clearTimeout, setInterval, clearInterval, toast,
   afterSpeaking, pauseRecognitionForSpeech, setVoiceState, $ }.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies). Zero emojis.

   LIVE ANCHORS (verified by read against the live v61 file)
   - speakText(text, lang) ....................... L7576-L7612 (REPLACED)
   - afterSpeaking() ............................. L7614-L7621 (unchanged)
   - stopSpeaking() .............................. L7622-L7626 (unchanged)
   - maybeSpeak(msg) ............................. L7486-L7496 (unchanged)
   - flushVoiceQueue() ........................... L7476-L7484 (unchanged)
   - pauseRecognitionForSpeech() ................. L7781 (unchanged)
   - resumeRecognitionAfterSpeech() .............. L7784 (unchanged)
   - setVoiceState(vs) ........................... L7517 (unchanged)
   - toast(msg) .................................. L5209 (unchanged)
   - toast2(m) ................................... L17393, L17728 (unchanged)
   - answer player resume heartbeat (model) ...... L7701 (4 s interval)
   - u.lang mapping (DO NOT CHANGE) .............. L7584
   - 900-char truncation ......................... L7580
   - rate from $('voiceRate') .................... L7585 (element L4850)
   - volume from state.voiceVolume ............... L7594
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'v41-speaktext-robust';

  var SETTLE_POLL_MS = 50;    /* cancel-settle poll step */
  var SETTLE_MAX_MS = 300;    /* never wait longer than this for a cancel */
  var WATCHDOG_MS = 1500;     /* onstart must fire within this of speak() */
  var HEARTBEAT_MS = 2000;    /* resume heartbeat while an utterance is live */
  var SAFETY_MIN_MS = 8000;   /* safety timeout floor (live formula) */
  var EARLY_STATE_MS = 120;   /* early speaking-state timer (live value) */

  var uidCounter = 0;
  var active = null;          /* the one live attempt record, or null */

  /* ------------------------------------------------------------------
     Small resolvers. Everything the piece touches on the live page is
     reached through `root` (window) so the Node harness can drive the
     real code with a fake window. deps (3rd arg, harness-only) may
     override the synthesiser, the utterance constructor, the timers
     and the notification helpers.
     ------------------------------------------------------------------ */
  function getState(){
    return (root && root.state) || {};
  }

  function getSynth(d){
    if(d && d.synth) return d.synth;
    if(root && root.speechSynthesis) return root.speechSynthesis;
    if(typeof window !== 'undefined' && window.speechSynthesis) return window.speechSynthesis;
    if(typeof speechSynthesis !== 'undefined') return speechSynthesis;
    return null;
  }

  function getTimers(d){
    var gSetT = (typeof setTimeout !== 'undefined') ? setTimeout : null;
    var gClearT = (typeof clearTimeout !== 'undefined') ? clearTimeout : null;
    var gSetI = (typeof setInterval !== 'undefined') ? setInterval : null;
    var gClearI = (typeof clearInterval !== 'undefined') ? clearInterval : null;
    return {
      setT: (d && d.setTimeout) || (root && root.setTimeout) || gSetT,
      clearT: (d && d.clearTimeout) || (root && root.clearTimeout) || gClearT,
      setI: (d && d.setInterval) || (root && root.setInterval) || gSetI,
      clearI: (d && d.clearInterval) || (root && root.clearInterval) || gClearI
    };
  }

  function callAfterSpeaking(d){
    var fn = (d && d.afterSpeaking) || (root && root.afterSpeaking);
    if(typeof fn === 'function'){ try{ fn(); }catch(e){} return; }
    var st = getState();
    try{ st.isSpeaking = false; }catch(e){}
    var fl = (d && d.flushVoiceQueue) || (root && root.flushVoiceQueue);
    if(typeof fl === 'function'){ try{ fl(); }catch(e){} }
  }

  function failMessage(lang){
    if(lang === 'urdu' || lang === 'roman'){
      return 'Voice jawab nahi chal saka — upar likha jawab mukammal hai.';
    }
    return 'Voice answer could not be played — the written answer above is complete.';
  }

  /* One honest notice, exactly once per failed attempt. Prefers the
     live toast / toast2 helpers; when neither exists, leaves the
     message on window.__enzoVoiceFail for the assembler to wire. */
  function surfaceFailure(msg, d){
    var t = (d && d.toast) || (root && root.toast) || (root && root.toast2);
    if(typeof t === 'function'){ try{ t(msg); }catch(e){} return; }
    if(root){
      if(typeof root.__enzoVoiceFail === 'function'){
        try{ root.__enzoVoiceFail(msg); }catch(e){}
      } else {
        try{ root.__enzoVoiceFail = msg; }catch(e){}
      }
    }
  }

  /* ------------------------------------------------------------------
     Attempt timers. Every timer belongs to one attempt record and is
     cleared when the attempt finishes or is superseded, so no stale
     timer can ever touch a newer utterance's state.
     ------------------------------------------------------------------ */
  function stopHeartbeat(att){
    if(!att) return;
    if(att.heartbeat != null && att.timers){
      try{ att.timers.clearI(att.heartbeat); }catch(e){}
    }
    att.heartbeat = null;
  }

  function clearAttemptTimers(att){
    if(!att || !att.timers) return;
    var t = att.timers;
    if(att.settleTimer != null){ try{ t.clearT(att.settleTimer); }catch(e){} att.settleTimer = null; }
    if(att.earlyTimer != null){ try{ t.clearT(att.earlyTimer); }catch(e){} att.earlyTimer = null; }
    if(att.watchdogTimer != null){ try{ t.clearT(att.watchdogTimer); }catch(e){} att.watchdogTimer = null; }
    if(att.safetyTimer != null){ try{ t.clearT(att.safetyTimer); }catch(e){} att.safetyTimer = null; }
    if(att.retryTimer != null){ try{ t.clearT(att.retryTimer); }catch(e){} att.retryTimer = null; }
    stopHeartbeat(att);
  }

  /* Central finish: clears every timer, drops our currentUtterance
     slot, and clears isSpeaking through afterSpeaking() — exactly
     once, and only when this attempt is still the live one. A
     superseded attempt never touches state again. */
  function finishAttempt(att){
    if(!att || att.finished) return;
    att.finished = true;
    clearAttemptTimers(att);
    if(att !== active) return;
    active = null;
    if(att.u){
      try{ if(root.currentUtterance === att.u) root.currentUtterance = null; }catch(e){}
    }
    callAfterSpeaking(att.deps || {});
  }

  function failSpeak(att){
    if(!att || att.finished) return;
    surfaceFailure(failMessage(att.lang), att.deps || {});
    finishAttempt(att);
  }

  /* beginSpeak shows the speaking state. It is NOT the "speech
     started" signal: att.started is set only by a real onstart /
     onboundary. att.stateShown guards this function itself so the
     pause / voice-state side effects run exactly once per utterance.
     A throwing helper can never kill the speech. */
  function beginSpeak(att){
    if(!att || att.finished || att !== active || att.stateShown) return;
    att.stateShown = true;
    var st = getState();
    try{ st.isSpeaking = true; }catch(e){}
    var d = att.deps || {};
    var pr = (d && d.pauseRecognitionForSpeech) || (root && root.pauseRecognitionForSpeech);
    if(typeof pr === 'function'){ try{ pr(); }catch(e){} }
    var sv = (d && d.setVoiceState) || (root && root.setVoiceState);
    if(typeof sv === 'function'){ try{ sv('speaking'); }catch(e){} }
  }

  /* ------------------------------------------------------------------
     makeUtterance(att) — builds one utterance from the attempt's
     cleaned text. The u.lang line below is copied VERBATIM from live
     L7584: DO NOT CHANGE it here; a separate language piece owns
     language mapping. Rate / pitch / volume / emotion are preserved
     from the live function (L7585-L7594).
     ------------------------------------------------------------------ */
  function makeUtterance(att){
    var d = att.deps || {};
    var Ctor = (d && d.Utterance) || (root && root.SpeechSynthesisUtterance) || null;
    if(typeof Ctor !== 'function'){
      if(typeof SpeechSynthesisUtterance !== 'undefined') Ctor = SpeechSynthesisUtterance;
      else return null;
    }
    var u;
    try{ u = new Ctor(att.clean); }catch(e){ return null; }
    u.lang = att.lang === 'urdu' ? 'ur-PK' : (att.lang === 'roman' ? 'ur-PK' : 'en-US');
    var rate = 0.95;
    var dollar = (d && d.$) || (root && root.$) || null;
    if(typeof dollar !== 'function' && typeof $ !== 'undefined') dollar = $;
    try{
      var vr = dollar ? dollar('voiceRate') : null;
      rate = parseFloat((vr && vr.value) || '0.95');
      if(isNaN(rate)) rate = 0.95;
    }catch(e){ rate = 0.95; }
    u.rate = rate;
    var emoT = root && root.__enzoEmotion;
    if(emoT === 'happy' || emoT === 'excited'){ u.pitch = 1.25; u.rate = Math.min(1.4, u.rate * 1.06); }
    else if(emoT === 'angry'){ u.pitch = 0.8; u.rate = Math.min(1.4, u.rate * 1.05); }
    else if(emoT === 'loving'){ u.pitch = 1.05; u.rate = u.rate * 0.92; }
    else if(emoT === 'humble'){ u.pitch = 0.95; u.rate = u.rate * 0.95; }
    var st = getState();
    u.volume = (typeof st.voiceVolume === 'number') ? st.voiceVolume : 1;
    return u;
  }

  /* Handlers for one utterance. Every handler first checks it is
     still the live utterance of the live attempt (attempt + uid +
     slot); a late event from a superseded or retried utterance is
     ignored entirely — that check is what kills the audited race,
     where the old code's onerror unconditionally cleared
     currentUtterance and afterSpeaking() for the NEW utterance. */
  function wireUtterance(att, u){
    var uid = att.uid;
    function isLive(){
      return !att.finished && att === active && att.uid === uid && att.u === u;
    }
    u.onstart = function(){
      if(!isLive()) return;
      att.started = true;
      att.pausedStuckTicks = 0;
      beginSpeak(att);
    };
    u.onboundary = function(){
      if(!isLive()) return;
      att.started = true;
      att.pausedStuckTicks = 0;
      att.resumedOnce = false;
      beginSpeak(att);
    };
    u.onend = function(){
      if(!isLive()) return;
      finishAttempt(att);
    };
    u.onerror = function(ev){
      if(!isLive()) return;
      var err = ev && ev.error;
      /* 'canceled' / 'interrupted' on the LIVE utterance means an
         external stop (mic off, player start, stopSpeaking) — finish
         silently, no retry, no toast: the user stopped the voice. */
      if(err === 'canceled' || err === 'interrupted'){ finishAttempt(att); return; }
      if(!att.started && !att.retried){ scheduleRetry(att, 120); return; }
      finishAttempt(att);
    };
  }

  /* ------------------------------------------------------------------
     Watchdog, safety timeout, early-state timer, heartbeat.
     ------------------------------------------------------------------ */
  function armEarlyState(att){
    var t = att.timers;
    if(att.earlyTimer != null){ try{ t.clearT(att.earlyTimer); }catch(e){} }
    att.earlyTimer = t.setT(function(){
      att.earlyTimer = null;
      if(att.finished || att !== active || !att.u) return;
      try{ if(root.currentUtterance !== att.u) return; }catch(e){ return; }
      var speakingNow = false;
      try{ speakingNow = att.synth.speaking === true; }catch(e){}
      var justIssued = att.speakIssued && (Date.now() - att.speakIssuedAt < 1000);
      if(speakingNow || justIssued) beginSpeak(att);
    }, EARLY_STATE_MS);
  }

  function armWatchdog(att){
    var t = att.timers;
    if(att.watchdogTimer != null){ try{ t.clearT(att.watchdogTimer); }catch(e){} }
    att.watchdogTimer = t.setT(function(){
      att.watchdogTimer = null;
      if(att.finished || att !== active) return;
      if(att.started) return;
      var speakingNow = false;
      try{ speakingNow = att.synth.speaking === true; }catch(e){}
      /* Speaking but onstart never arrived (event lost): the voice
         IS running — show the state and let the heartbeat + safety
         timeout own it from here. Never retry a live utterance. */
      if(speakingNow){ att.started = true; beginSpeak(att); return; }
      /* Nothing speaking and our slot was cleared after speak() was
         issued: an external stop (stopSpeaking / mic off). Finish
         silently — never re-speak over a user's stop. */
      if(att.speakIssued){
        try{ if(root.currentUtterance !== att.u){ finishAttempt(att); return; } }catch(e){}
      }
      if(!att.retried){ retryOnce(att); return; }
      failSpeak(att);
    }, WATCHDOG_MS);
  }

  function armSafety(att){
    var t = att.timers;
    if(att.safetyTimer != null){ try{ t.clearT(att.safetyTimer); }catch(e){} }
    var dur = Math.max(SAFETY_MIN_MS, att.clean.length * 95);
    att.safetyTimer = t.setT(function(){
      att.safetyTimer = null;
      if(att.finished || att !== active) return;
      var speakingNow = false, pausedNow = false;
      try{ speakingNow = att.synth.speaking === true; pausedNow = att.synth.paused === true; }catch(e){}
      if(!speakingNow){ finishAttempt(att); return; }
      /* Paused past the whole expected duration: the safety timeout
         in the live code was blind to this (speaking stays true
         while paused). Cancel, clear, and say so once. */
      if(pausedNow){ try{ att.synth.cancel(); }catch(e){} failSpeak(att); return; }
      /* Speaking, not paused, but overdue with no onend coming:
         cancel and clear the state. The user already heard most of
         it, so no failure notice. */
      try{ att.synth.cancel(); }catch(e){}
      finishAttempt(att);
    }, dur);
  }

  function startHeartbeat(att){
    if(att.heartbeat != null) return;
    var t = att.timers;
    att.heartbeat = t.setI(function(){
      if(att.finished || att !== active){ stopHeartbeat(att); return; }
      var pausedNow = false;
      try{ pausedNow = att.synth.paused === true; }catch(e){}
      if(!pausedNow){ att.pausedStuckTicks = 0; return; }
      att.pausedStuckTicks++;
      if(att.pausedStuckTicks === 1){
        try{ if(att.synth.resume) att.synth.resume(); }catch(e){}
        att.resumedOnce = true;
        return;
      }
      /* Still paused after a resume: stuck. Cancel, clear the
         state, and say so once. */
      try{ att.synth.cancel(); }catch(e){}
      failSpeak(att);
    }, HEARTBEAT_MS);
  }

  function scheduleRetry(att, delayMs){
    if(att.finished || att !== active || att.retried) return;
    var t = att.timers;
    att.retryTimer = t.setT(function(){
      att.retryTimer = null;
      retryOnce(att);
    }, delayMs || 120);
  }

  /* One retry, with a FRESH utterance (same cleaned text, same lang).
     The old utterance's handlers are stale-guarded by the new uid,
     so a late event from it can never touch the retry. The heartbeat
     keeps running across the retry; watchdog + safety are re-armed. */
  function retryOnce(att){
    if(att.finished || att !== active || att.retried) return;
    att.retried = true;
    att.started = false;
    att.stateShown = false;
    att.speakIssued = false;
    att.speakIssuedAt = 0;
    att.pausedStuckTicks = 0;
    att.resumedOnce = false;
    var t = att.timers;
    if(att.watchdogTimer != null){ try{ t.clearT(att.watchdogTimer); }catch(e){} att.watchdogTimer = null; }
    if(att.safetyTimer != null){ try{ t.clearT(att.safetyTimer); }catch(e){} att.safetyTimer = null; }
    if(att.earlyTimer != null){ try{ t.clearT(att.earlyTimer); }catch(e){} att.earlyTimer = null; }
    if(att.retryTimer != null){ try{ t.clearT(att.retryTimer); }catch(e){} att.retryTimer = null; }
    var u = makeUtterance(att);
    if(!u){ failSpeak(att); return; }
    att.u = u;
    att.uid = ++uidCounter;
    wireUtterance(att, u);
    try{ root.currentUtterance = u; }catch(e){}
    issueSpeak(att);
  }

  /* Issue the speak for this utterance. Before the FIRST speak() of
     this utterance, if currentUtterance was cleared by an intervening
     error (the audited race), restore it and speak — unless someone
     else owns speech now (speechOwner !== 'auto'), in which case
     finish silently. AFTER speak() has been issued, a cleared slot
     means an external stop, and the utterance is NOT re-spoken. */
  function issueSpeak(att){
    if(att.finished || att !== active || !att.u) return;
    var synth = att.synth;
    if(!att.speakIssued){
      var cur = null;
      try{ cur = root.currentUtterance; }catch(e){}
      if(cur !== att.u){
        if(getState().speechOwner !== 'auto'){ finishAttempt(att); return; }
        try{ root.currentUtterance = att.u; }catch(e){}
      }
    } else {
      try{ if(root.currentUtterance !== att.u){ finishAttempt(att); return; } }catch(e){}
    }
    att.speakIssued = true;
    att.speakIssuedAt = Date.now();
    try{
      synth.speak(att.u);
      if(synth.resume){ try{ synth.resume(); }catch(e){} }
    }catch(e){
      if(!att.retried){ scheduleRetry(att, 120); return; }
      failSpeak(att);
      return;
    }
    armEarlyState(att);
    armWatchdog(att);
    armSafety(att);
    startHeartbeat(att);
  }

  /* ==================================================================
     speakText(text, lang, deps) — DROP-IN REPLACEMENT for live
     L7576-L7612. Same name, same 2-arg signature at every call site.
     deps is harness-only (3rd argument, ignored by live callers).
     ================================================================== */
  function speakText(text, lang, deps){
    var d = deps || {};
    var st = getState();
    var synth = getSynth(d);
    if(!synth || !text){ callAfterSpeaking(d); return; }
    var clean;
    try{ clean = String(text).replace(/[#*_`>\[\]]/g, ' ').slice(0, 900); }catch(e){ callAfterSpeaking(d); return; }
    if(!clean || !clean.replace(/\s/g, '')){ callAfterSpeaking(d); return; }
    var timers = getTimers(d);
    /* Supersede any live attempt: its timers die with it and its
       utterance handlers are stale-guarded, so its late onerror can
       never clear the new utterance. Only the latest request must
       speak; an abandoned earlier request is not a dropped one. */
    if(active){
      var prev = active;
      active = null;
      prev.finished = true;
      clearAttemptTimers(prev);
    }
    var att = {
      clean: clean, lang: lang, synth: synth, timers: timers, deps: d,
      started: false, stateShown: false, finished: false, retried: false,
      speakIssued: false, speakIssuedAt: 0,
      pausedStuckTicks: 0, resumedOnce: false,
      uid: ++uidCounter, u: null,
      settleTimer: null, earlyTimer: null, watchdogTimer: null,
      safetyTimer: null, retryTimer: null, heartbeat: null
    };
    active = att;
    var u = makeUtterance(att);
    if(!u){
      att.finished = true;
      active = null;
      surfaceFailure(failMessage(lang), d);
      callAfterSpeaking(d);
      return;
    }
    att.u = u;
    wireUtterance(att, u);
    try{ root.currentUtterance = u; }catch(e){}
    try{ st.speechOwner = 'auto'; }catch(e){}
    /* Fix 1: skip cancel() entirely when nothing is live — the
       cancel itself is what creates the race. Only cancel when the
       synthesiser reports something speaking, pending or paused. */
    var busy = false;
    try{ busy = !!(synth.speaking || synth.pending || synth.paused); }catch(e){}
    if(!busy){ issueSpeak(att); return; }
    try{ synth.cancel(); }catch(e){}
    /* Fix 1 (continued): wait for the cancel to settle before
       speak() — poll until speaking / pending / paused are all
       clear, max ~300 ms, then speak anyway (the watchdog + retry
       cover a drop after that point). */
    var waited = 0;
    function poll(){
      if(att.finished || att !== active) return;
      var clear = true;
      try{ clear = !synth.speaking && !synth.pending && !synth.paused; }catch(e){ clear = true; }
      if(clear || waited >= SETTLE_MAX_MS){ issueSpeak(att); return; }
      waited += SETTLE_POLL_MS;
      att.settleTimer = timers.setT(poll, SETTLE_POLL_MS);
    }
    att.settleTimer = timers.setT(poll, SETTLE_POLL_MS);
  }

  var EnzoVoiceFix41 = {
    VERSION: VERSION,
    speakText: speakText
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. This file does NOT install itself
     over window.speakText on load — the assembler replaces the live
     function at L7576-L7612 with EnzoVoiceFix41.speakText. */
  if(typeof root !== 'undefined' && root) root.EnzoVoiceFix41 = EnzoVoiceFix41;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoVoiceFix41;

})(typeof window !== 'undefined' ? window : this);
