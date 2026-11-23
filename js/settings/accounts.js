
/* ================= P-F EXTRAS 2 — MULTI-ACCOUNT HANDLING =================
   ENZO is not limited to one account: the user can register UNLIMITED
   accounts and websites here (platform + account name), switch the active
   one, and each account's record stays strictly separate. Platform work is
   always prepared for the ACTIVE account and names it before any action.
   Sending, posting, publishing or deleting always needs the user's approval
   first — ENZO prepares everything and the user's own tap is the final step
   (for email, the prepared draft opens in the user's own mail app, ready to
   send). Nothing here ever claims an action happened when it did not. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function escH(s){ return (typeof esc==='function') ? esc(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var ACC_KEY='enao_accounts_v1';
function accLoad(){ try{ var j=JSON.parse(localStorage.getItem(ACC_KEY)||'null'); if(j && Array.isArray(j.list)) return j; }catch(e){} return {list:[], activeId:''}; }
var accounts=accLoad();
function accSave(){ try{ localStorage.setItem(ACC_KEY, JSON.stringify(accounts)); }catch(e){} }
function activeAccount(){ for(var i=0;i<accounts.list.length;i++) if(accounts.list[i].id===accounts.activeId) return accounts.list[i]; return null; }
window.__activeAccount=activeAccount;
function accountNote(){
  var a=activeAccount();
  if(!a) return '\n\n[Accounts: the user has not set an active account in Settings. For any platform work, prepare everything completely and ask which account it is for before the final step.]';
  return '\n\n[Active account for platform work: "'+a.name+'" on '+a.platform+'. Prepare work for THIS account only, name this account clearly before any action, and keep every other account\'s work strictly separate. Sending, posting, publishing or deleting always needs the user\'s approval first — prepare everything and leave the final tap to the user.]';
}
if(typeof window.answerWithSources==='function'){
  var prevAWS=window.answerWithSources;
  window.answerWithSources=function(text, sources, lang, deep, historyText, steps){
    return prevAWS(text, sources, lang, deep, (historyText||'')+accountNote(), steps);
  };
}
if(typeof window.callAIKnowledge==='function'){
  var prevCAIK=window.callAIKnowledge;
  window.callAIKnowledge=function(q, lang, deep, historyText){
    return prevCAIK(q, lang, deep, (historyText||'')+accountNote());
  };
}
function renderAccounts(){
  var box=$('accountsBody'); if(!box) return;
  if(!accounts.list.length){
    box.innerHTML='<div class="lrn-row"><span>No accounts added yet — add as many as you have, on any platform or website.</span></div>';
    return;
  }
  box.innerHTML=accounts.list.map(function(a){
    var isA=a.id===accounts.activeId;
    return '<div class="lrn-corr"><span><b>'+escH(a.name)+'</b> <span style="color:var(--muted)">'+escH(a.platform)+'</span>'+(isA?' <b style="color:#00D9FF">Active</b>':'')+'</span>'
      +'<span style="display:flex;gap:6px">'+(isA?'':'<button type="button" class="lrn-x" data-acc="on" data-id="'+a.id+'">Make active</button>')
      +'<button type="button" class="lrn-x" data-acc="del" data-id="'+a.id+'">Delete</button></span></div>';
  }).join('');
  box.querySelectorAll('[data-acc]').forEach(function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-id'), act=b.getAttribute('data-acc');
      if(act==='on'){ accounts.activeId=id; accSave(); renderAccounts(); var a=activeAccount(); toast('Active account: '+(a?a.name+' on '+a.platform:'')); }
      if(act==='del'){
        accounts.list=accounts.list.filter(function(x){ return x.id!==id; });
        if(accounts.activeId===id) accounts.activeId=accounts.list.length?accounts.list[0].id:'';
        accSave(); renderAccounts(); toast('Account removed from ENZO');
      }
    };
  });
}
function buildAccountsUI(){
  var card=document.querySelector('#settingsModal .modal-card');
  if(!card || $('accountsBox')) return;
  var box=document.createElement('div');
  box.id='accountsBox'; box.className='learned-box';
  box.innerHTML='<h4>Accounts ENZO handles</h4><p class="lrn-note">Unlimited accounts, on any platform or website — each kept strictly separate. ENZO prepares work for the active account and names it before acting. Sending, posting, publishing or deleting always needs your approval first; for email, ENZO prepares the full draft and it opens in your own mail app for you to send.</p>'
    +'<div style="display:flex;gap:7px;flex-wrap:wrap;margin:8px 0"><input type="text" id="accPlatform" placeholder="Platform or website (e.g. Fiverr, YouTube, Gmail)" style="flex:1;min-width:150px">'
    +'<input type="text" id="accName" placeholder="Account name or handle" style="flex:1;min-width:150px">'
    +'<button type="button" class="lrn-toggle" id="accAddBtn">Add account</button></div>'
    +'<div id="accountsBody"></div>';
  card.appendChild(box);
  $('accAddBtn').onclick=function(){
    var p=$('accPlatform').value.trim(), n=$('accName').value.trim();
    if(!p || !n){ toast('Write both the platform and the account name first'); return; }
    var a={id:uid(), platform:p.slice(0,60), name:n.slice(0,80), created:Date.now()};
    accounts.list.push(a);
    if(!accounts.activeId) accounts.activeId=a.id;
    accSave(); renderAccounts();
    $('accPlatform').value=''; $('accName').value='';
    toast('Account added: '+a.name+' on '+a.platform);
  };
  renderAccounts();
}
if(typeof window.refreshSettingsUI==='function'){
  var prevRefresh=window.refreshSettingsUI;
  window.refreshSettingsUI=function(){ var r=prevRefresh.apply(this, arguments); renderAccounts(); return r; };
}
buildAccountsUI();
})();

