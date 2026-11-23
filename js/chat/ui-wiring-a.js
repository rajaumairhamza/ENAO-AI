/* ---------- UI WIRING ---------- */
function autoGrow(){ var ta=$('input'); ta.style.height='auto'; ta.style.height=Math.min(132, ta.scrollHeight)+'px'; }
function syncDeepUI(){
  /* No mode-selection UI exists. The visible traces of the routing are the
     header tint and the slim off bar — both belong ONLY to the explicit
     per-chat override (Deep Research forced ON) — plus the decision line in
     each answer's live task checklist and the mode chip on the answer. In
     Auto mode there is no tint and no bar: the next question is routed
     fresh, so there is nothing standing to switch off. */
  document.body.classList.toggle('deep-on', chatMode()==='deep');
  var db=$('deepBar'); if(db) db.hidden=chatMode()!=='deep';
  var inp=$('input');
  if(inp) inp.placeholder = 'Ask anything...';
}
function setChatMode(mode, silent){
  /* Per-chat override: it lands on the current chat and is saved with it, so
     it can never leak into other chats. With no chat open it stays pending
     and the first chat created takes it over (see createChat). 'deep' keeps
     the chat Deep, 'normal' keeps it Normal, 'auto' hands every question
     back to detectIntent(). c.deep is kept in sync for older saved data. */
  var c=activeChat();
  if(c){ c.mode=mode; c.deep=(mode==='deep'); state.pendingMode='auto'; state.deep=false; saveChats(); }
  else { state.pendingMode=mode; state.deep=(mode==='deep'); }
  syncDeepUI();
  if(silent) return;
  if(mode==='deep') toast('Deep Research ON for this chat — every answer uses more sources, a longer report');
  else if(mode==='normal') toast('Deep Research OFF for this chat — answers stay Normal. Tools, Deep Research, returns this chat to Auto.');
  else toast('Auto routing for this chat — ENZO decides the depth of each question itself');
}
function setDeep(v){ setChatMode(v?'deep':'normal'); }
var deepOffBtnEl=$('deepOffBtn');
if(deepOffBtnEl) deepOffBtnEl.onclick=function(){ setChatMode('normal'); };
$('sendBtn').onclick=sendCurrent;
/* Mic tap starts a live voice CALL: the mic is replaced by the Call button
   in the same spot, ENZO listens continuously, answers out loud, then
   listens again — a real back-and-forth conversation until the Call button
   is tapped again to end it and bring the mic back. */
function startVoiceCall(){
  if(state.voiceLive) return;
  if(player.playing || player.paused) playerStop(false);
  /* v55 P7: the voice-ID gate sits on this call mic path — every utterance is checked by EnzoVoiceID (verifyVoice via gateAndRoute) at r.onresult before it reaches the pipeline. */
  state.voiceIdGateOnMic = !!(window.EnzoVoiceID && window.EnzoVoiceID.gateAndRoute);
  turnMicOn();
  syncComposerSlot();
}
function endVoiceCall(){
  if(state.voiceLive) turnMicOff();
  stopSpeaking();
  syncComposerSlot();
}
$('micBtn').onclick=function(){ startVoiceCall(); };
var callBtnEl=$('callBtn'); if(callBtnEl) callBtnEl.onclick=function(){ endVoiceCall(); };
syncComposerSlot();
setVoiceState('off');
watchMicPermission();
$('input').addEventListener('input', function(){ state.nextAskViaVoice=false; state.lastTypeAt=Date.now(); autoGrow(); });
$('input').addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendCurrent(); } });
$('newChatBtn').onclick=function(){ createChat('New Chat'); renderMessages(); $('input').focus(); $('sidebar').classList.remove('open'); };
$('historySearch').addEventListener('input', renderChatList);
function syncSpeakToggle(){
  var md=answersMode(); var btn=$('speakToggle'); if(!btn) return;
  var lbl=btn.querySelector('.vb-label'); if(lbl) lbl.textContent=(md==='on'?'On':(md==='off'?'Off':'Auto'));
  btn.classList.toggle('on', md==='on');
  btn.classList.toggle('aloud-on', md!=='off');
  btn.title = md==='on' ? 'Answers aloud: ON — every answer is spoken aloud. Tap to change'
    : md==='off' ? 'Answers aloud: OFF — answers are never spoken automatically (Listen Aloud on an answer still works). Tap to change'
    : 'Answers: Auto — typed questions get text-only answers, voice questions get spoken answers. Tap to change';
}
/* No Answers-aloud toggle exists any more: the behaviour is permanently the
   automatic locked rule — typed questions get text-only answers, voice and
   call questions get spoken answers. Any older saved on/off choice is reset
   to Auto so the rule always holds. */
