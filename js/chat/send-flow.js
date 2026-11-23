/* ---------- SEND FLOW ---------- */
function setGenerating(on){
  state.isGenerating=on;
  var sb=$('sendBtn');
  sb.disabled=false;
  sb.classList.toggle('stopbtn', on);
  sb.classList.toggle('idle', !on && !$('input').value.trim() && !state.pendingFiles.length);
  $('sendIconUse').setAttribute('href', on?'#i-stop':'#i-sendw');
  sb.title=on?'Stop generating':'Send (Enter)';
  sb.setAttribute('aria-label', on?'Stop generating':'Send');
  if(!on) syncSendBtn();
  syncComposerSlot();
}
/* Send button states: disabled + faded while the box is empty, solid as soon as there is text or a file, Stop while generating */
function syncSendBtn(){
  var sb=$('sendBtn'); if(!sb) return;
  if(state.isGenerating){ sb.disabled=false; sb.classList.remove('idle'); syncComposerSlot(); return; }
  var ready=!!($('input').value.trim() || state.pendingFiles.length);
  sb.disabled=!ready;
  sb.classList.toggle('idle', !ready);
  sb.title=ready?'Send (Enter)':'Write a message or attach a file first';
  syncComposerSlot();
}
/* Composer right-end slot — exactly ONE control shows there at a time:
   while generating, Send (as Stop); during a live voice call, the Call
   button; while the box has text or files, Send; otherwise the Mic. */
function syncComposerSlot(){
  var mic=$('micBtn'), call=$('callBtn'), sb=$('sendBtn');
  if(!mic || !sb) return;
  var hasText=!!($('input').value.trim() || state.pendingFiles.length);
  var showSend = state.isGenerating || (!state.voiceLive && hasText);
  var showCall = !state.isGenerating && !!state.voiceLive;
  sb.style.display = showSend ? '' : 'none';
  if(call) call.style.display = showCall ? '' : 'none';
  mic.style.display = (!showSend && !showCall) ? '' : 'none';
}
function stopGeneration(){
  if(!state.isGenerating) return;
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.cancelTask(searchRunId, 'user-stop'); }catch(e){}
  state.stopRequested=true;
  if(searchInFlight){ try{ searchInFlight.abort(); }catch(e){} }
  if(state.streamTimer){ clearInterval(state.streamTimer); state.streamTimer=null; }
  hideTyping();
  markTasksCancelled();
  setGenerating(false);
  var c=activeChat();
  if(c && c.messages.length){
    var last=c.messages[c.messages.length-1];
    if(last.role==='ai' && !last.html){
      /* Preserve exactly the part that was completed — never the unshown remainder */
      if(last._partialPlain){ last.html=mdToHtml(last._partialPlain); last._fullHtml=last.html; }
      else if(last._fullHtml){ last.html=last._fullHtml; }
    }
  }
  renderMessages(); saveChats();
  setCentreEnzo('idle');
  if(state.voiceLive) setVoiceState('on');
  toast('Generation stopped');
}
function sendCurrent(){
  if(state.isGenerating){ stopGeneration(); return; }
  var text=$('input').value.trim();
  if(text.length>12000){ toast('That message is too long — please split it into parts (about 12,000 characters max). Your text is still in the box.'); return; }
  if(!text && !state.pendingFiles.length) return;
  var viaVoice=!!state.nextAskViaVoice;
  state.nextAskViaVoice=false;
  $('input').value=''; autoGrow(); syncSendBtn();
  try{ if(window.EnzoVoiceFix42) window.EnzoVoiceFix42.discardVoiceQueue(state); }catch(e){}
  try{ askQuestion(text, viaVoice); }
  catch(e){
    /* Sending failed before the question was even posted — put the typed text back, nothing is lost */
    $('input').value=text; autoGrow(); syncSendBtn();
    toast('Sending failed — your text is back in the box. Tap Send to try again.');
  }
}

