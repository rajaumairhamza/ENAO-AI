
/* ================= MOBILE DRAWERS (≤820px) =================
   The hamburger button (menuBtn) and the ENZO button (enzoFab) already toggle
   the .open class on the two panels; this layer adds everything around that:
   a shared backdrop that closes either drawer on tap, X close buttons,
   swipe-to-close on both drawers, a left-edge swipe that opens the sidebar,
   Escape to close, auto-close after picking a chat, and a clean reset when
   the viewport grows back to desktop size. Above 820px nothing here acts. */
(function(){
  'use strict';
  var sidebar=document.getElementById('sidebar');
  var panel=document.getElementById('enzoPanel');
  var backdrop=document.getElementById('drawerBackdrop');
  function isMobile(){ return window.__enzoMobileUI(); }
  function anyOpen(){ return !!((sidebar&&sidebar.classList.contains('open'))||(panel&&panel.classList.contains('open'))); }
  function syncBackdrop(){
    if(!backdrop) return;
    if(isMobile()&&anyOpen()){
      backdrop.hidden=false;
      requestAnimationFrame(function(){ backdrop.classList.add('show'); });
    }else{
      backdrop.classList.remove('show');
      backdrop.hidden=true;
    }
  }
  function closeDrawers(){
    if(sidebar) sidebar.classList.remove('open');
    if(panel) panel.classList.remove('open');
    syncBackdrop();
  }
  if(backdrop) backdrop.addEventListener('click',closeDrawers);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&isMobile()&&anyOpen()) closeDrawers(); });
  var sbClose=document.getElementById('sbDrawerClose');
  if(sbClose&&sidebar) sbClose.addEventListener('click',function(){ sidebar.classList.remove('open'); syncBackdrop(); });
  var pzClose=document.getElementById('enzoDrawerClose');
  if(pzClose&&panel) pzClose.addEventListener('click',function(){ panel.classList.remove('open'); syncBackdrop(); });
  /* The open/close toggles live in earlier scripts — re-sync the backdrop
     just after any click has run them. */
  document.addEventListener('click',function(){ if(isMobile()) setTimeout(syncBackdrop,0); },true);
  /* Picking a chat from the drawer closes it so the conversation shows. */
  if(sidebar) sidebar.addEventListener('click',function(e){
    if(!isMobile()) return;
    if(e.target.closest&&e.target.closest('.chat-item')){ sidebar.classList.remove('open'); syncBackdrop(); }
  });
  /* Swipe to close: left swipe on the sidebar, right swipe on the panel. */
  function swipeClose(el,dir){
    if(!el) return;
    var x0=null;
    el.addEventListener('touchstart',function(e){ x0=e.changedTouches[0].clientX; },{passive:true});
    el.addEventListener('touchend',function(e){
      if(x0===null||!isMobile()){ x0=null; return; }
      var dx=e.changedTouches[0].clientX-x0; x0=null;
      if((dir<0&&dx<-60)||(dir>0&&dx>60)){ el.classList.remove('open'); syncBackdrop(); }
    },{passive:true});
  }
  swipeClose(sidebar,-1);
  swipeClose(panel,1);
  /* Swipe in from the left screen edge opens the sidebar. */
  var edgeX=null;
  document.addEventListener('touchstart',function(e){ edgeX=e.changedTouches[0].clientX; },{passive:true});
  document.addEventListener('touchend',function(e){
    if(edgeX===null||!isMobile()){ edgeX=null; return; }
    var start=edgeX, dx=e.changedTouches[0].clientX-edgeX; edgeX=null;
    if(start<=24&&dx>70&&sidebar&&!anyOpen()){ sidebar.classList.add('open'); syncBackdrop(); }
  },{passive:true});
  window.addEventListener('resize',function(){ if(!isMobile()) closeDrawers(); else syncBackdrop(); });
  syncBackdrop();
})();
