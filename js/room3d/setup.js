/* ================= ENZO 3D — v53-monitor =================
   The room scene is assembled from the six verified piece modules of the
   ENZO room rebuild (Raja's room reference image + Master Character Design
   Sheet are the design authority):
     Piece 1 buildRoomEnvironment — wooden plank floor, light walls, big
       window + beige pleated curtains + greenery/sky + daylight, ceiling
       spotlights, grey sofa + cushions, patterned carpet, bookshelf (books
       + plants + YouTube plaque + warm LED strips), real-time wall clock,
       ENZO wall screen (blue neon border, 'ENZO AI Robot'), coffee table
       (top surface EXACTLY y=0.42), floor lamp, plants.
     Piece 2 buildWorkstation — desk (top y=0.78, blue LED underglow), dual
       monitors, hinged laptop, keyboard + mouse, phone on charging stand,
       headphones, desk lamp, office chair (seat 0.48), book + glass.
     Piece 3 buildEnzo — ONE canonical ENZO, 1.35 m tall, glossy black oval
       face, two big cyan eyes, white+silver frame, ENZO chest display,
       blue LED accents, 5-finger hands, sheet expressions.
     Piece 4 createAnimationSystem — 44 sequences A–E + waving/pointing.
     Piece 5 createCameraSystem — 6 camera modes, smooth transitions.
     Piece 6 createRuleEnforcer — per-frame rule enforcement.
   Build order per scene: room → enzo → workstation. Per frame:
   animations.update(dt) → rules.enforce(dt) → cameras.update(dt) → render.
   The single enzo instance of each scene is shared by ALL its animations —
   never rebuilt per animation. If Three.js or WebGL is unavailable the
   mounts keep their quiet fallback and the rest of the page is untouched. */
