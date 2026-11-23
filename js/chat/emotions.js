
/* ================= P-F EXTRAS — EMOTIONS IN CHAT + MISUNDERSTANDING CONFIRMATION =================
   ENZO reacts with real feelings DURING the conversation, in three places at
   once: his 3D face and body, his voice tone (pitch/rate in speakText), and
   his words (a short emotional opening line, in the user's own language).
   The emotion always fits the moment detected from the user's own message —
   never random, never overdone, and he never refuses to help.
   Also: if a spoken (or typed) message looks misheard, garbled or
   destructive, ENZO does NOT act on it — he asks ONE short confirmation in
   the user's language, offering the likely meaning, and continues only
   after the user confirms or corrects him. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }

/* ---------- user language for the rig's speech bubbles ---------- */
window.__enzoLastLang='';
window.__enzoUserLang=function(){
  if(window.__enzoLastLang) return window.__enzoLastLang;
  try{
    var j=JSON.parse(localStorage.getItem('enao_learned_v1')||'null');
    if(j && j.langs){
      var best='', n=0;
      for(var k in j.langs){ if(j.langs[k]>n){ n=j.langs[k]; best=k; } }
      if(n>=3) return best;
    }
  }catch(e){}
  return 'en';
};

/* ---------- emotion detection from the user's own message ---------- */
function detectEmotion(text){
  var t=' '+String(text||'').toLowerCase()+' ';
  if(/^(no|nahi|nahin|wrong|galat|ghalat|not this|ye nahi|wo nahi)\b/i.test(String(text||'').trim()) || /(you misunderstood|samjhe nahi|mera matlab)/i.test(text||'')) return 'humble';
  if(/(bakwas|stupid|useless|shut up|idiot|bewakoof|tang kar|tang kr|you are (bad|useless|dumb))/.test(t)) return 'angry';
  if(/(i am sad|main sad|udaas|pareshan|tension|mushkil mein|i am stuck|nahi ho raha|fail ho gaya|thak gaya|i give up|give up kar|akela feel)/.test(t)) return 'loving';
  if(/(good news|khushkhabri|great news|mil gaya|pass ho gaya|i got selected|promotion mil|kamyabi|i passed|i got the job)/.test(t)) return 'excited';
  if(/(haha|lol\b|funny|mazak|joke|hansi|😂|🤣)/.test(t)) return 'happy';
  return null;
}
var EMO_FACE={happy:'happy', excited:'celebrating', angry:'angry', loving:'loving', humble:'humble'};
var EMO_LINES={
  humble:{en:'You are right — that was my mistake, and I am sorry. Thank you for correcting me.',
          roman:'Aap theek keh rahe hain — ye meri ghalti thi, mujhe maaf karein. Batane ka shukriya.',
          urdu:'آپ ٹھیک کہہ رہے ہیں — یہ میری غلطی تھی، مجھے معاف کریں۔ بتانے کا شکریہ۔'},
  loving:{en:'I am right here with you — we will work through this together, step by step.',
          roman:'Main yahin hoon aap ke saath — hum mil kar isay aaram se hal kar lein ge, qadam ba qadam.',
          urdu:'میں یہیں ہوں آپ کے ساتھ — ہم مل کر اسے آرام سے حل کر لیں گے، قدم بہ قدم۔'},
  angry:{en:'I will be honest — that stung a little. But I am still here, and I will still help you properly.',
         roman:'Sach kahoon to thoda bura laga — lekin main yahin hoon, aur aap ki madad bhi poori karunga.',
         urdu:'سچ کہوں تو تھوڑا برا لگا — لیکن میں یہیں ہوں، اور آپ کی مدد بھی پوری کروں گا۔'}
};
window.__pendingEmotion=null;
var emoFlashTimer=null;
function flashEmotion(emo){
  var face=EMO_FACE[emo]; if(!face || typeof window.setEnzoState!=='function') return;
  if(window.state && window.state.isGenerating) return;
  window.setEnzoState(face);
  clearTimeout(emoFlashTimer);
  emoFlashTimer=setTimeout(function(){
    if(typeof window.getEnzoState==='function' && window.getEnzoState()===face && !(window.state&&window.state.isGenerating)) window.setEnzoState('idle');
  }, 3400);
}
var wasGenerating=false;
setInterval(function(){
  var g=!!(window.state && window.state.isGenerating);
  if(wasGenerating && !g && window.__pendingEmotion) flashEmotion(window.__pendingEmotion);
  wasGenerating=g;
}, 700);

