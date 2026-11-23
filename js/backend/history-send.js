/* ENAO AI v66-memory — Piece D (frontend send)
   Build the `history` field for the backend /ask body from the ACTIVE
   chat's local messages. Classic script, no dependencies, no third-party
   APIs. Load order: immediately BEFORE js/backend/platform-adapter.js
   (index.html, directly above the platform-adapter.js <script> line).
   The caller (platform-adapter.js, backendAsk) passes chat.messages of
   the ACTIVE chat only — never another chat's messages. */
var ENZO_HISTORY_MAX_TURNS=10;    /* last 10 turns total */
var ENZO_HISTORY_MAX_PER_ROLE=5;  /* at most 5 user + 5 assistant */
var ENZO_HISTORY_MAX_CHARS=400;   /* per-turn text cap */
function buildAskHistory(messages){
  var list=(messages&&messages.slice)?messages.slice():[];
  /* The current question is ALREADY the last element of chat.messages:
     backendAsk calls pushUserMsg(chat, text, ...) BEFORE the ask body
     is built (platform-adapter.js ~line 635 vs ~line 667). Drop it by
     POSITION. Never filter by text equality: a genuine earlier turn
     that repeats the question must stay in history. The role check
     guards the (never expected) case where the last element is not
     the just-pushed user message — then nothing is dropped. */
  if(list.length && list[list.length-1].role==='user') list=list.slice(0,-1);
  var out=[], users=0, assistants=0;
  for(var i=list.length-1;i>=0 && out.length<ENZO_HISTORY_MAX_TURNS;i--){
    var m=list[i];
    if(!m) continue;
    var role=(m.role==='user')?'user':(m.role==='ai')?'assistant':null;
    if(!role) continue;
    var t=plainTextOfMessage(m);
    if(!t) continue;
    if(role==='user'){ if(users>=ENZO_HISTORY_MAX_PER_ROLE) continue; users++; }
    else { if(assistants>=ENZO_HISTORY_MAX_PER_ROLE) continue; assistants++; }
    out.unshift({role:role, text:t});
  }
  return out;
}
function plainTextOfMessage(m){
  /* AI messages carry the answer in .plain (aiMsgShell sets plain and an
     empty html; _fullHtml holds the rendered HTML). User messages carry
     .text. The fallback path's historyText uses (m.text ||
     stripHtml(m.html)) — that yields '' for delivered AI answers, so
     .plain is preferred here and stripHtml(m.html) is the fallback,
     exactly as the fallback path does it. stripHtml lives in
     js/chat/render.js, loaded before platform-adapter.js; the regex
     fallback only runs if it is somehow unavailable (e.g. a harness). */
  var t='';
  if(m.text) t=String(m.text);
  else if(m.plain) t=String(m.plain);
  else if(typeof stripHtml==='function') t=stripHtml(m.html||'');
  else t=String(m.html||'').replace(/<[^>]*>/g,'');
  return t.trim().slice(0,ENZO_HISTORY_MAX_CHARS);
}
if(typeof window!=='undefined'){ window.EnzoHistorySend={buildAskHistory:buildAskHistory}; }
