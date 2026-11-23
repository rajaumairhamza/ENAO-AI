/* ---------- P-C — CENTRE WORKSPACE message rendering (brief §5.3–§5.10) ---------- */
/* Plain web addresses in a user message become real links; everything else stays escaped text */
function linkifyEsc(t){
  return esc(t).replace(/https?:\/\/[^\s<]+/g, function(u){ return '<a href="'+u+'" target="_blank" rel="noopener">'+u+'</a>'; });
}
function downloadTextFile(name, text){
  try{
    var blob=new Blob([text||''],{type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=name||'ENZO.txt'; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); if(a.parentNode) a.parentNode.removeChild(a); }, 400);
    toast('Download started — check your downloads');
  }catch(e){ toast('Download is not available in this browser'); }
}
function closeWsMenus(){
  ['wsMenu','modelMenu'].forEach(function(id){ var el=$(id); if(el) el.hidden=true; });
  document.querySelectorAll('.msgmenu:not([hidden])').forEach(function(x){ x.hidden=true; });
  document.querySelectorAll('.sharemenu:not([hidden])').forEach(function(x){ x.hidden=true; });
}
/* The ENZO orb beside AI messages (and the 3D companion, through its existing
   state hook) follows the REAL app state — never a decorative guess. */
function setCentreEnzo(st){
  var map={idle:'idle',listening:'listening',thinking:'thinking',speaking:'speaking',working:'working',researching:'working',coding:'working',success:'success',error:'error'};
  var v=map[st]||'idle';
  var avs=document.querySelectorAll('[data-enzoav]');
  if(avs.length) avs[avs.length-1].setAttribute('data-state', v);
  var ta=$('typingAv'); if(ta) ta.setAttribute('data-state', v==='idle'?'thinking':v);
  if(window.setEnzoState){ try{ window.setEnzoState(st); }catch(e){} }
}
function deleteMessage(m){
  var c=activeChat(); if(!c) return;
  confirmAction('Delete this message?', 'This message will be permanently deleted from this browser. This cannot be undone.', 'Yes, delete it', function(){
    var i=c.messages.indexOf(m); if(i>-1) c.messages.splice(i,1);
    renderMessages(); saveChats(); toast('Message deleted');
  });
}
/* Edit a user message in place, then resend it — the old exchange is replaced,
   in the same mode the original answer used. */
function startUserEdit(wrapEl, m){
  if(state.isGenerating){ toast('Wait for the current answer to finish first'); return; }
  var bubble=wrapEl.querySelector('.bubble'); if(!bubble || bubble.querySelector('.msgedit')) return;
  bubble.innerHTML='<textarea class="msgedit" rows="3" aria-label="Edit your message">'+esc(m.text||'')+'</textarea><div class="msgedit-btns"><button type="button" data-e="cancel">Cancel</button><button type="button" data-e="save">Save &amp; resend</button></div>';
  var ta=bubble.querySelector('.msgedit'); ta.focus(); try{ ta.setSelectionRange(ta.value.length, ta.value.length); }catch(e){}
  bubble.querySelector('[data-e="cancel"]').onclick=function(){ renderMessages(); };
  bubble.querySelector('[data-e="save"]').onclick=function(){
    var nt=ta.value.trim(); if(!nt){ toast('The message is empty — write something or tap Cancel'); return; }
    var c=activeChat(); if(!c) return;
    var i=c.messages.indexOf(m); if(i===-1) return;
    var next=c.messages[i+1];
    var wasDeep=!!(next && next.role==='ai' && next.deep);
    c.messages=c.messages.slice(0,i);
    renderMessages(); saveChats();
    askQuestion(nt, !!m.viaVoice, wasDeep);
  };
}
/* Edit an AI answer in place — the edited text is kept as the answer (markdown re-rendered) */
function startAiEdit(wrapEl, m){
  var body=wrapEl.querySelector('.ai-body'); if(!body || body.querySelector('.aiedit')) return;
  var ta=document.createElement('textarea'); ta.className='aiedit'; ta.value=m.plain||stripHtml(m.html); ta.setAttribute('aria-label','Edit this answer');
  var btns=document.createElement('div'); btns.className='msgedit-btns';
  btns.innerHTML='<button type="button" data-e="cancel">Cancel</button><button type="button" data-e="save">Save edit</button>';
  body.innerHTML=''; body.appendChild(ta); body.appendChild(btns); ta.focus();
  btns.querySelector('[data-e="cancel"]').onclick=function(){ renderMessages(); };
  btns.querySelector('[data-e="save"]').onclick=function(){
    var nt=ta.value.trim(); if(!nt){ toast('The answer is empty — write something or tap Cancel'); return; }
    m.plain=nt; m.html=mdToHtml(nt); m._fullHtml=m.html; m.edited=true;
    renderMessages(); saveChats(); toast('Answer updated');
  };
}

