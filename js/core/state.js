
var state = {
  chats: [], activeId: null, deep: false, pendingMode: 'auto', alwaysDeep: false, voiceReply: true, sourcesOn: true,
  usage: 0, renameId: null, langPref: 'auto', isListening: false, isGenerating: false,
  voiceLive: false, voiceState: 'off', isSpeaking: false, recogWanted: false,
  nextAskViaVoice: false, currentAskViaVoice: false, voiceQueue: '', voiceQueuePosted: false,
  folderFilter: 'all', pendingFiles: [], streamTimer: null, stopRequested: false,
  voiceVolume: 1, notifOn: true, nearBottom: true, menuChatId: null,
  lastTypeAt: 0, speechOwner: 'none'
};
function loadPref(k, d){ try{ var v=localStorage.getItem(k); return v===null?d:v; }catch(e){ return d; } }
function savePref(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
state.voiceVolume=parseFloat(loadPref('enao_voice_volume','1'))||1;
state.notifOn=loadPref('enao_notif','1')==='1';
var confirmCb=null;
function confirmAction(title, text, yesLabel, cb){
  $('confirmTitle').textContent=title; $('confirmText').textContent=text;
  $('confirmYes').textContent=yesLabel||'Yes, continue'; confirmCb=cb; openModal('confirmModal');
}
/* ---------- ANSWER DEPTH — automatic intent routing + per-chat override ----------
   There is no mode-selection UI anywhere. The depth is decided like this:
   1) A per-chat OVERRIDE set from the Tools menu Deep Research entry (or the
      hero chip): 'deep' = every answer in this chat is Deep Research,
      'normal' = every answer stays Normal. The override is stored on the
      chat itself, so it can never leak into another chat.
   2) With no override (the default, 'auto'), detectIntent() routes EACH
      question on its own signals — a short factual follow-up goes Normal
      even right after a Deep answer in the same chat.
   Chats saved before this routing existed carry only a boolean deep flag:
   deep=true becomes the 'deep' override, anything else becomes 'auto'.
   state.pendingMode holds an override chosen before any chat exists (the
   hero chip on an empty screen); the first chat created takes it over. */
function chatMode(c){
  c=c||activeChat();
  if(!c) return state.pendingMode||'auto';
  if(c.mode==='deep'||c.mode==='normal'||c.mode==='auto') return c.mode;
  return c.deep?'deep':'auto';
}
function effectiveDeep(){ return chatMode()==='deep'; }
/* Automatic intent routing — deterministic signals read from the question
   itself, nothing else. Every Deep decision names the real signal that
   triggered it; every Normal decision names why the question stayed light.
   The returned reason is shown verbatim in the live task checklist and
   saved on the answer, so the routing is never a hidden guess. */
/* RESEARCH vs GUFTAGU (locked rule 49): every message is one of two kinds.
   RESEARCH — the user explicitly asks for it ("is par search karo",
   "research karo", "internet se dhoond ke do") or wants a detailed
   researched answer: search the internet and answer in detail.
   GUFTAGU — everyday conversation: "kya hal hai", "kya karte ho",
   "Bitcoin kisko kehte hain". Answer directly from ENZO's own knowledge;
   NEVER reply with a clarifying question or a research/investment
   question. Research happens only when the user asked for it, or when
   the answer genuinely is not known (fast-changing facts like prices
   and news are never guftagu — they truly need the internet). */
function isExplicitResearchRequest(text){
  var q=' '+String(text||'').toLowerCase().replace(/\s+/g,' ')+' ';
  if(/(ریسرچ کر|تلاش کر|ڈھونڈ کر|انٹرنیٹ سے ڈھونڈ)/.test(text||'')) return true;
  if(/\b(research|search|talaash|talash|dhoond|dhund|google)\b/.test(q) && /\b(kar|karo|karke|kardo|kar do|do|de|dena|batao|nikal|nikalo|please|plz|chahiye)\b/.test(q)) return true;
  if(/\b(internet|online|web)\s+(se|par|pe)\b/.test(q) && /\b(dhoond|search|research|batao|nikal|de|do)\b/.test(q)) return true;
  return false;
}
function isGuftagu(text){
  var raw=String(text||'').trim();
  if(!raw) return false;
  if(isExplicitResearchRequest(raw)) return false;
  var q=' '+raw.toLowerCase().replace(/\s+/g,' ')+' ';
  var words=raw.split(/\s+/).filter(Boolean).length;
  if(/\b(price|rate|rates|today|latest|news|khabar|khabrein|score|weather|mausam)\b/.test(q) || /(قیمت|خبر|موسم)/.test(raw)) return false;
  if(/\b(who are you|what is your name|what do you do|tum kaun ho|aap kaun ho|kya karte ho|kia karte ho|kya kar rahe ho|aur sunao)\b/.test(q)) return true;
  if(/\b(tum|aap|tu|ap)\b[^.?!]{0,24}\b(karte|krte|kar rahe|kar rahay|kaun|kon|naam)\b/.test(q)) return true;
  if(words<=14 && (/(kisko|kis ko|kise|ise|usse|isko|usko)\s+keht(e|ay)\s+(hain|hen)/.test(q)
    || /\b(ka|ki|ke)\s+matlab\s+(kya|kia)\b/.test(q) || /\bmatlab\s+(kya|kia)\s+hai\b/.test(q)
    || /\b(kya|kia)\s+(hota|hoti|hote)\s+(hai|ha|he)\b/.test(q)
    || /\b(kya|kia)\s+(hai|ha|he)\b/.test(q)
    || /\bwhat\s+(is|does|do)\b/.test(q) || /\bmeaning\s+of\b/.test(q) || /\bdefine\s+\w+/.test(q)
    || /(کس کو کہتے ہیں|کا مطلب کیا|کیا ہوتا ہے|کیا ہوتی ہے)/.test(raw))) return true;
  return false;
}
function detectIntent(text){
  var raw=(text||'').trim();
  var q=' '+raw.toLowerCase().replace(/\s+/g,' ')+' ';
  var words=raw ? raw.split(/\s+/).filter(Boolean).length : 0;
  var type=analyzeQuestion(raw).type;
  if(/\b(research|investigate|investigation|tehqeeq)\b/.test(q)) return {deep:true, reason:'research request'};
  if(/\b(in detail|in-depth|detailed|deep dive|comprehensive|thorough|complete guide|full guide|step-by-step|everything about|tafseel)\b/.test(q)) return {deep:true, reason:'in-detail request'};
  if(type==='comparison' || /\b(vs\.?|versus|pros and cons|advantages and disadvantages|difference between)\b/.test(q)) return {deep:true, reason:'comparison question'};
  if((/\b(latest|recent|breaking|newest)\b/.test(q) && /\b(news|developments?|updates?|events?|releases?|versions?)\b/.test(q)) || /\b(current events|taza khabrein|taza tareen)\b/.test(q)) return {deep:true, reason:'latest-news question'};
  if((raw.match(/\?/g)||[]).length>=2) return {deep:true, reason:'multi-part question'};
  if(words>=8 && /\b(and also|also explain|also tell|also describe|additionally|aur ye bhi|aur yeh bhi)\b/.test(q)) return {deep:true, reason:'multi-part question'};
  if(/\b(analy[sz]e|analysis|evaluate|evaluation|critique|assess|implications)\b/.test(q)) return {deep:true, reason:'analysis question'};
  if(/\b(complete list|list of all|every .{1,24}(available|out there)|survey of|directory of)\b/.test(q)) return {deep:true, reason:'many sources needed'};
  if(words>=45) return {deep:true, reason: (raw.split(/[,;]/).length>=3 || (q.match(/ and /g)||[]).length>=2) ? 'multi-part question' : 'long question'};
  if(words<=12) return {deep:false, reason:'short question'};
  if(type==='definition') return {deep:false, reason:'simple factual question'};
  return {deep:false, reason:'straightforward question'};
}
/* Greetings and small talk — answered instantly from ENZO's own knowledge.
   The WHOLE message must be just the greeting / pleasantry (exact match after
   normalising case and punctuation), so a real question that merely starts
   with "hello" still goes through the normal search pipeline. Returns a short
   friendly reply in the user's own language, or null when the message is a
   real question. No search, no Wikipedia, no pipeline for these. */
/* Combined greetings: a message built from two or more greeting /
   pleasantry phrases joined together — "kya hal hai, Assalamualaikum",
   "Assalamualaikum, kesay ho", "hello, how are you". The single-phrase
   patterns in smallTalkReply miss these, so they used to fall into the
   search pipeline, find nothing usable, and come back as a clarifying
   question about research — a greeting must NEVER be answered with a
   question. The whole message is consumed phrase by phrase (longest
   phrases first); only when every word belongs to a greeting phrase or
   a polite filler (a name, "aur", "aap"…) does it count, so a real
   question that merely opens with "hello" still goes to the pipeline. */
function comboSmallTalkCat(core){
  var PH={
    salam:['assalamualaikum warahmatullahi wabarakatuh','assalamualaikum warahmatullah','assalam o alaikum','assalam u alaikum','assalam alaikum','salam alaikum','assalamualaikum','aoa','salam','السلام علیکم ورحمتہ اللہ','السلام علیکم','سلام'],
    greet:['good morning','good afternoon','good evening','hi there','hello there','hey there','hi enzo','hello enzo','hey enzo','hi','hello','hey','namaste','hola'],
    howru:['how are you','how are u','how r u','how is it going',"how's it going",'whats up',"what's up",'sup','kia hal ha','kia haal ha','kia hal hai','kya haal hai','kya hal hai','kia haal hai','kesay ho','kese ho','kaise ho','aap kesay ho','aap kaise ho','tum kesay ho','kya ho raha hai','aur sunao','kya haal chaal','کیا حال ہے','کیا حال ہیں','آپ کیسے ہیں','کیسے ہو'],
    thanks:['thank you so much','thanks a lot','thank you','thanks','shukriya','bohat shukriya','bahut shukriya','mehrbani','بہت شکریہ','شکریہ'],
    bye:['good night','allah hafiz','khuda hafiz','bye bye','goodbye','bye','see you later','see you','take care','اللہ حافظ','خدا حافظ'],
    ack:['okay','ok','acha','achha','theek hai','thik hai','theek','han','haan','ji','great','nice','awesome','cool','perfect','very good','good']
  };
  var FILL={raja:1,enzo:1,bhai:1,yaar:1,dost:1,sir:1,janab:1,aap:1,tum:1,sab:1,aur:1,and:1,ke:1,ka:1,ki:1};
  var list=[];
  Object.keys(PH).forEach(function(cat){ PH[cat].forEach(function(p){ list.push({w:p.split(' '), cat:cat}); }); });
  list.sort(function(a,b){ return b.w.length-a.w.length; });
  var words=core.replace(/[،؛؟۔]+/g,' ').split(/\s+/).filter(Boolean);
  if(words.length<2 || words.length>12) return null;
  var cats={}, parts=0, i=0;
  while(i<words.length){
    var hit=null;
    for(var j=0;j<list.length;j++){
      var pw=list[j].w; if(i+pw.length>words.length) continue;
      var ok=true;
      for(var k=0;k<pw.length;k++){ if(words[i+k]!==pw[k]){ ok=false; break; } }
      if(ok){ hit=list[j]; break; }
    }
    if(hit){ cats[hit.cat]=1; parts++; i+=hit.w.length; continue; }
    if(FILL[words[i]]){ i++; continue; }
    return null;
  }
  if(!parts) return null;
  if(cats.salam && cats.howru) return 'salamhowru';
  if(cats.salam) return 'salam';
  if(cats.howru) return 'howru';
  if(cats.greet) return 'greet';
  if(cats.thanks) return 'thanks';
  if(cats.bye) return 'bye';
  if(cats.ack) return 'ack';
  return null;
}
function smallTalkReply(text, lang){
  if(window.EnzoLang47 && window.EnzoLang47.smallTalkReply47){ try{ var name47=((typeof loadPref==='function')?(loadPref('enao_name','Raja')||'Raja'):'Raja'); var r47=window.EnzoLang47.smallTalkReply47(text, lang, name47); if(r47!==null && typeof r47!=='undefined') return r47; }catch(e){} }
  var core=(text||'').toLowerCase().replace(/[.!?,~…:;"()«»]+/g,' ').replace(/\s+/g,' ').trim();
  if(!core || core.length>80) return null;
  var cat=null;
  if(/^(assalam ?o? ?alaikum|assalamualaikum|assalam u alaikum|salam alaikum|aoa|salam|سلام|السلام علیکم|السلام علیکم ورحمتہ اللہ)$/.test(core)) cat='salam';
  else if(/^(hi+|hello+|hey+|hii+|hi there|hello there|hey there|hi enzo|hello enzo|hey enzo|namaste|hola|good morning|good afternoon|good evening)$/.test(core)) cat='greet';
  else if(/^(how are you|how are u|how r u|how is it going|how's it going|whats up|what's up|sup|kia hal ha|kia haal ha|kia hal hai|kya haal hai|kya hal hai|kia haal hai|kesay ho|kese ho|kaise ho|aap kesay ho|aap kaise ho|tum kesay ho|kya ho raha hai|aur sunao|kya haal chaal|کیا حال ہے|کیا حال ہیں|آپ کیسے ہیں|کیسے ہو)$/.test(core)) cat='howru';
  else if(/^(hello|hi|hey|salam) (how are you|kia hal ha|kya haal hai|kesay ho|kaise ho)$/.test(core)) cat='howru';
  else if(/^(thanks|thank you|thank you so much|thanks a lot|shukriya|bohat shukriya|bahut shukriya|mehrbani|شکریہ|بہت شکریہ)$/.test(core)) cat='thanks';
  else if(/^(bye|goodbye|bye bye|good night|allah hafiz|khuda hafiz|see you|see you later|take care|اللہ حافظ|خدا حافظ)$/.test(core)) cat='bye';
  else if(/^(ok|okay|acha|achha|theek hai|thik hai|theek|han|haan|ji|great|nice|awesome|cool|perfect|good|very good)$/.test(core)) cat='ack';
  if(!cat) cat=comboSmallTalkCat(core);
  if(!cat) return null;
  var name=((loadPref('enao_name','Raja')||'Raja').split(' ')[0])||'Raja';
  var R={
    english:{salamhowru:'Waalaikum Assalam, '+name+'! I am doing great, thank you for asking. How are you doing? And how can I help you today?',
      salam:'Waalaikum Assalam, '+name+'! Good to see you. How can I help you today?',
      greet:'Hello, '+name+'! Good to see you. How can I help you today?',
      howru:'I am doing great, thank you for asking! How are you doing? And how can I help you today?',
      thanks:'You are most welcome! If anything else comes up, just ask.',
      bye:'Goodbye for now, '+name+'! I am right here whenever you need me.',
      ack:'Got it. Anything else you would like to ask?'},
    roman:{salamhowru:'Waalaikum Assalam, '+name+'! Main bilkul theek hoon, shukriya poochne ke liye. Aap sunayein, kya haal hai? Main aap ki kya madad kar sakta hoon?',
      salam:'Waalaikum Assalam, '+name+'! Khushi hui aap se baat karke. Main aap ki kya madad kar sakta hoon?',
      greet:'Hello, '+name+'! Khushi hui aap se baat karke. Main aap ki kya madad kar sakta hoon?',
      howru:'Main bilkul theek hoon, shukriya! Aap sunayein, kya haal hai? Main aap ki kya madad kar sakta hoon?',
      thanks:'Koi baat nahi! Aur kuch chahiye ho to bas keh dein.',
      bye:'Allah Hafiz, '+name+'! Jab bhi zaroorat ho, main yahin hoon.',
      ack:'Theek hai. Aur kuch poochna ho to bas likh dein.'},
    urdu:{salamhowru:'وعلیکم السلام، '+name+'! میں بالکل ٹھیک ہوں، پوچھنے کا شکریہ۔ آپ سنائیں، کیا حال ہے؟ میں آپ کی کیا مدد کر سکتا ہوں؟',
      salam:'وعلیکم السلام، '+name+'! آپ سے بات کر کے خوشی ہوئی۔ میں آپ کی کیا مدد کر سکتا ہوں؟',
      greet:'السلام علیکم، '+name+'! آپ سے بات کر کے خوشی ہوئی۔ میں آپ کی کیا مدد کر سکتا ہوں؟',
      howru:'میں بالکل ٹھیک ہوں، شکریہ! آپ سنائیں، کیا حال ہے؟ میں آپ کی کیا مدد کر سکتا ہوں؟',
      thanks:'کوئی بات نہیں! اور کچھ چاہیے ہو تو بس کہہ دیں۔',
      bye:'اللہ حافظ، '+name+'! جب بھی ضرورت ہو، میں یہیں ہوں۔',
      ack:'ٹھیک ہے۔ اور کچھ پوچھنا ہو تو بس لکھ دیں۔'}
  };
  /* Reply language follows the greeting itself: Urdu script stays Urdu, a
     Roman Urdu greeting ("kia hal ha", "kesay ho", "shukriya"…) gets a Roman
     Urdu reply even when detectLang read the short phrase as English. */
  var rLang = (lang==='urdu' || /[\u0600-\u06FF]/.test(core)) ? 'urdu'
    : /(^|\s)(kia|kya|kesay|kese|kaise|aur sunao|shukriya|bohat|bahut|mehrbani|acha|achha|theek|thik|han|haan|allah hafiz|khuda hafiz)(\s|$)/.test(core) ? 'roman'
    : 'english';
  var set=R[rLang]||R.english;
  return set[cat]||null;
}
/* --- Permanent memory: all chats saved in this browser, survive reload --- */
function saveChats(){
  try{
    var slim=state.chats.slice(0,60).map(function(c){
      return {id:c.id, title:c.title, created:c.created, pinned:!!c.pinned, archived:!!c.archived, folder:c.folder||'', mode:(c.mode==='deep'||c.mode==='normal'||c.mode==='auto')?c.mode:(c.deep?'deep':'auto'), deep:!!c.deep, backendId:c.backendId||'', backendTaskId:c.backendTaskId||'', lastTaskId:c.lastTaskId||'', pendingClarify:!!c.pendingClarify, pendingReminder:c.pendingReminder||null, uniCtx:(c.uniCtx?{currentTopic:c.uniCtx.currentTopic||null, summary:(c.uniCtx.summary||'').slice(0,1200), entities:c.uniCtx.entities||{}, preferences:c.uniCtx.preferences||[], decidedTopics:c.uniCtx.decidedTopics||{}, activeTasks:(c.uniCtx.activeTasks||[]).slice(0,10), turnCount:c.uniCtx.turnCount||0}:null), createdPart:(c.created?timeLabelFor(c.created).daypart:''), messages:(c.messages||[]).slice(-80).map(function(m){
        var tl=timeLabelFor(m.ts||Date.now());
        return {role:m.role, text:m.text||'', html:m.html||m._fullHtml||'', plain:(m.plain||'').slice(0,6000), lang:m.lang||(window.EnzoLang45?window.EnzoLang45.defaultMessageLang():'en'), ts:m.ts||Date.now(), daypart:m.daypart||tl.daypart, daypartRoman:m.daypartRoman||tl.daypartRoman, timeLabel:m.timeLabel||tl.full, sources:(m.sources||[]).slice(0,18), deep:!!m.deep, mega:!!m.mega, modeWhy:m.modeWhy||'', auto:!!m.auto, followups:m.followups||[], question:m.question||'', edited:!!m.edited, error:!!m.error, rating:m.rating||'', viaVoice:!!m.viaVoice, files:(m.files||[]).map(function(f){return {name:f.name, kind:f.kind};})};
      })};
    });
    var json=JSON.stringify({chats:slim, activeId:state.activeId, usage:state.usage});
    if(json.length>4200000){ slim=slim.slice(0,25); json=JSON.stringify({chats:slim, activeId:state.activeId, usage:state.usage}); }
    localStorage.setItem('enao_chats_v1', json);
  }catch(e){}
}
function loadChats(){
  try{
    var raw=localStorage.getItem('enao_chats_v1'); if(!raw) return false;
    var data=JSON.parse(raw); if(!data || !data.chats || !data.chats.length) return false;
    state.chats=data.chats; state.activeId=data.activeId||data.chats[0].id; state.usage=data.usage||0;
    return true;
  }catch(e){ return false; }
}

function $(id){ return document.getElementById(id); }
function uid(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){t.classList.remove('show')},2600); }
function closeModal(id){ $(id).classList.remove('open'); }
function openModal(id){
  var m=$(id); m.classList.add('open');
  try{
    var card=m.querySelector('.modal-card');
    if(card){ card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true'); }
    if(id==='renameModal'){ var ri=$('renameInput'); if(ri) setTimeout(function(){ ri.focus(); ri.select(); }, 40); }
  }catch(e){}
}
function esc(s){ return (s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]}); }
/* Only real web pages may ever be linked — anything that is not http(s) is neutralised, never rendered as a link */
function safeHttpUrl(u){ u=String(u||''); return /^https?:\/\//i.test(u) ? u : '#'; }

/* ---------- LIVE TIME AWARENESS — har baat kab ho rahi hai, din ke kis hisse mein ---------- */
function dayPartFor(d){
  var h=(d||new Date()).getHours();
  if(h>=5 && h<12) return {key:'subah', roman:'Morning', urdu:'صبح', en:'Morning', greeting:'Good morning', note:'the start of the day'};
  if(h>=12 && h<17) return {key:'dopahar', roman:'Afternoon', urdu:'دوپہر', en:'Afternoon', greeting:'Good afternoon', note:'the middle of the day'};
  if(h>=17 && h<20) return {key:'shaam', roman:'Evening', urdu:'شام', en:'Evening', greeting:'Good evening', note:'the day winding down'};
  return {key:'raat', roman:'Night', urdu:'رات', en:'Night', greeting:'Good evening', note:'night time'};
}
function fmtTime(d){ try{ return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }catch(e){ return ''; } }
function fmtTimeSec(d){ try{ return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}); }catch(e){ return fmtTime(d); } }
function fmtDate(d){ try{ return d.toLocaleDateString([], {weekday:'long', day:'numeric', month:'long', year:'numeric'}); }catch(e){ return ''; } }
function fmtShortDate(d){ try{ return d.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short', year:'numeric'}); }catch(e){ return ''; } }
function tzName(d){ try{ var p=new Intl.DateTimeFormat([], {timeZoneName:'short'}).formatToParts(d); for(var i=0;i<p.length;i++) if(p[i].type==='timeZoneName') return p[i].value; }catch(e){} return ''; }
function timeLabelFor(ts){
  var d=new Date(ts||Date.now()); var dp=dayPartFor(d);
  return {ts:d.getTime(), daypart:dp.key, daypartRoman:dp.roman, daypartUrdu:dp.urdu, daypartEn:dp.en, time:fmtTime(d), date:fmtShortDate(d), full:fmtShortDate(d)+' • '+fmtTime(d)+' • '+dp.roman+' ('+dp.en+')'};
}
function timeContextString(d){
  d=d||new Date(); var dp=dayPartFor(d); var tz=tzName(d);
  return fmtDate(d)+' — the time right now is '+fmtTime(d)+(tz?' '+tz:'')+'. Part of day: '+dp.roman+' ('+dp.en+' / '+dp.urdu+') — '+dp.note+'.';
}
function timeAgoText(ts){
  if(!ts) return '';
  var s=Math.floor((Date.now()-ts)/1000); if(s<50) return 'just now';
  var m=Math.floor(s/60); if(m<60) return m+' minute'+(m===1?'':'s')+' ago';
  var h=Math.floor(m/60); if(h<24) return h+' hour'+(h===1?'':'s')+' ago';
  var dd=Math.floor(h/24); if(dd===1) return 'yesterday, around this time'; if(dd<30) return dd+' days ago';
  return Math.floor(dd/30)+' month'+(Math.floor(dd/30)===1?'':'s')+' ago';
}
function updateLiveClock(){
  var now=new Date(); var dp=dayPartFor(now);
  var ct=$('clockTime'); if(ct) ct.textContent=fmtTimeSec(now);
  var cd=$('clockDate'); if(cd) cd.textContent=fmtShortDate(now);
  var cp=$('clockPart'); if(cp) cp.textContent = window.innerWidth<=820 ? dp.en : dp.roman+' • '+dp.en;
  var sc=$('sideClock'); if(sc) sc.textContent='Now: '+fmtDate(now)+', '+fmtTime(now)+' — it is '+dp.roman+' right now.';
  var tg=$('timeGreeting'); if(tg) tg.textContent=dp.greeting+'! It is '+dp.roman+' right now — '+fmtTime(now)+', '+fmtDate(now)+'.';
}

function detectLang(text){
  if(/[\u0600-\u06FF]/.test(text)) return 'urdu';
  var romanWords = ['kya','hai','hain','ka','ki','ke','mein','batao','samjhao','konsa','kyun','kab','kaisa','mera','mujhe','aap','yeh','woh','nahi','aur','par','se','ko','bhi','tha','thi','kar','karo','chahiye','wala','wali','aj','kal','bohat','acha','theek'];
  var words = text.toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/);
  var hits = 0; words.forEach(function(w){ if(romanWords.indexOf(w)>-1) hits++; });
  if(hits>=2 || (hits>=1 && words.length<=6 && /[aeiou]/.test(text))) {
    // extra check: if mostly english common words, keep english
    var enWords=['what','is','the','how','why','when','best','explain','tell','about','please','give','show'];
    var enHits=0; words.forEach(function(w){ if(enWords.indexOf(w)>-1) enHits++; });
    if(enHits>hits) return 'en';
    return 'roman';
  }
  return 'en';
}
function langLabel(l){ if(window.EnzoLang45 && window.EnzoLang45.langLabel) return window.EnzoLang45.langLabel(l); return l==='urdu'?'Urdu Script':(l==='roman'?'Roman Urdu':'English'); }

function createChat(title){
  /* A new chat takes over a pending override (hero chip tapped before any
     chat existed) exactly once; otherwise it starts in Auto, where each
     question is routed on its own signals. */
  var c={id:uid(), title:title||'New Chat', messages:[], created:Date.now(), mode:state.pendingMode||'auto', deep:state.pendingMode==='deep'};
  state.pendingMode='auto'; state.deep=false;
  state.chats.unshift(c); state.activeId=c.id; renderChatList(); saveChats(); syncDeepUI(); return c;
}
function activeChat(){ for(var i=0;i<state.chats.length;i++) if(state.chats[i].id===state.activeId) return state.chats[i]; return null; }

function shareText(title, text){
  var payload=(title?title+'\n\n':'')+(text||'');
  if(navigator.share){ navigator.share({title:title||'ENZO AI', text:payload}).catch(function(){}); }
  else copyText(payload);
}
/* Sidebar (Restyle R1): compact relative time for chat rows — "2 min ago", "1 hour ago" */
function shortAgo(ts){
  if(!ts) return '';
  var s=Math.floor((Date.now()-ts)/1000); if(s<50) return 'just now';
  var m=Math.floor(s/60); if(m<60) return m+' min ago';
  var h=Math.floor(m/60); if(h<24) return h+(h===1?' hour ago':' hours ago');
  var dd=Math.floor(h/24); if(dd<30) return dd+(dd===1?' day ago':' days ago');
  var mo=Math.floor(dd/30); return mo+(mo===1?' month ago':' months ago');
}
/* Folder counts in the sidebar are counted from the chats actually saved — never invented */
function refreshFolderCounts(){
  var counts={all:0, archived:0};
  state.chats.forEach(function(c){
    if(c.archived){ counts.archived++; return; }
    counts.all++;
    if(c.folder) counts[c.folder]=(counts[c.folder]||0)+1;
  });
  document.querySelectorAll('#folderRow .f-count').forEach(function(sp){
    var k=sp.getAttribute('data-count');
    sp.textContent = k==='all' ? counts.all : (k==='archived' ? counts.archived : (counts[k]||0));
  });
}
function renderChatList(){
  var q=($('historySearch').value||'').toLowerCase();
  var el=$('chatList'); el.innerHTML='';
  refreshFolderCounts();
  if(state.chats.length===0){ el.innerHTML='<div style="padding:14px;color:var(--muted);font-size:13.5px;line-height:1.6">No chats yet.<br>Type a question below to start your first research.</div>'; return; }
  var list=state.chats.slice();
  list.sort(function(a,b){ return (b.pinned?1:0)-(a.pinned?1:0); });
  var shown=0;
  list.forEach(function(c){
    if(state.folderFilter==='archived'){ if(!c.archived) return; }
    else if(c.archived) return;
    if(state.folderFilter!=='all' && state.folderFilter!=='archived' && (c.folder||'')!==state.folderFilter) return;
    if(q && c.title.toLowerCase().indexOf(q)===-1) return;
    shown++;
    var div=document.createElement('div'); div.className='chat-item'+(c.id===state.activeId?' active':'');
    var lastMsg=c.messages.length?c.messages[c.messages.length-1]:null;
    var lastTs=lastMsg?(lastMsg.ts||c.created):c.created;
    div.innerHTML='<svg class="ic chat-ic"><use href="#i-chat"/></svg><div class="chat-item-main"><div class="chat-item-title">'+(c.pinned?'<span class="pinmark">PINNED • </span>':'')+esc(c.title)+(c.archived?' <span class="archtag">Archived</span>':'')+'</div></div>'
      +'<span class="chat-item-time">'+esc(shortAgo(lastTs))+'</span>'
      +'<button class="iconbtn" data-act="menu" title="Chat actions — rename, pin, archive, share, delete" aria-label="Chat actions"><svg class="ic"><use href="#i-dots"/></svg></button>';
    div.querySelector('.chat-item-main').onclick=function(){ state.activeId=c.id; state.menuChatId=null; renderChatList(); renderMessages(); saveChats(); syncDeepUI(); $('sidebar').classList.remove('open'); };
    div.querySelector('[data-act="menu"]').onclick=function(e){
      e.stopPropagation();
      state.menuChatId = state.menuChatId===c.id ? null : c.id;
      renderChatList();
    };
    if(state.menuChatId===c.id){
      var menu=document.createElement('div'); menu.className='chat-menu';
      var folders=['Personal','Work','Research','Projects'];
      var mh='<button data-m="rename"><svg class="ic"><use href="#i-pencil"/></svg> Rename</button>'
        +'<button data-m="pin"><svg class="ic"><use href="#i-pin"/></svg> '+(c.pinned?'Unpin':'Pin to top')+'</button>'
        +'<button data-m="archive"><svg class="ic"><use href="#i-archive"/></svg> '+(c.archived?'Unarchive':'Archive')+'</button>'
        +'<button data-m="share"><svg class="ic"><use href="#i-share"/></svg> Share chat</button>';
      folders.forEach(function(f){ if((c.folder||'')!==f) mh+='<button data-m="folder" data-f="'+f+'"><svg class="ic"><use href="#i-doc"/></svg> Move to '+f+'</button>'; });
      if(c.folder) mh+='<button data-m="folder" data-f=""><svg class="ic"><use href="#i-doc"/></svg> Remove from folder</button>';
      mh+='<button data-m="del" class="danger"><svg class="ic"><use href="#i-trash"/></svg> Delete</button>';
      menu.innerHTML=mh;
      menu.querySelectorAll('button').forEach(function(b){
        b.onclick=function(ev){
          ev.stopPropagation(); var act=b.getAttribute('data-m'); state.menuChatId=null;
          if(act==='rename'){ state.renameId=c.id; $('renameInput').value=c.title; openModal('renameModal'); renderChatList(); }
          else if(act==='pin'){ c.pinned=!c.pinned; renderChatList(); saveChats(); toast(c.pinned?'Chat pinned to the top':'Pin removed'); }
          else if(act==='archive'){ c.archived=!c.archived; renderChatList(); saveChats(); toast(c.archived?'Chat archived — find it under the Archived folder':'Chat back in your list'); }
          else if(act==='share'){ var txt=c.messages.map(function(m){ return (m.role==='user'?'You: ':'ENZO: ')+(m.text||m.plain||stripHtml(m.html||'')); }).join('\n\n'); shareText(c.title, txt); renderChatList(); }
          else if(act==='folder'){ c.folder=b.getAttribute('data-f')||''; renderChatList(); saveChats(); toast(c.folder?('Moved to '+c.folder):'Removed from folder'); }
          else if(act==='del'){
            renderChatList();
            confirmAction('Delete this chat?', '“'+c.title+'” and all its messages will be permanently deleted from this browser. This cannot be undone.', 'Yes, delete it', function(){
              state.chats=state.chats.filter(function(x){return x.id!==c.id});
              if(state.activeId===c.id) state.activeId=state.chats[0]?state.chats[0].id:null;
              renderChatList(); renderMessages(); saveChats(); toast('Chat deleted');
            });
          }
        };
      });
      div.appendChild(menu);
    }
    el.appendChild(div);
  });
  if(shown===0){ el.innerHTML='<div style="padding:14px;color:var(--muted);font-size:13.5px;line-height:1.6">Nothing here yet.<br>Chats you '+(state.folderFilter==='archived'?'archive':'put in this folder')+' will appear in this list.</div>'; }
}

function showHomeOrChat(){
  var c=activeChat();
  var has = c && c.messages.length>0;
  $('homeView').style.display=has?'none':'block';
  $('chatView').style.display=has?'block':'none';
}

function renderMessages(forceScroll){
  showHomeOrChat();
  syncWsHead();
  var c=activeChat(); var box=$('messages'); box.innerHTML='';
  if(!c) return;
  c.messages.forEach(function(m){
    box.appendChild(buildMessageEl(m));
  });
  /* Auto-scroll only when the reader is already near the bottom — never yank them away from an older message.
     On the home view there is no conversation to follow, so the hero always starts at the very top —
     scrolling to the bottom there used to clip the hero banner, mascot and chips off the top edge. */
  if($('homeView').style.display!=='none') $('scrollArea').scrollTop=0;
  else if(forceScroll || state.nearBottom) $('scrollArea').scrollTop=$('scrollArea').scrollHeight;
}

/* The user's chat avatar shows their real profile photo when one is set, otherwise their initial */
function userAvatarInner(){
  var signedOut=loadPref('enao_signed_out','0')==='1';
  var photo=signedOut?'':loadPref('enao_avatar','');
  if(photo) return '<img src="'+photo+'" alt="Your profile photo">';
  var nm=signedOut?'Guest':(loadPref('enao_name','Raja')||'Raja');
  return esc((nm.trim().charAt(0)||'R').toUpperCase());
}