/* Emotion in the words: a short opening line on the delivered answer. */
if(typeof window.streamMessage==='function'){
  var origStream=window.streamMessage;
  window.streamMessage=function(chat, msg){
    var emo=window.__pendingEmotion;
    if(emo && EMO_LINES[emo] && msg && msg.role==='ai' && !msg._emoApplied){
      msg._emoApplied=true;
      var line; try{ line=(window.EnzoLang47?window.EnzoLang47.emoLine47(emo, msg.lang):(EMO_LINES[emo][msg.lang]||EMO_LINES[emo].en)); }catch(e){ line=EMO_LINES[emo][msg.lang]||EMO_LINES[emo].en; }
      msg.plain=line+'\n\n'+(msg.plain||'');
      if(msg._fullHtml) msg._fullHtml='<p>'+line+'</p>'+msg._fullHtml;
      window.__pendingEmotion=null;
    }
    return origStream(chat, msg);
  };
}

/* Media activity states: an audio preview playing is Music, a video
   preview playing is Video Edit — real events, real states. */
document.addEventListener('play', function(e){
  var tg=e.target; if(!tg || typeof window.setEnzoState!=='function') return;
  if(tg.tagName==='AUDIO') window.setEnzoState('music');
  else if(tg.tagName==='VIDEO') window.setEnzoState('videoedit');
}, true);
function mediaBack(){
  if(typeof window.getEnzoState!=='function') return;
  var s=window.getEnzoState();
  if((s==='music'||s==='videoedit') && !(window.state&&window.state.isGenerating)) window.setEnzoState('idle');
}
document.addEventListener('pause', mediaBack, true);
document.addEventListener('ended', mediaBack, true);
/* On a live voice call, between turns, ENZO holds his phone. */
setInterval(function(){
  var st=window.state;
  if(st && st.voiceLive && st.voiceState==='on' && !st.isGenerating && typeof window.getEnzoState==='function' && window.getEnzoState()==='idle') window.setEnzoState('mobile');
}, 1500);

