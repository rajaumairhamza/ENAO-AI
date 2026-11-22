
/* ================= P-F — ENZO PLATFORM BACKEND ADAPTER (/api/v2) =================
   Data/API layer only. All research, chat, task and file calls go through the
   same-origin /api/v2 platform backend (contract verified live against
   https://enzoai.cu.gy/api/v2). When the backend is unreachable, the page
   falls back to the built-in search pipeline and says so honestly in the
   companion panel. Also here: per-chat backend isolation + restore, real
   backend progress / agent states / ETA in the panel, pause-resume-cancel
   wired to the backend control endpoints, backend clarification (typed and
   voice-call gather-then-search), answer-language enforcement (the answer
   always follows the language/script of the user's own message), reminders
   (browser-stored, spoken + visible, missed handling), learning from the
   user (browser-stored profile, visible and deletable in Settings), and the
   universal self-expanding search wrapper (the system retries with derived
   keywords/synonyms across providers — the user is never asked for keywords). */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function escH(s){ return (typeof esc==='function') ? esc(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var V2 = window.EnzoPagesBackend.getBackendBase();
var transport59 = window.__enzoGetTransport59 ? window.__enzoGetTransport59() : null;
var v2Up=null;               /* null = not checked yet, true = up, false = fallback in use */
var v2ChatPromises={};       /* local chat id -> Promise<backend chat_id> */
var v2ctxByChat={};          /* local chat id -> last ask ctx (for restore) */
var currentPoll=null;        /* {taskId, chatId, timer, strikes} */
window.__v2Task=null;        /* live backend task snapshot for the panel */

/* ---------------- v2 transport ---------------- */
function v2req(path, opts, timeoutMs){
  opts=opts||{};
  var ctl=('AbortController' in window)?new AbortController():null;
  var to=ctl?setTimeout(function(){ ctl.abort(); }, timeoutMs||20000):null;
  var o={method:opts.method||'GET', signal:ctl?ctl.signal:undefined};
  if(opts.body!==undefined){ o.headers={'Content-Type':'application/json'}; o.body=JSON.stringify(opts.body); }
  if(opts.form){ o.body=opts.form; }
  return fetch(V2+path, o).then(function(r){
    if(to) clearTimeout(to);
    return r.json().catch(function(){ return null; }).then(function(j){
      if(!r.ok || !j || j.ok===false){ var err59=new Error((j&&j.message)||('http '+r.status)); err59.status=r.status; throw err59; }
      return j;
    });
  }, function(e){ if(to) clearTimeout(to); throw e; });
}
function v2get(p, ms){ return v2req(p, {}, ms||20000); }
function v2post(p, body, ms){ return v2req(p, {method:'POST', body:body||{}}, ms||30000); }
function v2upload(p, form){ return v2req(p, {method:'POST', form:form}, 45000); }

function setFallbackLine(on){
  var el=$('v2StateLine'); if(!el) return;
  el.hidden=!on;
  if(on) el.textContent='Platform backend unreachable — answers are using the built-in fallback search.';
}
/* Piece 42: the ONLY writer of the fallback banner is this onChange
   subscriber. Nothing else in the file may drive the banner or the
   backend-down flag from a probe failure. */
window.__enzoBackendDown = false;
window.EnzoBackendHealth.onChange(function (status) {
  window.__enzoBackendDown = (status === 'down');
  v2Up = (status === 'up');
  setFallbackLine(status === 'down');
});
function v2health(){
  return window.EnzoBackendHealth.checkHealth().then(function (r) {
    v2Up = r.reachable;
    return r.reachable;
  });
}

/* ---------------- panel extras (state line, agent line, pause/resume) ---------------- */
function buildPanelExtras(){
  var pill=$('enzoStatusPill');
  if(pill && !$('v2StateLine')){
    var line=document.createElement('div');
    line.id='v2StateLine'; line.className='v2-state-line'; line.hidden=true;
    pill.parentNode.insertBefore(line, pill.nextSibling);
  }
  var taskSec=$('enzoTask');
  if(taskSec && !$('v2AgentLine')){
    var al=document.createElement('div');
    al.id='v2AgentLine'; al.className='v2-agent-line'; al.hidden=true;
    var btns=taskSec.querySelector('.enzo-task-btns');
    if(btns) taskSec.insertBefore(al, btns); else taskSec.appendChild(al);
  }
  var btnsRow=taskSec?taskSec.querySelector('.enzo-task-btns'):null;
  if(btnsRow && !$('v2PauseBtn')){
    var pb=document.createElement('button');
    pb.type='button'; pb.className='enzo-tbtn'; pb.id='v2PauseBtn'; pb.textContent='Pause'; pb.hidden=true;
    pb.onclick=function(){ v2Control('pause'); };
    var rb=document.createElement('button');
    rb.type='button'; rb.className='enzo-tbtn'; rb.id='v2ResumeBtn'; rb.textContent='Resume'; rb.hidden=true;
    rb.onclick=function(){ v2Control('resume'); };
    btnsRow.insertBefore(pb, btnsRow.firstChild);
    btnsRow.insertBefore(rb, btnsRow.firstChild.nextSibling);
  }
  EnzoPollLoop.registerPoller('panel-extras', function(){
    /* Accuracy rule: never render progress numbers from stale data. */
    var st = EnzoPollLoop.getStatus('task-progress');
    if(st && st.dataState !== 'fresh'){
      var al = $('v2AgentLine');
      if(al && st.dataState !== 'unknown'){ al.textContent = 'Updating…'; al.hidden = false; }
      /* 'unknown' (never succeeded) renders nothing — no guessed numbers. */
      if(!st || st.dataState === 'unknown') return;
      if(st.dataState === 'stale' || st.dataState === 'error') return; /* show 'Updating…' only */
    }
    updatePanelExtras();
  }, 2000, { kind: 'panel' });
}
function fmtDur(s){
  if(s==null || isNaN(s)) return '';
  s=Math.max(0, Math.round(s));
  var m=Math.floor(s/60), ss=s%60;
  return m>0 ? (m+' min '+(ss?ss+' sec':'')) : (ss+' sec');
}
function agentRoleLabel(r){
  return String(r||'agent').replace(/_/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
function updatePanelExtras(){
  var t=window.__v2Task, al=$('v2AgentLine'), pb=$('v2PauseBtn'), rb=$('v2ResumeBtn');
  var chat=(typeof activeChat==='function')?activeChat():null;
  var mine=!!(t && chat && t.chatId===chat.id);
  if(al){
    if(mine && (t.state==='running'||t.state==='paused')){
      var parts=[];
      parts.push('Backend progress: '+t.done+' of '+t.total+' steps done');
      if(t.elapsed_s!=null) parts.push('elapsed '+fmtDur(t.elapsed_s));
      if(t.eta_s!=null) parts.push('ETA about '+fmtDur(t.eta_s)+(t.eta_basis?' ('+escH(t.eta_basis)+')':''));
      var ag=(t.agents||[]).map(function(a){ return escH(agentRoleLabel(a.role))+' — '+escH(a.status); }).join(' &middot; ');
      al.innerHTML=escH(parts.join(' · '))+(ag?'<br>Agents: '+ag:'');
      al.hidden=false;
    } else al.hidden=true;
  }
  if(pb) pb.hidden=!(mine && t.state==='running');
  if(rb) rb.hidden=!(mine && t.state==='paused');
}
function v2Control(action){
  var t=window.__v2Task; if(!t) return;
  /* v59 (Piece 32 [8]): never send a control call for an empty or unknown task id. */
  if(window.EnzoPollingFix){ var g59v=window.EnzoPollingFix.guardTaskId(t.taskId); if(!g59v.ok) return; if(action==='cancel' && !window.EnzoPollingFix.canSendControl(t.taskId, 'cancel')) return; }
  v2post('/tasks/'+t.taskId+'/'+action, {}).then(function(j){
    var nt=(j&&j.task)||{};
    t.state=nt.state||(action==='pause'?'paused':'running');
    if(action==='pause'){ if(typeof setTypingStatus==='function') setTypingStatus('Paused'); toast('Research paused — the steps already completed are kept. Tap Resume to continue.'); }
    if(action==='resume'){ if(typeof setTypingStatus==='function') setTypingStatus('Searching…'); toast('Research resumed.'); }
    updatePanelExtras();
  }).catch(function(){ toast('The backend did not accept that just now — the research state has not changed.'); });
}

/* ---------------- message helpers (same shapes the page already uses) ---------------- */
function pushUserMsg(chat, text, lang, viaVoice, files){
  var tl=timeLabelFor(Date.now());
  chat.messages.push({role:'user', text:text, lang:lang, viaVoice:!!viaVoice, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full,
    files:(files||[]).map(function(f){ return {name:f.name, kind:f.kind, dataUrl:f.dataUrl||''}; })});
}
function aiMsgShell(ctx, plain, extra){
  var tl=timeLabelFor(Date.now());
  var m={role:'ai', html:'', plain:plain, viaVoice:!!ctx.viaVoice, question:ctx.text, sources:[], deep:!!(ctx.route&&ctx.route.deep),
    modeWhy:(ctx.route&&ctx.route.label)||'', auto:!!(ctx.route&&ctx.route.auto), followups:(typeof makeFollowups==='function')?makeFollowups(ctx.text, ctx.lang):[],
    lang:ctx.lang, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full, _fullHtml:mdToHtml(plain)};
  if(extra) for(var k in extra) m[k]=extra[k];
  return m;
}

/* ---------------- routing: the P-G decision, mirrored (backend mode is shown as run) ---------------- */
function computeRoute(text, chat, forcedDeep){
  if(typeof forcedDeep==='boolean') return {deep:forcedDeep, auto:false, label:(forcedDeep?'Deep Research':'Normal answer')+' (same mode as the original question)'};
  /* v55-master-intel P1: the local intent classifier decides FIRST,
     before the chatMode() override — it REPLACES the v54 gate
     (classifyVoiceResearch research forcing) and the bare
     detectIntent() call that used to decide here. */
  var intelB = chat.intelState || (chat.intelState = createIntelState());
  var intentB = classifyIntent(text, { state: intelB });
  /* WHO-CREATED FIX: topic from the question text itself; definition, never clarify. */
  if(intentB.kind==='clarify' && /^\s*who\s+(created|made|invented|founded|discovered|built|developed)\s+\S/i.test(text)){
    intentB = { kind:'definition', reason:'who-created-question', params:intentB.params, clarifyQuestion:null };
  }
  updateIntelState(intelB, text, intentB);
  chat.intentKind = intentB.kind; chat.lastIntent = intentB;
  /* v57-universal-intel (backend path): same central pipeline recording
     as the legacy path — context + reasoning + route, advisory only. */
  var uniCtxB57=null, uniReasonB57=null, uniRouteB57=null;
  try{ if(window.EnzoUniversalContext && typeof window.EnzoUniversalContext.createContextState==='function'){ uniCtxB57=chat.uniCtx || (chat.uniCtx=window.EnzoUniversalContext.createContextState()); window.EnzoUniversalContext.updateContext(uniCtxB57, {role:'user', text:text, lang:(typeof detectLang==='function'?detectLang(text):'roman')}); } }catch(e){}
  try{ if(window.EnzoUniversalReasoning && typeof window.EnzoUniversalReasoning.analyzeRequest==='function'){ uniReasonB57=window.EnzoUniversalReasoning.analyzeRequest(text, {state:intelB, classifyIntent:(typeof classifyIntent==='function'?classifyIntent:null), history:chat.messages, context:uniCtxB57}); } }catch(e){}
  try{ if(window.EnzoUniversalOrchestration && typeof window.EnzoUniversalOrchestration.route==='function'){ uniRouteB57=window.EnzoUniversalOrchestration.route({analysis:uniReasonB57, text:text}, {analysis:uniReasonB57, history:chat.messages}); } }catch(e){}
  try{ chat.uniAnalysis={reason:uniReasonB57, route:uniRouteB57, at:Date.now()}; }catch(e){}
  if (intentB.kind === 'research') return {deep:true, auto:true, label:'Deep Research (intent classifier: explicit investigation order)', intent:intentB};
  if (intentB.kind === 'clarify') return {deep:false, auto:true, label:'Clarify (intent classifier: genuinely ambiguous)', clarify:true, intent:intentB};
  if (intentB.kind === 'definition' || intentB.kind === 'conversation' || intentB.kind === 'general'){
    /* v55 P2: follow-up resolution + one-way search force (true forces
       Deep; false never overrides a Deep decision). */
    var cvFollowB = EnaoConversation.resolveFollowUp(text, { history: chat.messages });
    var cvSearchB = EnaoConversation.shouldSearch(cvFollowB.resolvedText, { history: chat.messages });
    if (cvSearchB.search) return {deep:true, auto:true, label:'Deep Research ('+cvSearchB.reason+')', intent:intentB};
    return {deep:false, auto:true, label:'Normal answer (intent classifier: '+intentB.reason+')', intent:intentB};
  }
  var cm=chatMode(chat);
  if(cm==='deep') return {deep:true, auto:false, label:'Deep Research (turned on for this chat)'};
  if(cm==='normal') return {deep:false, auto:false, label:'Normal answer (Deep Research off for this chat)'};
  var det=detectIntent(text);
  return {deep:det.deep, auto:true, label:(det.deep?'Deep Research':'Normal answer')+' (auto-detected: '+det.reason+')'};
}
var NORM_STEPS=['Understanding your question deeply…','Searching live in several ways…','Reading the best sources…','Preparing your complete answer…'];
var DEEP_STEPS=['Understanding your question deeply…','Searching in batches across the whole internet…','Reading and verifying the websites…','Preparing your detailed report…'];

/* ---------------- per-chat backend identity (isolation) ---------------- */
function ensureBackendChat(chat){
  if(chat.backendId) return Promise.resolve(chat.backendId);
  if(v2ChatPromises[chat.id]) return v2ChatPromises[chat.id];
  var p=v2post('/chats', {title:(chat.title||'New Chat').slice(0,80)}).then(function(j){
    chat.backendId=j.chat_id||(j.chat&&j.chat.chat_id);
    try{ if(chat.backendId && window.EnzoPollingFix) window.EnzoPollingFix.confirmChat(chat.id, chat.backendId); }catch(e){}
    delete v2ChatPromises[chat.id];
    saveChats();
    return chat.backendId;
  }).catch(function(e){ delete v2ChatPromises[chat.id]; throw e; });
  v2ChatPromises[chat.id]=p;
  return p;
}

/* ---------------- files through the backend ---------------- */
function uploadChatFiles(chat, bid, files){
  var docs=(files||[]).filter(function(f){ return f.kind!=='image' && (f.file || (f.text && f.text.length)); });
  var uploaded=[];
  var chain=Promise.resolve();
  docs.forEach(function(f){
    chain=chain.then(function(){
      if(f.backendFileId && f.backendForBid===bid){ uploaded.push({file_id:f.backendFileId, name:f.name}); return null; }
      var fd=new FormData();
      if(f.file) fd.append('file', f.file, f.name);
      else fd.append('file', new Blob([f.text], {type:'text/plain'}), f.name);
      return v2upload('/chats/'+bid+'/files', fd).then(function(j){
        f.backendFileId=j.file_id||(j.file&&j.file.file_id); f.backendForBid=bid;
        if(f.backendFileId) uploaded.push({file_id:f.backendFileId, name:f.name});
      }).catch(function(){ /* this file stays local-only; the ask still proceeds */ });
    });
  });
  return chain.then(function(){
    if(docs.length && !uploaded.length) throw new Error('upload');
    return uploaded;
  });
}
function fetchTaskSources(taskId){
  if(!taskId) return Promise.resolve([]);
  return EnzoPollLoop.dedupedFetch('/api/v2/tasks/'+encodeURIComponent(taskId)+'/sources', {}, function(){ return (transport59 ? transport59.getTaskSources(taskId) : v2get('/tasks/'+taskId+'/sources', 15000)); }).then(function(j){
    var out=[], seen={};
    (j.sources||[]).forEach(function(s){
      var u=s.final_url||'';
      if(!/^https?:\/\//i.test(u) || seen[u]) return;
      if(typeof isBareHomepage==='function' && isBareHomepage(u)) return;
      seen[u]=1;
      var dom=''; try{ dom=new URL(u).hostname.replace(/^www\./,''); }catch(e){}
      out.push({title:s.title||dom||'Web page', url:u, pubDate:s.pub_date||'', snippet:s.snippet||'', extract:s.snippet||'', outlet:s.outlet||'', domain:dom});
    });
    return out;
  }).catch(function(){ return []; });
}

/* ---------------- answer language: the answer follows the user's own message ----------------
   The backend answers in English by default, so for Roman Urdu / Urdu-script
   questions the backend text is rewritten into the user's language/script
   with every fact and citation marker preserved. English stays untouched. */
function citeCount(t){ var m=String(t||'').match(/\[\d+\]/g); return m?m.length:0; }
function urduCharRatio(t){
  var s=String(t||''), u=0, l=0;
  for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if(c>=0x600 && c<=0x6FF) u++; else if((c>=65&&c<=90)||(c>=97&&c<=122)) l++; }
  return (u+l)? u/(u+l) : 0;
}
function rewritePassage(text, lang){
  var target = lang==='urdu' ? 'Urdu script (Nastaliq Urdu)' : 'Roman Urdu (Urdu written in Latin letters only)';
  var prompt='Rewrite the following text in '+target+'. STRICT RULES: keep every fact, name, number, date and price exactly the same; keep every citation marker like [1] or [2] exactly where it is; do not add, remove or explain anything; do not mix scripts; output ONLY the rewritten text.\n\n'+text;
  return fetch('https://text.pollinations.ai/', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'openai', messages:EnzoIdentity.buildMessages(prompt)})})
    .then(function(r){ if(!r.ok) throw new Error('ai'); return r.text(); })
    .then(function(t){
      t=(t||'').trim();
      if(!t || t.length<2) throw new Error('empty');
      if(citeCount(t)!==citeCount(text)) throw new Error('cites');
      if(lang==='roman' && urduCharRatio(t)>0.05) throw new Error('script');
      if(lang==='urdu' && urduCharRatio(t)<0.3) throw new Error('script');
      return t;
    });
}
function rewriteInLang(text, lang){
  var chunks=[], rest=text;
  while(rest.length>2200){
    var cut=rest.lastIndexOf('\n\n', 2200); if(cut<600) cut=rest.lastIndexOf('. ', 2200);
    if(cut<300) cut=2200;
    chunks.push(rest.slice(0, cut+1)); rest=rest.slice(cut+1);
  }
  if(rest) chunks.push(rest);
  var out=[], chain=Promise.resolve();
  chunks.forEach(function(ch){
    chain=chain.then(function(){
      return rewritePassage(ch, lang).catch(function(){ return rewritePassage(ch, lang); })
        .then(function(r){ out.push(r); }, function(){ out.push(ch); });
    });
  });
  return chain.then(function(){ return out.join('\n\n'); });
}
function myMemoryUrdu(text){
  var parts=[], rest=text;
  while(rest.length>420){
    var cut=rest.lastIndexOf('. ', 420); if(cut<120) cut=420;
    parts.push(rest.slice(0, cut+1)); rest=rest.slice(cut+1);
  }
  if(rest) parts.push(rest);
  var out=[], chain=Promise.resolve();
  parts.forEach(function(p){
    chain=chain.then(function(){
      return fetchJSONT('https://api.mymemory.translated.net/get?q='+encodeURIComponent(p)+'&langpair=en|ur', 12000)
        .then(function(j){ var t=j&&j.responseData&&j.responseData.translatedText; if(!t) throw new Error('mm'); out.push(t); })
        .catch(function(){ out.push(p); });
    });
  });
  return chain.then(function(){
    var joined=out.join(' ');
    if(urduCharRatio(joined)<0.3) throw new Error('mm-script');
    return joined;
  });
}
function localizeAnswer(text, lang){
  if(window.EnzoLang45 && window.EnzoLang45.localizeAnswer) return window.EnzoLang45.localizeAnswer(text, lang);
  if(!text || lang==='en' || lang==='english') return Promise.resolve(text);
  if(lang==='urdu'){
    return myMemoryUrdu(text).catch(function(){ return rewriteInLang(text, 'urdu'); })
      .catch(function(){ return text; });
  }
  if(lang==='roman'){
    return rewriteInLang(text, 'roman').catch(function(){ return text; });
  }
  return Promise.resolve(text);
}

/* ---------------- delivering answers ---------------- */
function deliverAnswer(ctx, rawText, sources, backendMode, taskId){
  return localizeAnswer(rawText, ctx.lang).then(function(text2){
    text2 = (window.EnzoIdentityGuard
      ? window.EnzoIdentityGuard.correctIdentity(text2) : text2);
    /* v62-learning: pre-delivery correction guard (piece 44). A draft that
       only repeats a corrected mistake is never delivered; other drafts
       have the offending sentence removed. */
    try{
      if(window.CorrectionGuard && window.EnzoTeaching && typeof enzoLearningDeliverBlocked==='function'){
        var gCheck=CorrectionGuard.checkAnswer(text2, EnzoTeaching.createLearnedStore().getItems());
        if(gCheck && gCheck.violations && gCheck.violations.length){
          var gFix=CorrectionGuard.fixAnswer(text2, gCheck);
          if(gFix && gFix.blocked) return enzoLearningDeliverBlocked(ctx, gCheck.violations);
          if(gFix && gFix.fixed) text2=gFix.fixed;
        }
      }
    }catch(e){}
    ctx.delivered=true;
    var isResearch=backendMode==='research';
    var msg=aiMsgShell(ctx, text2, {
      sources: state.sourcesOn ? (sources||[]) : [],
      deep: isResearch,
      modeWhy: (isResearch?'Deep Research':'Normal answer')+' — run by the ENZO platform backend'+(ctx.route.auto?' (frontend auto-routing agreed)':''),
      _fullHtml: mdToHtml(text2)
    });
    var chat=ctx.chat;
    chat.messages.push(msg);
    /* v57-universal-intel: validate the delivered answer and close any
       open context task. Advisory only: issues recorded on the message,
       reply text unchanged. */
    try{ if(window.EnzoUniversalValidation && typeof window.EnzoUniversalValidation.validateAnswer==='function'){ msg.uniValidation=window.EnzoUniversalValidation.validateAnswer(text2, {question:ctx.text, lang:ctx.lang}); } }catch(e){}
    try{ if(window.EnzoUniversalContext && chat.uniCtx && typeof window.EnzoUniversalContext.updateContext==='function'){ window.EnzoUniversalContext.updateContext(chat.uniCtx, {role:'ai', text:text2, lang:ctx.lang}); } }catch(e){}
    if(taskId){ chat.lastTaskId=taskId; chat.backendTaskId=''; }
    saveChats();
    if(activeChat()===chat){
      renderMessages();
      streamMessage(chat, msg);
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDeliverAnswer(msg, answersMode()) : maybeSpeak(msg));
    } else {
      msg.html=msg._fullHtml;
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDeliverAnswer(msg, answersMode()) : maybeSpeak(msg));
      renderChatList(); saveChats();
      if(!currentPoll){ hideTyping(); setGenerating(false); }
    }
    return msg;
  });
}
function deliverClarify(ctx, question){
  ctx.delivered=true;
  hideTyping();
  try{ if(window.__enzoLifecycle) if(ctx.myRun) window.__enzoLifecycle.completeTask(ctx.myRun); }catch(e){}
  if(typeof setProgress==='function') setProgress(null);
  var msg=aiMsgShell(ctx, question, {html:mdToHtml(question), deep:false, modeWhy:'ENZO asked a clarifying question before researching', followups:[]});
  ctx.chat.messages.push(msg);
  saveChats();
  if(activeChat()===ctx.chat) renderMessages();
  setGenerating(false);
  setCentreEnzo('idle');
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
}
var ERR_TXT={
  en:'The platform backend could not finish this just now. Tap Retry Search to run this same question again.',
  roman:'Platform backend is waqt ye mukammal nahi kar saka. Isi sawal ko dobara chalane ke liye Retry Search dabayein.',
  urdu:'پلیٹ فارم بیک اینڈ اس وقت یہ مکمل نہیں کر سکا۔ یہی سوال دوبارہ چلانے کے لیے Retry Search دبائیں۔'
};
function deliverError(ctx){
  ctx.delivered=true;
  hideTyping(); finishTasks(true); setCentreEnzo('error');
  try{ if(window.__enzoLifecycle) if(ctx.myRun) window.__enzoLifecycle.failTask(ctx.myRun, 'backend-delivery-error'); }catch(e){}
  var line=ERR_TXT[ctx.lang]||ERR_TXT.en;
  var msg=aiMsgShell(ctx, line, {html:mdToHtml(line), error:true, sources:[]});
  ctx.chat.messages.push(msg);
  saveChats();
  if(activeChat()===ctx.chat) renderMessages();
  setGenerating(false);
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
}

