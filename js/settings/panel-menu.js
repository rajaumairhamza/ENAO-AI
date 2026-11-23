
/* ================= PANEL MENU + PERMISSIONS + IDENTITY + LIBRARY =================
   Everything here reads REAL app state only: the reminders store, the shared
   `state`, the P-C task checklist (pcTask), Mega Deep Research progress, the
   browser's own permission states, the user's stored rules, the accounts
   store and the chat store. The Library indexes what ENZO actually created:
   research and answers from the chats themselves, files attached in chats,
   and — captured live from this build on — tool outputs (documents,
   summaries, generated images) saved the moment they are made. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function escH(s){ return (typeof esc==='function') ? esc(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function lsGet(k,d){ try{ var v=localStorage.getItem(k); return v===null?d:v; }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function lsJ(k,d){ try{ var j=JSON.parse(localStorage.getItem(k)||'null'); return j==null?d:j; }catch(e){ return d; } }
function lsJS(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function newId(){ return (typeof uid==='function') ? uid() : 'x'+Date.now().toString(36)+Math.floor(Math.random()*9999); }
function toast2(m){ if(typeof toast==='function') toast(m); }
function st(){ return window.state||{}; }
function fmtWhen(ts){ try{ var d=new Date(ts); return ((typeof fmtShortDate==='function')?fmtShortDate(d):d.toLocaleDateString())+' · '+((typeof fmtTime==='function')?fmtTime(d):d.toLocaleTimeString()); }catch(e){ return ''; } }
function stripTags(html){ var d=document.createElement('div'); d.innerHTML=html||''; return (d.textContent||'').replace(/\s+/g,' ').trim(); }

/* ---------------- PERMISSIONS (shared by the right panel and Settings) ---------------- */
var micPerm='prompt';
function micText(){ return micPerm==='granted'?'Allowed':micPerm==='denied'?'Blocked in the browser':'Not asked yet'; }
function queryMic(){
  try{
    if(navigator.permissions && navigator.permissions.query){
      navigator.permissions.query({name:'microphone'}).then(function(p){
        micPerm=p.state; renderPerms();
        try{ p.onchange=function(){ micPerm=p.state; renderPerms(); }; }catch(e){}
      }).catch(function(){});
    }
  }catch(e){}
}
function permRow(kind, title, sub, btnLabel){
  return '<div class="rp-row"><div class="rp-row-t"><b>'+title+'</b><span class="sub">'+sub+'</span></div><span class="rp-right"><span class="rp-state" data-ps="'+kind+'"></span><button type="button" class="enzo-tbtn rp-btn" data-perm-act="'+kind+'">'+btnLabel+'</button></span></div>';
}
function buildPermLists(){
  document.querySelectorAll('[data-perm-list]').forEach(function(box){
    if(box.getAttribute('data-built')) return;
    box.setAttribute('data-built','1');
    box.innerHTML =
      permRow('mic','Microphone','For voice talk and dictation','Allow')+
      permRow('notif','In-page notifications','A small message when an answer is ready','Toggle')+
      permRow('sources','Sources with answers','The real pages used are listed under each answer','Toggle')+
      permRow('bg','Background knowledge collection','Quietly refreshes topics you asked about before','Toggle')+
      permRow('rules','Your rules for ENZO','The do / never-do rules ENZO follows in every answer','Manage');
  });
}
function setPs(kind, text, cls){
  document.querySelectorAll('[data-ps="'+kind+'"]').forEach(function(el){ el.textContent=text; el.className='rp-state '+(cls||''); });
}
function renderPerms(){
  setPs('mic', micText(), micPerm==='granted'?'on':micPerm==='denied'?'off':'ask');
  document.querySelectorAll('[data-perm-act="mic"]').forEach(function(b){ b.style.display = micPerm==='granted' ? 'none' : ''; });
  var s=st();
  setPs('notif', s.notifOn?'On':'Off', s.notifOn?'on':'off');
  setPs('sources', s.sourcesOn?'On':'Off', s.sourcesOn?'on':'off');
  var bg=lsGet('enao_bgcollect','1')==='1';
  setPs('bg', bg?'On':'Off', bg?'on':'off');
  var n=lsJ('enao_userrules_v1',[]).length;
  setPs('rules', n+(n===1?' rule':' rules')+' set', 'on');
}
window.__renderPerms=renderPerms;
window.__buildPermLists=buildPermLists;
function syncSwitch(id, v){ var el=$(id); if(el) el.setAttribute('aria-checked', v?'true':'false'); }
function allowMic(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast2('This browser cannot ask for the microphone here'); return; }
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} });
    micPerm='granted'; renderPerms(); toast2('Microphone allowed — ENZO can hear you now');
  }).catch(function(){ queryMic(); toast2('Microphone was not allowed — check this site\u2019s settings in your browser'); });
}
document.addEventListener('click', function(e){
  var b=e.target && e.target.closest ? e.target.closest('[data-perm-act]') : null;
  if(!b) return;
  var act=b.getAttribute('data-perm-act'), s=st();
  if(act==='mic'){ allowMic(); }
  else if(act==='notif'){ var v=!s.notifOn; if(window.state) window.state.notifOn=v; lsSet('enao_notif', v?'1':'0'); syncSwitch('notifSwitch', v); renderPerms(); toast2(v?'In-page notifications ON':'In-page notifications OFF'); }
  else if(act==='sources'){ var v2=!s.sourcesOn; if(window.state) window.state.sourcesOn=v2; lsSet('enao_sources', v2?'1':'0'); syncSwitch('sourcesSwitch', v2); renderPerms(); toast2(v2?'Sources will be listed under answers':'Answers will come without a source list'); }
  else if(act==='bg'){ var on=lsGet('enao_bgcollect','1')==='1'; lsSet('enao_bgcollect', on?'0':'1'); var bb=$('bgCollectBtn'); if(bb){ bb.textContent=on?'Off':'On'; bb.setAttribute('aria-pressed', on?'false':'true'); } renderPerms(); toast2('Background knowledge collection is now '+(on?'off':'on')); }
  else if(act==='rules'){ if(typeof refreshSettingsUI==='function') refreshSettingsUI(); if(typeof openModal==='function') openModal('settingsModal'); if(typeof window.__setPane==='function') window.__setPane('permissions'); }
});

