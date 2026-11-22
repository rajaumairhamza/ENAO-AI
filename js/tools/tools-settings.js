/* ---------- PIECE 4 — AI TOOLS + FULL SETTINGS ----------
   Every tool below really works: files are read locally in the browser with
   pdf.js / mammoth / SheetJS (loaded on demand from CDN), AI actions use the
   same free Pollinations service the chat already uses, image generation uses
   the free Pollinations image service, translation falls back to the free
   MyMemory API. Nothing here is decorative. */
var __libCache={};
function loadLibOnce(key, url){
  if(__libCache[key]) return __libCache[key];
  __libCache[key]=new Promise(function(res, rej){
    var s=document.createElement('script'); s.src=url; s.async=true;
    s.onload=function(){ res(); };
    s.onerror=function(){ delete __libCache[key]; rej(new Error('lib')); };
    document.head.appendChild(s);
  });
  return __libCache[key];
}
function toolOut(html){ $('toolOut').innerHTML='<div class="toolout">'+html+'</div>'; }
function toolOutMd(md){ toolOut(mdToHtml(md)); }
function toolOutText(t){ toolOut(esc(t||'').replace(/\n/g,'<br>')); }
function toolErr(msg){ $('toolOut').innerHTML='<div class="toolerr">'+esc(msg)+'</div>'; }
function toolLoading(msg){ $('toolOut').innerHTML='<div class="toolout"><span class="spinner" style="display:inline-block;vertical-align:-4px;margin-right:9px"></span>'+esc(msg||'Working…')+'</div>'; }
function setBusy(btn, busy, label){
  if(!btn) return;
  if(busy){ btn.dataset.label=btn.textContent; btn.disabled=true; btn.textContent=label||'Working…'; }
  else { btn.disabled=false; if(btn.dataset.label) btn.textContent=btn.dataset.label; }
}
function wordStats(text){
  var t=(text||'').trim();
  return {words: t? t.split(/\s+/).filter(Boolean).length : 0, chars:(text||'').length};
}
function fmtNum(n){ var v=Math.round(n*100)/100; return v.toLocaleString(undefined,{maximumFractionDigits:2}); }
function sendDocToChat(name, text, question){
  state.pendingFiles.push({name:name, kind:'doc', size:(text||'').length, text:(text||'').slice(0,60000), dataUrl:'', progress:100});
  renderAttachRow();
  $('input').value=question||('Please analyze the attached document "'+name+'" and tell me its key points.');
  autoGrow(); syncSendBtn();
  closeModal('toolModal'); closeModal('toolsModal');
  toast('Attached "'+name+'" — press Send and ENZO will answer about it');
  $('input').focus();
}
/* --- real file readers --- */
function extractPdfText(file){
  return loadLibOnce('pdfjs','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js').then(function(){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return file.arrayBuffer();
  }).then(function(buf){ return window.pdfjsLib.getDocument({data:buf}).promise; }).then(function(pdf){
    var texts=[]; var seq=Promise.resolve();
    for(var p=1;p<=pdf.numPages;p++){ (function(pn){ seq=seq.then(function(){ return pdf.getPage(pn).then(function(page){ return page.getTextContent(); }).then(function(tc){ texts.push(tc.items.map(function(it){ return it.str; }).join(' ')); }); }); })(p); }
    return seq.then(function(){ return {pages:pdf.numPages, text:texts.join('\n')}; });
  });
}
function extractDocxText(file){
  return loadLibOnce('mammoth','https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js')
    .then(function(){ return file.arrayBuffer(); })
    .then(function(buf){ return window.mammoth.extractRawText({arrayBuffer:buf}); })
    .then(function(r){ return (r&&r.value)||''; });
}
function readTextFile(file){
  if(file.text) return file.text();
  return new Promise(function(res, rej){ var r=new FileReader(); r.onload=function(){ res(String(r.result||'')); }; r.onerror=rej; r.readAsText(file); });
}
function readDocFile(file){
  var ext=(file.name.split('.').pop()||'').toLowerCase();
  if(ext==='pdf') return extractPdfText(file).then(function(r){ return r.text; });
  if(ext==='docx') return extractDocxText(file);
  if(ext==='doc') return Promise.reject(new Error('legacy'));
  if(ext==='txt'||ext==='md') return readTextFile(file);
  return Promise.reject(new Error('type'));
}
function readSpreadsheetFile(file){
  return loadLibOnce('xlsx','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')
    .then(function(){ return file.arrayBuffer(); })
    .then(function(buf){
      var wb=window.XLSX.read(new Uint8Array(buf), {type:'array'});
      var first=wb.SheetNames[0];
      var rows=window.XLSX.utils.sheet_to_json(wb.Sheets[first], {header:1, defval:''});
      return {sheetNames:wb.SheetNames, sheet:first, rows:rows};
    });
}
function parseCSV(text){
  var rows=[]; var row=[]; var cur=''; var inQ=false;
  text=(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  for(var i=0;i<text.length;i++){ var ch=text[i];
    if(inQ){ if(ch==='"'){ if(text[i+1]==='"'){ cur+='"'; i++; } else inQ=false; } else cur+=ch; }
    else if(ch==='"') inQ=true;
    else if(ch===','){ row.push(cur); cur=''; }
    else if(ch==='\n'){ row.push(cur); cur=''; rows.push(row); row=[]; }
    else cur+=ch;
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(function(r){ return r.length>1 || (r[0]&&String(r[0]).trim()!==''); });
}
function rowsToCsv(rows){
  return rows.map(function(r){ return r.map(function(c){ var s=(c===null||c===undefined)?'':String(c); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(','); }).join('\n');
}
function tablePreviewHtml(rows, maxRows, maxCols){
  maxRows=maxRows||12; maxCols=maxCols||8;
  if(!rows.length) return '<p>No rows found.</p>';
  var h='<table>';
  rows.slice(0,maxRows).forEach(function(r, ri){
    h+='<tr>'+r.slice(0,maxCols).map(function(c){ var s=esc(String(c===null||c===undefined?'':c).slice(0,60)); return ri===0?'<th>'+s+'</th>':'<td>'+s+'</td>'; }).join('')+'</tr>';
  });
  return h+'</table>'+(rows.length>maxRows?'<p class="toolnote">Showing the first '+maxRows+' of '+rows.length+' rows.</p>':'');
}
function numericColumnStats(rows){
  if(rows.length<2) return [];
  var cols=0; rows.forEach(function(r){ cols=Math.max(cols, r.length); });
  var out=[];
  for(var c=0;c<cols;c++){
    var vals=[];
    for(var r=1;r<rows.length;r++){ var raw=rows[r][c]; var v=parseFloat(raw); if(raw!=='' && raw!==null && raw!==undefined && !isNaN(v)) vals.push(v); }
    if(vals.length>=2){
      var sum=0; vals.forEach(function(v){ sum+=v; });
      out.push({idx:c, name:String(rows[0][c]||('Column '+(c+1))), count:vals.length, sum:sum, avg:sum/vals.length, min:Math.min.apply(null,vals), max:Math.max.apply(null,vals)});
    }
  }
  return out;
}
function statsTableHtml(stats){
  if(!stats.length) return '<p class="toolnote">No numeric columns with at least two values were found.</p>';
  var h='<b>Number summary per column</b><table><tr><th>Column</th><th>Count</th><th>Sum</th><th>Average</th><th>Min</th><th>Max</th></tr>';
  stats.forEach(function(s){ h+='<tr><td>'+esc(s.name)+'</td><td>'+s.count+'</td><td>'+fmtNum(s.sum)+'</td><td>'+fmtNum(s.avg)+'</td><td>'+fmtNum(s.min)+'</td><td>'+fmtNum(s.max)+'</td></tr>'; });
  return h+'</table>';
}
function barChartHtml(rows, stat){
  if(!stat) return '';
  var items=[];
  for(var r=1;r<rows.length && items.length<10;r++){ var v=parseFloat(rows[r][stat.idx]); if(!isNaN(v)) items.push({label:String(rows[r][0]||('Row '+r)), value:v}); }
  if(items.length<2) return '';
  var max=0; items.forEach(function(i){ if(i.value>max) max=i.value; });
  if(max<=0) return '';
  var h='<p style="margin:12px 0 0"><b>Chart — '+esc(stat.name)+' by '+esc(String(rows[0][0]||'first column'))+'</b></p><svg viewBox="0 0 560 '+(items.length*30+10)+'" style="width:100%;margin-top:6px" role="img" aria-label="Bar chart of '+esc(stat.name)+'">';
  items.forEach(function(it, i){
    var y=6+i*30; var w=Math.max(2, Math.round(it.value/max*290));
    h+='<text x="0" y="'+(y+13)+'" font-size="11">'+esc(it.label.slice(0,18))+'</text><rect x="150" y="'+y+'" width="'+w+'" height="17" rx="4" fill="#0b7a67"></rect><text x="'+(158+w)+'" y="'+(y+13)+'" font-size="11">'+esc(fmtNum(it.value))+'</text>';
  });
  return h+'</svg>';
}
function summarizeWithAI(text, name, detailed){
  var prompt='Summarize the following document'+(name?' ("'+name+'")':'')+' clearly and accurately. '+(detailed?'Give a thorough summary: a one-line overview, then sections with the key points, important names, numbers and dates, and any conclusions.':'Start with a one-line summary, then the key points as short bullets.')+' Invent nothing — use only what the text says.\n\n'+(text||'').slice(0,9000);
  return callAI(prompt);
}
function extractiveSummary(text, n){
  var clean=(text||'').replace(/\s+/g,' ');
  var sents=clean.match(/[^.!?]+[.!?]+/g)||[];
  if(sents.length<=n) return clean.slice(0,1400);
  var freq={};
  clean.toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).forEach(function(w){ if(w.length>3) freq[w]=(freq[w]||0)+1; });
  var scored=sents.map(function(s, i){ var sc=0; s.toLowerCase().split(/\s+/).forEach(function(w){ sc+=freq[w.replace(/[^a-z]/g,'')]||0; }); return {s:s.trim(), i:i, sc:sc}; });
  scored.sort(function(a,b){ return b.sc-a.sc; });
  return scored.slice(0,n).sort(function(a,b){ return a.i-b.i; }).map(function(x){ return x.s; }).join(' ');
}
function fileToScaledDataUrl(file, maxDim){
  return new Promise(function(res, rej){
    var url=URL.createObjectURL(file); var img=new Image();
    img.onload=function(){
      var w=img.naturalWidth, h=img.naturalHeight;
      var scale=Math.min(1, maxDim/Math.max(w,h));
      var cw=Math.max(1,Math.round(w*scale)), ch=Math.max(1,Math.round(h*scale));
      var cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
      cv.getContext('2d').drawImage(img,0,0,cw,ch);
      URL.revokeObjectURL(url);
      res({dataUrl:cv.toDataURL('image/jpeg',0.85), width:w, height:h});
    };
    img.onerror=function(){ URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src=url;
  });
}
function describeImage(dataUrl){
  return fetch('https://text.pollinations.ai/', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'openai', messages:[{role:'system', content:EnzoIdentity.ENZO_IDENTITY},{role:'user', content:[{type:'text', text:'Describe this image in detail — what is shown, any visible text, objects, people, colors and the overall scene. Be accurate and specific.'},{type:'image_url', image_url:{url:dataUrl}}]}]})})
    .then(function(r){ if(!r.ok) throw new Error('vision'); return r.text(); })
    .then(function(t){ try{ var j=JSON.parse(t); if(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) return j.choices[0].message.content; }catch(e){} return t; });
}
window.toolImgOk=function(){ var st=document.getElementById('tgStatus'); if(st) st.textContent='Your image is ready — tap it to open it full size.'; };
window.toolImgErr=function(){ toolErr('The free image service could not create that image. Try a different description, or try again in a moment.'); };

/* --- tool workspaces --- */
function docToolBody(body, cfg){
  body.innerHTML='<button class="primary" id="tdPick">'+esc(cfg.pickLabel)+'</button><input type="file" id="tdFile" accept="'+cfg.accept+'" hidden>'
    +'<p class="toolnote">'+esc(cfg.note)+'</p>'
    +'<div id="tdActions" style="display:none;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="actionbtn" id="tdSummary">Summarize it</button><button class="actionbtn" id="tdChat">Send to chat</button></div>';
  var data=null;
  $('tdPick').onclick=function(){ $('tdFile').click(); };
  $('tdFile').addEventListener('change', function(){
    var f=this.files&&this.files[0]; this.value=''; if(!f) return;
    if(f.size>25*1024*1024){ toolErr('"'+f.name+'" is '+fmtFileSize(f.size)+' — the reader limit here is 25 MB.'); return; }
    toolLoading('Reading "'+f.name+'" on this device…');
    cfg.read(f).then(function(text){
      data={name:f.name, text:text||''};
      var st=wordStats(data.text);
      $('tdActions').style.display='flex';
      if(!data.text.trim()){ toolErr(cfg.emptyMsg); return; }
      toolOut('<b>'+esc(f.name)+'</b><br>'+(cfg.meta?cfg.meta(data):'')+'Words: '+st.words.toLocaleString()+' • Characters: '+st.chars.toLocaleString()+' • Reading time: about '+Math.max(1,Math.round(st.words/200))+' min<br><br><b>Text preview:</b><br>'+esc(data.text.slice(0,2500))+(data.text.length>2500?'<br>…':''));
    }).catch(function(e){
      if(e && e.message==='legacy') toolErr('This is the old .doc format, which browsers cannot read directly. Open it in Word or Google Docs, save it as .docx, and try again.');
      else toolErr(cfg.failMsg);
    });
  });
  $('tdSummary').onclick=function(){ if(!data) return; var b=this; setBusy(b,true,'Summarizing…'); toolLoading('Writing the summary…'); summarizeWithAI(data.text, data.name, false).then(function(md){ setBusy(b,false); toolOutMd(md); }).catch(function(){ setBusy(b,false); toolOut('<b>Summary from the document\'s own key sentences</b> (the AI service did not answer, so this was built from the text itself):<br><br>'+esc(extractiveSummary(data.text, 6))); }); };
  $('tdChat').onclick=function(){ if(data) sendDocToChat(data.name, data.text); };
}
function buildPdfTool(body){
  docToolBody(body, {pickLabel:'Choose a PDF file', accept:'.pdf,application/pdf',
    note:'The PDF is read on this device only — it is never uploaded anywhere. Scanned-image PDFs without a text layer cannot be read this way.',
    emptyMsg:'This PDF has no readable text layer — it looks like scanned images, and the built-in reader cannot extract text from scanned pages.',
    failMsg:'The PDF could not be read. It may be damaged or password-protected, or the free PDF reader library could not be loaded — check your connection and try again.',
    read:function(f){ return extractPdfText(f).then(function(r){ window.__lastPdfPages=r.pages; return r.text; }); },
    meta:function(){ return 'Pages: '+(window.__lastPdfPages||'?')+' • '; }});
}
function buildWordTool(body){
  docToolBody(body, {pickLabel:'Choose a Word document', accept:'.docx,.txt,.md',
    note:'Works with .docx (and plain .txt / .md). The file is read on this device only — nothing is uploaded.',
    emptyMsg:'No readable text was found in this document.',
    failMsg:'The document could not be read. It may be damaged, or the free document reader library could not be loaded — check your connection and try again.',
    read:function(f){ return readDocFile(f); }, meta:null});
}
function buildExcelTool(body){
  body.innerHTML='<button class="primary" id="txPick">Choose a spreadsheet</button><input type="file" id="txFile" accept=".xlsx,.xls,.csv" hidden>'
    +'<p class="toolnote">Works with .xlsx, .xls and .csv. The file is read on this device only. The first sheet is analyzed; number columns get totals, averages, min and max.</p>'
    +'<div id="txActions" style="display:none;margin-top:10px"><button class="actionbtn" id="txChat">Send this data to chat</button></div>';
  var data=null;
  $('txPick').onclick=function(){ $('txFile').click(); };
  $('txFile').addEventListener('change', function(){
    var f=this.files&&this.files[0]; this.value=''; if(!f) return;
    toolLoading('Reading "'+f.name+'" on this device…');
    readSpreadsheetFile(f).then(function(r){
      data={name:f.name, rows:r.rows};
      var cols=0; r.rows.forEach(function(x){ cols=Math.max(cols, x.length); });
      $('txActions').style.display='block';
      toolOut('<b>'+esc(f.name)+'</b><br>Sheets: '+esc(r.sheetNames.join(', '))+'<br>Analyzed sheet: <b>'+esc(r.sheet)+'</b> — '+r.rows.length+' rows × '+cols+' columns<br><br>'+tablePreviewHtml(r.rows)+'<br>'+statsTableHtml(numericColumnStats(r.rows)));
    }).catch(function(){ toolErr('The spreadsheet could not be read. It may be damaged, or the free spreadsheet library could not be loaded — check your connection and try again.'); });
  });
  $('txChat').onclick=function(){ if(data) sendDocToChat(data.name, rowsToCsv(data.rows), 'Please analyze the attached spreadsheet "'+data.name+'" — summarize the data and point out the important numbers.'); };
}
function buildImageTool(body){
  body.innerHTML='<button class="primary" id="tiPick">Choose an image</button><input type="file" id="tiFile" accept="image/*" hidden>'
    +'<div id="tiInfo"></div>'
    +'<div style="margin-top:10px"><button class="primary" id="tiRun" style="display:none">Describe this image</button></div>'
    +'<p class="toolnote">The image is resized on this device and sent only to the free AI vision service for the description. ENZO stores nothing.</p>';
  var dataUrl='';
  $('tiPick').onclick=function(){ $('tiFile').click(); };
  $('tiFile').addEventListener('change', function(){
    var f=this.files&&this.files[0]; this.value=''; if(!f) return;
    toolLoading('Loading the image…');
    fileToScaledDataUrl(f, 1024).then(function(r){
      dataUrl=r.dataUrl;
      $('tiInfo').innerHTML='<img class="toolimg" src="'+r.dataUrl+'" alt="Your chosen image"><p class="toolnote">'+esc(f.name)+' • '+(f.type||'image')+' • '+fmtFileSize(f.size)+' • '+r.width+' × '+r.height+' pixels</p>';
      $('tiRun').style.display='';
      $('toolOut').innerHTML='';
    }).catch(function(){ toolErr('That image could not be opened in the browser. Try a PNG, JPG, GIF or WebP image.'); });
  });
  $('tiRun').onclick=function(){
    if(!dataUrl) return;
    var b=this; setBusy(b,true,'Reading the image…'); toolLoading('ENZO is looking at the image…');
    describeImage(dataUrl).then(function(t){ setBusy(b,false); t=(t||'').trim(); if(t.length<15) throw new Error('empty'); toolOutMd(scrubDefeat(t)); })
      .catch(function(){ setBusy(b,false); toolErr('The free vision service did not answer this time — your image details are shown above. Try again in a moment.'); });
  };
}
function buildSummarizeTool(body){
  body.innerHTML='<textarea id="tsText" rows="7" placeholder="Paste the text to summarize here — or load a document with the button below…"></textarea>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><button class="actionbtn" id="tsFileBtn">Load .txt / .docx / .pdf</button><input type="file" id="tsFile" accept=".txt,.md,.docx,.pdf" hidden>'
    +'<select id="tsLen"><option value="short">Short summary</option><option value="detailed">Detailed summary</option></select>'
    +'<button class="primary" id="tsRun" style="flex:1">Summarize</button></div>';
  $('tsFileBtn').onclick=function(){ $('tsFile').click(); };
  $('tsFile').addEventListener('change', function(){
    var f=this.files&&this.files[0]; this.value=''; if(!f) return;
    toolLoading('Reading "'+f.name+'"…');
    readDocFile(f).then(function(t){ $('tsText').value=(t||'').slice(0,30000); $('toolOut').innerHTML=''; toast('Document loaded — tap Summarize'); })
      .catch(function(e){ if(e && e.message==='legacy') toolErr('The old .doc format cannot be read in the browser — save it as .docx first.'); else toolErr('That document could not be read. Try a .txt, .docx or text-based .pdf file.'); });
  });
  $('tsRun').onclick=function(){
    var t=$('tsText').value.trim();
    if(t.length<80){ toolErr('Paste at least a few sentences of text (or load a document) before summarizing.'); return; }
    var b=this; setBusy(b,true,'Summarizing…'); toolLoading('Writing the summary…');
    summarizeWithAI(t, '', $('tsLen').value==='detailed').then(function(md){ setBusy(b,false); toolOutMd(md); })
      .catch(function(){ setBusy(b,false); toolOut('<b>Summary from the text\'s own key sentences</b> (the AI service did not answer, so this was built from the text itself):<br><br>'+esc(extractiveSummary(t, 6))); });
  };
}
var CODE_TASKS={
  explain:'Explain what the following code does, step by step, in simple words. Point out the important parts.\n\nCode:\n',
  bugs:'Find the bugs and mistakes in the following code. List each problem, explain why it is wrong, then show the corrected code in a code block.\n\nCode:\n',
  improve:'Improve the following code: cleaner, faster and easier to read, keeping the same behaviour. Show the improved code in a code block, then a short note on what changed.\n\nCode:\n',
  comments:'Add clear, helpful comments to the following code without changing how it works. Return the full code in a code block.\n\nCode:\n'
};
function buildCodeTool(body){
  body.innerHTML='<textarea id="tcCode" rows="8" placeholder="Paste your code here — any language…"></textarea>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><select id="tcTask"><option value="explain">Explain this code</option><option value="bugs">Find bugs &amp; fix</option><option value="improve">Improve &amp; clean up</option><option value="comments">Add comments</option></select>'
    +'<button class="primary" id="tcRun" style="flex:1">Run</button></div>';
  $('tcRun').onclick=function(){
    var code=$('tcCode').value.trim();
    if(code.length<10){ toolErr('Paste some code first — at least a few lines.'); return; }
    var b=this; setBusy(b,true,'Working…'); toolLoading('ENZO is working on your code…');
    callAI(CODE_TASKS[$('tcTask').value]+code.slice(0,7000)).then(function(md){ setBusy(b,false); toolOutMd(md); })
      .catch(function(){ setBusy(b,false); toolErr('The free AI service did not answer this time. Try again in a moment.'); });
  };
}
function buildDataTool(body){
  body.innerHTML='<textarea id="tdaText" rows="7" placeholder="Paste CSV data here — first row as column names, e.g.\nMonth,Sales,Cost\nJan,1200,800\nFeb,1500,900"></textarea>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><button class="actionbtn" id="tdaFileBtn">Load .csv / .xlsx</button><input type="file" id="tdaFile" accept=".csv,.xlsx,.xls" hidden>'
    +'<button class="primary" id="tdaRun" style="flex:1">Analyze data</button></div>'
    +'<p class="toolnote">Analysis runs entirely on this device from your real numbers — totals, averages, and a chart of the first number column.</p>';
  var fileRows=null;
  $('tdaText').addEventListener('input', function(){ fileRows=null; });
  $('tdaFileBtn').onclick=function(){ $('tdaFile').click(); };
  $('tdaFile').addEventListener('change', function(){
    var f=this.files&&this.files[0]; this.value=''; if(!f) return;
    toolLoading('Reading "'+f.name+'"…');
    var done=function(rows){ fileRows=rows; $('tdaText').value=rowsToCsv(rows).slice(0,4000); $('toolOut').innerHTML=''; toast('Data loaded — tap Analyze data'); };
    if(/\.csv$/i.test(f.name)) readTextFile(f).then(function(t){ done(parseCSV(t)); }).catch(function(){ toolErr('That CSV file could not be read.'); });
    else readSpreadsheetFile(f).then(function(r){ done(r.rows); }).catch(function(){ toolErr('That spreadsheet could not be read — it may be damaged, or the reader library failed to load.'); });
  });
  $('tdaRun').onclick=function(){
    var rows=fileRows;
    if(!rows){ var t=$('tdaText').value.trim(); if(t.length<10){ toolErr('Paste CSV data or load a spreadsheet first.'); return; } rows=parseCSV(t); }
    if(rows.length<2){ toolErr('At least two rows are needed — a header row plus one data row.'); return; }
    var stats=numericColumnStats(rows);
    var cols=0; rows.forEach(function(r){ cols=Math.max(cols, r.length); });
    toolOut('<b>Your data</b> — '+rows.length+' rows × '+cols+' columns<br><br>'+tablePreviewHtml(rows)+'<br>'+statsTableHtml(stats)+barChartHtml(rows, stats[0]));
  };
}
function buildImageGenTool(body){
  body.innerHTML='<input type="text" id="tgPrompt" placeholder="Describe the image — e.g. a green valley in northern Pakistan at sunrise">'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><select id="tgSize"><option value="1024x1024">Square</option><option value="1280x720">Landscape</option><option value="720x1280">Portrait</option></select>'
    +'<button class="primary" id="tgRun" style="flex:1">Generate image</button></div>'
    +'<p class="toolnote">Images are created by the free Pollinations image service — generation usually takes a few seconds.</p>';
  $('tgRun').onclick=function(){
    var p=$('tgPrompt').value.trim();
    if(p.length<4){ toolErr('Describe the image first — a few words are enough.'); return; }
    var wh=$('tgSize').value.split('x');
    var url='https://image.pollinations.ai/prompt/'+encodeURIComponent(p)+'?width='+wh[0]+'&height='+wh[1]+'&seed='+Math.floor(Math.random()*999999)+'&nologo=true';
    toolOut('<p id="tgStatus" style="margin-top:0"><span class="spinner" style="display:inline-block;vertical-align:-4px;margin-right:8px"></span>Creating your image — this usually takes a few seconds…</p><a href="'+esc(url)+'" target="_blank" rel="noopener"><img class="toolimg" src="'+esc(url)+'" alt="Generated image: '+esc(p)+'" onload="toolImgOk()" onerror="toolImgErr()"></a>');
  };
}
function buildResearchTool(body){
  body.innerHTML='<input type="text" id="trTopic" placeholder="Type the research topic — e.g. Best budget laptops in Pakistan 2026">'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="primary" id="trDeep" style="flex:1">Run Deep Research</button><button class="actionbtn" id="trQuick">Quick answer instead</button></div>'
    +'<p class="toolnote">Deep Research searches in batches, reads the best real pages and writes a detailed, sourced report in the chat. Quick answer uses Normal mode — short and fast.</p>';
  function go(deepRun){
    var t=$('trTopic').value.trim();
    if(!t){ toolErr('Type a research topic first.'); return; }
    closeModal('toolModal'); closeModal('toolsModal');
    /* The chosen depth applies to THIS run only (forcedDeep) — the chat's
       Auto / override routing for later questions is left untouched. */
    try{ askQuestion(t, false, deepRun); }
    catch(e){
      $('input').value=t; autoGrow(); syncSendBtn();
      toast('Sending failed — your topic is back in the box. Tap Send to try again.');
    }
  }
  $('trDeep').onclick=function(){ go(true); };
  $('trQuick').onclick=function(){ go(false); };
}
var LANG_NAMES={en:'English', urdu:'Urdu script', roman:'Roman Urdu', es:'Spanish', fr:'French', ar:'Arabic', hi:'Hindi'};
var MM_CODES={en:'en', urdu:'ur', es:'es', fr:'fr', ar:'ar', hi:'hi'};
function buildTranslateTool(body){
  body.innerHTML='<textarea id="ttText" rows="5" placeholder="Type or paste the text to translate…"></textarea>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><select id="ttFrom"><option value="auto">From: Auto-detect</option><option value="en">From: English</option><option value="urdu">From: Urdu</option><option value="roman">From: Roman Urdu</option></select>'
    +'<select id="ttTo"><option value="en">To: English</option><option value="urdu">To: Urdu script</option><option value="roman">To: Roman Urdu</option><option value="es">To: Spanish</option><option value="fr">To: French</option><option value="ar">To: Arabic</option><option value="hi">To: Hindi</option></select>'
    +'<button class="primary" id="ttRun" style="flex:1">Translate</button></div>';
  $('ttRun').onclick=function(){
    var txt=$('ttText').value.trim(); var from=$('ttFrom').value; var to=$('ttTo').value;
    if(txt.length<2){ toolErr('Type the text to translate first.'); return; }
    if(from!=='auto' && from===to){ toolErr('Source and target language are the same — pick a different target.'); return; }
    var b=this; setBusy(b,true,'Translating…'); toolLoading('Translating…');
    callAI('Translate the following text into '+LANG_NAMES[to]+'. Output ONLY the translation — no explanations and no quotation marks around it.\n\n'+txt.slice(0,4000))
      .then(function(t){ setBusy(b,false); toolOutText(scrubDefeat(t)); })
      .catch(function(){
        var fc= from==='auto' ? (detectLang(txt)==='urdu'?'ur':'en') : MM_CODES[from];
        var tc=MM_CODES[to];
        if(!fc || !tc){ setBusy(b,false); toolErr('Translation failed — the AI service did not answer, and the backup translator does not support this language pair. Try again in a moment.'); return; }
        fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(txt.slice(0,450))+'&langpair='+fc+'|'+tc)
          .then(function(r){ return r.json(); })
          .then(function(j){ setBusy(b,false); var out=j && j.responseData && j.responseData.translatedText; if(out) toolOutText(out); else toolErr('Translation failed — neither service answered. Try again in a moment.'); })
          .catch(function(){ setBusy(b,false); toolErr('Translation failed — neither service answered. Check your connection and try again.'); });
      });
  };
}
var WRITE_TASKS={
  email:'Write a complete, ready-to-send email about the following. Start with a clear subject line on its own first line, then the email body. Details: ',
  application:'Write a complete, formal application / letter for the following purpose. Keep it respectful, correct and ready to use. Purpose and details: ',
  improve:'Improve the following writing: fix grammar, spelling and flow, keep the same meaning and the same language, and return only the improved version.\n\n',
  formal:'Rewrite the following text in a formal, professional tone. Return only the rewritten text.\n\n',
  shorter:'Shorten the following text to its essential points without losing any important meaning. Return only the shortened text.\n\n',
  longer:'Expand the following text with more helpful detail and explanation, keeping the same meaning and tone.\n\n'
};
function buildWritingTool(body){
  body.innerHTML='<select id="twTask" style="width:100%"><option value="email">Write an email</option><option value="application">Write an application / letter</option><option value="improve">Improve my writing</option><option value="formal">Make it formal &amp; professional</option><option value="shorter">Make it shorter</option><option value="longer">Make it longer &amp; detailed</option></select>'
    +'<textarea id="twText" rows="6" placeholder="For email/application: write the details (to whom, about what). For the other tasks: paste your text here…"></textarea>'
    +'<button class="primary" id="twRun" style="width:100%">Write it</button>';
  $('twRun').onclick=function(){
    var t=$('twText').value.trim();
    if(t.length<8){ toolErr('Write the details or paste your text first.'); return; }
    var b=this; setBusy(b,true,'Writing…'); toolLoading('ENZO is writing…');
    callAI(WRITE_TASKS[$('twTask').value]+t.slice(0,5000)).then(function(md){ setBusy(b,false); toolOutMd(md); })
      .catch(function(){ setBusy(b,false); toolErr('The free AI service did not answer this time. Try again in a moment.'); });
  };
}
var TOOL_DEFS={
  pdf:{title:'PDF Analysis', how:'Choose a PDF from your device. ENZO reads it right here in the browser, shows its text and counts, and can summarize it or send it to the chat for questions.', build:buildPdfTool},
  word:{title:'Word Document Analysis', how:'Choose a .docx document. ENZO extracts its full text in the browser, shows word counts and a preview, and can summarize it or send it to the chat.', build:buildWordTool},
  excel:{title:'Excel Spreadsheet Analysis', how:'Choose an .xlsx, .xls or .csv file. ENZO opens the first sheet in the browser, shows the table and number summaries per column — nothing is uploaded.', build:buildExcelTool},
  image:{title:'Image Understanding', how:'Choose an image and tap "Describe this image". The free AI vision service reads it and describes what it shows. Your image details are also measured locally.', build:buildImageTool},
  summarize:{title:'Document Summarization', how:'Paste any long text, or load a .txt, .docx or .pdf document, then tap Summarize. If the AI service is busy, ENZO builds the summary from the text\'s own key sentences instead.', build:buildSummarizeTool},
  code:{title:'Code Assistance', how:'Paste code in any language and choose: explain it, find bugs and fix them, improve it, or add comments. The result appears below with a copyable code block.', build:buildCodeTool},
  data:{title:'Data Analysis', how:'Paste CSV data or load a spreadsheet. ENZO computes totals, averages, min and max for every number column and draws a chart from your real values — all on this device.', build:buildDataTool},
  imagegen:{title:'Image Generation', how:'Describe the picture you want and tap Generate. The free Pollinations image service creates it; tap the result to open it full size.', build:buildImageGenTool},
  research:{title:'Research Assistance', how:'Type a topic and start a full Deep Research run — ENZO searches in batches, reads the best real pages and writes a detailed, sourced report in the chat.', build:buildResearchTool},
  translate:{title:'Translation', how:'Type or paste text, choose the languages, and tap Translate. The AI translator handles all pairs; a free backup translator covers the main languages.', build:buildTranslateTool},
  writing:{title:'Writing Assistance', how:'Write a ready-to-send email or application from your details, or improve, formalize, shorten or expand your own text. The result appears below, ready to copy.', build:buildWritingTool}
};
var TOOLS=[
  {id:'pdf', icon:'i-doc', name:'PDF Analysis', desc:'Read a PDF in your browser — text, pages, word counts, summary, chat questions.'},
  {id:'word', icon:'i-doc', name:'Word Document Analysis', desc:'Open a .docx and read its full text, counts and structure — nothing uploaded.'},
  {id:'excel', icon:'i-chart', name:'Excel Spreadsheet Analysis', desc:'Open .xlsx, .xls or .csv — table view plus totals and averages per column.'},
  {id:'image', icon:'i-img', name:'Image Understanding', desc:'Pick an image and ENZO describes what is in it with the free AI vision service.'},
  {id:'summarize', icon:'i-doc', name:'Document Summarization', desc:'Paste text or load a document and get a clear summary of the key points.'},
  {id:'code', icon:'i-code', name:'Code Assistance', desc:'Explain code, find and fix bugs, clean it up, or add comments.'},
  {id:'data', icon:'i-chart', name:'Data Analysis', desc:'Paste CSV or load a sheet — real totals, averages and a chart from your numbers.'},
  {id:'imagegen', icon:'i-img', name:'Image Generation', desc:'Describe a picture and ENZO creates it with the free image service.'},
  {id:'research', icon:'i-flask', name:'Research Assistance', desc:'Start a full Deep Research run on any topic, with live sources.'},
  {id:'deepmode', icon:'i-flask', name:'Deep Research', desc:'Override the automatic routing for this chat: Auto (ENZO decides per question), ON (always Deep Research) or OFF (always Normal).'},
  {id:'translate', icon:'i-lang', name:'Translation', desc:'Translate between English, Urdu, Roman Urdu, Spanish, French, Arabic and Hindi.'},
  {id:'writing', icon:'i-pen', name:'Writing Assistance', desc:'Emails, applications, and improving or polishing your own text.'}
];
function renderTools(){
  var g=$('toolsGrid'); if(!g) return;
  g.innerHTML='';
  TOOLS.forEach(function(t){
    var b=document.createElement('button'); b.className='toolcard'; b.type='button';
    var cardName=t.name; var cardDesc=t.desc;
    if(t.id==='deepmode'){
      /* The card shows the chat's real routing state — Auto, forced ON or
         forced OFF — and tapping cycles to the next one, so the override
         can always be changed or removed from the same place. */
      var cm=chatMode();
      if(cm==='deep'){ cardName='Deep Research — ON for this chat'; cardDesc='Override ON: every answer in this chat uses Deep Research, whatever the question. Tap to force Normal answers for this chat instead.'; }
      else if(cm==='normal'){ cardName='Deep Research — OFF for this chat'; cardDesc='Override OFF: every answer in this chat stays Normal, whatever the question. Tap to return to Auto — ENZO decides the depth per question.'; }
      else { cardName='Deep Research — Auto'; cardDesc='Auto (default): ENZO routes each question itself — comparison, latest-news, in-detail and multi-part questions get Deep Research; short factual ones stay Normal. Tap to force Deep Research ON for this chat.'; }
    }
    b.innerHTML='<b><svg class="ic"><use href="#'+t.icon+'"/></svg>'+esc(cardName)+'</b><span>'+esc(cardDesc)+'</span>';
    b.onclick=function(){
      if(t.id==='deepmode'){
        /* The override cycles Auto → ON → OFF → Auto. While it is ON, the
           bar above the composer also offers a one-tap switch off (which
           lands on OFF — this chat stays Normal until changed here). */
        var cmNow=chatMode();
        closeModal('toolsModal'); setChatMode(cmNow==='auto' ? 'deep' : (cmNow==='deep' ? 'normal' : 'auto'));
        var inp=$('input'); if(inp){ inp.scrollIntoView({behavior:'smooth',block:'center'}); inp.focus(); }
        return;
      }
      openTool(t.id);
    };
    g.appendChild(b);
  });
}
function openTool(id){
  var d=TOOL_DEFS[id]; if(!d) return;
  $('toolTitle').textContent=d.title;
  $('toolHow').textContent=d.how;
  $('toolOut').innerHTML=''; $('toolBody').innerHTML='';
  d.build($('toolBody'));
  closeModal('toolsModal'); openModal('toolModal');
}
function openTools(){ renderTools(); openModal('toolsModal'); }
$('toolsBtn').onclick=openTools;
$('toolsBtnSide').onclick=function(){ openTools(); $('sidebar').classList.remove('open'); };
var moreToolsBtnEl=$('moreToolsBtn'); if(moreToolsBtnEl) moreToolsBtnEl.onclick=function(){ openTools(); };