/* ---------------- fallback: the built-in pipeline, honestly labelled ---------------- */
function fallbackLegacy(ctx){
  if(ctx.delivered) return;
  /* v53-monitor wiring: the fallback /api/search proxy is now in use
     instead of /api/v2 — note exactly that in the monitor. */
  try{ if(window.EnzoMonitor) EnzoMonitor.noteFrontendStep({title:'Fallback search proxy in use \u2014 live backend events unavailable', detail:'Fallback search proxy in use \u2014 live backend events unavailable'}); }catch(e){}
  /* Piece 43: fallbackLegacy must NOT set v2Up — backend state lives in
     piece 42 (EnzoBackendHealth). It only runs the fallback and labels it. */
  var chat=ctx.chat, text=ctx.text, lang=ctx.lang, deep=ctx.route.deep, steps=ctx.steps;
  var historyText=chat.messages.slice(-12,-1).map(function(m){ var tl=timeLabelFor(m.ts||Date.now()); return '['+tl.full+'] '+(m.role==='user'?'User: ':'AI: ')+(m.text||stripHtml(m.html||'')).slice(0,450); }).join('\n');
  var fileCtx=(ctx.files||[]).map(function(f){ return f.text?('\n\n--- Attached file: '+f.name+' ---\n'+f.text.slice(0,6000)):'\n\n[Attached file: '+f.name+' ('+f.kind+') — no readable text could be extracted from it]'; }).join('');
  if(fileCtx) historyText+='\n\n[The user attached file content with this question — use it as the main material for the answer:]'+fileCtx.slice(0,6000);
  setTypingStatus('Searching…');
  searchWeb(text, deep).then(function(sources){
    setProgress(steps, 2, deep);
    return answerWithSources(text, sources, lang, deep, historyText, steps);
  }).then(function(result){
    if(ctx.myRun!==searchRunId || state.stopRequested) return;
    hideTyping(); setProgress(steps, 3, deep);
    if(!result.plain){
      /* v55 P2: no answer text — honest uncertainty via deliverAnswer. */
      var hu55b=EnaoConversation.honestUncertainty(text, {history:chat.messages});
      if(hu55b){ deliverAnswer(ctx, hu55b, [], 'normal', null); return; }
    }
    var useSources=result.sources, fullHtml=result.html;
    var liveCount=(result.sources && typeof result.sources.liveCount==='number') ? result.sources.liveCount : (result.sources||[]).length;
    /* GUFTAGU (locked rule 49): same as the main pipeline — conversation
       never gets a clarifying question; a model clarify reply is replaced
       with a direct own-knowledge answer. */
    if(isGuftagu(text) && result.clarify){
      return callAIKnowledge(text, lang, false, historyText).then(function(kText){
        if(ctx.myRun!==searchRunId || state.stopRequested) return;
        kText=finishAtSentence(scrubResearchClaims(scrubQuestionEcho(kText, text)));
        var gMsg=aiMsgShell(ctx, kText, {sources:[], _fullHtml:mdToHtml(kText), modeWhy:'Everyday conversation — answered directly from ENZO\'s own knowledge'});
        chat.messages.push(gMsg); renderMessages(); saveChats();
        streamMessage(chat, gMsg);
      });
    }
    /* NEVER-ANSWER-WHEN-UNSURE (locked rule): same as the main pipeline — a
       clarifying question from the model, or no usable pages for a factual
       question, means ONE short clarifying question, never a guessed answer
       dressed up with a failure notice. Guftagu (rule 49) is exempt. */
    var fbClarify='';
    var fbGuftagu=isGuftagu(text);
    /* v55 P1: the thin-search / model clarify is gated for decided
       kinds — the local intent decision wins in the fallback too. */
    var intent = (typeof classifyIntent==='function') ? classifyIntent(text) : null;
    var fbIntentKind55 = chat.intentKind || (intent && intent.kind);
    var fbDecided55 = !!(fbIntentKind55 && fbIntentKind55!=='clarify');
    if(!fbDecided55 && result.clarify && result.plain && !fbGuftagu) fbClarify=result.plain;
    else if(!fbDecided55 && liveCount<2 && !fbGuftagu){
      var fk0=(result.sources && result.sources.failKind) || 'empty';
      var qt0=analyzeQuestion(text).type;
      if((fk0==='empty'||fk0==='none') && qt0!=='writing' && qt0!=='solve' && typeof window.__enzoClarifyQuestion==='function')
        fbClarify=window.__enzoClarifyQuestion(text, lang, chat, 'noresults');
    }
    if(fbClarify){
      chat.pendingClarifyLocal={original:text, noResults:true, lang:lang, opts:(typeof window.__enzoNoResultsOptions==='function'?window.__enzoNoResultsOptions(text):[])};
      saveChats();
      deliverClarify(ctx, fbClarify);
      return;
    }
    if(liveCount<2){
      useSources=[];
      var fk=(result.sources && result.sources.failKind) || 'empty';
      var qt1=analyzeQuestion(text).type;
      if(result.aiFailed)
        fullHtml='<div class="notice-warn"><p style="margin:0 0 10px">'+esc(window.EnzoAskRecovery.fallbackNotice(lang))+'</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
      else if(qt1!=='writing' && qt1!=='solve' && !fbGuftagu)
        fullHtml=searchFailNoticeHtml(fk==='none'?'empty':fk)+fullHtml;
    }
    var msg=aiMsgShell(ctx, result.plain, {sources: state.sourcesOn?useSources:[], _fullHtml:fullHtml,
      modeWhy: ctx.route.label+' — fallback search (platform backend unreachable)'});
    window.EnzoAskRecovery.applyFallbackLabel(msg, lang);
    chat.messages.push(msg); renderMessages(); saveChats();
    streamMessage(chat, msg);
  }).catch(function(){
    if(ctx.myRun!==searchRunId || state.stopRequested) return;
    deliverError(ctx);
  });
}