/* ---------- misunderstanding detection + one short confirmation ---------- */
var COMMON_WORDS={the:1,is:1,are:1,was:1,what:1,when:1,where:1,which:1,who:1,how:1,why:1,can:1,could:1,should:1,would:1,please:1,tell:1,me:1,about:1,of:1,to:1,in:1,on:1,for:1,and:1,or:1,a:1,an:1,it:1,this:1,that:1,my:1,your:1,you:1,i:1,we:1,they:1,he:1,she:1,do:1,does:1,did:1,will:1,shall:1,may:1,might:1,must:1,have:1,has:1,had:1,be:1,been:1,am:1,not:1,no:1,yes:1,if:1,but:1,so:1,as:1,at:1,by:1,from:1,with:1,into:1,over:1,under:1,again:1,once:1,here:1,there:1,all:1,any:1,both:1,each:1,few:1,more:1,most:1,other:1,some:1,such:1,only:1,own:1,same:1,than:1,too:1,very:1,just:1,also:1,now:1,today:1,latest:1,news:1,price:1,best:1,good:1,new:1,first:1,last:1,long:1,great:1,little:1,own:1,right:1,old:1,any:1,after:1,back:1,through:1,years:1,way:1,days:1,man:1,thing:1,woman:1,life:1,child:1,world:1,school:1,state:1,family:1,student:1,group:1,country:1,problem:1,hand:1,part:1,place:1,case:1,week:1,company:1,system:1,program:1,question:1,work:1,government:1,number:1,night:1,point:1,home:1,water:1,room:1,mother:1,area:1,money:1,story:1,fact:1,month:1,lot:1,right:1,study:1,book:1,eye:1,job:1,word:1,business:1,issue:1,side:1,kind:1,head:1,far:1,black:1,long:1,both:1,little:1,house:1,yes:1,hai:1,hain:1,kya:1,ka:1,ki:1,ke:1,mein:1,aur:1,nahi:1,yeh:1,woh:1,se:1,ko:1,par:1,bhi:1,tha:1,thi:1,mujhe:1,aap:1,tum:1,mera:1,meri:1,kuch:1,kab:1,kyun:1,kaisa:1,kaise:1,konsa:1,kahan:1,batao:1,batana:1,kar:1,karo:1,krna:1,karna:1,chahiye:1, wala:1};
function garbledScore(text){
  var words=String(text||'').toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean);
  if(words.length<4) return 0;
  var kw=0;
  try{ kw=(analyzeQuestion(text).keywords||[]).length; }catch(e){}
  var hits=0;
  words.forEach(function(w){ if(COMMON_WORDS[w] || w.length>9) hits++; });
  var ratio=hits/words.length;
  if(kw===0 && ratio<0.3) return 1;
  if(ratio<0.16) return 1;
  return 0;
}
function isDestructive(text){
  return /\b(delete|remove|erase|send|forward|post|publish|buy|pay|transfer|unsubscribe|cancel my|band kar do|khatam kar do|bhej do|mita do|delete kar|send kar)\b/i.test(text||'');
}
function likelyMeaning(text){
  var en=''; try{ en=romanToEnglish(text)||''; }catch(e){}
  if(en && en.toLowerCase()!==String(text||'').toLowerCase()) return en;
  try{ var kw=(analyzeQuestion(text).keywords||[]).join(' '); if(kw) return kw; }catch(e){}
  return text;
}
var CONFIRM_T={
  ask:{en:function(q){ return 'Just to be sure — did you ask this: "'+q+'"? Say yes, or tell me what you meant.'; },
       roman:function(q){ return 'Kya aap ne ye poocha tha: "'+q+'"? Haan keh dein, ya bata dein ke aap ka matlab kya tha.'; },
       urdu:function(q){ return 'کیا آپ نے یہ پوچھا تھا: "'+q+'"? ہاں کہہ دیں، یا بتا دیں کہ آپ کا مطلب کیا تھا۔'; }},
  destructive:{en:function(q){ return 'Before I act on that — did you really ask me to do this: "'+q+'"? Say yes to confirm, or no to stop.'; },
       roman:function(q){ return 'Ye karne se pehle confirm kar loon — kya aap waqai ye karna chahte hain: "'+q+'"? Haan keh dein confirm karne ke liye, ya na keh dein rokne ke liye.'; },
       urdu:function(q){ return 'یہ کرنے سے پہلے کنفرم کر لوں — کیا آپ واقعی یہ کرنا چاہتے ہیں: "'+q+'"? ہاں کہہ دیں کنفرم کرنے کے لیے، یا نہ کہہ دیں روکنے کے لیے۔'; }},
  reask:{en:function(){ return 'No problem — tell me in your own words what you would like to ask.'; },
         roman:function(){ return 'Koi baat nahi — apne alfaaz mein bata dein ke aap kya poochna chahte hain.'; },
         urdu:function(){ return 'کوئی بات نہیں — اپنے الفاظ میں بتا دیں کہ آپ کیا پوچھنا چاہتے ہیں۔'; }}
};
function confT(kind, lang){ var g=CONFIRM_T[kind]; return (g&&(g[lang]||g.en))||CONFIRM_T[kind].en; }
function pushPair(chat, userText, lang, viaVoice, aiText){
  var tl=timeLabelFor(Date.now());
  chat.messages.push({role:'user', text:userText, lang:lang, viaVoice:!!viaVoice, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full, files:[]});
  var tl2=timeLabelFor(Date.now());
  chat.messages.push({role:'ai', html:mdToHtml(aiText), plain:aiText, viaVoice:!!viaVoice, question:userText, sources:[], deep:false, modeWhy:'ENZO is confirming before acting', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:tl2.daypart, daypartRoman:tl2.daypartRoman, timeLabel:tl2.full});
  renderChatList(); renderMessages(true); saveChats();
  var last=chat.messages[chat.messages.length-1];
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(last, answersMode()) : maybeSpeak(last));
}
/* ---------- social media research: real public results, never private ----------
   When a question names a platform, the search also runs a platform-targeted
   pass so YouTube / Instagram / Facebook / X / TikTok / Reddit results come
   back as real sources with real links and dates, like any website source. */