function askQuestion(text, viaVoice, forcedDeep, opts){
  var askViaVoice=!!viaVoice;
  state.currentAskViaVoice=askViaVoice;
  state.stopRequested=false;
  var files=state.pendingFiles.slice(); state.pendingFiles=[]; renderAttachRow();
  if(!text && files.length) text='Please analyze the attached file'+(files.length>1?'s':'')+' and tell me the key points.';
  var chat=activeChat();
  if(!chat){ chat=createChat(text.slice(0,42)); }
  if(chat.messages.length===0) chat.title=text.slice(0,42);
  var lang = (window.EnzoLang45 ? window.EnzoLang45.askLang(text, state.langPref, detectLang) : detectLang(text));
  state.lastAnswerLang = lang;
  try{ if(window.EnzoVoiceFix42 && window.EnzoVoiceFix42.resetSayAgainLoop) window.EnzoVoiceFix42.resetSayAgainLoop(); }catch(e){}
  try{ if(typeof recognition!=='undefined' && recognition && state.voiceLive && window.EnzoLang46) recognition.lang = window.EnzoLang46.recognitionLangFor(lang); }catch(e){}
  /* Identity fast path (piece 31): a whole-message name question is
     answered locally as ENZO and never reaches the model. */
  if (typeof EnzoIdentity !== 'undefined' && EnzoIdentity.answerNameQuestion) {
    var nameReply = EnzoIdentity.answerNameQuestion(text, lang);
    if (nameReply) {
      state.usage++; $('usageText').textContent = state.usage;
      var nmTl = timeLabelFor(Date.now());
      var nmMsg = {role:'ai', html:mdToHtml(nameReply), plain:nameReply, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Instant reply — name question, answered as ENZO without a web search', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:nmTl.daypart, daypartRoman:nmTl.daypartRoman, timeLabel:nmTl.full};
      chat.messages.push(nmMsg); renderMessages(); saveChats();
      setCentreEnzo('success');
      setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(nmMsg, answersMode()) : maybeSpeak(nmMsg));
      return;
    }
  }
  /* v57-universal-intel: ONE central pipeline. Every input is funnelled
     through normalize -> context -> reasoning -> routing BEFORE any old
     gate answers it. Advisory only in v57: records chat.uniAnalysis;
     the old gates still produce the same replies. */
  var uniFun57=null, uniNorm57=null, uniCtx57=null, uniReason57=null, uniRoute57=null, uniTool57=null, uniKnow57=null, uniGen57=null;
  try{ if(window.EnzoUniversalMultimodal && typeof window.EnzoUniversalMultimodal.funnelInput==='function'){ uniFun57=window.EnzoUniversalMultimodal.funnelInput({kind:askViaVoice?'voice':'text', text:text, viaVoice:askViaVoice, lang:lang}, {chat:chat}); } }catch(e){}
  try{ if(window.EnzoUniversalInput && typeof window.EnzoUniversalInput.normalizeInput==='function'){ uniNorm57=window.EnzoUniversalInput.normalizeInput(text); } }catch(e){}
  try{ if(window.EnzoUniversalContext && typeof window.EnzoUniversalContext.createContextState==='function'){ uniCtx57=chat.uniCtx || (chat.uniCtx=window.EnzoUniversalContext.createContextState()); window.EnzoUniversalContext.updateContext(uniCtx57, {role:'user', text:text, lang:lang}); } }catch(e){}
  var intelEarly57 = chat.intelState || (chat.intelState = createIntelState());
  try{ if(window.EnzoUniversalReasoning && typeof window.EnzoUniversalReasoning.analyzeRequest==='function'){ uniReason57=window.EnzoUniversalReasoning.analyzeRequest(text, {state:intelEarly57, classifyIntent:(typeof classifyIntent==='function'?classifyIntent:null), history:chat.messages, context:uniCtx57}); } }catch(e){}
  try{ if(window.EnzoUniversalOrchestration && typeof window.EnzoUniversalOrchestration.route==='function'){ uniRoute57=window.EnzoUniversalOrchestration.route({analysis:uniReason57, text:text}, {analysis:uniReason57, history:chat.messages}); } }catch(e){}
  try{ if(window.EnzoUniversalTools && typeof window.EnzoUniversalTools.selectTool==='function'){ uniTool57=window.EnzoUniversalTools.selectTool({text:text, analysis:uniReason57}, {lang:lang}); } }catch(e){}
  try{ if(window.EnzoUniversalKnowledge && typeof window.EnzoUniversalKnowledge.classifyKnowledgeState==='function'){ uniKnow57=window.EnzoUniversalKnowledge.classifyKnowledgeState(text, {history:chat.messages}); } }catch(e){}
  try{ if(window.EnzoUniversalGeneration && typeof window.EnzoUniversalGeneration.detectOutputType==='function'){ uniGen57=window.EnzoUniversalGeneration.detectOutputType(text, {history:chat.messages}); } }catch(e){}
  try{ chat.uniAnalysis={funnel:uniFun57, normalized:uniNorm57, reason:uniReason57, route:uniRoute57, tool:uniTool57, knowledge:uniKnow57, outputType:uniGen57, at:Date.now()}; }catch(e){}
  var askNow=new Date(); var askTl=timeLabelFor(askNow.getTime());
  var fileCtx=files.map(function(f){ return f.text?('\n\n--- Attached file: '+f.name+' ---\n'+f.text.slice(0,6000)):'\n\n[Attached file: '+f.name+' ('+f.kind+') — no readable text could be extracted from it]'; }).join('');
  var userMsg={role:'user', text:text, lang:lang, viaVoice:askViaVoice, ts:askNow.getTime(), daypart:askTl.daypart, daypartRoman:askTl.daypartRoman, timeLabel:askTl.full, files:files.map(function(f){return {name:f.name, kind:f.kind, dataUrl:f.dataUrl||''};})};
  if(askViaVoice) userMsg.status='sent'; /* P48: a mic/call message is a SENT message. The double-tick foot is rendered for every role:'user' message by buildMessageEl (L9908); status:'sent' records it explicitly. Typed messages (viaVoice false) get no status key — unchanged. */
  if(opts && opts.alreadyPosted){
    /* P48: this text was already posted as a sent message by postMicSentMessage while ENZO was busy — do not push a duplicate; just clear the pending-answer mark on every posted-but-unanswered mic message. */
    var _pmFound=false;
    for(var _pi=chat.messages.length-1; _pi>=0; _pi--){ if(chat.messages[_pi].role==='user' && chat.messages[_pi].pendingAnswer){ delete chat.messages[_pi].pendingAnswer; _pmFound=true; } }
    if(!_pmFound) chat.messages.push(userMsg);
  } else {
    chat.messages.push(userMsg);
  }
  renderChatList(); renderMessages(true); saveChats();
  /* Greetings and small talk: instant friendly reply from ENZO's own
     knowledge — NO live search, NO Wikipedia, NO generating pipeline. Only
     real questions continue into the search/research flow below. */
  var stReply = files.length ? null : smallTalkReply(text, lang);
  if(stReply){
    state.usage++; $('usageText').textContent=state.usage;
    var stTl=timeLabelFor(Date.now());
    var stMsg={role:'ai', html:mdToHtml(stReply), plain:stReply, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Instant reply — greeting / small talk, answered without a web search', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:stTl.daypart, daypartRoman:stTl.daypartRoman, timeLabel:stTl.full};
    chat.messages.push(stMsg); renderMessages(); saveChats();
    setCentreEnzo('success');
    setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(stMsg, answersMode()) : maybeSpeak(stMsg));
    return;
  }
  var vrGate = (typeof classifyVoiceResearch === 'function') ? classifyVoiceResearch(text) : 'other';
  if (vrGate === 'conversation') {
    var vrReply = conversationReply(text, lang, { currentTask: (typeof currentTaskText === 'function' ? currentTaskText() : ''), isBusy: !!state.isGenerating });
    var vrTl = timeLabelFor(Date.now());
    var vrMsg = {role:'ai', html:mdToHtml(vrReply), plain:vrReply, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:"Voice conversation gate — answered directly from ENZO's own knowledge, no search", auto:false, followups:[], lang:lang, ts:Date.now(), daypart:vrTl.daypart, daypartRoman:vrTl.daypartRoman, timeLabel:vrTl.full};
    chat.messages.push(vrMsg); renderMessages(); saveChats();
    setCentreEnzo('success'); setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    if (window.EnaoV54Voice) window.EnaoV54Voice.patchDirectSpeak(vrMsg, answersMode()); else maybeSpeak(vrMsg);
    return;
  }
  /* v55-master-intel P1 (intent) + P2 (conversation) wiring: the local
     intent classifier runs FIRST, before any old routing path, and its
     decision is remembered per chat. Decided kinds never fall through
     to the old mode-question producers. */
  var intel = chat.intelState || (chat.intelState = createIntelState());
  var intent = classifyIntent(text, { state: intel });
  /* WHO-CREATED FIX: a "who created X" question takes its topic from
     the question text itself when history has no topic, and routes as
     a definition — never as a clarification. */
  if(intent.kind==='clarify' && /^\s*who\s+(created|made|invented|founded|discovered|built|developed)\s+\S/i.test(text)){
    intent = { kind:'definition', reason:'who-created-question', params:intent.params, clarifyQuestion:null };
  }
  updateIntelState(intel, text, intent);
  chat.intentKind = intent.kind; chat.lastIntent = intent;
  var cvCtx = { history: chat.messages, intelState: intel };
  var cvFollow = EnaoConversation.resolveFollowUp(text, cvCtx);
  var cvSearch = EnaoConversation.shouldSearch(cvFollow.resolvedText, cvCtx);
  var cvAnswer = EnaoConversation.buildAnswerContext(text, chat.messages);
  if(intent.kind==='clarify'){
    chat.pendingClarifyLocal={original:text, lang:lang, opts:[], intelClarify:true};
    saveChats();
    var iTl=timeLabelFor(Date.now());
    var iMsg={role:'ai', html:mdToHtml(intent.clarifyQuestion), plain:intent.clarifyQuestion, viaVoice:askViaVoice, question:text, sources:[], deep:false, clarify:true, modeWhy:'Intent classifier: one clarifying question (genuinely ambiguous)', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:iTl.daypart, daypartRoman:iTl.daypartRoman, timeLabel:iTl.full};
    chat.messages.push(iMsg); renderMessages(); saveChats();
    setCentreEnzo('idle');
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(iMsg, answersMode()) : maybeSpeak(iMsg));
    return;
  }
  if(cvFollow.alreadyAnswered){
    /* P2: never run the search pipeline for a repeat — point back. */
    var aLine = lang==='urdu' ? 'یہ سوال اسی چیٹ میں اوپر جواب دیا جا چکا ہے — جواب اوپر موجود ہے۔' : (lang==='roman' ? 'Ye sawal is chat mein upar jawab diya ja chuka hai — jawab upar maujood hai.' : 'I already answered that above in this chat — the answer is just above.');
    var aTl=timeLabelFor(Date.now());
    var aMsg={role:'ai', html:mdToHtml(aLine), plain:aLine, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Already answered above in this chat — pointing back instead of repeating the answer', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:aTl.daypart, daypartRoman:aTl.daypartRoman, timeLabel:aTl.full};
    chat.messages.push(aMsg); renderMessages(); saveChats();
    setCentreEnzo('success');
    setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(aMsg, answersMode()) : maybeSpeak(aMsg));
    return;
  }
  var cvShort = EnaoConversation.shortAnswer(text, lang);
  if(cvShort){
    var sTl=timeLabelFor(Date.now());
    var sMsg={role:'ai', html:mdToHtml(cvShort), plain:cvShort, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Conversation short answer (ENZO itself)', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:sTl.daypart, daypartRoman:sTl.daypartRoman, timeLabel:sTl.full};
    chat.messages.push(sMsg); renderMessages(); saveChats();
    setCentreEnzo('success');
    setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(sMsg, answersMode()) : maybeSpeak(sMsg));
    return;
  }
  /* P2 topic change: when cvFollow.isTopicChange is true the old
     research context is dropped for the new topic (no previous Deep
     sources or monitor task are reused for this question);
     conversational memory — chat.messages — stays whole. */
  /* v53-monitor wiring: a real question was sent (greetings/small talk returned
     above, so the monitor stays silent for them). This legacy pipeline answers
     through the /api/search proxy, so that fallback is noted exactly. */
  try{ if(window.EnzoMonitor){ EnzoMonitor.setChatId(chat.id); EnzoMonitor.start(); EnzoMonitor.noteFrontendStep({title:'Question sent', detail:'Question sent to ENZO for research.'}); EnzoMonitor.noteFrontendStep({title:'Fallback search proxy in use \u2014 live backend events unavailable', detail:'Fallback search proxy in use \u2014 live backend events unavailable'}); } }catch(e){}
  setGenerating(true);
  var myRun=beginSearchRun();
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.startTask(myRun, {logicalKey: text}); if(searchInFlight) window.__enzoLifecycle.registerAbort(myRun, searchInFlight); window.__enzoLifecycle.registerSubOp(myRun, 'searchWeb-retry', function(){ if(searchInFlight){ try{ searchInFlight.abort(); }catch(e){} } }); }catch(e){}
  if(state.voiceLive && !state.isSpeaking) setVoiceState('processing');
  state.usage++; $('usageText').textContent=state.usage;
  var searchText=cvAnswer.resolvedQuestion+fileCtx;

  /* Routing: Retry / Regenerate (forcedDeep) re-runs in the mode the question
     was originally asked in. Otherwise a per-chat override decides when one
     is set (ON stays Deep, OFF stays Normal); in the default Auto mode
     detectIntent() routes THIS question on its own signals, so a short
     factual follow-up goes Normal even right after a Deep answer in the
     same chat. The decision and its real reason are shown in the live task
     checklist while the answer is generated and saved on the answer. */
  var route;
  if(typeof forcedDeep==='boolean'){
    route={deep:forcedDeep, auto:false, label:(forcedDeep?'Deep Research':'Normal answer')+' (same mode as the original question)'};
  } else if(intent.kind==='research'){
    /* v55 P1: explicit investigation order — Deep, with the extracted
       parameters (stored params merged by the classifier, so a stored
       source count is not lost). The isExplicitResearchRequest and
       v54-gate research overrides that used to sit here are REMOVED:
       the intent classifier is the only research gate now. */
    route={deep:true, auto:true, label:'Deep Research (intent classifier: explicit investigation order)', intentParams:intent.params};
  } else if(intent.kind==='definition' || intent.kind==='conversation' || intent.kind==='general'){
    /* v55 P1+P2: decided non-research kinds answer directly (Normal).
       The isGuftagu override that used to sit here is REMOVED. P2's
       search gate is a one-way force only: it may raise this route to
       Deep, it never lowers a Deep decision. */
    route={deep:false, auto:true, label:'Normal answer (intent classifier: '+intent.reason+')'};
    if(cvSearch.search) route={deep:true, auto:true, label:'Deep Research ('+cvSearch.reason+')'};
  } else {
    var cm=chatMode(chat);
    if(cm==='deep') route={deep:true, auto:false, label:'Deep Research (turned on for this chat)'};
    else if(cm==='normal') route={deep:false, auto:false, label:'Normal answer (Deep Research off for this chat)'};
    else { var det=detectIntent(text);
      route={deep:det.deep, auto:true, label:(det.deep?'Deep Research':'Normal answer')+' (auto-detected: '+det.reason+')'}; }
  }
  var deep=route.deep;
  var steps = deep
    ? ['Understanding your question deeply…','Searching in batches across the whole internet…','Reading and verifying the websites…','Preparing your detailed report…']
    : ['Understanding your question deeply…','Searching live in several ways…','Reading the best sources…','Preparing your complete answer…'];
  setProgress(steps,1,deep);
  pcTask.decision=route.label; renderTaskList();
  showTyping();
  setCentreEnzo(deep?'researching':'thinking');
  try{ if(window.__enzoLifecycle) if(deep) window.__enzoLifecycle.setState(myRun, 'researching'); }catch(e){}

  var historyText = cvAnswer.contextSummary || '(No previous conversation — this is the first message, asked now at '+askTl.full+'.)';
  if(fileCtx) historyText+='\n\n[The user attached file content with this question — use it as the main material for the answer:]'+fileCtx.slice(0,6000);

  // Mega Deep Research: a quantity request (e.g. "1,000 YouTube channels on X") runs batch-wise with no quantity cap
  var mega=parseMegaRequest(text);
  if(mega){ megaSearchFlow(text, mega, chat, lang, historyText); return; }

  if(intent.kind==='definition'){
    /* v55 P1: definitions are answered directly from knowledge — do
       NOT call searchWeb() first for a definition. */
    setTypingStatus('Writing…');
    callAIKnowledge(cvAnswer.resolvedQuestion, lang, false, historyText).then(function(kText){
      if(myRun!==searchRunId || state.stopRequested) return;
      hideTyping();
      kText=finishAtSentence(scrubResearchClaims(scrubQuestionEcho(kText, text)));
      var dTl=timeLabelFor(Date.now());
      var dFups=makeFollowups(text, lang); var dCf=EnaoConversation.suggestFollowUp(text, cvCtx); if(dCf) dFups=dFups.concat([dCf]);
      var dMsg={role:'ai', html:'', plain:kText, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:route.label, auto:route.auto, followups:dFups, lang:lang, ts:Date.now(), daypart:dTl.daypart, daypartRoman:dTl.daypartRoman, timeLabel:dTl.full, _fullHtml:mdToHtml(kText)};
      chat.messages.push(dMsg); renderMessages();
      streamMessage(chat, dMsg);
    }).catch(function(){
      if(myRun!==searchRunId || state.stopRequested) return;
      hideTyping(); finishTasks(true); setCentreEnzo('error');
      try{ if(window.__enzoLifecycle) window.__enzoLifecycle.failTask(myRun, 'definition-answer-failed'); }catch(e){}
      var fh2=fallbackAnswer(text, [], lang, false);
      if(!fh2) fh2='<div class="notice-warn"><p style="margin:0 0 10px">'+esc(window.EnzoAskRecovery.fallbackNotice(lang))+'</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
      var eTl2=timeLabelFor(Date.now());
      var eMsg2={role:'ai', html:fh2, plain:stripHtml(fh2), error:true, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:route.label, auto:route.auto, followups:makeFollowups(text,lang), lang:lang, ts:Date.now(), daypart:eTl2.daypart, daypartRoman:eTl2.daypartRoman, timeLabel:eTl2.full};
      chat.messages.push(eMsg2); renderMessages(); setGenerating(false);
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(eMsg2, answersMode()) : maybeSpeak(eMsg2));
    });
    return;
  }
  try{ if(window.__enzoLifecycle) if(!deep) window.__enzoLifecycle.setState(myRun, 'searching'); }catch(e){}
  setTypingStatus('Searching…');
  searchWeb(cvAnswer.resolvedQuestion, deep).then(function(sources){
    setProgress(steps,2,deep);
    try{ if(window.__enzoLifecycle) window.__enzoLifecycle.setState(myRun, 'validating'); }catch(e){}
    // If sources are still thin, search once more with the English-keyword version before answering
    var usable=sources.filter(function(s){return (s.extract||'').length>60;}).length;
    if(usable<2){
      var enQ=romanToEnglish(text)||analyzeQuestion(text).keywords.join(' ');
      if(enQ && enQ.toLowerCase()!==text.toLowerCase()){
        return searchWeb(enQ, deep).then(function(more){
          var merged=mergeSources([sources,more], deep?18:10);
          merged.liveCount=merged.length;
          var fkList=[]; [sources.failKind, more.failKind].forEach(function(f){ if(f && f!=='none') fkList.push(f); });
          merged.failKind = merged.length>=2 ? 'none' : aggregateFailKind(fkList.length?fkList:['empty']);
          return answerWithSources(cvAnswer.resolvedQuestion, merged, lang, deep, historyText, steps);
        });
      }
    }
    return answerWithSources(cvAnswer.resolvedQuestion, sources, lang, deep, historyText, steps);
  }).then(function(result){
    if(myRun!==searchRunId) return;
    if(state.stopRequested) return;
    hideTyping();
    setProgress(steps,3,deep);
    var ansTl=timeLabelFor(Date.now());
    /* Honest error handling: if live search genuinely returned nothing AND the answer had to come
       from ENZO's own knowledge, say so plainly and attach no sources — never dress it up as a search. */
    var useSources=result.sources; var fullHtml=result.html;
    var liveCount=(result.sources && typeof result.sources.liveCount==='number') ? result.sources.liveCount : (result.sources||[]).length;
    /* GUFTAGU (locked rule 49): everyday conversation is answered directly
       from ENZO's own knowledge — never with a clarifying question, never
       with a research question, never under a search-failure banner. If the
       model still replied with a lone clarifying question, replace it with
       a direct own-knowledge answer. */
    var guftagu=isGuftagu(text);
    if(guftagu && result.clarify){
      return callAIKnowledge(cvAnswer.resolvedQuestion, lang, false, historyText).then(function(kText){
        if(myRun!==searchRunId || state.stopRequested) return;
        kText=finishAtSentence(scrubResearchClaims(scrubQuestionEcho(kText, text)));
        var gTl=timeLabelFor(Date.now());
        var gMsg={role:'ai', html:'', plain:kText, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Everyday conversation — answered directly from ENZO\'s own knowledge', auto:route.auto, followups:makeFollowups(text, lang), lang:lang, ts:Date.now(), daypart:gTl.daypart, daypartRoman:gTl.daypartRoman, timeLabel:gTl.full, _fullHtml:mdToHtml(kText)};
        chat.messages.push(gMsg); renderMessages();
        streamMessage(chat, gMsg);
      });
    }
    /* NEVER-ANSWER-WHEN-UNSURE (locked rule): when ENZO could not understand
       the question well enough to answer it — the model itself asked a
       clarifying question, or live search returned no usable pages for a
       factual question — it must NOT fill the gap with its own knowledge.
       It asks ONE short clarifying question naming the two most likely
       meanings, and only researches/answers after the user clarifies.
       Guftagu (rule 49) is exempt: conversation is never unclear in this
       sense, and its own-knowledge answer above stands as the reply. */
    var clarifyText='';
    /* v55 P1: the thin-search / model clarify below is GATED for
       decided kinds — the local intent decision (made before any
       search) wins, so a thin search result can never turn a decided
       question into a clarifying question again. */
    var kindDecided55 = intent.kind!=='clarify';
    if(!kindDecided55 && result.clarify && result.plain) clarifyText=result.plain;
    else if(!kindDecided55 && liveCount<2 && !guftagu){
      var fk0=(result.sources && result.sources.failKind) || 'empty';
      var qt0=analyzeQuestion(text).type;
      if((fk0==='empty'||fk0==='none') && qt0!=='writing' && qt0!=='solve' && typeof window.__enzoClarifyQuestion==='function')
        clarifyText=window.__enzoClarifyQuestion(text, lang, chat, 'noresults');
    }
    if(clarifyText){
      chat.pendingClarifyLocal={original:text, noResults:true, lang:lang, opts:(typeof window.__enzoNoResultsOptions==='function'?window.__enzoNoResultsOptions(text):[])};
      saveChats();
      var cTl=timeLabelFor(Date.now());
      var cMsg={role:'ai', html:mdToHtml(clarifyText), plain:clarifyText, viaVoice:askViaVoice, question:text, sources:[], deep:deep, clarify:true, modeWhy:'ENZO asked a clarifying question — never answers when unsure', auto:route.auto, followups:[], lang:lang, ts:Date.now(), daypart:cTl.daypart, daypartRoman:cTl.daypartRoman, timeLabel:cTl.full};
      chat.messages.push(cMsg); renderMessages(); saveChats();
      if(typeof setProgress==='function') setProgress(null);
      setGenerating(false);
      setCentreEnzo('idle');
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(cMsg, answersMode()) : maybeSpeak(cMsg));
      return;
    }
    if(liveCount<2){
      /* v55 P2: honest uncertainty instead of a clarify / error-only
         reply when no answer could be produced at all. */
      var cvUnc=EnaoConversation.honestUncertainty(text, cvCtx);
      if(cvUnc && !result.plain){
        var uTl=timeLabelFor(Date.now());
        var uMsg={role:'ai', html:'', plain:cvUnc, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Honest uncertainty — no answer available, offered the next step', auto:route.auto, followups:[], lang:lang, ts:Date.now(), daypart:uTl.daypart, daypartRoman:uTl.daypartRoman, timeLabel:uTl.full, _fullHtml:mdToHtml(cvUnc)};
        chat.messages.push(uMsg); renderMessages();
        streamMessage(chat, uMsg);
        return;
      }
      /* Too few real pages came back from live search: attach NO sources at all and say
         exactly what happened, with a working Retry Search button that re-runs this
         same question. A search-engine query page is never dressed up as a source.
         (Writing / solving pieces are created work, not searched facts — they are
         delivered without the warning banner.) */
      useSources=[];
      var failKind=(result.sources && result.sources.failKind) || 'empty';
      var qt1=analyzeQuestion(text).type;
      if(result.aiFailed)
        fullHtml='<div class="notice-warn"><p style="margin:0 0 10px">'+esc(searchFailMessage(failKind==='none'?'empty':failKind))+'</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
      else if(qt1!=='writing' && qt1!=='solve' && !guftagu)
        fullHtml=searchFailNoticeHtml(failKind==='none'?'empty':failKind)+fullHtml;
    }
    var msg={role:'ai', html:'', plain:result.plain, viaVoice:askViaVoice, question:text, sources: state.sourcesOn?useSources:[], deep:deep, modeWhy:route.label, auto:route.auto, followups: (function(){ var f=makeFollowups(text, lang); var cf=EnaoConversation.suggestFollowUp(text, cvCtx); if(cf) f=f.concat([cf]); return f; })(), lang:lang, ts:Date.now(), daypart:ansTl.daypart, daypartRoman:ansTl.daypartRoman, timeLabel:ansTl.full, _fullHtml:fullHtml};
    chat.messages.push(msg); renderMessages();
    // streaming effect: reveal html progressively by words of plain, then swap to full html
    streamMessage(chat, msg);
  }).catch(function(){
    if(myRun!==searchRunId) return;
    if(state.stopRequested) return;
    /* v55 P2: honest uncertainty instead of an error-only reply. */
    var cvUncC=EnaoConversation.honestUncertainty(text, cvCtx);
    if(cvUncC){
      hideTyping(); setCentreEnzo('idle');
      var ucTl=timeLabelFor(Date.now());
      var ucMsg={role:'ai', html:mdToHtml(cvUncC), plain:cvUncC, viaVoice:askViaVoice, question:text, sources:[], deep:false, modeWhy:'Honest uncertainty — no answer available, offered the next step', auto:route.auto, followups:[], lang:lang, ts:Date.now(), daypart:ucTl.daypart, daypartRoman:ucTl.daypartRoman, timeLabel:ucTl.full};
      chat.messages.push(ucMsg); renderMessages(); saveChats();
      setGenerating(false);
      (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(ucMsg, answersMode()) : maybeSpeak(ucMsg));
      return;
    }
    // Last-resort safety net: still deliver a full, helpful answer — never an error-only reply
    hideTyping();
    finishTasks(true);
    try{ if(window.__enzoLifecycle) window.__enzoLifecycle.failTask(myRun, 'search-pipeline-failed'); }catch(e){}
    setCentreEnzo('error');
    var fh=fallbackAnswer(text, [], lang, deep);
    if(!fh) fh='<div class="notice-warn"><p style="margin:0 0 10px">'+esc(window.EnzoAskRecovery.fallbackNotice(lang))+'</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
    var errTl=timeLabelFor(Date.now());
    var errMsg={role:'ai', html:fh, plain:stripHtml(fh), error:true, viaVoice:askViaVoice, question:text, sources:[], deep:deep, modeWhy:route.label, auto:route.auto, followups:makeFollowups(text,lang), lang:lang, ts:Date.now(), daypart:errTl.daypart, daypartRoman:errTl.daypartRoman, timeLabel:errTl.full};
    chat.messages.push(errMsg); renderMessages();
    setGenerating(false);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(errMsg, answersMode()) : maybeSpeak(errMsg));
  });
}

