/* ================= v66-memory — Piece E: restore chats from backend =================
   ROOT CAUSE (verified, do not re-diagnose): the frontend restores chats from
   localStorage only (loadChats in js/core/state.js ~line 212, called at boot
   in js/chat/ui-wiring-b.js ~line 97). localStorage is per-device: a cleared
   browser or another device loses the chats entirely, even though the
   backend SQLite DB still holds them.
   THIS FILE: fallback-only restore. At boot, IF loadChats() found no chats,
   fetch the most recent chats from GET /api/v2/chats (cap 10) and each
   chat's messages from GET /api/v2/chats/<id>/messages (cap 50/chat), map
   them onto the frontend chat/message shape, and persist them with the
   existing saveChats() so the normal boot path then loads them.
   - NEVER overwrites local chats: if localStorage holds ANY chats at entry,
     or a chat appears in state while the fetch is in flight, restore aborts
     without writing anything.
   - Async, never blocks boot: the UI boots with whatever is local; restored
     chats appear when the fetch completes (renderChatList + renderMessages).
   - Backend down / fetch fails / malformed response: silent fallback — no
     crash, no user-visible error, no retry loop, exactly one console.warn
     per restore attempt.
   - History is strictly per-chat: messages are fetched per chat_id and
     mapped into that chat only; nothing is ever copied between chats.
   - No new dependencies, no third-party APIs. The backend is ENZO's own
     /api/v2 (same base-URL helper as the platform adapter — see below).
   LOAD ORDER: js/core/backend-restore.js, inserted in index.html
   immediately before js/chat/ui-wiring-b.js (after
   js/tools/tools-settings.js). It only DEFINES window.EnzoRestoreFromBackend
   at load time; everything it calls (state, saveChats, renderChatList,
   renderMessages, uid, detectLang) runs later, after all scripts load.
   NOTE on the GET helper: platform-adapter.js defines v2get() inside its
   own IIFE (not on window) AND loads AFTER ui-wiring-b.js, so it is not
   available at boot. This file therefore uses fetch() directly with the
   same base URL (window.EnzoPagesBackend.getBackendBase(), falling back
   to '/api/v2') and the same timeout/abort pattern as v2req(). */
