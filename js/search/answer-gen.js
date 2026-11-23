/* ---------- ANSWER GENERATION ---------- */
function langInstrFor(lang){
  if(window.EnzoLang45 && window.EnzoLang45.langInstrFor) return window.EnzoLang45.langInstrFor(lang);
  if(lang==='urdu') return 'Answer ONLY in Urdu script (clear, Nastaliq-friendly Urdu). Never switch to English except names/terms.';
  if(lang==='roman') return 'Answer ONLY in Roman Urdu — Urdu written in English letters, warm, easy and friendly, like explaining to a close friend. NEVER answer in English sentences and NEVER in Urdu script. Example style: "Dekhein, is sawal ka seedha jawab ye hai ke..."';
  return 'Answer ONLY in simple, clear English.';
}
function typeGuidance(type){
  if(type==='definition') return 'Structure: the definition in 1-2 lines, one short clarifying line, one quick example. Nothing more.';
  if(type==='howto') return 'Structure: the steps only, numbered, one short line each. No long intro, no extra commentary.';
  if(type==='why') return 'Structure: the main reason first in one line, then the 3-5 key reasons as short bullets, one line each. No essay, no conclusion paragraph.';
  if(type==='comparison') return 'Structure: a REAL side-by-side comparison — never a set of separate definitions. One-line verdict first. Then compare the named items dimension by dimension: for each dimension the retrieved pages actually discuss (what each is best at, strengths, weaknesses, speed, quality, price or limits, ease of use), state how EACH named item compares on that dimension, with a citation on every comparative claim. A markdown table (Dimension | item | item | item) is welcome when the pages support it. Then one short strengths/weaknesses line per item, each cited. Then a one-line recommendation — cited, or clearly marked as opinion.';
  if(type==='current') return 'Structure: the latest key points only, as short bullets. No background essay.';
  if(type==='list') return 'Structure: the list only — one short line per item, no extra paragraphs.';
  if(type==='writing') return 'Structure: deliver the actual written piece the user asked for, ready to use, with a one-line intro. (Writing pieces are the exception to the short-answer rule — deliver them complete.)';
  if(type==='solve') return 'Structure: solve step by step briefly, show the working, give the final answer clearly at the end.';
  return 'Structure: the direct answer in the first 1-2 lines, then at most 3-5 short supporting bullets. Stop there — no extra sections, no conclusion paragraph.';
}
function buildPrompt(query, sources, lang, deep, historyText, fresh){
  var analysis=analyzeQuestion(query);
  var enQ=romanToEnglish(query);
  var nowTl=timeLabelFor(Date.now());
  var current=isCurrentQuestion(query, analysis);
  var srcText = sources.map(function(s,i){
    var d=sourceDate(s);
    var meta=(s.domain||hostOf(s.url)||'Web')+(s.isNews&&s.outlet?' • '+s.outlet:'')+(d?' • published '+fmtDay(d):'');
    return '['+(i+1)+'] '+s.title+' ('+meta+')\n'+trimAtWord((s.extract||s.snippet||'').replace(/\s+/g,' '), deep?1500:1100);
  }).join('\n\n');
  var style = deep ? 'Write a LONG, detailed research report with headings: ## Introduction, ## Key Details, ## Deep Analysis, ## Different Views / Pros and Cons, ## Practical Advice, ## Conclusion. Use bullet points and examples. Put citations throughout the report — in EVERY section and EVERY paragraph that states facts, including the Introduction, the summary and the Conclusion — not only in a list at the end. A closing recommendation must either cite the facts it rests on or be written as a clearly marked opinion (start it with "My recommendation (opinion):") containing no new factual claims. DEPTH STANDARD: gather from MANY sources, never one or two; cross-check every key claim against more than one source where the pages allow it; when sources disagree, present the different viewpoints side by side instead of silently picking one; give the full detail the user asked for, organised under clear headings; and end with a short "What could not be verified" note listing anything the retrieved pages did not confirm.' : 'Write a SHORT answer — the main point only, in a few lines. At most one short paragraph plus up to 4-5 one-line bullets. No headings, no essay, no padding. Every paragraph and every bullet that states a fact must end with its citation. '+typeGuidance(current?'current':analysis.type);
  var focus='';
  if(analysis.type==='comparison') focus=' FOCUS — COMPARISON: this must be a genuine side-by-side comparison, NOT one separate definition per item. Compare the named items on real dimensions drawn from the retrieved pages — differences, strengths, weaknesses, and what each is best at — and put a citation on EVERY comparative claim (every table cell and every bullet). If the retrieved text says nothing about one named item, or nothing about a dimension, say that plainly instead of guessing about it. The opening summary paragraph and the final recommendation paragraph must ALSO carry citations for every fact they state — or the recommendation must be phrased as a clearly marked opinion ("My recommendation (opinion): ...") with no factual claims in it.';
  else if(current){
    focus=' FOCUS — TODAY / LATEST: build the answer from the DATED NEWS results first — lead with the newest dated items, newest first, and show each item\'s date and outlet in the answer. Never present undated background (for example a Wikipedia overview) as today\'s news, and never answer a "latest / today" question with a single background sentence.';
    if(fresh && fresh.fallback) focus+=' HONESTY FOR THIS ANSWER: no current-dated pages were found among the results. Your FIRST line must say exactly that — that no current-dated pages were found — and state the newest date actually seen in the results'+(fresh.newestText?(' ('+fresh.newestText+')'):'')+', then give the best on-topic information the pages do contain, with citations.';
    else if(fresh && fresh.stale) focus+=' HONESTY FOR THIS ANSWER: the dated news results are NOT fresh — the newest dated item is from '+fresh.newestText+'. Your FIRST line must say plainly that no fresh news was found and give that newest date; do not present those older items as today\'s news.';
    else if(fresh && fresh.newestText) focus+=' The newest dated item in the results is from '+fresh.newestText+' — lead with the newest items.';
  }
  return EnzoIdentity.withIdentity('You are ENZO AI — a highly intelligent, warm research companion. SILENT TIME MEMORY (very important): '+timeContextString(new Date())+' You always KNOW the current date, time and part of day, and every previous message below carries its own timestamp in [brackets] — but this knowledge stays SILENT. NEVER mention the time, the date, the part of day, or when a question was asked in your answer. Only speak about time if the user explicitly asks about it (for example: when did we talk about this, what time is it, ye kab bola tha) — then answer from the timestamps exactly. GROUNDING RULES — these override every other instruction: (1) Answer ONLY from the retrieved page text below. Use ONLY facts, names, numbers, dates, versions, prices and quotes that actually appear in that text. (2) EVERY factual claim must carry the citation of the page whose text contains that claim — [1], [2] and so on — placed right after the claim. Never write a factual claim without its citation, and never cite a page for something its text does not say. (3) NEVER add facts from your own memory, never guess, never merge pages into a claim none of them makes, and NEVER state a date, version number, release, price or "latest" development unless those exact details appear in the retrieved text. (4) If the retrieved text does not cover the question, or does not cover part of it, say that plainly in one short line (for example: "The pages found do not cover this.") and answer only the part the text does cover — do not fill gaps with invention. (5) Answer the exact question asked. (9) UNDERSTANDING RULE: if the question itself is ambiguous between two clear meanings and the retrieved text does not settle which one is meant, do NOT pick one silently and do NOT guess — reply with ONLY one short clarifying question naming both meanings, nothing else: no answer, no citations. This clarifying-question exception applies ONLY when the local intent classifier (classifyIntent, intent.kind) has marked this message kind \'clarify\'; for every decided kind (research, definition, conversation, general) answer directly and never reply with a lone clarifying question. (7) NEVER INVERT A SOURCE: state every change, decision or direction exactly as the cited page text states it. If the page says something is getting stronger, rising, banned, delayed, rejected or still in place, your claim must say the same — never the opposite (never "lifted" when the page says "getting even stronger", never "approved" when the page says "rejected", never "fell" when the page says "rose"). Before writing any claim about a change, a ban, an approval, a price move or a decision, check the page\'s own verbs and negations and copy their direction.'+focus+' (6) NEVER REPEAT THE QUESTION: never quote, restate, paraphrase or even mention the question anywhere in the answer — no "your question about…", no "aap ke sawal…", no "here is the answer to…", and never use the question as a heading or opening line. Your VERY FIRST line must be the answer itself — the main point, immediately, nothing before it. '+langInstrFor(lang)+' '+style+'\nQuestion type: '+analysis.type+(enQ?'\nEnglish meaning of the question (for your understanding): '+enQ:'')+'\n\nCurrent moment: '+nowTl.full+'\n\nPrevious conversation (each line starts with when it happened):\n'+historyText+'\n\nQuestion (asked now, '+nowTl.full+'): '+query+'\n\nRetrieved pages (the ONLY facts you may use):\n'+srcText+'\n\nIf the user asked for platform work (a gig, proposal, profile, post, reply draft, SEO plan or article), deliver the complete ready-to-use work step by step in full detail, state plainly the one final step that needs the user\'s own login or tap, and never claim you posted, published, sent or uploaded anything. NEVER REFUSE ORDERED WORK: never refuse an order and never give up on it — if one route is blocked, use another route; if something is genuinely impossible right now, state the exact blocker and exactly what you need from the user, and continue the moment the user provides it. Now write the answer, grounded only in those pages, with a citation after every factual claim:');
}
function buildKnowledgePrompt(query, lang, deep, historyText){
  var analysis=analyzeQuestion(query);
  var enQ=romanToEnglish(query);
  var nowTl=timeLabelFor(Date.now());
  var style = deep ? 'Write a LONG, detailed report with headings: ## Introduction, ## Key Details, ## Deep Analysis, ## Examples, ## Practical Advice, ## Conclusion. Use bullets.' : 'Write a SHORT answer — the main point only, in a few lines: one short paragraph and at most 4-5 one-line bullets. No headings, no essay. Detail only when the user asks a follow-up. '+typeGuidance(analysis.type);
  return EnzoIdentity.withIdentity('You are ENZO AI — a highly intelligent, warm companion with broad knowledge of the world: science, history, Pakistan and world affairs, Islam, technology, business, health basics, education, sports, everyday life, everything. SILENT TIME MEMORY (very important): '+timeContextString(new Date())+' You always KNOW the current date, time and part of day, and every previous message below carries its timestamp in [brackets] — but keep this knowledge SILENT: NEVER mention the time, date, part of day, or when something was asked in your answer, unless the user explicitly asks about time or when a conversation happened — then answer from those timestamps exactly. GOLDEN RULES: (1) When the question is clear, answer confidently from your knowledge and reasoning — briefly, main point first. (2) UNDERSTANDING RULE — this overrides everything else: if the question is unclear, ambiguous, has two plausible meanings, names no concrete topic, or contains a typo that changes its meaning, do NOT guess and do NOT answer it — reply with ONLY one short clarifying question that names the two most likely meanings, so the user can answer in one word. This exception applies ONLY when the local intent classifier (classifyIntent, intent.kind) has marked this message kind \'clarify\'; for every decided kind (research, definition, conversation, general) answer directly and never reply with a lone clarifying question. Never fill a gap in understanding with your own knowledge presented as fact. (3) If the question is in Roman Urdu, understand its meaning (English meaning given below) and think in English, then answer in Roman Urdu. (4) For fast-changing facts (prices, scores, news, release dates, versions as of today) NEVER present invented or guessed specifics as current facts: give only the most recent picture you genuinely know, make clear it comes from your own knowledge and may have changed, and never invent a date, version number, release or price. (6) NEVER claim that you searched, browsed, researched, checked or consulted any websites, pages or sources, and NEVER state any number of websites or sources — this answer comes ONLY from your own knowledge. If the user asked for research from a certain number of websites, do NOT repeat that number as if the research happened; simply answer the topic itself, briefly. (5) NEVER REPEAT THE QUESTION: never quote, restate, paraphrase or even mention the question anywhere in the answer — no "your question about…", no "aap ke sawal…", no "here is the answer to…", and never use the question as a heading or opening line. Your VERY FIRST line must be the answer itself — the main point, immediately, nothing before it. '+langInstrFor(lang)+' '+style+'\nQuestion type: '+analysis.type+(enQ?'\nEnglish meaning of the question: '+enQ:'')+'\n\nCurrent moment: '+nowTl.full+'\n\nPrevious conversation (each line starts with when it happened):\n'+historyText+'\n\nQuestion (asked now, '+nowTl.full+'): '+query+'\n\nPLATFORM WORK RULE: when the user asks for work on any platform (Fiverr, Upwork, Freelancer, TikTok, YouTube, Instagram, Facebook, a website, or any other) — a gig, proposal, profile, post, reply draft, SEO audit, keyword plan, article prepared for upload, or anything else — produce the COMPLETE ready-to-use work, step by step and in full detail, in the user\'s language: the actual finished text they can paste and use, not advice about writing it. End by stating plainly the one final step that needs the user\'s own login or tap (such as posting or publishing it) — and NEVER claim you posted, published, sent or uploaded anything yourself.\n\nNEVER REFUSE ORDERED WORK (the most important behaviour rule): when the user orders work, never refuse, never say you will not do it, and never give up on it. Always try: if one route is blocked, find another route; if something is genuinely impossible right now, say exactly what is blocking it and exactly what you need from the user, and continue the moment the user provides it. Never stall silently and never hide behind a refusal.\n\nWrite your best, complete answer now:');
}
function callAIOnce(prompt, model){
  /* The prompt travels in the POST BODY — never in a URL. A prompt carries
     the user's question, conversation history and attached-file text; none
     of that may sit in a request line where servers and proxies log it. */
  var ctl=('AbortController' in window)?new AbortController():null;
  var to=ctl?setTimeout(function(){ ctl.abort(); },45000):null;
  return fetch('https://text.pollinations.ai/', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:model||'openai', messages:EnzoIdentity.buildMessages(prompt)}), signal:ctl?ctl.signal:undefined}).then(function(r){ if(to) clearTimeout(to); if(!r.ok) throw new Error('ai'); return r.text(); }).then(function(t){
    t=(t||'').trim();
    if(!t || t.length<40) throw new Error('empty');
    if(/pollinations|powered by|🌸/i.test(t.slice(-300)) && t.length<200) throw new Error('junk');
    t=scrubDefeat(t);
    if(!t || t.length<30 || looksDefeat(t)) throw new Error('defeat');
    return t;
  });
}
function callAI(prompt){
  // Retry chain across free models — one of them almost always answers
  return callAIOnce(prompt,'openai').catch(function(){ return callAIOnce(prompt,'openai'); })
    .catch(function(){ return new Promise(function(res){ setTimeout(res,700); }).then(function(){ return callAIOnce(prompt,'openai'); }); });
}
function callAIKnowledge(query, lang, deep, historyText){
  var p=buildKnowledgePrompt(query, lang, deep, historyText);
  /* GUFTAGU OVERRIDE (locked rule 49): everyday conversation is answered
     directly — the UNDERSTANDING RULE does not apply to it. */
  if(isGuftagu(query)) p+='\n\nGUFTAGU OVERRIDE — this message is everyday conversation, NOT a research task and NOT an unclear instruction. For this message the UNDERSTANDING RULE above does not apply: answer directly, warmly and briefly from your own knowledge. NEVER reply with a clarifying question, never ask whether to research or anything else, and never mention research or investment. If it asks what something is or what it is called, simply explain it in plain words.';
  return callAIOnce(p,'openai').catch(function(){ return callAIOnce(p,'openai'); });
}

