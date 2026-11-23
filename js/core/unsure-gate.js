
/* ================= NEVER-ANSWER-WHEN-UNSURE GATE (locked rule 48) =================
   If ENZO does not understand the message — ambiguous wording, unclear
   intent, a referent with no referent ("wo wala kaam kar do"), a typo that
   changes the meaning, or no usable search result — it must NOT answer.
   It asks ONE short clarifying question in the user's own language, naming
   the two most likely meanings when there are two, and only researches /
   answers after the user clarifies. This gate wraps every entry point
   (typed, voice, call, regenerate) and runs before any search starts.
   The matching no-usable-results behaviour lives in the answer pipelines,
   which call window.__enzoClarifyQuestion / __enzoNoResultsOptions below. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
/* ---- word sets for the referential / empty-command check ---- */
var DEMO_W={wo:1,woh:1,ye:1,yeh:1,us:1,uss:1,iss:1,un:1,wohi:1,yehi:1,usi:1,isi:1,unhi:1,inhi:1,that:1,this:1,it:1,those:1,these:1,same:1,wala:1,wali:1,wale:1,waala:1,cheez:1,thing:1,stuff:1,kaam:1,kam:1,kuch:1,something:1,anything:1,number:1,doosra:1,dusra:1,doosri:1,pehla:1,pahla:1,pehli:1,another:1,other:1,pichla:1,pichli:1,agla:1,agli:1,jo:1};
var VERB_W={kar:1,karo:1,kr:1,karna:1,krna:1,kardo:1,karde:1,karke:1,kiya:1,do:1,does:1,did:1,de:1,dena:1,dedo:1,bana:1,banao:1,banana:1,theek:1,thik:1,fix:1,handle:1,sort:1,bhej:1,bhejo:1,bhejna:1,send:1,laga:1,lagao:1,khol:1,kholo:1,band:1,start:1,stop:1,chala:1,chalao:1,rakh:1,rakho:1,nikal:1,nikalo:1,le:1,lo:1,lena:1,ao:1,aao:1,jao:1,ja:1,batao:1,bata:1,batana:1,tell:1,show:1,dikhao:1,dikha:1,get:1,give:1,make:1,ho:1,hua:1,jaye:1,gaya:1,complete:1,finish:1,run:1,play:1,delete:1,remove:1,erase:1,clear:1,bola:1,kaha:1};
var FILL_W={please:1,plz:1,zara:1,bhai:1,yaar:1,ab:1,abhi:1,jaldi:1,mera:1,meri:1,mere:1,mujhe:1,mujhay:1,aap:1,tum:1,ko:1,se:1,ka:1,ki:1,ke:1,hai:1,hain:1,tha:1,thi:1,na:1,bhi:1,to:1,aur:1,and:1,the:1,a:1,an:1,my:1,me:1,you:1,just:1,now:1,right:1,for:1,of:1,on:1,in:1,up:1,out:1,is:1,are:1,was:1,were:1,kya:1,kia:1,kyu:1,kyun:1,kab:1,kahan:1,kidhar:1,kaise:1,kaisa:1,konsa:1,kaun:1,who:1,what:1,when:1,where:1,why:1,how:1,which:1};
var URDU_W={'وہ':1,'یہ':1,'اس':1,'اسی':1,'وہی':1,'یہی':1,'ان':1,'کام':1,'چیز':1,'کر':1,'کرو':1,'دو':1,'دینا':1,'والا':1,'والی':1,'کچھ':1,'ٹھیک':1,'بھیج':1,'بھیجو':1,'بنا':1,'بناؤ':1,'بتاؤ':1,'بتا':1,'لگا':1,'لگاؤ':1,'میرا':1,'میری':1,'مجھے':1,'آپ':1,'کو':1,'سے':1,'کا':1,'کی':1,'کے':1,'ہے':1,'ہیں':1,'بھی':1,'اور':1,'اب':1,'بس':1,'وہی':1,'دوسرا':1,'پہلا':1,'نمبر':1};
/* True when the message is only a demonstrative + verb + filler — a command
   pointing at something that is never named ("wo wala kaam kar do",
   "ye kar do", "do it", "fix it", "delete it"). A single concrete content
   word (bitcoin, website, song, email…) makes it a real request again. */