/* ---------------- research task polling: real backend progress only ---------------- */
function stopPoll(){ if(currentPoll){ try{ if(window.EnzoTaskState59) window.EnzoTaskState59.endBackendTask(currentPoll.taskId); }catch(e){} clearTimeout(currentPoll.timer); if(window.EnzoPollLoop){ EnzoPollLoop.unregisterPoller('task-progress'); try{ EnzoPollLoop.setContext({ hasActiveTask: false, panelVisible: (typeof document!=='undefined' && !document.hidden) }); }catch(e){} } currentPoll=null; } }
function startPoll(chat, taskId, ctx, initialTask){
  try{ if(window.EnzoPollingFix) window.EnzoPollingFix.confirmTask(taskId); }catch(e){}
  try{ if(window.EnzoTaskState59) window.EnzoTaskState59.beginBackendTask(taskId); }catch(e){}
  stopPoll();
  var poll={taskId:taskId, chatId:chat.id, timer:null, strikes:0};
  currentPoll=poll;
  try{ if(window.EnzoPollLoop){ EnzoPollLoop.setContext({ hasActiveTask: true, panelVisible: true }); EnzoPollLoop.wake(); } }catch(e){}
  window.__v2Task={taskId:taskId, chatId:chat.id, state:'running', done:0, total:(initialTask&&initialTask.plan&&initialTask.plan.subtasks)?initialTask.plan.subtasks.length:0, agents:[], elapsed_s:null, eta_s:null, eta_basis:null};
  /* v53-monitor wiring: the monitor tracks this task from the moment it starts. */
  try{ if(window.EnzoMonitor){ var _mp=EnzoMonitor.openTask(taskId); if(_mp&&_mp.catch) _mp.catch(function(){}); } }catch(e){}
  function applyPlan(task){
    if(task && task.plan && task.plan.subtasks && task.plan.subtasks.length){
      var steps=task.plan.subtasks.map(function(s){ return s.title; });
      ctx.backendSteps=steps;
      setProgress(steps, (window.__v2Task&&window.__v2Task.done)||0, true);
      pcTask.decision=ctx.route.label; renderTaskList();
    }
  }
  if(initialTask && initialTask.plan) applyPlan(initialTask);
  else (function(){ var seq0 = EnzoPollLoop.markRun('task-progress'); return EnzoPollLoop.dedupedFetch('/api/v2/tasks/'+encodeURIComponent(taskId), {}, function(){ return (transport59 ? transport59.getTask(taskId) : v2get('/tasks/'+taskId, 15000)); }).then(function(j){ if(!EnzoPollLoop.isCurrent('task-progress', seq0)) return; applyPlan(j); }).catch(function(){}); })();
  /* Piece 44 §2: the self-chaining tick is now the shared loop's
     'task-progress' poller (task, 2000ms; paused 4000ms). The first
     read now happens at 2000ms, not 600ms — the first-tick burst
     was part of the overload. Progress shares its in-flight request
     with the Live Screen poller via dedupedFetch (§9). */
  EnzoPollLoop.registerPoller('task-progress', function(){
    if(currentPoll!==poll) { EnzoPollLoop.unregisterPoller('task-progress'); return Promise.resolve(); }
    var seq = EnzoPollLoop.markRun('task-progress');
    return EnzoPollLoop.dedupedFetch('/api/v2/tasks/'+encodeURIComponent(taskId)+'/progress', {}, function(){ return (transport59 ? transport59.getTaskProgress(taskId) : v2get('/tasks/'+taskId+'/progress', 15000)); })
      .then(function(p){
        if(!EnzoPollLoop.isCurrent('task-progress', seq)) return; /* stale: a newer run superseded this one — drop it, never render it */
        if(currentPoll!==poll) return;
      poll.strikes=0;
      try{ if(window.__enzoLifecycle) window.__enzoLifecycle.syncStatus(ctx.myRun, p.state); }catch(e){}
      window.__v2Task={taskId:taskId, chatId:chat.id, state:p.state, done:p.done||0, total:p.total||0, agents:p.agents||[], elapsed_s:(p.elapsed_s!=null?p.elapsed_s:null), eta_s:(p.eta_s!=null?p.eta_s:null), eta_basis:p.eta_basis||null};
      if(ctx.backendSteps) setProgress(ctx.backendSteps, Math.min(p.done||0, ctx.backendSteps.length), true);
      if(p.state==='completed' || p.state==='partially_completed'){
        stopPoll();
        try{ if(window.__enzoLifecycle) window.__enzoLifecycle.completeTask(ctx.myRun); }catch(e){}
        EnzoPollLoop.dedupedFetch('/api/v2/tasks/'+encodeURIComponent(taskId), {}, function(){ return (transport59 ? transport59.getTask(taskId) : v2get('/tasks/'+taskId, 20000)); }).then(function(j){
          if(!EnzoPollLoop.isCurrent('task-progress', seq)) return;
          var t=j.task||{}, r=t.result||{};
          var ans=r.answer||r.report||'';
          return fetchTaskSources(taskId).then(function(srcs){ return deliverAnswer(ctx, ans, srcs, 'research', taskId); });
        }).catch(function(){ if(!ctx.delivered) deliverError(ctx); });
        return;
      }
      if(p.state==='failed'){
        stopPoll();
        try{ if(window.__enzoLifecycle) window.__enzoLifecycle.failTask(ctx.myRun, 'backend-task-failed'); }catch(e){}
        EnzoPollLoop.dedupedFetch('/api/v2/tasks/'+encodeURIComponent(taskId), {}, function(){ return (transport59 ? transport59.getTask(taskId) : v2get('/tasks/'+taskId, 15000)); }).then(function(j){
          if(!EnzoPollLoop.isCurrent('task-progress', seq)) return;
          var r=(j.task&&j.task.result)||{};
          if(r.answer || r.report) return fetchTaskSources(taskId).then(function(srcs){ return deliverAnswer(ctx, r.answer||r.report, srcs, 'research', taskId); });
          deliverError(ctx);
        }).catch(function(){ deliverError(ctx); });
        return;
      }
      if(p.state==='cancelled'){
        stopPoll();
        try{ if(window.__enzoLifecycle) window.__enzoLifecycle.cancelTask(ctx.myRun, 'backend-cancelled'); }catch(e){}
        window.__v2Task.state='cancelled';
        hideTyping(); markTasksCancelled(); setGenerating(false); setCentreEnzo('idle');
        return;
      }
      if(p.state==='paused') setTypingStatus('Paused');
      if(p.state==='paused') EnzoPollLoop.setIntervalMs('task-progress', 4000);
      else EnzoPollLoop.setIntervalMs('task-progress', 2000);
    }).catch(function(){
      if(currentPoll!==poll) return;
      poll.strikes++;
      if(poll.strikes>=3){ stopPoll(); if(!ctx.delivered && !state.stopRequested) fallbackLegacy(ctx); return; }
      /* Do NOT schedule a retry here — the loop re-runs at the floored
         interval and applies its own backoff after 3 consecutive failures. */
    });
  }, 2000, { kind: 'task' });
}

