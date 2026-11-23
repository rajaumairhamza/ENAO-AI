
/* ============================================================================
 * ENAO AI v58-research-live — assembly wiring for pieces 21-25.
 * - Piece 21 lifecycle instance, created once at startup (no indicatorEl:
 *   setIndicator uses #typingRow / #typingLabel).
 * - Stale task state is purged on load through purgeStaleState.
 * - Piece 25 orchestrator: needsInternet is consulted by the outermost
 *   askQuestion wrapper BEFORE the backend/legacy branch, with the live
 *   lifecycle instance and the page-global classifyIntent passed as deps,
 *   plus deps.search / deps.fetch / deps.fetchJson / deps.fetchText /
 *   deps.socialFetcher (the pieces never fetch the network themselves).
 *   Normal conversation (needsInternet false) never starts a research run
 *   here; research requests run the 9-step workflow, whose step 9 completes
 *   through the lifecycle instance. Social/video specialist results are
 *   rendered into the newest answer's Resources area: video cards via
 *   EnzoVideo.videoCardHtml, inline players ONLY via EnzoVideo.embedHtml
 *   (embeddable===true); otherwise the card's thumbnail + direct link stand.
 * - Piece 24 Live Screen: a "Live Screen" button next to "View Live
 *   Research"; the task id always comes from
 *   EnzoMonitor.getState().activeTaskId, never hard-coded.
 * ========================================================================== */
