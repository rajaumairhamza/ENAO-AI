
/* PIECE 47 — EnzoHearDebug47 on-device mic debug readout (enao-hear-fix, v64-voice-live). Settings-only, read-only. */
// ===== BEGIN MODULE — insert whole block as a new <script> before </body> =====
(function(root){
  'use strict';
  /* Read-only, on-device-only. No network, no storage writes, no new
     permissions (permissions.query never prompts), no TTS, no gate change.
     ES5, guarded everywhere: any failure here must never break the mic path. */
  var STORAGE_PROFILES = 'enao_voiceid_profiles_v1';
  var STORAGE_LANG = 'enao_lang';
  var ENERGY_DEFAULT = 0.015;
  var last = freshLast();
  var boxEl = null, bodyEl = null, installed = false, permQueryInFlight = false;

  function freshLast(){
    return {
      at: null, recognitionLang: null, interim: '', finalTxt: '',
      gateEnergy: null, gateFrames: null,
      gateDecision: null, gateReason: null, gateScore: null,
      gateMatchedProfile: null, gateVoiceCheck: null, gateSurfaced: null,
      lastError: null, lastErrorAt: null,
      micPermission: 'unknown — not checked yet'
    };
  }
  function safeGet(k){
    try{
      if(typeof localStorage !== 'undefined'){
        var v = localStorage.getItem(k);
        return v === null ? null : v;
      }
    }catch(e){}
    return null;
  }
  function srSupported(){
    try{ return !!(root.SpeechRecognition || root.webkitSpeechRecognition); }
    catch(e){ return false; }
  }
  function energyThreshold(){
    try{
      if(root.EnzoVoiceID && typeof root.EnzoVoiceID.ENERGY_THRESHOLD === 'number')
        return root.EnzoVoiceID.ENERGY_THRESHOLD;
    }catch(e){}
    return ENERGY_DEFAULT;
  }
  /* Energy/frames re-read just after the gate ran — the value the gate
     judged (RC1: trailing silence vs speech). Null when the window is
     empty/stale, exactly as currentWindowFeatures() reports it. */
  function windowFeatures(){
    try{
      if(root.EnzoVoiceID && typeof root.EnzoVoiceID.currentWindowFeatures === 'function'){
        var w = root.EnzoVoiceID.currentWindowFeatures();
        if(w) return {
          energy: (typeof w.energy === 'number' ? w.energy : null),
          frames: (typeof w.frames === 'number' ? w.frames : null)
        };
      }
    }catch(e){}
    return { energy: null, frames: null };
  }
  /* Prefer the voice-ID module's own list; fall back to a read-only parse
     of its localStorage key (same key the audit names, L33358). */
  function readProfiles(){
    var out = { enrolled: false, count: 0, rajaEnrolled: false, entries: [] };
    var i, list, en;
    try{
      if(root.EnzoVoiceID && typeof root.EnzoVoiceID.listAuthorizedVoices === 'function'){
        list = root.EnzoVoiceID.listAuthorizedVoices();
        for(i = 0; i < list.length; i++){
          out.entries.push({
            name: list[i].name, isRaja: !!list[i].isRaja,
            sampleCount: (typeof list[i].sampleCount === 'number' ? list[i].sampleCount : null)
          });
          if(list[i].isRaja) out.rajaEnrolled = true;
        }
        out.count = out.entries.length;
        out.enrolled = out.count > 0;
        return out;
      }
    }catch(e){}
    try{
      var raw = safeGet(STORAGE_PROFILES);
      if(raw){
        var arr = JSON.parse(raw);
        for(i = 0; i < arr.length; i++){
          en = arr[i];
          if(en && typeof en.name === 'string'){
            out.entries.push({
              name: en.name, isRaja: !!en.isRaja,
              sampleCount: (en.profile && typeof en.profile.count === 'number' ? en.profile.count : null)
            });
            if(en.isRaja) out.rajaEnrolled = true;
          }
        }
        out.count = out.entries.length;
        out.enrolled = out.count > 0;
      }
    }catch(e2){}
    return out;
  }
  function langSetting(){
    var stored = safeGet(STORAGE_LANG);
    if(stored === null || stored === '') stored = 'auto';
    var pref = null;
    try{ if(root.state && typeof root.state.langPref === 'string') pref = root.state.langPref; }
    catch(e){}
    return { stored: stored, statePref: pref };
  }
  function voiceVerdict(){
    var d = last.gateDecision, r = last.gateReason;
    if(!d) return 'no gate verdict recorded yet';
    if(d === 'ignore') return 'ignore — blocked as low-energy (' + (r || 'no reason') + ')';
    if(d === 'accept' && r === 'no-profile')
      return 'accept — no voice profile enrolled, so the gate never blocks';
    if(d === 'accept') return 'accept — voice matched (' + (r || 'matched') + ')';
    if(d === 'refuse') return 'refuse — measured non-Raja voice (' + (r || 'no reason') + ')';
    if(d === 'chat') return 'chat — guest conversation, proceeds';
    return d + ' (' + (r || 'no reason') + ')';
  }
  /* permissions.query() only READS the state; it never prompts. Deliberately
     does NOT set p.onchange — the live watcher (base L12452-L12457) owns it. */
  function refreshMicPermission(){
    try{
      if(typeof navigator === 'undefined' || !navigator.permissions ||
         !navigator.permissions.query){
        if(last.micPermission === 'unknown — not checked yet')
          last.micPermission = 'unavailable — Permissions API not supported in this browser';
        return;
      }
      if(permQueryInFlight) return;
      permQueryInFlight = true;
      navigator.permissions.query({ name: 'microphone' }).then(function(p){
        permQueryInFlight = false;
        if(p.state !== last.micPermission){
          last.micPermission = p.state;
          if(bodyEl) render();
        }
      }).catch(function(){
        permQueryInFlight = false;
        last.micPermission = 'unavailable — permission query failed';
      });
    }catch(e){ permQueryInFlight = false; }
  }
  function recordInterim(interim, lang){
    try{
      if(interim) last.interim = String(interim).slice(0, 500);
      if(lang) last.recognitionLang = lang;
    }catch(e){}
    return snapshot();
  }
  function recordFinal(heard, lang, gateRes){
    try{
      last.finalTxt = String(heard || '').slice(0, 500);
      if(lang) last.recognitionLang = lang;
      last.at = new Date().toISOString();
      var w = windowFeatures();
      last.gateEnergy = w.energy;
      last.gateFrames = w.frames;
      var d = gateRes ? gateRes.decision : null;
      last.gateDecision = d ? d.decision : null;
      last.gateReason = d ? d.reason : null;
      last.gateScore = (d && typeof d.score === 'number') ? d.score : null;
      last.gateMatchedProfile = d ? (d.matchedProfile || null) : null;
      last.gateVoiceCheck = gateRes ? (gateRes.voiceCheck || null) : null;
      last.gateSurfaced = gateRes ? (gateRes.surfaced || null) : null;
      refreshMicPermission();
      render();
    }catch(e){}
    return snapshot();
  }
  function recordError(err){
    try{
      last.lastError = String(err || 'unknown');
      last.lastErrorAt = new Date().toISOString();
    }catch(e){}
    return snapshot();
  }
  function snapshot(){
    var p = readProfiles();
    var lg = langSetting();
    var th = energyThreshold();
    var verdict;
    if(last.gateEnergy === null) verdict = 'not measured (no feature window at gate time)';
    else verdict = (last.gateEnergy < th ? 'below' : 'at/above') + ' threshold ' + th;
    return {
      at: last.at,
      recognitionLang: last.recognitionLang,
      speechRecognitionSupported: srSupported(),
      /* Honest unknown: the Web Speech API exposes no per-language
         support check, so this is never guessed. The lang actually used
         (recognitionLang above) is the evidence instead. */
      urPkSupported: 'unknown — the Web Speech API has no per-language support check; this readout shows the language actually used instead',
      interimTranscript: last.interim,
      finalTranscript: last.finalTxt,
      gateEnergy: last.gateEnergy,
      gateEnergyThreshold: th,
      gateEnergyVerdict: verdict,
      gateFrames: last.gateFrames,
      gateDecision: last.gateDecision,
      gateReason: last.gateReason,
      gateScore: last.gateScore,
      gateMatchedProfile: last.gateMatchedProfile,
      gateVoiceCheck: last.gateVoiceCheck,
      gateSurfaced: last.gateSurfaced,
      voiceVerdict: voiceVerdict(),
      micPermission: last.micPermission,
      enaoLangStored: lg.stored,
      enaoLangStatePref: lg.statePref,
      profilesEnrolled: p.enrolled,
      profileCount: p.count,
      rajaEnrolled: p.rajaEnrolled,
      profileEntries: p.entries,
      lastError: last.lastError,
      lastErrorAt: last.lastErrorAt
    };
  }
  function rows(){
    var s = snapshot();
    var prof;
    if(!s.profilesEnrolled) prof = 'none enrolled';
    else prof = s.profileCount + ' enrolled' +
      (s.rajaEnrolled ? ' — Raja enrolled' : ' — Raja NOT enrolled') +
      ', samples: ' + s.profileEntries.map(function(e){
        return e.name + ' (' + (e.sampleCount === null ? '?' : e.sampleCount) + ')';
      }).join(', ');
    return [
      { label: 'Recognition language in use', value: s.recognitionLang || '— none yet' },
      { label: 'Last final transcript', value: s.finalTranscript || '— none yet' },
      { label: 'Last interim transcript', value: s.interimTranscript || '— none yet' },
      { label: 'Gate energy at gate time',
        value: (s.gateEnergy === null ? 'not measured' : String(s.gateEnergy)) +
          ' (threshold ' + s.gateEnergyThreshold + ' — ' + s.gateEnergyVerdict + ')' },
      { label: 'Gate frames in window', value: (s.gateFrames === null ? 'not measured' : String(s.gateFrames)) },
      { label: 'Gate decision', value: (s.gateDecision || '— none yet') + (s.gateReason ? ' — ' + s.gateReason : '') },
      { label: 'Gate score / matched profile',
        value: (s.gateScore === null ? 'no score' : String(s.gateScore)) + ' / ' + (s.gateMatchedProfile || 'none') },
      { label: 'Voice-ID verdict', value: s.voiceVerdict },
      { label: 'Mic permission (this browser)', value: s.micPermission },
      { label: 'Answer language setting (enao_lang)',
        value: s.enaoLangStored + ((s.enaoLangStatePref && s.enaoLangStatePref !== s.enaoLangStored)
          ? ' (live state: ' + s.enaoLangStatePref + ')' : '') },
      { label: 'Voice profile enrolled', value: prof },
      { label: 'Speech recognition available',
        value: s.speechRecognitionSupported ? 'yes (SpeechRecognition present)' : 'no — voice needs Chrome or Edge' },
      { label: 'ur-PK recognition supported', value: s.urPkSupported },
      { label: 'Last recognition error',
        value: s.lastError ? s.lastError + ' at ' + s.lastErrorAt : 'none recorded' },
      { label: 'Last update', value: s.at || '— no mic utterance recorded yet' }
    ];
  }
  /* Settings-only rendering, reusing the existing .setsec / .lrn-note /
     .lrn-row styles. Transcript text goes through textContent, never
     innerHTML, so Urdu script or quotes in it cannot break the page. */
  function render(){
    try{
      if(typeof document === 'undefined') return false;
      var card = document.querySelector('#settingsModal .modal-card');
      if(!card) return false;
      if(!boxEl){
        boxEl = document.createElement('div');
        boxEl.id = 'hearDebug47Box';
        var h = document.createElement('h4');
        h.className = 'setsec';
        h.textContent = 'Mic debug — on-device only';
        boxEl.appendChild(h);
        var note = document.createElement('p');
        note.className = 'lrn-note';
        note.textContent = 'Read-only. Last mic utterance only — nothing here is sent anywhere, and nothing here changes how ENZO hears you.';
        boxEl.appendChild(note);
        bodyEl = document.createElement('div');
        bodyEl.id = 'hearDebug47Body';
        boxEl.appendChild(bodyEl);
        card.appendChild(boxEl);
      }
      if(!bodyEl) return false;
      while(bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
      var rs = rows();
      for(var i = 0; i < rs.length; i++){
        var row = document.createElement('div');
        row.className = 'lrn-row';
        var sp = document.createElement('span');
        sp.textContent = rs[i].label;
        var b = document.createElement('b');
        b.textContent = rs[i].value;
        row.appendChild(sp);
        row.appendChild(b);
        bodyEl.appendChild(row);
      }
      refreshMicPermission();
      return true;
    }catch(e){ return false; }
  }
  /* Chain onto refreshSettingsUI (same pattern as the learned wrapper,
     base L21348-L21351): the original still runs first, then we render. */
  function install(){
    if(installed) return true;
    installed = true;
    try{
      if(typeof root.refreshSettingsUI === 'function'){
        var orig = root.refreshSettingsUI;
        root.refreshSettingsUI = function(){
          var r = orig.apply(this, arguments);
          try{ render(); }catch(e){}
          return r;
        };
      }
    }catch(e){}
    try{ render(); }catch(e2){}
    return true;
  }
  function reset(){
    last = freshLast();
    boxEl = null;
    bodyEl = null;
    return { ok: true };
  }
  var EnzoHearDebug47 = {
    VERSION: '47-debug-readout-v1',
    recordInterim: recordInterim,
    recordFinal: recordFinal,
    recordError: recordError,
    snapshot: snapshot,
    rows: rows,
    render: render,
    refreshMicPermission: refreshMicPermission,
    install: install,
    reset: reset
  };
  if(typeof root !== 'undefined') root.EnzoHearDebug47 = EnzoHearDebug47;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoHearDebug47;
  if(typeof document !== 'undefined'){ try{ install(); }catch(e){} }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
// ===== END MODULE =====