function vagueCheck(text){
  var raw=String(text||'').trim();
  if(!raw) return false;
  var words=raw.toLowerCase().replace(/[?!.,;:'"()\[\]{}؟۔،~…]+/g,' ').split(/\s+/).filter(Boolean);
  if(!words.length || words.length>14) return false;
  var hasDemo=false, content=0;
  for(var i=0;i<words.length;i++){
    var w=words[i];
    if(DEMO_W[w] || URDU_W[w]){ hasDemo=true; continue; }
    if(VERB_W[w] || FILL_W[w]) continue;
    if(w.length<3) continue;
    content++;
  }
  if(content>0) return false;
  return hasDemo || words.length<=5;
}
/* ---- the two most likely meanings ---- */
function topicLabel(t){
  var s=String(t||'').replace(/\s+/g,' ').trim();
  if(!s) return '';
  /* The user's own words are the clearest option label — use them verbatim
     for any normal-length message; only a very long message is condensed
     to its keywords. */
  if(s.length<=56) return s.replace(/[?.!]+$/,'');
  var kw=[]; try{ kw=analyzeQuestion(s).keywords||[]; }catch(e){}
  var lab=kw.slice(0,4).join(' ');
  if(lab.length>=8) return lab;
  return s.slice(0,52).trim()+'…';
}
function contextOptions(chat, excludeText){
  var opts=[], seen={};
  if(chat && chat.messages){
    for(var i=chat.messages.length-1;i>=0 && opts.length<2;i--){
      var m=chat.messages[i];
      if(!m || m.role!=='user' || !m.text) continue;
      if(excludeText && m.text===excludeText) continue;
      var lab=topicLabel(m.text), key=lab.toLowerCase();
      if(lab && !seen[key]){ seen[key]=1; opts.push({label:lab, full:m.text}); }
    }
  }
  return opts;
}
function noResultsOptions(text){
  var opts=[];
  var en=''; try{ en=(romanToEnglish(text)||'').trim(); }catch(e){}
  var kw=[]; try{ kw=analyzeQuestion(text).keywords||[]; }catch(e){}
  var topic=kw.join(' ');
  if(en && en.toLowerCase()!==String(text||'').toLowerCase()){
    opts.push({label:en, full:en});
    if(topic && topic.toLowerCase()!==en.toLowerCase()) opts.push({label:topic, full:topic});
  } else if(kw.length>=2){
    opts.push({label:topic, full:topic});
    opts.push({label:kw[0], full:kw[0]});
  } else if(topic){
    opts.push({label:topic, full:topic});
  }
  return opts.slice(0,2);
}
window.__enzoNoResultsOptions=noResultsOptions;
var CLARIFY_T={
  vague2:{en:function(a,b){ return 'Quick check before I do the wrong thing — do you mean "'+a+'", or "'+b+'"? Just name one, and I will do exactly that.'; },
          roman:function(a,b){ return 'Ek zaroori sawaal, taake main ghalat kaam na kar doon — aap ka matlab "'+a+'" hai ya "'+b+'"? Bas ek ka naam bata dein, main andaza lagaye baghair bilkul wahi kar dunga.'; },
          urdu:function(a,b){ return 'ایک ضروری سوال، تاکہ میں غلط کام نہ کر دوں — آپ کا مطلب "'+a+'" ہے یا "'+b+'"؟ بس ایک کا نام بتا دیں، میں اندازہ لگائے بغیر بالکل وہی کر دوں گا۔'; }},
  vague1:{en:function(a){ return 'Quick check — do you mean "'+a+'", or a different task? Name the task in one line and I will do exactly that, no guessing.'; },
          roman:function(a){ return 'Ek zaroori sawaal — aap ka matlab "'+a+'" hai, ya koi aur kaam? Bas kaam ka naam ek line mein bata dein, main andaza lagaye baghair bilkul wahi kar dunga.'; },
          urdu:function(a){ return 'ایک ضروری سوال — آپ کا مطلب "'+a+'" ہے، یا کوئی اور کام؟ بس کام کا نام ایک سطر میں بتا دیں، میں اندازہ لگائے بغیر بالکل وہی کر دوں گا۔'; }},
  vague0:{en:function(){ return 'I do not want to guess and do the wrong thing — which task do you mean? Just name it in one line, and I will do it right away.'; },
          roman:function(){ return 'Main andaza laga kar ghalat kaam nahi karna chahta — aap kis kaam ki baat kar rahe hain? Bas kaam ka naam ek line mein bata dein, main foran kar dunga.'; },
          urdu:function(){ return 'میں اندازہ لگا کر غلط کام نہیں کرنا چاہتا — آپ کس کام کی بات کر رہے ہیں؟ بس کام کا نام ایک سطر میں بتا دیں، میں فوراً کر دوں گا۔'; }},
  noresults2:{en:function(a,b){ return 'Before I answer, one quick check — do you mean "'+a+'", or "'+b+'"? Name one, and I will research exactly that.'; },
          roman:function(a,b){ return 'Jawab se pehle ek chhota sa sawaal — aap ka matlab "'+a+'" hai ya "'+b+'"? Ek ka naam bata dein, main bilkul usi par research kar ke jawab dunga.'; },
          urdu:function(a,b){ return 'جواب سے پہلے ایک چھوٹا سا سوال — آپ کا مطلب "'+a+'" ہے یا "'+b+'"؟ ایک کا نام بتا دیں، میں بالکل اسی پر ریسرچ کر کے جواب دوں گا۔'; }},
  noresults1:{en:function(a){ return 'One quick check so I research the right thing — do you mean "'+a+'"? Say yes, or name the exact topic in one line.'; },
          roman:function(a){ return 'Ek chhota sa sawaal, taake main sahi cheez par research karoon — aap ka matlab "'+a+'" hai? Haan keh dein, ya asal topic ka naam ek line mein bata dein.'; },
          urdu:function(a){ return 'ایک چھوٹا سا سوال، تاکہ میں صحیح چیز پر ریسرچ کروں — آپ کا مطلب "'+a+'" ہے؟ ہاں کہہ دیں، یا اصل موضوع کا نام ایک سطر میں بتا دیں۔'; }},
  reask:{en:function(){ return 'No problem — tell me in one line exactly what you would like me to do, and I will do that.'; },
         roman:function(){ return 'Koi baat nahi — ek line mein saaf bata dein ke aap kya karwana chahte hain, main bilkul wahi kar dunga.'; },
         urdu:function(){ return 'کوئی بات نہیں — ایک سطر میں صاف بتا دیں کہ آپ کیا کروانا چاہتے ہیں، میں بالکل وہی کر دوں گا۔'; }}
};
function pickT(group, lang){ var g=CLARIFY_T[group]; return (g && (g[lang]||g.en)) || CLARIFY_T[group].en; }
function clarifyQuestion(text, lang, chat, mode, opts){
  var L=(lang==='urdu')?'urdu':(lang==='roman')?'roman':'en';
  if(mode==='noresults'){
    var o=opts||noResultsOptions(text);
    if(o.length>=2) return pickT('noresults2',L)(o[0].label,o[1].label);
    if(o.length===1) return pickT('noresults1',L)(o[0].label);
    return pickT('vague0',L)();
  }
  var co=opts||contextOptions(chat, text);
  if(co.length>=2) return pickT('vague2',L)(co[0].label,co[1].label);
  if(co.length===1) return pickT('vague1',L)(co[0].label);
  return pickT('vague0',L)();
}
window.__enzoClarifyQuestion=clarifyQuestion;
/* ---- delivering the clarifying question as a normal chat pair ---- */
function pushClarifyPair(chat, userText, lang, viaVoice, aiText){
  var tl=timeLabelFor(Date.now());
  chat.messages.push({role:'user', text:userText, lang:lang, viaVoice:!!viaVoice, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full, files:[]});
  var tl2=timeLabelFor(Date.now());
  var m={role:'ai', html:mdToHtml(aiText), plain:aiText, viaVoice:!!viaVoice, question:userText, sources:[], deep:false, clarify:true, modeWhy:'ENZO asked a clarifying question — never answers when unsure', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:tl2.daypart, daypartRoman:tl2.daypartRoman, timeLabel:tl2.full};
  chat.messages.push(m);
  renderChatList(); renderMessages(true); saveChats();
  if(typeof setCentreEnzo==='function') setCentreEnzo('idle');
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(m, answersMode()) : maybeSpeak(m));
  return m;
}
/* ---- reading the user's clarification reply ---- */
function resolveClarifyReply(chat, pc, reply, viaVoice, forcedDeep, inner){
  var r=String(reply||'').trim();
  var lang=pc.lang||detectLang(r);
  var opts=pc.opts||[];
  var low=' '+r.toLowerCase()+' ';
  var pickIdx=-1;
  if(/\b(pehla|pahla|first|1)\b/.test(low) || /(wo wala|wohi|usi)/.test(low)) pickIdx=0;
  else if(/\b(doosra|dusra|second|2)\b/.test(low) || /(ye wala|yehi|isi)/.test(low)) pickIdx=1;
  if(pickIdx<0 && opts.length && /^(yes|yeah|yep|haan|han|ji|jee|theek|sahi|bilkul|correct|right|ok|okay)\b/i.test(r)) pickIdx=0;
  /* A reply naming one option's own words picks that option. */
  if(pickIdx<0 && opts.length){
    var best=-1, bestScore=0;
    opts.forEach(function(o, i){
      var words=(o.label||'').toLowerCase().split(/\s+/).filter(function(w){ return w.length>2; });
      var score=0;
      words.forEach(function(w){ if(low.indexOf(' '+w+' ')>-1 || low.indexOf(w)>-1) score++; });
      if(score>bestScore){ bestScore=score; best=i; }
    });
    if(bestScore>0) pickIdx=best;
  }
  if(pickIdx>=0 && opts[pickIdx]){
    if(pc.noResults){
      var sep=(lang==='roman'||lang==='urdu')?' — matlab: ':' — meaning: ';
      inner(pc.original+sep+opts[pickIdx].label, viaVoice, forcedDeep);
    } else {
      inner(opts[pickIdx].full||opts[pickIdx].label, viaVoice, forcedDeep);
    }
    return true;
  }
  if(/^(no|nahi|nahin|nope|galat|wrong|stop|ruk)\b/i.test(r) && r.length<30){
    var rest=r.replace(/^(no|nahi|nahin|nope|galat|wrong|stop|ruk)\b/i,'').replace(/^[\s,.\-:]+/,'').trim();
    if(rest.length>=3){ inner(rest, viaVoice, forcedDeep); return true; }
    var lrA=false; try{ lrA=!!(chat.intelState && isLoopRisk(chat.intelState, r)); }catch(e){}
    if(lrA){ inner(r, viaVoice, forcedDeep); return true; }
    pushClarifyPair(chat, r, lang, viaVoice, pickT('reask',lang)());
    return true;
  }
  if(vagueCheck(r)){
    var lrB=false; try{ lrB=!!(chat.intelState && isLoopRisk(chat.intelState, r)); }catch(e){}
    if(lrB){ inner(r, viaVoice, forcedDeep); return true; }
    /* Still pointing at nothing named — ask once more, with fresh options. */
    var opts2=pc.noResults?noResultsOptions(pc.original):contextOptions(chat, pc.original);
    chat.pendingClarifyLocal={original:pc.original, noResults:!!pc.noResults, lang:lang, opts:opts2};
    saveChats();
    pushClarifyPair(chat, r, lang, viaVoice, clarifyQuestion(pc.original, lang, chat, pc.noResults?'noresults':'vague', opts2));
    return true;
  }
  if(r.length>=3){ inner(r, viaVoice, forcedDeep); return true; }
  return false;
}
/* ---- the gate itself ---- */
var innerGate=window.askQuestion;
window.askQuestion=function(text, viaVoice, forcedDeep){
  var raw=String(text||'');
  var chat=null;
  try{ chat=activeChat(); }catch(e){}
  /* 1) A clarifying question is waiting: this message IS the clarification. */
  if(chat && chat.pendingClarifyLocal && raw.trim() && typeof forcedDeep!=='boolean'){
    var pc=chat.pendingClarifyLocal;
    chat.pendingClarifyLocal=null; saveChats();
    if(resolveClarifyReply(chat, pc, raw, viaVoice, forcedDeep, innerGate)) return;
    return innerGate(text, viaVoice, forcedDeep);
  }
  /* 2) Fresh message: if it only points at an unnamed thing, ask — never
     answer, never search. Skipped for re-runs (forcedDeep), file questions,
     small talk, and while a confirm / backend-clarify / reminder follow-up
     is already waiting for its reply. */
  if(raw.trim() && typeof forcedDeep!=='boolean'
     && !(typeof state!=='undefined' && state.pendingFiles && state.pendingFiles.length)
     && !(chat && (chat.pendingConfirm || chat.pendingClarify || chat.pendingReminder))){
    /* v62-learning: teaching / directed-learning / forget orders are handled
       BEFORE intent routing (shouldClarify / classifyIntent). When handled,
       the reply is delivered here and the message never enters the
       research pipeline. */
    try{ if(typeof enzoLearningIntercept==='function' && enzoLearningIntercept(raw, chat, viaVoice)) return; }catch(e){}
    /* v59-live-research-fix (Piece 31 [2]): EnzoResearchTriggers.shouldClarify runs FIRST, before vagueCheck / classifyIntent. clarify === false skips this gate entirely; a research order proceeds as Deep Research so it never receives the Normal badge (the kind is derived from the trigger result). clarify === true asks result.question, already in the user's language (clarifyQuestion() is the fallback). */
    var trig59b=null;
    try{ if(window.EnzoResearchTriggers) trig59b=window.EnzoResearchTriggers.shouldClarify(raw); }catch(e){}
    if(trig59b && trig59b.clarify===false){
      if(trig59b.research && trig59b.research.research) return innerGate(text, viaVoice, true);
      return innerGate(text, viaVoice, forcedDeep);
    }
    if(trig59b && trig59b.clarify===true && trig59b.question){
      if(!chat){ chat=createChat(raw.slice(0,42)); }
      var lang59b=detectLang(raw);
      var opts59b=contextOptions(chat, null);
      chat.pendingClarifyLocal={original:raw, lang:lang59b, vague:true, opts:opts59b, trigReason:trig59b.reason};
      saveChats();
      pushClarifyPair(chat, raw, lang59b, viaVoice, trig59b.question || clarifyQuestion(raw, lang59b, chat, 'vague', opts59b));
      return;
    }
    var lang=detectLang(raw);
    var isSmall=false;
    try{ isSmall=(typeof smallTalkReply==='function') && !!smallTalkReply(raw, lang); }catch(e){}
    /* v55 P1: the vague gate must not re-run on a message whose kind
       the intent classifier already decided, and must not re-ask when
       isLoopRisk says this clarification was already asked. */
    var decided55=false, loop55=false;
    try{ if(chat && typeof classifyIntent==='function'){ var intel55=chat.intelState||(chat.intelState=createIntelState()); var intent55=classifyIntent(raw, {state:intel55}); if(intent55.kind && intent55.kind!=='clarify') decided55=true; loop55=isLoopRisk(intel55, raw); } }catch(e){}
    if(!isSmall && vagueCheck(raw) && !decided55 && !loop55){
      if(!chat){ chat=createChat(raw.slice(0,42)); }
      var opts=contextOptions(chat, null);
      chat.pendingClarifyLocal={original:raw, lang:lang, vague:true, opts:opts};
      pushClarifyPair(chat, raw, lang, viaVoice, clarifyQuestion(raw, lang, chat, 'vague', opts));
      return;
    }
  }
  return innerGate(text, viaVoice, forcedDeep);
};
})();