(function(){
  'use strict';
  try{ if(window.EnzoSearchLifecycle && typeof window.EnzoSearchLifecycle.createLifecycle==='function' && !window.__enzoLifecycle){ window.__enzoLifecycle = window.EnzoSearchLifecycle.createLifecycle({fetch: window.fetch.bind(window)}); } }catch(e){}

  try{
    var storedTaskState58=null;
    try{ storedTaskState58=JSON.parse(localStorage.getItem('enao_task_state_v1')||'null'); }catch(e1){}
    if(storedTaskState58 && window.EnzoSearchLifecycle && typeof window.EnzoSearchLifecycle.purgeStaleState==='function'){
      var cleaned58=window.EnzoSearchLifecycle.purgeStaleState(storedTaskState58);
      window.__enzoPurgedTaskState=cleaned58;
      try{ localStorage.setItem('enao_task_state_v1', JSON.stringify(cleaned58.state)); }catch(e2){}
    }
  }catch(e){}

  try{
    var css58=document.createElement('style'); css58.id='enzoV58MediaCss';
    css58.textContent='.enzo-video-card{display:flex;gap:10px;align-items:flex-start;margin:10px 0;padding:10px;border:1px solid var(--line,#dde5e1);border-radius:10px;background:var(--surface2,#eef2f0)}'
      +'.enzo-video-thumb{width:120px;height:68px;object-fit:cover;border-radius:6px;flex:0 0 120px}'
      +'.enzo-video-thumb-placeholder{width:120px;height:68px;flex:0 0 120px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--surface,#fff);color:var(--muted,#5b6d66);font-size:11.5px;text-align:center}'
      +'.enzo-video-body{flex:1;min-width:0}.enzo-video-title{margin:0 0 2px;font-size:13.5px}'
      +'.enzo-video-channel,.enzo-video-meta{margin:0;font-size:12px;color:var(--muted,#5b6d66)}'
      +'.enzo-video-watch{display:inline-block;margin-top:6px;font-size:12.5px;font-weight:700}'
      +'.enzo-video-play{margin-left:10px;font-size:12.5px;cursor:pointer}'
      +'.enzo-media-results iframe{max-width:100%}'
      +'.enzo-social-result{margin:6px 0;font-size:13px}.enzo-social-result span{color:var(--muted,#5b6d66)}';
    document.head.appendChild(css58);
  }catch(e){}

  function fetchJson58(url){ if(typeof fetchJSONT==='function') return fetchJSONT(url, 15000); return fetch(url).then(function(r){ return r.json(); }); }
  function fetchText58(url){ return fetchJson58(url).then(function(j){ return (j && typeof j.text==='string') ? j.text : ''; }); }
function search58(query){
  var cleanQ=query;
  try{ cleanQ=stripPlaceWordFromQuery(query, detectSource(query).source); }catch(e){}
  if(!cleanQ) cleanQ=query;
  return fetchJson58(window.EnzoPagesBackend.getSearchUrl('/api/search?q='+encodeURIComponent(cleanQ))).then(function(j){ var arr=[]; if(Array.isArray(j)) arr=j; else if(j) arr=j.results||j.items||[]; return arr; });
}
  function fetch58(url){ return fetchJson58(window.EnzoPagesBackend.getSearchUrl('/api/fetch?url='+encodeURIComponent(url))); }
  window.__enzoResearchDeps={ fetchJson:fetchJson58, fetchText:fetchText58, search:search58, fetch:fetch58 };

  window.__enzoPendingMedia=null;
  var prevAsk58=window.askQuestion;
  if(typeof prevAsk58==='function'){
    window.askQuestion=function(text, viaVoice, forcedDeep){
      var verdict=null;
      try{ if(window.EnzoInternetOrchestrator && typeof window.EnzoInternetOrchestrator.needsInternet==='function'){ verdict=window.EnzoInternetOrchestrator.needsInternet(text, {classifyIntent:(typeof classifyIntent==='function'?classifyIntent:null)}); } }catch(e){}
      window.__enzoLastRouting=verdict;
      if(verdict && verdict.needsInternet && window.EnzoInternetOrchestrator && typeof window.EnzoInternetOrchestrator.run==='function'){
        try{
          var deps58={ lifecycle: window.__enzoLifecycle||null, classifyIntent:(typeof classifyIntent==='function'?classifyIntent:null), search:search58, fetch:fetch58, fetchJson:fetchJson58, fetchText:fetchText58, socialFetcher:fetchJson58 };
          window.EnzoInternetOrchestrator.run({text:text, viaVoice:!!viaVoice}, deps58).then(function(out){
            try{
              window.__enzoLastResearch=out;
              var vids=[], soc=[], res=(out && out.results)||[], i, r;
              for(i=0;i<res.length;i++){ r=res[i]; if(!r) continue; if(typeof r.embeddable!=='undefined' && r.url) vids.push(r); else if(r.platform && r.url) soc.push(r); }
              if(vids.length || soc.length){ window.__enzoPendingMedia={question:text, videos:vids, social:soc, at:Date.now()}; if(typeof window.renderMessages==='function') window.renderMessages(); }
            }catch(e){}
          }, function(){});
        }catch(e){}
      }
      return prevAsk58(text, viaVoice, forcedDeep);
    };
  }

  function esc58(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function injectPendingMedia58(){
    var pm=window.__enzoPendingMedia; if(!pm) return;
    if(Date.now()-(pm.at||0) > 180000){ window.__enzoPendingMedia=null; return; }
    var panels=document.querySelectorAll('.respanel'); if(!panels.length) return;
    var panel=panels[panels.length-1];
    if(panel.querySelector('.enzo-media-results')) return;
    var html='', i, r;
    if(pm.videos && pm.videos.length && window.EnzoVideo){
      html+='<div style="margin-top:12px;font-weight:700;font-size:13px">Videos found for this research:</div>';
      for(i=0;i<pm.videos.length;i++){ html+=window.EnzoVideo.videoCardHtml(pm.videos[i]); }
    }
    if(pm.social && pm.social.length){
      html+='<div style="margin-top:12px;font-weight:700;font-size:13px">Social results:</div>';
      for(i=0;i<pm.social.length;i++){ r=pm.social[i]; html+='<div class="enzo-social-result"><a href="'+esc58(r.url)+'" target="_blank" rel="noopener">'+esc58(r.title||r.url)+'</a> <span>('+esc58(r.platform||'social')+(r.account?(' - '+esc58(r.account)):'')+')</span></div>'; }
    }
    if(!html) return;
    var box=document.createElement('div'); box.className='enzo-media-results'; box.innerHTML=html;
    panel.appendChild(box);
  }
  var prevRender58=window.renderMessages;
  if(typeof prevRender58==='function'){
    window.renderMessages=function(){ var out=prevRender58.apply(this, arguments); try{ injectPendingMedia58(); }catch(e){} return out; };
  }
  document.addEventListener('click', function(ev){
    var t=ev && ev.target;
    if(!t || !t.getAttribute || t.getAttribute('data-act')!=='enzo-video-play') return;
    var embed=t.getAttribute('data-embed'); if(!embed || !window.EnzoVideo) return;
    var html=window.EnzoVideo.embedHtml({embeddable:true, embedUrl:embed, title:'Video'});
    if(html){ var holder=document.createElement('div'); holder.innerHTML=html; if(t.parentNode) t.parentNode.replaceChild(holder, t); }
  });

  function wireLiveScreenBtn58(){
    if(document.getElementById('enzoLiveScreenBtn')) return true;
    var anchor=document.getElementById('enzoMonitorBtn'); if(!anchor || !anchor.parentNode) return false;
    var b=document.createElement('button');
    b.type='button'; b.id='enzoLiveScreenBtn'; b.className='enzo-monitor-btn';
    b.setAttribute('aria-label', 'Live Screen');
    b.setAttribute('title', 'Live Screen - watch ENZO work in its own research environment');
    b.textContent='Live Screen';
    b.addEventListener('click', function(){
      var taskId=null, chatId=null;
      /* v59: the task id comes from EnzoTaskState59 — the SAME active-task state the Searching indicator, the status pill and the Live Video control read — so this button never claims 'no active task' while a search or video task is running, and never tells the user to start a question they already asked. Messages are in the user's language. */
      var lg59='en'; try{ lg59=(typeof window.__enzoUserLang==='function')?window.__enzoUserLang():'en'; }catch(e){}
      var T59={ en:{busy:'ENZO is working on that right now — the result will appear in the chat. The Live Screen opens for backend research tasks.', none:'No active task right now.'}, roman:{busy:'ENZO abhi isi par kaam kar raha hai — nateeja chat mein aayega. Live Screen backend research task ke liye khulti hai.', none:'Abhi koi active task nahi hai.'}, urdu:{busy:'ENZO ابھی اسی پر کام کر رہا ہے — نتیجہ چیٹ میں آئے گا۔ Live Screen بیک اینڈ ریسرچ ٹاسک کے لیے کھلتی ہے۔', none:'ابھی کوئی فعال ٹاسک نہیں ہے۔'} };
      var TT59=T59[lg59]||T59.en;
      try{ if(window.EnzoTaskState59){ var act59=window.EnzoTaskState59.activeTask(); if(act59 && act59.taskId) taskId=act59.taskId; else if(act59 && act59.local){ if(typeof toast==='function') toast(TT59.busy); return; } } }catch(e){}
      try{ if(window.EnzoMonitor && typeof window.EnzoMonitor.getState==='function'){ var st=window.EnzoMonitor.getState(); if(!taskId) taskId=st && st.activeTaskId; chatId=st && st.chatId; } }catch(e){}
      if(!taskId){ if(typeof toast==='function') toast(TT59.none); return; }
      if(window.EnzoLiveScreen && typeof window.EnzoLiveScreen.openLiveScreen==='function') window.EnzoLiveScreen.openLiveScreen(taskId, {chatId:chatId});
    });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
    return true;
  }
  var lsTries58=0;
  var lsTimer58=setInterval(function(){ lsTries58++; if(wireLiveScreenBtn58() || lsTries58>120) clearInterval(lsTimer58); }, 500);
})();
