
/* ==========================================================================
 * v62-learning wiring (22 Nov 2026): pieces 41-44 (learning track).
 * Inlined byte-identical right after the piece-31 block; this block only
 * WIRES them into the live artifact. No voice / language / backend /
 * identity code touched. No backend change. No new backend endpoint is
 * invented here: search reuses searchWeb() (the real /api/search proxy
 * path) and video resolving reuses /api/fetch + YouTube oEmbed.
 *
 * Store-shape note (reconciliation the pieces leave to the assembler):
 * piece 41 stores a correction's detail as a STRING (the wrong part);
 * piece 44 stores detail as an OBJECT {wrong, right}. Corrections are
 * stored in the piece-44 object form (the guard needs detail.wrong),
 * and every reader that expects the piece-41 string form gets a
 * normalised copy (detail -> detail.wrong) via enzoLearningNoteItems()
 * / the Settings adapter. The stored item itself is never rewritten.
 * Disputed / superseded items are excluded from the prompt note and
 * from the guard (piece 44 already filters them); they stay in the
 * store so Raja can see and delete them in Settings.
 * ========================================================================== */

/* ---------- small shared helpers ---------- */
function enzoLearningStore(){
  try{ if(window.EnzoTeaching) return window.EnzoTeaching.createLearnedStore(); }catch(e){}
  return null;
}
function enzoLearningActiveItems(){
  var items=[];
  try{
    var all=enzoLearningStore().getItems()||[];
    for(var i=0;i<all.length;i++){ var st=all[i].status; if(!st||st==='active') items.push(all[i]); }
  }catch(e){}
  return items;
}
function enzoLearningPersist(items){
  try{ if(window.EnzoTeaching) localStorage.setItem(window.EnzoTeaching.ITEMS_KEY, JSON.stringify(items||[])); }catch(e){}
}
/* Normalised copies for piece-41 readers (buildLearnedNote expects
   detail to be a string — the wrong part — never an object). */
function enzoLearningNoteItems(items){
  var out=[];
  for(var i=0;i<(items||[]).length;i++){
    var it=items[i], d=it.detail;
    if(d && typeof d==='object'){
      out.push({kind:it.kind, text:it.text, detail:(d.wrong||''), lang:it.lang, ts:it.ts, topic:it.topic});
    } else out.push(it);
  }
  return out;
}
/* The combined prompt block: piece 41 learned note + piece 44 active
   corrections note. Used by learnedNote() (legacy prompts) and
   learnedPrefs() (backend /ask preferences). '' when nothing learned. */
function enzoLearningNoteBlocks(){
  var parts=[];
  try{
    if(!window.EnzoTeaching) return '';
    var active=enzoLearningActiveItems();
    if(!active.length) return '';
    var n1=window.EnzoTeaching.buildLearnedNote(enzoLearningNoteItems(active));
    if(n1) parts.push(n1);
    if(window.CorrectionGuard){
      var n2=window.CorrectionGuard.correctionNote(active);
      if(n2) parts.push(n2);
    }
  }catch(e){}
  return parts.join('\n');
}

/* ---------- Settings CSS for the piece-43 rows ---------- */
try{
  var lrnCss=document.createElement('style'); lrnCss.id='enzoV62LearnCss';
  lrnCss.textContent='.lrn-items-head h4{margin:14px 0 2px;font-size:13px;color:var(--ink)}'
    +'.lrn-count{font-size:12px;color:var(--muted);margin:6px 0}'
    +'.lrn-item{padding:7px 0;border-bottom:1px dashed var(--line);font-size:12.5px;color:var(--ink)}'
    +'.lrn-item-detail{color:var(--muted);font-size:12px;margin-top:2px}'
    +'.lrn-item-meta{color:var(--muted);font-size:11.5px;margin-top:3px}'
    +'.lrn-item-meta a{color:var(--muted);text-decoration:underline}'
    +'.lrn-item .lrn-x{margin-top:5px}';
  document.head.appendChild(lrnCss);
}catch(e){}