function streamMessage(chat, msg){
  // Simple streaming: show text typing, then final formatted html
  var words=(msg.plain||'').split(/\s+/);
  var idx=0;
  var els=$('messages').children;
  var lastEl=els[els.length-1];
  var bodyEl=lastEl ? lastEl.querySelector('.ai-body') : null;
  if(!bodyEl || !words.length){ msg.html=msg._fullHtml; finishStream(chat,msg); return; }
  setCentreEnzo('speaking');
  bodyEl.innerHTML='<p></p>'; var p=bodyEl.querySelector('p');
  var timer=setInterval(function(){
    if(state.stopRequested){ clearInterval(timer); state.streamTimer=null; return; }
    idx+=(msg.deep?5:9); /* Normal mode streams faster — the fast-answer experience */
    msg._partialPlain=words.slice(0,idx).join(' ');
    p.textContent=words.slice(0,idx).join(' ')+(idx<words.length?' ▍':'');
    if(state.nearBottom) $('scrollArea').scrollTop=$('scrollArea').scrollHeight;
    if(idx>=words.length){ clearInterval(timer); state.streamTimer=null; msg.html=msg._fullHtml; finishStream(chat,msg); }
  }, 30);
  state.streamTimer=timer;
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.registerTimer(searchRunId, timer); }catch(e){}
}
/* Answers Aloud — three honest states. Auto (default, the locked rule): typed question = text-only
   answer, voice question = spoken answer. On: every answer is spoken. Off: nothing is auto-spoken
   (the Listen Aloud button on any answer still works — that tap is an explicit request). */
