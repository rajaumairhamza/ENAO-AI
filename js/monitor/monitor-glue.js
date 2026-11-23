
/* ================= v53-monitor — assembly glue =================
   Initialises the Live Research Monitor UI once (guarded), points the data
   layer at the currently active chat on load, and re-points it whenever the
   active chat changes by any route (chat list, menus, new chat, ask flow).
   The ask-flow / task-start hooks themselves live at their call sites. */
(function(){
  try{ if(window.EnzoMonitorUI && typeof window.initEnzoMonitorUI==='function') window.initEnzoMonitorUI(); }catch(e){}
  var lastMonitorChatId='__unset__';
  function syncMonitorChat(){
    try{
      if(!window.EnzoMonitor) return;
      var ac=(typeof activeChat==='function')?activeChat():null;
      /* v59 (Piece 32 [6]): the monitor is pointed at the BACKEND chat id only, resolved through the registry — never the local cmwr* id. Unresolvable means do not call setChatId/start at all. */
      var id=(ac && window.EnzoPollingFix)?window.EnzoPollingFix.resolveBackendId(ac.id):null;
      if(!id){ lastMonitorChatId=null; return; }
      if(id===lastMonitorChatId) return;
      lastMonitorChatId=id;
      EnzoMonitor.setChatId(id);
      EnzoMonitor.start();
      try{ if(window.EnzoPollingFix) window.EnzoPollingFix.install(); }catch(e){}
    }catch(e){}
  }
  syncMonitorChat();
  try{ if(window.EnzoPollingFix) window.EnzoPollingFix.install(); }catch(e){}
  EnzoPollLoop.registerPoller('monitor-chat-sync', syncMonitorChat, 5000, { kind: 'idle', jitter: false });
})();