/* ---------------- ask response handling ---------------- */
function handleAskResp(ctx, resp){
  /* v58 F03: Stop pressed during the /ask POST — never start a poll or deliver afterwards. */
  if(ctx.myRun!==searchRunId || state.stopRequested) return Promise.resolve();
  var chat=ctx.chat;
  if(resp.mode==='clarify'){
    /* v55 P1 — the single most important wiring rule: when the local
       kind is already decided, the backend's clarify question is NOT
       delivered — the local decision wins and the legacy pipeline runs
       for that kind. Backend clarify is honoured only when the local
       kind is 'clarify', and then the LOCAL question is shown, not the
       backend wording. */
    var localKind55 = chat.intentKind || (ctx.route && ctx.route.intent && ctx.route.intent.kind);
    if(localKind55 && localKind55!=='clarify'){
      fallbackLegacy(ctx);
      return Promise.resolve();
    }
    chat.pendingClarify=true; saveChats();
    var localQ55 = (ctx.route && ctx.route.intent && ctx.route.intent.clarifyQuestion) || resp.clarification_question || '';
    return localizeAnswer(localQ55, ctx.lang).then(function(q){ deliverClarify(ctx, q); });
  }
  chat.pendingClarify=false; saveChats();
  if(resp.mode==='research' && resp.task_id){
    chat.backendTaskId=resp.task_id; saveChats();
    try{ if(window.EnzoPollingFix){ window.EnzoPollingFix.confirmTask(resp.task_id); if(chat.backendId) window.EnzoPollingFix.confirmChat(chat.id, chat.backendId); } }catch(e){}
    startPoll(chat, resp.task_id, ctx, resp.task);
    return Promise.resolve();
  }
  var ans=resp.answer || (resp.task && resp.task.result && resp.task.result.answer) || '';
  if(!ans){
    var hu55=EnaoConversation.honestUncertainty(ctx.text, {history:chat.messages});
    if(hu55) return deliverAnswer(ctx, hu55, [], 'normal', null);
  }
  return fetchTaskSources(resp.task_id).then(function(srcs){
    return deliverAnswer(ctx, ans, srcs, resp.mode||'normal', resp.task_id);
  });
}

