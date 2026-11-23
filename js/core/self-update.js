/* SELF-UPDATE — if the server already serves a newer build than the
   one this tab is running (a tab left open across a deploy, or a browser
   that kept a cached copy), refresh once to the live version so a phone
   never stays stuck on an old layout. Fails silently when offline. */
(function(){
  var ME='v63-voice-lang', lastCheck=0;
  function check(){
    var now=Date.now(); if(now-lastCheck<20000) return; lastCheck=now;
    try{
      if(!/^https?:$/.test(location.protocol)) return;
      fetch(location.pathname,{cache:'no-store',credentials:'same-origin'}).then(function(r){ return r.text(); }).then(function(t){
        var m=t.match(/name="enao-build" content="([^"]+)"/);
        if(!m||m[1]===ME) return;
        var key='enao_reloaded_'+m[1];
        try{ if(sessionStorage.getItem(key)) return; sessionStorage.setItem(key,'1'); }catch(e){}
        location.reload();
      }).catch(function(){});
    }catch(e){}
  }
  setTimeout(check,2500);
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) setTimeout(check,800); });
})();