/* ---------- delivering a learning reply (mirrors the small-talk reply
   shape in askQuestion: user message already pushed, then the AI reply,
   render, save, speak) ---------- */
function enzoLearningPushUser(chat, raw, lang, viaVoice){
  var tl=timeLabelFor(Date.now());
  chat.messages.push({role:'user', text:raw, lang:lang, viaVoice:!!viaVoice, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full});
  renderChatList(); renderMessages(true); saveChats();
}
function enzoLearningDeliverReply(chat, replyText, lang, viaVoice){
  var tl=timeLabelFor(Date.now());
  var msg={role:'ai', html:mdToHtml(replyText), plain:replyText, viaVoice:!!viaVoice, question:'', sources:[], deep:false, modeWhy:'Learned from Raja — stored, and used in future answers', auto:false, followups:[], lang:lang, ts:Date.now(), daypart:tl.daypart, daypartRoman:tl.daypartRoman, timeLabel:tl.full};
  chat.messages.push(msg); renderMessages(); saveChats();
  setCentreEnzo('success');
  setTimeout(function(){ if(!state.isGenerating) setCentreEnzo('idle'); }, 2800);
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
}

/* ---------- piece 42 deps: the app's REAL research + video paths ---------- */
/* search: the real research path — searchWeb() over the /api/search proxy,
   mapped to the {title, url, date, snippet} shape piece 42 reads. Page
   text (extract) is used as the snippet, capped, so learned points carry
   real page content; at most 5 results become learned points. */