/* ---------------- the backend ask flow ---------------- */
function backendAsk(text, viaVoice, forcedDeep){
  var files=state.pendingFiles.slice(); state.pendingFiles=[]; renderAttachRow();
  if(!text && files.length) text='Please analyze the attached file'+(files.length>1?'s':'')+' and tell me the key points.';
  var chat=activeChat();
  if(!chat){ chat=createChat(text.slice(0,42)); }
  if(chat.messages.length===0) chat.title=text.slice(0,42);
  /* v53-monitor wiring: track this chat in the Live Research Monitor and
     record the one real client-side step — the question was sent. */
  try{ if(window.EnzoMonitor){ var bid59ba=window.EnzoPollingFix?window.EnzoPollingFix.resolveBackendId(chat.id):null; if(bid59ba){ EnzoMonitor.setChatId(bid59ba); EnzoMonitor.start(); } EnzoMonitor.noteFrontendStep({title:'Question sent', detail:'Question sent to ENZO for research.'}); } }catch(e){}
  var lang=(window.EnzoLang45 ? window.EnzoLang45.askLang(text, state.langPref, detectLang) : detectLang(text));
  state.lastAnswerLang = lang;
  try{ if(window.EnzoVoiceFix42 && window.EnzoVoiceFix42.resetSayAgainLoop) window.EnzoVoiceFix42.resetSayAgainLoop(); }catch(e){}
  try{ if(typeof recognition!=='undefined' && recognition && state.voiceLive && window.EnzoLang46) recognition.lang = window.EnzoLang46.recognitionLangFor(lang); }catch(e){}
  pushUserMsg(chat, text, lang, viaVoice, files);
  renderChatList(); renderMessages(true); saveChats();
  setGenerating(true);
  var myRun=beginSearchRun();
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.startTask(myRun, {logicalKey: text}); if(searchInFlight) window.__enzoLifecycle.registerAbort(myRun, searchInFlight); window.__enzoLifecycle.registerSubOp(myRun, 'searchWeb-retry', function(){ if(searchInFlight){ try{ searchInFlight.abort(); }catch(e){} } }); }catch(e){}
  state.stopRequested=false;
  state.usage++; var ut=$('usageText'); if(ut) ut.textContent=state.usage;
  if(state.voiceLive && !state.isSpeaking) setVoiceState('processing');
  var route=computeRoute(text, chat, forcedDeep);
  var steps=route.deep?DEEP_STEPS:NORM_STEPS;
  setProgress(steps, 1, route.deep);
  pcTask.decision=route.label; renderTaskList();
  showTyping();
  setCentreEnzo(route.deep?'researching':'thinking');
  setTypingStatus('Searching…');
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.setState(myRun, route.deep?'researching':'searching'); }catch(e){}
  var ctx={chat:chat, text:text, lang:lang, viaVoice:!!viaVoice, route:route, steps:steps, myRun:myRun, files:files, delivered:false};
  v2ctxByChat[chat.id]=ctx;
  if(route.clarify){
    /* v55 P1: 'clarify' only — local clarify delivery, do not POST /ask. */
    chat.pendingClarify=true; saveChats();
    deliverClarify(ctx, (route.intent && route.intent.clarifyQuestion) || (window.EnzoLang47 ? window.EnzoLang47.backendClarifyFallback(lang) : 'What would you like me to do?'));
    return;
  }
  /* v59-live-research-fix (Piece 33 [9]): honest-unreachable ask gate. Before ANY backend fetch for this ask, the resolved backend is checked once; a successful check is cached for the session, a failed check is re-run on the next ask (never cached as permanent). When the check blocks, the notice is shown in the chat in the user's language and the ask STOPS: nothing is sent, no normal-mode answer is presented as research, and the search proxy is not used as a silent substitute. This gate is in addition to the existing v2Up fallback line. */
  var backendGate59 = window.__enzoBackendGate59 || (window.__enzoBackendGate59 = { ok: false });
  function attemptBackendAsk59(){
  return ensureBackendChat(chat).then(function(bid){
    ctx.bid=bid;
    return uploadChatFiles(chat, bid, files).then(function(uploaded){
      ctx.uploaded=uploaded;
      if(uploaded.length===1 && /(summar|khulasa|summary)/i.test(text) && !chat.pendingClarify){
        return v2post('/chats/'+bid+'/files/'+uploaded[0].file_id+'/summarize', {}, 45000)
          .then(function(j){ return deliverAnswer(ctx, j.summary||'', [], 'file', null); })
          .then(function(){ return {handled:true}; });
      }
      if(uploaded.length>=2 && /(compar|difference|farq|muqabla|mukabla)/i.test(text) && !chat.pendingClarify){
        return v2post('/chats/'+bid+'/files/compare', {file_id_a:uploaded[0].file_id, file_id_b:uploaded[1].file_id}, 45000)
          .then(function(j){ return deliverAnswer(ctx, j.comparison||'', [], 'file', null); })
          .then(function(){ return {handled:true}; });
      }
      var qText55=EnaoConversation.resolveFollowUp(text, {history:chat.messages}).resolvedText;
      var askBody45={question:qText55, deep:route.deep, via_voice:!!viaVoice, preferences:(function(){ var p=learnedPrefs(); p.depth='thorough'; p.cross_check=true; p.work='complete ready-to-use deliverable, step by step; state plainly the one final step that needs the user login or tap; never claim anything was posted, published or sent'; p.never_refuse='When the user orders work, never refuse and never give up: try another route when one is blocked; if genuinely impossible right now, state the exact blocker and exactly what is needed from the user, then continue when provided.'; try{ var ur=JSON.parse(localStorage.getItem('enao_userrules_v1')||'[]'); if(ur && ur.length) p.user_rules=ur; }catch(e){} return p; })()};
      if(window.EnzoLang45 && window.EnzoLang45.buildAskBody){ try{ askBody45=window.EnzoLang45.buildAskBody(askBody45, lang); }catch(e){} }
      return v2post('/chats/'+bid+'/ask', askBody45, 90000)
        .then(function(resp){ if(ctx.myRun!==searchRunId || state.stopRequested) return null; return handleAskResp(ctx, resp); })
        .then(function(){ return {handled:true}; });
    });
  });
  }
  function runBackendAsk59(){
    attemptBackendAsk59().catch(function(){
      if(ctx.delivered || state.stopRequested) return;
      if(myRun!==searchRunId) return;
      /* Piece 43: one failed request never flips the app into fallback.
         Re-probe first; fallback only after the multi-attempt check fails. */
      window.EnzoAskRecovery.guardedAsk(ctx, {
        attempt: function () { return attemptBackendAsk59(); },
        runFallback: function (c) { fallbackLegacy(c); },
        /* setUp is a seam for environments without piece 42. With
           piece 42 present it is a no-op by design: checkHealth already
           drove v2Up from the probe verdict. */
        setUp: function (up, probe) {}
      });
    });
  }
  if(backendGate59.ok){ runBackendAsk59(); }
  else if(!window.EnzoPagesBackend){ runBackendAsk59(); }
  else {
    /* Piece 43: the gate re-proves "down" with a fresh multi-attempt
       check before blocking anything. One failed check is not proof. */
    window.EnzoAskRecovery.probeBackend({ attempts: 3 }).then(function(probe59){
      /* Piece 42 §2b: the notice is built from the module's lastProbe —
         the piece-33 shape ({reason, base, httpStatus}) — so the
         unavailable-notice text is unchanged. probeBackend's lastCheck
         is the checkHealth summary, which carries no reason/base. */
      var check59 = window.EnzoBackendHealth.getState().lastProbe;
      if(ctx.delivered || state.stopRequested || myRun!==searchRunId) return;
      if(!probe59.reachable && window.EnzoPagesBackend.shouldBlockAsk(check59)){
        /* Piece 43 + piece 42: state lives in piece 42 — never assign
           v2Up here. checkHealth already set the state down from its
           verdict (WIRING-42 §1 subscriber). */
        localizeAnswer(window.EnzoPagesBackend.buildUnavailableNotice(check59), lang).then(function(notice59){
          if(ctx.delivered) return;
          ctx.delivered=true;
          hideTyping(); finishTasks(true); setCentreEnzo('error');
          try{ if(window.__enzoLifecycle) window.__enzoLifecycle.failTask(myRun, 'backend-unreachable'); }catch(e){}
          var msg59=aiMsgShell(ctx, notice59, {html:mdToHtml(notice59), error:true, sources:[], modeWhy:'Live research unavailable — the research backend could not be reached, so no research was run'});
          chat.messages.push(msg59); saveChats();
          if(activeChat()===chat) renderMessages();
          setGenerating(false);
          (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg59, answersMode()) : maybeSpeak(msg59));
        });
        return;
      }
      backendGate59.ok=true;
      runBackendAsk59();
    });
  }
}

/* ---------------- restore a chat's backend state on switch ---------------- */
function defaultCtx(chat, task){
  return {chat:chat, text:task.title||'', lang:detectLang(task.title||''), viaVoice:(window.EnaoV54Voice ? window.EnaoV54Voice.viaVoiceFromChat(chat) : false),
    route:{deep:task.kind==='research', auto:true, label:(task.kind==='research'?'Deep Research':'Normal answer')+' — ENZO platform backend'},
    steps:task.kind==='research'?DEEP_STEPS:NORM_STEPS, myRun:searchRunId, files:[], delivered:false};
}
function restoreBackendForChat(chat){
  if(!chat || v2Up===false) return;
  ensureBackendChat(chat).then(function(bid){
    return EnzoPollLoop.dedupedFetch('/api/v2/chats/'+encodeURIComponent(bid)+'/tasks', {}, function(){ return v2get('/chats/'+bid+'/tasks', 15000); });
  }).then(function(j){
    var tasks=(j.tasks||[]).slice().sort(function(a,b){ return (b.created_at||0)-(a.created_at||0); });
    if(!tasks.length) return;
    var latest=tasks[0];
    if(activeChat()!==chat) return;
    /* v58 stale-state guard: stored task state goes through purgeStaleState; a terminal stored task never restores as searching (only the completed-delivery case below may still deliver its finished answer). */
    try{ if(window.EnzoSearchLifecycle){ var pg58=window.EnzoSearchLifecycle.purgeStaleState({taskId:latest.task_id, state:(latest.state==='partially_completed'?'completed':latest.state)}); window.__enzoLastPurge=pg58; if(pg58.purged.indexOf(String(latest.task_id))!==-1 && latest.state!=='completed') return; } }catch(e){}
    if(latest.state==='running' || latest.state==='paused'){
      chat.backendTaskId=latest.task_id; saveChats();
      if(!currentPoll || currentPoll.taskId!==latest.task_id){
        var ctx=v2ctxByChat[chat.id]||defaultCtx(chat, latest);
        ctx.chat=chat;
        v2ctxByChat[chat.id]=ctx;
        setGenerating(true); showTyping(); setCentreEnzo('researching');
        startPoll(chat, latest.task_id, ctx, null);
      }
    } else if(latest.state==='completed' && chat.backendTaskId===latest.task_id && chat.lastTaskId!==latest.task_id){
      var ctx2=v2ctxByChat[chat.id]||defaultCtx(chat, latest);
      ctx2.chat=chat;
      v2get('/tasks/'+latest.task_id, 20000).then(function(jj){
        var r=(jj.task&&jj.task.result)||{};
        var ans=r.answer||r.report||'';
        if(!ans) { chat.lastTaskId=latest.task_id; saveChats(); return; }
        return fetchTaskSources(latest.task_id).then(function(srcs){ return deliverAnswer(ctx2, ans, srcs, latest.kind==='research'?'research':'normal', latest.task_id); });
      }).catch(function(){});
    }
  }).catch(function(){});
}

/* ---------------- universal self-expanding search ----------------
   For EVERY question, if the first search returns too little that is usable,
   the system itself derives keywords, synonyms and related terms and retries
   across all providers — several automatic attempts — before any failure is
   shown. The user is never asked for keywords. As a last resort, pages the
   background collector already fetched (real URLs, real dates) are used. */
function usableCount(list){ return (list||[]).filter(function(s){ return (s.extract||'').length>60 || (s.snippet||'').length>120; }).length; }
var origSearchWeb=window.searchWeb;
window.searchWeb=function(query, deep){
  return origSearchWeb(query, deep).then(function(all){
    if(!all || usableCount(all)>=2) return all;
    return expandSearch(query, deep, all);
  });
};
function expandSearch(query, deep, base){
  var analysis=analyzeQuestion(query);
  var kw=(analysis.keywords||[]).join(' ');
  var cands=[];
  var enQ=''; try{ enQ=romanToEnglish(query)||''; }catch(e){}
  if(enQ && enQ.toLowerCase()!==(query||'').toLowerCase()) cands.push(enQ);
  if(kw && kw.toLowerCase()!==(query||'').toLowerCase()) cands.push(kw);
  if(analysis.type==='definition' && kw){ cands.push(kw+' definition'); cands.push(kw+' wikipedia'); if(analysis.keywords[0]) cands.push(analysis.keywords[0]); }
  if(kw) cands.push(kw+' explained');
  var seen={}, uniq=[];
  cands.forEach(function(c){ c=(c||'').trim(); if(c && !seen[c.toLowerCase()]){ seen[c.toLowerCase()]=1; uniq.push(c); } });
  var merged=base||[];
  var chain=Promise.resolve();
  uniq.slice(0,4).forEach(function(q){
    chain=chain.then(function(){
      if(usableCount(merged)>=3) return null;
      return origSearchWeb(q, deep).then(function(more){
        if(more && more.length) merged=mergeSources([merged, more], deep?18:10);
      }).catch(function(){});
    });
  });
  return chain.then(function(){
    if(usableCount(merged)<2){
      var bg=bgMatchSources(query);
      if(bg.length) merged=mergeSources([merged, bg], deep?18:10);
    }
    merged.liveCount=merged.length;
    merged.failKind= usableCount(merged)>=2 ? 'none' : (merged.length?'empty':((base&&base.failKind)||'empty'));
    return merged;
  });
}