(function(){
  'use strict';
  window.EnzoRoom={threeOK:false};
  window.EnzoRoom.heroMount=document.getElementById('enzoHeroMount');
  window.EnzoRoom.panelMount=document.getElementById('enzoPanelMount');
  var panel=document.getElementById('enzoPanel');
  var fab=document.getElementById('enzoFab');
  /* Panel visibility is the USER's choice only: at desktop widths (>820px) the
     panel stays in the layout and never hides on its own; it folds away only
     via its own collapse button, the round ENZO button re-opens it, and the
     choice is remembered across reloads (open by default). At phone widths
     (<=820px) it remains the overlay drawer it already was. The lsGet/lsSet
     helpers are declared further down in this same scope (hoisted). */
  function savePanelState(open){ lsSet('enao_enzo_panel', open?'open':'closed'); }
  if(panel && lsGet('enao_enzo_panel')==='closed'){ document.body.classList.add('enzo-collapsed'); }
  if(fab&&panel){
    fab.addEventListener('click',function(){
      /* On desktop widths the round button re-opens a panel the user collapsed */
      if(document.body.classList.contains('enzo-collapsed')&&!window.__enzoMobileUI()){
        document.body.classList.remove('enzo-collapsed');
        savePanelState(true);
        fab.title='Show the ENZO companion';
        if(window.requestEnzoResize) setTimeout(window.requestEnzoResize,80);
        return;
      }
      var open=panel.classList.toggle('open');
      fab.title=open?'Hide the ENZO companion':'Show the ENZO companion';
      if(open){ window.EnzoRoom.requestEnzoResize(); }
    });
    document.addEventListener('click',function(e){
      if(window.__enzoMobileUI()&&panel.classList.contains('open')&&!panel.contains(e.target)&&e.target!==fab){ panel.classList.remove('open'); }
    });
  }
  /* Companion-panel collapse control: on desktop widths the panel folds away
     into the grid and the centre workspace takes its room; at phone widths
     the panel is an overlay, so the same control closes it. */
  var enzoCollapseBtn=document.getElementById('enzoCollapseBtn');
  if(enzoCollapseBtn&&panel){
    enzoCollapseBtn.addEventListener('click',function(){
      if(window.__enzoMobileUI()){ panel.classList.remove('open'); }
      else{
        document.body.classList.add('enzo-collapsed');
        savePanelState(false);
        if(window.requestEnzoResize) setTimeout(window.requestEnzoResize,80);
      }
    });
  }
  /* ---- State machine hook — full expressions + activity states ----
     Every state is driven by a REAL app state through setCentreEnzo / the
     voice system / the tools; unknown names safely fall back to idle. The
     app-facing state names are exactly the v50 set; each one maps onto the
     Piece 4 activity system + a Piece 3 sheet expression, and the Piece 5
     camera auto-selects from the activity. */
  var KNOWN=['idle','happy','excited','thinking','listening','speaking','confused','sad','surprised','focused','concerned','sleeping','success','error','working','researching','coding','imagegen','videoedit','music','mobile','document','explaining','celebrating','annoyed','angry','loving','humble'];
  var ALIAS={normal:'idle',successful:'success',celebrate:'celebrating',paused:'idle',image:'imagegen',imagegeneration:'imagegen',video:'videoedit',videoediting:'videoedit',mobiledev:'mobile',writing:'document',docs:'document',research:'researching',code:'coding'};
  var STATE_TO_ACTIVITY={idle:'idle',happy:'idle',excited:'success',thinking:'idle',listening:'idle',speaking:'speaking',confused:'error',sad:'idle',surprised:'idle',focused:'coding',concerned:'idle',sleeping:'sleeping',success:'success',error:'error',working:'coding',researching:'researching',coding:'coding',imagegen:'idle',videoedit:'idle',music:'idle',mobile:'mobile',document:'coding',explaining:'speaking',celebrating:'success',annoyed:'idle',angry:'idle',loving:'idle',humble:'idle'};
  var STATE_TO_EXPR={idle:'neutral',happy:'happy',excited:'excited',thinking:'thinking',listening:'listening',speaking:'speaking',confused:'confused',sad:'sad',surprised:'surprised',focused:'focused',concerned:'thinking',sleeping:'sleeping',success:'success',error:'error',working:'focused',researching:'focused',coding:'focused',imagegen:'happy',videoedit:'focused',music:'happy',mobile:'focused',document:'focused',explaining:'speaking',celebrating:'happy',annoyed:'confused',angry:'confused',loving:'happy',humble:'neutral'};
  window.EnzoRoom.enzoState='idle';
  window.EnzoRoom.instances=[];
  window.EnzoRoom.applyStateToInstance=function(inst){
    if(!inst || inst.appliedState===window.EnzoRoom.enzoState) return;
    inst.appliedState=window.EnzoRoom.enzoState;
    var act=STATE_TO_ACTIVITY[window.EnzoRoom.enzoState]||'idle';
    var expr=STATE_TO_EXPR[window.EnzoRoom.enzoState]||'neutral';
    try{ inst.enzo.setExpression(expr); }catch(e){}
    try{ inst.anim.setActivity(act); }catch(e){}
    try{ inst.cams.autoSelect(act); }catch(e){}
  }
  window.setEnzoState=function(name){
    name=String(name||'idle').toLowerCase().replace(/[\s_-]+/g,'');
    if(ALIAS[name]) name=ALIAS[name];
    window.EnzoRoom.enzoState=(KNOWN.indexOf(name)>-1)?name:'idle';
    for(var i=0;i<window.EnzoRoom.instances.length;i++) window.EnzoRoom.applyStateToInstance(window.EnzoRoom.instances[i]);
    return window.EnzoRoom.enzoState;
  };
  window.getEnzoState=function(){ return window.EnzoRoom.enzoState; };

  /* ---- Performance settings: 3D quality + Reduced Motion ----
     Persisted in this browser only. Reduced Motion defaults to the operating
     system's own preference until the user picks otherwise in the panel. */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  var storedRM=lsGet('enao_enzo_rm');
  window.__enzoRM = storedRM==='1' ? true : storedRM==='0' ? false
    : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  window.setEnzoReducedMotion=function(on){ window.__enzoRM=!!on; lsSet('enao_enzo_rm', on?'1':'0'); };
  /* No quality control is shown anywhere: ENZO always renders at the best
     quality (full pixel ratio, no frame skipping) and simply works. */
  window.EnzoRoom.enzoQuality='high';
  window.getEnzoQuality=function(){ return window.EnzoRoom.enzoQuality; };
  window.setEnzoQuality=function(q){
    if(['high','balanced','low'].indexOf(q)<0) q='high';
    window.EnzoRoom.enzoQuality=q; lsSet('enao_enzo_quality', q);
    var pr = q==='high' ? Math.min(window.devicePixelRatio||1,2) : q==='balanced' ? Math.min(window.devicePixelRatio||1,1.5) : 1;
    for(var i=0;i<window.EnzoRoom.instances.length;i++){
      var inst=window.EnzoRoom.instances[i];
      inst.renderer.setPixelRatio(pr);
      inst.w=0; window.EnzoRoom.sizeInstance(inst);
    }
  };
  if(typeof THREE==='undefined'){ window.EnzoRoom.threeOK=false; return; } /* graceful fallback: mounts keep their placeholder */
  window.EnzoRoom.threeOK=true;

})();
