
/* ---------- FEEDBACK WIRING — the feedback box copies only, nothing uploads ---------- */
(function(){
  function el(id){ return document.getElementById(id); }
  el('fbCopy').onclick=function(){
    var t=el('fbText').value.trim();
    if(!t){ toast('Write your feedback first, then tap Copy'); el('fbText').focus(); return; }
    function done(){ toast('Feedback copied — paste it anywhere to send it'); closeModal('feedbackModal'); }
    function fbFallback(){
      var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); done(); }
      catch(e){ toast('Copy failed — long-press the text to copy it'); }
      document.body.removeChild(ta);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done, fbFallback); }
    else fbFallback();
  };
})();
