/* ---------- ANSWER VOICE PLAYER — chunked playback with Play / Pause / Resume / Stop + volume ----------
   Lives in each answer's own action row (never a strip over the chat). The speaking state still
   shows on the composer mic button, exactly like auto-spoken answers. */
var player={el:null, chunks:[], i:0, lang:'en', playing:false, paused:false, token:0, utter:null};
function splitSpeechChunks(text){
  var clean=(text||'').replace(/[#*_`>\[\]]/g,' ').replace(/\s+/g,' ').trim();
  if(!clean) return [];
  var parts=clean.match(/[^.!?।\n]+[.!?।]*\s*/g)||[clean];
  var chunks=[]; var cur='';
  parts.forEach(function(p){ if(cur && (cur+' '+p).length>220){ chunks.push(cur.trim()); cur=p; } else { cur=cur?cur+' '+p:p; } });
  if(cur.trim()) chunks.push(cur.trim());
  return chunks.slice(0,40);
}
function syncVoiceBar(wrapEl){
  if(!wrapEl) return;
  var play=wrapEl.querySelector('[data-act="vbPlay"]'); var stop=wrapEl.querySelector('[data-act="vbStop"]');
  if(!play || !stop) return;
  var lbl=play.querySelector('span');
  if(window.EnzoLang47){ try{ window.EnzoLang47.patchSyncVoiceBar(wrapEl, (player.el===wrapEl && player.playing)?'playing':((player.el===wrapEl && player.paused)?'paused':'idle'), player.lang); }catch(e){} }
  else if(lbl){ if(player.el===wrapEl && player.playing) lbl.textContent='Pause'; else if(player.el===wrapEl && player.paused) lbl.textContent='Resume'; else lbl.textContent='Listen Aloud'; }
  if(player.el===wrapEl && player.playing){ play.classList.add('on'); stop.style.display=''; }
  else if(player.el===wrapEl && player.paused){ play.classList.add('on'); stop.style.display=''; }
  else { play.classList.remove('on'); stop.style.display='none'; }
}
function playerCleanup(){
  if(player._ka){ clearInterval(player._ka); player._ka=null; }
  player.playing=false; player.paused=false;
  var el=player.el; player.el=null;
  state.speechOwner='none';
  if(el) syncVoiceBar(el);
  state.isSpeaking=false;
  afterSpeaking();
}
function playerSpeakChunk(){
  var tk=player.token;
  if(player.i>=player.chunks.length){ playerCleanup(); return; }
  if(!('speechSynthesis' in window)){ playerCleanup(); return; }
  var u=new SpeechSynthesisUtterance(player.chunks[player.i]);
  player.utter=u;
  if(window.EnzoLang46){ try{ var vs46=[]; try{ vs46=(('speechSynthesis' in window)?window.speechSynthesis.getVoices():[]); }catch(e){ vs46=[]; } var uri46=''; try{ uri46=localStorage.getItem('enao_voice_uri')||''; }catch(e){} if(vs46 && vs46.length){ window.EnzoLang46.applyPlayerChunkPatch(u, player.lang, vs46, uri46, {toast:toast}); } else { window.EnzoLang46.applyTtsLang(u, player.lang); } }catch(e){ u.lang = player.lang==='urdu' ? 'ur-PK' : (player.lang==='roman' ? 'ur-PK' : 'en-US'); } } else { u.lang = player.lang==='urdu' ? 'ur-PK' : (player.lang==='roman' ? 'ur-PK' : 'en-US'); }
  var vr=$('voiceRate'); u.rate=parseFloat((vr&&vr.value)||'0.95');
  u.volume=state.voiceVolume;
  u.onend=function(){ if(player.token!==tk) return; player._retry=0; player.i++; playerSpeakChunk(); };
  u.onerror=function(ev){ if(player.token!==tk) return; if(ev && (ev.error==='interrupted' || ev.error==='canceled')) return;
    /* A chunk that fails to start is retried once before being skipped, so a
       transient synthesis hiccup can never silently kill the whole playback */
    if(!player._retry){ player._retry=1; setTimeout(function(){ if(player.token===tk) playerSpeakChunk(); }, 220); return; }
    player._retry=0; player.i++; playerSpeakChunk(); };
  try{ window.speechSynthesis.speak(u); if(window.speechSynthesis.resume) window.speechSynthesis.resume(); }catch(e){ playerCleanup(); }
}
function playerStopInternal(){
  if(player._ka){ clearInterval(player._ka); player._ka=null; }
  player.token++;
  try{ if('speechSynthesis' in window) window.speechSynthesis.cancel(); }catch(e){}
  var el=player.el; player.el=null; player.playing=false; player.paused=false;
  if(el) syncVoiceBar(el);
}
function playerStop(user){
  var wasActive=player.playing||player.paused;
  playerStopInternal();
  if(wasActive || state.isSpeaking){ state.speechOwner='none'; state.isSpeaking=false; afterSpeaking(); }
  if(user) toast('Voice stopped');
}
function playerStart(wrapEl, m){
  if(!('speechSynthesis' in window)){ toast('Voice playback is not supported in this browser — the written answer above is complete'); return; }
  state.speechOwner='player';
  playerStopInternal();
  stopSpeaking();
  player.el=wrapEl; player.chunks=splitSpeechChunks(m.plain||stripHtml(m.html)); player.i=0; player.lang=m.lang||'en';
  if(!player.chunks.length){ player.el=null; state.speechOwner='none'; toast('This answer has no readable text to play aloud'); return; }
  player.token++; player.playing=true; player.paused=false; player._retry=0;
  state.isSpeaking=true; pauseRecognitionForSpeech(); setVoiceState('speaking');
  syncVoiceBar(wrapEl);
  /* Chrome can leave speech synthesis stuck paused on long answers — a gentle
     resume() heartbeat keeps the voice flowing until the answer ends */
  if(player._ka) clearInterval(player._ka);
  player._ka=setInterval(function(){ try{ if(player.playing && !player.paused && window.speechSynthesis && window.speechSynthesis.resume) window.speechSynthesis.resume(); }catch(e){} }, 4000);
  /* The cancels inside playerStopInternal/stopSpeaking land in this same
     tick — speaking immediately can be silently dropped, so start a beat later */
  var startTk=player.token;
  setTimeout(function(){ if(player.token===startTk && player.playing) playerSpeakChunk(); }, 90);
}
function playerToggle(wrapEl, m){
  if(player.el===wrapEl && player.playing){ try{ window.speechSynthesis.pause(); }catch(e){} player.playing=false; player.paused=true; syncVoiceBar(wrapEl); return; }
  if(player.el===wrapEl && player.paused){ try{ window.speechSynthesis.resume(); }catch(e){} player.paused=false; player.playing=true; syncVoiceBar(wrapEl); return; }
  playerStart(wrapEl, m);
}

/* Listening — continuous live recognition while Live mode is ON */
function buildRecognition(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR) return null;
  var r=new SR();
  r.continuous=true; r.interimResults=true; if(window.EnzoLang46){ try{ window.EnzoLang46.patchBuildRecognitionFromState(r, state, window.EnzoLang44?window.EnzoLang44.resolveAnswerLang:null); }catch(e){ r.lang='ur-PK'; } } else { r.lang='ur-PK'; }
  r.onstart=function(){ state.isListening=true; if(state.voiceLive && !state.isSpeaking) setVoiceState('listening'); };
  r.onend=function(){
    state.isListening=false;
    if(state.voiceLive && state.recogWanted && !state.isSpeaking){
      clearTimeout(recogRestartTimer);
      recogRestartTimer=setTimeout(function(){ if(state.voiceLive && state.recogWanted && !state.isSpeaking){ try{ recognition.start(); }catch(e){} } }, 300);
    }
  };
  function hearFix46Opts(){
    var lang = window.EnzoHearFix46 ? window.EnzoHearFix46.sayAgainLangFor(state) : undefined;
    return {
      lang: lang,
      toast: (typeof toast === 'function' ? toast : null),
      speakText: (typeof speakText === 'function' ? speakText : null),
      live: function(){ return !!state.voiceLive; },
      currentInput: function(){ try{ return $('input').value; }catch(e){ return null; } }
    };
  }
  r.onerror=function(e){
    try{ if(window.EnzoHearDebug47) window.EnzoHearDebug47.recordError(e && e.error ? e.error : 'unknown'); }catch(e){}
    if(e.error==='not-allowed' || e.error==='service-not-allowed'){
      showMicBlocked();
    }
    else if(e.error==='audio-capture'){
      turnMicOff();
      toast('No microphone was found on this device — typing works normally');
    }
    else if(e.error==='no-speech' || e.error==='network'){
      // P46: no longer silent. Interim text heard -> honest partial
      // message; nothing heard at all -> the normal say-again prompt.
      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.onRecognitionError(e.error, hearFix46Opts()); }catch(err){}
    }
    /* 'aborted' is transient — the live loop restarts listening on its own */
  };
  r.onresult=function(ev){
    var interim='', finalTxt='';
    for(var i=ev.resultIndex;i<ev.results.length;i++){
      if(ev.results[i].isFinal) finalTxt+=ev.results[i][0].transcript;
      else interim+=ev.results[i][0].transcript;
    }
    /* Live transcription fills the box as you speak — but never overwrites text the user is typing right now */
    if(interim && (Date.now()-(state.lastTypeAt||0)>2500)){ $('input').value=interim; autoGrow(); syncSendBtn(); }
    try{ if(window.EnzoHearDebug47) window.EnzoHearDebug47.recordInterim(interim, r ? r.lang : null); }catch(e){}
    if(interim){
      // P46: remember the partial text and arm the honest-message timer.
      // If no final result ever arrives, the timer surfaces what was
      // partially heard instead of leaving silence.
      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.recordInterim(interim, hearFix46Opts()); }catch(err){}
    }
    if(finalTxt.trim()){
      // P46: a final result arrived, so the partial timer is not needed.
      try{ if(window.EnzoHearFix46) window.EnzoHearFix46.clearInterim(); }catch(err){}
    }
    if(finalTxt.trim()){
      var heard=finalTxt.trim();
      /* v55 P7 voice-id gate: final text is gated BEFORE anything is
         queued or sent. proceed:false means a refusal was already
         spoken by the gate (or the sound was low-energy noise). The
         interim transcription above is display-only and NOT gated. */
      var gateRes55 = window.EnzoVoiceFix42 ? window.EnzoVoiceFix42.gateMicQuestion(heard, {source:'call', lang:(window.EnzoLang45 ? window.EnzoLang45.askLang(heard, state.langPref, detectLang) : detectLang(heard))}) : (window.EnzoVoiceID ? window.EnzoVoiceID.gateAndRoute(heard, {source:'call'}) : {proceed:true});
      try{ if(window.EnzoHearDebug47) window.EnzoHearDebug47.recordFinal(heard, r ? r.lang : null, gateRes55); }catch(e){}
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
      }
      if(state.isGenerating || state.isSpeaking){
        /* P48: ENZO is still busy — the words are NOT left waiting in the box.
           They go into the chat NOW as a sent message (double tick), and the
           answer pipeline runs for them the moment ENZO is free (flushVoiceQueue
           -> sendQueuedMicDirect -> askQuestion alreadyPosted). The pipeline is
           NOT started here: askQuestion would begin a second concurrent run
           (setGenerating/beginSearchRun, L11764-11765). */
        state.voiceQueue=((state.voiceQueue||'')+' '+heard).trim().slice(0,4000);
        state.voiceQueuePosted=true;
        postMicSentMessage(heard);
        return;
      }
      setVoiceState('processing','Heard you: “'+heard.slice(0,60)+'” — preparing your answer…');
      sendMicDirect(heard); /* P48: straight into chat as a sent message with voice=true — no composer fill, no 300 ms wait, no sendCurrent round-trip. askQuestion pushes the user message (status:'sent', double tick via buildMessageEl) and viaVoice:true makes maybeSpeak speak the answer at once (voice-in -> voice-out). */
    }
  };
  return r;
}
function startRecognition(){
  if(!recognition) recognition=buildRecognition();
  if(!recognition) return false;
  state.recogWanted=true;
  try{ recognition.start(); }catch(e){ if(state.voiceLive) setVoiceState('listening'); }
  return true;
}
function pauseRecognitionForSpeech(){
  if(recognition && state.isListening){ try{ recognition.stop(); }catch(e){} }
}
function resumeRecognitionAfterSpeech(){
  if(state.voiceLive && state.recogWanted){ setTimeout(function(){ if(state.voiceLive && !state.isSpeaking){ try{ recognition.start(); }catch(e){ setVoiceState('listening'); } } }, 350); }
}
/* Permission blocked is its OWN state — never shown as a plain "OFF", and never repeated in a toast.
   The dock is the one place that explains the state and the way out of it. */