/* ---------------- PANEL MENU: schedules + running work under the hamburger ---------------- */
function buildPanelMenu(){
  var panel=$('enzoPanel'), menu=$('panelMenu');
  if(!panel || !menu) return;
  var runSec=menu.querySelector('.rp-runsec');
  var rem=$('remindersBox');
  if(rem){
    var k=rem.querySelector('.enzo-task-kicker');
    if(k) k.textContent='Schedules & reminders';
    menu.insertBefore(rem, runSec);
    var empty=document.createElement('p');
    empty.className='rp-empty'; empty.id='rpSchedEmpty';
    empty.textContent='No schedules or reminders yet — just ask ENZO, for example: \u201CRemind me to call Ahmed in 2 hours\u201D.';
    menu.insertBefore(empty, runSec);
  }
  var task=$('enzoTask');
  if(task) menu.appendChild(task);
  var btn=$('panelMenuBtn');
  function apply(open){ menu.classList.toggle('closed', !open); if(btn) btn.setAttribute('aria-expanded', open?'true':'false'); }
  apply(lsGet('enao_panelmenu','1')!=='0');
  if(btn) btn.onclick=function(){ var open=menu.classList.contains('closed'); apply(open); lsSet('enao_panelmenu', open?'1':'0'); };
}
var idSig='';
function renderIdentity(){
  var lines=$('rpIdLines'), rows=$('rpIdRows');
  if(!lines || !rows) return;
  var signedOut=lsGet('enao_signed_out','0')==='1';
  var name=signedOut?'Guest':(lsGet('enao_name','Raja')||'Raja');
  var acc=(typeof window.__activeAccount==='function') ? window.__activeAccount() : null;
  var chats=(st().chats||[]).length;
  var sig=[name,signedOut,acc?acc.id:'',chats,micPerm].join('|');
  if(sig===idSig) return;
  idSig=sig;
  lines.innerHTML='<b>'+escH(name)+'</b><span>'+(signedOut?'Signed out — Guest profile on this device':'Signed in on this device')+'</span>';
  function row(k,v){ return '<div class="rp-row"><span>'+k+'</span><b>'+v+'</b></div>'; }
  rows.innerHTML =
    row('Profile type','Browser profile — no server account')+
    row('Active account', acc ? escH(acc.name)+' · '+escH(acc.platform) : 'None set yet')+
    row('Chats stored here', chats+(chats===1?' chat':' chats')+' in this browser')+
    row('Microphone', micText())+
    row('Data location','This device only');
}
function tickPanel(){
  var line=$('rpRunLine');
  if(line){
    var s=st(), txt;
    if(s.isGenerating){
      var pt=window.pcTask, cur='';
      if(pt && pt.steps && pt.states){ for(var i=0;i<pt.steps.length;i++){ if(pt.states[i]==='running'){ cur=pt.steps[i]; break; } } }
      var mega=window.__enzoMega;
      txt='Working now'+(cur?' — '+cur.replace(/…$/,''):'')+((mega && mega.count)?' · '+Number(mega.collected).toLocaleString()+' of '+Number(mega.count).toLocaleString()+' '+mega.entity+' collected':'');
    }
    else if(s.isSpeaking) txt='Speaking an answer aloud right now.';
    else if(s.isListening || s.voiceState==='listening') txt='Listening to you right now.';
    else if(s.voiceState==='processing') txt='Thinking about your question…';
    else txt='Nothing is running right now — ENZO is ready.';
    if(line.textContent!==txt) line.textContent=txt;
  }
  var rem=$('remindersBox'), emp=$('rpSchedEmpty');
  if(emp && rem) emp.hidden=!rem.hidden;
  renderIdentity();
}

