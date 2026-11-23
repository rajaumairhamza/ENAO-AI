
/* v52 face/avatar assembly glue - R7(iv): mountAll is belt-and-braces for
   declarative slots; then install Piece 3's state funnel and Piece 4's
   speech-sync driver. Pieces 2 and 5 self-initialise. */
(function(){
  try{ if(window.EnzoAvatar && EnzoAvatar.mountAll) EnzoAvatar.mountAll(); }catch(e){}
  try{ if(window.ChatAvatar) ChatAvatar.install(); }catch(e){}
  try{ if(window.EnzoSpeechSync) EnzoSpeechSync.install(); }catch(e){}
  try{ if(window.enzoFaceMicroSync) enzoFaceMicroSync(); }catch(e){}
})();