try{ localStorage.removeItem('enao_answers_aloud'); }catch(e){}
syncSpeakToggle();
/* Voice volume in Settings drives the same setting as the per-answer sliders */
var vvEl=$('voiceVolume');
if(vvEl){ vvEl.value=state.voiceVolume; vvEl.addEventListener('input', function(){ state.voiceVolume=parseFloat(vvEl.value)||0; savePref('enao_voice_volume', String(state.voiceVolume)); }); }
/* ---------- PIECE 1 WIRING — theme toggle, sidebar collapse, folders, profile ---------- */
/* There is no theme switch: the site is permanently the dark navy design.
   These stubs stay only because older wiring still calls them — they can
   never flip the page to a light theme. */
function effectiveTheme(){ return 'dark'; }
function syncThemeBtn(){}
function applyThemeChoice(){ document.documentElement.setAttribute('data-theme','dark'); }
function syncSidebarBtn(){
  var collapsed=document.body.classList.contains('sb-collapsed');
  $('expandBtn').style.display=collapsed?'grid':'none';
}
$('collapseBtn').onclick=function(){
  document.body.classList.add('sb-collapsed'); savePref('enao_sb','1');
  $('sidebar').classList.remove('open'); syncSidebarBtn();
};
$('expandBtn').onclick=function(){
  if(window.__enzoMobileUI()){ $('sidebar').classList.add('open'); return; }
  document.body.classList.remove('sb-collapsed'); savePref('enao_sb','0'); syncSidebarBtn();
};
if(loadPref('enao_sb','0')==='1' && !window.__enzoMobileUI()) document.body.classList.add('sb-collapsed');
syncSidebarBtn(); syncThemeBtn();
document.querySelectorAll('#folderRow .folderchip').forEach(function(chip){
  chip.onclick=function(){
    state.folderFilter=chip.getAttribute('data-folder')||'all'; state.menuChatId=null;
    document.querySelectorAll('#folderRow .folderchip').forEach(function(x){ x.classList.toggle('on', x===chip); });
    renderChatList();
  };
});
/* Restyle R1 wiring — See all, search filter toggle, folders +, sidebar sign-out */
$('seeAllBtn').onclick=function(){
  state.folderFilter='all'; state.menuChatId=null;
  var hs=$('historySearch'); if(hs) hs.value='';
  document.querySelectorAll('#folderRow .folderchip').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-folder')==='all'); });
  renderChatList();
};
$('searchFilterBtn').onclick=function(){
  var fb=$('foldersBox'); if(!fb) return;
  var hide=fb.style.display!=='none';
  fb.style.display=hide?'none':'';
  toast(hide?'Chat folders hidden — tap the filter icon to bring them back':'Chat folders shown');
};
$('folderAddBtn').onclick=function(){
  toast('Folders are fixed: Personal, Work, Research and Projects. Open any chat\'s actions menu to move it into a folder.');
};
$('logoutBtn').onclick=function(){ var b=$('signOutBtn'); if(b) b.click(); };
$('menuBtn').onclick=function(){ $('sidebar').classList.toggle('open'); };
$('aboutBtn').onclick=function(){ openModal('aboutModal'); };
$('renameSave').onclick=function(){
  var c=null; state.chats.forEach(function(x){ if(x.id===state.renameId) c=x; });
  if(c && $('renameInput').value.trim()) c.title=$('renameInput').value.trim();
  renderChatList(); saveChats(); closeModal('renameModal'); toast('Name changed');
};
document.querySelectorAll('.modal').forEach(function(m){ m.addEventListener('click', function(e){ if(e.target===m) m.classList.remove('open'); }); });
var exBtns=document.querySelectorAll('#examples .ex');
exBtns.forEach(function(b){ b.onclick=function(){ var t=b.childNodes[0].textContent.trim(); askQuestion(t); }; });

