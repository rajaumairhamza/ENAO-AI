
/* =====================================================================
   v55-master-intel — ASSEMBLY GLUE
   Wiring that lives outside the six inlined pieces:
   - window.EnaoIntel / window.EnzoSeoTools namespaces for the two
     pieces that export bare globals (01-intent, 05-seo-tools);
   - SEO chat commands run FIRST on every chat message, before every
     other askQuestion wrapper (this wrapper is defined last, so it is
     the outermost);
   - the 11 SEO entries in the Tools menu;
   - EnzoAgents.mount() after the full-screen monitor opens;
   - the EnzoVoiceID enrollment-card mount in Settings -> Voice (the
     settings panes are built before EnzoVoiceID loads, so the guarded
     in-place call in the settings builder cannot fire at build time;
     this retry performs the mount once the piece exists).
   ===================================================================== */
(function(){
  'use strict';
  try{ window.EnaoIntel={ classifyIntent: classifyIntent, extractResearchParams: extractResearchParams, createIntelState: createIntelState, updateIntelState: updateIntelState, isLoopRisk: isLoopRisk }; }catch(e){}
  try{ window.EnzoSeoTools={ parseSeoCommand: parseSeoCommand, SEO_TOOLS_MENU: SEO_TOOLS_MENU, seoEndpointFor: seoEndpointFor, seoRequestBody: seoRequestBody, seoDetailHtml: seoDetailHtml, seoEsc: seoEsc, renderSeoReport: renderSeoReport, renderBacklinks: renderBacklinks, renderKeywords: renderKeywords, renderExplorer: renderExplorer, renderRank: renderRank, renderCompetitors: renderCompetitors, renderContentGap: renderContentGap, renderSerp: renderSerp, renderSeoResult: renderSeoResult, seoShortSummary: seoShortSummary, buildPitch: buildPitch, buildArticleOutline: buildArticleOutline, saveSeoReportToLibrary: saveSeoReportToLibrary, toggleSeoDetail: toggleSeoDetail, wireSeoButtons: wireSeoButtons }; }catch(e){}

  /* ---------- SEO: run one chat command end to end ---------- */
  function seoLibrary55(){
    if(window.EnzoLibrary) return window.EnzoLibrary;
    if(typeof libCapture==='function'){
      return { save: function(rep){
        libCapture({kind:'document', title:'SEO '+(rep.tool||'report')+' — '+(rep.url||rep.domain||rep.query||''), chatTitle:'SEO Tools', bodyText: window.EnzoSeoTools.seoShortSummary('', rep), bodyHtml: window.EnzoSeoTools.renderSeoResult(rep.tool||'', rep)});
      } };
    }
    return null;
  }
  function seoDeliver55(chat, text, lang, viaVoice, plain, htmlBody){
    var tl=timeLabelFor(Date.now());
    var msg={role:'ai', html:htmlBody, plain:plain, viaVoice:!!viaVoice, question:text, sources:[], deep:false, modeWhy:'ENZO SEO toolkit — ENZO\u2019s own engine', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full};
    chat.messages.push(msg); renderMessages(); saveChats();
    var box=document.getElementById('messages');
    if(box && window.EnzoSeoTools) window.EnzoSeoTools.wireSeoButtons(box);
    setCentreEnzo('success');
    setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
  }
  function runSeo55(cmd, text, viaVoice){
    var chat=activeChat();
    if(!chat){ chat=createChat(text.slice(0,42)); }
    if(chat.messages.length===0) chat.title=text.slice(0,42);
    var lang=detectLang(text);
    pushUserMsg(chat, text, lang, viaVoice, []);
    renderChatList(); renderMessages(true); saveChats();
    state.usage++; var ut=$('usageText'); if(ut) ut.textContent=state.usage;
    var T=window.EnzoSeoTools;
    if(cmd.kind==='pitch'){
      var p=T.buildPitch(cmd.site, cmd.topic);
      var md='**Guest post pitch — '+p.site+'**\n\nSubject options:\n'+p.subjects.map(function(x,i){ return (i+1)+'. '+x; }).join('\n')+'\n\n'+p.body+'\n\nRules:\n'+p.rules.map(function(r){ return '- '+r; }).join('\n');
      seoDeliver55(chat, text, lang, viaVoice, md, mdToHtml(md));
      return;
    }
    if(cmd.kind==='article'){
      var a=T.buildArticleOutline(cmd.topic);
      var md2='**Article outline — '+a.topic+'**\n\nTitle options:\n'+a.title_options.map(function(x,i){ return (i+1)+'. '+x; }).join('\n')+'\n\n'+a.outline.map(function(o){ return '- **'+o.section+':** '+o.purpose; }).join('\n')+'\n\nChecklist:\n'+a.checklist.map(function(c){ return '- '+c; }).join('\n');
      seoDeliver55(chat, text, lang, viaVoice, md2, mdToHtml(md2));
      return;
    }
    var endpoint=T.seoEndpointFor(cmd.kind);
    if(!endpoint){ var nl='That SEO command is not wired to an endpoint yet.'; seoDeliver55(chat, text, lang, viaVoice, nl, mdToHtml(nl)); return; }
    setGenerating(true); showTyping(); setTypingStatus('Running ENZO\u2019s own SEO tools…'); setCentreEnzo('researching');
    fetch(window.EnzoPagesBackend.getBackendUrl(endpoint), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(T.seoRequestBody(cmd))})
      .then(function(r){ return r.json().catch(function(){ return null; }).then(function(j){ if(!r.ok) throw new Error((j&&(j.message||j.error))||('HTTP '+r.status)); return j; }); })
      .then(function(payload){
        hideTyping(); setGenerating(false);
        var report=(payload && payload.report) ? payload.report : payload;
        var summary=T.seoShortSummary(cmd.kind, payload);
        var html='<p>'+T.seoEsc(summary)+'</p>'+T.renderSeoResult(cmd.kind, payload);
        try{ T.saveSeoReportToLibrary(report, seoLibrary55()); }catch(e){}
        seoDeliver55(chat, text, lang, viaVoice, summary, html);
      })
      .catch(function(err){
        hideTyping(); setGenerating(false); setCentreEnzo('error');
        var line='The SEO check could not run — the ENZO platform backend did not answer ('+((err&&err.message)||'network error')+'). Nothing was guessed or filled in.';
        seoDeliver55(chat, text, lang, viaVoice, line, mdToHtml(line));
      });
  }
  var innerAsk55=window.askQuestion;
  window.askQuestion=function(text, viaVoice, forcedDeep){
    try{ if(text && typeof classifyIntent==='function'){ var c55=activeChat(); if(c55){ var it55=classifyIntent(text, {state: c55.intelState || (c55.intelState=createIntelState())}); if(it55 && it55.kind){ c55.intentKind=it55.kind; c55.lastIntent=it55; } } } }catch(e){}
    try{
      if(text && typeof forcedDeep!=='boolean' && window.EnzoSeoTools
         && !(typeof state!=='undefined' && state.pendingFiles && state.pendingFiles.length)){
        var cmd55=window.EnzoSeoTools.parseSeoCommand(text);
        if(cmd55){ runSeo55(cmd55, text, viaVoice); return; }
      }
    }catch(e){}
    return innerAsk55(text, viaVoice, forcedDeep);
  };

  /* ---------- SEO: the 11 Tools-menu entries ---------- */
  function addSeoToolCards55(){
    try{
      var g=document.getElementById('toolsGrid');
      if(!g || !window.EnzoSeoTools) return;
      if(document.getElementById('seoToolsCard-audit')) return;
      window.EnzoSeoTools.SEO_TOOLS_MENU.forEach(function(t){
        var b=document.createElement('button');
        b.className='toolcard'; b.type='button'; b.id='seoToolsCard-'+t.id;
        b.innerHTML='<b>'+esc(t.label)+'</b><span>'+esc('ENZO\u2019s own SEO toolkit. Example: '+t.example)+'</span>';
        b.onclick=function(){
          closeModal('toolsModal');
          var inp=$('input');
          if(inp){ inp.value=t.example; autoGrow(); syncSendBtn(); inp.focus(); }
        };
        g.appendChild(b);
      });
    }catch(e){}
  }
  try{
    if(typeof window.renderTools==='function'){
      var rt55=window.renderTools;
      window.renderTools=function(){ rt55(); addSeoToolCards55(); };
    }
  }catch(e){}

  /* ---------- Agents panel: mount after the monitor opens ---------- */
  try{
    if(window.EnzoMonitorFullscreen && window.EnzoAgents){
      var fsOpen55=window.EnzoMonitorFullscreen.open;
      window.EnzoMonitorFullscreen.open=function(taskId){
        var r=fsOpen55(taskId);
        try{ window.EnzoAgents.mount(); }catch(e){}
        return r;
      };
    }
  }catch(e){}
  function mountAgents55(){ try{ if(window.EnzoAgents) window.EnzoAgents.mount(); }catch(e){} }

  /* ---------- Voice ID: enrollment card in Settings -> Voice ---------- */
  function mountVoiceId55(){
    try{
      if(!window.EnzoVoiceID) return;
      if(document.getElementById('voiceidCard')) return;
      var pane=document.getElementById('setpane-voice');
      if(!pane) return;
      var card=document.createElement('div');
      card.innerHTML=window.EnzoVoiceID.enrollmentHTML();
      pane.appendChild(card);
      window.EnzoVoiceID.mountEnrollment(card);
    }catch(e){}
  }
  function boot55(){ mountAgents55(); mountVoiceId55(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot55); else boot55();
  document.addEventListener('click', function(){ setTimeout(mountVoiceId55, 80); });
})();