function showMicBlocked(){
  try{ if(window.EnzoVoiceFix42) window.EnzoVoiceFix42.discardVoiceQueue(state); }catch(e){}
  state.voiceLive=false; state.recogWanted=false; state.isListening=false;
  clearTimeout(recogRestartTimer);
  if(recognition){ try{ recognition.stop(); }catch(e){} }
  stopSpeaking(); stopLevelMeter();
  setVoiceState('blocked');
  toast('Microphone is blocked — allow it from the lock icon in the address bar, then tap the mic again');
}
function turnMicOn(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ setVoiceState('off'); toast('Voice needs Chrome or Edge — typing works in every browser'); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setVoiceState('off'); toast('This browser cannot open the microphone — typing works normally'); return; }
  state.voiceLive=true;
  setVoiceState('on','Asking your browser for microphone permission…');
  /* One single permission request: the same stream powers the level meter,
     and speech recognition starts only after permission is granted. */
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    startLevelMeter(stream);
    if(window.EnzoVoiceID) window.EnzoVoiceID.attachAnalyser(micAnalyser, micCtx);
    if(startRecognition()) setVoiceState('listening');
    else setVoiceState('on','Mic is live — but listening could not start in this browser.');
  }).catch(function(err){
    if(err && (err.name==='NotAllowedError' || err.name==='SecurityError')) showMicBlocked();
    else { state.voiceLive=false; setVoiceState('off'); toast('No microphone could be opened — check your device mic, or just type your question'); }
  });
}
function turnMicOff(reason){
  if(state.voiceQueue){ if(state.voiceQueuePosted){ /* P48: already posted as a sent message — never put it back in the composer; the queue stays for the next flush. */ } else { $('input').value=state.voiceQueue; state.voiceQueue=''; } autoGrow(); syncSendBtn(); }
  state.voiceLive=false; state.recogWanted=false; state.isListening=false;
  clearTimeout(recogRestartTimer);
  if(recognition){ try{ recognition.stop(); }catch(e){} }
  stopSpeaking(); stopLevelMeter();
  if(window.EnzoVoiceID) window.EnzoVoiceID.detachAnalyser();
  setVoiceState('off', reason || 'Tap the mic button below to turn it ON — then just speak, hands-free.');
}
function toggleMic(){
  if(player.playing || player.paused){
    playerStop(false);
    if(state.voiceLive){ setVoiceState('on'); resumeRecognitionAfterSpeech(); }
    else setVoiceState('off');
    return;
  }
  if(state.isSpeaking || state.voiceState==='speaking'){
    stopSpeaking();
    if(state.voiceLive){ setVoiceState('on'); resumeRecognitionAfterSpeech(); }
    else setVoiceState('off');
    return;
  }
  if(state.voiceLive){ turnMicOff(); }
  else turnMicOn();
}
/* Watch the browser's mic permission WITHOUT interrupting the chat: a blocked mic is never
   announced on page load (that card used to cover the chat). The blocked state with the fix
   appears only when the user actually taps the mic and the browser refuses. If the user allows
   the mic in settings while the page is open, a showing blocked bar clears right away. */
function watchMicPermission(){
  if(!navigator.permissions || !navigator.permissions.query) return;
  try{
    navigator.permissions.query({name:'microphone'}).then(function(p){
      function apply(){
        if(p.state==='granted' && state.voiceState==='blocked'){ setVoiceState('off'); toast('Microphone is allowed now — tap the mic button to go live'); }
      }
      apply();
      if('onchange' in p) p.onchange=apply;
    }).catch(function(){});
  }catch(e){}
}

