
/* =====================================================================
   v56-universal — ASSEMBLY GLUE
   Wiring that lives outside the three inlined pieces (07/08/09):
   - the 07 -> 08 preset adapter (exact wiring, proven by
     tests/universal.cjs U3);
   - the rule-setting hook (piece 09) at the VERY TOP of the chat
     submit path, before any other handling;
   - build-command detection (piece 07) BEFORE the normal intent
     classifier: think -> research (the app's existing live search) ->
     Q&A in chat (Roman Urdu) -> build -> spec handed to EnzoAgents
     (06) to split, run in parallel and assemble, visible in the
     fullscreen live view;
   - EnzoRules.applyRules() before any chat/research/build work;
   - the Standing Rules list in Settings (piece 09 settingsRows,
     per-row Delete).
   Additive only: this wrapper is defined last, so it is the outermost
   askQuestion wrapper; every other message falls through unchanged.
   ===================================================================== */
(function(){
  'use strict';

  /* ---------- 07 -> 08 adapter (exact) ---------- */
  try{
    if(window.EnzoUniversalPreset && window.EnzoBuildFlow){
      EnzoBuildFlow.setPresetProvider(function(kindId){ var plan = EnzoUniversalPreset.buildPlan(kindId, {}); if(!plan) return null; return { fields: plan.fields.map(function(f){ return { id: f.name, label: f.label, question: f.label + ' kya hai? (jo maloom nahi, wahi poochha jata hai)', why: f.description || 'Ye maloomat build ke liye zaroori hai.' }; }), design: EnzoUniversalPreset.nextDesign(kindId, []) }; });
    }
  }catch(e){}

  /* ---------- Raja's REAL info (memory) — known info for the Q&A ----
     Only facts Raja actually gave. Anything else stays an editable
     placeholder; nothing is invented. Field ids match piece 07's
     portfolio registry entry, so other kinds simply ignore this. */
  var RAJA_KNOWN56 = {
    name: 'Raja Muhammad Umair Hamza',
    title: 'Creator & Builder — YouTube, Apps & Websites',
    projects: 'Nobody Gets In (YouTube channel @No-body-Gets-In, animated stickman zombie-survival stories); EarnNova (Android app + website earnnova.cu.gy, earn-coins platform); Crypto Guide USA (cryptoinfonews.online, crypto education for USA beginners); Nonsense Interview (3D cartoon animated interview show); SEO Tools Hub (SEO tools project)'
  };
  function knownInfo56(kind){ return kind==='portfolio' ? RAJA_KNOWN56 : {}; }

  /* ---------- shared deliver helpers (same shape as v55) ---------- */
  function deliver56(chat, questionText, lang, viaVoice, plain, htmlBody, modeWhy){
    var tl=timeLabelFor(Date.now());
    var msg={role:'ai', html:htmlBody||mdToHtml(plain), plain:plain, viaVoice:!!viaVoice, question:questionText, sources:[], deep:false, modeWhy:modeWhy||'ENZO v56 — universal build system', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full};
    chat.messages.push(msg); renderMessages(); saveChats();
    setCentreEnzo('success');
    setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
    return msg;
  }
  function startChat56(text, viaVoice){
    var chat=activeChat();
    if(!chat){ chat=createChat(text.slice(0,42)); }
    if(chat.messages.length===0) chat.title=text.slice(0,42);
    var lang=detectLang(text);
    pushUserMsg(chat, text, lang, viaVoice, []);
    renderChatList(); renderMessages(true); saveChats();
    state.usage++; var ut=$('usageText'); if(ut) ut.textContent=state.usage;
    return { chat:chat, lang:lang };
  }
  function monitorNote56(chat, title, detail){
    try{ if(window.EnzoMonitor){ EnzoMonitor.setChatId(chat.id); EnzoMonitor.start(); EnzoMonitor.noteFrontendStep({title:title, detail:detail}); } }catch(e){}
  }

  /* ---------- piece 09: rule-setting ---------- */
  var pendingRule56=null; /* { chatId, viaVoice } — next message is the rule text */

  function saveRuleAndConfirm56(ruleText, ctx, questionText, viaVoice){
    var saved=null;
    try{ saved=window.EnzoRules.saveRule(ruleText); }catch(e){}
    var lang9='roman';
    try{ lang9=window.EnzoRules.detectLanguage(questionText); }catch(e){}
    var kind=(saved && saved.replaced && saved.replaced.length) ? 'replaced' : 'saved';
    var line=window.EnzoRules.confirmText(kind, lang9);
    if(saved && saved.rule && saved.rule.text) line+='\n\nRule: '+saved.rule.text;
    deliver56(ctx.chat, questionText, ctx.lang, viaVoice, line, null, 'Standing rule saved (v56 rule-setting)');
    mountRulesSettings56();
  }

  function handleRuleCommand56(parsed, text, viaVoice){
    var ctx=startChat56(text, viaVoice);
    var lang9='roman';
    try{ lang9=window.EnzoRules.detectLanguage(text); }catch(e){}
    if(parsed.needsRuleText || !parsed.rule){
      pendingRule56={ chatId:ctx.chat.id, viaVoice:!!viaVoice };
      deliver56(ctx.chat, text, ctx.lang, viaVoice, window.EnzoRules.confirmText('needsRule', lang9), null, 'Rule-setting: asking Raja for the rule text');
      return;
    }
    saveRuleAndConfirm56(parsed.rule, ctx, text, viaVoice);
  }

  /* ---------- pieces 07 + 08: the build flow ---------- */
  var pendingBuild56=null; /* { chatId, session, questions, idx, answers, viaVoice } */

  function researchFn56(query){
    /* The app's EXISTING live search — the same searchWeb() the chat
       research uses. Only real results it returns become findings;
       sources come only from the urls it actually returned. */
    return searchWeb(query, false).then(function(rs){
      var out=[];
      (rs||[]).forEach(function(r){
        if(r && r.url) out.push({ snippet: r.snippet||r.extract||r.title||'', url: r.url });
      });
      return out;
    });
  }

  function questionsText56(pb, firstHeader){
    var lines=[];
    if(firstHeader) lines.push(firstHeader);
    lines.push('Kul '+pb.questions.length+' sawal hain — ek ek karke jawab dein. Jo chhorna ho, us ke liye "skip" likh dein; wo hissa editable placeholder reh jayega. Jab chahein "build kar do" likh kar seedha build shuru karwa dein.');
    lines.push('');
    pb.questions.forEach(function(q, i){ lines.push((i+1)+'. '+q.label+' — '+q.question); });
    lines.push('');
    var q0=pb.questions[0];
    lines.push('**Sawal 1:** '+q0.question);
    if(q0.why) lines.push('('+q0.why+')');
    return lines.join('\n');
  }
  function nextQuestionText56(pb){
    var q=pb.questions[pb.idx];
    var s='Theek hai. **Sawal '+(pb.idx+1)+' / '+pb.questions.length+':** '+q.question;
    if(q.why) s+='\n('+q.why+')';
    s+='\n\n(Jo chhorna ho to "skip" likh dein.)';
    return s;
  }

  function startBuild56(res, text, viaVoice, appliedRules){
    var ctx=startChat56(text, viaVoice);
    var chat=ctx.chat;
    var session=window.EnzoBuildFlow.createBuildSession(res.kind, text);
    session.__label56=res.kindLabel||res.kind;
    session.__rules56=appliedRules||[];
    session.think();
    monitorNote56(chat, 'Build started — '+session.__label56, 'ENZO is thinking about what this build needs (build flow step 1: think).');
    deliver56(chat, text, ctx.lang, viaVoice,
      'Samajh gaya — **'+session.__label56+'** banana hai.\n\nPehle main khud sochta hoon ke is mein kya kya hona chahiye, phir internet par research karta hoon ke is qisam ki website kaisi honi chahiye. Us ke baad jo maloomat mujhe nahi pata, wo aap se poochhunga — phir build shuru hoga.',
      null, 'Build flow: think (v56 universal)');
    try{ if(typeof beginSearchRun==='function') beginSearchRun(); }catch(e){}
    setGenerating(true); showTyping(); setTypingStatus('Researching — '+session.__label56+' kaisi honi chahiye…');
    setCentreEnzo('researching');
    monitorNote56(chat, 'Build research — '+session.__label56, 'Live search: what this kind of website should include (build flow step 2: research).');
    var out;
    try{ out=session.research(researchFn56); }
    catch(e){ out={ ok:false, error:String(e && e.message || e) }; }
    Promise.resolve(out).then(function(rres){
      hideTyping(); setGenerating(false);
      if(rres && rres.ok===false){
        deliver56(chat, text, ctx.lang, viaVoice, 'Research nahi ho saki, is liye build aage nahi barha. Wajah: '+(rres.error||'unknown')+'\n\nDobara koshish karne ke liye phir se command dein.', null, 'Build flow: research failed (v56 universal)');
        return;
      }
      var research=(session.plan && session.plan.research)||{};
      var srcCount=(research.sources||[]).length;
      var asked=session.ask(knownInfo56(res.kind));
      if(asked && asked.ok===false){
        deliver56(chat, text, ctx.lang, viaVoice, 'Sawal tayyar nahi ho sakay: '+(asked.error||'unknown'), null, 'Build flow: question step failed (v56 universal)');
        return;
      }
      var qs=asked.questions||[];
      var header='Research ho gayi hai — live search se '+(srcCount===1?'1 source':srcCount+' sources')+' mile.';
      if(!qs.length){
        deliver56(chat, text, ctx.lang, viaVoice, header+'\n\nJo maloomat chahiye thi, wo sab pehle se maloom hai — koi sawal nahi. Build shuru karta hoon.', null, 'Build flow: no questions needed (v56 universal)');
        finishBuild56(session, chat, text, viaVoice);
        return;
      }
      pendingBuild56={ chatId:chat.id, session:session, questions:qs, idx:0, answers:{}, viaVoice:!!viaVoice };
      monitorNote56(chat, 'Build questions — '+session.__label56, 'Asking Raja only what is not already known (build flow step 3: ask).');
      deliver56(chat, text, ctx.lang, viaVoice, questionsText56(pendingBuild56, header), null, 'Build flow: questions for Raja (v56 universal)');
    }).catch(function(err){
      hideTyping(); setGenerating(false);
      deliver56(chat, text, ctx.lang, viaVoice, 'Research ke dauraan masla aaya: '+((err && err.message)||'network error')+'\n\nKuch invent nahi kiya gaya. Dobara koshish karne ke liye phir se command dein.', null, 'Build flow: research error (v56 universal)');
    });
  }

  function handleBuildAnswer56(text, viaVoice){
    var pb=pendingBuild56;
    var ctx=startChat56(text, viaVoice);
    var low=text.replace(/\s+/g,' ').trim().toLowerCase();
    if(low==='cancel' || low==='rehne do' || low==='build cancel' || low==='ruk jao'){
      pendingBuild56=null;
      deliver56(ctx.chat, text, ctx.lang, viaVoice, 'Theek hai — ye build roka gaya hai. Jab chahein, phir se command dein.', null, 'Build flow: cancelled by Raja (v56 universal)');
      return;
    }
    if(low==='build kar do' || low==='build kardo' || low==='bas' || low==='ho gaya' || low==='hogaya' || low==='skip all' || low==='sab skip' || low==='done'){
      pendingBuild56=null;
      try{ pb.session.answer(pb.answers); }catch(e){}
      finishBuild56(pb.session, ctx.chat, text, viaVoice);
      return;
    }
    var q=pb.questions[pb.idx];
    if(q && !/^(skip|pata nahi|nahi pata|chhor do|chor do|next)$/.test(low)){
      pb.answers[q.field]=text.trim();
    }
    pb.idx++;
    if(pb.idx>=pb.questions.length){
      pendingBuild56=null;
      try{ pb.session.answer(pb.answers); }catch(e){}
      finishBuild56(pb.session, ctx.chat, text, viaVoice);
      return;
    }
    deliver56(ctx.chat, text, ctx.lang, viaVoice, nextQuestionText56(pb), null, 'Build flow: question '+(pb.idx+1)+' (v56 universal)');
  }

  /* ---------- build: spec -> EnzoAgents (06) -> assembled site ------ */
  function sectionFragment56(f){
    var has=(f.value!==null && f.value!==undefined && f.value!=='');
    var body=has ? esc(String(f.value)) : '[EDITABLE: '+esc(f.label)+' — fill in the real '+esc(String(f.label).toLowerCase())+']';
    return '<section class="card'+(has?'':' ph')+'"><h2>'+esc(f.label)+'</h2><p>'+body+'</p></section>';
  }
  function buildSiteHtml56(spec, fields, fragmentsHtml){
    var d=spec.design||{};
    var cols=(d.colors && d.colors.length>=3) ? d.colors : ['#0a1628', '#38bdf8', '#e8eef7'];
    var heroField=null;
    for(var i=0;i<fields.length;i++){ if(fields[i].value){ heroField=fields[i]; break; } }
    var heroTitle=heroField ? String(heroField.value) : (spec.kindLabel||spec.kind||'Website');
    var cards=(typeof fragmentsHtml==='string' && fragmentsHtml) ? fragmentsHtml : fields.map(sectionFragment56).join('\n');
    var phCount=fields.filter(function(f){ return !(f.value!==null && f.value!==undefined && f.value!==''); }).length;
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'+esc(heroTitle)+'</title>\n<style>\n'
      +'*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:'+cols[0]+';color:#f2f6fb;line-height:1.55}\n'
      +'.wrap{max-width:1020px;margin:0 auto;padding:28px 18px 56px}\n'
      +'header.hero{padding:56px 10px 30px;text-align:center;animation:rise .8s ease both}\n'
      +'header.hero h1{font-size:clamp(30px,6vw,52px);margin:0 0 10px;color:'+cols[2]+';letter-spacing:.2px}\n'
      +'header.hero p{color:#c7d3e4;max-width:640px;margin:0 auto}\n'
      +'.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:26px}\n'
      +'.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;transform:perspective(800px) rotateX(0deg);transition:transform .35s ease,border-color .35s ease;animation:rise .8s ease both}\n'
      +'.card:hover{transform:perspective(800px) rotateX(3deg) translateY(-4px);border-color:'+cols[1]+'}\n'
      +'.card h2{margin:0 0 8px;font-size:19px;color:'+cols[1]+'}\n'
      +'.card p{margin:0;color:#dde7f3;white-space:pre-wrap}\n'
      +'.card.ph{border-style:dashed}.card.ph p{color:#9fb2c8;font-style:italic}\n'
      +'footer{margin-top:36px;text-align:center;color:#8fa3ba;font-size:13px}\n'
      +'@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}\n'
      +'@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}\n'
      +'</style>\n</head>\n<body>\n<div class="wrap">\n<header class="hero"><h1>'+esc(heroTitle)+'</h1><p>'+esc(spec.kindLabel||spec.kind||'Website')+' — built by ENZO from Raja\u2019s real information. Design: '+esc(d.palette||'fresh')+' / '+esc(d.layout||'fresh layout')+' / '+esc(d.motion||'animated')+'.</p></header>\n<div class="grid">\n'+cards+'\n</div>\n<footer>Built by ENZO (universal build system). '+(phCount? phCount+' section(s) are editable placeholders — replace them with real content.' : 'No placeholders — all content is real.')+'</footer>\n</div>\n</body>\n</html>';
  }

  function finishBuild56(session, chat, questionText, viaVoice){
    var built=session.build();
    if(!built || built.ok===false){
      deliver56(chat, questionText, detectLang(questionText), viaVoice, 'Build ruk gaya: '+((built && built.error)||'flow incomplete hai')+'\n\nKuch invent nahi kiya gaya.', null, 'Build flow: build step failed (v56 universal)');
      return;
    }
    var spec=built.spec;
    spec.kindLabel=session.__label56||spec.kind;
    var fields=(session.plan && session.plan.fields) || [];
    monitorNote56(chat, 'Build — agents working', 'The build spec goes to ENZO\u2019s own agents: one agent per part, in parallel, then assembled (build flow step 4: build).');
    try{ if(window.EnzoMonitorFullscreen) window.EnzoMonitorFullscreen.open(); }catch(e){}
    try{ if(window.EnzoAgents) window.EnzoAgents.mount(); }catch(e){}
    setGenerating(true); showTyping(); setTypingStatus('Agents build kar rahe hain…'); setCentreEnzo('researching');
    var rules=session.__rules56||[];
    var ruleNote=rules.length ? ' Standing rules to follow: '+rules.map(function(r){ return r.text; }).join(' | ') : '';
    var parts=fields.map(function(f, i){
      return { index:i+1, title:f.label, part:f.label, subtask:'Build the "'+f.label+'" section of the '+spec.kindLabel+' from the build spec.'+ruleNote };
    });
    if(!parts.length) parts=[{ index:1, title:spec.kindLabel, part:spec.kindLabel, subtask:'Build the '+spec.kindLabel+' from the build spec.'+ruleNote }];
    var work=function(agent){
      var idx=(agent && agent.agent_index) ? agent.agent_index-1 : 0;
      var f=fields[idx] || fields[0] || { label:spec.kindLabel, value:null };
      return { agent_id: agent && agent.agent_id, result: sectionFragment56(f) };
    };
    var run=(window.EnzoAgents && window.EnzoAgents.runAgentsInParallel)
      ? window.EnzoAgents.runAgentsInParallel(parts, work)
      : Promise.resolve(parts.map(function(p, i){ return work({ agent_id:null, agent_index:i+1 }); }));
    Promise.resolve(run).then(function(results){
      var assembled=(window.EnzoAgents && window.EnzoAgents.assembleAgentResults)
        ? window.EnzoAgents.assembleAgentResults(results)
        : { final_result:(results||[]).map(function(r){ return r.result||''; }).join('\n'), parts:(results||[]).length };
      hideTyping(); setGenerating(false);
      /* The page is assembled from the agents' own section fragments. */
      var siteHtml=buildSiteHtml56(spec, fields, assembled && assembled.final_result);
      var buildId='build-'+Date.now().toString(36);
      window.__enzoBuiltSites=window.__enzoBuiltSites||{};
      window.__enzoBuiltSites[buildId]=siteHtml;
      var d=spec.design||{};
      var phLabels=fields.filter(function(f){ return !(f.value!==null && f.value!==undefined && f.value!==''); }).map(function(f){ return f.label; });
      var srcs=(spec.research && spec.research.sources) || [];
      var plain='**'+spec.kindLabel+' tayyar hai.** ENZO ke agents ne '+parts.length+' hisse parallel bana kar jor diye hain.\n\n'
        +'Design: '+(d.palette||'fresh')+' palette, '+(d.layout||'fresh')+' layout, '+(d.motion||'animated')+' motion — har build mein naya design, repeat nahi.\n\n'
        +(phLabels.length ? 'Ye maloomat abhi editable placeholder hai (jawab nahi mila): '+phLabels.join(', ')+'.' : 'Sab maloomat asal hai — koi placeholder nahi bacha.')
        +(srcs.length ? '\n\nResearch sources ('+srcs.length+'):\n'+srcs.map(function(u){ return '- '+u; }).join('\n') : '\n\nResearch mein koi source nahi mila.');
      var html='<p><b>'+esc(spec.kindLabel)+' tayyar hai.</b> ENZO ke agents ne '+parts.length+' hisse parallel bana kar jor diye hain.</p>'
        +'<p>Design: '+esc(d.palette||'fresh')+' palette, '+esc(d.layout||'fresh')+' layout, '+esc(d.motion||'animated')+' motion — har build mein naya design, repeat nahi.</p>'
        +(phLabels.length ? '<p>Ye maloomat abhi editable placeholder hai (jawab nahi mila): '+esc(phLabels.join(', '))+'. Website mein ye [EDITABLE: …] ke tor par nazar aayegi.</p>' : '<p>Sab maloomat asal hai — koi placeholder nahi bacha.</p>')
        +(srcs.length ? '<p>Research sources:</p><ul>'+srcs.map(function(u){ return '<li><a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a></li>'; }).join('')+'</ul>' : '<p>Research mein koi source nahi mila.</p>')
        +'<p><button type="button" class="retrybtn" data-build-download="'+buildId+'">Download the built website (HTML)</button></p>'
        +'<p>Agents ka kaam fullscreen live view mein nazar aata hai.</p>';
      monitorNote56(chat, 'Build complete — '+spec.kindLabel, 'Agents assembled the build. The finished website is in the chat with a download button.');
      deliver56(chat, questionText, detectLang(questionText), viaVoice, plain, html, 'Build flow: build complete (v56 universal)');
    }).catch(function(err){
      hideTyping(); setGenerating(false);
      deliver56(chat, questionText, detectLang(questionText), viaVoice, 'Agents se build ke dauraan masla aaya: '+((err && err.message)||'unknown')+'\n\nSpec tayyar tha, lekin jorna nahi ho saka. Kuch invent nahi kiya gaya.', null, 'Build flow: agents error (v56 universal)');
    });
  }

  /* ---------- downloads + settings delete (delegated clicks) ------- */
  function downloadBuild56(id){
    var html=window.__enzoBuiltSites && window.__enzoBuiltSites[id];
    if(!html){ toast('Ye build is session mein bana tha — file ab is tab mein nahi hai. Dobara banane ke liye phir se command dein.'); return; }
    try{
      var blob=new Blob([html], {type:'text/html'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='enzo-'+id+'.html';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ try{ URL.revokeObjectURL(a.href); }catch(e){} if(a.parentNode) a.parentNode.removeChild(a); }, 500);
    }catch(e){ toast('Download nahi ho saka.'); }
  }
  document.addEventListener('click', function(ev){
    var t=ev.target;
    if(!t || !t.closest) return;
    var db=t.closest('[data-build-download]');
    if(db){ downloadBuild56(db.getAttribute('data-build-download')); return; }
    var del=t.closest('[data-rule-delete]');
    if(del && window.EnzoRules){
      try{ window.EnzoRules.deleteRule(del.getAttribute('data-rule-delete')); }catch(e){}
      renderRulesList56();
      toast('Rule deleted');
    }
  });

  /* ---------- Settings: Standing Rules list (piece 09) ------------- */
  function renderRulesList56(){
    var box=document.getElementById('enzoRulesList');
    if(!box || !window.EnzoRules) return;
    var rows=[];
    try{ rows=window.EnzoRules.settingsRows()||[]; }catch(e){}
    if(!rows.length){
      box.innerHTML='<p class="lrn-note">No standing rules yet. Chat mein koi rule bol kar "ye system aage se set rakho" kahein — wo yahan save ho jayega aur har agle kaam par laagu hoga.</p>';
      return;
    }
    box.innerHTML='<div class="enzo-rules-list">'+rows.map(function(r){
      var when='';
      try{ when=r.created ? new Date(r.created).toLocaleDateString() : ''; }catch(e){}
      return '<div class="enzo-rules-row'+(r.status==='active'?'':' is-replaced')+'"><div class="enzo-rules-main"><div class="enzo-rules-text">'+esc(r.text)+'</div><div class="enzo-rules-meta">'+esc(r.scope||'general')+' · '+esc(r.status||'')+(when?' · '+esc(when):'')+'</div></div>'
        +(r.status==='active' ? '<button type="button" class="enzo-rules-delete" data-rule-delete="'+esc(r.id)+'">Delete</button>' : '')
        +'</div>';
    }).join('')+'</div>';
  }
  function mountRulesSettings56(){
    try{
      if(!window.EnzoRules) return;
      var pane=document.getElementById('setpane-profile');
      if(!pane) return;
      if(!document.getElementById('enzoRulesCard')){
        var card=document.createElement('div');
        card.id='enzoRulesCard';
        card.innerHTML='<h4 class="setsec">Standing Rules</h4><p class="lrn-note">Jo rules Raja chat mein set karta hai ("ye system aage se set rakho"), wo yahan rehte hain aur har agle kaam par laagu hote hain. Naya rule purane takrate hue rule ko replace kar deta hai — replaced rules history mein rehte hain.</p><div id="enzoRulesList"></div>';
        pane.appendChild(card);
      }
      renderRulesList56();
    }catch(e){}
  }

  /* ---------- the outermost chat wrapper ----------------------------
     Order (locked): 1) rule-setting hook, before ANY other handling;
     2) a pending rule-text answer; 3) a pending build Q&A answer;
     4) applyRules before any work; 5) build-command detection BEFORE
     the normal intent classifier; 6) everything else falls through to
     the v55 chain unchanged. */
  var innerAsk56=window.askQuestion;
  window.askQuestion=function(text, viaVoice, forcedDeep){
    var t=(typeof text==='string') ? text.trim() : '';
    var fresh=(typeof forcedDeep!=='boolean');
    try{
      if(t && fresh && window.EnzoRules){
        var parsed=window.EnzoRules.parseRuleCommand(t);
        if(parsed && parsed.isRuleCommand){
          if(pendingRule56 && !(parsed.rule)) { /* a fresh bare command restarts the ask */ }
          else pendingRule56=null;
          handleRuleCommand56(parsed, text, viaVoice);
          return;
        }
      }
    }catch(e){}
    try{
      if(t && fresh && pendingRule56){
        var chatNow=activeChat();
        if(chatNow && chatNow.id===pendingRule56.chatId){
          if(/^(cancel|rehne do|chor do|chhor do|nahi)$/i.test(t)){
            pendingRule56=null;
            var cctx=startChat56(text, viaVoice);
            deliver56(cctx.chat, text, cctx.lang, viaVoice, 'Theek hai — koi rule set nahi kiya gaya.', null, 'Rule-setting: cancelled by Raja');
            return;
          }
          var pr=pendingRule56; pendingRule56=null;
          var rctx=startChat56(text, viaVoice);
          saveRuleAndConfirm56(t, rctx, text, viaVoice);
          return;
        }
      }
    }catch(e){}
    try{
      if(t && fresh && pendingBuild56){
        var bChat=activeChat();
        if(bChat && bChat.id===pendingBuild56.chatId){
          handleBuildAnswer56(text, viaVoice);
          return;
        }
      }
    }catch(e){}
    var applied56=null;
    try{
      if(window.EnzoRules) applied56=window.EnzoRules.applyRules({ text: t });
      if(applied56 && applied56.length){
        var aChat=activeChat();
        if(aChat) aChat.appliedRules56=applied56;
      }
    }catch(e){}
    try{
      if(t && fresh && window.EnzoUniversalPreset && window.EnzoBuildFlow
         && !(typeof state!=='undefined' && state.pendingFiles && state.pendingFiles.length)){
        var res56=window.EnzoUniversalPreset.resolveBuildKind(t);
        if(res56 && res56.kind){ startBuild56(res56, text, viaVoice, applied56); return; }
      }
    }catch(e){}
    /* Fall-through: record the intent with the v55 classifier first
       (same guarded recording the v55 wrapper performs), then hand the
       message to the existing chain completely unchanged. */
    try{ if(t && typeof classifyIntent==='function'){ var cc56=activeChat(); if(cc56){ var it56=classifyIntent(t, {state: cc56.intelState || (cc56.intelState=createIntelState())}); if(it56 && it56.kind){ cc56.intentKind=it56.kind; cc56.lastIntent=it56; } } } }catch(e){}
    return innerAsk56(text, viaVoice, forcedDeep);
  };

  /* ---------- boot: settings list (retry like the v55 mounts) ------ */
  function boot56(){ mountRulesSettings56(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot56); else boot56();
  document.addEventListener('click', function(){ setTimeout(mountRulesSettings56, 80); });
})();