/* ---------------- LIBRARY ---------------- */
var LIB_KIND_LABEL={research:'Research', answer:'Answer / work', document:'Document', image:'Image', file:'File'};
var libKind='all', libQuery='', libSelectedKey=null;
function libCapture(item){
  try{
    var arr=lsJ('enao_library_v1',[]);
    var sig=(item.title||'')+'|'+(item.bodyText||item.url||'').slice(0,80);
    for(var i=0;i<arr.length;i++){
      var a=arr[i];
      if(((a.title||'')+'|'+(a.bodyText||a.url||'').slice(0,80))===sig && Date.now()-(a.ts||0)<300000) return;
    }
    item.id=newId(); item.ts=Date.now();
    arr.unshift(item);
    if(arr.length>200) arr.length=200;
    lsJS('enao_library_v1', arr);
  }catch(e){}
}
function toolTitleNow(){ var t=$('toolTitle'); return (t && t.textContent) ? t.textContent : 'Document'; }
if(typeof window.toolOutMd==='function'){
  var _tom=window.toolOutMd;
  window.toolOutMd=function(md){ var r=_tom.apply(this,arguments); try{ if(md && String(md).length>140) libCapture({kind:'document', title:toolTitleNow(), chatTitle:'AI Tools', bodyText:String(md), bodyHtml:(typeof mdToHtml==='function'?mdToHtml(String(md)):'')}); }catch(e){} return r; };
}
if(typeof window.toolOutText==='function'){
  var _tot=window.toolOutText;
  window.toolOutText=function(t){ var r=_tot.apply(this,arguments); try{ if(t && String(t).length>200) libCapture({kind:'document', title:toolTitleNow(), chatTitle:'AI Tools', bodyText:String(t)}); }catch(e){} return r; };
}
if(typeof window.toolOut==='function'){
  var _to=window.toolOut;
  window.toolOut=function(html){ var r=_to.apply(this,arguments); try{
    if(html){
      var im=/<img[^>]+src="([^"]+)"/.exec(html);
      if(im) libCapture({kind:'image', title:toolTitleNow(), chatTitle:'AI Tools', url:im[1], bodyText:''});
      else { var tx=stripTags(html); if(tx.length>260) libCapture({kind:'document', title:toolTitleNow(), chatTitle:'AI Tools', bodyHtml:html, bodyText:tx}); }
    }
  }catch(e){} return r; };
}
function collectLibrary(){
  var items=[];
  var hidden={};
  lsJ('enao_library_hidden_v1',[]).forEach(function(k){ hidden[k]=1; });
  lsJ('enao_library_v1',[]).forEach(function(it){
    items.push({key:'cap:'+it.id, storeId:it.id, kind:it.kind||'document', title:it.title||'Untitled', ts:it.ts||0, chatTitle:it.chatTitle||'AI Tools', bodyHtml:it.bodyHtml||'', bodyText:it.bodyText||'', url:it.url||''});
  });
  (st().chats||[]).forEach(function(c){
    (c.messages||[]).forEach(function(m, idx){
      if(m.role==='ai'){
        var plain=m.plain||m.text||'';
        var isRes=!!m.deep || c.mode==='deep';
        if(plain.length>=240 || (isRes && plain.length>0)){
          var key='chat:'+c.id+':'+(m.ts||idx);
          if(hidden[key]) return;
          var title=(m.question||c.title||'Answer').trim();
          if(title.length>64) title=title.slice(0,64)+'…';
          items.push({key:key, kind:isRes?'research':'answer', title:title, ts:m.ts||c.created||0, chatTitle:c.title||'Chat', chatId:c.id, bodyHtml:m._fullHtml||m.html||'', bodyText:plain});
        }
      } else if(m.role==='user' && m.files){
        m.files.forEach(function(f, fi){
          var key='file:'+c.id+':'+(m.ts||idx)+':'+fi;
          if(hidden[key]) return;
          var isImg=(f.kind && /image/i.test(f.kind)) || (f.dataUrl && f.dataUrl.indexOf('data:image')===0);
          items.push({key:key, kind:isImg?'image':'file', title:f.name||'File', ts:m.ts||c.created||0, chatTitle:c.title||'Chat', chatId:c.id, dataUrl:f.dataUrl||'', fileKind:f.kind||''});
        });
      }
    });
  });
  items.sort(function(a,b){ return b.ts-a.ts; });
  return items;
}
function libFiltered(){
  var q=libQuery.trim().toLowerCase();
  return collectLibrary().filter(function(it){
    if(libKind!=='all' && it.kind!==libKind) return false;
    if(q && (it.title+' '+it.chatTitle+' '+(it.bodyText||'')).toLowerCase().indexOf(q)===-1) return false;
    return true;
  });
}
function downloadLib(name, href, text){
  var a=document.createElement('a');
  if(text!=null){
    var blob=new Blob([text], {type:'text/plain'});
    href=URL.createObjectURL(blob);
    setTimeout(function(){ URL.revokeObjectURL(href); }, 900);
  }
  a.href=href; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
}
function shareLib(it){
  if(navigator.share){
    var payload={title:it.title, text:(it.bodyText||it.title||'').slice(0,2000)};
    if(it.url) payload.url=it.url;
    navigator.share(payload).catch(function(){});
    return;
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(it.title+'\n\n'+(it.bodyText||it.url||it.dataUrl||'')).then(function(){ toast2('Copied — paste it anywhere to share'); }).catch(function(){ toast2('Copy was blocked by the browser'); });
  } else toast2('Sharing is not available in this browser');
}
function deleteLib(it){
  function go(){
    if(it.storeId){
      lsJS('enao_library_v1', lsJ('enao_library_v1',[]).filter(function(x){ return x.id!==it.storeId; }));
      toast2('Deleted from your Library');
    } else {
      var h=lsJ('enao_library_hidden_v1',[]); h.push(it.key); lsJS('enao_library_hidden_v1', h);
      toast2('Removed from your Library — the original stays in its chat');
    }
    libSelectedKey=null; renderLibrary();
  }
  if(typeof confirmAction==='function') confirmAction(it.storeId?'Delete this item?':'Remove from Library?', it.storeId?'This creation will be permanently deleted from your Library.':'It will disappear from the Library; the original message stays untouched in its chat.', it.storeId?'Yes, delete':'Yes, remove', go);
  else go();
}
function renderLibrary(){
  var list=$('libList'), view=$('libView'), count=$('libCount');
  if(!list || !view) return;
  var items=libFiltered();
  var total=collectLibrary().length;
  if(count) count.textContent=items.length+' of '+total+' item'+(total===1?'':'s')+' shown · everything is saved in this browser';
  if(!items.length){
    list.innerHTML='';
    view.innerHTML='<div class="lib-empty">'+(total? 'Nothing matches your search or filter.' : 'Nothing here yet. Ask ENZO for research, an article, a document or an image — everything ENZO creates is saved here automatically, and your past chat answers are already here.')+'</div>';
    return;
  }
  if(!libSelectedKey || !items.some(function(it){ return it.key===libSelectedKey; })) libSelectedKey=items[0].key;
  list.innerHTML=items.map(function(it){
    return '<button type="button" class="lib-item'+(it.key===libSelectedKey?' active':'')+'" data-libkey="'+escH(it.key)+'"><span class="lib-badge">'+(LIB_KIND_LABEL[it.kind]||'Item')+'</span><b>'+escH(it.title)+'</b><span class="lib-meta">'+escH(fmtWhen(it.ts))+'<br>From: '+escH(it.chatTitle)+'</span></button>';
  }).join('');
  list.querySelectorAll('[data-libkey]').forEach(function(b){
    b.onclick=function(){ libSelectedKey=b.getAttribute('data-libkey'); renderLibrary(); };
  });
  var it=null;
  items.forEach(function(x){ if(x.key===libSelectedKey) it=x; });
  if(!it) return;
  var body='';
  if(it.kind==='image'){
    var src=it.url||it.dataUrl||'';
    body=src ? '<div class="lib-body"><img src="'+escH(src)+'" alt="'+escH(it.title)+'"></div>' : '<div class="lib-empty">This image is stored in its chat.</div>';
  } else if(it.kind==='file'){
    body='<div class="lib-empty">File from your chat'+(it.fileKind?' · '+escH(it.fileKind):'')+(it.dataUrl?'. Download it below, or open the chat to see it in place.':'. Open the chat to see it in place.')+'</div>';
  } else {
    var html=it.bodyHtml || (typeof mdToHtml==='function' ? mdToHtml(it.bodyText||'') : escH(it.bodyText||''));
    body='<div class="lib-body ai-body">'+html+'</div>';
  }
  var acts='';
  if(it.chatId) acts+='<button type="button" class="actionbtn" data-libact="chat">Open in chat</button>';
  if(it.kind==='image' && (it.url||it.dataUrl)) acts+='<button type="button" class="actionbtn" data-libact="full">Open full size</button>';
  if(it.bodyText) acts+='<button type="button" class="actionbtn" data-libact="download">Download</button>';
  if(it.dataUrl) acts+='<button type="button" class="actionbtn" data-libact="download">Download</button>';
  acts+='<button type="button" class="actionbtn" data-libact="share">Share</button>';
  acts+='<button type="button" class="actionbtn" data-libact="delete">'+(it.storeId?'Delete':'Remove from Library')+'</button>';
  view.innerHTML='<span class="lib-badge">'+(LIB_KIND_LABEL[it.kind]||'Item')+'</span><h4>'+escH(it.title)+'</h4><span class="lib-meta">'+escH(fmtWhen(it.ts))+' · From: '+escH(it.chatTitle)+'</span><div class="lib-actions">'+acts+'</div>'+body;
  view.querySelectorAll('[data-libact]').forEach(function(b){
    b.onclick=function(){
      var act=b.getAttribute('data-libact');
      if(act==='chat'){ if(typeof closeModal==='function') closeModal('libraryModal'); if(typeof window.openChatById==='function') window.openChatById(it.chatId); }
      else if(act==='full'){ window.open(it.url||it.dataUrl, '_blank', 'noopener'); }
      else if(act==='download'){
        if(it.dataUrl) downloadLib(it.title||'file', it.dataUrl, null);
        else downloadLib((it.title||'enzo-item').replace(/[^\w\- ]+/g,'').slice(0,60)+'.txt', '', it.bodyText||'');
      }
      else if(act==='share'){ shareLib(it); }
      else if(act==='delete'){ deleteLib(it); }
    };
  });
}
function wireLibrary(){
  var btn=$('libraryBtn');
  if(btn) btn.onclick=function(){ libSelectedKey=null; renderLibrary(); if(typeof openModal==='function') openModal('libraryModal'); };
  var search=$('libSearch');
  if(search) search.addEventListener('input', function(){ libQuery=search.value; renderLibrary(); });
  var chips=$('libChips');
  if(chips) chips.querySelectorAll('[data-libkind]').forEach(function(ch){
    ch.onclick=function(){ libKind=ch.getAttribute('data-libkind'); chips.querySelectorAll('.lib-chip').forEach(function(x){ x.classList.toggle('active', x===ch); }); renderLibrary(); };
  });
}

buildPermLists();
queryMic();
renderPerms();
buildPanelMenu();
tickPanel();
EnzoPollLoop.registerPoller('panel-tick', function(){
  /* Accuracy rule: the run line must not claim work is happening from
     stale task data. */
  var st = EnzoPollLoop.getStatus('task-progress');
  if(st && st.dataState === 'stale'){
    var line = $('rpRunLine');
    if(line) line.textContent = 'Updating…';
    return;
  }
  tickPanel();
}, 2000, { kind: 'panel' });
wireLibrary();
})();
