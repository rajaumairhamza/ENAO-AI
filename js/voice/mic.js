/* ---------- VOICE — LIVE MIC SYSTEM ----------
   States: off → on (ready) → listening (ENZO hears you) → processing (thinking) → speaking (ENZO talks) → back to listening when Live stays ON.
   The state shows ONLY on the composer's mic button — its colour, pulsing rings, live dot, icon and tooltip.
   Nothing is ever drawn in the chat area: no strip, no bars, no stop button, no card. */
var recognition=null;
var micStream=null, micCtx=null, micAnalyser=null, micRaf=null, recogRestartTimer=null, currentUtterance=null;

function setVoiceState(vs){
  state.voiceState=vs;
  var mic=$('micBtn'); if(!mic) return;
  mic.classList.toggle('on', !!state.voiceLive);
  mic.classList.toggle('listening', vs==='listening');
  mic.classList.toggle('speaking', vs==='speaking');
  mic.classList.toggle('processing', vs==='processing');
  mic.classList.toggle('blocked', vs==='blocked');
  mic.setAttribute('aria-pressed', state.voiceLive?'true':'false');
  var iconUse=$('micIconUse');
  if(iconUse) iconUse.setAttribute('href', vs==='speaking' ? '#i-speakerw' : (vs==='blocked' ? '#i-micoff' : '#i-micw'));
  mic.title = vs==='listening' ? 'Microphone: LIVE — ENZO is listening to you right now. Tap to turn OFF'
    : vs==='speaking' ? 'ENZO is speaking — tap the mic button to stop the voice'
    : vs==='processing' ? 'ENZO is thinking — preparing your answer'
    : vs==='blocked' ? 'Microphone is BLOCKED — tap the lock icon in the address bar, set Microphone to Allow, then tap here again'
    : state.voiceLive ? 'Microphone: ON & Live — tap to turn OFF' : 'Microphone: OFF — tap to go live';
  mic.setAttribute('aria-label', mic.title);
  if(vs==='listening') setCentreEnzo('listening');
  else if(vs==='speaking') setCentreEnzo('speaking');
  else if(vs==='processing') setCentreEnzo('thinking');
  var cb=$('callBtn');
  if(cb){ cb.classList.toggle('listening', vs==='listening'); cb.classList.toggle('speaking', vs==='speaking'); }
  syncComposerSlot();
}

/* Real mic level meter — the bars react to the user's actual voice volume.
   Uses the stream turnMicOn already opened, so the browser asks permission only ONCE. */
function startLevelMeter(stream){
  if(!stream) return;
  if(!state.voiceLive){ stream.getTracks().forEach(function(t){ t.stop(); }); return; }
  micStream=stream;
  try{
      var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
      micCtx=new AC();
      if(micCtx.state==='suspended') micCtx.resume();
      var src=micCtx.createMediaStreamSource(stream);
      micAnalyser=micCtx.createAnalyser(); micAnalyser.fftSize=2048; /* v55 P7 G0: 2048 — pitch needs a full voice period; 256 made the voice-id gate fail closed on ALL voice */
      src.connect(micAnalyser);
      var data=new Uint8Array(micAnalyser.frequencyBinCount);
      var mic=$('micBtn');
      (function loop(){
        micRaf=requestAnimationFrame(loop);
        if(!micAnalyser) return;
        micAnalyser.getByteFrequencyData(data);
        var v=0; for(var k=0;k<data.length;k++) v+=data[k];
        v=v/data.length;
        /* The mic button itself breathes with the user's real voice volume — no bars anywhere */
        if(mic && state.voiceState==='listening') mic.style.transform='scale('+(1+Math.min(0.14, v/255*0.22)).toFixed(3)+')';
      })();
  }catch(e){ /* level meter is a bonus — speech recognition still works without it */ }
}
function stopLevelMeter(){
  if(micRaf) cancelAnimationFrame(micRaf); micRaf=null; micAnalyser=null;
  if(micCtx){ try{ micCtx.close(); }catch(e){} micCtx=null; }
  if(micStream){ micStream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} }); micStream=null; }
  var micEl=$('micBtn'); if(micEl) micEl.style.transform='';
}