function fallbackAnswer(query, sources, lang, deep){
  // Short, clean, professional answer built from the sources. Never mentions time. Never an empty/defeat reply.
  var usable=sources.filter(function(s){return (s.extract||s.snippet||'').trim().length>25;});
  var bullets = usable.slice(0, deep?8:4).map(function(s,i){
    var txt=trimToSentence((s.extract||s.snippet).replace(/\s+/g,' '), deep?640:440);
    return '<li>'+esc(txt)+' <span class="cite">['+(sources.indexOf(s)+1)+']</span></li>';
  }).join('');
  var paras = deep ? usable.filter(function(s){return s.extract}).slice(0,4).map(function(s,i){
    return '<p><b>'+esc(s.title)+':</b> '+esc(trimToSentence((s.extract||'').replace(/\s+/g,' '), 820))+' <span class="cite">['+(sources.indexOf(s)+1)+']</span></p>';
  }).join('') : '';
  var h='';
  /* The answer starts directly with the main point — the question is NEVER repeated or quoted here.
     With no usable source text there is NO answer here at all: an empty string,
     never a bare template line ("Here is the clearest short answer…" with no
     content under it). Callers turn the empty string into the honest failure
     notice with a working Retry Search button. */
  if(lang==='urdu'){
    if(bullets) h+='<ul>'+bullets+'</ul>';
    if(paras) h+='<h3>اہم تفصیل</h3>'+paras;
  } else if(lang==='roman'){
    if(bullets) h+='<ul>'+bullets+'</ul>';
    if(paras) h+='<h3>Ahem Tafseel</h3>'+paras;
  } else {
    if(bullets) h+='<ul>'+bullets+'</ul>';
    if(paras) h+='<h3>Key Details</h3>'+paras;
  }
  return h;
}