var PLATFORMS=[['youtube','youtube.com'],['instagram','instagram.com'],['facebook','facebook.com'],['twitter','twitter.com'],['x.com','x.com'],['tiktok','tiktok.com'],['reddit','reddit.com']];
function detectPlatform(text){
  var t=' '+String(text||'').toLowerCase()+' ';
  for(var i=0;i<PLATFORMS.length;i++){ if(t.indexOf(' '+PLATFORMS[i][0])>-1 || t.indexOf(PLATFORMS[i][0]+' ')>-1) return PLATFORMS[i][1]; }
  if(/\bx par\b|\bx pe\b|on x\b/.test(t)) return 'x.com';
  return null;
}
if(typeof window.searchWeb==='function'){
  var prevSearchWeb=window.searchWeb;
  window.searchWeb=function(query, deep){
    return prevSearchWeb(query, deep).then(function(all){
      var dom=detectPlatform(query);
      if(!dom || !all) return all;
      var social=(all||[]).filter(function(s){ return (s.url||'').indexOf(dom)>-1; }).length;
      if(social>=2) return all;
      return prevSearchWeb(query+' site:'+dom, deep).then(function(more){
        if(more && more.length){
          var merged=mergeSources([all, more], deep?18:10);
          merged.liveCount=merged.length;
          merged.failKind=(typeof usableCountX==='function')?all.failKind:all.failKind;
          return merged;
        }
        return all;
      }).catch(function(){ return all; });
    });
  };
}
var PRIVATE_T={
  en:'I can only research public content — public posts, videos, channels and pages. Private chats, private messages and private accounts are not accessible to me, and I will not pretend otherwise. Ask me about any public topic and I will research it across websites and social media.',
  roman:'Main sirf public content par research kar sakta hoon — public posts, videos, channels aur pages. Private chats, private messages aur private accounts tak meri rasai nahi hai, aur main is ka jhoota daawa nahi karunga. Koi bhi public topic poochein, main websites aur social media dono par research kar dunga.',
  urdu:'میں صرف پبلک مواد پر ریسرچ کر سکتا ہوں — پبلک پوسٹس، ویڈیوز، چینلز اور پیجز۔ پرائیویٹ چیٹس، پرائیویٹ پیغامات اور پرائیویٹ اکاؤنٹس تک میری رسائی نہیں ہے، اور میں اس کا جھوٹا دعویٰ نہیں کروں گا۔ کوئی بھی پبلک موضوع پوچھیں، میں ویب سائٹس اور سوشل میڈیا دونوں پر ریسرچ کر دوں گا۔'
};
function isPrivateAsk(text){
  return /(whatsapp (chat|chats|message|messages|msg)|private (chat|chats|message|messages|account|profile|dm|dms)|uski (private|whatsapp)|kisi ke whatsapp|someone'?s (private|whatsapp|dm)|uske dm|her dm|his dm|private account (ka|ki|ke|se))/i.test(text||'');
}

var innerAsk=window.askQuestion;
window.askQuestion=function(text, viaVoice, forcedDeep){
  var lang=detectLang(text||'');
  window.__enzoLastLang=lang;
  var emo=detectEmotion(text||'');
  window.__enzoEmotion=emo;
  if(emo) window.__pendingEmotion=emo;
  var chat=activeChat();
  if(chat && chat.pendingConfirm){
    var pc=chat.pendingConfirm;
    var reply=String(text||'').trim();
    if(/^(yes|yeah|yep|haan|han|ji|jee|theek|sahi|bilkul|yehi|yahi|correct|right|confirm)\b/i.test(reply)){
      chat.pendingConfirm=null; saveChats();
      return innerAsk(pc.interpreted||pc.original, pc.viaVoice, forcedDeep);
    }
    if(/^(no|nahi|nahin|nope|galat|wrong|stop|ruk)\b/i.test(reply) && reply.length<26){
      chat.pendingConfirm=null;
      pushPair(chat, text, lang, viaVoice, confT('reask', lang)());
      return;
    }
    chat.pendingConfirm=null; saveChats();
    return innerAsk(text, viaVoice, forcedDeep);
  }
  if(text && isPrivateAsk(text)){
    if(!chat){ chat=createChat(text.slice(0,42)); }
    pushPair(chat, text, lang, viaVoice, PRIVATE_T[lang]||PRIVATE_T.en);
    return;
  }
  /* v59-live-research-fix (Piece 31 [1]): EnzoResearchTriggers.shouldClarify runs FIRST, before garbledScore / CONFIRM_T / isDestructive. clarify === false means proceed: never confirm, never ask 'did you ask this?'. A research order goes straight to research (forced deep). When a confirmation does fire and clarify === true, result.question (already in the user's language) replaces CONFIRM_T.ask. */
  var trig59a=null;
  try{ if(text && window.EnzoResearchTriggers) trig59a=window.EnzoResearchTriggers.shouldClarify(text); }catch(e){}
  if(trig59a && trig59a.clarify===false && trig59a.research && trig59a.research.research){
    return innerAsk(text, viaVoice, (typeof forcedDeep==='boolean') ? forcedDeep : true);
  }
  if(text && !state.pendingFiles.length && !(typeof smallTalkReply==='function' && smallTalkReply(text, lang))){
    var destructive=viaVoice && isDestructive(text);
    var garbled=(trig59a && trig59a.clarify===false) ? false : ((lang!=='urdu') && garbledScore(text)===1);
    if(destructive || (viaVoice && garbled) || (!viaVoice && garbled && text.length>25)){
      if(!chat){ chat=createChat(text.slice(0,42)); }
      var interp=likelyMeaning(text);
      chat.pendingConfirm={original:text, interpreted:interp, viaVoice:!!viaVoice};
      var q=destructive ? confT('destructive', lang)(interp) : ((trig59a && trig59a.clarify===true && trig59a.question) ? trig59a.question : confT('ask', lang)(interp));
      pushPair(chat, text, lang, viaVoice, q);
      return;
    }
  }
  return innerAsk(text, viaVoice, forcedDeep);
};
})();