/* Speaking — while ENZO talks, the speaking state shows only on the mic button (teal pulsing rings + speaker icon) */
function speakText(text, lang){
  text = (window.EnzoIdentityGuard
    ? window.EnzoIdentityGuard.correctIdentity(text) : text);
  if(window.EnzoVoiceFix41 && window.EnzoVoiceFix41.speakText){
    var lang46=lang;
    var realSynth46=null;
    try{ realSynth46=window.speechSynthesis; }catch(e){ realSynth46=null; }
    if(realSynth46){
      /* P3c (piece 46) at the speakText site: piece 41 builds the utterance
         inside its own closure, so the language/voice patch is applied here,
         in a per-call synth proxy (deps.synth) — the utterance is patched
         with THIS call's language right before the real speak(), so a retry
         or a queued second call can never pick up the wrong lang. BCP tags
         ('ur-PK' from the voice-id refusal path) are mapped to canonical
         codes first; with zero voices only the lang is set and no fallback
         note is fired (piece 46 evidence deviation 7). */
      var synth46={
        speak:function(u){
          try{
            if(window.EnzoLang46){
              var vs46=[]; try{ vs46=realSynth46.getVoices()||[]; }catch(e){ vs46=[]; }
              var uri46=''; try{ uri46=localStorage.getItem('enao_voice_uri')||''; }catch(e){}
              var canon46=lang46;
              if(canon46==='ur-PK'||canon46==='ur') canon46='urdu';
              else if(canon46==='pa-PK'||canon46==='pa') canon46='punjabi';
              else if(canon46==='en-US') canon46='en';
              else if(canon46==='hi-IN') canon46='hindi';
              if(vs46 && vs46.length){ window.EnzoLang46.applySpeakTextPatch(u, canon46, vs46, uri46, {toast:toast}); }
              else { window.EnzoLang46.applyTtsLang(u, canon46); }
            }
          }catch(e){}
          return realSynth46.speak(u);
        },
        cancel:function(){ return realSynth46.cancel(); },
        resume:function(){ try{ return realSynth46.resume(); }catch(e){} },
        pause:function(){ try{ return realSynth46.pause(); }catch(e){} },
        get speaking(){ try{ return realSynth46.speaking; }catch(e){ return false; } },
        get pending(){ try{ return realSynth46.pending; }catch(e){ return false; } },
        get paused(){ try{ return realSynth46.paused; }catch(e){ return false; } },
        getVoices:function(){ try{ return realSynth46.getVoices(); }catch(e){ return []; } }
      };
      return window.EnzoVoiceFix41.speakText(text, lang, {synth:synth46});
    }
    return window.EnzoVoiceFix41.speakText(text, lang);
  }
  text = (window.EnzoIdentityGuard
    ? window.EnzoIdentityGuard.correctIdentity(text) : text);
  if(!('speechSynthesis' in window) || !text) { afterSpeaking(); return; }
  try{
    window.speechSynthesis.cancel();
    var clean=text.replace(/[#*_`>\[\]]/g,' ').slice(0,900);
    var u=new SpeechSynthesisUtterance(clean);
    currentUtterance=u;
    state.speechOwner='auto';
    u.lang = lang==='urdu' ? 'ur-PK' : (lang==='roman' ? 'ur-PK' : 'en-US');
    u.rate=parseFloat($('voiceRate').value||'0.95');
    /* Emotion in the voice itself: the tone follows the feeling of the
       moment (set by the conversation emotion layer) — brighter and quicker
       when happy, lower and slower when loving or humble, firmer when angry. */
    var emoT=window.__enzoEmotion;
    if(emoT==='happy'||emoT==='excited'){ u.pitch=1.25; u.rate=Math.min(1.4, u.rate*1.06); }
    else if(emoT==='angry'){ u.pitch=0.8; u.rate=Math.min(1.4, u.rate*1.05); }
    else if(emoT==='loving'){ u.pitch=1.05; u.rate=u.rate*0.92; }
    else if(emoT==='humble'){ u.pitch=0.95; u.rate=u.rate*0.95; }
    u.volume=state.voiceVolume;
    var started=false;
    function beginSpeak(){
      if(started) return; started=true;
      state.isSpeaking=true;
      pauseRecognitionForSpeech();
      setVoiceState('speaking');
    }
    u.onstart=beginSpeak;
    u.onboundary=function(){ if(!started) beginSpeak(); };
    u.onend=function(){ currentUtterance=null; afterSpeaking(); };
    u.onerror=function(){ currentUtterance=null; afterSpeaking(); };
    /* Chrome silently drops an utterance spoken in the same tick as the
       cancel() above — defer the speak a beat so the voice actually starts */
    setTimeout(function(){ if(currentUtterance===u){ try{ window.speechSynthesis.speak(u); if(window.speechSynthesis.resume) window.speechSynthesis.resume(); }catch(e){} } }, 60);
    setTimeout(beginSpeak, 120); /* some browsers fire onstart late — show the speaking state right away */
    /* Safety: if the browser never ends the utterance, clear the state */
    setTimeout(function(){ if(currentUtterance===u && !window.speechSynthesis.speaking){ currentUtterance=null; afterSpeaking(); } }, Math.max(8000, clean.length*95));
  }catch(e){ afterSpeaking(); }
}
function afterSpeaking(){
  if(state.speechOwner==='player' && (player.playing || player.paused)) return; /* the answer player manages its own end state */
  if(!state.isSpeaking && state.voiceState!=='speaking'){ flushVoiceQueue(); return; }
  state.isSpeaking=false;
  if(state.voiceLive){ setVoiceState('on'); resumeRecognitionAfterSpeech(); }
  else setVoiceState('off');
  flushVoiceQueue();
}
function stopSpeaking(){
  try{ if('speechSynthesis' in window) window.speechSynthesis.cancel(); }catch(e){}
  currentUtterance=null; state.isSpeaking=false;
}