function enzoLearningSearchDep(topic){
  return searchWeb(topic, true).then(function(all){
    var arr=(all||[]).slice(0,5), out=[];
    for(var i=0;i<arr.length;i++){
      var s=arr[i]||{}; if(!s.url) continue;
      var snip=String(s.extract||s.snippet||s.text||s.description||s.title||'');
      out.push({title:String(s.title||s.url), url:String(s.url), date:String(s.date||s.published||s.publishedAt||''), snippet:snip.slice(0,400)});
    }
    return out;
  });
}
function enzoLearningHtmlUnesc(s){
  return String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
/* resolveVideo: real video metadata via /api/fetch + YouTube oEmbed
   (title + channel), plus the watch page's real og:description and
   datePublished when the page actually carries them. No transcript API
   exists, so description-less videos honestly resolve metadata-only in
   piece 42. A bare topic (no URL) is first searched for a real YouTube
   watch URL; when none is found the resolver returns null. */
function enzoLearningResolveVideo(input){
  var raw=String(input||'').trim();
  if(!raw) return Promise.resolve(null);
  function watchUrlOf(u){
    var m;
    m=/youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(u); if(m) return 'https://www.youtube.com/watch?v='+m[1];
    m=/[?&]v=([A-Za-z0-9_-]{6,})/.exec(u); if(m) return 'https://www.youtube.com/watch?v='+m[1];
    m=/youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/.exec(u); if(m) return 'https://www.youtube.com/watch?v='+m[1];
    return null;
  }
  function resolveWatch(watchUrl){
    var oeUrl='https://www.youtube.com/oembed?url='+encodeURIComponent(watchUrl)+'&format=json';
    var oeFetch=window.EnzoPagesBackend.getSearchUrl('/api/fetch?url='+encodeURIComponent(oeUrl));
    return fetchJSONT(oeFetch, 15000).then(function(j){
      var oe=j;
      if(oe && typeof oe.text==='string'){ try{ oe=JSON.parse(oe.text); }catch(e){ oe=null; } }
      if(!oe || !oe.title) return null;
      var meta={title:String(oe.title||''), channel:String(oe.author_name||''), url:watchUrl, published:'', description:''};
      var pageFetch=window.EnzoPagesBackend.getSearchUrl('/api/fetch?url='+encodeURIComponent(watchUrl));
      return fetchJSONT(pageFetch, 15000).then(function(pj){
        var html=(pj && typeof pj.text==='string') ? pj.text : '';
        if(html){
          var dm=/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]*)"/i.exec(html)
            || /<meta[^>]+content="([^"]*)"[^>]+(?:property="og:description"|name="description")/i.exec(html);
          if(dm) meta.description=enzoLearningHtmlUnesc(dm[1]).slice(0,2000);
          var pub=/"(?:datePublished|uploadDate)"\s*:\s*"([^"]+)"/.exec(html);
          if(pub) meta.published=pub[1];
        }
        return meta;
      }, function(){ return meta; });
    }, function(){ return null; });
  }
  var direct=watchUrlOf(raw);
  if(direct) return resolveWatch(direct);
  return searchWeb(raw+' youtube', false).then(function(all){
    var arr=all||[];
    for(var i=0;i<arr.length;i++){
      var w=(arr[i] && arr[i].url) ? watchUrlOf(String(arr[i].url)) : null;
      if(w) return resolveWatch(w);
    }
    return null;
  }, function(){ return null; });
}
function enzoLearningDeps(){
  var deps={search:enzoLearningSearchDep, resolveVideo:enzoLearningResolveVideo};
  try{
    var baseStore=enzoLearningStore();
    if(baseStore){
      /* Piece 41's addItem hard-codes source:'taught' and drops the
         source object piece 42 attaches to learned points. The adapter
         keeps the piece-41 store as the single store but writes the
         real source object back onto the saved item, so directed
         learning keeps its real source (and Settings can link it). */
      deps.store={
        addItem:function(item){
          var saved=baseStore.addItem(item);
          if(saved && item && item.source && typeof item.source==='object'){
            try{
              var all=baseStore.getItems();
              for(var i=0;i<all.length;i++){ if(all[i].id===saved.id){ all[i].source=item.source; break; } }
              enzoLearningPersist(all);
              saved.source=item.source;
            }catch(e){}
          }
          return saved;
        },
        getItems:function(){ return baseStore.getItems(); },
        deleteItem:function(id){ return baseStore.deleteItem(id); },
        clearAll:function(){ return baseStore.clearAll(); }
      };
    }
  }catch(e){}
  return deps;
}

/* ---------- verified sources on hand: the last AI answer's sources ---------- */
function enzoLearningLastVerifiedSources(chat){
  try{
    var msgs=chat.messages||[];
    for(var i=msgs.length-1;i>=0;i--){
      var m=msgs[i];
      if(m && m.role==='ai' && m.sources && m.sources.length){
        var out=[];
        for(var j=0;j<m.sources.length;j++){
          var s=m.sources[j]; if(!s) continue;
          if(typeof s==='string'){ out.push({title:s, url:'', text:''}); continue; }
          out.push({title:String(s.title||s.url||''), url:String(s.url||''), text:String(s.extract||s.snippet||s.text||''), date:String(s.date||s.published||'')});
        }
        if(out.length) return out;
      }
    }
  }catch(e){}
  return [];
}

