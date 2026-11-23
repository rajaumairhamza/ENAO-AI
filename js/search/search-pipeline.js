/* ---------- SEARCH ----------
   Pipeline (v68 P6): the same-origin /api/search service ONLY. All search
   goes through the proxy interface (SearXNG -> RSS -> direct HTML fetch,
   owned by the P2 backend piece) — the browser itself calls NO search
   provider any more: the Wikipedia API, DuckDuckGo Lite and DuckDuckGo
   Instant Answer browser fallbacks are deleted (they lived in
   searchOneQuery below). Every proxy outcome is classified (ok / empty /
   network / http / timeout) so the UI can say exactly what happened, and
   an empty proxy answer is reported honestly as "no usable pages" — it is
   never silently backfilled from another provider, and an empty answer is
   never treated as proof the search itself worked (see aggregateFailKind).
   Only real pages the proxy actually returned ever become sources —
   nothing is invented, padded or dressed up. */
var searchRunId=0;
var searchInFlight=null;
function beginSearchRun(){
  /* A new question cancels the previous question's search outright */
  searchRunId++;
  if(searchInFlight){ try{ searchInFlight.abort(); }catch(e){} }
  searchInFlight=('AbortController' in window)?new AbortController():null;
  return searchRunId;
}
function searchSignal(){ return searchInFlight?searchInFlight.signal:undefined; }
function classifySearchErr(err){
  if(err && err.kind) return err;
  var e=new Error('search failed');
  var sig=searchSignal();
  if(sig && sig.aborted) e.kind='aborted';
  else if(err && err.name==='AbortError') e.kind='timeout';
  else e.kind='network';
  return e;
}
function fetchT(url, ms){
  var ctl=('AbortController' in window)?new AbortController():null;
  var to=ctl?setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, ms||10000):null;
  var sig=searchSignal(); var onAbort=null;
  if(sig && ctl){
    if(sig.aborted){ try{ ctl.abort(); }catch(e){} }
    else { onAbort=function(){ try{ ctl.abort(); }catch(e){} }; sig.addEventListener('abort', onAbort); }
  }
  function done(){ if(to) clearTimeout(to); if(sig && onAbort) sig.removeEventListener('abort', onAbort); }
  return fetch(url, ctl?{signal:ctl.signal}:undefined).then(function(r){ done(); return r; }, function(err){ done(); throw classifySearchErr(err); });
}
function fetchJSONT(url, ms){
  return fetchT(url, ms).then(function(r){
    if(!r.ok){ var e=new Error('http '+r.status); e.kind='http'; e.status=r.status; throw e; }
    return r.json();
  }).catch(function(err){ throw classifySearchErr(err); });
}
/* P6 (v68): fetchTextT deleted with the browser-side provider chain below —
   it existed only for ddgLiteSearchP, and no other caller in the tree uses
   it (verified by grep). */
/* Kept for any other caller: JSON fetch with a hard timeout */
function fetchJSON(url){ return fetchJSONT(url, 12000); }
/* P6 (v68): delayMs / withRetry deleted with the browser-side provider chain
   below — they existed only for the removed providers' retry, and no other
   caller in the tree uses them (verified by grep). */
/* Providers resolve to {results, fail} and never reject — except 'aborted',
   which means a newer question has taken over and this run must stop. */
function provOutcome(p){
  return p.then(function(results){ return {results:results||[], fail:(results&&results.length)?null:'empty'}; })
    .catch(function(e){ if(e && e.kind==='aborted') throw e; return {results:[], fail:(e&&e.kind)||'network'}; });
}
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return ''; } }

/* Google News RSS links (news.google.com/rss/articles/…) are redirect links:
   they fail to open in the browser ("Redirect Notice / invalid web address",
   "unusual traffic"). A news result may only ever be shown or cited with its
   DIRECT publisher URL — so every Google News link is resolved through the
   fetch service (which follows the redirect and reports the final URL) before
   the result is used, and a link that cannot be resolved is dropped, never
   cited. */