function highlightCode(code){
  var h=esc(code);
  h=h.replace(/(\/\/[^\n]*|#[^\n]*)/g,'<span class="tok-com">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g,'<span class="tok-str">$1</span>');
  h=h.replace(/\b(function|return|var|let|const|if|else|for|while|class|import|from|def|print|new|try|catch|await|async|public|static|void|int|true|false|null|None|True|False)\b/g,'<span class="tok-kw">$1</span>');
  h=h.replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="tok-num">$1</span>');
  return h;
}
/* Math: input is already HTML-escaped text. Fractions, roots, powers, subscripts and common symbols become readable notation. */
function formatMath(h){
  h=h.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'($1)/($2)');
  h=h.replace(/\\sqrt\{([^{}]+)\}/g,'√($1)');
  h=h.replace(/\^\{([^{}]+)\}/g,'<sup>$1</sup>').replace(/_\{([^{}]+)\}/g,'<sub>$1</sub>');
  h=h.replace(/\^([A-Za-z0-9])/g,'<sup>$1</sup>').replace(/_([A-Za-z0-9])/g,'<sub>$1</sub>');
  var sym={alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',sigma:'σ',omega:'ω',Delta:'Δ',infty:'∞',times:'×',div:'÷',pm:'±',leq:'≤',geq:'≥',neq:'≠',approx:'≈',rightarrow:'→',leftarrow:'←'};
  h=h.replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|infty|times|div|pm|leq|geq|neq|approx|rightarrow|leftarrow)\b/g,function(m,g){ return sym[g]||g; });
  return h;
}
function mdToHtml(md){
  // markdown -> html: headings, bullets, numbered lists, tables, code blocks with copy, inline code, bold, citations
  var lines=(md||'').split('\n'); var html=''; var listType=null; var inCode=false; var codeBuf=[]; var tableBuf=[];
  function inline(t){ return esc(t).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\[(\d+)\]/g,'<span class="cite">[$1]</span>').replace(/\$([^$\n]+)\$/g,function(m,g){ return '<span class="math">'+formatMath(g)+'</span>'; }); }
  function closeList(){ if(listType){ html+='</'+listType+'>'; listType=null; } }
  function flushTable(){
    if(!tableBuf.length) return;
    var rows=tableBuf.filter(function(r){ return !/^\|?[\s:|-]+\|?$/.test(r.trim()); });
    tableBuf=[];
    if(!rows.length) return;
    html+='<table>';
    rows.forEach(function(r,ri){
      var cells=r.trim().replace(/^\||\|$/g,'').split('|').map(function(c){ return c.trim(); });
      html+='<tr>'+cells.map(function(c){ return ri===0?'<th>'+inline(c)+'</th>':'<td>'+inline(c)+'</td>'; }).join('')+'</tr>';
    });
    html+='</table>';
  }
  function flushCode(){
    html+='<div class="codeblock"><button class="codecopy" type="button">Copy code</button><pre><code>'+highlightCode(codeBuf.join('\n'))+'</code></pre></div>';
    codeBuf=[];
  }
  lines.forEach(function(line){
    var t=line.trim();
    if(/^```/.test(t)){ if(inCode){ flushCode(); inCode=false; } else { closeList(); flushTable(); inCode=true; } return; }
    if(inCode){ codeBuf.push(line); return; }
    if(/^\|.*\|$/.test(t)){ closeList(); tableBuf.push(line); return; }
    flushTable();
    if(/^\$\$.*\$\$$/.test(t)){ closeList(); html+='<div class="math-block">'+formatMath(esc(t.slice(2,-2).trim()))+'</div>'; }
    else if(/^#{1,3}\s/.test(t)){ closeList(); var hl=t.match(/^#+/)[0].length; var htag=hl===1?'h2':(hl===2?'h3':'h4'); html+='<'+htag+'>'+inline(t.replace(/^#{1,3}\s/,''))+'</'+htag+'>'; }
    else if(/^[-*•]\s/.test(t)){ if(listType!=='ul'){ closeList(); html+='<ul>'; listType='ul'; } html+='<li>'+inline(t.replace(/^[-*•]\s/,''))+'</li>'; }
    else if(/^\d+[.)]\s/.test(t)){ if(listType!=='ol'){ closeList(); html+='<ol>'; listType='ol'; } html+='<li>'+inline(t.replace(/^\d+[.)]\s/,''))+'</li>'; }
    else if(/^>\s/.test(t)){ closeList(); html+='<p style="border-left:3px solid var(--accent);padding-left:12px;color:var(--muted)">'+inline(t.replace(/^>\s/,''))+'</p>'; }
    else if(t===''){ closeList(); }
    else { closeList(); html+='<p>'+inline(t)+'</p>'; }
  });
  if(inCode) flushCode();
  flushTable(); closeList();
  return html;
}

function makeFollowups(query, lang){
  if(window.EnzoLang47 && window.EnzoLang47.followups47) return window.EnzoLang47.followups47(lang);
  if(lang==='urdu') return ['اس کی مزید تفصیل بتائیں','اس کے فائدے اور نقصان کیا ہیں؟','اس کی ایک آسان مثال دیں'];
  if(lang==='roman') return ['Is ki mazeed tafseel batao','Is ke fayde aur nuqsan kya hain?','Is ki ek asaan misal do'];
  return ['Tell me more detail about this','What are the pros and cons?','Give me a simple example'];
}

/* ---------- P-C — LIVE TASK CHECKLIST (brief §5.7) ----------
   Real states only: Pending, Running, Completed, Failed, Waiting for Permission,
   Paused, Cancelled. A step shows Completed only after the pipeline has actually
   moved past it; no progress percentage is ever shown or invented. */
var TASK_STATES={pending:'Pending',running:'Running',completed:'Completed',failed:'Failed',waiting:'Waiting for Permission',paused:'Paused',cancelled:'Cancelled'};
var pcTask={steps:[],states:[],starts:[],ends:[],research:false,decision:''};
function taskIconHtml(st){
  if(st==='completed') return '<span class="task-ic" style="background:#22C55E;color:#fff"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6 9.8 17.9 19.5 6.4"/></svg></span>';
  if(st==='running') return '<span class="spinner"></span>';
  if(st==='failed') return '<span class="task-ic" style="background:rgba(239,68,68,.15);color:var(--danger)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></span>';
  if(st==='waiting') return '<span class="task-ic" style="background:rgba(245,158,11,.18);color:var(--gold)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v10"/><path d="M12 20.2v.3"/></svg></span>';
  if(st==='paused') return '<span class="task-ic" style="border:1.5px solid var(--line);color:var(--muted)"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></span>';
  if(st==='cancelled') return '<span class="task-ic" style="border:1.5px solid var(--line);color:var(--muted)"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>';
  return '<span class="task-ic" style="border:1.5px solid var(--line);color:var(--muted)"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg></span>';
}
function renderTaskList(){
  /* The checklist card itself is NOT painted in the chat area any more — while
     an answer is generating, the chat shows only the typing dots + status word.
     The pcTask state above still updates on every setProgress call, and the
     right companion panel reads that same state for its own compact task
     progress, so nothing about the panel changes. */
  var box=$('progressBox'); if(box) box.innerHTML='';
}
function markTasksCancelled(){
  if(!pcTask.steps.length){ var box=$('progressBox'); if(box) box.innerHTML=''; return; }
  var now=Date.now();
  pcTask.states=pcTask.states.map(function(s,i){ if(s==='completed') return s; if(!pcTask.ends[i]) pcTask.ends[i]=now; return 'cancelled'; });
  renderTaskList();
}
function setProgress(steps, activeIdx, research){
  var box=$('progressBox');
  if(!steps){ pcTask={steps:[],states:[],starts:[],ends:[],research:false,decision:''}; box.innerHTML=''; return; }
  var now=Date.now();
  var prevDone = pcTask.states.length>0 && pcTask.states.every(function(s){ return s==='completed'||s==='failed'||s==='cancelled'; });
  if(!pcTask.steps.length || pcTask.steps.join('|')!==steps.join('|') || prevDone){
    pcTask={steps:steps.slice(), states:steps.map(function(){ return 'pending'; }), starts:[], ends:[], research:!!research, decision:pcTask.decision||''};
  }
  pcTask.research=!!research;
  for(var i=0;i<steps.length;i++){
    if(i<activeIdx){ if(pcTask.states[i]!=='completed'){ if(!pcTask.starts[i]) pcTask.starts[i]=now; pcTask.states[i]='completed'; if(!pcTask.ends[i]) pcTask.ends[i]=now; } }
    else if(i===activeIdx){ if(pcTask.states[i]!=='running' && pcTask.states[i]!=='completed'){ pcTask.states[i]='running'; if(!pcTask.starts[i]) pcTask.starts[i]=now; pcTask.ends[i]=0; } }
    else if(pcTask.states[i]==='running'){ pcTask.states[i]='pending'; pcTask.ends[i]=0; }
  }
  renderTaskList();
}
/* When a run ends, every step it actually passed is Completed — the panel's
   "Remaining steps" must never list work (like the final report step) that
   the finished answer already delivered. On a failed run the step that was
   running is marked Failed instead. */
function finishTasks(failed){
  if(!pcTask.steps.length) return;
  var now=Date.now();
  pcTask.states=pcTask.states.map(function(s,i){
    if(s==='completed') return s;
    if(!pcTask.ends[i]) pcTask.ends[i]=now;
    if(failed && s==='running') return 'failed';
    return 'completed';
  });
  renderTaskList();
}

/* Answer pipeline: relevance gate → grounded AI answer from the retrieved page
   text (citations validated against the pages) → extractive answer built from
   those same pages → honest own-knowledge answer with NO sources attached.
   An answer is only ever shown with sources it actually cites. */
function answerWithSources(text, sources, lang, deep, historyText, steps){
  setProgress(steps,2,deep);
  setTypingStatus('Writing…');
  var metaLive=(sources && typeof sources.liveCount==='number') ? sources.liveCount : (sources||[]).length;
  var metaFail=(sources && sources.failKind) || 'empty';
  function knowledgeResult(){
    /* No usable pages: the answer comes from ENZO's own knowledge, attaches NO
       sources, and carries liveCount 0 so the caller shows the honest failure
       notice (with the real reason) and the Retry Search button. */
    var emptyMeta=[]; emptyMeta.liveCount=0; emptyMeta.failKind=(metaFail && metaFail!=='none') ? metaFail : 'empty';
    return callAIKnowledge(text, lang, deep, historyText).then(function(kText){
      kText=finishAtSentence(scrubResearchClaims(scrubQuestionEcho(kText, text)));
      return {html: mdToHtml(kText), plain: kText, sources:emptyMeta, fromKnowledge:true};
    }).catch(function(){
      /* One more attempt before giving up — a failed first call must not turn
         into an empty template answer. */
      return callAIKnowledge(text, lang, deep, historyText).then(function(kText2){
        kText2=finishAtSentence(scrubResearchClaims(scrubQuestionEcho(kText2, text)));
        return {html: mdToHtml(kText2), plain: kText2, sources:emptyMeta, fromKnowledge:true};
      }).catch(function(){
        /* Still nothing: an honest line, never an empty template. aiFailed
           tells the caller to show ONLY the failure notice with the working
           Retry Search button — never a banner claiming an own-knowledge
           answer follows when none could be written. */
        var line='The answering service did not respond this time, so no answer could be written. Tap Retry Search to run this same question again.';
        return {html:'<p>'+line+'</p>', plain:line, sources:emptyMeta, fromKnowledge:true, aiFailed:true};
      });
    });
  }
  var relevant=filterRelevantSources(text, sources||[]);
  if(!relevant.length) return knowledgeResult();
  var currencyFallback=!!relevant.currencyFallback;
  var promptSources=relevant.slice(0, deep?10:6);
  /* Freshness, computed from the pages' real dates — for a "latest / today"
     question the answer must lead with the newest dated news, and when the
     dated results are stale (or none are dated at all) it must say so plainly
     instead of presenting old facts as today's news. */
  var nd=newestDatedSource(promptSources);
  var fresh={
    fallback:currencyFallback,
    stale:!!(nd && (Date.now()-nd.date.getTime())>7*864e5),
    newestText:nd?(fmtDay(nd.date)+(nd.source.outlet?' — '+nd.source.outlet:'')):'',
    newestSource:nd?nd.source:null
  };
  var isCurrent=isCurrentQuestion(text, analyzeQuestion(text));
  function withNewsNote(result){
    if(!isCurrent || !result || result.fromKnowledge) return result;
    var notePlain=''; var noteHtml='';
    if(fresh.fallback){
      notePlain='No current-dated pages were found for this topic'+(fresh.newestText?(' — the newest date seen in the pages found is '+fresh.newestText):'')+'. The best on-topic pages found are used below.';
    } else if(fresh.stale){
      notePlain='No fresh news was found in the dated results — the newest dated item is from '+fresh.newestText+'. The dated items below are the newest that were found, and they are not from today.';
    } else if(!nd){
      notePlain='None of the pages found for this topic carries a publication date, so nothing below is presented as today\'s news.';
    }
    if(!notePlain) return result;
    var citeIdx=0;
    if(fresh.newestSource){
      var pos=result.sources.indexOf(fresh.newestSource);
      if(pos===-1){ result.sources.push(fresh.newestSource); pos=result.sources.length-1; }
      citeIdx=pos+1;
    }
    noteHtml='<p>'+esc(notePlain)+(citeIdx?' <span class="cite">['+citeIdx+']</span>':'')+'</p>';
    if(citeIdx) notePlain+=' ['+citeIdx+']';
    result.html=noteHtml+result.html;
    result.plain=notePlain+'\n\n'+result.plain;
    return result;
  }
  function extractiveResult(){
    var gf=groundedFallback(text, promptSources, lang, deep);
    if(!gf.sources.length) return null;
    gf.sources.liveCount=Math.max(metaLive,2); gf.sources.failKind='none';
    return withNewsNote({html: gf.html, plain: gf.plain, sources: gf.sources, fromKnowledge:false});
  }
  var prompt=buildPrompt(text, promptSources, lang, deep, historyText, fresh);
  return callAI(prompt).then(function(aiText){
    aiText=scrubQuestionEcho(aiText, text);
    /* UNDERSTANDING RULE: the model replied with a lone clarifying question —
       pass it through as the final reply (flagged clarify, no sources), never
       swap it for a citation-checked guess. */
    var intent = (typeof classifyIntent==='function') ? classifyIntent(text) : null;
    if(looksClarifyReply(aiText) && intent && intent.kind==='clarify'){
      var cmeta=[]; cmeta.liveCount=0; cmeta.failKind='none'; cmeta.clarify=true;
      return {html: mdToHtml(aiText), plain: aiText, sources:cmeta, fromKnowledge:false, clarify:true};
    }
    aiText=ensureParagraphCitations(aiText, promptSources);
    aiText=finishAtSentence(aiText);
    var v=validateCitations(aiText, promptSources);
    if(v.cited){
      v.sources.liveCount=Math.max(metaLive,2); v.sources.failKind='none';
      return withNewsNote({html: mdToHtml(v.text), plain: v.text, sources:v.sources, fromKnowledge:false});
    }
    /* The model answered without citing a single page it was given — that answer
       cannot be trusted as research, so ship the extractive answer built from
       the pages themselves, where every line carries its real citation. */
    var ex=extractiveResult();
    return ex || knowledgeResult();
  }).catch(function(){
    setProgress(steps,3,deep);
    var ex=extractiveResult();
    return ex || knowledgeResult();
  });
}

/* ---------- MEGA DEEP RESEARCH — no quantity limit, batch-wise, best-of-best ranking ---------- */
function parseMegaRequest(text){
  var t=' '+(text||'').toLowerCase()+' ';
  var m=t.match(/(\d[\d,]*)\s*(channels?|websites?|sites?|accounts?|pages?|profiles?|videos?|blogs?|tools?|apps?|stores?|businesses?|companies?|books?|movies?|songs?|creators?|influencers?)/);
  if(m){
    var count=parseInt(m[1].replace(/,/g,''),10);
    if(count>=20) return {count:count, entity:m[2], raw:m[0].trim()};
    return null;
  }
  /* Number WORDS count too — "ek sau websites" / "one hundred websites" is a
     100-website research request exactly like "100 websites", in Roman Urdu
     or English. Without this, such a request silently fell through to a
     normal answer that then claimed research it never did. */
  var wm=t.match(/\b(ek\s+sau|sau|one\s+hundred|a\s+hundred|hundred)\b[^.]{0,30}?(websites?|web\s?sites?|sites?|pages?)/);
  if(wm) return {count:100, entity:'websites', raw:wm[0].trim()};
  var wm2=t.match(/\b(ek\s+hazar|hazar|one\s+thousand|a\s+thousand|thousand)\b[^.]{0,30}?(websites?|web\s?sites?|sites?|channels?|accounts?|pages?|profiles?)/);
  if(wm2) return {count:1000, entity:wm2[2]==='web sites'?'websites':wm2[2], raw:wm2[0].trim()};
  if(/\b(saare|sab ke sab|all|har ek)\b[^.]{0,40}\b(channels?|websites?|sites?|accounts?|pages?|profiles?)\b/.test(t)) return {count:1000, entity:(t.match(/(channels?|websites?|sites?|accounts?|pages?|profiles?)/)||[])[1]||'results', raw:''};
  return null;
}
function megaTopic(text, mega){
  var topic=text;
  if(mega.raw){ var rx=new RegExp(mega.raw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); topic=topic.replace(rx,' '); }
  topic=topic.replace(/\b(mujhe|chahiye|do|dein|batao|bataein|dhoondh\w*|search|find|research|karo|kar|ke|ka|ki|par|pe|is|the|of|for|me|give|list|top|best)\b/gi,' ').replace(/\s+/g,' ').trim();
  if(topic.length<3) topic=analyzeQuestion(text).keywords.join(' ');
  if(!topic) topic=text;
  /* FIX 2 (v63): drop the named platform place word from the mega topic. */
  var src=null;
  try{ src=detectSource(text).source; }catch(e){}
  var cleaned=stripPlaceWordFromQuery(topic, src);
  if(cleaned) topic=cleaned;
  return topic;
}
function megaQueries(topic, entity){
  var suf=['best','top','most popular','list','directory','examples','recommended','biggest','famous','ranking','collection','to follow','for beginners','2026','2025','ultimate list','complete list','guide','resources','top rated','must visit','explained','overview','handpicked','essential'];
  var qs=[];
  suf.forEach(function(s){ qs.push(topic+' '+entity+' '+s); });
  qs.push(topic+' '+entity);
  if(/channel/.test(entity)){ qs.push('site:youtube.com '+topic); qs.push(topic+' youtube channels'); qs.push('best youtube channels '+topic); }
  if(/account|profile|page/.test(entity)){ qs.push(topic+' instagram accounts best'); qs.push(topic+' facebook pages best'); qs.push(topic+' tiktok accounts best'); qs.push(topic+' twitter accounts '+topic); }
  if(/website|site/.test(entity)){ qs.push('best websites '+topic); qs.push(topic+' websites directory'); }
  var enT=romanToEnglish(topic); if(enT && enT!==topic){ qs.push(enT+' '+entity+' best'); qs.push(enT+' '+entity+' list'); }
  return qs;
}
function setMegaProgress(batch, collected, mega){
  /* No progress card in the chat area — the typing dots + status word are the
     only generating indicator there. The right companion panel still receives
     the real batch count through its own wrapper around this same function. */
  setTypingStatus('Searching…');
  if(state.nearBottom) $('scrollArea').scrollTop=$('scrollArea').scrollHeight;
}
function megaSearch(topic, mega){
  var queries=megaQueries(topic, mega.entity);
  var items=[]; var seen={}; var megaFails=[];
  var idx=0; var batch=0;
  function addResults(list){ (list||[]).forEach(function(s){ var key=((s.url||'')+'|'+(s.title||'')).toLowerCase(); if(key!=='|' && !seen[key]){ seen[key]=1; items.push(s); } }); }
  function nextBatch(){
    if(idx>=queries.length || items.length>=mega.count) return Promise.resolve(items);
    batch++;
    var slice=queries.slice(idx, idx+3); idx+=3;
    var jobs=[];
    slice.forEach(function(q){ jobs.push(searchOneQuery(q, 10, false).then(function(o){ (o.fails||[]).forEach(function(f){ megaFails.push(f); }); return o.results; })); });
    return Promise.all(jobs).then(function(res){ res.forEach(addResults); setMegaProgress(batch, items.length, mega); return nextBatch(); });
  }
  return nextBatch().then(function(){ items.failKind=items.length?'none':aggregateFailKind(megaFails); return items; });
}
function megaFallbackHtml(mega, items, lang){
  var top=items.slice(0,25);
  var intro = lang==='roman'
    ? '<p>Gehri batch research mukammal — kul <b>'+items.length+'</b> unique '+esc(mega.entity)+' mile aur analyze hue (aap ne '+mega.count.toLocaleString()+' kahe thay; live sources se jitne mile, sab shamil hain). Un mein se best-of-best ranking ye hai:</p>'
    : (lang==='urdu'
    ? '<p>گہری بیچ ریسرچ مکمل — کل <b>'+items.length+'</b> منفرد '+esc(mega.entity)+' ملے اور جانچے گئے۔ ان میں سے بہترین درجہ بندی یہ ہے:</p>'
    : '<p>Mega Deep Research complete — <b>'+items.length+'</b> unique '+esc(mega.entity)+' were found and analyzed (you asked for '+mega.count.toLocaleString()+'; every result the live sources returned is included). Here is the best-of-the-best ranking:</p>');
  var lis=top.map(function(s,i){ return '<li><a href="'+esc(safeHttpUrl(s.url))+'" target="_blank" rel="noopener"><b>'+esc(s.title)+'</b></a>'+(s.snippet?' — '+esc(trimAtWord((s.snippet||'').replace(/\s+/g,' '),150)):'')+'</li>'; }).join('');
  return intro+'<ul>'+lis+'</ul>';
}
function megaAnswer(text, mega, items, lang){
  var listText=items.slice(0,160).map(function(s,i){ return (i+1)+'. '+s.title+' — '+s.url+' — '+((s.snippet||'').slice(0,130)); }).join('\n');
  var topN = items.length>40 ? 20 : 10;
  var prompt=EnzoIdentity.withIdentity('You are ENZO AI doing a MEGA Deep Research ranking — clean and professional, no broken lines. The user asked for '+mega.count+' '+mega.entity+' on this topic: "'+text+'". Across multiple search batches over the whole internet, '+items.length+' unique REAL results were collected (numbered list below). Analyze ALL of them and deliver a BEST-OF-THE-BEST ranking of the top '+topN+', ranked best first. Format: first ONE line stating exactly how many unique '+mega.entity+' were researched and analyzed ('+items.length+'). Then a heading ## Best of the Best, then the ranked list — each entry: name, its number from the list like [n], and ONE short line on why it ranks there. Then a short ## How These Were Ranked note (criteria: relevance to the topic, popularity/authority, quality). GROUNDING: rank ONLY entries from the numbered list below, describe each entry ONLY with what its list line actually says, and put its [n] citation on every entry. NEVER invent entries that are not in the list, never invent subscriber counts, dates, prices or statistics, and never claim a fact about an entry that its list line does not contain. '+langInstrFor(lang)+'\n\nCollected results:\n'+listText+'\n\nNow write the ranking:');
  return callAI(prompt).then(function(aiText){
    /* The ranking's [n] citations point into the collected list — keep exactly the
       cited entries, renumbered in citation order, as this answer's sources, so a
       citation number always opens the entry it refers to. */
    var v=validateCitations(aiText, items.slice(0,160));
    if(v.cited) return {html: mdToHtml(v.text), plain: v.text, sources: v.sources};
    var fh=megaFallbackHtml(mega, items, lang);
    return {html: fh, plain: stripHtml(fh), sources: items.slice(0,25)};
  }).catch(function(){
    var fh=megaFallbackHtml(mega, items, lang);
    return {html: fh, plain: stripHtml(fh), sources: items.slice(0,25)};
  });
}
function megaSearchFlow(text, mega, chat, lang, historyText){
  var topic=megaTopic(text, mega);
  setTypingStatus('Searching…');
  megaSearch(topic, mega).then(function(items){
    if(!items.length){
      /* NEVER-ANSWER-WHEN-UNSURE (locked rule): live search returned no usable
         pages at all, so ZERO websites were researched. ENZO does not dress up
         an own-knowledge answer as research — it asks ONE short clarifying
         question naming the two most likely meanings, and researches only
         after the user clarifies. (A genuine connection outage keeps the
         honest notice below instead — that is a service failure, not a
         misunderstanding.) */
      var mfk=items.failKind||'empty';
      /* v55 P1: the no-results clarify is gated for decided kinds — a thin mega search is not a misunderstanding. */
      var intent = (typeof classifyIntent==='function') ? classifyIntent(text) : null;
      var megaIntentKind55 = chat.intentKind || (intent && intent.kind);
      var megaDecided55 = !!(megaIntentKind55 && megaIntentKind55!=='clarify');
      var mcq=(mfk==='empty' && !megaDecided55 && typeof window.__enzoClarifyQuestion==='function') ? window.__enzoClarifyQuestion(text, lang, chat, 'noresults') : '';
      if(mcq){
        hideTyping();
        chat.pendingClarifyLocal={original:text, noResults:true, lang:lang, opts:(typeof window.__enzoNoResultsOptions==='function'?window.__enzoNoResultsOptions(text):[])};
        saveChats();
        var mcTl=timeLabelFor(Date.now());
        var mcMsg={role:'ai', html:mdToHtml(mcq), plain:mcq, viaVoice:!!state.currentAskViaVoice, question:text, sources:[], deep:true, mega:true, clarify:true, modeWhy:'ENZO asked a clarifying question — never answers when unsure', followups:[], lang:lang, ts:Date.now(), daypart:mcTl.daypart, daypartRoman:mcTl.daypartRoman, timeLabel:mcTl.full};
        chat.messages.push(mcMsg); renderMessages(); saveChats();
        if(typeof setProgress==='function') setProgress(null);
        setGenerating(false);
        setCentreEnzo('idle');
        (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(mcMsg, answersMode()) : maybeSpeak(mcMsg));
        return;
      }
      setTypingStatus('Writing…');
      return callAIKnowledge(text, lang, false, historyText).catch(function(){ return ''; }).then(function(kText){
        hideTyping();
        kText=kText ? scrubResearchClaims(scrubQuestionEcho(kText, text)) : '';
        var notice=searchFailNoticeHtml(items.failKind||'empty');
        var bodyHtml=kText ? mdToHtml(kText) : '<p>The live sources returned nothing usable this time. Ask the same research again in a moment, or ask it as a normal question.</p>';
        var tl3=timeLabelFor(Date.now());
        var m3={role:'ai', html:'', plain:kText||stripHtml(bodyHtml), viaVoice:!!state.currentAskViaVoice, question:text, sources:[], deep:true, mega:true, modeWhy:'Mega Deep Research (quantity request)', followups:makeFollowups(text,lang), lang:lang, ts:Date.now(), daypart:tl3.daypart, daypartRoman:tl3.daypartRoman, timeLabel:tl3.full, _fullHtml:notice+bodyHtml};
        chat.messages.push(m3); renderMessages();
        streamMessage(chat, m3);
      });
    }
    setTypingStatus('Writing…');
    return megaAnswer(text, mega, items, lang).then(function(result){
      hideTyping();
      var ansTl=timeLabelFor(Date.now());
      var msg={role:'ai', html:'', plain:result.plain, viaVoice:!!state.currentAskViaVoice, question:text, sources: state.sourcesOn?(result.sources||items.slice(0,18)):[], deep:true, mega:true, modeWhy:'Mega Deep Research (quantity request)', followups: makeFollowups(text, lang), lang:lang, ts:Date.now(), daypart:ansTl.daypart, daypartRoman:ansTl.daypartRoman, timeLabel:ansTl.full, _fullHtml:result.html};
      chat.messages.push(msg); renderMessages();
      streamMessage(chat, msg);
    });
  }).catch(function(){
    hideTyping();
    finishTasks(true);
    setCentreEnzo('error');
    var fh=fallbackAnswer(text, [], lang, true);
    if(!fh) fh='<div class="notice-warn"><p style="margin:0 0 10px">'+esc(window.EnzoAskRecovery.fallbackNotice(lang))+'</p><button type="button" class="retrybtn" data-act="retrySearch">Retry Search</button></div>';
    var errTl=timeLabelFor(Date.now());
    var megaErr={role:'ai', html:fh, plain:stripHtml(fh), error:true, viaVoice:!!state.currentAskViaVoice, question:text, sources:[], deep:true, mega:true, modeWhy:'Mega Deep Research (quantity request)', followups:makeFollowups(text,lang), lang:lang, ts:Date.now(), daypart:errTl.daypart, daypartRoman:errTl.daypartRoman, timeLabel:errTl.full};
    chat.messages.push(megaErr);
    renderMessages(); setGenerating(false);
    (window.EnaoV54Voice ? window.EnaoV54Voice.patchDirectSpeak(megaErr, answersMode()) : maybeSpeak(megaErr));
  });
}