/* ---------- reply texts ---------- */
var DIRECTED_FAIL_T={
  en:'I could not finish learning that just now — the lookup failed. Please try again.',
  roman:'Main abhi ye seekh nahi saka — lookup fail ho gaya. Dobara koshish karein.',
  urdu:'میں ابھی یہ نہیں سیکھ سکا — تلاش ناکام ہو گئی۔ دوبارہ کوشش کریں۔'
};
var DISPUTE_T={
  en:function(fact, ev){ return 'You taught me "'+fact+'", but '+ev+' — which one should I keep? I have saved this as disputed, not as a fact, until you decide.'; },
  roman:function(fact, ev){ return 'Aap ne mujhe "'+fact+'" sikhaya, lekin '+ev+' — main kis ko rakhoon? Maine isay disputed save kiya hai, fact ke tor par nahi, jab tak aap faisla na karein.'; },
  urdu:function(fact, ev){ return 'آپ نے مجھے "'+fact+'" سکھایا، لیکن '+ev+' — میں کس کو رکھوں؟ میں نے اسے متنازع محفوظ کیا ہے، حقیقت کے طور پر نہیں، جب تک آپ فیصلہ نہ کریں۔'; },
  punjabi:function(fact, ev){ return 'تسیں مینوں "'+fact+'" سکھایا، لیکن '+ev+' — میں کیہنوں رکھاں؟ میں اینوں متنازع محفوظ کیتا اے، حقیقت دے طور تے نہیں، جدوں تک تسیں فیصلہ نہ کرو۔'; }
};
var BLOCKED_T={
  en:'Sorry — my answer repeated something you already corrected, so I did not send it. Which version should I use instead? Tell me the right version and I will use it from now on.',
  roman:'Maazrat — mera jawab us baat ko dohra raha tha jo aap pehle hi theek kar chuke hain, is liye maine wo jawab nahi bheja. Aap batayein, main kis version ko use karoon? Sahi version bata dein, main aage se wohi use karoon ga.',
  urdu:'معذرت — میرا جواب اس بات کو دہرا رہا تھا جو آپ پہلے ہی ٹھیک کر چکے ہیں، اس لیے میں نے وہ جواب نہیں بھیجا۔ آپ بتائیں، میں کس ورژن کو استعمال کروں؟ صحیح ورژن بتا دیں، میں آگے سے وہی استعمال کروں گا۔'
};

/* ---------- pre-delivery blocked reply (piece 44 fixAnswer blocked:true):
   the draft is NEVER delivered; a short apology + ask goes out instead. ---------- */
function enzoLearningDeliverBlocked(ctx, violations){
  ctx.delivered=true;
  try{ hideTyping(); }catch(e){}
  try{ if(typeof setGenerating==='function') setGenerating(false); }catch(e){}
  try{ if(typeof setCentreEnzo==='function') setCentreEnzo('idle'); }catch(e){}
  try{ if(window.__enzoLifecycle && ctx.myRun) window.__enzoLifecycle.completeTask(ctx.myRun); }catch(e){}
  try{ if(typeof setProgress==='function') setProgress(null); }catch(e){}
  var lang=ctx.lang||'en';
  var line=BLOCKED_T[lang]||BLOCKED_T.en;
  var msg=aiMsgShell(ctx, line, {html:mdToHtml(line), deep:false, modeWhy:'Blocked — the draft repeated a corrected mistake, so it was not delivered', followups:[]});
  ctx.chat.messages.push(msg);
  saveChats();
  if(activeChat()===ctx.chat){ renderMessages(); streamMessage(ctx.chat, msg); }
  else { msg.html=msg._fullHtml; renderChatList(); saveChats(); }
  (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(msg, answersMode()) : maybeSpeak(msg));
  return msg;
}

/* ---------- message-send intercept: runs BEFORE intent routing.
   Returns true when the message was handled (sync reply delivered, or
   the async directed-learning run started); false to continue normal
   routing. Order: (a) forget, (b) directed learning, (c) correction
   via piece 44, then teaching via piece 41. ---------- */