function answersMode(){ var v=loadPref('enao_answers_aloud','auto'); return (v==='on'||v==='off')?v:'auto'; }
/* The user explicitly asked for this answer in TEXT — "text mein bhejo",
   "likh kar bhejo", "reply in text", "ٹیکسٹ میں بھیجو". That instruction
   beats the voice-in / voice-out rule for this one answer, even mid-call:
   bol kar poochha to bol kar jawab, text mein kaha to text mein jawab. */
function wantsTextReply(text){
  var t=' '+String(text||'').toLowerCase()+' ';
  return /(text|ٹیکسٹ)[\s-]*(mein|me|میں)?[\s-]*(bhej\w*|send|likh\w*|jawab|reply|answer|do|de)\b/.test(t)
    || /likh\s*(kar|ke)\s*bhej/.test(t)
    || /(sirf|only)\s+text\b/.test(t)
    || /(reply|answer|send|respond)\s+in\s+text\b/.test(t)
    || /لکھ کر بھیج/.test(t);
}
/* Words spoken on a call while ENZO was still preparing the previous
   answer used to be thrown away by the recognizer. Now they wait in a
   queue and are sent as the next chat message the moment ENZO is free —
   whatever is said on a call goes straight into the chat as a sent
   message; nothing waits unsent in the box and nothing is lost. */
