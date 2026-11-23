/* ---------- PIECE 5 — keyboard & menu polish: Escape closes the topmost layer, an outside
   click closes the chat actions menu, and Enter confirms a rename ---------- */
document.addEventListener('keydown', function(e){
  if(e.key!=='Escape') return;
  var open=document.querySelector('.modal.open');
  if(open){ open.classList.remove('open'); return; }
  var am=$('attachMenu'); if(am && !am.hidden){ am.hidden=true; return; }
  if(state.menuChatId){ state.menuChatId=null; renderChatList(); return; }
  $('sidebar').classList.remove('open');
});
document.addEventListener('click', function(e){
  if(state.menuChatId && !(e.target.closest && e.target.closest('.chat-item'))){ state.menuChatId=null; renderChatList(); }
});
$('renameInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); $('renameSave').click(); } });

/* ---------- P-C — workspace head wiring: title, conversation menu, model ---------- */
function syncWsHead(){
  var t=$('wsTitle'); if(!t || t.querySelector('input')) return;
  var c=activeChat();
  if(!c){ t.textContent='New Chat'; var s0=$('wsSub'); if(s0) s0.textContent=''; return; }
  t.textContent=c.title||'New Chat';
  var n=(c.messages||[]).length;
  var started=c.created?timeLabelFor(c.created):null;
  var sub=$('wsSub');
  if(sub) sub.textContent = n ? (n+(n===1?' message':' messages')+(started?(' • Started '+started.date+', '+started.time):'')) : 'No messages yet — ask your first question below';
  var pl=$('wsPinLabel'); if(pl) pl.textContent=c.pinned?'Unpin chat':'Pin to top';
}
function startTitleEdit(){
  var c=activeChat(); if(!c) return;
  var t=$('wsTitle'); if(!t || t.querySelector('input')) return;
  var cur=c.title||'New Chat';
  t.innerHTML='<input class="ws-titleinput" id="wsTitleInput" maxlength="80" aria-label="Conversation title" value="'+esc(cur)+'">';
  var inp=$('wsTitleInput'); if(!inp) return;
  inp.focus(); try{ inp.select(); }catch(e){}
  var done=false;
  function save(){ if(done) return; done=true; var v=inp.value.trim(); if(v && v!==c.title){ c.title=v; renderChatList(); saveChats(); toast('Conversation renamed'); } syncWsHead(); }
  function cancel(){ if(done) return; done=true; syncWsHead(); }
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); save(); } else if(e.key==='Escape'){ e.stopPropagation(); cancel(); } });
  inp.addEventListener('click', function(e){ e.stopPropagation(); });
}
/* Honest availability: a real one-word request to the free Pollinations service.
   The dot and the text only claim "available" after that request actually answers. */
function checkModelAvailability(){
  var dot=$('modelDot'), st=$('modelState'); if(!dot || !st) return;
  dot.className='modeldot checking'; st.className='modelstate'; st.textContent='Checking availability…';
  var ctl=('AbortController' in window)?new AbortController():null;
  var to=ctl?setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, 12000):null;
  fetch('https://text.pollinations.ai/', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'openai', messages:[{role:'user', content:'Reply with exactly: OK'}]}), signal:ctl?ctl.signal:undefined})
    .then(function(r){ if(to) clearTimeout(to); if(!r.ok) throw new Error('http'); return r.text(); })
    .then(function(txt){
      if(txt && txt.trim().length>0){ dot.className='modeldot'; st.className='modelstate ok'; st.textContent='Available now — checked live just now, '+fmtTime(new Date())+'.'; }
      else throw new Error('empty');
    })
    .catch(function(){
      dot.className='modeldot down'; st.className='modelstate bad';
      st.textContent='Not reachable right now (checked '+fmtTime(new Date())+'). Answers will use the sources fallback until it responds — and the answer itself will say so.';
    });
}
function setupWsHead(){
  var rb=$('wsRenameBtn'); if(rb) rb.onclick=function(){ startTitleEdit(); };
  var mb=$('wsMenuBtn'), menu=$('wsMenu');
  if(mb && menu){
    mb.onclick=function(e){ e.stopPropagation(); var willOpen=menu.hidden; closeWsMenus(); menu.hidden=!willOpen; mb.setAttribute('aria-expanded', willOpen?'true':'false'); };
    menu.querySelectorAll('button').forEach(function(b){
      b.onclick=function(){
        menu.hidden=true;
        var act=b.getAttribute('data-ws'); var c=activeChat(); if(!c) return;
        if(act==='rename'){ startTitleEdit(); }
        else if(act==='pin'){ c.pinned=!c.pinned; renderChatList(); saveChats(); syncWsHead(); toast(c.pinned?'Chat pinned to the top':'Pin removed'); }
        else if(act==='export'){
          var txt=c.messages.map(function(m){ return (m.role==='user'?'You: ':'ENZO: ')+(m.text||m.plain||stripHtml(m.html||'')); }).join('\n\n');
          downloadTextFile(((c.title||'ENZO chat').replace(/[^\w\- ]+/g,'').trim().slice(0,60)||'ENZO chat')+'.txt', (c.title||'ENZO chat')+'\n\n'+txt);
        }
        else if(act==='del'){
          confirmAction('Delete this chat?', '“'+c.title+'” and all its messages will be permanently deleted from this browser. This cannot be undone.', 'Yes, delete it', function(){
            state.chats=state.chats.filter(function(x){ return x.id!==c.id; });
            if(state.activeId===c.id) state.activeId=state.chats[0]?state.chats[0].id:null;
            if(!state.chats.length) createChat('New Chat');
            renderChatList(); renderMessages(); saveChats(); toast('Chat deleted');
          });
        }
      };
    });
  }
  var mp=$('modelPill'), mm=$('modelMenu');
  if(mp && mm){
    mp.onclick=function(e){ e.stopPropagation(); var willOpen=mm.hidden; closeWsMenus(); mm.hidden=!willOpen; mp.setAttribute('aria-expanded', willOpen?'true':'false'); if(willOpen) checkModelAvailability(); };
  }
  document.addEventListener('click', function(e){
    if(!(e.target.closest && (e.target.closest('.ws-menuwrap') || e.target.closest('.modelwrap') || e.target.closest('.msgmenu-wrap') || e.target.closest('.sharewrap')))) closeWsMenus();
  });
}
setupWsHead();

// Init — restore permanent memory first; purani chats aur un ka context wapas aa jata hai
var restored = loadChats();
if(!restored){
  /* v66-memory (Piece E): local storage is empty, so try the backend
     restore (async — boot never waits for it). The placeholder chat is
     created only if the restore brings nothing back, so a cleared
     browser / new device does not end up with a stray empty chat above
     the restored ones. */
  if(typeof window.EnzoRestoreFromBackend==='function'){
    window.EnzoRestoreFromBackend(function(restoredCount){
      if(!restoredCount && !state.chats.length){ createChat('New Chat'); renderChatList(); renderMessages(); }
    });
  } else { createChat('New Chat'); }
}
if(state.usage){ $('usageText').textContent=state.usage; }
syncDeepUI();
renderChatList();
renderMessages();
updateLiveClock();
setInterval(updateLiveClock, 1000);
setInterval(function(){
  /* The periodic "x minutes ago" refresh must never close an open chat menu, fight the
     search box, or yank the list's scroll position away from the reader */
  if(state.menuChatId) return;
  var hs=$('historySearch');
  if(hs && (document.activeElement===hs || hs.value)) return;
  var cl=$('chatList'); var st=cl?cl.scrollTop:0;
  renderChatList();
  if(cl) cl.scrollTop=st;
}, 60000);