function enzoLearningIntercept(raw, chat, viaVoice){
  try{
    if(!window.EnzoTeaching && !window.EnzoDirectedLearning && !window.EnzoSettingsLearned) return false;
    if(!chat){ try{ chat=createChat(String(raw||'').slice(0,42)); }catch(e){ return false; } }
    var lang=(typeof detectLang==='function')?detectLang(raw):'en';
    var store=null;
    try{ if(window.EnzoTeaching) store=window.EnzoTeaching.createLearnedStore(); }catch(e){}
    /* (a) forget — first. A non-empty reply means a forget command. */
    if(window.EnzoSettingsLearned && store){
      var fr=null;
      try{ fr=window.EnzoSettingsLearned.handleForget(raw, store, {onItemsChanged:function(){ try{ renderLearned(); }catch(e){} }}); }catch(e){}
      if(fr && fr.reply){
        enzoLearningPushUser(chat, raw, lang, viaVoice);
        enzoLearningDeliverReply(chat, fr.reply, lang, viaVoice);
        return true;
      }
    }
    /* (b) directed learning — async; the normal generating indicator
       stays on while the real lookup runs. */
    if(window.EnzoDirectedLearning){
      var det=null;
      try{ det=window.EnzoDirectedLearning.detectDirectedLearning(raw); }catch(e){}
      if(det){
        enzoLearningPushUser(chat, raw, lang, viaVoice);
        try{ setGenerating(true); showTyping(); setTypingStatus('Learning…'); }catch(e){}
        window.EnzoDirectedLearning.applyDirectedLearning(raw, enzoLearningDeps()).then(function(out){
          try{ hideTyping(); setGenerating(false); }catch(e){}
          var summary=(out && out.summary) || (out && out.result && out.result.message) || '';
          enzoLearningDeliverReply(chat, summary, lang, viaVoice);
        }, function(){
          try{ hideTyping(); setGenerating(false); }catch(e){}
          enzoLearningDeliverReply(chat, (DIRECTED_FAIL_T[lang]||DIRECTED_FAIL_T.en), lang, viaVoice);
        });
        return true;
      }
    }
    /* (c) corrections route through piece 44 (detail.wrong/right), so
       the guard can catch repeats; teaching goes through piece 41. */
    if(window.EnzoTeaching && store){
      var corr=null;
      try{ corr=window.EnzoTeaching.detectCorrection(raw); }catch(e){}
      if(corr && window.CorrectionGuard){
        var items=store.getItems();
        try{ window.CorrectionGuard.applyCorrection({text:corr.rightPart||corr.wrongPart, detail:{wrong:corr.wrongPart, right:corr.rightPart}, lang:corr.lang||lang}, items); }catch(e){}
        enzoLearningPersist(items);
        var confirm=window.EnzoTeaching.confirmLine({kind:'correction', lang:corr.lang||lang});
        enzoLearningPushUser(chat, raw, lang, viaVoice);
        enzoLearningDeliverReply(chat, confirm, lang, viaVoice);
        return true;
      }
      var taught=null;
      try{ taught=window.EnzoTeaching.applyTeaching(raw); }catch(e){}
      if(taught && taught.learned){
        var item=taught.learned;
        /* Taught facts only: when the last delivered answer carries
           verified sources, check the fact against them. On a real
           contradiction, ask Raja plainly and store as 'disputed',
           never as truth. No sources on hand = no check possible. */
        if(item.kind==='fact' && window.CorrectionGuard){
          var vsrcs=enzoLearningLastVerifiedSources(chat);
          if(vsrcs && vsrcs.length){
            var chk=null;
            try{ chk=window.CorrectionGuard.checkTaughtFact(item.text, vsrcs); }catch(e){}
            if(chk && chk.contradicts){
              try{
                var all2=store.getItems();
                for(var k=0;k<all2.length;k++){ if(all2[k].id===item.id){ all2[k].status='disputed'; break; } }
                enzoLearningPersist(all2);
              }catch(e){}
              var dl=(DISPUTE_T[item.lang]||DISPUTE_T.en)(item.text, chk.evidence||'a verified source states the opposite');
              enzoLearningPushUser(chat, raw, lang, viaVoice);
              enzoLearningDeliverReply(chat, dl, lang, viaVoice);
              return true;
            }
          }
        }
        enzoLearningPushUser(chat, raw, lang, viaVoice);
        enzoLearningDeliverReply(chat, taught.confirm, lang, viaVoice);
        return true;
      }
    }
  }catch(e){}
  return false;
}