function flushVoiceQueue(){
  if(window.EnzoVoiceFix42 && window.EnzoVoiceFix42.flushVoiceQueueFixed){
    window.EnzoVoiceFix42.flushVoiceQueueFixed(state, {send:function(q){ sendQueuedMicDirect(q); }, lang:(window.EnzoLang45 ? window.EnzoLang45.askLang(state.voiceQueue, state.langPref, detectLang) : detectLang(state.voiceQueue))});
    return;
  }
  var q=(state.voiceQueue||'').trim();
  if(!q) return;
  if(state.isGenerating || state.isSpeaking) return;
  state.voiceQueue='';
  /* v55 P7: queued voice text may only be sent if the gate already accepted it (or allowed it as guest chat). */
  if(window.EnzoVoiceID && !window.EnzoVoiceID.allowQueued(q)){ return; }
  sendQueuedMicDirect(q);
}
/* PIECE 48 — FIX B live chat delivery helpers (enao-hear-fix, v64-voice-live). Mic-originated transcripts only; typed path untouched. */
function clearMicComposer(){ var inp=$('input'); if(inp) inp.value=''; autoGrow(); syncSendBtn(); }
function sendMicDirect(text){
  /* Free path: final mic transcript -> sent user message + answer pipeline
     with voice=true, immediately. No composer fill, no setTimeout. */
  var heard=String(text||'').trim();
  if(!heard) return false;
  clearMicComposer();
  try{ askQuestion(heard, true); }
  catch(e){
    /* Same failure safety as sendCurrent: put the text back so nothing is lost. */
    $('input').value=heard; autoGrow(); syncSendBtn();
    toast('Sending failed — your text is back in the box. Tap Send to try again.');
    return false;
  }
  return true;
}
function postMicSentMessage(text){
  /* Busy path: post the mic transcript as a sent user message RIGHT NOW
     (role:'user', status:'sent', viaVoice:true — the double-tick foot is
     rendered by buildMessageEl for every user message, base L9908). The
     answer pipeline is deliberately NOT started here (ENZO is busy);
     pendingAnswer marks it for sendQueuedMicDirect via the flush. Text is
     EXACTLY the transcript — never edited, translated or "cleaned". */
  var heard=String(text||'').trim();
  if(!heard) return null;
  var chat=activeChat();
  if(!chat){ chat=createChat(heard.slice(0,42)); }
  if(chat.messages.length===0) chat.title=heard.slice(0,42);
  var lang=(window.EnzoLang45 ? window.EnzoLang45.askLang(heard, state.langPref, detectLang) : detectLang(heard));
  var tl=timeLabelFor(Date.now());
  var msg={role:'user', text:heard, lang:lang, viaVoice:true, status:'sent', pendingAnswer:true, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full, files:[]};
  chat.messages.push(msg);
  clearMicComposer();
  renderChatList(); renderMessages(true); saveChats();
  return msg;
}
function sendQueuedMicDirect(q){
  /* Flush path: a queued mic transcript (already posted as sent by
     postMicSentMessage) gets its answer pipeline now — direct askQuestion
     with alreadyPosted so no duplicate user message is pushed. */
  var text=String(q||'').trim();
  if(!text) return false;
  clearMicComposer();
  if(!state.voiceLive){ state.voiceQueue=text; state.voiceQueuePosted=true; return false; } /* Call ended — the sent message stays in chat, pending; the queue is kept so a later flush can still answer it. */
  state.voiceQueue=''; state.voiceQueuePosted=false;
  try{ askQuestion(text, true, undefined, {alreadyPosted:true}); }
  catch(e){
    state.voiceQueue=text; state.voiceQueuePosted=true;
    $('input').value=text; autoGrow(); syncSendBtn();
    toast('Sending failed — your text is back in the box. Tap Send to try again.');
    return false;
  }
  return true;
}
function maybeSpeak(msg){
  if (msg && msg.plain && window.EnzoIdentityGuard) {
    msg.plain = window.EnzoIdentityGuard.correctIdentity(msg.plain);
  }
  if(msg && msg.viaVoice && msg.question && wantsTextReply(msg.question)){
    if(state.voiceLive) setVoiceState('on');
    flushVoiceQueue();
    return;
  }
  var md=answersMode();
  if(md==='off'){ if(state.voiceLive) setVoiceState('on'); flushVoiceQueue(); return; }
  if(md==='on' || msg.viaVoice){ try{ if(window.EnzoVoiceFix43) window.EnzoVoiceFix43.checkVolumeBeforeSpeak(msg, state); }catch(e){} speakText(msg.plain, msg.lang); }
  else if(state.voiceLive){ setVoiceState('on','Answer ready. Mic is still LIVE — speak your next question any time.'); flushVoiceQueue(); }
}
function finishStream(chat,msg){
  hideTyping();
  try{ if(window.__enzoLifecycle) window.__enzoLifecycle.completeTask(searchRunId); }catch(e){}
  setCentreEnzo('success');
  setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
  finishTasks(false);
  setGenerating(false);
  renderMessages(); saveChats();
  if(state.notifOn && document.hidden) toast('Your answer is ready');
  /* RULE: typed question = text-only answer (never spoken). Voice question = spoken answer. */
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchFinishStream(msg, answersMode()) : maybeSpeak(msg));
}