/* Hero tool chips — every chip runs the real thing it names, nothing decorative */
$('chipWeb').onclick=function(){
  var cleared=chatMode()==='deep';
  if(cleared) setChatMode('auto', true);
  var inp=$('input'); inp.scrollIntoView({behavior:'smooth',block:'center'}); inp.focus();
  toast(cleared ? 'Web Search — Deep Research override cleared, Auto routing is back on. Type your question.' : 'Web Search — type your question and ENZO searches the live internet');
};
$('chipDeep').onclick=function(){
  setChatMode('deep');
  var inp=$('input'); inp.scrollIntoView({behavior:'smooth',block:'center'}); inp.focus();
};
$('chipImage').onclick=function(){ openTool('imagegen'); };
$('chipFile').onclick=function(){ var fi=$('fileInput'); fi.accept='image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md'; fi.click(); };
$('chipCode').onclick=function(){ openTool('code'); };

/* ---------- PIECE 2 WIRING — typing indicator, smart scrolling, attachments ---------- */
/* The ONLY generating indicator in the chat area: three animated dots plus one
   short status word that follows the real pipeline stage — Thinking… while the
   question is understood and routed, Searching… while live sources are being
   fetched and read, Writing… while the answer itself is composed. No checklist
   card, no chips, no option rows appear under the chat while generating. */
function setTypingStatus(word){
  var l=$('typingLabel'); if(l) l.textContent=word;
  var tr=$('typingRow');
  if(tr){ var dots=tr.querySelector('.typing'); if(dots) dots.setAttribute('aria-label','ENZO is '+word.replace(/…/g,'').toLowerCase()); }
}
function showTyping(){
  var t=$('typingRow'); if(!t) return;
  setTypingStatus('Thinking…');
  t.style.display='flex';
  if(state.nearBottom) $('scrollArea').scrollTop=$('scrollArea').scrollHeight;
}
function hideTyping(){ var t=$('typingRow'); if(t) t.style.display='none'; }

/* Smart scrolling: near the bottom the chat follows new messages; scrolled up to read
   an older message, nothing ever pulls the reader back down — a button offers the way back. */
(function(){
  var sa=$('scrollArea'); if(!sa) return;
  sa.addEventListener('scroll', function(){
    state.nearBottom = (sa.scrollHeight - sa.scrollTop - sa.clientHeight) < 140;
    $('scrollDownBtn').classList.toggle('show', !state.nearBottom);
  });
  $('scrollDownBtn').onclick=function(){ sa.scrollTo({top:sa.scrollHeight, behavior:'smooth'}); };
})();