/* ---------------- background knowledge collection ----------------
   While the site is open and online, ENZO quietly refreshes a small store of
   real pages: today's trending news plus updates on topics the user asked
   about before. Every item keeps its real source URL and publication date.
   Light by design: a few queries, only while idle, never while generating. */
var BG_KEY='enao_bgknowledge_v1';
function bgEnabled(){ return loadPref('enao_bgcollect','1')==='1'; }
function bgStore(){ try{ var j=JSON.parse(localStorage.getItem(BG_KEY)||'[]'); return Array.isArray(j)?j:[]; }catch(e){ return []; } }
function bgSave(items){ try{ localStorage.setItem(BG_KEY, JSON.stringify(items.slice(0,60))); }catch(e){} }
function bgMatchSources(query){
  var items=bgStore(); if(!items.length) return [];
  var terms=relevanceTerms(query);
  return items.filter(function(it){ return matchedCount(terms, it)>=1; }).slice(0,4)
    .map(function(it){ return {title:it.title||'', url:it.url, pubDate:it.pubDate||'', snippet:it.snippet||'', extract:it.snippet||''}; });
}
function bgCollect(){
  if(!bgEnabled() || !navigator.onLine || document.hidden || state.isGenerating) return;
  var topics=['top news today','trending topics today'];
  learnedTopTopics(2).forEach(function(t){ topics.push(t+' latest'); });
  var items=bgStore(), seen={};
  items.forEach(function(i){ seen[i.url]=1; });
  var added=0, chain=Promise.resolve();
  topics.slice(0,3).forEach(function(q){
    chain=chain.then(function(){
      return searchOneQuery(q, 4, false).then(function(o){
        (o.results||[]).forEach(function(r){
          if(r.url && !seen[r.url]){ seen[r.url]=1; items.unshift({title:r.title||'', url:r.url, pubDate:r.pubDate||r.date||'', snippet:(r.snippet||r.extract||'').slice(0,300), topic:q, fetchedAt:Date.now()}); added++; }
        });
      }).catch(function(){});
    });
  });
  chain.then(function(){ if(added) bgSave(items); });
}
function bgInit(){
  setTimeout(bgCollect, 90000);
  setInterval(bgCollect, 20*60*1000);
}

/* ---------------- learning from the user ----------------
   Only from the user's own words in his own chats: his language mix, answer
   length preference, topics and corrections. Stored in this browser,
   applied silently to future replies, visible and deletable in Settings. */
var LEARN_KEY='enao_learned_v1';
function learnedLoad(){ try{ var j=JSON.parse(localStorage.getItem(LEARN_KEY)||'null'); if(j && j.langs) return j; }catch(e){} return {langs:{en:0,roman:0,urdu:0}, lengthPref:'', topics:{}, corrections:[]}; }
var learned=learnedLoad();
function learnedSave(){ try{ localStorage.setItem(LEARN_KEY, JSON.stringify(learned)); }catch(e){} }
function dominantLang(){ var best='', n=0; for(var k in learned.langs){ if(learned.langs[k]>n){ n=learned.langs[k]; best=k; } } return n>=3?best:''; }
function learnedTopTopics(n){ return Object.keys(learned.topics).sort(function(a,b){ return learned.topics[b]-learned.topics[a]; }).slice(0,n); }
function learnedPrefs(){ var p={language:dominantLang()||'auto', length:learned.lengthPref||'auto', topics:learnedTopTopics(5)}; try{ var ln=(typeof enzoLearningNoteBlocks==='function')?enzoLearningNoteBlocks():''; if(ln) p.learned_note=ln; }catch(e){} return p; }
function learnedNote(){
  var bits=[];
  var dom=dominantLang();
  if(dom) bits.push('preferred language: '+(dom==='roman'?'Roman Urdu':dom==='urdu'?'Urdu script':'English'));
  if(learned.lengthPref) bits.push('prefers '+learned.lengthPref+' answers');
  var tops=learnedTopTopics(6); if(tops.length) bits.push('interests: '+tops.join(', '));
  if(learned.corrections.length) bits.push('past corrections from the user (never repeat these mistakes): '+learned.corrections.slice(0,3).map(function(c){ return '"'+c.text+'"'; }).join('; '));
  /* v62-learning: taught items + active corrections (pieces 41/44) reach every legacy prompt too. */
  try{ var lb=(typeof enzoLearningNoteBlocks==='function')?enzoLearningNoteBlocks():''; if(lb) bits.push(lb); }catch(e){}
  if(!bits.length) return '';
  return '\n\n[Learned from this user across all chats — apply silently: '+bits.join('. ')+'.]';
}
function captureLearned(text, lang){
  if(!text) return;
  learned.langs[lang]=(learned.langs[lang]||0)+1;
  var low=' '+String(text).toLowerCase()+' ';
  if(/\b(short|brief|mukhtasar)\b/.test(low) && /(answer|jawab|batao|explain|hamesha|always)/.test(low)) learned.lengthPref='short';
  if(/(in detail|detailed|tafseel)/.test(low) && /(answer|jawab|batao|explain|hamesha|always|chahiye)/.test(low)) learned.lengthPref='detailed';
  try{ analyzeQuestion(text).keywords.forEach(function(w){ w=String(w).toLowerCase(); if(w.length>3) learned.topics[w]=(learned.topics[w]||0)+1; }); }catch(e){}
  if(/^(no|nahi|nahin|wrong|galat|ghalat|not this|ye nahi|wo nahi)\b/i.test(String(text).trim()) || /(you misunderstood|samjhe nahi|mera matlab)/i.test(text)){
    learned.corrections.unshift({ts:Date.now(), text:String(text).slice(0,280)});
    learned.corrections=learned.corrections.slice(0,20);
  }
  var keys=Object.keys(learned.topics);
  if(keys.length>40){ var keep={}; learnedTopTopics(40).forEach(function(k){ keep[k]=learned.topics[k]; }); learned.topics=keep; }
  learnedSave();
}
function renderLearned(){
  var box=$('learnedBody'); if(!box) return;
  var dom=dominantLang();
  var total=(learned.langs.en||0)+(learned.langs.roman||0)+(learned.langs.urdu||0);
  var h='';
  h+='<div class="lrn-row"><span>Language you usually write in</span><b>'+(dom?(dom==='roman'?'Roman Urdu':dom==='urdu'?'Urdu script':'English')+' ('+total+' messages counted)':'Not enough messages yet')+'</b></div>';
  h+='<div class="lrn-row"><span>Answer length you prefer</span><b>'+(learned.lengthPref?learned.lengthPref:'No preference learned yet')+'</b>'+(learned.lengthPref?'<button type="button" class="lrn-x" data-lrn="len">Delete</button>':'')+'</div>';
  var tops=learnedTopTopics(8);
  h+='<div class="lrn-row"><span>Topics you ask about</span><b>'+(tops.length?tops.map(function(t){ return escH(t)+' <button type="button" class="lrn-x" data-lrn="topic" data-v="'+escH(t)+'">x</button>'; }).join(' &middot; '):'None learned yet')+'</b></div>';
  if(learned.corrections.length){
    h+='<div class="lrn-row"><span>Corrections ENZO remembers</span></div>';
    learned.corrections.slice(0,6).forEach(function(c, i){
      h+='<div class="lrn-corr"><span>'+escH(c.text)+'</span><button type="button" class="lrn-x" data-lrn="corr" data-v="'+i+'">Delete</button></div>';
    });
  } else {
    h+='<div class="lrn-row"><span>Corrections ENZO remembers</span><b>None yet</b></div>';
  }
  h+='<button type="button" class="lrn-clear" id="learnedClear">Delete everything ENZO has learned</button>';
  box.innerHTML=h;
  box.querySelectorAll('[data-lrn]').forEach(function(b){
    b.onclick=function(){
      var kind=b.getAttribute('data-lrn'), v=b.getAttribute('data-v');
      if(kind==='len') learned.lengthPref='';
      if(kind==='topic') delete learned.topics[v];
      if(kind==='corr') learned.corrections.splice(parseInt(v,10),1);
      learnedSave(); renderLearned(); toast('Deleted from what ENZO has learned');
    };
  });
  var clr=$('learnedClear');
  if(clr) clr.onclick=function(){ learned={langs:{en:0,roman:0,urdu:0}, lengthPref:'', topics:{}, corrections:[]}; learnedSave(); renderLearned(); toast('Everything ENZO learned has been deleted'); };
  /* v62-learning: explicit learned items (pieces 41/43) under the existing rows. */
  try{
    if(window.EnzoSettingsLearned && window.EnzoTeaching && typeof document!=='undefined'){
      var lrnBox=document.createElement('div'); lrnBox.id='learnedItemsBox';
      box.appendChild(lrnBox);
      var lrnStore=EnzoTeaching.createLearnedStore();
      /* Adapter: piece 44 stores a correction's detail as {wrong,right};
         piece 43 renders detail as a string, so it gets the wrong part. */
      var lrnAdapter={ getItems:function(){ return lrnStore.getItems().map(function(it){ var d=it.detail; if(d && typeof d==='object'){ var c={}; for(var k in it) c[k]=it[k]; c.detail=d.wrong||''; return c; } return it; }); }, deleteItem:function(id){ return lrnStore.deleteItem(id); }, clearAll:function(){ return lrnStore.clearAll(); } };
      EnzoSettingsLearned.renderLearnedItems(lrnBox, lrnAdapter, { onItemsChanged:function(){ try{ renderLearned(); }catch(e){} } });
    }
  }catch(e){}
}

/* ---------------- reminders ----------------
   ENZO sets reminders itself from the user's words (any language), stores
   them in this browser, and fires them while the site is open: a visible
   alert plus the reminder spoken aloud. Ones that came due while the site
   was closed are shown honestly as missed, with a way to act on them now. */
