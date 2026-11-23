
/* ================= P-F EXTRAS 3 — THE USER'S RULES + NEVER REFUSE =================
   The user sets ENZO's rules: what it should do and what it should NOT do.
   The list lives here in Settings — viewable, editable, deletable — is
   stored in this browser, and is attached to every answer prompt and every
   backend ask. ENZO follows these rules always and never invents its own
   limits. Standing rule number one (the user's own order): NEVER REFUSE
   ordered work — always try, find another route when one is blocked, and
   when something is genuinely impossible right now, name the exact blocker
   and the exact thing needed, then continue the moment it is provided. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function escH(s){ return (typeof esc==='function') ? esc(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var RULES_KEY='enao_userrules_v1';
function rulesLoad(){ try{ var j=JSON.parse(localStorage.getItem(RULES_KEY)||'[]'); return Array.isArray(j)?j:[]; }catch(e){ return []; } }
var userRules=rulesLoad();
function rulesSave(){ try{ localStorage.setItem(RULES_KEY, JSON.stringify(userRules)); }catch(e){} }
window.__userRules=function(){ return userRules.slice(); };
function rulesNote(){
  var lines=['[The user\'s rules for ENZO — follow them always, they override any default habit:]',
    '1. NEVER REFUSE ordered work: never refuse, never give up; if one route is blocked, find another; if something is genuinely impossible right now, say exactly what is blocking it and exactly what you need from the user, and continue the moment the user provides it.'];
  userRules.forEach(function(r, i){ lines.push((i+2)+'. '+r); });
  return '\n\n'+lines.join('\n');
}
if(typeof window.answerWithSources==='function'){
  var prevAWS2=window.answerWithSources;
  window.answerWithSources=function(text, sources, lang, deep, historyText, steps){
    return prevAWS2(text, sources, lang, deep, (historyText||'')+rulesNote(), steps);
  };
}
if(typeof window.callAIKnowledge==='function'){
  var prevCAIK2=window.callAIKnowledge;
  window.callAIKnowledge=function(q, lang, deep, historyText){
    return prevCAIK2(q, lang, deep, (historyText||'')+rulesNote());
  };
}
function renderRules(){
  var box=$('rulesBody'); if(!box) return;
  var h='<div class="lrn-corr"><span><b>Standing rule:</b> Never refuse ordered work — always try, find another route when one is blocked, name the exact blocker when truly stuck, and continue the moment the user provides what is needed.</span></div>';
  if(!userRules.length) h+='<div class="lrn-row"><span>No rules of your own yet — add the first one below.</span></div>';
  userRules.forEach(function(r, i){
    h+='<div class="lrn-corr"><span>'+escH(r)+'</span><button type="button" class="lrn-x" data-rule="'+i+'">Delete</button></div>';
  });
  box.innerHTML=h;
  box.querySelectorAll('[data-rule]').forEach(function(b){
    b.onclick=function(){
      userRules.splice(parseInt(b.getAttribute('data-rule'),10),1);
      rulesSave(); renderRules(); toast('Rule deleted');
    };
  });
}
function buildRulesUI(){
  var card=document.querySelector('#settingsModal .modal-card');
  if(!card || $('rulesBox')) return;
  var box=document.createElement('div');
  box.id='rulesBox'; box.className='learned-box';
  box.innerHTML='<h4>My rules for ENZO</h4><p class="lrn-note">Your rules — what ENZO should do and what it should NOT do. ENZO follows them always and never invents its own limits. They are stored only in this browser and travel with every question.</p>'
    +'<div id="rulesBody"></div>'
    +'<div style="display:flex;gap:7px;margin-top:9px"><input type="text" id="ruleInput" placeholder="Write a rule, e.g. Always answer briefly, or Never use formal language" style="flex:1;min-width:150px">'
    +'<button type="button" class="lrn-toggle" id="ruleAddBtn">Add rule</button></div>';
  card.appendChild(box);
  $('ruleAddBtn').onclick=function(){
    var v=$('ruleInput').value.trim();
    if(!v){ toast('Write the rule first'); return; }
    userRules.push(v.slice(0,240));
    rulesSave(); renderRules();
    $('ruleInput').value='';
    toast('Rule added — ENZO will follow it from now on');
  };
  renderRules();
}
if(typeof window.refreshSettingsUI==='function'){
  var prevRefresh2=window.refreshSettingsUI;
  window.refreshSettingsUI=function(){ var r=prevRefresh2.apply(this, arguments); renderRules(); return r; };
}
buildRulesUI();
})();