function isGoogleNewsUrl(u){ return /(^|\.)news\.google\.com$/i.test(hostOf(u||'')); }
function applyFinalUrl(r, fin){
  r.url=fin; r.finalUrl=fin;
  var dom=hostOf(fin);
  if(dom){ r.domain=dom; r.source=dom; }
  r.favicon='';
}
function resolveNewsLinks(results){
  var jobs=[];
  results.forEach(function(r){
    if(!isGoogleNewsUrl(r.url)) return;
    /* The proxy may already hand back the resolved publisher URL — use it. */
    if(r.finalUrl && /^https?:\/\//i.test(r.finalUrl) && !isGoogleNewsUrl(r.finalUrl)){ applyFinalUrl(r, r.finalUrl); return; }
    jobs.push(fetchPageInfo(r.url).then(function(info){
      var fin=info && info.finalUrl;
      if(fin && /^https?:\/\//i.test(fin) && !isGoogleNewsUrl(fin)) applyFinalUrl(r, fin);
      else r.unresolvableNews=true;
    }));
  });
  if(!jobs.length) return Promise.resolve(results);
  return Promise.all(jobs).then(function(){
    return results.filter(function(r){ return !r.unresolvableNews; });
  });
}
/* Map a proxy-reported upstream status string onto the fail kinds the UI
   already understands (see searchFailMessage). Unknown / ok-ish values
   fall through to 'empty' — the caller never invents a failure. P2 names
   the real status field; this accepts any of status / searchStatus /
   failKind / error / upstreamStatus so the frontend honours it whichever
   name P2 settles on. */
function proxyFailKind(st){
  var s=String(st||'').toLowerCase();
  if(!s || s==='ok' || s==='success' || s==='empty' || s==='no-results' || s==='no_results') return 'empty';
  if(/network|connection|offline|dns|econn|enotfound/.test(s)) return 'network';
  if(/timeout|timed?\s*out|deadline/.test(s)) return 'timeout';
  if(/http\s*[45]\d\d|status\s*[45]\d\d/.test(s)) return 'http';
  return 'unavailable';
}
/* 1) Same-origin search service — its results are used exactly as returned,
   except Google News redirect links, which are resolved to their direct
   publisher URLs first (see resolveNewsLinks above). */
function serverSearch(query, limit){
  /* P6 (v68): the proxy may report its own upstream state explicitly
     (P2 backend: a status / error field on the JSON). Capture it here so
     an empty answer that the proxy itself flags as a failure is never
     reported as a plain "no results" — see the .then below. When the
     proxy exposes no status field, the fail stays 'empty' (provOutcome)
     and aggregateFailKind still never claims the search worked. */
  var proxyStatus='';
  return provOutcome(fetchJSONT(window.EnzoPagesBackend.getSearchUrl('/api/search?q='+encodeURIComponent(query)), 15000).then(function(j){
    var st=j&&typeof j==='object'?(j.status||j.searchStatus||j.failKind||j.error||j.upstreamStatus||''): '';
    if(typeof st==='string' && st) proxyStatus=st;
    var arr=Array.isArray(j)?j:((j&&(j.results||j.items))||[]);
    var out=[];
    arr.forEach(function(r){
      if(!r || !r.url) return;
      var u=String(r.url);
      if(!/^https?:\/\//i.test(u)) return;
      var dom=r.domain?String(r.domain):hostOf(u);
      var snip=String(r.snippet||r.description||'');
      /* Dated news results (Google News via the proxy) carry a real publication
         date and outlet — keep both: "latest / today" answers must be built from
         these, newest first, never from an undated background page. */
      var pub=r.pubDate||r.published||r.date||r.pubdate||'';
      var outlet=r.outlet?String(r.outlet):(r.source?String(r.source):dom);
      var kind=String(r.kind||r.type||'');
      out.push({title:String(r.title||dom||'Web page'), url:u, snippet:snip.slice(0,1000), extract:snip, source:dom||'Web', domain:dom, favicon:r.favicon?String(r.favicon):'', pubDate:pub?String(pub):'', outlet:outlet, isNews:!!(pub||/news/i.test(kind)), finalUrl:r.finalUrl?String(r.finalUrl):''});
    });
    return resolveNewsLinks(out.slice(0, 12));
  })).then(function(o){
    /* P6 (v68): an empty answer the proxy itself flagged as a failure is
       reported with that failure kind, never as plain 'empty'. */
    if(!o.results.length && proxyStatus) o.fail=proxyFailKind(proxyStatus);
    return o;
  });
}
/* Grounding: read a result page's main text through the same-origin /api/fetch.
   This only runs when the search service answered (same-origin deployments);
   on GitHub Pages the browser-side behaviour below is kept. A failed read is
   silent — the result's own snippet still grounds the answer. */
function fetchPageText(url){
  return fetchPageInfo(url).then(function(info){ return info.text; });
}
/* The fetch service reports where the page actually landed (finalUrl). If a
   specific article URL only redirects to the site's generic homepage, that
   page can never support a claim about the article — it is flagged here and
   dropped by the relevance filter, never cited. */
function fetchPageInfo(url){
  return fetchJSONT(window.EnzoPagesBackend.getSearchUrl('/api/fetch?url='+encodeURIComponent(url)), 10000).then(function(j){
    var t=j&&(j.text||j.content||j.extract||j.body);
    var fin=j&&(j.finalUrl||j.final_url||j.url||j.landedUrl);
    return {text:(typeof t==='string'?t:''), finalUrl:(typeof fin==='string'?fin:'')};
  }).catch(function(){ return {text:'', finalUrl:''}; });
}
function noteFetchedPage(r, info){
  if(!info) return;
  /* A Google News redirect that this fetch resolved becomes the direct
     publisher URL; one that did not resolve is marked so the relevance filter
     drops it — a redirect link is never shown or cited. */
  if(isGoogleNewsUrl(r.url)){
    if(info.finalUrl && /^https?:\/\//i.test(info.finalUrl) && !isGoogleNewsUrl(info.finalUrl)) applyFinalUrl(r, info.finalUrl);
    else r.unresolvableNews=true;
  }
  if(info.finalUrl && info.finalUrl!==r.url){
    r.finalUrl=info.finalUrl;
    var origPath=''; var finPath='';
    try{ origPath=new URL(r.url).pathname; finPath=new URL(info.finalUrl).pathname; }catch(e){}
    if(finPath==='/' && origPath && origPath!=='/') r.redirectedHome=true;
  }
  if(info.text && info.text.length>(r.extract||'').length) r.extract=trimAtWord(info.text, 4000);
}
function enrichFromServer(results){
  var jobs=[];
  results.slice(0,4).forEach(function(r){
    jobs.push(fetchPageInfo(r.url).then(function(info){ noteFetchedPage(r, info); }));
  });
  return Promise.all(jobs).then(function(){ return results; });
}
/* Grounding (all providers): after results from every provider are merged, read the
   actual text of the top pages whose extract is still just a short snippet, so the
   answer is written from real page text — not from snippets alone. Uses /api/fetch
   where it exists; where it does not, fetchPageText fails silently and the snippet
   stays as the grounding text. */
function enrichMergedPages(results){
  var jobs=[];
  results.slice(0,6).forEach(function(r){
    if(jobs.length>=4) return;
    if((r.extract||'').length>=800) return;
    jobs.push(fetchPageInfo(r.url).then(function(info){ noteFetchedPage(r, info); }));
  });
  return Promise.all(jobs).then(function(){ return results; });
}

/* P6 (v68): the browser-side provider fallbacks are DELETED — Wikipedia API
   (wikiSearchP), DuckDuckGo Lite (ddgLiteSearchP) and DuckDuckGo Instant
   Answer (ddgSearchP) used to live here. All search now goes through the
   same-origin proxy interface (serverSearch above); see searchOneQuery. */

var PLATFORM_QUERY_WORDS={
  youtube:['youtube','yt','یوٹیوب'],
  instagram:['instagram','انسٹاگرام'],
  facebook:['facebook','fb','فیسبک','فیس بک'],
  tiktok:['tiktok','ٹکٹاک','ٹک ٹاک'],
  x:['twitter','x','ٹویٹر','ایکس'],
  reddit:['reddit','ریڈٹ'],
  linkedin:['linkedin','لنکڈ ان'],
  pinterest:['pinterest','پنٹرسٹ'],
  snapchat:['snapchat','سنیپ چیٹ'],
  telegram:['telegram','ٹیلی گرام'],
  threads:['threads','تھریڈز'],
  vimeo:['vimeo','ویمیو'],
  dailymotion:['dailymotion','ڈیلی موشن'],
  wikipedia:['wikipedia','wiki','وکیپیڈیا']
};
/* Strip surrounding punctuation for comparison only (same punctuation
   set as piece-31 cleanTok): "YouTube," matches "youtube", while
   "youtubers" never does. The original token is kept when it is not
   dropped, punctuation included. */
function cleanPlaceTok(tok){
  return String(tok||'').toLowerCase().replace(/^[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g,'').replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+$/g,'');
}
/* stripPlaceWordFromQuery(query, source) -> query without the tokens
   naming the detected platform place. source is a detectSource canon
   ('youtube', 'instagram', ...) or null/anything else. Returns the
   query unchanged when source is not a platform (google, internet,
   web, news, social, video, null). Whole tokens only, case-insensitive.
   Multi-word forms are matched first, as consecutive whole tokens. */
function stripPlaceWordFromQuery(query, source){
  var forms=PLATFORM_QUERY_WORDS[source];
  if(!forms) return query;
  var toks=String(query||'').split(/\s+/).filter(Boolean);
  if(!toks.length) return query;
  var singles={}, phrases=[], i, f, parts;
  for(i=0;i<forms.length;i++){
    f=forms[i]; parts=String(f).toLowerCase().split(/\s+/);
    if(parts.length>1) phrases.push(parts); else singles[parts[0]]=1;
  }
  var out=[], j, k, len, ok;
  for(i=0;i<toks.length;i++){
    len=0;
    for(j=0;j<phrases.length;j++){
      if(i+phrases[j].length>toks.length) continue;
      ok=true;
      for(k=0;k<phrases[j].length;k++){ if(cleanPlaceTok(toks[i+k])!==phrases[j][k]){ ok=false; break; } }
      if(ok){ len=phrases[j].length; break; }
    }
    if(len){ i+=len-1; continue; }
    if(!singles[cleanPlaceTok(toks[i])]) out.push(toks[i]);
  }
  return out.join(' ');
}
/* stripPlaceWordFromKeywords(keywords, source) -> keywords without the
   tokens naming the detected platform place. Same rule as
   stripPlaceWordFromQuery, applied to a keyword array. */
function stripPlaceWordFromKeywords(keywords, source){
  if(!PLATFORM_QUERY_WORDS[source] || !keywords || !keywords.length) return keywords||[];
  var cleaned=stripPlaceWordFromQuery(keywords.join(' '), source);
  return cleaned?cleaned.split(/\s+/):[];
}

/* --- Deep question understanding: type, intent, keywords --- */
function analyzeQuestion(query){
  var q=(query||'').toLowerCase();
  var type='general';
  if(/\b(what is|kya hai|kya hota|define|meaning|matlab)\b/.test(q)) type='definition';
  else if(/\b(how to|kaise|kis tarah|tareeqa|steps|step by step)\b/.test(q)) type='howto';
  else if(/\b(why|kyun|kyu|wajah|reason)\b/.test(q)) type='why';
  else if(/\b(vs|versus|difference|farq|compare|behtar|best|konsa|which is better)\b/.test(q)) type='comparison';
  else if(/\b(news|khabar|aaj|today|latest|taza|haal|weather|mausam|price|rate|score)\b/.test(q)) type='current';
  else if(/\b(list|top \d|examples|misal|kinds|types|aqsaam)\b/.test(q)) type='list';
  else if(/\b(story|kahani|essay|mazmoon|letter|application|darkhwast|likho|write)\b/.test(q)) type='writing';
  else if(/\b(calculate|hisab|kitna|kitne|solve|hal karo|math|formula)\b/.test(q)) type='solve';
  // core keywords: drop filler, keep meaningful words
  var stop={kya:1,hai:1,hain:1,ka:1,ki:1,ke:1,mein:1,me:1,aur:1,par:1,se:1,ko:1,bhi:1,yeh:1,woh:1,aap:1,mujhe:1,batao:1,bataein:1,samjhao:1,please:1,the:1,is:1,of:1,to:1,in:1,what:1,how:1,why:1,about:1,tell:1,give:1,explain:1};
  var words=q.replace(/[^a-z0-9\u0600-\u06FF\s]/g,' ').split(/\s+/).filter(function(w){ return w.length>2 && !stop[w]; });
  /* FIX 2 (v63): place-word-aware keywords. The platform word is the
     place, not the topic, so it must not reach the proxy as a keyword.
     google / internet / news / null sources change nothing. */
  var src=null;
  try{ src=detectSource(query).source; }catch(e){}
  words=stripPlaceWordFromKeywords(words, src);
  return {type:type, keywords:words.slice(0,6), original:query};
}
var ROMAN_MAP={mehengai:'inflation',badh:'increase',wajah:'reason',wajoohat:'reasons',asal:'real',tareekh:'history',adab:'literature',mausam:'weather',khabar:'news',khabrein:'news',konsa:'which',behtar:'best',behtareen:'best',sasta:'cheap',mehenga:'expensive',qemat:'price',keemat:'price',paise:'money',karobar:'business',talim:'education',sehat:'health',bimari:'disease',ilaj:'treatment',dawai:'medicine',khel:'sports',kitaab:'book',kahan:'where',kidhar:'where',kab:'when',kyun:'why',kyu:'why',kaise:'how',kaisa:'how',kitna:'how much',kitne:'how many',zindagi:'life',duniya:'world',mulk:'country',sheher:'city',gaon:'village',khaana:'food',khaanaa:'food',paani:'water',bijli:'electricity',safar:'travel',nokri:'job',kaam:'work',waqt:'time',din:'day',raat:'night',saal:'year',mahina:'month',hafta:'week',bacha:'child',larka:'boy',larki:'girl',aadmi:'man',aurat:'woman',dost:'friend',ghar:'home',school:'school',computer:'computer',mobile:'mobile phone',internet:'internet',aazadi:'freedom',jang:'war',aman:'peace',mazhab:'religion',siyasat:'politics',hukumat:'government',awaam:'people',kamyabi:'success',nakami:'failure',khushi:'happiness',pareshani:'problem',masla:'problem',hal:'solution',madad:'help',samajh:'understanding',mushkil:'difficult',aasaan:'easy',asaan:'easy',naya:'new',purana:'old',bara:'big',chota:'small',lamba:'long',tez:'fast',ahista:'slow',garmi:'heat',sardi:'cold',barish:'rain',zameen:'earth',aasmaan:'sky',sooraj:'sun',chaand:'moon',sitara:'star',samandar:'sea',darya:'river',pahari:'mountain',jangal:'forest',jaanwar:'animal',parinda:'bird',phool:'flower',darakht:'tree',sabzi:'vegetable',phal:'fruit'};
if(window.EnzoLang45){ try{ ROMAN_MAP=window.EnzoLang45.mergeRomanMap(ROMAN_MAP); }catch(e){} }
function romanToEnglish(query){
  var words=(query||'').toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean);
  var out=[]; var changed=false;
  words.forEach(function(w){ if(ROMAN_MAP[w]){ out.push(ROMAN_MAP[w]); changed=true; } else if(['kya','hai','hain','ka','ki','ke','mein','aur','par','se','ko','bhi','yeh','woh','aap','mera','meri','mere','mujhe','batao','samjhao','hota','hoti','hote','tha','thi','kar','karo','karke','wala','wali','aj','kal','bohat','bohot','acha','theek','nahi','nhi'].indexOf(w)===-1){ out.push(w); } });
  return changed||out.join(' ')!==query.toLowerCase() ? out.join(' ').trim() : '';
}
function expandQueries(query, analysis){
  var src=null;
  try{ src=detectSource(query).source; }catch(e){}
  var cleanQ=stripPlaceWordFromQuery(query, src);
  if(!cleanQ) cleanQ=query;
  var qs=[cleanQ];
  var enQ=stripPlaceWordFromQuery(romanToEnglish(query), src);
  if(enQ && qs.indexOf(enQ)===-1) qs.unshift(enQ); // English version FIRST for Roman Urdu — best search results
  var kw=stripPlaceWordFromQuery((analysis.keywords||[]).join(' '), src);
  var enKw=stripPlaceWordFromQuery(romanToEnglish(kw), src);
  if(enKw && qs.indexOf(enKw)===-1) qs.push(enKw);
  if(kw && kw.toLowerCase()!==cleanQ.toLowerCase() && qs.indexOf(kw)===-1) qs.push(kw);
  if(analysis.type==='definition' && (enKw||kw)) qs.push((enKw||kw)+' definition explained simply');
  if(analysis.type==='howto' && (enKw||kw)) qs.push((enKw||kw)+' step by step guide');
  if(analysis.type==='comparison' && (enKw||kw)) qs.push((enKw||kw)+' comparison pros cons best');
  if(analysis.type==='current') qs.push((enQ||cleanQ)+' latest news today');
  if(analysis.type==='why' && (enKw||kw)) qs.push((enKw||kw)+' reasons causes explained');
  if(analysis.type==='writing' && (enKw||kw)) qs.push((enKw||kw)+' example format');
  var shortQ=(enQ||cleanQ).split(/\s+/).slice(0,4).join(' ');
  if(shortQ && qs.indexOf(shortQ)===-1) qs.push(shortQ);
  return qs.slice(0,5);
}
/* Banned defeat phrases — NEVER shown to the user, in any language */
function scrubDefeat(text){
  if(!text) return text;
  var banned=[/mujhe nahi pata[^\n.!?]*[.!?]?/gi,/mujhe nah(i|in) maloom[^\n.!?]*[.!?]?/gi,/maloomat nahi mili[^\n.!?]*[.!?]?/gi,/maloomat nah(i|in) mil[^\n.!?]*[.!?]?/gi,/is ke baare mein (koi )?maloomat nahi[^\n.!?]*[.!?]?/gi,/I don'?t know[^\n.!?]*[.!?]?/gi,/I do not know[^\n.!?]*[.!?]?/gi,/no information (was |is )?found[^\n.!?]*[.!?]?/gi,/information (was |is )?not found[^\n.!?]*[.!?]?/gi,/couldn'?t find (any )?information[^\n.!?]*[.!?]?/gi,/unable to find[^\n.!?]*[.!?]?/gi,/confirmed information was not found[^\n.!?]*[.!?]?/gi,/معلومات نہیں ملی[^\n۔!?]*[۔!?]?/g,/مجھے نہیں پتا[^\n۔!?]*[۔!?]?/g,/مجھے نہیں معلوم[^\n۔!?]*[۔!?]?/g];
  var t=text; banned.forEach(function(rx){ t=t.replace(rx,''); });
  return t.replace(/\n{3,}/g,'\n\n').trim();
}
function looksDefeat(text){
  var t=(text||'').toLowerCase();
  return t.length<600 && (/nahi pata|nahi mili|don'?t know|not found|no information/.test(t));
}
/* NEVER-ANSWER-WHEN-UNSURE: a lone clarifying question from the model (the
   question had two meanings and nothing settles which one) is a VALID final
   reply, not a failed answer — it must reach the user untouched instead of
   being replaced by a guessed answer. Kept deliberately narrow: one short
   block, ends with a question mark, and names the two meanings. */
function looksClarifyReply(text){
  var s=(text||'').trim();
  if(!s || s.length>260 || /\n\s*\n/.test(s)) return false;
  if(!/\?\s*$/.test(s)) return false;
  return /(aap ka matlab|did you mean|do you mean|kis (kaam|cheez|topic) ki|which (one|meaning) (do|did) you|ya phir)/i.test(s);
}
/* NEVER repeat the question: strip any opening line/sentence that echoes the user's question back.
   The answer must start directly with the main point. */
/* An own-knowledge answer must NEVER claim research that did not happen:
   any sentence claiming a number of websites / sources / pages was
   researched, searched, checked or consulted is removed outright. */
function scrubResearchClaims(text){
  if(!text) return text;
  var pats=[
    /\d[\d,]*\s*(se\s+)?(zyada\s+|more\s+than\s+)?(websites?|web\s?sites?|sites?|sources?|pages?)[^.!\n]{0,60}(research|searched|browsed|checked|consulted|analy[sz]ed|dekhi|dekhe|mile|hasil)/i,
    /(research|searched|browsed|checked|consulted|analy[sz]ed)[^.!\n]{0,70}\d[\d,]*\s*(websites?|web\s?sites?|sites?|sources?|pages?)/i,
    /\d[\d,]*\s*(websites?|web\s?sites?|sites?|sources?)\s*(ki|se|par|pe|par se)\s*research/i,
    /(sau|hundred|thousand|hazar)\s+(se\s+)?(zyada\s+)?(websites?|web\s?sites?|sites?|sources?)[^.!\n]{0,50}research/i,
    /(websites?|web\s?sites?|sources?)\s*(ki|se)\s*(detail\s+)?research\s+(ki|se|hui|hai)/i
  ];
  var parts=String(text).match(/[^.!?।\n]+[.!?।]*\s*/g)||[String(text)];
  var kept=parts.filter(function(s){ return !pats.some(function(p){ return p.test(s); }); });
  var out=kept.join('').replace(/[ \t]+\n/g,'\n').trim();
  return out || 'Live search returned no usable pages for this, so no websites were researched for this answer.';
}
function scrubQuestionEcho(text, query){
  if(!text || !query) return text;
  var original=text;
  function norm(s){ return (s||'').toLowerCase().replace(/["“”'‘’#>*\-]/g,' ').replace(/[?.!,;:]+/g,' ').replace(/\s+/g,' ').trim(); }
  var nq=norm(query);
  if(!nq) return text;
  function isEcho(line){
    var nl=norm(line);
    if(!nl) return true; /* blank line at the top goes too */
    if(nl===nq) return true;
    if(nl.indexOf(nq)>-1 && nl.length<=nq.length+70) return true;
    if(/^(here is|here s|this is) (the )?(short |brief |detailed )?(answer|jawab)( to| for| of)?\b/.test(nl)) return true;
    if(/^(your|the) question\b/.test(nl)) return true;
    if(/^(aap ke|aapka|aap ki|tumhare|tumhara) sawal\b/.test(nl)) return true;
    if(/^jawab (ye hai|yeh hai|hai ke|hai keh)\b/.test(nl) && nl.length<60) return true;
    if(/^آپ کے سوال/.test(line.trim())) return true;
    if(/^سوال/.test(line.trim()) && nl.indexOf(nq)>-1) return true;
    return false;
  }
  var lines=text.split('\n');
  while(lines.length>1 && isEcho(lines[0])) lines.shift();
  text=lines.join('\n').replace(/^\s+/, '');
  /* Also drop a first sentence inside the first line that frames the question, e.g. "Regarding your question about X, ..." */
  var firstBreak=text.indexOf('\n');
  var firstLine=firstBreak===-1?text:text.slice(0,firstBreak);
  var fm=firstLine.match(/^[^.!?]{0,160}(your question|sawal ke baare|question ke baare)[^.!?]*[.!?]\s+/i);
  if(fm) text=(firstLine.slice(fm[0].length)+(firstBreak===-1?'':'\n'+text.slice(firstBreak+1))).replace(/^\s+/,'');
  if(!text.trim() || text.trim().length<25) return original;
  return text;
}
function mergeSources(lists, cap){
  var all=[]; var seen={};
  lists.forEach(function(arr){ (arr||[]).forEach(function(s){ if(s && s.url && !seen[s.url]){ seen[s.url]=1; all.push(s); } }); });
  return all.slice(0, cap);
}

/* ---------- RELEVANCE + CITATION INTEGRITY ----------
   A page may ground an answer only if it is actually about the question, and a
   source may be listed only if the answer actually cites it. These helpers are
   deterministic: they judge the real title / snippet / page text that search
   returned — nothing is invented to make a page look relevant. */
var GENERIC_TERMS={and:1,are:1,was:1,were:1,what:1,when:1,where:1,which:1,who:1,why:1,how:1,the:1,this:1,that:1,these:1,those:1,with:1,from:1,about:1,into:1,your:1,yours:1,today:1,latest:1,current:1,currently:1,news:1,happening:1,happenings:1,compare:1,comparison:1,compared:1,versus:1,difference:1,differences:1,best:1,better:1,worst:1,top:1,list:1,new:1,recent:1,recently:1,research:1,development:1,developments:1,information:1,detail:1,details:1,update:1,updates:1,give:1,tell:1,show:1,find:1,please:1,much:1,many:1,more:1,most:1,thing:1,things:1,explain:1,meaning:1,define:1,definition:1};
function relevanceTerms(query){
  var set={};
  var a=analyzeQuestion(query);
  (a.keywords||[]).forEach(function(w){ if(!GENERIC_TERMS[w]) set[w]=1; });
  /* The English version of a Roman Urdu question carries the searchable terms */
  var enQ=romanToEnglish(query);
  if(enQ){ enQ.split(/\s+/).forEach(function(w){ if(w.length>2 && !GENERIC_TERMS[w]) set[w]=1; }); }
  /* Short or capitalised entities the keyword pass can miss (AI, GTA, ChatGPT…) */
  (query||'').split(/\s+/).forEach(function(w){
    var clean=w.replace(/[^A-Za-z0-9]/g,'');
    if(clean.length>=2 && /[A-Z]/.test(w) && !GENERIC_TERMS[clean.toLowerCase()]) set[clean.toLowerCase()]=1;
  });
  /* Numbers that belong to a named thing ("GTA 6", a code like "8841", a year):
     the keyword pass drops short tokens, but these numbers identify the topic.
     A number counts when it is long (3+ digits) or follows a capitalised word. */
  var rawToks=(query||'').split(/\s+/);
  rawToks.forEach(function(w,i){
    var clean=w.replace(/[^A-Za-z0-9]/g,'');
    if(/^\d+$/.test(clean) && (clean.length>=3 || (i>0 && /[A-Z]/.test(rawToks[i-1])))) set[clean]=1;
  });
  return Object.keys(set);
}
/* A term matches a page when the term itself appears as a whole word, OR its
   well-known expansion does ("GTA" in the question, "Grand Theft Auto" on the
   page), OR — for a number — its roman numeral does ("6" / "VI"). Without
   this, pages that spell a name out in full could never match its short form. */
var TERM_ALIASES={gta:'grand theft auto',ai:'artificial intelligence',usa:'united states',uk:'united kingdom',uae:'united arab emirates'};
var ROMAN_NUM={'1':'i','2':'ii','3':'iii','4':'iv','5':'v','6':'vi','7':'vii','8':'viii','9':'ix','10':'x','11':'xi','12':'xii'};
function termMatches(term, text){
  if(termInText(term, text)) return true;
  if(TERM_ALIASES[term] && text.indexOf(TERM_ALIASES[term])>-1) return true;
  if(/^\d+$/.test(term) && ROMAN_NUM[term] && termInText(ROMAN_NUM[term], text)) return true;
  return false;
}
function termInText(term, text){
  if(!term || !text) return false;
  if(/[^\x00-\x7F]/.test(term)) return text.indexOf(term)>-1;
  var rx=new RegExp('(^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)');
  return rx.test(text);
}
/* ---------- S5 HELPERS — dates, distinctive terms, sentence-safe trimming ----------
   trimAtWord / trimToSentence: text is NEVER cut in the middle of a word, and
   wherever a limit is hit the text ends at the last complete sentence instead. */
function trimAtWord(text, max){
  text=String(text||'');
  if(text.length<=max) return text;
  var cut=text.slice(0,max);
  var sp=Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (sp>max*0.5 ? cut.slice(0,sp) : cut).replace(/\s+$/,'');
}
function trimToSentence(text, max){
  text=String(text||'');
  if(text.length<=max) return text;
  var cut=text.slice(0,max);
  var idx=-1;
  ['. ','! ','? ','.\n','!\n','?\n','। '].forEach(function(sep){ var i=cut.lastIndexOf(sep); if(i>idx) idx=i; });
  if(idx>max*0.35) return cut.slice(0,idx+1);
  return trimAtWord(text, max);
}
/* If a generated answer arrives cut off (it does not end with sentence-ending
   punctuation or a citation), end it at the last complete sentence instead of
   leaving a half word or half sentence on screen. Short closing fragments are
   completed with a full stop rather than deleted. */
function finishAtSentence(text){
  var t=String(text||'').replace(/\s+$/,'');
  if(!t) return t;
  if(/[.!?…]["'”’)\]]?$/.test(t) || /\[\d+\]$/.test(t) || /\|$/.test(t)) return t;
  var lastEnd=-1;
  var m; var rx=/[.!?](\s|$)/g;
  while((m=rx.exec(t))!==null){ lastEnd=m.index; }
  if(lastEnd>-1){
    var frag=t.slice(lastEnd+1).trim();
    if(frag.length>30) return t.slice(0,lastEnd+1);
    if(frag.length) return trimAtWord(t, t.length)+'.';
    return t;
  }
  return trimAtWord(t, t.length)+'.';
}
/* Real dates only: a source's own pubDate first, then a full date written in
   its title / snippet / text. Returns a Date or null — never a guessed date. */
function parseDateValue(v){
  if(!v) return null;
  var d=new Date(v);
  if(!isNaN(d.getTime()) && d.getFullYear()>=2015) return d;
  return null;
}
var MONTH_IDX={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
function datesInText(text){
  var out=[]; var s=String(text||'');
  var m; var rx=/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while((m=rx.exec(s))!==null){ out.push(new Date(parseInt(m[3],10), MONTH_IDX[m[1].toLowerCase()], parseInt(m[2],10))); }
  rx=/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{4})\b/gi;
  while((m=rx.exec(s))!==null){ out.push(new Date(parseInt(m[3],10), MONTH_IDX[m[2].toLowerCase()], parseInt(m[1],10))); }
  rx=/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
  while((m=rx.exec(s))!==null){ out.push(new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10))); }
  var now=Date.now()+2*864e5;
  return out.filter(function(d){ return !isNaN(d.getTime()) && d.getTime()<=now && d.getFullYear()>=2015; });
}
function sourceDate(s){
  var d=parseDateValue(s && s.pubDate);
  if(d) return d;
  var ds=datesInText(((s&&s.title)||'')+' '+((s&&s.snippet)||'')+' '+(((s&&s.extract)||'').slice(0,1500)));
  if(!ds.length) return null;
  return new Date(Math.max.apply(null, ds.map(function(x){ return x.getTime(); })));
}
function newestDatedSource(sources){
  var best=null; var bestD=null;
  (sources||[]).forEach(function(s){ var d=sourceDate(s); if(d && (!bestD || d>bestD)){ bestD=d; best=s; } });
  return best ? {source:best, date:bestD} : null;
}
function fmtDay(d){ try{ return d.toLocaleDateString([], {day:'numeric', month:'long', year:'numeric'}); }catch(e){ return ''; } }
function fmtDayShort(d){ try{ return d.toLocaleDateString([], {day:'numeric', month:'short', year:'numeric'}); }catch(e){ return ''; } }
/* Every source chip shows the source's real publication date when one is known,
   so the reader can see at a glance how current each source is. Undated sources
   show no date — a date is never invented for a chip. */
function srcDateHtml(s){ var d=sourceDate(s); if(!d) return ''; return '<span class="srcchip-date">'+esc(fmtDayShort(d))+'</span>'; }
/* Distinctive terms: the rare words, numbers and names that actually identify
   the question. A page matching only ONE of several distinctive terms — or
   matching a term merely as a substring of another word — is NOT relevant. */
function distinctiveTerms(terms){
  var d=(terms||[]).filter(function(t){ return t.length>=5 || /\d/.test(t); });
  if(!d.length && (terms||[]).length<=2) d=(terms||[]).slice();
  return d;
}
function matchedCount(terms, s){
  var title=((s&&s.title)||'').toLowerCase();
  var body=(((s&&s.snippet)||'')+' '+((s&&s.extract)||'')).toLowerCase();
  var n=0;
  (terms||[]).forEach(function(t){ if(termMatches(t,title) || termMatches(t,body)) n++; });
  return n;
}
function isBareHomepage(u){
  try{ var p=new URL(u); return (p.pathname==='/' || p.pathname==='') && !p.search; }catch(e){ return false; }
}
function sourceRelevance(terms, s){
  var title=(s.title||'').toLowerCase();
  var body=((s.snippet||'')+' '+(s.extract||'')).toLowerCase();
  var score=0; var matched=0;
  terms.forEach(function(t){
    if(termMatches(t,title)){ score+=2; matched++; }
    else if(termMatches(t,body)){ score+=1; matched++; }
  });
  return {score:score, matched:matched};
}
function isCurrentQuestion(query, analysis){
  if(analysis && analysis.type==='current') return true;
  return /\b(today|latest|tonight|breaking|current|currently|news|aaj|haal)\b/i.test(query||'');
}
/* A page counts as current when it comes from a news outlet, or its own text is
   dated / clearly about now (current year, current or previous month, "today",
   "breaking"). Undated background pages never ground a "today / latest" answer. */
function hasCurrencySignal(s){
  /* A real publication date is the strongest signal: fresh within 60 days
     counts as current; a dated-but-old news item does NOT pass as today's. */
  var pd=parseDateValue(s && s.pubDate);
  if(pd) return (Date.now()-pd.getTime()) <= 60*864e5;
  var dom=(s.domain||hostOf(s.url||'')||'').toLowerCase();
  if(/(^|\.)(dawn\.com|geo\.tv|arynews\.tv|tribune\.com\.pk|thenews\.com\.pk|samaa\.tv|dunyanews\.tv|bbc\.com|bbc\.co\.uk|reuters\.com|apnews\.com|aljazeera\.com|cnn\.com|nytimes\.com|theguardian\.com|dw\.com|france24\.com|ndtv\.com|pcmag\.com|theverge\.com|techcrunch\.com|wired\.com|engadget\.com|ign\.com|gamespot\.com|eurogamer\.net|kotaku\.com|polygon\.com|rockstargames\.com|espn\.com|espncricinfo\.com|skysports\.com)$/.test(dom)) return true;
  var txt=((s.title||'')+' '+(s.snippet||'')+' '+(s.extract||'').slice(0,1200));
  var yr=new Date().getFullYear();
  if(txt.indexOf(String(yr))>-1) return true;
  if(/\b(today|tonight|breaking|just in|live updates?)\b/i.test(txt)) return true;
  var months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  var nowM=new Date().getMonth();
  if(new RegExp('\\b('+months[nowM]+'|'+months[(nowM+11)%12]+')\\b').test(txt.toLowerCase())) return true;
  return false;
}
function filterRelevantSources(query, sources){
  var analysis=analyzeQuestion(query);
  var terms=relevanceTerms(query);
  var distinct=distinctiveTerms(terms);
  var numericTerms=terms.filter(function(t){ return /\d/.test(t); });
  var scored=(sources||[]).map(function(s){
    var r=sourceRelevance(terms,s);
    return {s:s, score:r.score, matched:r.matched, distinctMatched:matchedCount(distinct,s)};
  });
  /* Hard exclusions, for every question type: a page whose link only lands on
     a generic homepage, and a bare homepage whose own title says nothing about
     the question's distinctive terms — neither can support a specific claim. */
  scored=scored.filter(function(x){
    if(x.s.redirectedHome) return false;
    /* A Google News redirect link is never a source: resolved news results
       already carry their direct publisher URL, so anything still pointing at
       news.google.com (or flagged unresolvable) is dropped, not cited. */
    if(x.s.unresolvableNews) return false;
    if(isGoogleNewsUrl(x.s.url)) return false;
    if(isBareHomepage(x.s.url) && matchedCount(distinct.length?distinct:terms, {title:x.s.title, snippet:'', extract:''})===0) return false;
    return true;
  });
  var kept;
  if(!terms.length){ kept=scored; }
  else if(analysis.type==='comparison'){
    /* A comparison page must be about one of the named items (in its title) or
       discuss at least two of them. A page about something else entirely —
       shipping software, a different product — can never ground a comparison. */
    kept=scored.filter(function(x){
      var titleHit=terms.some(function(t){ return termMatches(t,(x.s.title||'').toLowerCase()); });
      return titleHit || x.matched>=2;
    });
  } else {
    kept=scored.filter(function(x){
      /* A number in the question (a year, a code, "8841") must actually appear
         in the page — a page without it is about something else. */
      if(numericTerms.length && matchedCount(numericTerms, x.s)===0) return false;
      /* Several distinctive terms: matching just one of them — e.g. a single
         rare word inside a long multi-word query — is not relevance. */
      if(distinct.length>=2) return x.distinctMatched>=2;
      if(distinct.length===1) return x.distinctMatched>=1 && (x.matched>=2 || x.score>=2 || terms.length===1);
      return x.score>=2 || x.matched>=2 || (terms.length===1 && x.matched>=1);
    });
  }
  var currencyFallback=false;
  if(isCurrentQuestion(query, analysis) && kept.length){
    /* "Today / latest" questions prefer dated, current pages — but the filter
       must NEVER empty a result set that has on-topic pages. If no dated or
       current page survives, the best on-topic pages are kept and the answer
       says honestly that no current-dated pages were found (the caller reads
       currencyFallback / newestDateSeen off the returned array). "No usable
       results" is only for when NO on-topic page exists at all. */
    var dated=kept.filter(function(x){ return hasCurrencySignal(x.s); });
    if(dated.length){ kept=dated; }
    else currencyFallback=true;
  }
  var current=isCurrentQuestion(query, analysis);
  kept.sort(function(a,b){
    if(current){
      var da=sourceDate(a.s); var db=sourceDate(b.s);
      if(da && db && da.getTime()!==db.getTime()) return db-da;
      if(da && !db) return -1;
      if(!da && db) return 1;
      if(!!b.s.isNews!==!!a.s.isNews) return (b.s.isNews?1:0)-(a.s.isNews?1:0);
    }
    return b.score-a.score;
  });
  var out=kept.map(function(x){ return x.s; });
  var nd=newestDatedSource(out);
  out.currencyFallback=currencyFallback;
  out.newestDateSeen=nd?nd.date:null;
  out.newestDatedSource=nd?nd.source:null;
  return out;
}
/* Citation integrity: keep only citations that point at a real source in the
   list, renumber them in the order they first appear in the text, and reduce
   the source list to exactly the sources the answer cites — in citation order.
   A source that is never cited is never listed; a citation that points at no
   real source is removed from the text. */
function validateCitations(text, sources){
  if(!sources || !sources.length) return {text:text, sources:[], cited:false};
  var order=[]; var seen={};
  (text||'').replace(/\[(\d+)\]/g, function(full, n){
    var idx=parseInt(n,10);
    if(idx>=1 && idx<=sources.length && !seen[idx]){ seen[idx]=1; order.push(idx); }
    return full;
  });
  if(!order.length) return {text:text, sources:sources, cited:false};
  var remap={}; order.forEach(function(oldIdx,i){ remap[oldIdx]=i+1; });
  var newText=(text||'').replace(/\[(\d+)\]/g, function(full, n){
    var idx=parseInt(n,10);
    return remap[idx] ? '['+remap[idx]+']' : '';
  }).replace(/ +([.,;:!?])/g,'$1');
  var newSources=order.map(function(oldIdx){ return sources[oldIdx-1]; });
  return {text:newText, sources:newSources, cited:true};
}
/* Every paragraph that makes factual claims must carry a citation — including
   the opening summary and the closing recommendation. Deterministic pass over
   the model's text: a paragraph with no citation gets the citation of the page
   whose real text it overlaps most; a paragraph no page supports is marked
   plainly as opinion instead of being dressed up with an invented citation. */
function ensureParagraphCitations(text, sources){
  if(!sources || !sources.length || !text) return text;
  function bestSourceFor(txt){
    var words={};
    ((txt||'').toLowerCase().match(/[a-z0-9][a-z0-9\-]{3,}/g)||[]).forEach(function(w){ if(!GENERIC_TERMS[w]) words[w]=1; });
    var ws=Object.keys(words);
    if(!ws.length) return 0;
    var best=0; var bestScore=0;
    sources.forEach(function(s,i){
      var hay=((s.title||'')+' '+((s.extract||s.snippet||''))).toLowerCase();
      var sc=0;
      ws.forEach(function(w){ if(termInText(w,hay)) sc++; });
      if(sc>bestScore){ bestScore=sc; best=i+1; }
    });
    return bestScore>=2 ? best : 0;
  }
  var inCode=false;
  return text.split('\n').map(function(line){
    var t=line.trim();
    if(/^```/.test(t)){ inCode=!inCode; return line; }
    if(inCode || !t) return line;
    if(/^#{1,4}\s/.test(t) || /^\|/.test(t) || /^---+$/.test(t)) return line;
    if(/\[\d+\]/.test(t)) return line;
    var isList=/^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t);
    var best=bestSourceFor(t);
    if(best) return line.replace(/\s+$/,'')+' ['+best+']';
    if(!isList && t.length>40) return 'Opinion: '+line;
    return line;
  }).join('\n');
}
/* Extractive grounded answer: built line-by-line from the retrieved pages
   themselves, so every line carries the citation of the page it came from.
   Returns the sources it actually cited — nothing more is ever listed. */
function groundedFallback(query, sources, lang, deep){
  var usable=(sources||[]).filter(function(s){ return (s.extract||s.snippet||'').trim().length>25; });
  var used=usable.slice(0, deep?8:4);
  if(!used.length) return {html:'', plain:'', sources:[]};
  function num(s){ return used.indexOf(s)+1; }
  var bullets=used.map(function(s){
    /* Raised limits + sentence-safe trimming: a bullet ends at a complete
       sentence, never in the middle of a word. Dated news items lead with
       their real date and outlet. */
    var txt=trimToSentence((s.extract||s.snippet).replace(/\s+/g,' '), deep?640:440);
    var d=sourceDate(s);
    var lead=(s.isNews && d) ? '<b>'+esc(fmtDay(d))+(s.outlet?' — '+esc(s.outlet):'')+':</b> ' : '';
    return '<li>'+lead+esc(txt)+' <span class="cite">['+num(s)+']</span></li>';
  }).join('');
  var paras = deep ? used.filter(function(s){ return s.extract; }).slice(0,4).map(function(s){
    return '<p><b>'+esc(s.title)+':</b> '+esc(trimToSentence((s.extract||'').replace(/\s+/g,' '), 820))+' <span class="cite">['+num(s)+']</span></p>';
  }).join('') : '';
  var h='<ul>'+bullets+'</ul>';
  if(paras) h+=(lang==='urdu'?'<h3>اہم تفصیل</h3>':(lang==='roman'?'<h3>Ahem Tafseel</h3>':'<h3>Key Details</h3>'))+paras;
  return {html:h, plain:stripHtml(h), sources:used};
}
/* Turn the recorded provider failures into one honest reason.
   P6 (v68): the old rule — "a provider that answered, even with zero
   results, proves the search itself worked" — is DELETED. An empty
   answer proves nothing about whether the search itself worked (an
   upstream 202 / empty leg looks exactly like "no results" from here),
   so it must never override a real error: any network / http / timeout
   failure in the list decides the kind, and 'empty' is returned only
   when EVERY recorded leg came back empty with no error at all. */
function aggregateFailKind(fails){
  var list=fails||[];
  var real=list.filter(function(f){ return f && f!=='empty'; });
  if(real.length){
    if(real.every(function(f){ return f==='network'; })) return 'connection';
    return 'unavailable';
  }
  return 'empty';
}
/* One query through the whole pipeline: the same-origin search service ONLY
   (v68 P6 — the browser fallback chain is deleted; see file header).
   Resolves {results, fails} — rejects only when aborted. When the proxy
   returns nothing, that empty answer is returned honestly with its fail
   kind; no other provider is consulted. withUrdu is kept for caller
   compatibility and ignored — the proxy owns language handling. */
function searchOneQuery(query, limit, withUrdu){
  var cleanQ=query;
  try{ cleanQ=stripPlaceWordFromQuery(query, detectSource(query).source); }catch(e){}
  if(!cleanQ) cleanQ=query;
  return serverSearch(cleanQ, limit).then(function(so){
    if(so.results.length){
      return enrichFromServer(so.results).then(function(rs){ return {results:rs, fails:[]}; });
    }
    return {results:[], fails:[so.fail]};
  });
}
var searchPromiseCache={};
function searchWeb(query, deep){
  /* Never two searches for the same question at once — reuse the live one */
  var key=(deep?'deep:':'norm:')+(query||'').toLowerCase();
  if(searchPromiseCache[key]) return searchPromiseCache[key];
  var analysis=analyzeQuestion(query);
  var queries=expandQueries(query, analysis);
  var limit = deep?8:5;
  var jobs=queries.map(function(qq, idx){ return searchOneQuery(qq, idx===0?limit:5, idx===0); });
  var p=Promise.all(jobs).then(function(outs){
    var all=mergeSources(outs.map(function(o){ return o.results; }), deep?18:10);
    /* Only real pages actually returned by the search may ever be sources. Nothing
       synthetic is added here — no search-engine query pages, no invented snippets.
       When too few real pages come back, the answer flow shows the honest
       failure notice (with the real reason) and attaches zero sources. */
    all.liveCount=all.length;
    var fails=[]; outs.forEach(function(o){ (o.fails||[]).forEach(function(f){ fails.push(f); }); });
    all.failKind = all.length ? 'none' : aggregateFailKind(fails);
    /* Read the real text of the top merged pages before anyone answers from them */
    return enrichMergedPages(all).then(function(){ return all; });
  });
  searchPromiseCache[key]=p;
  function done(){ if(searchPromiseCache[key]===p) delete searchPromiseCache[key]; }
  p.then(done, done);
  return p;
}
/* Search failure handling — the message says what actually happened, the answer
   below it stays honestly labelled as ENZO's own knowledge, and Retry Search
   re-runs the exact same question. */
function searchFailMessage(kind){
  if(kind==='connection') return 'Unable to connect to the search service. Please check your connection and try again.';
  if(kind==='unavailable') return 'The search service is temporarily unavailable. Please try again later.';
  return 'Live search could not find usable pages this time, even after several automatic searches with different queries. Tap Retry Search to run the whole expanded search again.';
}
function searchFailNoticeHtml(kind){
  return '<div class="notice-warn"><p style="margin:0 0 8px">'+esc(searchFailMessage(kind))+'</p><p style="margin:0 0 10px">No web sources are attached to this answer — it was written from ENZO\'s own knowledge.</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
}

