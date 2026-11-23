/* PHONE LAYOUT GUARD — a phone is recognised by its hardware (touch +
   a short screen side of 540 CSS px or less), NOT by the layout viewport
   width. Some phone browsers report a wide ~980px viewport (desktop-site
   mode, in-app webviews), which used to let the desktop 3-column grid
   squeeze onto the phone. When a real phone is detected, html.phone-forced
   turns on the same single-column + drawer layout the ≤820px media query
   gives, whatever width the browser claims. Desktops and tablets (short
   side over 540) are never touched. __enzoMobileUI() is the one check
   every layout branch below uses. */
(function(){
  try{
    var touch=('ontouchstart' in window)||(navigator.maxTouchPoints>0);
    var smallSide=Math.min(screen.width||9999,screen.height||9999);
    if(touch&&smallSide<=540) document.documentElement.classList.add('phone-forced');
  }catch(e){}
  window.__enzoMobileUI=function(){ return window.innerWidth<=820||document.documentElement.classList.contains('phone-forced'); };
})();