/* --- Settings: profile, preferences, data — fully wired --- */
function applyProfile(){
  var signedOut=loadPref('enao_signed_out','0')==='1';
  var name=signedOut ? 'Guest' : (loadPref('enao_name','Raja')||'Raja');
  var photo=signedOut ? '' : loadPref('enao_avatar','');
  var initial=(name.trim().charAt(0)||'R').toUpperCase();
  ['profileAvatar','setAvatar','profileBtn'].forEach(function(id){
    var el=$(id); if(!el) return;
    if(photo) el.innerHTML='<img src="'+photo+'" alt="Profile photo">';
    else el.textContent=initial;
  });
  var pn=$('profileName'); if(pn) pn.textContent=name;
  var sn=$('setProfileName'); if(sn) sn.textContent=name;
}
function refreshSettingsUI(){
  var msgs=0; state.chats.forEach(function(c){ msgs+=(c.messages||[]).length; });
  var hc=$('historyCount'); if(hc) hc.textContent=state.chats.length+' chat'+(state.chats.length===1?'':'s')+' • '+msgs+' messages saved in this browser';
  var dn=$('displayName'); if(dn) dn.value=loadPref('enao_signed_out','0')==='1' ? 'Guest' : loadPref('enao_name','Raja');
  if(window.EnzoLang48){ try{ window.EnzoLang48.syncLangSelect($('langPref'), state); }catch(e){} try{ window.EnzoLang48.patchSettingsDescription($('langPrefDesc')); }catch(e){} } else { var lp=$('langPref'); if(lp) lp.value=state.langPref; }
  var vr=$('voiceRate'); if(vr) vr.value=loadPref('enao_voice_rate','0.95');
  syncThemeBtn();
  applyProfile();
}
function wireSwitch(id, get, set){
  var el=$(id); if(!el) return;
  function sync(){ el.setAttribute('aria-checked', get()?'true':'false'); }
  el.onclick=function(){ set(!get()); sync(); };
  sync();
}
if(window.EnzoLang48){ try{ window.EnzoLang48.patchLoadLangPref(state); }catch(e){} try{ window.EnzoLang48.patchLangSelect($('langPref'), state); }catch(e){} } else { state.langPref=loadPref('enao_lang','auto'); }
state.sourcesOn=loadPref('enao_sources','1')==='1';
wireSwitch('notifSwitch', function(){ return state.notifOn; }, function(v){ state.notifOn=v; savePref('enao_notif', v?'1':'0'); toast(v?'In-page notifications ON':'In-page notifications OFF'); });
wireSwitch('sourcesSwitch', function(){ return state.sourcesOn; }, function(v){ state.sourcesOn=v; savePref('enao_sources', v?'1':'0'); toast(v?'Sources will be listed under answers':'Answers will come without a source list'); });
$('settingsBtn').onclick=function(){ refreshSettingsUI(); openModal('settingsModal'); };
$('profileBtn').onclick=function(){ refreshSettingsUI(); openModal('settingsModal'); };
$('saveSettings').onclick=function(){
  var nm=$('displayName').value.trim();
  if(nm){ savePref('enao_name', nm); try{ localStorage.removeItem('enao_signed_out'); }catch(e){} }
  if(window.EnzoLang48){ window.EnzoLang48.patchSaveLangPref(state, $('langPref')); } else { state.langPref=$('langPref').value; savePref('enao_lang', state.langPref); }
  savePref('enao_voice_rate', $('voiceRate').value);
  applyProfile();
  toast('Settings saved');
  closeModal('settingsModal');
};
$('avatarBtn').onclick=function(){ $('avatarInput').click(); };
$('avatarInput').addEventListener('change', function(){
  var f=this.files&&this.files[0]; this.value=''; if(!f) return;
  if(f.type.indexOf('image/')!==0){ toast('Please choose an image file for your photo'); return; }
  if(f.size>15*1024*1024){ toast('That photo is too large — please choose one under 15 MB'); return; }
  fileToScaledDataUrl(f, 96).then(function(r){
    try{ localStorage.setItem('enao_avatar', r.dataUrl); }catch(e){ toast('That photo is too large to keep in this browser'); return; }
    try{ localStorage.removeItem('enao_signed_out'); }catch(e){}
    applyProfile(); toast('Profile photo updated');
  }).catch(function(){ toast('That image could not be opened — try a PNG or JPG'); });
});
$('avatarRemove').onclick=function(){ try{ localStorage.removeItem('enao_avatar'); }catch(e){} applyProfile(); toast('Profile photo removed'); };
$('exportBtn').onclick=function(){
  if(!state.chats.length){ toast('No chats to export yet'); return; }
  var lines=['ENZO AI — my chats (exported '+new Date().toLocaleString()+')',''];
  state.chats.slice().reverse().forEach(function(c){
    lines.push('=== '+c.title+' — '+(c.created?new Date(c.created).toLocaleString():'')+' ===');
    (c.messages||[]).forEach(function(m){ lines.push((m.role==='user'?'You: ':'ENZO: ')+(m.text||m.plain||stripHtml(m.html||''))); lines.push(''); });
    lines.push('');
  });
  var blob=new Blob([lines.join('\n')], {type:'text/plain'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='enao-chats.txt';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast('Your chats were downloaded as a text file');
};
$('clearChatsBtn').onclick=function(){
  confirmAction('Clear all chats?', 'Every conversation saved in this browser will be permanently deleted. This cannot be undone.', 'Yes, clear everything', function(){
    state.chats=[]; state.activeId=null; state.menuChatId=null;
    createChat('New Chat');
    renderChatList(); renderMessages(); refreshSettingsUI();
    toast('All chats cleared');
  });
};
function openPlan(){
  var msgs=0; state.chats.forEach(function(c){ msgs+=(c.messages||[]).length; });
  $('statChats').textContent=state.chats.length;
  $('statMsgs').textContent=msgs;
  $('statSearches').textContent=state.usage;
  closeModal('settingsModal'); openModal('planModal');
}
$('planBtn').onclick=openPlan;
$('planBtn2').onclick=openPlan;
$('signOutBtn').onclick=function(){
  confirmAction('Sign out of this browser profile?', 'Your display name and profile photo will be reset on this device. Your chats stay saved in this browser — use "Delete account & all my ENZO data" if you want them erased too.', 'Sign out', function(){
    try{ localStorage.removeItem('enao_name'); localStorage.removeItem('enao_avatar'); localStorage.setItem('enao_signed_out','1'); }catch(e){}
    applyProfile(); refreshSettingsUI(); closeModal('settingsModal');
    toast('Signed out — this browser now shows the Guest profile');
  });
};
$('deleteDataBtn').onclick=function(){
  confirmAction('Delete account & all my ENZO data?', 'Every chat, setting, preference and your profile photo stored by ENZO in this browser will be erased, and the page will reload fresh. This cannot be undone.', 'Yes, delete everything', function(){
    var keys=[];
    try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('enao')===0) keys.push(k); } keys.forEach(function(k){ localStorage.removeItem(k); }); }catch(e){}
    location.reload();
  });
};
applyProfile();

