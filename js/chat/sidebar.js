
/* ================= P-B — SIDEBAR REBUILD (brief §4) =================
   Wired to the EXISTING chat store (localStorage 'enao_chats_v1' via saveChats /
   loadChats). Nothing here wipes or replaces existing chats or settings; folders
   live in their own key 'enao_folders_v1'. renderChatList / refreshFolderCounts
   are redefined here so every existing caller (send, rename, the 60-second
   refresh, See all…) gets the new Pinned / Recent / Folders behaviour. */
state.folders=[]; state.openFolders={}; state.sbClosed={}; state.folderSort='recent';
state.folderMenuId=null; state.editFolderId=null; state.editIcon='i-folder'; state.editColor='#38BDF8'; state.delFolderId=null;
try{ state.openFolders=JSON.parse(loadPref('enao_open_folders','{}'))||{}; }catch(e){}
try{ state.sbClosed=JSON.parse(loadPref('enao_sb_closed','{}'))||{}; }catch(e){}
state.folderSort=loadPref('enao_folder_sort','recent')==='az'?'az':'recent';

var FOLDER_ICONS=['i-folder','i-doc','i-img','i-code','i-chart','i-tools','i-chat','i-globe','i-heart','i-flask','i-pen','i-brain'];
var FOLDER_COLORS=['#38BDF8','#60A5FA','#A78BFA','#F472B6','#FBBF24','#34D399','#F87171','#94A3B8'];
function saveFolders(){ savePref('enao_folders_v1', JSON.stringify(state.folders)); }
function loadFolders(){
  var defs=[
    {id:'f-projects', name:'Projects', icon:'i-folder', color:'#FB923C'},
    {id:'f-learning', name:'Learning', icon:'i-doc', color:'#38BDF8'},
    {id:'f-entertainment', name:'Entertainment', icon:'i-heart', color:'#F472B6'},
    {id:'f-personal', name:'Personal', icon:'i-chat', color:'#34D399'}
  ];
  var list=null;
  try{ var raw=localStorage.getItem('enao_folders_v1'); if(raw){ var p=JSON.parse(raw); if(p && p.length) list=p; } }catch(e){}
  state.folders=list||defs;
  /* Chats saved earlier may sit in folders from the old sidebar (Work, Research…) —
     those folders are kept and appended so no chat ever becomes unreachable. */
  var known={}; state.folders.forEach(function(f){ known[f.name]=1; });
  var added=false;
  state.chats.forEach(function(c){ if(c.folder && !known[c.folder]){ known[c.folder]=1; state.folders.push({id:uid(), name:c.folder, icon:'i-folder', color:'#94A3B8'}); added=true; } });
  if(!list || added) saveFolders();
}
function folderByName(n){ for(var i=0;i<state.folders.length;i++) if(state.folders[i].name===n) return state.folders[i]; return null; }
function chatLastTs(c){ var m=(c.messages||[]); return m.length?(m[m.length-1].ts||c.created):(c.created||0); }
function fmtAgo(ts){
  if(!ts) return '';
  var s=Math.floor((Date.now()-ts)/1000); if(s<50) return 'Just now';
  var m=Math.floor(s/60); if(m<60) return m+'m ago';
  var h=Math.floor(m/60); if(h<24) return h+'h ago';
  var d=Math.floor(h/24); if(d<7) return d+'d ago';
  try{ return new Date(ts).toLocaleDateString([], {day:'numeric', month:'short'}); }catch(e){ return ''; }
}
function hlText(text, q){
  text=String(text||'');
  if(!q) return esc(text);
  var i=text.toLowerCase().indexOf(q);
  if(i<0) return esc(text);
  return esc(text.slice(0,i))+'<mark>'+esc(text.slice(i,i+q.length))+'</mark>'+esc(text.slice(i+q.length));
}
function chatSearchText(c){
  var parts=[c.title||'', c.folder||''];
  (c.messages||[]).forEach(function(m){ parts.push(m.text||m.plain||stripHtml(m.html||'')); });
  if(c.created) parts.push(fmtShortDate(new Date(c.created)));
  return parts.join('\n').toLowerCase();
}
function chatSnippet(c, q){
  var msgs=c.messages||[];
  for(var i=0;i<msgs.length;i++){
    var t=(msgs[i].text||msgs[i].plain||stripHtml(msgs[i].html||'')).replace(/\s+/g,' ').trim();
    var idx=t.toLowerCase().indexOf(q);
    if(idx>-1){
      var start=Math.max(0, idx-38), end=Math.min(t.length, idx+q.length+52);
      return (start>0?'…':'')+hlText(t.slice(start,end), q)+(end<t.length?'…':'');
    }
  }
  return '';
}
function downloadTextFile(name, text){
  var blob=new Blob([text], {type:'text/plain'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
function exportOneChat(c){
  var lines=['ENZO — chat export', c.title+' — '+(c.created?new Date(c.created).toLocaleString():''), ''];
  (c.messages||[]).forEach(function(m){ lines.push((m.role==='user'?'You: ':'ENZO: ')+(m.text||m.plain||stripHtml(m.html||''))); lines.push(''); });
  downloadTextFile('enzo-chat.txt', lines.join('\n'));
  toast('Chat downloaded as a text file');
}
function openChatById(id){
  state.activeId=id; state.menuChatId=null;
  renderChatList(); renderMessages(); saveChats(); syncDeepUI();
  $('sidebar').classList.remove('open');
}
function buildChatMenu(c){
  var menu=document.createElement('div'); menu.className='sb-menu';
  var mh='<button data-m="open"><svg class="ic"><use href="#i-chat"/></svg> Open</button>'
    +'<button data-m="rename"><svg class="ic"><use href="#i-pencil"/></svg> Rename</button>'
    +'<button data-m="pin"><svg class="ic"><use href="#i-pin"/></svg> '+(c.pinned?'Unpin':'Pin')+'</button>'
    +'<div class="sb-menu-sep"></div><div class="sb-menu-label">Move to Folder</div>';
  state.folders.forEach(function(f){
    if((c.folder||'')!==f.name) mh+='<button data-m="folder" data-f="'+esc(f.name)+'"><span class="f-dot" style="background:'+esc(f.color)+'"></span> '+esc(f.name)+'</button>';
  });
  if(c.folder) mh+='<button data-m="folder" data-f=""><span class="f-dot" style="background:#94A3B8"></span> No folder</button>';
  mh+='<div class="sb-menu-sep"></div>'
    +'<button data-m="dup"><svg class="ic"><use href="#i-copy"/></svg> Duplicate</button>'
    +'<button data-m="export"><svg class="ic"><use href="#i-share"/></svg> Export</button>'
    +'<button data-m="archive"><svg class="ic"><use href="#i-archive"/></svg> '+(c.archived?'Unarchive':'Archive')+'</button>'
    +'<button data-m="del" class="danger"><svg class="ic"><use href="#i-trash"/></svg> Delete</button>';
  menu.innerHTML=mh;
  menu.querySelectorAll('button').forEach(function(b){
    b.onclick=function(ev){
      ev.stopPropagation();
      var act=b.getAttribute('data-m'); state.menuChatId=null;
      if(act==='open'){ openChatById(c.id); return; }
      if(act==='rename'){ state.renameId=c.id; $('renameInput').value=c.title; openModal('renameModal'); renderChatList(); return; }
      if(act==='pin'){ c.pinned=!c.pinned; renderChatList(); saveChats(); toast(c.pinned?'Chat pinned':'Pin removed'); return; }
      if(act==='folder'){ c.folder=b.getAttribute('data-f')||''; renderChatList(); saveChats(); toast(c.folder?('Moved to '+c.folder):'Removed from its folder'); return; }
      if(act==='dup'){
        var copy={id:uid(), title:(c.title||'Chat')+' copy', created:Date.now(), pinned:false, archived:false, folder:c.folder||'', messages:JSON.parse(JSON.stringify(c.messages||[]))};
        var idx=state.chats.indexOf(c); state.chats.splice(idx<0?0:idx, 0, copy);
        renderChatList(); saveChats(); toast('Chat duplicated'); return;
      }
      if(act==='export'){ renderChatList(); exportOneChat(c); return; }
      if(act==='archive'){ c.archived=!c.archived; renderChatList(); saveChats(); toast(c.archived?'Chat archived — find it under Archived':'Chat back in your lists'); return; }
      if(act==='del'){
        renderChatList();
        confirmAction('Delete this chat?', '\u201C'+c.title+'\u201D and all its messages will be permanently deleted from this browser. This cannot be undone.', 'Yes, delete it', function(){
          state.chats=state.chats.filter(function(x){ return x.id!==c.id; });
          if(state.activeId===c.id) state.activeId=state.chats[0]?state.chats[0].id:null;
          renderChatList(); renderMessages(); saveChats(); toast('Chat deleted');
        });
        return;
      }
    };
  });
  return menu;
}
function buildChatItem(c, q){
  var div=document.createElement('div');
  div.className='chat-item'+(c.id===state.activeId?' active':'');
  div.draggable=true;
  div.setAttribute('data-chat-id', c.id);
  var f=folderByName(c.folder||'');
  var icon=f?f.icon:'i-chat';
  var iconColor=f?f.color:'#7DD3FC';
  var snip=q?chatSnippet(c, q):'';
  div.innerHTML='<svg class="ic chat-ic" style="color:'+esc(iconColor)+'"><use href="#'+esc(icon)+'"/></svg>'
    +'<div class="chat-item-main"><div class="chat-item-title">'+(c.pinned?'<svg class="ic pin-ind"><use href="#i-pin"/></svg> ':'')+hlText(c.title, q||'')+(c.archived?' <span class="archtag">Archived</span>':'')+'</div>'
    +(snip?'<div class="chat-snippet">'+snip+'</div>':'')
    +'</div>'
    +'<span class="chat-item-time" title="'+esc(timeLabelFor(chatLastTs(c)).full)+'">'+esc(fmtAgo(chatLastTs(c)))+'</span>'
    +'<button class="iconbtn" data-act="menu" title="Chat actions — open, rename, pin, move, duplicate, export, archive, delete" aria-label="Chat actions"><svg class="ic"><use href="#i-dots"/></svg></button>';
  div.querySelector('.chat-item-main').onclick=function(){ openChatById(c.id); };
  div.querySelector('[data-act="menu"]').onclick=function(e){
    e.stopPropagation();
    state.menuChatId = state.menuChatId===c.id ? null : c.id;
    renderChatList();
  };
  div.addEventListener('dragstart', function(e){
    try{ e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed='move'; }catch(err){}
  });
  if(state.menuChatId===c.id) div.appendChild(buildChatMenu(c));
  return div;
}
function refreshFolderCounts(){
  var counts={all:0, archived:0};
  state.chats.forEach(function(c){
    if(c.archived){ counts.archived++; return; }
    counts.all++;
    if(c.folder) counts[c.folder]=(counts[c.folder]||0)+1;
  });
  document.querySelectorAll('#folderRow .f-count').forEach(function(sp){
    var k=sp.getAttribute('data-count');
    sp.textContent = k==='all' ? counts.all : (k==='archived' ? counts.archived : (counts[k]||0));
  });
  var fc=$('foldersCount'); if(fc) fc.textContent=state.folders.length;
}
function renderFolders(){
  var row=$('folderRow'); if(!row) return;
  row.innerHTML='';
  function specialRow(key, name, icon, color){
    var d=document.createElement('div');
    d.className='folderchip'+(state.folderFilter===key?' on':'');
    d.setAttribute('role','button'); d.tabIndex=0;
    d.title=key==='all'?'Show all chats in Recent Chats':'Show archived chats in Recent Chats';
    d.innerHTML='<svg class="ic f-ic" style="color:'+color+'"><use href="#'+icon+'"/></svg><span class="f-name">'+esc(name)+'</span><span class="f-count" data-count="'+key+'">0</span>';
    function go(){ state.folderFilter=key; state.menuChatId=null; renderChatList(); }
    d.onclick=go;
    d.onkeydown=function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } };
    row.appendChild(d);
  }
  specialRow('all', 'All Chats', 'i-folder', '#2DD4BF');
  state.folders.forEach(function(f){
    var wrap=document.createElement('div');
    wrap.className='folderrow-wrap'+(state.openFolders[f.id]?' open':'');
    var chats=state.chats.filter(function(c){ return !c.archived && (c.folder||'')===f.name; });
    chats.sort(function(a,b){ return state.folderSort==='az' ? String(a.title).localeCompare(String(b.title)) : chatLastTs(b)-chatLastTs(a); });
    var chip=document.createElement('div');
    chip.className='folderchip'; chip.setAttribute('role','button'); chip.tabIndex=0;
    chip.title='Open or close the '+f.name+' folder — drop a chat here to move it in';
    chip.innerHTML='<svg class="ic f-chev"><use href="#i-chevr"/></svg>'
      +'<svg class="ic f-ic" style="color:'+esc(f.color)+'"><use href="#'+esc(f.icon)+'"/></svg>'
      +'<span class="f-name">'+esc(f.name)+'</span>'
      +'<span class="f-count" data-count="'+esc(f.name)+'">'+chats.length+'</span>'
      +'<button class="iconbtn" data-act="fmenu" title="Folder actions — rename, icon, colour, sort, delete" aria-label="Folder actions" style="width:28px;height:28px;min-height:28px;flex:0 0 28px"><svg class="ic"><use href="#i-dots"/></svg></button>';
    function toggle(){ state.openFolders[f.id]=!state.openFolders[f.id]; savePref('enao_open_folders', JSON.stringify(state.openFolders)); renderChatList(); }
    chip.onclick=function(e){ if(e.target.closest && e.target.closest('[data-act="fmenu"]')) return; toggle(); };
    chip.onkeydown=function(e){ if((e.key==='Enter'||e.key===' ') && e.target===chip){ e.preventDefault(); toggle(); } };
    chip.querySelector('[data-act="fmenu"]').onclick=function(e){
      e.stopPropagation();
      state.folderMenuId = state.folderMenuId===f.id ? null : f.id;
      renderChatList();
    };
    chip.addEventListener('dragover', function(e){ e.preventDefault(); chip.classList.add('dragover'); try{ e.dataTransfer.dropEffect='move'; }catch(err){} });
    chip.addEventListener('dragleave', function(){ chip.classList.remove('dragover'); });
    chip.addEventListener('drop', function(e){
      e.preventDefault(); chip.classList.remove('dragover');
      var id=''; try{ id=e.dataTransfer.getData('text/plain'); }catch(err){}
      var c=null; state.chats.forEach(function(x){ if(x.id===id) c=x; });
      if(c && (c.folder||'')!==f.name){ c.folder=f.name; state.openFolders[f.id]=true; savePref('enao_open_folders', JSON.stringify(state.openFolders)); renderChatList(); saveChats(); toast('Moved to '+f.name); }
    });
    wrap.appendChild(chip);
    if(state.folderMenuId===f.id){
      var fm=document.createElement('div'); fm.className='sb-menu'; fm.style.top='42px';
      fm.innerHTML='<button data-fm="rename"><svg class="ic"><use href="#i-pencil"/></svg> Rename Folder</button>'
        +'<button data-fm="icon"><svg class="ic"><use href="#i-img"/></svg> Change Icon</button>'
        +'<button data-fm="colour"><svg class="ic"><use href="#i-pen"/></svg> Change Colour</button>'
        +'<button data-fm="sort"><svg class="ic"><use href="#i-filter"/></svg> Sort: '+(state.folderSort==='az'?'Name A–Z':'Most Recent')+'</button>'
        +'<div class="sb-menu-sep"></div>'
        +'<button data-fm="del" class="danger"><svg class="ic"><use href="#i-trash"/></svg> Delete Folder</button>';
      fm.querySelectorAll('button').forEach(function(b){
        b.onclick=function(ev){
          ev.stopPropagation(); var act=b.getAttribute('data-fm'); state.folderMenuId=null;
          if(act==='rename'||act==='icon'||act==='colour'){ renderChatList(); openFolderEditor(f); }
          else if(act==='sort'){ state.folderSort=state.folderSort==='az'?'recent':'az'; savePref('enao_folder_sort', state.folderSort); renderChatList(); toast('Folder chats sorted by '+(state.folderSort==='az'?'name A–Z':'most recent')); }
          else if(act==='del'){ renderChatList(); openFolderDelete(f); }
        };
      });
      wrap.appendChild(fm);
    }
    var list=document.createElement('div'); list.className='folder-chats';
    if(chats.length===0){
      list.innerHTML='<div class="sb-empty">No chats here yet. Drag a chat onto this folder, or use a chat\u2019s three-dot menu to move it in.</div>';
    } else {
      chats.forEach(function(c){ list.appendChild(buildChatItem(c, '')); });
    }
    wrap.appendChild(list);
    row.appendChild(wrap);
  });
  specialRow('archived', 'Archived', 'i-archive', '#94A3B8');
  refreshFolderCounts();
}
function renderChatList(){
  var input=$('historySearch');
  var q=(input && input.value ? input.value : '').trim().toLowerCase();
  var foldersBox=$('foldersBox'), recentTitle=$('recentTitle');
  var el=$('chatList');
  if(!el) return;
  if(q){
    /* Search mode — titles, message content, folder names and dates; matches
       highlighted, results never modify or delete anything. */
    if(foldersBox) foldersBox.style.display='none';
    if(recentTitle) recentTitle.textContent='Search Results';
    var res=state.chats.filter(function(c){ return chatSearchText(c).indexOf(q)>-1; });
    res.sort(function(a,b){
      var at=a.title.toLowerCase().indexOf(q)>-1?0:1, bt=b.title.toLowerCase().indexOf(q)>-1?0:1;
      return at!==bt ? at-bt : chatLastTs(b)-chatLastTs(a);
    });
    var rc=$('recentCount'); if(rc) rc.textContent=res.length;
    el.innerHTML='';
    if(res.length===0){
      el.innerHTML='<div class="sb-empty"><b>No chats match \u201C'+esc(q)+'\u201D</b>Try different words — search looks through chat titles, the messages inside them, folder names and dates.</div>';
      return;
    }
    res.forEach(function(c){ el.appendChild(buildChatItem(c, q)); });
    return;
  }
  if(foldersBox) foldersBox.style.display=foldersBox.classList.contains('sb-filter-hidden')?'none':'';
  if(recentTitle) recentTitle.textContent='Recent Chats';
  /* ONE single chat list — there is no separate Pinned section. A pinned
     chat simply sits at the TOP of this same list with its small pin
     indicator (buildChatItem draws it); unpinning drops it back into its
     normal place in the activity order below. The Archived row steers the
     list to archived chats only, as before. */
  var listAll;
  if(state.folderFilter==='archived'){
    listAll=state.chats.filter(function(c){ return !!c.archived; });
    listAll.sort(function(a,b){ return chatLastTs(b)-chatLastTs(a); });
  } else {
    listAll=state.chats.filter(function(c){ return !c.archived; });
    listAll.sort(function(a,b){
      var ap=a.pinned?0:1, bp=b.pinned?0:1;
      return ap!==bp ? ap-bp : chatLastTs(b)-chatLastTs(a);
    });
  }
  var rc2=$('recentCount'); if(rc2) rc2.textContent=listAll.length;
  el.innerHTML='';
  if(state.chats.length===0){
    el.innerHTML='<div class="sb-empty"><b>No chats yet</b>Type a question below to start your first conversation.</div>';
  } else if(listAll.length===0){
    el.innerHTML='<div class="sb-empty">'+(state.folderFilter==='archived' ? '<b>Nothing archived</b>Chats you archive will appear here.' : '<b>Nothing here yet</b>Your conversations will appear here.')+'</div>';
  } else {
    listAll.forEach(function(c){ el.appendChild(buildChatItem(c, '')); });
  }
  renderFolders();
}
/* ---------- Folder editor (create / rename / icon / colour) ---------- */
function renderFolderPickers(){
  var ip=$('folderIconPick'); ip.innerHTML='';
  FOLDER_ICONS.forEach(function(ic){
    var b=document.createElement('button'); b.type='button';
    b.className=state.editIcon===ic?'on':'';
    b.innerHTML='<svg class="ic"><use href="#'+ic+'"/></svg>';
    b.title='Use this icon';
    b.onclick=function(){ state.editIcon=ic; renderFolderPickers(); };
    ip.appendChild(b);
  });
  var cp=$('folderColorPick'); cp.innerHTML='';
  FOLDER_COLORS.forEach(function(col){
    var b=document.createElement('button'); b.type='button';
    b.className=state.editColor===col?'on':'';
    b.innerHTML='<span class="fswatch" style="background:'+col+'"></span>';
    b.title='Use this colour';
    b.onclick=function(){ state.editColor=col; renderFolderPickers(); };
    cp.appendChild(b);
  });
}
function openFolderEditor(f){
  state.editFolderId=f?f.id:null;
  state.editIcon=f?f.icon:'i-folder';
  state.editColor=f?f.color:'#38BDF8';
  $('folderModalTitle').textContent=f?('Edit Folder — '+f.name):'New Folder';
  $('folderNameInput').value=f?f.name:'';
  renderFolderPickers();
  openModal('folderModal');
  setTimeout(function(){ $('folderNameInput').focus(); }, 40);
}
$('folderSaveBtn').onclick=function(){
  var name=$('folderNameInput').value.trim();
  if(!name){ toast('Give the folder a name first'); $('folderNameInput').focus(); return; }
  var clash=state.folders.some(function(f){ return f.name.toLowerCase()===name.toLowerCase() && f.id!==state.editFolderId; });
  if(clash){ toast('A folder named \u201C'+name+'\u201D already exists'); return; }
  if(state.editFolderId){
    var f=null; state.folders.forEach(function(x){ if(x.id===state.editFolderId) f=x; });
    if(f){
      var old=f.name;
      f.name=name; f.icon=state.editIcon; f.color=state.editColor;
      if(old!==name) state.chats.forEach(function(c){ if((c.folder||'')===old) c.folder=name; });
      saveChats();
    }
    toast('Folder updated');
  } else {
    state.folders.push({id:uid(), name:name, icon:state.editIcon, color:state.editColor});
    toast('Folder \u201C'+name+'\u201D created');
  }
  saveFolders(); closeModal('folderModal'); renderChatList();
};
$('folderNameInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); $('folderSaveBtn').click(); } });
/* ---------- Folder delete — never deletes chats silently ---------- */
function openFolderDelete(f){
  state.delFolderId=f.id;
  var n=state.chats.filter(function(c){ return (c.folder||'')===f.name; }).length;
  $('folderDelTitle').textContent='Delete the \u201C'+f.name+'\u201D folder?';
  $('folderDelText').textContent = n===0
    ? 'This folder is empty, so deleting it removes nothing else.'
    : 'This folder holds '+n+' chat'+(n===1?'':'s')+'. Deleting a folder never deletes its conversations on its own — choose what should happen to them.';
  $('folderDelMoveBtn').textContent = n===0 ? 'Delete folder' : 'Move chats out & delete folder';
  $('folderDelChatsBtn').style.display = n===0 ? 'none' : '';
  openModal('folderDelModal');
}
function finishFolderDelete(){
  state.folders=state.folders.filter(function(x){ return x.id!==state.delFolderId; });
  state.delFolderId=null;
  saveFolders(); closeModal('folderDelModal'); renderChatList();
}
$('folderDelMoveBtn').onclick=function(){
  var f=null; state.folders.forEach(function(x){ if(x.id===state.delFolderId) f=x; });
  if(f) state.chats.forEach(function(c){ if((c.folder||'')===f.name) c.folder=''; });
  saveChats(); finishFolderDelete(); toast('Folder deleted — its chats were moved out, not deleted');
};
$('folderDelChatsBtn').onclick=function(){
  var f=null; state.folders.forEach(function(x){ if(x.id===state.delFolderId) f=x; });
  if(!f){ finishFolderDelete(); return; }
  var name=f.name;
  closeModal('folderDelModal');
  confirmAction('Delete the chats too?', 'Every chat inside \u201C'+name+'\u201D will be permanently deleted from this browser along with the folder. This cannot be undone.', 'Yes, delete folder and chats', function(){
    state.chats=state.chats.filter(function(c){ return (c.folder||'')!==name; });
    if(!state.chats.some(function(c){ return c.id===state.activeId; })) state.activeId=state.chats[0]?state.chats[0].id:null;
    saveChats(); finishFolderDelete(); renderMessages(); toast('Folder and its chats deleted');
  });
};
/* ---------- Sidebar wiring: brand, new chat, search, collapse, profile, help ---------- */
$('brandHome').onclick=function(){
  var c=activeChat();
  if(!c || (c.messages||[]).length>0) createChat('New Chat');
  renderMessages();
  var sa=$('scrollArea'); if(sa) sa.scrollTop=0;
  $('sidebar').classList.remove('open');
  $('input').focus();
};
$('newChatBtn').onclick=function(){
  /* The previous conversation is already saved by the chat store; an untouched
     empty chat is simply reused instead of stacking duplicates. */
  var c=activeChat();
  if(c && (c.messages||[]).length===0){ renderMessages(); $('input').focus(); $('sidebar').classList.remove('open'); return; }
  createChat('New Chat');
  renderMessages();
  $('input').focus();
  $('sidebar').classList.remove('open');
};
function syncSearchUi(){
  var v=$('historySearch').value||'';
  $('searchClear').classList.toggle('show', v.length>0);
  $('searchKbd').style.display=v.length>0?'none':'';
}
$('historySearch').addEventListener('input', syncSearchUi);
$('searchClear').onclick=function(){
  $('historySearch').value=''; syncSearchUi(); renderChatList(); $('historySearch').focus();
};
function bindSecToggle(btnId, secId, key){
  var btn=$(btnId), sec=$(secId); if(!btn||!sec) return;
  if(state.sbClosed[key]){ sec.classList.add('closed'); btn.setAttribute('aria-expanded','false'); }
  btn.onclick=function(){
    var closed=sec.classList.toggle('closed');
    btn.setAttribute('aria-expanded', closed?'false':'true');
    state.sbClosed[key]=closed;
    savePref('enao_sb_closed', JSON.stringify(state.sbClosed));
  };
}
bindSecToggle('recentToggle', 'recentSec', 'recent');
bindSecToggle('foldersToggle', 'foldersBox', 'folders');
$('folderAddBtn').onclick=function(){ openFolderEditor(null); };
/* Profile menu — bottom of the sidebar only */
function closeProfileMenu(){ $('profileMenu').hidden=true; $('profileMenuBtn').setAttribute('aria-expanded','false'); }
$('profileMenuBtn').onclick=function(e){
  e.stopPropagation();
  var m=$('profileMenu'); var willOpen=m.hidden;
  m.hidden=!willOpen;
  $('profileMenuBtn').setAttribute('aria-expanded', willOpen?'true':'false');
};
document.addEventListener('click', function(e){
  var m=$('profileMenu'); if(!m || m.hidden) return;
  if(!(e.target.closest && e.target.closest('.profilebox'))) closeProfileMenu();
  if(state.folderMenuId && !(e.target.closest && e.target.closest('.folderrow-wrap'))){ state.folderMenuId=null; renderChatList(); }
});
function openSettingsFromSidebar(){ closeProfileMenu(); closeModal('helpModal'); if(typeof refreshSettingsUI==='function') refreshSettingsUI(); openModal('settingsModal'); }
$('profileViewBtn').onclick=openSettingsFromSidebar;
$('profileEditBtn').onclick=openSettingsFromSidebar;
$('profilePrefsBtn').onclick=openSettingsFromSidebar;
$('profilePrivacyBtn').onclick=openSettingsFromSidebar;
$('planBtn').addEventListener('click', closeProfileMenu);
$('logoutBtn').addEventListener('click', closeProfileMenu);
/* Online / offline status follows the browser's real connection state */
function syncOnlineStatus(){
  var on=navigator.onLine!==false;
  var txt=$('profileStatusTxt'); if(txt) txt.textContent=on?'Online':'Offline';
  var box=$('profileStatus'); if(box) box.classList.toggle('off', !on);
}
window.addEventListener('online', syncOnlineStatus);
window.addEventListener('offline', syncOnlineStatus);
syncOnlineStatus();
/* Help & Support */
var HELP_CONTENT={
  start:{t:'Getting Started', b:'<p>Tap <b>New Chat</b> (or press Ctrl+N), type your question in the box at the bottom, and press Enter. ENZO searches the live internet, reads the best sources, and answers in your own language — English, Urdu or Roman Urdu.</p><p>Your conversations are saved in this browser automatically, so you can close the page and pick any chat up again from the sidebar.</p>'},
  guide:{t:'User Guide', b:'<p><b>Sidebar:</b> Pinned Chats stay at the top, Recent Chats are ordered by last activity, and Chat Folders organise everything else. Drag a chat onto a folder, or use its three-dot menu to move, duplicate, export, archive or delete it.</p><p><b>Search Chats</b> (Ctrl+K) looks through titles and the messages inside every conversation. <b>Attach</b> in the composer adds images and documents to a question. The mic button turns voice questions and spoken answers on or off.</p>'},
  center:{t:'Help Center', b:'<p>Everything in ENZO runs free, right in your browser — there are no paid plans and nothing expires. Chats and settings live only in this browser on this device; the question text you type is sent to the free search and answer services only when you ask something.</p><p>For anything this panel does not answer, use <b>Report a Bug</b> or <b>Send Feedback</b> below.</p>'},
  trouble:{t:'Troubleshooting', b:'<p><b>An answer looks wrong or thin:</b> ask the same question again — live search results change through the day, and the Retry button on a failed answer re-runs the search.</p><p><b>Voice is not working:</b> allow microphone permission in your browser, and check the Answers aloud setting at the top. <b>Chats seem missing:</b> clear the sidebar search, open See all, and check the Archived row in Chat Folders.</p>'},
  faq:{t:'Frequently Asked Questions', b:'<p><b>Is ENZO really free?</b> Yes — Lifetime Free. Every feature is included, with no card and no expiry.</p><p><b>Where are my chats stored?</b> Only in this browser, on this device. Export them any time from Settings, or from a chat\u2019s three-dot menu.</p><p><b>Does deleting a folder delete its chats?</b> Never on its own — you are asked whether to move the chats out or delete them with the folder.</p>'},
  bug:{t:'Report a Bug', b:'<p>Describe what went wrong — what you asked, what you expected, and what happened instead. The feedback box copies your words so you can paste them wherever you share them; nothing is uploaded automatically.</p>'}
};
$('helpBtn').onclick=function(){ openModal('helpModal'); };
document.querySelectorAll('#helpModal [data-help]').forEach(function(b){
  b.onclick=function(){
    var k=b.getAttribute('data-help');
    if(k==='feedback'){ closeModal('helpModal'); openModal('feedbackModal'); return; }
    if(k==='bug'){ var d=$('helpDetail'); d.innerHTML='<h4>'+HELP_CONTENT.bug.t+'</h4>'+HELP_CONTENT.bug.b+'<button class="primary" id="helpBugGo" style="margin-top:6px">Write the report</button>'; d.classList.add('show'); $('helpBugGo').onclick=function(){ closeModal('helpModal'); openModal('feedbackModal'); }; return; }
    var c=HELP_CONTENT[k]; if(!c) return;
    var d2=$('helpDetail'); d2.innerHTML='<h4>'+c.t+'</h4>'+c.b; d2.classList.add('show');
  };
});
$('aboutBtn').addEventListener('click', function(){ closeModal('helpModal'); });
/* Keyboard: Ctrl+N new chat, Ctrl+K search, Ctrl+, settings */
document.addEventListener('keydown', function(e){
  var mod=e.ctrlKey||e.metaKey; if(!mod) return;
  if(e.key==='n'||e.key==='N'){ e.preventDefault(); $('newChatBtn').click(); }
  else if(e.key==='k'||e.key==='K'){ e.preventDefault(); if(window.__enzoMobileUI()) $('sidebar').classList.add('open'); var hs=$('historySearch'); hs.focus(); hs.select(); }
  else if(e.key===','){ e.preventDefault(); openSettingsFromSidebar(); }
});
/* The search field's filter button keeps its old job — show/hide the folders —
   tracked with a class so re-renders never undo the choice. */
$('searchFilterBtn').onclick=function(){
  var fb=$('foldersBox'); if(!fb) return;
  var hide=!fb.classList.contains('sb-filter-hidden');
  fb.classList.toggle('sb-filter-hidden', hide);
  fb.style.display=hide?'none':'';
  toast(hide?'Chat folders hidden — tap the filter icon to bring them back':'Chat folders shown');
};
document.addEventListener('keydown', function(e){
  if(e.key!=='Escape') return;
  closeProfileMenu();
  if(state.folderMenuId){ state.folderMenuId=null; renderChatList(); }
});
loadFolders();
syncSearchUi();
renderChatList();