var REM_KEY='enao_reminders_v1';
function remLoad(){ try{ var j=JSON.parse(localStorage.getItem(REM_KEY)||'[]'); return Array.isArray(j)?j:[]; }catch(e){ return []; } }
function remSave(){ try{ localStorage.setItem(REM_KEY, JSON.stringify(reminders)); }catch(e){} }
var reminders=remLoad();
var REM_T={
  confirm:{en:function(t,w){ return 'Done — I will remind you about "'+t+'" on '+w+'. It will appear here and be spoken aloud.'; },
           roman:function(t,w){ return 'Ho gaya — main aap ko "'+t+'" ke baare mein '+w+' par yaad dila dunga. Reminder yahan bhi dikhega aur bol kar bhi sunaya jayega.'; },
           urdu:function(t,w){ return 'ہو گیا — میں آپ کو "'+t+'" کے بارے میں '+w+' پر یاد دلا دوں گا۔ ریمائنڈر یہاں بھی دکھے گا اور بول کر بھی سنایا جائے گا۔'; }},
  askTime:{en:function(t){ return 'Sure — what time should I remind you'+(t?' about "'+t+'"':'')+'? For example: "in 30 minutes" or "tomorrow at 9 am".'; },
           roman:function(t){ return 'Zaroor — kis waqt yaad dilana hai'+(t?' "'+t+'" ke baare mein':'')+'? Misal: "30 minute baad" ya "kal 9 baje".'; },
           urdu:function(t){ return 'ضرور — کس وقت یاد دلانا ہے'+(t?' "'+t+'" کے بارے میں':'')+'؟ مثال: "30 منٹ بعد" یا "کل صبح 9 بجے"۔'; }},
  askThing:{en:function(){ return 'Sure — what should I remind you about, and at what time?'; },
            roman:function(){ return 'Zaroor — kis cheez ke baare mein yaad dilana hai, aur kis waqt?'; },
            urdu:function(){ return 'ضرور — کس چیز کے بارے میں یاد دلانا ہے، اور کس وقت؟'; }},
  fired:{en:function(t){ return 'Reminder: '+t; }, roman:function(t){ return 'Yaad dehani: '+t; }, urdu:function(t){ return 'یاد دہانی: '+t; }},
  unclear:{en:function(){ return 'I could not understand that time, so no reminder was set. Please tell me the reminder and the time together, for example: "Remind me to call Ahmed in 2 hours".'; },
           roman:function(){ return 'Mujhe wo waqt samajh nahi aaya, is liye reminder set nahi hua. Meherbani karke reminder aur waqt aik saath batayein, misal: "Mujhe 2 ghante baad Ahmed ko call karna yaad dilana".'; },
           urdu:function(){ return 'مجھے وہ وقت سمجھ نہیں آیا، اس لیے ریمائنڈر سیٹ نہیں ہوا۔ مہربانی کرکے ریمائنڈر اور وقت ایک ساتھ بتائیں، مثال: "مجھے 2 گھنٹے بعد احمد کو کال کرنا یاد دلانا"۔'; }}
};
function remT(kind, lang){ var g=REM_T[kind]; return (g&&(g[lang]||g.en))||REM_T[kind].en; }
function normDigits(s){ return String(s||'').replace(/[۰-۹]/g, function(c){ return '۰۱۲۳۴۵۶۷۸۹'.indexOf(c); }).replace(/[٠-٩]/g, function(c){ return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }); }
function parseTimeExpr(raw){
  var low=' '+normDigits(raw).toLowerCase()+' ';
  var now=new Date(), m;
  m=low.match(/\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/)
    || low.match(/(\d+)\s*(minutes?|mins?|ghante|ghanta|hours?|hrs?|din|days?|weeks?|hafta|hafte)\s*(baad|bad|after)\b/)
    || low.match(/\bafter\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\b/)
    || low.match(/(\d+)\s*(منٹ|گھنٹے|گھنٹہ|دن|ہفتے)\s*بعد/);
  if(m){
    var n=parseInt(m[1],10), unit=m[2]||'';
    var mult=/hour|hrs|ghant|گھنٹ/.test(unit)?3600000 : /day|din|دن/.test(unit)?86400000 : /week|haft|ہفت/.test(unit)?604800000 : 60000;
    return {due: now.getTime()+n*mult, span:m[0]};
  }
  var tomorrow=/\btomorrow\b|کل/.test(low);
  m=low.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || low.match(/(\d{1,2})(?::(\d{2}))?\s*(baje|بجے)/) || low.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if(m){
    var h=parseInt(m[1],10)%12; if(/pm/.test(m[3]||'')) h+=12;
    var min=m[2]?parseInt(m[2],10):0;
    var d=new Date(now); d.setHours(h,min,0,0);
    if(tomorrow || d.getTime()<=now.getTime()) d.setDate(d.getDate()+1);
    return {due:d.getTime(), span:m[0]};
  }
  return null;
}
function cleanThing(text, span){
  var t=' '+String(text)+' ';
  t=t.replace(/remind me( to| about)?/gi,' ').replace(/set (a )?reminder( for)?/gi,' ').replace(/a reminder( to| about)?/gi,' ')
     .replace(/yaad (dilana|karana|krna|karna)( hai)?/gi,' ').replace(/یاد (دلانا|کرانا)/g,' ')
     .replace(/\bmujhe\b/gi,' ').replace(/\bplease\b/gi,' ');
  if(span) t=t.split(span).join(' ');
  t=t.replace(/\s+/g,' ').replace(/^[\s,.\-—:]+|[\s,.\-—:]+$/g,'').trim();
  t=t.replace(/^(to|about|ke baare mein|کے بارے میں)\s+/i,'').trim();
  return t.slice(0,140);
}
function parseReminder(text){
  var hasVerb=/(\bremind me\b|\breminder\b|yaad dilana|yaad karana|yaad krna|yaad karna|یاد دلانا|یاد کرانا|یاد دہانی)/i.test(text)
    || (/\b(batana|bata dena)\b|بتانا/i.test(text) && !!parseTimeExpr(text));
  if(!hasVerb) return null;
  var t=parseTimeExpr(text);
  var thing=cleanThing(text, t?t.span:null);
  if(!t) return {needsTime:true, thing:thing};
  if(!thing || thing.length<2) return {needsThing:true, due:t.due};
  return {due:t.due, thing:thing};
}
function remWhen(ts){ var d=new Date(ts); return fmtShortDate(d)+' at '+fmtTime(d); }
function setReminder(thing, due, chatId, lang){
  reminders.push({id:uid(), text:thing, due:due, created:Date.now(), chatId:chatId||'', lang:lang||'en', state:'pending'});
  remSave(); renderReminders();
}
function speakReminder(rem){
  var line=remT('fired', rem.lang)(rem.text);
  var tries=0;
  (function attempt(){
    if(!state.isSpeaking || tries>12){ speakText(line, rem.lang); return; }
    tries++; setTimeout(attempt, 4000);
  })();
}
function showReminderAlert(rem, missed){
  var card=$('remAlert'); if(!card) return;
  $('remAlertTitle').textContent= missed ? 'Missed reminder' : 'Reminder';
  $('remAlertText').textContent=rem.text;
  $('remAlertWhen').textContent=(missed?'Was due ':'Due ')+remWhen(rem.due)+(missed?' — the site was closed when this reminder came due.':'');
  card.hidden=false;
  var done=$('remAlertDone'), snooze=$('remAlertSnooze'), hear=$('remAlertHear');
  hear.hidden=!missed;
  hear.onclick=function(){ speakReminder(rem); };
  done.onclick=function(){ rem.state='done'; remSave(); card.hidden=true; renderReminders(); };
  snooze.onclick=function(){ rem.state='pending'; rem.due=Date.now()+10*60000; remSave(); card.hidden=true; renderReminders(); toast('Reminder moved 10 minutes ahead'); };
}
function fireReminder(rem){
  rem.state='fired'; remSave(); renderReminders();
  showReminderAlert(rem, false);
  speakReminder(rem);
}
function renderReminders(){
  var box=$('remindersBox'), list=$('remindersList');
  if(!box || !list) return;
  var pend=reminders.filter(function(r){ return r.state==='pending'||r.state==='missed'||r.state==='fired'; })
    .sort(function(a,b){ return a.due-b.due; });
  if(!pend.length){ box.hidden=true; return; }
  box.hidden=false;
  list.innerHTML=pend.map(function(r){
    var tag= r.state==='missed' ? '<span class="rem-missed">Missed — the site was closed when this came due</span>'
      : r.state==='fired' ? '<span class="rem-missed">Shown just now</span>' : '';
    var act= r.state==='missed' ? '<button type="button" class="enzo-tbtn" data-remact="now" data-id="'+r.id+'">Act on it now</button>' : '';
    return '<div class="rem-item"><div class="rem-txt"><b>'+escH(r.text)+'</b><span>'+escH(remWhen(r.due))+'</span>'+tag+'</div>'
      +act+'<button type="button" class="enzo-tbtn" data-remact="cancel" data-id="'+r.id+'">'+(r.state==='pending'?'Cancel':'Dismiss')+'</button></div>';
  }).join('');
  list.querySelectorAll('[data-remact]').forEach(function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-id'), act=b.getAttribute('data-remact');
      for(var i=0;i<reminders.length;i++){
        if(reminders[i].id===id){
          if(act==='cancel'){ reminders.splice(i,1); }
          else if(act==='now'){ speakReminder(reminders[i]); reminders[i].state='done'; }
          break;
        }
      }
      remSave(); renderReminders();
    };
  });
}
function buildReminderPanel(){
  var panel=$('enzoPanel'); if(!panel || $('remindersBox')) return;
  var sec=document.createElement('section');
  sec.className='enzo-task'; sec.id='remindersBox'; sec.hidden=true;
  sec.setAttribute('aria-label','Your reminders');
  sec.innerHTML='<div class="enzo-task-kicker">Reminders</div><div id="remindersList"></div>'
    +'<p class="rem-note">Reminders fire while this site is open. If the site is closed when one comes due, it is shown as missed when you return.</p>';
  var taskSec=$('enzoTask');
  if(taskSec && taskSec.parentNode===panel) panel.insertBefore(sec, taskSec.nextSibling); else panel.appendChild(sec);
  var alert=document.createElement('div');
  alert.id='remAlert'; alert.hidden=true; alert.setAttribute('role','alert');
  alert.innerHTML='<div class="rem-alert-k" id="remAlertTitle">Reminder</div><div class="rem-alert-t" id="remAlertText"></div><div class="rem-alert-w" id="remAlertWhen"></div>'
    +'<div class="rem-alert-btns"><button type="button" class="enzo-tbtn" id="remAlertHear">Hear it now</button><button type="button" class="enzo-tbtn" id="remAlertSnooze">Remind again in 10 minutes</button><button type="button" class="enzo-tbtn danger" id="remAlertDone">Done</button></div>';
  document.body.appendChild(alert);
}
function reminderEngineStart(){
  var now=Date.now(), missedAny=false;
  reminders.forEach(function(r){
    if(r.state==='pending' && r.due<now-30000){ r.state='missed'; missedAny=true; }
  });
  if(missedAny) remSave();
  renderReminders();
  var firstMissed=reminders.filter(function(r){ return r.state==='missed'; })[0];
  if(firstMissed) showReminderAlert(firstMissed, true);
  setInterval(function(){
    var n=Date.now();
    reminders.slice().forEach(function(r){
      if(r.state==='pending' && r.due<=n) fireReminder(r);
    });
  }, 15000);
}
function remReplyAi(chat, ctx, plain){
  var msg=aiMsgShell(ctx, plain, {html:mdToHtml(plain), followups:[]});
  chat.messages.push(msg); saveChats(); renderMessages(); (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
}
function tryHandleReminder(text, viaVoice){
  var chat=activeChat();
  var lang=detectLang(text||'');
  var ctx={chat:chat, text:text, lang:lang, viaVoice:!!viaVoice, route:{deep:false, auto:false, label:'Reminder'}, delivered:false};
  if(chat && chat.pendingReminder){
    var pr=chat.pendingReminder;
    if(pr.awaitFull){
      var full=parseReminder(text);
      if(full && full.due && full.thing){ chat.pendingReminder=null; pushUserMsg(chat, text, lang, viaVoice, []); setReminder(full.thing, full.due, chat.id, lang); remReplyAi(chat, ctx, remT('confirm', lang)(full.thing, remWhen(full.due))); saveChats(); return true; }
      if(full && full.needsTime){ chat.pendingReminder={thing:full.thing, lang:lang, tries:0}; pushUserMsg(chat, text, lang, viaVoice, []); remReplyAi(chat, ctx, remT('askTime', lang)(full.thing)); saveChats(); return true; }
      chat.pendingReminder=null; pushUserMsg(chat, text, lang, viaVoice, []); remReplyAi(chat, ctx, remT('unclear', lang)()); saveChats(); return true;
    }
    var t=parseTimeExpr(text);
    if(t){
      chat.pendingReminder=null;
      pushUserMsg(chat, text, lang, viaVoice, []);
      setReminder(pr.thing, t.due, chat.id, pr.lang||lang);
      remReplyAi(chat, ctx, remT('confirm', pr.lang||lang)(pr.thing, remWhen(t.due)));
      saveChats(); return true;
    }
    var full2=parseReminder(text);
    if(full2 && full2.due && full2.thing){
      chat.pendingReminder=null;
      pushUserMsg(chat, text, lang, viaVoice, []);
      setReminder(full2.thing, full2.due, chat.id, lang);
      remReplyAi(chat, ctx, remT('confirm', lang)(full2.thing, remWhen(full2.due)));
      saveChats(); return true;
    }
    pr.tries=(pr.tries||0)+1;
    pushUserMsg(chat, text, lang, viaVoice, []);
    if(pr.tries>1){ chat.pendingReminder=null; remReplyAi(chat, ctx, remT('unclear', pr.lang||lang)()); }
    else remReplyAi(chat, ctx, remT('askTime', pr.lang||lang)(pr.thing));
    saveChats(); return true;
  }
  var r=parseReminder(text||'');
  if(!r) return false;
  if(!chat){ chat=createChat((text||'Reminder').slice(0,42)); ctx.chat=chat; }
  pushUserMsg(chat, text, lang, viaVoice, []);
  renderChatList();
  if(r.needsThing){
    chat.pendingReminder={awaitFull:true, lang:lang, tries:0};
    remReplyAi(chat, ctx, remT('askThing', lang)());
  } else if(r.needsTime){
    chat.pendingReminder={thing:r.thing, lang:lang, tries:0};
    remReplyAi(chat, ctx, remT('askTime', lang)(r.thing));
  } else {
    setReminder(r.thing, r.due, chat.id, lang);
    remReplyAi(chat, ctx, remT('confirm', lang)(r.thing, remWhen(r.due)));
  }
  saveChats();
  return true;
}
window.__remindersTry=tryHandleReminder;

/* ---------------- settings extras: learned view + background collection toggle ---------------- */
function buildSettingsExtras(){
  var card=document.querySelector('#settingsModal .modal-card');
  if(!card || $('learnedBox')) return;
  var box=document.createElement('div');
  box.id='learnedBox'; box.className='learned-box';
  box.innerHTML='<h4>What ENZO knows about me</h4><p class="lrn-note">Learned only from your own words in your own chats, stored only in this browser. Delete anything, any time.</p><div id="learnedBody"></div>';
  card.appendChild(box);
  var bg=document.createElement('div');
  bg.className='setrow';
  bg.innerHTML='<div class="sr-txt"><b>Background knowledge collection</b><span>While this site is open and online, ENZO quietly refreshes trending news and updates on topics you asked about before — real pages with their real source and date, ready before you ask. Light and free; it never slows your own questions. When off, nothing is collected.</span></div>';
  var btn=document.createElement('button');
  btn.type='button'; btn.className='lrn-toggle'; btn.id='bgCollectBtn';
  function syncBtn(){ btn.textContent=bgEnabled()?'On':'Off'; btn.setAttribute('aria-pressed', bgEnabled()?'true':'false'); }
  btn.onclick=function(){ savePref('enao_bgcollect', bgEnabled()?'0':'1'); syncBtn(); toast('Background knowledge collection is now '+(bgEnabled()?'on':'off')); };
  syncBtn();
  bg.appendChild(btn);
  card.appendChild(bg);
  renderLearned();
}
if(typeof window.refreshSettingsUI==='function'){
  var origRefreshSettings=window.refreshSettingsUI;
  window.refreshSettingsUI=function(){ var r=origRefreshSettings.apply(this, arguments); renderLearned(); return r; };
}

/* ---------------- learned preferences flow into the legacy answer prompts ---------------- */
if(typeof window.answerWithSources==='function'){
  var origAWS=window.answerWithSources;
  window.answerWithSources=function(text, sources, lang, deep, historyText, steps){
    var note=learnedNote();
    if(note) historyText=(historyText||'')+note;
    return origAWS(text, sources, lang, deep, historyText, steps);
  };
}
if(typeof window.callAIKnowledge==='function'){
  var origCAIK=window.callAIKnowledge;
  window.callAIKnowledge=function(q, lang, deep, historyText){
    var note=learnedNote();
    if(note) historyText=(historyText||'')+note;
    return origCAIK(q, lang, deep, historyText);
  };
}

/* ---------------- Summarize tool: backend file summarize when a file is loaded ---------------- */
var toolsBackendChatId='';
function toolsBackendChat(){
  if(toolsBackendChatId) return Promise.resolve(toolsBackendChatId);
  var saved=loadPref('enao_tools_chat','');
  if(saved){ toolsBackendChatId=saved; return Promise.resolve(saved); }
  return v2post('/chats', {title:'ENZO Tools'}).then(function(j){
    toolsBackendChatId=j.chat_id||(j.chat&&j.chat.chat_id);
    savePref('enao_tools_chat', toolsBackendChatId);
    return toolsBackendChatId;
  });
}
if(typeof window.buildSummarizeTool==='function'){
  var origBST=window.buildSummarizeTool;
  window.buildSummarizeTool=function(body){
    origBST(body);
    var fi=$('tsFile'), run=$('tsRun');
    if(fi) fi.addEventListener('change', function(){
      var f=fi.files&&fi.files[0];
      if(!f || v2Up===false) return;
      toolsBackendChat().then(function(bid){
        var fd=new FormData(); fd.append('file', f, f.name);
        return v2upload('/chats/'+bid+'/files', fd);
      }).then(function(j){ window.__toolFileId=j.file_id||(j.file&&j.file.file_id); }).catch(function(){});
    });
    if(run){
      var origClick=run.onclick;
      run.onclick=function(){
        if(window.__toolFileId && v2Up!==false){
          var b=this; setBusy(b, true, 'Summarizing…'); toolLoading('Writing the summary through the platform backend…');
          toolsBackendChat().then(function(bid){ return v2post('/chats/'+bid+'/files/'+window.__toolFileId+'/summarize', {}, 45000); })
            .then(function(j){ setBusy(b, false); toolOutMd(j.summary||''); })
            .catch(function(){ setBusy(b, false); if(origClick) origClick.call(run); });
          return;
        }
        if(origClick) origClick.call(this);
      };
    }
  };
}

/* ---------------- main wraps ---------------- */
var origAskQuestion=window.askQuestion;
window.askQuestion=function(text, viaVoice, forcedDeep){
  captureLearned(text, detectLang(text||''));
  if(text && window.__remindersTry && window.__remindersTry(text, viaVoice)) return;
  if(text && !state.pendingFiles.length && typeof smallTalkReply==='function' && smallTalkReply(text, detectLang(text))) return origAskQuestion(text, viaVoice, forcedDeep);
  if(text && typeof parseMegaRequest==='function' && parseMegaRequest(text)) return origAskQuestion(text, viaVoice, forcedDeep);
  if(v2Up===false){
    /* Piece 43: a stale false flag never sends a new ask to legacy
       without a fresh check — the backend may have recovered, or may
       never have been down (see EVIDENCE-43.md). The small-talk /
       reminder / mega guards above have already run, so routing to
       backendAsk directly here is correct. The user message appears
       after the ~1s probe instead of instantly. */
    window.EnzoAskRecovery.probeBackend({ attempts: 2 }).then(function (probe) {
      if (probe.reachable) {
        /* Piece 42 already drove v2Up to true from the checkHealth
           verdict (WIRING-42 §1 subscriber); just clear the cached gate. */
        if (window.__enzoBackendGate59) window.__enzoBackendGate59.ok = true;
        backendAsk(text, viaVoice, forcedDeep);
      } else {
        /* checkHealth already set the state down; route to legacy. */
        origAskQuestion(text, viaVoice, forcedDeep);
      }
    });
    return;
  }
  backendAsk(text, viaVoice, forcedDeep);
};
var origStopGeneration=window.stopGeneration;
window.stopGeneration=function(){
  var t=window.__v2Task;
  if(t && (t.state==='running'||t.state==='paused')){
    var chat=activeChat();
    if(chat && t.chatId===chat.id){
      var g59sg=window.EnzoPollingFix?window.EnzoPollingFix.guardTaskId(t.taskId):{ok:true};
      var c59sg=!window.EnzoPollingFix || window.EnzoPollingFix.canSendControl(t.taskId, 'cancel');
      if(g59sg.ok && c59sg) v2post('/tasks/'+t.taskId+'/cancel', {}).catch(function(){});
      stopPoll();
      t.state='cancelled';
      updatePanelExtras();
    }
  }
  return origStopGeneration();
};
var origOpenChatById=window.openChatById;
window.openChatById=function(id){
  var r=origOpenChatById(id);
  restoreBackendForChat(activeChat());
  /* v53-monitor wiring: active chat changed — retarget the monitor. */
  try{ if(window.EnzoMonitor){ var _ac=activeChat(); var _bid59=(_ac && window.EnzoPollingFix)?window.EnzoPollingFix.resolveBackendId(_ac.id):null; if(_bid59){ EnzoMonitor.setChatId(_bid59); EnzoMonitor.start(); } } }catch(e){}
  return r;
};

/* ---------------- init ---------------- */
buildPanelExtras();
buildReminderPanel();
buildSettingsExtras();
window.EnzoBackendHealth.start(); /* immediate full verdict, then: re-probe every 15s while down, light probe every 60s while up */
window.EnzoBackendHealth.checkHealth().then(function(){ restoreBackendForChat(activeChat()); });
reminderEngineStart();
bgInit();
window.__v2={up:function(){ return v2Up; }, health:v2health};
})();

