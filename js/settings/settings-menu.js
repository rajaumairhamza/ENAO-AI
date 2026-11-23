
/* ================= SETTINGS MENU — Muse-style sections =================
   The existing Settings card becomes a sectioned menu. Every control that
   already existed (profile, preferences, voice, export, clear, sign out,
   delete, accounts, rules, learned view, background collection) is MOVED —
   never rebuilt — into its section, so all existing wiring keeps working.
   New sections are real too: Browsers reads this browser's actual
   capabilities, Wallet / Secure Stores / Message Channels are the user's
   own records kept in this browser, Devices describes this real device,
   Voice & Avatar drives the device's speech voices for real, and
   Help & Support opens the existing Help and Feedback flows. */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function escH(s){ return (typeof esc==='function') ? esc(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function lsGet(k,d){ try{ var v=localStorage.getItem(k); return v===null?d:v; }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function lsJ(k,d){ try{ var j=JSON.parse(localStorage.getItem(k)||'null'); return j==null?d:j; }catch(e){ return d; } }
function lsJS(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function newId(){ return (typeof uid==='function') ? uid() : 'x'+Date.now().toString(36)+Math.floor(Math.random()*9999); }
function toast2(m){ if(typeof toast==='function') toast(m); }
function kv(k, v){ return '<div class="setrow"><div class="sr-txt"><b>'+k+'</b></div><span class="kv-val">'+v+'</span></div>'; }
function browserInfo(){
  var ua=navigator.userAgent||'', name='This browser', ver='', m;
  if((m=/Edg\/([\d.]+)/.exec(ua))){ name='Microsoft Edge'; ver=m[1]; }
  else if((m=/OPR\/([\d.]+)/.exec(ua))){ name='Opera'; ver=m[1]; }
  else if((m=/Chrome\/([\d.]+)/.exec(ua))){ name='Google Chrome'; ver=m[1]; }
  else if((m=/Firefox\/([\d.]+)/.exec(ua))){ name='Mozilla Firefox'; ver=m[1]; }
  else if((m=/Version\/([\d.]+).*Safari/.exec(ua))){ name='Safari'; ver=m[1]; }
  var os='Unknown';
  if(/Windows NT/.test(ua)) os='Windows'; else if(/Android/.test(ua)) os='Android';
  else if(/iPhone|iPad/.test(ua)) os='iOS'; else if(/Mac OS X/.test(ua)) os='macOS'; else if(/Linux/.test(ua)) os='Linux';
  return {name:name, ver:ver, os:os, mobile:/Mobi|Android|iPhone|iPad/.test(ua)};
}

var NAV=[['profile','Profile'],['connectors','Connectors'],['browsers','Browsers'],['wallet','Wallet'],['vault','Secure Stores'],['permissions','Permissions'],['channels','Message Channels'],['devices','Devices'],['data','Data Control'],['voice','Voice & Avatar'],['help','Help & Support']];
var paneEls={};

function buildSettingsMenu(){
  var card=document.querySelector('#settingsModal .modal-card');
  if(!card || $('setNav')) return;
  var footers=[];
  ['saveSettings','signOutBtn','deleteDataBtn'].forEach(function(id){ var el=$(id); if(el) footers.push(el); });
  var kids=Array.prototype.slice.call(card.children);
  kids.forEach(function(el){ if(el.tagName==='BUTTON' && !el.id && el.classList.contains('ghost')) footers.push(el); });

  var layout=document.createElement('div'); layout.className='setlayout';
  var nav=document.createElement('div'); nav.className='setnav'; nav.id='setNav';
  var panes=document.createElement('div'); panes.className='setpanes';
  layout.appendChild(nav); layout.appendChild(panes);
  NAV.forEach(function(n){
    var b=document.createElement('button');
    b.type='button'; b.textContent=n[1]; b.setAttribute('data-setpane', n[0]);
    if(n[0]==='profile') b.classList.add('active');
    b.onclick=function(){ setPane(n[0]); };
    nav.appendChild(b);
    var p=document.createElement('div');
    p.className='setpane'+(n[0]==='profile'?' active':''); p.id='setpane-'+n[0];
    panes.appendChild(p); paneEls[n[0]]=p;
  });
  function setPane(key){
    NAV.forEach(function(n){ paneEls[n[0]].classList.toggle('active', n[0]===key); });
    nav.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-setpane')===key); });
    if(key==='browsers') renderBrowsers();
    if(key==='devices') renderDevices();
    if(key==='permissions' && typeof window.__renderPerms==='function') window.__renderPerms();
  }
  window.__setPane=setPane;

  /* --- move the existing settings content into its sections --- */
  var HEADING_PANE={'Profile':'profile','Preferences':'profile','Voice':'voice','Notifications':'profile','Privacy & data':'data','Account security':'data','Subscription':'profile'};
  var current='profile', introSeen=false, voiceExtras=[];
  kids.forEach(function(el){
    if(el.tagName==='H3') return;
    if(el.tagName==='P' && !introSeen){ introSeen=true; return; }
    if(footers.indexOf(el)>-1) return;
    if(el.id==='accountsBox'){ paneEls.connectors.appendChild(el); return; }
    if(el.id==='rulesBox'){ paneEls.permissions.appendChild(el); return; }
    if(el.id==='learnedBox'){ paneEls.data.appendChild(el); return; }
    if(el.querySelector && el.querySelector('#bgCollectBtn')){ paneEls.data.appendChild(el); return; }
    if(el.querySelector && el.querySelector('#avatarBtn')){ voiceExtras.push(el); return; }
    if(el.classList && el.classList.contains('toolnote')){ voiceExtras.push(el); return; }
    if(el.tagName==='H4' && el.classList.contains('setsec')){
      var t=el.textContent.trim();
      if(t==='Appearance'){ el.remove(); current='profile'; return; }
      current=HEADING_PANE[t]||'profile';
      paneEls[current].appendChild(el); return;
    }
    paneEls[current].appendChild(el);
  });

  card.appendChild(layout);
  footers.forEach(function(f){ card.appendChild(f); });

  buildConnectorsPane();
  buildBrowsersPane();
  buildWalletPane();
  buildVaultPane();
  buildPermissionsPane();
  buildChannelsPane();
  buildDevicesPane();
  buildVoicePane(voiceExtras);
  /* v55 P7 voice-id: enrollment card in the Voice pane. Guarded — the
     settings panes are built before EnzoVoiceID loads, so the assembly
     glue at the end of the page performs the mount once it exists. */
  try{ if(paneEls.voice && window.EnzoVoiceID){ var vidCard=document.createElement('div'); vidCard.innerHTML=window.EnzoVoiceID.enrollmentHTML(); paneEls.voice.appendChild(vidCard); window.EnzoVoiceID.mountEnrollment(vidCard); } }catch(e){}
  buildHelpPane();
  if(typeof window.__buildPermLists==='function') window.__buildPermLists();
  if(typeof window.__renderPerms==='function') window.__renderPerms();
}

function buildConnectorsPane(){
  var p=paneEls.connectors; if(!p) return;
  var head=document.createElement('div');
  head.innerHTML='<h4 class="setsec">Connectors</h4><p class="lrn-note">The accounts and platforms ENZO works with for you. Platform work is always prepared for the active connector, named before anything happens, and sending, posting, publishing or deleting always needs your approval first.</p>';
  p.insertBefore(head, p.firstChild);
}
function buildBrowsersPane(){
  var p=paneEls.browsers; if(!p) return;
  p.innerHTML='<h4 class="setsec">Browsers</h4>'
    +'<p class="lrn-note">ENZO runs inside the browser you open it in — there is no separate ENZO browser to install. This is the browser serving ENZO right now, with its real capabilities.</p>'
    +'<div id="browserRows"></div>'
    +'<div class="setrow"><div class="sr-txt"><b>Microphone</b><span>Needed for voice talk and dictation. Current permission: <span data-ps="mic"></span></span></div><button type="button" class="actionbtn" data-perm-act="mic">Allow microphone</button></div>';
  renderBrowsers();
}
function renderBrowsers(){
  var box=$('browserRows'); if(!box) return;
  var bi=browserInfo();
  var recog=('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
  var voices=('speechSynthesis' in window) ? window.speechSynthesis.getVoices().length : 0;
  box.innerHTML =
    kv('Browser', escH(bi.name)+(bi.ver?' '+escH(bi.ver.split('.').slice(0,2).join('.')):''))+
    kv('Voice input (speech recognition)', recog?'Supported':'Not supported in this browser')+
    kv('Spoken answers (speech synthesis)', ('speechSynthesis' in window)?('Supported · '+voices+' voices installed'):'Not supported in this browser')+
    kv('Connection', navigator.onLine?'Online':'Offline')+
    kv('Cookies', navigator.cookieEnabled?'Enabled':'Disabled')+
    kv('Browser language', escH(navigator.language||'—'));
}
function buildWalletPane(){
  var p=paneEls.wallet; if(!p) return;
  p.innerHTML='<h4 class="setsec">Wallet</h4>'
    +'<p class="lrn-note">Your own payment methods, kept only in this browser for platform work ENZO prepares for you. Only the last 4 digits are ever stored — never a full card or account number. ENZO itself is Lifetime Free and never charges anything; any payment is always your own final step, in your own app.</p>'
    +'<div class="mini-form"><select id="walType" aria-label="Payment method type"><option>Card</option><option>Bank account</option><option>JazzCash</option><option>Easypaisa</option><option>NayaPay</option><option>SadaPay</option><option>Other wallet</option></select>'
    +'<input type="text" id="walLabel" placeholder="Label, e.g. My main card" aria-label="Payment method label">'
    +'<input type="text" id="walLast4" placeholder="Last 4 digits" maxlength="4" inputmode="numeric" aria-label="Last 4 digits">'
    +'<button type="button" class="lrn-toggle" id="walAddBtn">Add</button></div>'
    +'<div id="walletList"></div>';
  $('walAddBtn').onclick=function(){
    var label=$('walLabel').value.trim(), last4=$('walLast4').value.trim();
    if(!label){ toast2('Give the payment method a label first'); return; }
    if(last4 && !/^\d{4}$/.test(last4)){ toast2('Last 4 must be exactly 4 digits — or leave it empty'); return; }
    var arr=lsJ('enao_wallet_v1',[]);
    arr.push({id:newId(), type:$('walType').value, label:label.slice(0,60), last4:last4});
    lsJS('enao_wallet_v1', arr);
    $('walLabel').value=''; $('walLast4').value='';
    renderWallet(); toast2('Payment method saved in this browser');
  };
  renderWallet();
}
function renderWallet(){
  var box=$('walletList'); if(!box) return;
  var arr=lsJ('enao_wallet_v1',[]);
  if(!arr.length){ box.innerHTML='<div class="lrn-row"><span>No payment methods saved yet.</span></div>'; return; }
  box.innerHTML=arr.map(function(w){
    return '<div class="lrn-corr"><span><b>'+escH(w.label)+'</b> <span style="color:var(--muted)">'+escH(w.type)+(w.last4?' ···· '+escH(w.last4):'')+'</span></span><button type="button" class="lrn-x" data-wallet-del="'+escH(w.id)+'">Delete</button></div>';
  }).join('');
  box.querySelectorAll('[data-wallet-del]').forEach(function(b){
    b.onclick=function(){
      lsJS('enao_wallet_v1', lsJ('enao_wallet_v1',[]).filter(function(x){ return x.id!==b.getAttribute('data-wallet-del'); }));
      renderWallet(); toast2('Payment method deleted');
    };
  });
}
function buildVaultPane(){
  var p=paneEls.vault; if(!p) return;
  p.innerHTML='<h4 class="setsec">Secure Stores</h4>'
    +'<p class="lrn-note">A store for logins and keys ENZO may need for your platform work, kept only in this browser. Honest warning: like everything in ENZO, entries sit in this browser\u2019s storage — anyone who can open this browser can open this store, so keep only what you are comfortable keeping here, and delete anything any time.</p>'
    +'<div class="mini-form"><input type="text" id="vaultName" placeholder="Name, e.g. Fiverr login" aria-label="Entry name">'
    +'<input type="text" id="vaultUser" placeholder="Username or email" aria-label="Username">'
    +'<input type="password" id="vaultSecret" placeholder="Password or key" aria-label="Password or key">'
    +'<button type="button" class="lrn-toggle" id="vaultAddBtn">Store it</button></div>'
    +'<div id="vaultList"></div>';
  $('vaultAddBtn').onclick=function(){
    var name=$('vaultName').value.trim(), user=$('vaultUser').value.trim(), secret=$('vaultSecret').value;
    if(!name || !secret){ toast2('Write at least a name and the password or key'); return; }
    var arr=lsJ('enao_vault_v1',[]);
    arr.push({id:newId(), name:name.slice(0,60), user:user.slice(0,80), secret:secret.slice(0,300)});
    lsJS('enao_vault_v1', arr);
    $('vaultName').value=''; $('vaultUser').value=''; $('vaultSecret').value='';
    renderVault(); toast2('Stored in this browser');
  };
  renderVault();
}
var vaultShown={};
function renderVault(){
  var box=$('vaultList'); if(!box) return;
  var arr=lsJ('enao_vault_v1',[]);
  if(!arr.length){ box.innerHTML='<div class="lrn-row"><span>Nothing stored yet.</span></div>'; return; }
  box.innerHTML=arr.map(function(v){
    var shown=!!vaultShown[v.id];
    return '<div class="lrn-corr"><span><b>'+escH(v.name)+'</b>'+(v.user?' <span style="color:var(--muted)">'+escH(v.user)+'</span>':'')+'<br><span style="font-family:monospace">'+(shown?escH(v.secret):'••••••••')+'</span></span>'
      +'<span style="display:flex;gap:6px"><button type="button" class="lrn-x" data-vault-show="'+escH(v.id)+'">'+(shown?'Hide':'Show')+'</button><button type="button" class="lrn-x" data-vault-del="'+escH(v.id)+'">Delete</button></span></div>';
  }).join('');
  box.querySelectorAll('[data-vault-show]').forEach(function(b){
    b.onclick=function(){ var id=b.getAttribute('data-vault-show'); vaultShown[id]=!vaultShown[id]; renderVault(); };
  });
  box.querySelectorAll('[data-vault-del]').forEach(function(b){
    b.onclick=function(){
      lsJS('enao_vault_v1', lsJ('enao_vault_v1',[]).filter(function(x){ return x.id!==b.getAttribute('data-vault-del'); }));
      renderVault(); toast2('Entry deleted');
    };
  });
}
function buildPermissionsPane(){
  var p=paneEls.permissions; if(!p) return;
  var head=document.createElement('div');
  head.innerHTML='<h4 class="setsec">Permissions</h4><p class="lrn-note">What ENZO is allowed to do — the same switches as the right panel, always in sync. Below them are your own rules, which ENZO follows in every answer.</p><div data-perm-list></div>';
  p.insertBefore(head, p.firstChild);
}
function buildChannelsPane(){
  var p=paneEls.channels; if(!p) return;
  p.innerHTML='<h4 class="setsec">Message Channels</h4>'
    +'<p class="lrn-note">Your messaging accounts. ENZO prepares messages and replies for a channel in full detail; sending always happens in your own app, with your approval — ENZO never sends silently.</p>'
    +'<div class="mini-form"><select id="chType" aria-label="Channel"><option>WhatsApp</option><option>Messenger</option><option>Telegram</option><option>Instagram</option><option>Email</option><option>SMS</option></select>'
    +'<input type="text" id="chHandle" placeholder="Number, handle or email address" aria-label="Channel handle">'
    +'<button type="button" class="lrn-toggle" id="chAddBtn">Add channel</button></div>'
    +'<div id="channelsList"></div>';
  $('chAddBtn').onclick=function(){
    var h=$('chHandle').value.trim();
    if(!h){ toast2('Write the number, handle or email first'); return; }
    var arr=lsJ('enao_channels_v1',[]);
    arr.push({id:newId(), type:$('chType').value, handle:h.slice(0,100)});
    lsJS('enao_channels_v1', arr);
    $('chHandle').value='';
    renderChannels(); toast2('Channel added');
  };
  renderChannels();
}
function renderChannels(){
  var box=$('channelsList'); if(!box) return;
  var arr=lsJ('enao_channels_v1',[]);
  if(!arr.length){ box.innerHTML='<div class="lrn-row"><span>No message channels added yet.</span></div>'; return; }
  box.innerHTML=arr.map(function(c){
    var act='';
    if(c.type==='Email') act='<a class="lrn-x" href="mailto:'+escH(c.handle)+'">Write email</a>';
    else if(c.type==='WhatsApp'){ var digits=c.handle.replace(/[^\d]/g,''); if(digits) act='<a class="lrn-x" href="https://wa.me/'+digits+'" target="_blank" rel="noopener">Open chat</a>'; }
    return '<div class="lrn-corr"><span><b>'+escH(c.type)+'</b> <span style="color:var(--muted)">'+escH(c.handle)+'</span></span><span style="display:flex;gap:6px">'+act+'<button type="button" class="lrn-x" data-ch-del="'+escH(c.id)+'">Delete</button></span></div>';
  }).join('');
  box.querySelectorAll('[data-ch-del]').forEach(function(b){
    b.onclick=function(){
      lsJS('enao_channels_v1', lsJ('enao_channels_v1',[]).filter(function(x){ return x.id!==b.getAttribute('data-ch-del'); }));
      renderChannels(); toast2('Channel removed');
    };
  });
}
function buildDevicesPane(){
  var p=paneEls.devices; if(!p) return;
  p.innerHTML='<h4 class="setsec">Devices</h4>'
    +'<p class="lrn-note">ENZO keeps everything in the browser on each device — there is no server sync, so every device holds its own chats, library and settings. This is the device you are using right now.</p>'
    +'<div id="deviceRows"></div>';
  renderDevices();
}
function renderDevices(){
  var box=$('deviceRows'); if(!box) return;
  var bi=browserInfo();
  var tz='—'; try{ tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'—'; }catch(e){}
  box.innerHTML =
    kv('This device', (bi.mobile?'Mobile / tablet':'Desktop / laptop')+' · '+escH(bi.os))+
    kv('Browser', escH(bi.name)+(bi.ver?' '+escH(bi.ver.split('.').slice(0,2).join('.')):''))+
    kv('Screen', window.screen.width+' × '+window.screen.height)+
    kv('Timezone', escH(tz))+
    kv('Language', escH(navigator.language||'—'))+
    kv('Touch', ('ontouchstart' in window)?'Supported':'Not supported')+
    kv('Connection', navigator.onLine?'Online':'Offline')+
    kv('Browser storage for ENZO', '<span id="storageVal">Measuring…</span>');
  if(navigator.storage && navigator.storage.estimate){
    navigator.storage.estimate().then(function(est){
      var el=$('storageVal');
      if(el && est && est.usage!=null) el.textContent=(est.usage/1048576).toFixed(1)+' MB used of '+(est.quota?(est.quota/1073741824).toFixed(1)+' GB available':'—');
      else if(el) el.textContent='Not measurable in this browser';
    }).catch(function(){ var el=$('storageVal'); if(el) el.textContent='Not measurable in this browser'; });
  } else { var el2=$('storageVal'); if(el2) el2.textContent='Not measurable in this browser'; }
}
function fillVoices(){
  var sel=$('enzoVoiceSel');
  if(!sel || !('speechSynthesis' in window)) return;
  var vs=window.speechSynthesis.getVoices();
  var cur=lsGet('enao_voice_uri','');
  var h='<option value="">Automatic — best voice for each language</option>';
  vs.forEach(function(v){ h+='<option value="'+escH(v.voiceURI)+'"'+(v.voiceURI===cur?' selected':'')+'>'+escH(v.name)+' ('+escH(v.lang)+')</option>'; });
  sel.innerHTML=h;
}
function buildVoicePane(voiceExtras){
  var p=paneEls.voice; if(!p) return;
  var head=document.createElement('div');
  head.innerHTML='<h4 class="setsec">ENZO\u2019s voice &amp; avatar</h4>'
    +'<div class="enzo-ava-row"><img src="./assets/enzo-avatar.webp" alt="ENZO — your AI buddy"><div><b>ENZO</b><span>The live 3D companion in the right panel — he listens, thinks, speaks and reacts while you talk.</span></div></div>'
    +'<div class="setrow"><div class="sr-txt"><b>ENZO\u2019s voice</b><span>Which of this device\u2019s installed voices ENZO speaks with. \u201CAutomatic\u201D picks the best voice for each language on this device. If this device has no voice for a language, ENZO says so and uses the closest voice.</span></div><select id="enzoVoiceSel" aria-label="ENZO\u2019s voice"></select></div>'
    +'<button type="button" class="actionbtn" id="enzoVoiceTest" style="margin:4px 0 6px">Hear this voice</button>';
  p.insertBefore(head, p.firstChild);
  try{ if(window.EnzoLang48) window.EnzoLang48.patchVoicePickerNote(head); }catch(e){}
  var ph=document.createElement('h4');
  ph.className='setsec'; ph.textContent='Your profile photo';
  p.appendChild(ph);
  voiceExtras.forEach(function(el){ p.appendChild(el); });
  var sel=$('enzoVoiceSel');
  if(sel) sel.onchange=function(){ lsSet('enao_voice_uri', sel.value); toast2(sel.value?'ENZO will speak with this voice':'ENZO voice set to Automatic'); };
  var test=$('enzoVoiceTest');
  if(test) test.onclick=function(){
    if(!('speechSynthesis' in window)){ toast2('Voice playback is not supported in this browser'); return; }
    try{
      window.speechSynthesis.cancel();
      var uri=lsGet('enao_voice_uri','');
      var selVoice46=null;
      if(uri){ var vs=window.speechSynthesis.getVoices(); for(var i=0;i<vs.length;i++) if(vs[i].voiceURI===uri){ selVoice46=vs[i]; break; } }
      var u=new SpeechSynthesisUtterance(window.EnzoLang46?window.EnzoLang46.testSentenceForVoice(selVoice46):'Hello, I am ENZO — your AI buddy. This is the voice I will use when I speak to you.');
      if(selVoice46) u.voice=selVoice46;
      var vr=$('voiceRate'); if(vr) u.rate=parseFloat(vr.value||'0.95');
      window.speechSynthesis.speak(u);
    }catch(e){ toast2('Voice playback failed in this browser'); }
  };
  fillVoices();
  if('speechSynthesis' in window && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', fillVoices);
  /* The chosen voice applies to every spoken answer: wrap speak() once and
     set the saved voice on any utterance that does not already carry one. */
  if('speechSynthesis' in window && !window.__enzoVoicePatched){
    window.__enzoVoicePatched=true;
    var origSpeak=window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak=function(u){
      try{
        var uri=lsGet('enao_voice_uri','');
        if(window.EnzoLang46){ try{ window.EnzoLang46.guardSavedVoice(u, uri, window.speechSynthesis.getVoices()); }catch(e){} }
        else if(uri && u && !u.voice){
          var vs=window.speechSynthesis.getVoices();
          for(var i=0;i<vs.length;i++) if(vs[i].voiceURI===uri){ u.voice=vs[i]; break; }
        }
      }catch(e){}
      return origSpeak(u);
    };
  }
}
function buildHelpPane(){
  var p=paneEls.help; if(!p) return;
  p.innerHTML='<h4 class="setsec">Help &amp; Support</h4>'
    +'<div class="setrow"><div class="sr-txt"><b>Help &amp; FAQ</b><span>Guides, answers and how everything in ENZO works.</span></div><button type="button" class="actionbtn" id="helpGoBtn">Open Help</button></div>'
    +'<div class="setrow"><div class="sr-txt"><b>Send feedback</b><span>Tell us what to improve — your note is copied, ready to paste anywhere.</span></div><button type="button" class="actionbtn" id="fbGoBtn">Write feedback</button></div>'
    +'<div class="setrow"><div class="sr-txt"><b>Report a problem</b><span>Something broken? Describe it and it is copied as a report, ready to send.</span></div><button type="button" class="actionbtn" id="bugGoBtn">Report</button></div>'
    +'<div class="setrow"><div class="sr-txt"><b>ENZO is Lifetime Free</b><span>Every feature is included free for life — no paid plans, no card, nothing ever expires, so there is never a billing problem to report.</span></div></div>';
  $('helpGoBtn').onclick=function(){ if(typeof closeModal==='function') closeModal('settingsModal'); if(typeof openModal==='function') openModal('helpModal'); };
  $('fbGoBtn').onclick=function(){ if(typeof closeModal==='function') closeModal('settingsModal'); if(typeof openModal==='function') openModal('feedbackModal'); };
  $('bugGoBtn').onclick=function(){ if(typeof closeModal==='function') closeModal('settingsModal'); if(typeof openModal==='function') openModal('feedbackModal'); };
}

buildSettingsMenu();
if(typeof window.refreshSettingsUI==='function'){
  var prevRefreshSet=window.refreshSettingsUI;
  window.refreshSettingsUI=function(){
    var r=prevRefreshSet.apply(this, arguments);
    if(typeof window.__renderPerms==='function') window.__renderPerms();
    renderWallet(); renderVault(); renderChannels(); fillVoices();
    return r;
  };
}
})();