function modeChipHtml(m){
  /* The chip names the depth that actually produced this answer; an
     auto-routed answer says so, and the full routing decision (with its
     real reason) rides along as the chip's title. */
  var why=m.modeWhy?' title="'+esc(m.modeWhy)+'"':'';
  if(m.mega) return '<span class="modechip deep"'+why+'>Mega Deep Research</span>';
  if(m.deep) return '<span class="modechip deep"'+why+'>Deep Research'+(m.auto?' &middot; Auto':'')+'</span>';
  return '<span class="modechip"'+why+'>Normal'+(m.auto?' &middot; Auto':'')+'</span>';
}
/* P6 (v68): source-chip favicon with NO external fetch. A favicon supplied
   by the proxy is used only when it is a plain http(s) URL that is NOT
   Google's s2 favicon service — the proxy still emits s2 URLs today, so
   this guard also neutralises them until P2 stops emitting the field.
   Otherwise the chip shows the local globe icon from this page's own SVG
   sprite (#i-globe in index.html): no network request at all, and the chip
   keeps its icon instead of a broken / hidden <img>. */
function isGoogleFavicon(u){ return /^https?:\/\/www\.google\.com\/s2\/favicons/i.test(u||''); }
function srcFaviconHtml(s, dom){
  var f=s && s.favicon ? String(s.favicon) : '';
  if(f && /^https?:\/\//i.test(f) && !isGoogleFavicon(f)) return '<img class="favicon" alt="" loading="lazy" decoding="async" src="'+esc(f)+'" onerror="this.style.display=\'none\'">';
  return '<svg class="ic favicon-fallback" style="width:16px;height:16px;flex:0 0 16px" aria-hidden="true"><use href="#i-globe"/></svg>';
}
function buildMessageEl(m){
  var wrap=document.createElement('div');
  if(m.role==='user'){
    wrap.className='msg userrow';
    var isUrdu = m.lang==='urdu';
    var utl=timeLabelFor(m.ts||Date.now());
    var fhtml='';
    if(m.files && m.files.length){
      fhtml='<div class="filemeta">'+m.files.map(function(f){ return '<span class="filechip"><svg class="ic"><use href="#'+(f.kind==='image'?'i-img':'i-doc')+'"/></svg>'+esc(f.name)+'</span>'; }).join('')+'</div>';
      m.files.forEach(function(f){ if(f.kind==='image' && f.dataUrl) fhtml+='<img class="msgimg" src="'+f.dataUrl+'" alt="Attached image: '+esc(f.name)+'">'; });
    }
    var signedOutU=loadPref('enao_signed_out','0')==='1';
    var uname=signedOutU?'Guest':(loadPref('enao_name','Raja')||'Raja');
    /* A fenced code block inside the user's text renders as a real code block with its own Copy */
    var utext=m.text||'';
    var codeMatch=utext.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    var mainText=utext, codePart='';
    if(codeMatch){ codePart=codeMatch[1]; mainText=utext.replace(codeMatch[0],'').trim(); }
    var phtml='';
    if(mainText) phtml='<p class="'+(isUrdu?'urdu':'')+'">'+linkifyEsc(mainText)+'</p>';
    if(codePart) phtml+='<div class="codeblock"><button class="codecopy" type="button">Copy code</button><pre><code>'+highlightCode(codePart)+'</code></pre></div>';
    wrap.innerHTML='<div class="usermeta"><b>'+esc(uname)+'</b><span>'+esc(utl.date)+' &middot; '+esc(utl.time)+'</span>'+(m.viaVoice?'<span class="voicetag">Voice message</span>':'')+'</div>'
      +'<div class="bubble-col"><div class="avatar user">'+userAvatarInner()+'</div><div class="bubble" '+(isUrdu?'dir="rtl"':'')+'>'+fhtml+phtml+'<div class="bubble-foot"><span>'+esc(utl.time)+'</span><svg class="ic ticks" role="img" aria-label="Read"><use href="#i-ticks"/></svg></div></div></div>'
      +'<div class="useractions">'
      +'<button class="iconact" data-uact="copy" title="Copy this message" aria-label="Copy message"><svg class="ic"><use href="#i-copy"/></svg></button>'
      +'<button class="iconact" data-uact="edit" title="Edit this message and ask again" aria-label="Edit message"><svg class="ic"><use href="#i-pencil"/></svg></button>'
      +'<span class="msgmenu-wrap"><button class="iconact" data-uact="menu" title="Message options" aria-label="Message options" aria-haspopup="true"><svg class="ic"><use href="#i-dots"/></svg></button>'
      +'<span class="msgmenu" data-umenu hidden>'
      +'<button data-um="copy"><svg class="ic"><use href="#i-copy"/></svg> Copy message</button>'
      +'<button data-um="edit"><svg class="ic"><use href="#i-pencil"/></svg> Edit &amp; resend</button>'
      +'<button data-um="del" class="danger"><svg class="ic"><use href="#i-trash"/></svg> Delete message</button>'
      +'</span></span></div>';
    wrap.querySelector('[data-uact="copy"]').onclick=function(){ copyText(m.text||''); };
    wrap.querySelector('[data-uact="edit"]').onclick=function(){ startUserEdit(wrap, m); };
    var uMenuBtn=wrap.querySelector('[data-uact="menu"]'); var uMenu=wrap.querySelector('[data-umenu]');
    uMenuBtn.onclick=function(e){ e.stopPropagation(); var willOpen=uMenu.hidden; closeWsMenus(); uMenu.hidden=!willOpen; };
    uMenu.querySelector('[data-um="copy"]').onclick=function(){ uMenu.hidden=true; copyText(m.text||''); };
    uMenu.querySelector('[data-um="edit"]').onclick=function(){ uMenu.hidden=true; startUserEdit(wrap, m); };
    uMenu.querySelector('[data-um="del"]').onclick=function(){ uMenu.hidden=true; deleteMessage(m); };
    wrap.querySelectorAll('.codecopy').forEach(function(cb){ cb.onclick=function(){ var pre=cb.parentElement.querySelector('code'); copyText(pre?pre.textContent:''); }; });
    return wrap;
  }
  // AI — ENZO orb avatar (state-driven), name + full local timestamp, the rich
  // answer body, generated-content previews, and the full labelled action bar
  wrap.className='msg airow';
  var aiUrdu = m.lang==='urdu';
  var atl=timeLabelFor(m.ts||Date.now());
  var cNow=activeChat();
  var isStreamingThis = !!(state.isGenerating && cNow && cNow.messages.length && cNow.messages[cNow.messages.length-1]===m && !m.html);
  var bodyHtml=m.html||'';
  /* Generated media inside an answer becomes a preview card with only its own actions */
  var previewsHtml='';
  bodyHtml=bodyHtml.replace(/<img[^>]*?src="([^"]+)"[^>]*>/gi, function(all, src){
    previewsHtml+='<div class="genprev"><img src="'+esc(src)+'" alt="Generated image" loading="lazy"><div class="genprev-bar"><span class="gp-name">Generated image</span><span class="gp-time">'+esc(atl.date)+' &middot; '+esc(atl.time)+'</span><a class="gp-btn" href="'+esc(safeHttpUrl(src))+'" target="_blank" rel="noopener">Open</a><a class="gp-btn" href="'+esc(safeHttpUrl(src))+'" download>Download</a><button class="gp-btn" data-gen="copyimg" data-src="'+esc(src)+'">Copy link</button></div></div>';
    return '';
  });
  bodyHtml=bodyHtml.replace(/<video[^>]*?src="([^"]+)"[^>]*>([\s\S]*?)<\/video>/gi, function(all, src){
    previewsHtml+='<div class="genprev"><video src="'+esc(src)+'" controls preload="metadata"></video><div class="genprev-bar"><span class="gp-name">Generated video</span><span class="gp-time">'+esc(atl.date)+' &middot; '+esc(atl.time)+'</span><a class="gp-btn" href="'+esc(safeHttpUrl(src))+'" target="_blank" rel="noopener">Open</a><a class="gp-btn" href="'+esc(safeHttpUrl(src))+'" download>Download</a></div></div>';
    return '';
  });
  bodyHtml=bodyHtml.replace(/<audio[^>]*?src="([^"]+)"[^>]*>([\s\S]*?)<\/audio>/gi, function(all, src){
    previewsHtml+='<div class="genprev"><audio src="'+esc(src)+'" controls preload="metadata"></audio><div class="genprev-bar"><span class="gp-name">Generated audio</span><span class="gp-time">'+esc(atl.date)+' &middot; '+esc(atl.time)+'</span><a class="gp-btn" href="'+esc(safeHttpUrl(src))+'" download>Download</a></div></div>';
    return '';
  });
  var html='<div class="enzo-chat-av" data-chatav role="img" aria-label="ENZO avatar"></div><div class="acard">';
  html+='<div class="aimeta"><span class="aimeta-name">ENZO</span><span>'+esc(atl.date)+' &middot; '+esc(atl.time)+' &middot; '+esc(atl.daypartRoman)+'</span>'+modeChipHtml(m)+(m.edited?'<span class="modechip">Edited</span>':'')+'</div>';
  html+='<div class="ai-body'+(aiUrdu?' urdu':'')+'"'+(aiUrdu?' dir="rtl"':'')+'>'+bodyHtml+'</div>';
  html+=previewsHtml;
  /* Extra detail — the sources row and the next-question chips — stays hidden
     until this answer's own Resources button opens it (unchanged behaviour). */
  var resHtml='';
  if(m.sources && m.sources.length){
    var seenSrc={}; var uniqSrc=[];
    m.sources.forEach(function(s){ if(s && s.url && !seenSrc[s.url]){ seenSrc[s.url]=1; uniqSrc.push(s); } });
    var srcWord = m.deep ? 'References' : 'Sources';
    resHtml+='<div class="srcrow"><span class="srcrow-label"><svg class="ic"><use href="#i-link"/></svg> '+srcWord+':</span><div class="srcchips">';
    uniqSrc.forEach(function(s,i){
      var dom=s.domain||''; if(!dom){ try{ dom=new URL(s.url).hostname.replace(/^www\./,''); }catch(e){} }
      var dead = !((s.snippet||'').trim()) && !((s.extract||'').trim());
      var stitle = (s.title||'').trim() || dom || 'Web page';
      resHtml+='<a class="srcchip'+(i>=3?' src-extra':'')+(dead?' dead':'')+'" href="'+esc(safeHttpUrl(s.url))+'" target="_blank" rel="noopener" title="'+esc(stitle)+' — '+esc(s.url)+(dead?' (this page did not return readable content when ENZO checked it)':'')+'"><span class="srcchip-num">'+(i+1)+'</span>'+srcFaviconHtml(s, dom)+'<span class="srcchip-name">'+esc(dom||s.source||'Web')+'</span>'+srcDateHtml(s)+'</a>';
    });
    if(uniqSrc.length>3) resHtml+='<button class="srcchip srcmore" data-act="srcMore" title="Show all '+uniqSrc.length+' sources">+ '+(uniqSrc.length-3)+' more</button>';
    resHtml+='</div></div>';
  } else {
    resHtml+='<div class="res-empty">No web sources are attached to this answer — it was written from ENZO\'s own knowledge.</div>';
  }
  if(m.followups && m.followups.length){
    resHtml+='<div style="margin-top:12px;font-weight:700;font-size:13px">Next question — in one tap:</div><div class="followups">';
    m.followups.forEach(function(f){ resHtml+='<button data-follow="'+esc(f)+'">'+esc(f)+'</button>'; });
    resHtml+='</div>';
  }
  html+='<div class="respanel">'+resHtml+'</div>';
  /* While this answer is still generating, no option rows show under it — the
     action bar (with Resources) renders only once the answer is complete.
     Stopping mid-generation stays available on the composer's Stop button. */
  html+='<div class="acard-foot"'+(isStreamingThis?' style="display:none"':'')+'><div class="actions actbar" style="flex:1;margin-top:0">'
    +'<button class="actbtn" data-act="copy" title="Copy this answer"><svg class="ic"><use href="#i-copy"/></svg> Copy</button>'
    +'<button class="actbtn" data-act="edit" title="Edit this answer"><svg class="ic"><use href="#i-pencil"/></svg> Edit</button>'
    +(m.question?'<button class="actbtn" data-act="regen" title="Regenerate this answer, keeping the conversation context"><svg class="ic"><use href="#i-regen"/></svg> Regenerate</button>':'')
    +'<span class="sharewrap"><button class="actbtn" data-act="share" title="Share or export this answer" aria-haspopup="true"><svg class="ic"><use href="#i-share"/></svg> Share</button><span class="sharemenu" data-sharemenu hidden><button data-sh="native">Share via device&hellip;</button><button data-sh="copy">Copy answer text</button><button data-sh="download">Download as .txt</button></span></span>'
    +'<button class="actbtn" data-act="vbPlay" title="Listen to this answer aloud — tap again to pause, once more to resume"><svg class="ic"><use href="#i-speaker"/></svg> <span>'+(window.EnzoLang47?window.EnzoLang47.listenLabel('idle', m.lang||'en'):'Listen Aloud')+'</span></button>'
    +'<button class="actbtn" data-act="vbStop" title="Stop the voice" style="display:none"><svg class="ic"><use href="#i-stop"/></svg> Stop voice</button>'
    +'<span class="volmini" title="Voice volume for spoken answers"><svg class="ic"><use href="#i-speaker"/></svg><input type="range" min="0" max="1" step="0.1" value="'+state.voiceVolume+'" data-act="vbVol" aria-label="Voice volume"></span>'
    +'<button class="actbtn" data-act="like" title="I liked this answer" aria-label="Like this answer"><svg class="ic"><use href="#i-thumbup"/></svg> Like</button>'
    +'<button class="actbtn" data-act="dislike" title="This answer needs to be better" aria-label="Dislike this answer"><svg class="ic"><use href="#i-thumbdown"/></svg> Dislike</button>'
    +(isStreamingThis?'<button class="actbtn stopact" data-act="stopgen" title="Stop generating"><svg class="ic"><use href="#i-stop"/></svg> Stop</button>':'')
    +'<button class="actbtn resbtn" data-act="resources" aria-expanded="false" title="Show this answer\'s sources and follow-up ideas" style="margin-left:auto"><svg class="ic"><use href="#i-link"/></svg> <span>Resources</span><svg class="ic reschev"><use href="#i-chevr"/></svg></button>'
    +'</div></div>'
    +'</div>';
  wrap.innerHTML=html;
  if(window.ChatAvatar){ try{ ChatAvatar.mount(wrap, m, { isStreaming: isStreamingThis, isLast: !!(cNow && cNow.messages.length && cNow.messages[cNow.messages.length-1]===m) }); }catch(e){} }
  /* Resources button — expands/collapses this answer's hidden detail (sources + next-question chips) */
  var resBtn=wrap.querySelector('[data-act="resources"]');
  var resPanel=wrap.querySelector('.respanel');
  function openResources(){ if(resPanel && !resPanel.classList.contains('open')){ resPanel.classList.add('open'); if(resBtn){ resBtn.classList.add('open'); resBtn.setAttribute('aria-expanded','true'); } } }
  if(resBtn && resPanel) resBtn.onclick=function(){ var open=resPanel.classList.toggle('open'); resBtn.classList.toggle('open', open); resBtn.setAttribute('aria-expanded', open?'true':'false'); };
  /* The action bar is ALWAYS open — Copy, Edit, Regenerate, Share, Listen
     Aloud, Like, Dislike and Resources are all visible under every answer,
     with no toggle button hiding them (locked rule, 22 Nov 2026). */
  wrap.querySelector('[data-act="copy"]').onclick=function(){ copyText(m.plain||stripHtml(m.html)); };
  var edBtn=wrap.querySelector('[data-act="edit"]');
  if(edBtn) edBtn.onclick=function(){ startAiEdit(wrap, m); };
  /* Voice playback controls for this answer: Play → Pause → Resume on one button, Stop beside it, volume slider */
  var playBtn=wrap.querySelector('[data-act="vbPlay"]');
  if(playBtn) playBtn.onclick=function(){ playerToggle(wrap, m); };
  var vbStop=wrap.querySelector('[data-act="vbStop"]');
  if(vbStop) vbStop.onclick=function(){ playerStop(true); };
  var vbVol=wrap.querySelector('[data-act="vbVol"]');
  if(vbVol){ vbVol.value=state.voiceVolume; vbVol.addEventListener('input', function(){ state.voiceVolume=parseFloat(vbVol.value)||0; savePref('enao_voice_volume', String(state.voiceVolume)); var sv=$('voiceVolume'); if(sv) sv.value=state.voiceVolume; }); }
  if(player.el===null) syncVoiceBar(wrap);
  /* Citations [1], [2]… in the answer are clickable: they open the source list and highlight the exact source card */
  wrap.querySelectorAll('.ai-body .cite').forEach(function(cEl){
    var cm=(cEl.textContent||'').match(/\d+/); if(!cm) return;
    var cn=parseInt(cm[0],10);
    cEl.title='Show source '+cn+' below';
    cEl.onclick=function(){
      openResources();
      var chipsBox=wrap.querySelector('.srcchips');
      if(chipsBox && !chipsBox.classList.contains('expanded')){ chipsBox.classList.add('expanded'); var mb=wrap.querySelector('[data-act="srcMore"]'); if(mb) mb.style.display='none'; }
      var chips=wrap.querySelectorAll('.srcchips .srcchip:not(.srcmore)');
      var chip=chips[cn-1];
      if(chip){ chip.scrollIntoView({behavior:'smooth', block:'center'}); chip.classList.remove('flash'); void chip.offsetWidth; chip.classList.add('flash'); }
      else toast('Source '+cn+' is not in the saved list for this answer');
    };
  });
  var rg=wrap.querySelector('[data-act="regen"]');
  if(rg) rg.onclick=function(){ if(state.isGenerating){ toast('Wait for the current answer to finish'); return; } if(window.EnzoVoiceFix43){ window.EnzoVoiceFix43.patchRegenerate(m, (typeof cNow!=='undefined'?cNow:null)); } else { askQuestion(m.question, !!m.viaVoice, !!m.deep); } };
  var rsb=wrap.querySelector('[data-act="retrySearch"]');
  /* Piece 43: Retry re-probes the backend FIRST and runs the REAL backend
     ask when it answers. It never re-runs in a falsely-flagged fallback. */
  if(rsb) rsb.onclick=function(){ if(state.isGenerating){ toast('Wait for the current answer to finish'); return; } if(m.question) window.EnzoAskRecovery.retryAsk(m.question, {
    deep: !!m.deep, viaVoice: !!m.viaVoice, lang: (window.EnzoLang45 ? window.EnzoLang45.askLang(m.question, state.langPref, detectLang) : detectLang(m.question)),
    runBackend: function (q, o) {
      /* Piece 42 already drove v2Up to true from the checkHealth verdict
         (WIRING-42 §1 subscriber), so no flag is set here — just clear
         the cached gate and re-enter the normal ask wrapper, which now
         routes to backendAsk and the P-F runBackendAsk59 route. */
      if (window.__enzoBackendGate59) window.__enzoBackendGate59.ok = true;
      askQuestion(q, o.viaVoice, o.deep);
      return Promise.resolve({ path: 'backend' });
    },
    runFallback: function (q, o) {
      /* Sustained unreachable only: piece 42's checkHealth verdict
         already set the state down, so askQuestion routes to the legacy
         pipeline. The honest one-line notice (o.notice) is attached at
         delivery by W4. */
      askQuestion(q, o.viaVoice, o.deep);
      return Promise.resolve({ path: 'fallback', notice: o.notice });
    },
    /* setUp is a seam for environments without piece 42. With piece 42
       present it is a no-op by design: checkHealth already drove v2Up. */
    setUp: function (up, probe) {},
    onRecovered: function (probe) { /* flag cleared by piece 42; the next ask uses the backend */ }
  }); };
  /* Share opens options first — nothing ever leaves the device without the user's tap */
  var shBtn=wrap.querySelector('[data-act="share"]'); var shMenu=wrap.querySelector('[data-sharemenu]');
  if(shBtn && shMenu){
    shBtn.onclick=function(e){ e.stopPropagation(); var willOpen=shMenu.hidden; closeWsMenus(); shMenu.hidden=!willOpen; };
    shMenu.querySelector('[data-sh="native"]').onclick=function(){ shMenu.hidden=true; shareText('ENZO AI answer', m.plain||stripHtml(m.html)); };
    shMenu.querySelector('[data-sh="copy"]').onclick=function(){ shMenu.hidden=true; copyText(m.plain||stripHtml(m.html)); };
    shMenu.querySelector('[data-sh="download"]').onclick=function(){ shMenu.hidden=true; downloadTextFile('ENZO answer.txt', m.plain||stripHtml(m.html)); };
  }
  var sgBtn=wrap.querySelector('[data-act="stopgen"]');
  if(sgBtn) sgBtn.onclick=function(){ stopGeneration(); };
  wrap.querySelectorAll('[data-gen="copyimg"]').forEach(function(b){
    b.onclick=function(){
      var s=b.getAttribute('data-src')||'';
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(s).then(function(){ toast('Image link copied'); }, function(){ fallbackCopy(s); }); }
      else fallbackCopy(s);
    };
  });
  var likeBtn=wrap.querySelector('[data-act="like"]'); var disBtn=wrap.querySelector('[data-act="dislike"]');
  if(m.rating==='like') likeBtn.classList.add('on');
  if(m.rating==='dislike') disBtn.classList.add('on');
  likeBtn.onclick=function(){ m.rating = m.rating==='like' ? '' : 'like'; likeBtn.classList.toggle('on', m.rating==='like'); disBtn.classList.remove('on'); saveChats(); toast(m.rating==='like'?'Thank you! Rating noted':'Rating removed'); };
  disBtn.onclick=function(){ m.rating = m.rating==='dislike' ? '' : 'dislike'; disBtn.classList.toggle('on', m.rating==='dislike'); likeBtn.classList.remove('on'); saveChats(); toast(m.rating==='dislike'?'Noted — the next answer will be better':'Rating removed'); };
  var sm=wrap.querySelector('[data-act="srcMore"]');
  if(sm) sm.onclick=function(){ var box=wrap.querySelector('.srcchips'); if(box) box.classList.add('expanded'); sm.style.display='none'; };
  wrap.querySelectorAll('.codecopy').forEach(function(cb){ cb.onclick=function(){ var pre=cb.parentElement.querySelector('code'); copyText(pre?pre.textContent:''); }; });
  var fbtns=wrap.querySelectorAll('[data-follow]');
  for(var i=0;i<fbtns.length;i++){ (function(b){ b.onclick=function(){ $('input').value=b.getAttribute('data-follow'); sendCurrent(); }; })(fbtns[i]); }
  return wrap;
}
function buildMessageElLegacy(m){
  var wrap=document.createElement('div');
  if(m.role==='user'){
    wrap.className='msg userrow';
    var isUrdu = m.lang==='urdu';
    var utl=timeLabelFor(m.ts||Date.now());
    var fhtml='';
    if(m.files && m.files.length){
      fhtml='<div class="filemeta">'+m.files.map(function(f){ return '<span class="filechip"><svg class="ic"><use href="#'+(f.kind==='image'?'i-img':'i-doc')+'"/></svg>'+esc(f.name)+'</span>'; }).join('')+'</div>';
      m.files.forEach(function(f){ if(f.kind==='image' && f.dataUrl) fhtml+='<img class="msgimg" src="'+f.dataUrl+'" alt="Attached image: '+esc(f.name)+'">'; });
    }
    wrap.innerHTML='<div class="avatar user">'+userAvatarInner()+'</div><div class="bubble" '+(isUrdu?'dir="rtl"':'')+'>'+fhtml+'<p class="'+(isUrdu?'urdu':'')+'">'+esc(m.text)+'</p><div class="bubble-foot"><span>'+esc(utl.time)+'</span><svg class="ic ticks" role="img" aria-label="Read"><use href="#i-ticks"/></svg></div></div>';
    return wrap;
  }
  // AI — the answer sits in one large white card, a small round ENZO avatar at its left,
  // and the quick actions (copy, share, regenerate, like, dislike) as icons at the card's top right
  wrap.className='msg airow';
  var aiUrdu = m.lang==='urdu';
  var html='<div class="avatar ai"><svg class="ic"><use href="#i-brain"/></svg></div><div class="acard">';
  html+='<div class="acard-actions">'
    +'<button class="iconact" data-act="copy" title="Copy this answer" aria-label="Copy answer"><svg class="ic"><use href="#i-copy"/></svg></button>'
    +'<button class="iconact" data-act="share" title="Share this answer" aria-label="Share answer"><svg class="ic"><use href="#i-share"/></svg></button>'
    +(m.question?'<button class="iconact" data-act="regen" title="Regenerate this answer" aria-label="Regenerate answer"><svg class="ic"><use href="#i-regen"/></svg></button>':'')
    +'<button class="iconact" data-act="like" title="I liked this answer" aria-label="Like this answer"><svg class="ic"><use href="#i-thumbup"/></svg></button>'
    +'<button class="iconact" data-act="dislike" title="This answer needs to be better" aria-label="Dislike this answer"><svg class="ic"><use href="#i-thumbdown"/></svg></button>'
    +'</div>';
  html+='<div class="ai-body'+(aiUrdu?' urdu':'')+'"'+(aiUrdu?' dir="rtl"':'')+'>'+m.html+'</div>';
  /* Extra detail — the sources row and the next-question chips — is NOT shown by default.
     It lives in a hidden Resources panel that only this answer's Resources button opens. */
  var resHtml='';
  if(m.sources && m.sources.length){
    var seenSrc={}; var uniqSrc=[];
    m.sources.forEach(function(s){ if(s && s.url && !seenSrc[s.url]){ seenSrc[s.url]=1; uniqSrc.push(s); } });
    var srcWord = m.deep ? 'References' : 'Sources';
    /* One row of small chips — number, favicon, site name, the actual link. Only pages ENZO
       really found and read ever appear here; the rest wait behind the "+ N more" chip. */
    resHtml+='<div class="srcrow"><span class="srcrow-label"><svg class="ic"><use href="#i-link"/></svg> '+srcWord+':</span><div class="srcchips">';
    uniqSrc.forEach(function(s,i){
      var dom=s.domain||''; if(!dom){ try{ dom=new URL(s.url).hostname.replace(/^www\./,''); }catch(e){} }
      var dead = !((s.snippet||'').trim()) && !((s.extract||'').trim());
      var stitle = (s.title||'').trim() || dom || 'Web page';
      resHtml+='<a class="srcchip'+(i>=3?' src-extra':'')+(dead?' dead':'')+'" href="'+esc(safeHttpUrl(s.url))+'" target="_blank" rel="noopener" title="'+esc(stitle)+' — '+esc(s.url)+(dead?' (this page did not return readable content when ENZO checked it)':'')+'"><span class="srcchip-num">'+(i+1)+'</span>'+srcFaviconHtml(s, dom)+'<span class="srcchip-name">'+esc(dom||s.source||'Web')+'</span>'+srcDateHtml(s)+'</a>';
    });
    if(uniqSrc.length>3) resHtml+='<button class="srcchip srcmore" data-act="srcMore" title="Show all '+uniqSrc.length+' sources">+ '+(uniqSrc.length-3)+' more</button>';
    resHtml+='</div></div>';
  } else {
    /* No sources: the panel says so honestly — nothing is invented to fill it. */
    resHtml+='<div class="res-empty">No web sources are attached to this answer — it was written from ENZO\'s own knowledge.</div>';
  }
  if(m.followups && m.followups.length){
    resHtml+='<div style="margin-top:12px;font-weight:700;font-size:13px">Next question — in one tap:</div><div class="followups">';
    m.followups.forEach(function(f){ resHtml+='<button data-follow="'+esc(f)+'">'+esc(f)+'</button>'; });
    resHtml+='</div>';
  }
  html+='<div class="respanel">'+resHtml+'</div>';
  var atl=timeLabelFor(m.ts||Date.now());
  html+='<div class="acard-foot"><div class="msg-meta"><span class="dp">'+esc(atl.daypartRoman)+'</span><span>'+esc(atl.date)+' • '+esc(atl.time)+'</span>'+modeChipHtml(m)+'</div>';
  html+='<div class="actions acard-voice">'
    +'<button class="actionbtn resbtn" data-act="resources" aria-expanded="false" title="Show this answer\'s sources and follow-up ideas"><svg class="ic"><use href="#i-link"/></svg> <span>Resources</span><svg class="ic reschev"><use href="#i-chevr"/></svg></button>'
    +'<button class="actionbtn" data-act="vbPlay" title="Play this answer aloud — tap again to pause, once more to resume"><svg class="ic"><use href="#i-speaker"/></svg> <span>'+(window.EnzoLang47?window.EnzoLang47.listenLabel('idle', m.lang||'en'):'Listen Aloud')+'</span></button>'
    +'<button class="actionbtn" data-act="vbStop" title="Stop the voice" style="display:none"><svg class="ic"><use href="#i-stop"/></svg> Stop</button>'
    +'<span class="volmini" title="Voice volume for spoken answers"><svg class="ic"><use href="#i-speaker"/></svg><input type="range" min="0" max="1" step="0.1" value="'+state.voiceVolume+'" data-act="vbVol" aria-label="Voice volume"></span>'
    +'</div></div>'
    +'</div>';
  wrap.innerHTML=html;
  /* Resources button — expands/collapses this answer's hidden detail (sources + next-question chips) */
  var resBtn=wrap.querySelector('[data-act="resources"]');
  var resPanel=wrap.querySelector('.respanel');
  function openResources(){ if(resPanel && !resPanel.classList.contains('open')){ resPanel.classList.add('open'); if(resBtn){ resBtn.classList.add('open'); resBtn.setAttribute('aria-expanded','true'); } } }
  if(resBtn && resPanel) resBtn.onclick=function(){ var open=resPanel.classList.toggle('open'); resBtn.classList.toggle('open', open); resBtn.setAttribute('aria-expanded', open?'true':'false'); };
  wrap.querySelector('[data-act="copy"]').onclick=function(){ copyText(m.plain||stripHtml(m.html)); };
  /* Voice playback controls for this answer: Play → Pause → Resume on one button, Stop beside it, volume slider */
  var playBtn=wrap.querySelector('[data-act="vbPlay"]');
  if(playBtn) playBtn.onclick=function(){ playerToggle(wrap, m); };
  var vbStop=wrap.querySelector('[data-act="vbStop"]');
  if(vbStop) vbStop.onclick=function(){ playerStop(true); };
  var vbVol=wrap.querySelector('[data-act="vbVol"]');
  if(vbVol){ vbVol.value=state.voiceVolume; vbVol.addEventListener('input', function(){ state.voiceVolume=parseFloat(vbVol.value)||0; savePref('enao_voice_volume', String(state.voiceVolume)); var sv=$('voiceVolume'); if(sv) sv.value=state.voiceVolume; }); }
  if(player.el===null) syncVoiceBar(wrap);
  /* Citations [1], [2]… in the answer are clickable: they open the source list and highlight the exact source card */
  wrap.querySelectorAll('.ai-body .cite').forEach(function(cEl){
    var cm=(cEl.textContent||'').match(/\d+/); if(!cm) return;
    var cn=parseInt(cm[0],10);
    cEl.title='Show source '+cn+' below';
    cEl.onclick=function(){
      openResources();
      var chipsBox=wrap.querySelector('.srcchips');
      if(chipsBox && !chipsBox.classList.contains('expanded')){ chipsBox.classList.add('expanded'); var mb=wrap.querySelector('[data-act="srcMore"]'); if(mb) mb.style.display='none'; }
      var chips=wrap.querySelectorAll('.srcchips .srcchip:not(.srcmore)');
      var chip=chips[cn-1];
      if(chip){ chip.scrollIntoView({behavior:'smooth', block:'center'}); chip.classList.remove('flash'); void chip.offsetWidth; chip.classList.add('flash'); }
      else toast('Source '+cn+' is not in the saved list for this answer');
    };
  });
  var rg=wrap.querySelector('[data-act="regen"]');
  if(rg) rg.onclick=function(){ if(state.isGenerating){ toast('Wait for the current answer to finish'); return; } if(window.EnzoVoiceFix43){ window.EnzoVoiceFix43.patchRegenerate(m, (typeof cNow!=='undefined'?cNow:null)); } else { askQuestion(m.question, !!m.viaVoice, !!m.deep); } };
  var rsb=wrap.querySelector('[data-act="retrySearch"]');
  /* Piece 43: Retry re-probes the backend FIRST and runs the REAL backend
     ask when it answers. It never re-runs in a falsely-flagged fallback. */
  if(rsb) rsb.onclick=function(){ if(state.isGenerating){ toast('Wait for the current answer to finish'); return; } if(m.question) window.EnzoAskRecovery.retryAsk(m.question, {
    deep: !!m.deep, viaVoice: !!m.viaVoice, lang: (window.EnzoLang45 ? window.EnzoLang45.askLang(m.question, state.langPref, detectLang) : detectLang(m.question)),
    runBackend: function (q, o) {
      /* Piece 42 already drove v2Up to true from the checkHealth verdict
         (WIRING-42 §1 subscriber), so no flag is set here — just clear
         the cached gate and re-enter the normal ask wrapper, which now
         routes to backendAsk and the P-F runBackendAsk59 route. */
      if (window.__enzoBackendGate59) window.__enzoBackendGate59.ok = true;
      askQuestion(q, o.viaVoice, o.deep);
      return Promise.resolve({ path: 'backend' });
    },
    runFallback: function (q, o) {
      /* Sustained unreachable only: piece 42's checkHealth verdict
         already set the state down, so askQuestion routes to the legacy
         pipeline. The honest one-line notice (o.notice) is attached at
         delivery by W4. */
      askQuestion(q, o.viaVoice, o.deep);
      return Promise.resolve({ path: 'fallback', notice: o.notice });
    },
    /* setUp is a seam for environments without piece 42. With piece 42
       present it is a no-op by design: checkHealth already drove v2Up. */
    setUp: function (up, probe) {},
    onRecovered: function (probe) { /* flag cleared by piece 42; the next ask uses the backend */ }
  }); };
  wrap.querySelector('[data-act="share"]').onclick=function(){ shareText('ENZO AI answer', m.plain||stripHtml(m.html)); };
  var likeBtn=wrap.querySelector('[data-act="like"]'); var disBtn=wrap.querySelector('[data-act="dislike"]');
  if(m.rating==='like') likeBtn.classList.add('on');
  if(m.rating==='dislike') disBtn.classList.add('on');
  likeBtn.onclick=function(){ m.rating = m.rating==='like' ? '' : 'like'; likeBtn.classList.toggle('on', m.rating==='like'); disBtn.classList.remove('on'); saveChats(); toast(m.rating==='like'?'Thank you! Rating noted':'Rating removed'); };
  disBtn.onclick=function(){ m.rating = m.rating==='dislike' ? '' : 'dislike'; disBtn.classList.toggle('on', m.rating==='dislike'); likeBtn.classList.remove('on'); saveChats(); toast(m.rating==='dislike'?'Noted — the next answer will be better':'Rating removed'); };
  var sm=wrap.querySelector('[data-act="srcMore"]');
  if(sm) sm.onclick=function(){ var box=wrap.querySelector('.srcchips'); if(box) box.classList.add('expanded'); sm.style.display='none'; };
  wrap.querySelectorAll('.codecopy').forEach(function(cb){ cb.onclick=function(){ var pre=cb.parentElement.querySelector('code'); copyText(pre?pre.textContent:''); }; });
  var fbtns=wrap.querySelectorAll('[data-follow]');
  for(var i=0;i<fbtns.length;i++){ (function(b){ b.onclick=function(){ $('input').value=b.getAttribute('data-follow'); sendCurrent(); }; })(fbtns[i]); }
  return wrap;
}
function stripHtml(h){ var d=document.createElement('div'); d.innerHTML=h||''; return d.textContent||''; }
function copyText(t){
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(function(){ toast('Answer copied'); }, function(){ fallbackCopy(t); }); }
  else fallbackCopy(t);
}
function fallbackCopy(t){ var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy'); toast('Answer copied');}catch(e){ toast('Copy failed — long-press the answer text to copy it'); } document.body.removeChild(ta); }