/* Attachments: type + size validation, real read progress, previews, remove before sending */
var MAX_FILE_BYTES=10*1024*1024;
var DOC_EXTS=['pdf','doc','docx','xls','xlsx','csv','txt','md'];
var TEXT_EXTS=['txt','md','csv'];
function fmtFileSize(n){
  if(n<1024) return n+' B';
  if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
  return (n/(1024*1024)).toFixed(1)+' MB';
}
function renderAttachRow(){
  var row=$('attachRow'); if(!row) return;
  row.innerHTML='';
  row.classList.toggle('show', state.pendingFiles.length>0);
  state.pendingFiles.forEach(function(f, idx){
    var chip=document.createElement('div'); chip.className='attachchip';
    var thumb=(f.kind==='image' && f.dataUrl)
      ? '<img src="'+f.dataUrl+'" alt="Preview of '+esc(f.name)+'">'
      : '<svg class="ic ic-lg"><use href="#i-doc"/></svg>';
    var sub=fmtFileSize(f.size)+(f.progress<100 ? ' • Reading '+f.progress+'%' : ' • Ready to send');
    chip.innerHTML=thumb+'<div style="min-width:0"><div class="ac-name" title="'+esc(f.name)+'">'+esc(f.name)+'</div><div class="ac-sub">'+esc(sub)+'</div><div class="ac-progress"><i style="width:'+(f.progress||0)+'%"></i></div></div>'
      +'<button class="ac-x" type="button" aria-label="Remove attachment '+esc(f.name)+'" title="Remove this attachment before sending">×</button>';
    chip.querySelector('.ac-x').onclick=function(){ state.pendingFiles.splice(idx,1); renderAttachRow(); syncSendBtn(); $('input').focus(); };
    row.appendChild(chip);
  });
}
function handleFiles(list){
  Array.prototype.forEach.call(list, function(f){
    var ext=((f.name.split('.').pop()||'').toLowerCase());
    var isImg=f.type.indexOf('image/')===0;
    if(!isImg && DOC_EXTS.indexOf(ext)===-1){ toast('“'+f.name+'” is not a supported type — use an image, PDF, Word, Excel, CSV or text file'); return; }
    if(isImg && ['png','jpg','jpeg','gif','webp'].indexOf(ext)===-1 && f.type.indexOf('image/svg')===0){ toast('“'+f.name+'” — SVG images are not supported'); return; }
    if(f.size>MAX_FILE_BYTES){ toast('“'+f.name+'” is '+fmtFileSize(f.size)+' — the limit is 10 MB per file'); return; }
    if(state.pendingFiles.length>=5){ toast('Up to 5 files per message'); return; }
    var rec={name:f.name, kind:isImg?'image':'doc', size:f.size, text:'', dataUrl:'', progress:0, file:f};
    state.pendingFiles.push(rec); renderAttachRow(); syncSendBtn();
    var reader=new FileReader();
    reader.onprogress=function(ev){ if(ev.lengthComputable){ rec.progress=Math.min(99, Math.round(ev.loaded/ev.total*100)); renderAttachRow(); } };
    reader.onload=function(){
      rec.progress=100;
      if(isImg) rec.dataUrl=reader.result;
      else if(TEXT_EXTS.indexOf(ext)>-1) rec.text=String(reader.result||'');
      renderAttachRow();
    };
    reader.onerror=function(){ rec.progress=100; renderAttachRow(); toast('“'+f.name+'” could not be read — it will be attached by name only'); };
    if(isImg) reader.readAsDataURL(f); else reader.readAsText(f);
  });
}
$('attachBtn').onclick=function(e){
  e.stopPropagation();
  var m=$('attachMenu'); m.hidden=!m.hidden;
};
$('amAttach').onclick=function(){ $('attachMenu').hidden=true; var fi=$('fileInput'); fi.accept='image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md'; fi.click(); };
$('amImage').onclick=function(){ $('attachMenu').hidden=true; var fi=$('fileInput'); fi.accept='image/*'; fi.click(); };
$('amDoc').onclick=function(){ $('attachMenu').hidden=true; var fi=$('fileInput'); fi.accept='.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md'; fi.click(); };
$('amTools').onclick=function(){ $('attachMenu').hidden=true; openTools(); };
document.addEventListener('click', function(e){
  var m=$('attachMenu'); if(!m || m.hidden) return;
  if(!m.contains(e.target) && !$('attachBtn').contains(e.target)) m.hidden=true;
});
$('fileInput').addEventListener('change', function(){ if(this.files && this.files.length) handleFiles(this.files); this.value=''; });
$('input').addEventListener('input', syncSendBtn);
syncSendBtn();

/* Confirmation dialog — the Yes button runs the pending action (chat delete and friends) */
$('confirmYes').onclick=function(){
  var cb=confirmCb; confirmCb=null;
  closeModal('confirmModal');
  if(cb) cb();
};

