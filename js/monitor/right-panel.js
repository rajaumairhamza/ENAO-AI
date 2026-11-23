
/* ================= P-D PIECE 2 — RIGHT PANEL LOGIC =================
   Live status pill, voice waveform, task progress and quick actions for the
   companion panel. Everything reads REAL app state only: the shared `state`
   object, the voice system (including the real mic analyser), the P-C task
   checklist (pcTask) and the mega-research collector. A percentage is shown
   ONLY for Mega Deep Research, where collected-vs-requested is a genuine
   measurement — never for an ordinary answer. If the 3D model failed to load,
   this panel still works in full (the 2D fallback sits in the mount). */
(function(){
  'use strict';
  function $(id){ return document.getElementById(id); }
  function appState(){ return window.state||{}; }
  function esc2(s){ if(typeof esc==='function') return esc(s); return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function ezState(){ return (typeof window.getEnzoState==='function') ? window.getEnzoState() : 'idle'; }
  var pill=$('enzoStatusPill'), pillText=$('enzoStatusText'), waveState=$('enzoWaveState'), waveWarn=$('enzoWaveWarn');
  var bootAt=Date.now();

  /* ---- Activity tracking + sleep: any real ENZO state change counts as
     activity; two full minutes of true idleness puts ENZO to sleep, and any
     tap, key press or new state wakes him again. ---- */
  var lastActivity=Date.now(), sleeping=false;
  var origSet=(typeof window.setEnzoState==='function') ? window.setEnzoState : null;
  if(origSet){
    window.setEnzoState=function(n){
      var r=origSet(n);
      if(r!=='sleeping'){ sleeping=false; lastActivity=Date.now(); }
      return r;
    };
  }
  function wake(){
    lastActivity=Date.now();
    if(sleeping){ sleeping=false; if(origSet) origSet('idle'); }
  }
  ['pointerdown','keydown','touchstart'].forEach(function(ev){ document.addEventListener(ev,wake,{passive:true}); });
  setInterval(function(){
    if(sleeping || !origSet) return;
    var st=appState();
    if(st.isGenerating||st.isSpeaking||st.isListening) return;
    if(ezState()==='idle' && Date.now()-lastActivity>120000){ sleeping=true; origSet('sleeping'); }
  },5000);

  /* ---- Mega Deep Research progress: collected vs requested is genuinely
     measurable, so the panel may show a real bar + percentage for it. ---- */
  window.__enzoMega=null;
  if(typeof window.setMegaProgress==='function'){
    var origMega=window.setMegaProgress;
    window.setMegaProgress=function(batch,collected,mega){
      window.__enzoMega={collected:collected, count:(mega&&mega.count)||0, entity:(mega&&mega.entity)||'results'};
      return origMega(batch,collected,mega);
    };
  }

  /* ---- Activity animations from real tool use: opening the Code tool is
     coding, the Image tool is image generation, document tools are writing,
     the Research tool is researching — on the same ENZO, via the same hook. ---- */
  var TOOL_STATE={code:'coding', imagegen:'imagegen', writing:'document', summarize:'document', pdf:'document', word:'document', excel:'document', research:'researching', data:'focused', image:'focused', translate:'focused'};
  if(typeof window.openTool==='function'){
    var origOpenTool=window.openTool;
    window.openTool=function(id){
      var r=origOpenTool(id);
      var st=TOOL_STATE[id];
      if(st && origSet && !appState().isGenerating) origSet(st);
      return r;
    };
  }
  if(typeof window.closeModal==='function'){
    var origClose=window.closeModal;
    window.closeModal=function(id){
      var r=origClose(id);
      if(id==='toolModal' && origSet && !appState().isGenerating) origSet('idle');
      return r;
    };
  }
  function flashState(s){
    if(!origSet || appState().isGenerating) return;
    origSet(s);
    setTimeout(function(){ if(ezState()===s && !appState().isGenerating) origSet('idle'); },2600);
  }
  if(typeof window.toolImgOk==='function'){ var ok0=window.toolImgOk; window.toolImgOk=function(){ ok0(); flashState('success'); }; }
  if(typeof window.toolImgErr==='function'){ var er0=window.toolImgErr; window.toolImgErr=function(){ er0(); flashState('error'); }; }

  /* ---- Status pill: derived from the real app state, most urgent first ---- */
  var STATUS_LABEL={initializing:'ENZO IS INITIALIZING', connecting:'ENZO IS CONNECTING', online:'ENZO IS ONLINE', offline:'ENZO IS OFFLINE', listening:'ENZO IS LISTENING', thinking:'ENZO IS THINKING', speaking:'ENZO IS SPEAKING', working:'ENZO IS WORKING', paused:'ENZO IS PAUSED', error:'ENZO NEEDS ATTENTION'};
  function currentStatus(){
    var st=appState();
    if(navigator.onLine===false) return 'offline';
    if(window.__enzoBackendDown===true) return 'error';
    if(ezState()==='error' || st.voiceState==='blocked') return 'error';
    if(st.isSpeaking || st.voiceState==='speaking') return 'speaking';
    if(st.voiceState==='listening' || st.isListening) return 'listening';
    if(st.voiceState==='processing') return 'thinking';
    if(window.player && player.paused) return 'paused';
    if(st.isGenerating && (!window.EnzoTaskState59 || window.EnzoTaskState59.isActive())) return 'working';
    if(st.voiceLive && st.voiceState==='on') return 'connecting';
    if(Date.now()-bootAt<1200) return 'initializing';
    return 'online';
  }
  function pollStatus(){
    var s=currentStatus();
    if(pill){ pill.setAttribute('data-s',s); var lbl=STATUS_LABEL[s]||'ENZO IS ONLINE'; if(pillText.textContent!==lbl) pillText.textContent=lbl; }
    var wl = s==='listening'?'Listening' : s==='speaking'?'Speaking' : s==='thinking'?'Thinking' : s==='working'?'Working' : s==='error'?'Error' : s==='paused'?'Paused' : s==='offline'?'Offline' : (sleeping?'Sleeping':'Idle');
    if(waveState && waveState.textContent!==wl) waveState.textContent=wl;
    if(waveWarn) waveWarn.hidden = !(appState().voiceState==='blocked');
  }

  /* ---- Voice waveform: REAL mic frequency data while listening (the same
     analyser the mic level meter uses). Speech output cannot be tapped by
     the browser, so speaking shows a speech-rhythm animation driven by the
     real speaking state; idle is a subtle drift; error is a flat red line. ---- */
  var wave=$('enzoWave'), wctx=wave?wave.getContext('2d'):null, micData=null, drift=Math.random()*10;
  function drawWave(){
    requestAnimationFrame(drawWave);
    if(!wctx || document.hidden) return;
    var W=wave.width, H=wave.height;
    wctx.clearRect(0,0,W,H);
    var st=appState(), ez=ezState();
    var mode='idle';
    if(st.voiceState==='blocked' || ez==='error') mode='error';
    else if(st.voiceState==='listening' && window.micAnalyser) mode='mic';
    else if(st.isSpeaking || st.voiceState==='speaking') mode='speak';
    else if(ez==='sleeping') mode='sleep';
    else if(st.isGenerating || st.voiceState==='processing') mode='work';
    var N=30, bw=W/N, t=performance.now()/1000, vals=[], i, j;
    if(mode==='mic'){
      var an=window.micAnalyser;
      if(!micData || micData.length!==an.frequencyBinCount) micData=new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(micData);
      for(i=0;i<N;i++){ var bin=2+Math.floor(Math.pow(i/N,1.4)*46); vals.push(0.12+(micData[bin]/255)*0.95); }
    } else if(mode==='speak'){
      for(j=0;j<N;j++){ var c=j/(N-1), env=Math.sin(c*Math.PI); vals.push(0.15+env*(0.4+0.3*Math.sin(t*8+j*0.9)+0.22*Math.sin(t*13.7+j*2.3))); }
    } else if(mode==='work'){
      for(j=0;j<N;j++) vals.push(0.16+0.12*Math.sin(t*2.4+j*0.55));
    } else if(mode==='error'){
      for(j=0;j<N;j++) vals.push(0.1);
    } else if(mode==='sleep'){
      for(j=0;j<N;j++) vals.push(0.05+0.02*Math.sin(t*0.9+j*0.4));
    } else {
      for(j=0;j<N;j++) vals.push(0.1+0.07*Math.sin(t*1.6+j*0.5+drift));
    }
    wctx.fillStyle = mode==='error' ? 'rgba(239,68,68,0.9)' : mode==='mic' ? 'rgba(0,217,255,0.95)' : mode==='speak' ? 'rgba(167,139,250,0.95)' : 'rgba(59,130,246,0.75)';
    for(var b=0;b<N;b++){
      var v=Math.max(0.03,Math.min(1,vals[b]));
      var h=v*(H-8), x=b*bw+bw*0.22, w=bw*0.56, y=(H-h)/2;
      wctx.beginPath();
      if(wctx.roundRect) wctx.roundRect(x,y,w,h,3); else wctx.rect(x,y,w,h);
      wctx.fill();
    }
  }
  if(wave) requestAnimationFrame(drawWave);

  /* ---- Live task progress: a snapshot of the real P-C checklist (pcTask),
     kept after the run ends so the finished task stays inspectable. ---- */
  var taskEl=$('enzoTask'), tName=$('enzoTaskName'), tKicker=$('enzoTaskKicker'), tSpin=$('enzoTaskSpin'),
      tBarWrap=$('enzoTaskBarWrap'), tBarFill=$('enzoTaskBarFill'), tInd=$('enzoTaskInd'),
      tStatus=$('enzoTaskStatus'), tPct=$('enzoTaskPct'), tCancel=$('enzoTaskCancel'),
      tDetBtn=$('enzoTaskDetailsBtn'), tDet=$('enzoTaskDetails');
  var snap=null, detailsOpen=false, lastSig='';
  function fmtT(ts){ try{ return (typeof fmtTime==='function') ? fmtTime(new Date(ts)) : new Date(ts).toLocaleTimeString(); }catch(e){ return ''; } }
  function taskStatusWord(gen){
    if(gen) return 'Working';
    if(snap.states.indexOf('failed')>-1) return 'Failed';
    if(snap.hadError) return 'Finished with an error';
    if(snap.states.indexOf('cancelled')>-1) return 'Cancelled';
    if(snap.states.length && snap.states.every(function(s){ return s==='completed'; })) return 'Completed';
    return 'Finished';
  }
  function detailsHtml(gen,curOp){
    var done=[], todo=[];
    snap.steps.forEach(function(s,i){
      if(snap.states[i]==='completed') done.push(s);
      else if(snap.states[i]==='pending' || snap.states[i]==='running') todo.push(s);
    });
    var files=(snap.files && snap.files.length) ? snap.files.map(function(f){ return f.name||'file'; }).join(', ') : 'None';
    var warns=[];
    if(snap.hadError) warns.push('The last attempt reported an error — the answer in the chat explains what happened.');
    if(appState().voiceState==='blocked') warns.push('Microphone permission is blocked — ENZO is waiting for you to allow it.');
    var h='';
    h+='<div class="etd-row"><span class="etd-k">Description</span>'+esc2(snap.question||'—')+'</div>';
    if(snap.decision) h+='<div class="etd-row"><span class="etd-k">Answer mode</span>'+esc2(snap.decision)+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Current operation</span>'+esc2(gen?curOp:'Finished')+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Completed steps</span>'+(done.length?'<ul class="etd-list">'+done.map(function(s){ return '<li>'+esc2(s)+'</li>'; }).join('')+'</ul>':'None yet')+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Remaining steps</span>'+(todo.length?'<ul class="etd-list">'+todo.map(function(s){ return '<li>'+esc2(s)+'</li>'; }).join('')+'</ul>':'None')+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Files involved</span>'+esc2(files)+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Warnings and errors</span>'+(warns.length?esc2(warns.join(' ')):'None')+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Permission requests</span>'+(appState().voiceState==='blocked'?'Microphone access — blocked by the browser':'None')+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Started</span>'+esc2(fmtT(snap.startAt))+'</div>';
    h+='<div class="etd-row"><span class="etd-k">'+(snap.endAt?'Completed at':'Status')+'</span>'+(snap.endAt?esc2(fmtT(snap.endAt)):esc2(taskStatusWord(gen)))+'</div>';
    h+='<div class="etd-row"><span class="etd-k">Pause</span>Live search cannot pause mid-flight safely — Cancel stops it cleanly instead.</div>';
    return h;
  }
  function renderTask(gen){
    var mega=snap.mega;
    var name = mega ? ('Mega Deep Research — '+mega.entity) : (snap.question || (snap.research?'Deep Research':'Answer'));
    if(name.length>72) name=name.slice(0,72)+'…';
    var curOp='—', i;
    for(i=0;i<snap.steps.length;i++){ if(snap.states[i]==='running'){ curOp=snap.steps[i]; break; } }
    if(gen && curOp==='—') curOp=snap.steps[snap.steps.length-1]||'Working';
    if(!gen) curOp='—';
    var pct=(mega && mega.count>0) ? Math.min(100,Math.round(mega.collected/mega.count*100)) : -1;
    var sig=[gen,name,curOp,snap.states.join(','),pct,detailsOpen,snap.hadError,appState().voiceState].join('|');
    if(sig===lastSig) return; lastSig=sig;
    taskEl.hidden=false;
    tKicker.textContent = gen ? 'Currently working on' : 'Last task';
    tName.textContent=name;
    tSpin.style.display = gen ? '' : 'none';
    if(pct>=0){ tBarWrap.hidden=false; tInd.hidden=true; tBarFill.style.width=pct+'%'; tPct.textContent=mega.collected.toLocaleString()+' of '+mega.count.toLocaleString()+' '+mega.entity+' — '+pct+'%'; }
    else { tBarWrap.hidden=true; tInd.hidden=!gen; tPct.textContent=''; }
    tStatus.innerHTML='<b>'+esc2(taskStatusWord(gen))+'</b>'+(gen && curOp!=='—' ? ' — '+esc2(curOp.replace(/…$/,'')) : '');
    tCancel.hidden=!gen;
    if(detailsOpen) tDet.innerHTML=detailsHtml(gen,curOp);
  }
  function pollTask(){
    if(!taskEl) return;
    var st=appState(), pt=window.pcTask;
    if(pt && pt.steps && pt.steps.length){
      var chat=(typeof activeChat==='function') ? activeChat() : null;
      var lu=null, la=null;
      if(chat && chat.messages){
        for(var i=chat.messages.length-1;i>=0;i--){ var m=chat.messages[i]; if(!lu && m.role==='user') lu=m; if(!la && m.role==='ai') la=m; if(lu && la) break; }
      }
      snap={ steps:pt.steps.slice(), states:pt.states.slice(), starts:(pt.starts||[]).slice(), ends:(pt.ends||[]).slice(),
             research:!!pt.research, decision:pt.decision||'', question:lu?(lu.text||''):'', files:lu?(lu.files||[]):[],
             startAt:(pt.starts && pt.starts[0]) || Date.now(),
             mega:window.__enzoMega ? {collected:window.__enzoMega.collected, count:window.__enzoMega.count, entity:window.__enzoMega.entity} : null,
             hadError:!!(la && la.error), endAt:0 };
    }
    if(!snap){ taskEl.hidden=true; return; }
    if(!st.isGenerating && !snap.endAt) snap.endAt=Date.now();
    if(st.isGenerating) snap.endAt=0;
    renderTask(!!st.isGenerating);
  }
  if(tCancel) tCancel.onclick=function(){ if(typeof stopGeneration==='function') stopGeneration(); };
  if(tDetBtn) tDetBtn.onclick=function(){
    detailsOpen=!detailsOpen;
    tDet.hidden=!detailsOpen;
    tDetBtn.setAttribute('aria-expanded', detailsOpen?'true':'false');
    tDetBtn.textContent = detailsOpen ? 'Hide details' : 'Task details';
    lastSig=''; pollTask();
  };

  /* ---- Quick actions: real modules only. Image opens the working Image
     Generation tool; More Tools opens the full AI Tools launcher. Video and
     Music have NO connected engine, so they say so plainly instead of
     pretending to work. ---- */
  function closePanelOverlay(){
    var panel=$('enzoPanel');
    if(panel && window.__enzoMobileUI()) panel.classList.remove('open');
  }
  var qaI=$('qaImage'), qaV=$('qaVideo'), qaM=$('qaMusic'), qaT=$('qaTools');
  if(qaI) qaI.onclick=function(){ closePanelOverlay(); if(typeof openTool==='function') openTool('imagegen'); };
  if(qaT) qaT.onclick=function(){ closePanelOverlay(); if(typeof openTools==='function') openTools(); };
  if(qaV) qaV.onclick=function(){ if(typeof toast==='function') toast('Video generation is not available in ENZO yet — no free video engine is connected. Create Image and every AI Tool work right now.'); };
  if(qaM) qaM.onclick=function(){ if(typeof toast==='function') toast('Music creation is not available in ENZO yet — no free music engine is connected. Create Image and every AI Tool work right now.'); };

  /* ---- Performance controls: 3D quality + Reduced Motion (persisted) ---- */
  var qSel=$('enzoQuality'), rmBtn=$('enzoRMBtn');
  function syncRM(){
    if(!rmBtn) return;
    var on=!!window.__enzoRM;
    rmBtn.setAttribute('aria-pressed', on?'true':'false');
    rmBtn.textContent='Reduced motion: '+(on?'On':'Off');
  }
  if(qSel){
    qSel.value=(typeof window.getEnzoQuality==='function') ? window.getEnzoQuality() : 'high';
    qSel.onchange=function(){ if(typeof window.setEnzoQuality==='function') window.setEnzoQuality(qSel.value); };
  }
  if(rmBtn){
    syncRM();
    rmBtn.onclick=function(){ if(typeof window.setEnzoReducedMotion==='function') window.setEnzoReducedMotion(!window.__enzoRM); syncRM(); };
  }

  /* Piece 44 §10 boot: the shared loop starts with no active task and a
     visible panel; startPoll/stopPoll update this as tasks run/end. */
  EnzoPollLoop.setContext({ hasActiveTask: false, panelVisible: true });
  EnzoPollLoop.registerPoller('status-panel', function(){ pollStatus(); pollTask(); }, 5000, { kind: 'idle', jitter: false });
  pollStatus(); pollTask();   /* keep the immediate first paint */
})();