(function(){
'use strict';

var MAX_CHATS = 10;                 /* most recent chats to restore */
var MAX_MESSAGES_PER_CHAT = 50;     /* messages per chat to restore */
var REQUEST_TIMEOUT_MS = 20000;     /* per request, same as v2req default */
var STORE_KEY = 'enao_chats_v1';    /* same key loadChats/saveChats use */

function backendBase(){
  try{
    if(window.EnzoPagesBackend && typeof window.EnzoPagesBackend.getBackendBase==='function'){
      var b=window.EnzoPagesBackend.getBackendBase();
      if(typeof b==='string' && b) return b;
    }
  }catch(e){}
  return '/api/v2'; /* same-origin default (RELATIVE_BACKEND_BASE in pages-backend.js) */
}

function fetchJson(path){
  var url=backendBase()+path;
  var ctl=null, timer=null;
  try{
    if(typeof AbortController!=='undefined'){
      ctl=new AbortController();
      timer=setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, REQUEST_TIMEOUT_MS);
    }
  }catch(e){}
  return fetch(url, {method:'GET', signal: ctl?ctl.signal:undefined}).then(function(r){
    if(timer) clearTimeout(timer);
    return r.json().catch(function(){ return null; }).then(function(j){
      if(!r.ok || !j || j.ok===false) throw new Error('backend GET '+path+' failed (http '+r.status+')');
      return j;
    });
  }, function(e){ if(timer) clearTimeout(timer); throw e; });
}

/* Backend created_at is integer epoch SECONDS (db.now_ts); frontend ts is
   epoch MILLISECONDS. Accepts ms numbers and ISO strings defensively. */
function toMs(ts){
  if(typeof ts==='number' && isFinite(ts)) return ts>1e12 ? ts : ts*1000;
  if(typeof ts==='string' && ts){
    var n=Number(ts); if(isFinite(n) && n>0) return n>1e12 ? n : n*1000;
    var p=Date.parse(ts); if(isFinite(p)) return p;
  }
  return Date.now();
}

function escHtml(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function htmlFor(content){
  /* Assistant answers render from m.html (buildMessageEl in render.js);
     the live pipeline builds it with mdToHtml, so use that when present,
     otherwise escaped plain text with line breaks preserved. */
  try{
    if(typeof mdToHtml==='function') return mdToHtml(content);
  }catch(e){}
  return '<p>'+escHtml(content).replace(/\n/g,'<br>')+'</p>';
}

/* Backend public_message (server.py _list_messages / public_message):
   {msg_id, chat_id, role, kind, content, created_at, via_voice, deep,
   rating}. Frontend roles are 'user' and 'ai' (buildMessageEl /
   answer-gen); backend 'system' messages are not conversation and are
   skipped by the caller, never mapped. */
function mapMessage(bm){
  var role = bm.role==='user' ? 'user' : 'ai';
  var content = typeof bm.content==='string' ? bm.content : '';
  var lang='en';
  try{ if(typeof detectLang==='function') lang=detectLang(content)||'en'; }catch(e){}
  var m={role:role, text:content, html:'', plain:content, lang:lang,
    ts:toMs(bm.created_at), deep:!!bm.deep, viaVoice:!!bm.via_voice,
    rating:(typeof bm.rating==='string'?bm.rating:''), sources:[], followups:[]};
  if(role==='ai') m.html=htmlFor(content);
  return m;
}

/* Backend public_chat (server.py _list_chats / public_chat):
   {chat_id, title, created_at, updated_at, archived}. The local id stays
   a fresh uid() — the backend id is kept separately as backendId, exactly
   like chats created live (platform-adapter maps local id -> backendId),
   so a later ask in a restored chat reuses the SAME backend chat instead
   of creating a new one. mode/deep default to Auto: the backend stores no
   per-chat mode override. */
function mapChat(bc, messages){
  var id=(typeof uid==='function') ? uid() : ('c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
  return {id:id, title:(typeof bc.title==='string' && bc.title)?bc.title:'New Chat',
    created:toMs(bc.created_at), pinned:false, archived:!!bc.archived,
    folder:'', mode:'auto', deep:false, backendId:bc.chat_id||'',
    backendTaskId:'', lastTaskId:'', messages:messages||[]};
}

function localHasChats(){
  try{
    var raw=localStorage.getItem(STORE_KEY);
    if(!raw) return false;
    var data=JSON.parse(raw);
    return !!(data && data.chats && data.chats.length);
  }catch(e){ return false; } /* unreadable local store counts as empty: nothing usable to protect */
}

/* Restore chats from the backend. onDone(count) is called exactly once
   with the number of chats restored (0 when skipped / failed / empty).
   Returns a Promise resolving to the same count. Never throws. */
function restoreFromBackend(onDone){
  var doneCalled=false;
  function done(n){
    if(doneCalled) return; doneCalled=true;
    try{ if(typeof onDone==='function') onDone(n); }catch(e){}
  }
  var warned=false;
  function warn(msg){ if(warned) return; warned=true; try{ console.warn('[EnzoRestoreFromBackend] '+msg); }catch(e){} }

  /* Guard A — fallback only: ANY local chats means no backend fetch at all. */
  try{ if(localHasChats()){ done(0); return Promise.resolve(0); } }catch(e){ done(0); return Promise.resolve(0); }
  if(typeof fetch!=='function'){ warn('fetch is not available; keeping local chats.'); done(0); return Promise.resolve(0); }

  var p=fetchJson('/chats').then(function(j){
    if(!j || !Array.isArray(j.chats)) throw new Error('malformed /chats response');
    return j.chats.slice(0, MAX_CHATS);
  }).then(function(chats){
    var out=[];
    var chain=Promise.resolve();
    chats.forEach(function(bc){
      chain=chain.then(function(){
        if(!bc || typeof bc.chat_id!=='string' || !bc.chat_id) return;
        return fetchJson('/chats/'+encodeURIComponent(bc.chat_id)+'/messages?limit='+MAX_MESSAGES_PER_CHAT).then(function(j){
          if(!j || !Array.isArray(j.messages)) throw new Error('malformed messages response for '+bc.chat_id);
          var msgs=[];
          j.messages.slice(0, MAX_MESSAGES_PER_CHAT).forEach(function(bm){
            if(!bm || typeof bm.content!=='string') return;
            if(bm.role==='system') return; /* not conversation */
            if(bm.role!=='user' && bm.role!=='assistant') return;
            msgs.push(mapMessage(bm));
          });
          out.push(mapChat(bc, msgs));
        }).catch(function(e){
          /* One chat failing (e.g. deleted between list and fetch) must
             not lose the others; the single warning covers the whole run. */
          warn('message fetch failed for a chat; that chat was skipped ('+(e&&e.message?e.message:e)+').');
        });
      });
    });
    return chain.then(function(){ return out; });
  }).then(function(restored){
    /* Guard B — race: the user started a chat while the fetch was in
       flight. Never overwrite it; the backend copy stays on the backend. */
    try{
      if(state.chats.length || localHasChats()){ done(0); return 0; }
    }catch(e){}
    if(!restored.length){ done(0); return 0; }
    if(typeof saveChats!=='function'){ warn('saveChats is not available; restored chats were not saved.'); done(0); return 0; }
    state.chats=restored; /* backend list order is most-recent first; frontend keeps newest first */
    state.activeId=restored[0].id;
    try{ saveChats(); }catch(e){ warn('saving restored chats failed ('+(e&&e.message?e.message:e)+').'); done(0); return 0; }
    try{ if(typeof renderChatList==='function') renderChatList(); }catch(e){}
    try{ if(typeof renderMessages==='function') renderMessages(); }catch(e){}
    done(restored.length);
    return restored.length;
  }).catch(function(e){
    warn('backend restore unavailable; keeping local chats ('+(e&&e.message?e.message:e)+').');
    done(0);
    return 0;
  });
  return p;
}

window.EnzoRestoreFromBackend=restoreFromBackend;
window.EnzoRestoreFromBackend.MAX_CHATS=MAX_CHATS;
window.EnzoRestoreFromBackend.MAX_MESSAGES_PER_CHAT=MAX_MESSAGES_PER_CHAT;
})();
