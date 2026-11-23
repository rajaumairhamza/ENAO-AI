
/* ============================================================================
   ENAO AI master-intel — PIECE 04: voice identification, Raja only
   File: 04-voice-id.js
   Artifact: enao-ai (web_static), builds on live v54-voice-research.
   DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY. Piece build only.

   REQUIREMENT HISTORY (Raja, voice calls, 22 Nov 2026 — each newer
   instruction replaces the older one where they conflict)
   ----------------------------------------------------------------
   - 12:28 PM: ENZO must listen ONLY to Raja's voice and follow ONLY his
     instructions. Background video, someone else talking on the laptop,
     or Raja talking to someone else must never be treated as an
     instruction and never acted on. Applies to the live-view mic
     guidance AND the whole voice/call system. Enrollment on Raja's
     device, free in-browser tech only.
   - 12:29 PM (REPLACES the silent-ignore behaviour): when another voice
     is detected, ENZO must SAY SO clearly — never ignore silently. The
     refusal is SPOKEN (voice input came by voice, so the refusal is
     also spoken, per the voice-in -> voice-out rule). The other person
     may still have a plain conversation (guftagu) with ENZO, but their
     commands are never executed. For destructive commands (delete /
     send / change) the refusal is mandatory and the action NEVER runs.
     The refusal is spoken via speakText in handleRefusal (and via maybeSpeak with viaVoice from the call-mic path if the gate did not speak) — voice input always gets a spoken refusal, never a toast alone.
   - 12:30 PM (REPLACES the single fixed refusal sentence): the refusal
     must be PROFESSIONAL and must ROTATE — never the same words,
     sentence or style twice in a row. A rotation pool of at least 8
     distinct professional phrasings per language (English, Roman Urdu,
     Urdu script) plus a rotation rule (never repeat the last-used
     phrasing; round-robin through the pool). The MEANING never varies:
     only Raja's commands are followed. Applies to EVERY refusal.
   - 12:31 PM (EXTENDS authority): ENZO follows commands only from
     voices RAJA authorizes. Default: Raja only. If Raja says to also
     follow someone else's commands, that person's commands are ALSO
     followed; if Raja says not to follow someone's, theirs are not.
     Authority is decided by Raja's will alone — nobody can grant
     authority to themselves. Implemented as an AUTHORIZED-VOICES LIST
     under Raja's control (Settings): add a voice (enroll that person's
     voice profile under a name) or remove a voice. The gate checks the
     incoming voice against ALL authorized profiles. Raja's own profile
     can only be removed by Raja, and the list can never be left empty.

   DESIGN (short version — full design in 04-voice-id.EVIDENCE.md)
   ----------------------------------------------------------------
   - ONE gate, every voice entry point: gateVoiceText / gateAndRoute.
     The assembler calls gateAndRoute(text) at the call-mic entry
     (r.onresult final-text branch) and at the live-view guidance mic
     entry (P6). It returns {proceed, decision}; when proceed is false
     the caller sends nothing, queues nothing and runs nothing — the
     refusal has already been spoken + toasted by the gate itself.
   - Features (free, in-browser only): Web Audio API AnalyserNode +
     getUserMedia. Per utterance: pitch via autocorrelation, pitch
     clarity, 8 mel-spaced spectral band energies, spectral centroid,
     zero-crossing rate -> a 12-number feature vector. The profile is
     the mean of 3 enrollment samples. Similarity is a weighted score
     (pitch 40% + bands 40% + other features 20%); score >= 0.65
     against ANY authorized profile accepts.
     FFT SIZE TRAP (read before wiring): the live level meter's
     analyser runs at fftSize 256 (v54 L4532) — 256 samples cannot
     hold one period of a ~120 Hz voice at 48 kHz, so pitch reads 0
     and the gate would fail closed on every voice input. The
     assembler MUST raise it to 2048 (one line, L4532) or give the
     gate its own fftSize-2048 analyser on the same stream.
     attachAnalyser REFUSES smaller sizes ({ok:false,
     error:'fft-too-small'}) so a missed wiring step fails loudly
     instead of silently blocking all voice.
   - VAD: RMS energy below 0.015 is background noise — ignored
     silently, no refusal spoken, still listening.
   - No profile enrolled: the gate does NOT block Raja — voice input is
     accepted and a one-time nudge to enroll is returned.
   - No usable audio features while a profile exists: fail closed —
     refuse (a broken analyser must never silently let a stranger's
     commands through).
   - Profiles + rotation state live ONLY in localStorage on Raja's
     device (keys enao_voiceid_profiles_v1 / enao_voiceid_refusal_rot_v1).
     Nothing is ever sent anywhere. No network, no paid API, no key.
   - HONEST LIMIT (see EVIDENCE.md for the full text): browser-only
     feature matching is a practical filter, NOT secure biometric
     authentication. It rejects clearly different voices and ignores
     low-energy noise, but a similar-sounding voice can sometimes pass
     and accuracy drops in noisy rooms. Final verification MUST happen
     on Raja's device.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. Pure functions where possible; browser-only audio parts
   are clearly separated and guarded (they no-op with an error object
   when there is no browser). The export tail is a guarded window
   assignment plus a module.exports assignment so the Node harness
   loads this exact file with no copy of the logic.

   V54 ANCHORS (verified by grep/read against the live export
   ~/workspace/your_files/enao-ai/enao-ai.html, 22,462 lines,
   <meta name="enao-build" content="v54-voice-research">)
   - sendCurrent() (viaVoice = !!state.nextAskViaVoice) . L4208
   - flushVoiceQueue() ............................... L4457
   - startLevelMeter(stream) — owns micAnalyser ...... L4523
   - buildRecognition() / r.onresult (final text) .... L4693 / L4716
   - startRecognition() .............................. L4742
   - turnMicOn() (getUserMedia, one permission) ...... L4765
   - startVoiceCall() / endVoiceCall() ............... L4860 / L4866
   - micBtn.onclick -> startVoiceCall() .............. L4871
   - buildVoicePane(voiceExtras) — Settings voice pane L14840
   - toast(msg) ...................................... L2334
   - lsGet / lsSet / lsJ (localStorage helpers) ...... L14232-L14234
   - finishStream calls EnaoV54Voice.patchFinishStream (v54 P1 inlined)
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'p7-voice-id-v1';

  /* Storage keys — localStorage on Raja's device only, never sent. */
  var STORAGE_KEY = 'enao_voiceid_profiles_v1';
  var ROTATION_KEY = 'enao_voiceid_refusal_rot_v1';

  /* Tunables (documented in EVIDENCE.md; change only with a reason). */
  var DEFAULT_THRESHOLD = 0.65;   /* similarity score >= this accepts */
  var ENERGY_THRESHOLD = 0.015;   /* RMS energy below this is noise */
  var FEATURE_DIM = 12;
  var ENROLL_SAMPLES = 3;         /* samples per profile */
  var MIN_PAIR_SCORE = 0.55;      /* enrollment samples must agree this much */
  var REFUSAL_COOLDOWN_MS = 15000; /* spoken refusal at most once per 15 s,
     so a background TV cannot make ENZO talk non-stop; the refusal
     decision itself still blocks every time, only the speech is paced */

  /* Distance weights for the diagnostic Euclidean distance (pitch 6,
     pitch-clarity 1, 8 bands 2 each, centroid 2, zero-crossing 1). */
  var DIST_WEIGHTS = [6, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1];

  /* Mel-spaced band edges as fractions of the analyser bin count. */
  var BAND_EDGES = [0, 0.06, 0.13, 0.22, 0.33, 0.46, 0.61, 0.78, 1.0];

  /* ==================================================================
     REFUSAL POOLS — professional, rotating, never the same twice in a
     row. Every phrasing carries the same meaning: only Raja's commands
     are followed. 10 per language (minimum required was 8). The pool
     is data, not logic: adding a phrasing never changes behaviour.
     Zero emojis anywhere in this file.
     ================================================================== */
  var REFUSALS = {
    en: [
      "I'm set up to take instructions only from Raja, so I can't act on that.",
      "I can chat with you, but commands I only follow from Raja.",
      "That's not something I can do for you — only Raja can direct me.",
      "I hear you, but I only follow instructions from Raja.",
      "I'm not able to carry out instructions from anyone except Raja.",
      "Happy to talk, but I take orders from Raja alone.",
      "That instruction would need to come from Raja — I can't accept it from anyone else.",
      "My instructions come from Raja only, so I'll have to leave that one aside.",
      "I can keep you company, but I only act on Raja's directions.",
      "Sorry — I only take commands from Raja, so I can't do that."
    ],
    roman: [
      "Main sirf Raja ki hidayat par amal karta hoon, is liye ye kaam main aap ke kehne par nahi kar sakta.",
      "Aap se guftagu kar sakta hoon, lekin hukam sirf Raja ka manunga.",
      "Ye kaam aap ke liye nahi kar sakta — is ki ijazat sirf Raja de sakta hai.",
      "Aap ki baat sun li, lekin amal sirf Raja ki baat par hoga.",
      "Main kisi aur ki command par amal nahi kar sakta, sirf Raja ki.",
      "Baat-cheet ke liye hazir hoon, lekin kaam sirf Raja ke hukam par hoga.",
      "Ye hidayat Raja ki taraf se aani chahiye — kisi aur ki baat par amal nahi kar sakta.",
      "Meri zimmedari sirf Raja ke hukam manna hai, is liye ye nahi kar sakta.",
      "Aap se baat karna theek hai, magar command sirf Raja ki chalegi.",
      "Maazrat — main sirf Raja ki baat manta hoon, aap ki command par amal nahi kar sakta."
    ],
    ur: [
      "میں صرف راجہ کی ہدایت پر عمل کرتا ہوں، اس لیے آپ کے کہنے پر یہ کام نہیں کر سکتا۔",
      "آپ سے گفتگو کر سکتا ہوں، لیکن حکم صرف راجہ کا مانوں گا۔",
      "یہ کام آپ کے لیے نہیں کر سکتا — اس کی اجازت صرف راجہ دے سکتا ہے۔",
      "آپ کی بات سن لی، لیکن عمل صرف راجہ کی بات پر ہوگا۔",
      "میں کسی اور کی کمانڈ پر عمل نہیں کر سکتا، صرف راجہ کی۔",
      "بات چیت کے لیے حاضر ہوں، لیکن کام صرف راجہ کے حکم پر ہوگا۔",
      "یہ ہدایت راجہ کی طرف سے آنی چاہیے — کسی اور کی بات پر عمل نہیں کر سکتا۔",
      "میری ذمہ داری صرف راجہ کا حکم ماننا ہے، اس لیے یہ نہیں کر سکتا۔",
      "آپ سے بات کرنا ٹھیک ہے، مگر کمانڈ صرف راجہ کی چلے گی۔",
      "معذرت — میں صرف راجہ کی بات مانتا ہوں، آپ کی کمانڈ پر عمل نہیں کر سکتا۔"
    ]
  };

  /* Phrases the person says during enrollment (3 samples). */
  function enrollmentPhrases(name){
    var n = String(name || '').trim();
    return [
      n ? ('Mera naam ' + n + ' hai') : 'Mera naam Raja hai',
      'ENZO, meri awaz pehchan lo',
      n ? ('Hello ENZO, main ' + n + ' bol raha hoon') : 'Hello ENZO, main Raja bol raha hoon'
    ];
  }

  /* Short honest-limits note shown in the Settings card (full text in
     EVIDENCE.md). Kept as data so the UI and the docs cannot drift. */
  var LIMITS_NOTE = 'Browser-only voice matching is a practical filter, not secure biometric identification. ' +
    'It can reject clearly different voices and ignore low background noise, but a similar-sounding voice can ' +
    'sometimes pass, and accuracy drops in noisy rooms. Final check must happen on Raja\'s own device with his own microphone.';

  /* ------------------------------------------------------------------
     Small pure helpers
     ------------------------------------------------------------------ */
  function clamp(x, lo, hi){
    if(x < lo) return lo;
    if(x > hi) return hi;
    return x;
  }

  function isValidVector(v){
    if(!v || typeof v.length !== 'number' || v.length !== FEATURE_DIM) return false;
    for(var i = 0; i < FEATURE_DIM; i++){
      if(typeof v[i] !== 'number' || !isFinite(v[i]) || v[i] < 0 || v[i] > 1) return false;
    }
    return true;
  }

  function meanVector(vectors){
    var out = [], i, j;
    for(j = 0; j < FEATURE_DIM; j++) out.push(0);
    for(i = 0; i < vectors.length; i++){
      for(j = 0; j < FEATURE_DIM; j++) out[j] += vectors[i][j];
    }
    for(j = 0; j < FEATURE_DIM; j++) out[j] /= vectors.length;
    return out;
  }

  function newId(prefix){
    return prefix + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1000000).toString(36);
  }

  /* ------------------------------------------------------------------
     Storage adapter — localStorage in the browser, an in-memory store
     anywhere else (Node harness passes its own store explicitly).
     ------------------------------------------------------------------ */
  function memoryStore(){
    var data = {};
    return {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; }
    };
  }

  var defaultStoreInstance = null;
  function defaultStore(){
    try{
      if(typeof localStorage !== 'undefined' && localStorage) return localStorage;
    }catch(e){}
    if(!defaultStoreInstance) defaultStoreInstance = memoryStore();
    return defaultStoreInstance;
  }

  /* ------------------------------------------------------------------
     FEATURE EXTRACTION (pure on arrays — Node-testable with synthetic
     audio; the browser only supplies the arrays from AnalyserNode)
     Feature vector, 12 numbers in 0..1:
       [0]  log pitch (normalised) — log2(f0), 5..8.5 mapped to 0..1
       [1]  pitch clarity, inverse — 1 minus autocorrelation peak
            (0 = clean periodic voice, 1 = noisy / unvoiced)
       [2..9]  8 mel-spaced spectral band energies, normalised to sum 1
       [10] spectral centroid (normalised)
       [11] zero-crossing rate
     ------------------------------------------------------------------ */
  function pitchAnalysis(timeData, sampleRate){
    var n = timeData ? timeData.length : 0;
    if(!timeData || n < 256 || !sampleRate) return { pitchHz: 0, clarity: 0 };
    var mean = 0, i;
    for(i = 0; i < n; i++) mean += timeData[i];
    mean /= n;
    var energy = 0;
    for(i = 0; i < n; i++){ var d = timeData[i] - mean; energy += d * d; }
    if(energy < 1e-6) return { pitchHz: 0, clarity: 0 };
    var minLag = Math.max(2, Math.floor(sampleRate / 400));
    var maxLag = Math.min(Math.floor(sampleRate / 50), Math.floor(n / 2));
    /* Two passes: first find the best normalised correlation, then take
       the FIRST strong local peak. A sine / voiced sound correlates
       ~1.0 at every multiple of its period, so taking the raw maximum
       picks 2x / 3x the period (an octave error: 220 Hz read as 73 Hz),
       and taking the first lag above a loose threshold reads early
       (120 Hz read as 129 Hz). The first local maximum that reaches
       90% of the best correlation is the true fundamental period.
       Parabolic interpolation around that peak gives sub-sample
       accuracy. */
    var vals = [], bestVal = 0, lag, s, s0, s1, c;
    for(lag = minLag; lag <= maxLag; lag++){
      s = 0; s0 = 0; s1 = 0;
      for(i = 0; i < n - lag; i++){
        var a = timeData[i] - mean, b = timeData[i + lag] - mean;
        s += a * b; s0 += a * a; s1 += b * b;
      }
      c = s / Math.sqrt(s0 * s1 + 1e-12);
      vals.push(c);
      if(c > bestVal) bestVal = c;
    }
    if(bestVal < 0.3) return { pitchHz: 0, clarity: 0 };
    var need = Math.max(0.3, bestVal * 0.9);
    var bestLag = -1;
    for(lag = minLag; lag <= maxLag; lag++){
      var v = vals[lag - minLag];
      var vPrev = (lag > minLag) ? vals[lag - minLag - 1] : -Infinity;
      var vNext = (lag < maxLag) ? vals[lag - minLag + 1] : -Infinity;
      if(v >= need && v >= vPrev && v >= vNext){ bestLag = lag; break; }
    }
    if(bestLag < 0){
      for(lag = minLag; lag <= maxLag; lag++){
        if(vals[lag - minLag] >= need){ bestLag = lag; break; }
      }
    }
    if(bestLag < 0) return { pitchHz: 0, clarity: 0 };
    var lagFrac = bestLag;
    if(bestLag > minLag && bestLag < maxLag){
      var vm = vals[bestLag - minLag - 1];
      var v0 = vals[bestLag - minLag];
      var vp = vals[bestLag - minLag + 1];
      var denom = vm - 2 * v0 + vp;
      if(denom !== 0){
        var off = 0.5 * (vm - vp) / denom;
        if(off > -0.5 && off < 0.5) lagFrac = bestLag + off;
      }
    }
    return { pitchHz: sampleRate / lagFrac, clarity: bestVal };
  }

  function estimatePitch(timeData, sampleRate){
    return pitchAnalysis(timeData, sampleRate).pitchHz;
  }

  function extractFeatures(timeData, freqData, sampleRate){
    var n = timeData ? timeData.length : 0;
    var bins = freqData ? freqData.length : 0;
    var vector = [];
    var i, j;
    for(j = 0; j < FEATURE_DIM; j++) vector.push(0);
    if(!n || !bins || !sampleRate){
      return { vector: vector, energy: 0, pitchHz: 0, voiced: false, clarity: 0 };
    }
    /* RMS energy + zero-crossing rate from the time-domain data. */
    var sumSq = 0, zc = 0, prev = timeData[0];
    for(i = 0; i < n; i++){
      sumSq += timeData[i] * timeData[i];
      if(i > 0 && ((timeData[i] >= 0) !== (prev >= 0))) zc++;
      prev = timeData[i];
    }
    var energy = Math.sqrt(sumSq / n);
    var zcr = n > 1 ? zc / (n - 1) : 0;
    /* Pitch (autocorrelation) + clarity. */
    var pa = pitchAnalysis(timeData, sampleRate);
    /* Spectral bands + centroid from the frequency data (byte 0..255). */
    var mags = [];
    var magSum = 0;
    for(i = 0; i < bins; i++){
      var m = clamp(freqData[i] / 255, 0, 1);
      mags.push(m);
      magSum += m;
    }
    var bandSum = 0;
    var bands = [];
    for(j = 0; j < 8; j++){
      var lo = Math.floor(BAND_EDGES[j] * bins);
      var hi = Math.floor(BAND_EDGES[j + 1] * bins);
      if(hi <= lo) hi = lo + 1;
      if(hi > bins) hi = bins;
      var s = 0, k;
      for(k = lo; k < hi; k++) s += mags[k];
      bands.push(s / (hi - lo));
      bandSum += bands[j];
    }
    if(bandSum > 0){
      for(j = 0; j < 8; j++) bands[j] /= bandSum;
    } else {
      for(j = 0; j < 8; j++) bands[j] = 1 / 8;
    }
    var centNum = 0;
    for(i = 0; i < bins; i++) centNum += i * mags[i];
    var centroid = magSum > 0 ? (centNum / magSum) / Math.max(1, bins - 1) : 0.5;
    /* Assemble the vector. Unvoiced frames carry a neutral pitch and
       maximum pitch-clarity value; the capture loop only keeps voiced
       frames for enrollment and for the gate window. */
    vector[0] = pa.pitchHz > 0
      ? clamp((Math.log(pa.pitchHz) / Math.log(2) - 5) / 3.5, 0, 1) : 0.5;
    vector[1] = pa.pitchHz > 0 ? clamp(1 - pa.clarity, 0, 1) : 1;
    for(j = 0; j < 8; j++) vector[2 + j] = clamp(bands[j], 0, 1);
    vector[10] = clamp(centroid, 0, 1);
    vector[11] = clamp(zcr, 0, 1);
    return {
      vector: vector, energy: energy,
      pitchHz: pa.pitchHz, voiced: pa.pitchHz > 0, clarity: pa.clarity
    };
  }

  /* ------------------------------------------------------------------
     SCORING — pure.
     similarityScore(a, b): 0..1, higher = same speaker more likely.
       40% pitch closeness (|log2 f0 ratio|, 1 octave = 0)
       40% spectral-band closeness (mean absolute band difference)
       20% other features (centroid, zero-crossing, pitch clarity)
     distance(a, b): weighted Euclidean, diagnostic only (used by
     nothing in the gate; exposed for harnesses and debugging).
     ------------------------------------------------------------------ */
  function similarityScore(a, b){
    if(!isValidVector(a) || !isValidVector(b)) return 0;
    var pitchScore = 1 - Math.min(1, Math.abs(a[0] - b[0]) * 3.5);
    var mad = 0, i;
    for(i = 2; i < 10; i++) mad += Math.abs(a[i] - b[i]);
    mad /= 8;
    var bandScore = 1 - Math.min(1, mad / 0.12);
    var od = (Math.abs(a[10] - b[10]) + Math.abs(a[11] - b[11]) +
      Math.abs(a[1] - b[1])) / 3;
    var otherScore = 1 - Math.min(1, od / 0.15);
    return clamp(0.4 * pitchScore + 0.4 * bandScore + 0.2 * otherScore, 0, 1);
  }

  function distance(a, b){
    if(!isValidVector(a) || !isValidVector(b)) return Infinity;
    var sum = 0, wSum = 0, i;
    for(i = 0; i < FEATURE_DIM; i++){
      var d = a[i] - b[i];
      sum += DIST_WEIGHTS[i] * d * d;
      wSum += DIST_WEIGHTS[i];
    }
    return Math.sqrt(sum / wSum);
  }

  /* ------------------------------------------------------------------
     PROFILES — pure. A profile is the mean of ENROLL_SAMPLES vectors.
     buildProfile(vectors): {ok:true, profile} or {ok:false, error}.
     Errors: 'need-3-samples', 'bad-vector', 'samples-inconsistent'
     (the 3 samples do not sound like one voice — e.g. someone else
     spoke one of them — so the enrollment is refused, not averaged).
     ------------------------------------------------------------------ */
  function buildProfile(vectors){
    if(!vectors || vectors.length < ENROLL_SAMPLES){
      return { ok: false, error: 'need-3-samples' };
    }
    var i, j;
    for(i = 0; i < vectors.length; i++){
      if(!isValidVector(vectors[i])) return { ok: false, error: 'bad-vector' };
    }
    var minPair = 1;
    for(i = 0; i < vectors.length; i++){
      for(j = i + 1; j < vectors.length; j++){
        var s = similarityScore(vectors[i], vectors[j]);
        if(s < minPair) minPair = s;
      }
    }
    if(minPair < MIN_PAIR_SCORE){
      return { ok: false, error: 'samples-inconsistent', minPairScore: minPair };
    }
    return {
      ok: true,
      profile: {
        mean: meanVector(vectors),
        count: vectors.length,
        minPairScore: minPair,
        createdAt: new Date().toISOString()
      }
    };
  }

  /* verifyVoice(vector, profiles, threshold): checks the incoming
     voice against EVERY authorized profile and reports the best match.
     Returns {accepted, score, matchedProfile, threshold, perProfile}.
     matchedProfile is {id, name, isRaja} or null. */
  function verifyVoice(vector, profiles, threshold){
    var th = (typeof threshold === 'number') ? threshold : DEFAULT_THRESHOLD;
    var out = {
      accepted: false, score: 0, matchedProfile: null,
      threshold: th, perProfile: []
    };
    if(!isValidVector(vector) || !profiles || !profiles.length) return out;
    var best = null, bestScore = -1, i;
    for(i = 0; i < profiles.length; i++){
      var p = profiles[i];
      if(!p || !p.profile || !isValidVector(p.profile.mean)) continue;
      var s = similarityScore(vector, p.profile.mean);
      out.perProfile.push({ id: p.id, name: p.name, score: s });
      if(s > bestScore){ bestScore = s; best = p; }
    }
    if(best){
      out.score = bestScore;
      if(bestScore >= th){
        out.accepted = true;
        out.matchedProfile = { id: best.id, name: best.name, isRaja: !!best.isRaja };
      }
    }
    return out;
  }

  function isSpeechEnergy(energy){
    return (typeof energy === 'number') && energy >= ENERGY_THRESHOLD;
  }

  /* ------------------------------------------------------------------
     AUTHORIZED-VOICES LIST — the only place profiles are created or
     removed. Every mutating function requires opts.byRaja === true:
     authorization happens ONLY through an explicit Settings action by
     the person holding the device (Raja). There is NO function that
     authorizes a voice from spoken words, from a chat message, or from
     any other input — a spoken "is bande ki baat bhi maan lo" can only
     produce the instruction text (requestAddVoiceText); the actual
     enrollment still needs Raja to open Settings and record samples.
     The list can never be saved empty: saveProfiles refuses an empty
     list, and removeAuthorizedVoice refuses to remove the last voice.
     ------------------------------------------------------------------ */
  function loadProfiles(store){
    var st = store || defaultStore();
    var raw = null;
    try{ raw = st.getItem(STORAGE_KEY); }catch(e){ return []; }
    if(!raw) return [];
    var list = null;
    try{ list = JSON.parse(raw); }catch(e){ return []; }
    if(!list || typeof list.length !== 'number') return [];
    var out = [], i;
    for(i = 0; i < list.length; i++){
      var e = list[i];
      if(e && typeof e.id === 'string' && typeof e.name === 'string' &&
        e.profile && isValidVector(e.profile.mean)){
        out.push({
          id: e.id, name: e.name, isRaja: !!e.isRaja,
          profile: e.profile, createdAt: e.createdAt || ''
        });
      }
    }
    return out;
  }

  function saveProfiles(store, list){
    if(!list || !list.length) return false; /* never persist an empty list */
    var st = store || defaultStore();
    try{
      st.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    }catch(e){ return false; }
  }

  function listAuthorizedVoices(store){
    var list = loadProfiles(store);
    var out = [], i;
    for(i = 0; i < list.length; i++){
      out.push({
        id: list[i].id, name: list[i].name, isRaja: !!list[i].isRaja,
        createdAt: list[i].createdAt || '',
        sampleCount: list[i].profile ? (list[i].profile.count || 0) : 0
      });
    }
    return out;
  }

  function hasProfile(store){
    return loadProfiles(store).length > 0;
  }

  function enrollRaja(samples, opts, store){
    var o = opts || {};
    if(o.byRaja !== true) return { ok: false, error: 'not-authorized-by-raja' };
    var list = loadProfiles(store);
    var i;
    for(i = 0; i < list.length; i++){
      if(list[i].isRaja) return { ok: false, error: 'already-enrolled' };
    }
    var built = buildProfile(samples);
    if(!built.ok) return built;
    var entry = {
      id: 'raja', name: 'Raja', isRaja: true,
      profile: built.profile, createdAt: new Date().toISOString()
    };
    list.push(entry);
    if(!saveProfiles(store, list)) return { ok: false, error: 'save-failed' };
    return { ok: true, id: 'raja', name: 'Raja', isRaja: true };
  }

  function addAuthorizedVoice(name, samples, opts, store){
    var o = opts || {};
    if(o.byRaja !== true) return { ok: false, error: 'not-authorized-by-raja' };
    var cleanName = String(name || '').trim();
    if(!cleanName) return { ok: false, error: 'name-required' };
    if(cleanName.length > 60) cleanName = cleanName.slice(0, 60);
    var list = loadProfiles(store);
    var i;
    for(i = 0; i < list.length; i++){
      if(list[i].name.toLowerCase() === cleanName.toLowerCase()){
        return { ok: false, error: 'duplicate-name' };
      }
    }
    var built = buildProfile(samples);
    if(!built.ok) return built;
    var entry = {
      id: newId('v'), name: cleanName, isRaja: false,
      profile: built.profile, createdAt: new Date().toISOString()
    };
    list.push(entry);
    if(!saveProfiles(store, list)) return { ok: false, error: 'save-failed' };
    return { ok: true, id: entry.id, name: cleanName, isRaja: false };
  }

  function reenrollVoice(id, samples, opts, store){
    var o = opts || {};
    if(o.byRaja !== true) return { ok: false, error: 'not-authorized-by-raja' };
    var list = loadProfiles(store);
    var idx = -1, i;
    for(i = 0; i < list.length; i++){
      if(list[i].id === id){ idx = i; break; }
    }
    if(idx < 0) return { ok: false, error: 'not-found' };
    var built = buildProfile(samples);
    if(!built.ok) return built;
    list[idx].profile = built.profile;
    if(!saveProfiles(store, list)) return { ok: false, error: 'save-failed' };
    return { ok: true, id: id, name: list[idx].name, isRaja: !!list[idx].isRaja };
  }

  function removeAuthorizedVoice(id, opts, store){
    var o = opts || {};
    /* Only Raja can change the list — anyone else's remove attempt
       (including a guest voice asking by voice) is refused here. */
    if(o.byRaja !== true) return { ok: false, error: 'only-raja-can-change' };
    var list = loadProfiles(store);
    var idx = -1, i;
    for(i = 0; i < list.length; i++){
      if(list[i].id === id){ idx = i; break; }
    }
    if(idx < 0) return { ok: false, error: 'not-found' };
    /* Never leave the list empty: at least one authorized voice stays. */
    if(list.length <= 1) return { ok: false, error: 'empty-list' };
    var removed = { id: list[idx].id, name: list[idx].name, isRaja: !!list[idx].isRaja };
    list.splice(idx, 1);
    if(!saveProfiles(store, list)) return { ok: false, error: 'save-failed' };
    return { ok: true, removed: removed };
  }

  /* Enrollment session: collects 3 samples, then builds the profile.
     Pure except for the Date inside buildProfile. */
  function createEnrollmentSession(name, isRaja){
    var samples = [];
    var cleanName = String(name || '').trim();
    return {
      name: cleanName,
      isRaja: !!isRaja,
      phrases: enrollmentPhrases(cleanName),
      count: function(){ return samples.length; },
      isComplete: function(){ return samples.length >= ENROLL_SAMPLES; },
      addSample: function(vector){
        if(samples.length >= ENROLL_SAMPLES){
          return { ok: false, error: 'already-3-samples' };
        }
        if(!isValidVector(vector)) return { ok: false, error: 'bad-vector' };
        samples.push(vector.slice());
        return { ok: true, count: samples.length };
      },
      build: function(){ return buildProfile(samples); },
      samplesSnapshot: function(){ return samples.slice(); },
      reset: function(){ samples = []; return { ok: true }; }
    };
  }

  /* What ENZO says when Raja (by voice) tells him to also follow
     someone else: an instruction, NOT an authorization. The voice is
     only added when Raja opens Settings and records that person's
     samples — no spoken sentence can authorize anyone by itself. */
  function requestAddVoiceText(lang){
    var l = normalizeLang(lang);
    if(l === 'en'){
      return 'Okay — open Settings, then Voice and Avatar, then Authorized voices, and record three short samples of that person speaking. After that I will follow their commands too.';
    }
    if(l === 'ur'){
      return 'ٹھیک ہے — سیٹنگز کھولیں، پھر وائس اور اوتار، پھر مجاز آوازیں، اور اس شخص کی تین چھوٹی آوازیں ریکارڈ کریں۔ اس کے بعد میں ان کی کمانڈز بھی مانوں گا۔';
    }
    return 'Theek hai — Settings kholein, phir Voice & Avatar, phir Authorized voices, aur us shakhs ki teen chhoti awazein record karein. Us ke baad main us ki commands bhi manunga.';
  }

  /* ------------------------------------------------------------------
     UTTERANCE CLASSIFICATION — pure, topic-neutral, multilingual.
     classifyUtterance(text) -> {kind, destructive}.
       'command'     : an instruction to DO something (delete, send,
                       change, open, book, research karo, ...)
       'conversation': guftagu — greetings, questions, definitions,
                       small talk (kya haal hai, ye kya hai, ...)
       'unclear'     : neither pattern matched — fail closed: treated
                       as a command by the gate (refused, not executed).
     destructive: true for delete / send / pay / post / publish /
     cancel / password-change and their Roman Urdu / Urdu forms.
     ------------------------------------------------------------------ */
  var DESTRUCTIVE_RES = [
    /\b(delete|remove|erase|uninstall|wipe|purge|cancel|pay|transfer|send|post|publish|share)\b/i,
    /(delete\s*kar|mita\s*do|mita\s*de|hata\s*do|hata\s*de|bhej\s*do|bhej\s*de|post\s*kar|publish\s*kar|share\s*kar|pese\s*bhej|payment\s*kar|cancel\s*kar|khatam\s*kar)/i,
    /(ڈیلیٹ|مٹا\s*دو|ہٹا\s*دو|بھیج\s*دو|پوسٹ|کینسل)/,
    /\b(change|reset)\b.{0,20}\b(password|passcode|pin)\b/i,
    /(password|parol)\s*(change|badal|reset)/i
  ];

  var COMMAND_RES = [
    /\b(delete|remove|erase|uninstall|clear|wipe|purge|send|post|publish|share|forward|upload|transfer|pay|buy|order|book|cancel|change|update|edit|set|switch|turn|enable|disable|start|stop|open|close|create|make|save|move|copy|rename|schedule|remind|call|message|text|email|download|install)\b/i,
    /(kar\s*do|kar\s*de|karo|bhej\s*do|bhej\s*de|bhejo|hata\s*do|hata\s*de|mita\s*do|mita\s*de|khol\s*do|khol\s*de|band\s*kar|band\s*karo|bana\s*do|bana\s*de|likh\s*do|lagao|nikal\s*do|utha\s*do|rakh\s*do|chalu\s*kar|khatam\s*kar|delete\s*kar|send\s*kar|post\s*kar|upload\s*kar|change\s*kar|set\s*kar|book\s*kar|kharid|mangwa)/i,
    /(کر\s*دو|بھیج\s*دو|ہٹا\s*دو|مٹا\s*دو|کھول\s*دو|بند\s*کر|بنا\s*دو|لکھ\s*دو|نکال\s*دو|ڈیلیٹ|بھیجو)/,
    /\b(do\s+it|just\s+do\s+it)\b/i
  ];

  var CONVERSATION_RES = [
    /\b(hello|hi|hey|salam|assalam|aoa|good\s*(morning|afternoon|evening|night)|how\s+are\s+you|what'?s\s+up)\b/i,
    /(kya\s*haal|kaise\s*ho|kese\s*ho|kya\s*kar\s*rahe|kya\s*ho\s*raha|aur\s*sunao|kya\s*chal\s*raha|tum\s*kaun|aap\s*kaun)/i,
    /(کیا\s*حال|کیسے\s*ہو|کیا\s*کر\s*رہے|اور\s*سناؤ|تم\s*کون)/,
    /\b(what|why|how|when|where|who|which|whose|whom)\b/i,
    /(kya\s*hai|kya\s*hota|kyun|kaise|kab|kahan|kaun|kitne|kis\s*tarah|kya\s*matlab)/i,
    /(کیا\s*ہے|کیوں|کیسے|کب|کہاں|کون|کتنے)/,
    /(batao|bataen|batayen|samjhao|samjhaen)\b.*(kya|kaise|kyun|ke\s*baare|about)/i,
    /\?$/
  ];

  var QUESTION_START_RES = /^\s*(what|why|how|when|where|who|which|kya|kyun|kaise|kab|kahan|kaun|kitne)\b/i;

  function isDestructiveCommand(text){
    var t = String(text || '');
    var i;
    for(i = 0; i < DESTRUCTIVE_RES.length; i++){
      if(DESTRUCTIVE_RES[i].test(t)) return true;
    }
    return false;
  }

  function classifyUtterance(text){
    var t = String(text || '');
    var destructive = isDestructiveCommand(t);
    if(destructive) return { kind: 'command', destructive: true };
    var i;
    for(i = 0; i < COMMAND_RES.length; i++){
      if(COMMAND_RES[i].test(t)) return { kind: 'command', destructive: false };
    }
    for(i = 0; i < CONVERSATION_RES.length; i++){
      if(CONVERSATION_RES[i].test(t)) return { kind: 'conversation', destructive: false };
    }
    if(QUESTION_START_RES.test(t)) return { kind: 'conversation', destructive: false };
    return { kind: 'unclear', destructive: false };
  }

  /* ------------------------------------------------------------------
     REFUSAL ROTATION — pure on the passed state object.
     nextRefusal(lang, rotation): round-robin through the pool for that
     language; never returns the same text as the immediately previous
     refusal (in any language — the lastText guard covers cross-language
     repeats too, and the round-robin covers same-language repeats).
     rotation shape: {idx:{en:-1, roman:-1, ur:-1}, lastText:''}.
     The caller owns persistence (loadRotation / saveRotation).
     ------------------------------------------------------------------ */
  function normalizeLang(l){
    if(l === 'en' || l === 'roman' || l === 'ur') return l;
    return 'roman';
  }

  function freshRotation(){
    return { idx: { en: -1, roman: -1, ur: -1 }, lastText: '' };
  }

  function loadRotation(store){
    var st = store || defaultStore();
    var raw = null;
    try{ raw = st.getItem(ROTATION_KEY); }catch(e){ return freshRotation(); }
    if(!raw) return freshRotation();
    try{
      var r = JSON.parse(raw);
      if(r && r.idx && typeof r.idx.en === 'number' &&
        typeof r.idx.roman === 'number' && typeof r.idx.ur === 'number'){
        return { idx: r.idx, lastText: (typeof r.lastText === 'string') ? r.lastText : '' };
      }
    }catch(e){}
    return freshRotation();
  }

  function saveRotation(store, rotation){
    var st = store || defaultStore();
    try{
      st.setItem(ROTATION_KEY, JSON.stringify(rotation || freshRotation()));
      return true;
    }catch(e){ return false; }
  }

  function nextRefusal(lang, rotation){
    var l = normalizeLang(lang);
    var rot = rotation || freshRotation();
    if(!rot.idx) rot.idx = { en: -1, roman: -1, ur: -1 };
    if(typeof rot.lastText !== 'string') rot.lastText = '';
    var pool = REFUSALS[l];
    var idx = ((typeof rot.idx[l] === 'number' ? rot.idx[l] : -1) + 1) % pool.length;
    var text = pool[idx];
    if(text === rot.lastText){
      idx = (idx + 1) % pool.length;
      text = pool[idx];
    }
    rot.idx[l] = idx;
    rot.lastText = text;
    return { text: text, lang: l, index: idx };
  }

  function detectRefusalLang(text){
    var t = String(text || '');
    if(/[\u0600-\u06FF]/.test(t)) return 'ur';
    if(/\b(hai|hain|karo|kar|mujhe|meri|mera|nahi|nahin|kya|ye|yeh|aap|tum|bhi|lo|do|de|ka|ki|ke|se|mein|par|ko|bolo|sunao)\b/i.test(t)) return 'roman';
    if(/[a-zA-Z]/.test(t)) return 'en';
    return 'roman';
  }

  function langForSpeech(refusalLang){
    if(refusalLang === 'en') return 'en-US';
    return 'ur-PK'; /* Roman Urdu and Urdu script are both spoken with the Urdu voice */
  }

  /* ------------------------------------------------------------------
     THE GATE — pure decision function (gateVoiceInput) + browser
     convenience wrappers (gateVoiceText / gateAndRoute).
     gateVoiceInput(input, ctx):
       input: {text, vector (12 numbers or null), energy (RMS or null),
               lang ('en'|'roman'|'ur', optional)}
       ctx:   {profiles (array; loaded from store when omitted),
               threshold, rotation (state object; advanced on refusal),
               state ({nudgeShown, lastRefusalAt}; mutated),
               store, now (ms; Date.now() when omitted),
               refusalCooldownMs (default 15000; 0 disables pacing)}
     Decision object, one of:
       accept  — process normally. reason 'matched' | 'no-profile'.
                 nudgeEnroll:true only the first time with no profile.
       chat    — a guest's plain conversation: answer it, but never
                 execute a command from it. guest:true, note included.
       refuse  — do NOT act, send, queue or run anything. speak:true
                 means the refusal must be spoken (voice-in ->
                 voice-out); speak:false means this refusal is inside
                 the 15 s pacing window — still refused, speech skipped
                 so background TV cannot make ENZO talk non-stop.
                 refusal + refusalLang carry the rotating wording.
       ignore  — low-energy noise: nothing heard, nothing said, still
                 listening. speak:false.
     The gate NEVER mutates the profiles list.
     ------------------------------------------------------------------ */
  function gateVoiceInput(input, ctx){
    var inp = input || {};
    var c = ctx || {};
    var text = String(inp.text || '').trim();
    var energy = (typeof inp.energy === 'number') ? inp.energy : null;
    var vector = inp.vector || null;
    var threshold = (typeof c.threshold === 'number') ? c.threshold : DEFAULT_THRESHOLD;
    var store = c.store || defaultStore();
    var profiles = c.profiles || loadProfiles(store);
    var rotation = c.rotation || freshRotation();
    var state = c.state || { nudgeShown: false };
    var now = (typeof c.now === 'number') ? c.now : Date.now();
    var cooldown = (typeof c.refusalCooldownMs === 'number')
      ? c.refusalCooldownMs : REFUSAL_COOLDOWN_MS;
    var lang = inp.lang ? normalizeLang(inp.lang) : detectRefusalLang(text);

    /* 1. Voice-activity detection — low energy is noise, not a voice. */
    if(energy !== null && energy < ENERGY_THRESHOLD){
      return {
        decision: 'ignore', reason: 'low-energy', speak: false,
        text: text, score: null, matchedProfile: null
      };
    }
    /* 2. No profile enrolled — never block Raja; nudge once to enroll. */
    if(!profiles || !profiles.length){
      var first = !state.nudgeShown;
      state.nudgeShown = true;
      return {
        decision: 'accept', reason: 'no-profile', speak: false,
        nudgeEnroll: first, text: text, score: null, matchedProfile: null
      };
    }
    /* Helper: build a refusal decision, pacing the speech. */
    function buildRefusal(reason, destructive, kind){
      var r = nextRefusal(lang, rotation);
      var speak = true;
      var cooled = false;
      if(typeof state.lastRefusalAt === 'number' &&
        (now - state.lastRefusalAt) < cooldown){
        speak = false;
        cooled = true;
      } else {
        state.lastRefusalAt = now;
      }
      return {
        decision: 'refuse', reason: reason, speak: speak, cooldown: cooled,
        refusal: r.text, refusalLang: r.lang,
        text: text, score: null, matchedProfile: null,
        destructive: !!destructive, kind: kind || 'command'
      };
    }
    /* 3. No usable features while a profile exists — fail closed. */
    if(!isValidVector(vector)){
      var d0 = buildRefusal('no-features', classifyUtterance(text).destructive, 'command');
      d0.score = null;
      return d0;
    }
    /* 4. Verify against every authorized profile. */
    var v = verifyVoice(vector, profiles, threshold);
    if(v.accepted){
      return {
        decision: 'accept', reason: 'matched', speak: false,
        text: text, score: v.score, matchedProfile: v.matchedProfile,
        threshold: threshold
      };
    }
    /* 5. Not an authorized voice — classify what was said. */
    var cls = classifyUtterance(text);
    if(cls.kind === 'conversation'){
      return {
        decision: 'chat', reason: 'guest-conversation', speak: false,
        guest: true, text: text, score: v.score, matchedProfile: null,
        note: 'Guest conversation — ENZO can chat, but will not follow commands from this voice.'
      };
    }
    var d = buildRefusal(
      cls.destructive ? 'destructive-command-refused' : 'not-authorized-voice',
      cls.destructive, cls.kind
    );
    d.score = v.score;
    return d;
  }

  /* ------------------------------------------------------------------
     BROWSER RUNTIME STATE — the rolling feature window. The live
     level meter already owns an AnalyserNode on the same mic stream
     (startLevelMeter, v54 L4523); attachAnalyser taps that same node,
     so no second permission and no second stream are ever needed.
     Frames are kept only while they are voiced and above the energy
     threshold; the gate reads the mean of the last ~2.5 s window.
     ------------------------------------------------------------------ */
  var runtime = {
    analyser: null,
    audioCtx: null,
    pollTimer: null,
    window: [],
    windowEnergies: [],   /* P1: per-frame RMS energy, 1:1 with window */
    lastEnergy: 0,
    lastAt: 0,
    nudgeState: { nudgeShown: false },
    decisions: []
  };

  function resetRuntime(){
    detachAnalyser();
    runtime.window = [];
    runtime.windowEnergies = [];
    runtime.lastEnergy = 0;
    runtime.lastAt = 0;
    runtime.nudgeState = { nudgeShown: false };
    runtime.decisions = [];
    return { ok: true };
  }

  function attachAnalyser(analyser, audioCtx){
    if(!analyser || typeof analyser.getByteFrequencyData !== 'function'){
      return { ok: false, error: 'no-analyser' };
    }
    /* fftSize MUST be >= 2048: pitch needs at least one full period
       in the time-domain window (~400 samples for 120 Hz at 48 kHz).
       The live level meter runs at 256 — see the header trap note.
       Refusing here is deliberate: a too-small analyser would make
       every frame unvoiced, the window would stay empty, and the
       gate would fail closed on ALL voice input. */
    if(typeof analyser.fftSize !== 'number' || analyser.fftSize < 2048){
      return { ok: false, error: 'fft-too-small' };
    }
    runtime.analyser = analyser;
    runtime.audioCtx = audioCtx || null;
    runtime.window = [];
    runtime.windowEnergies = [];
    if(runtime.pollTimer){
      try{ clearInterval(runtime.pollTimer); }catch(e){}
      runtime.pollTimer = null;
    }
    if(typeof setInterval === 'function'){
      runtime.pollTimer = setInterval(function(){ pollAnalyserFrame(); }, 100);
    }
    return { ok: true };
  }

  function detachAnalyser(){
    if(runtime.pollTimer){
      try{ clearInterval(runtime.pollTimer); }catch(e){}
      runtime.pollTimer = null;
    }
    runtime.analyser = null;
    runtime.audioCtx = null;
    runtime.window = [];
    runtime.windowEnergies = [];
    return { ok: true };
  }

  function pollAnalyserFrame(){
    var an = runtime.analyser;
    if(!an) return;
    try{
      var freq = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(freq);
      var time;
      if(typeof an.getFloatTimeDomainData === 'function'){
        time = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(time);
      } else {
        var b = new Uint8Array(an.fftSize);
        an.getByteTimeDomainData(b);
        time = new Float32Array(an.fftSize);
        for(var i = 0; i < b.length; i++) time[i] = (b[i] - 128) / 128;
      }
      var sr = (runtime.audioCtx && runtime.audioCtx.sampleRate) || 48000;
      var f = extractFeatures(time, freq, sr);
      runtime.lastEnergy = f.energy;
      runtime.lastAt = Date.now();
      if(f.energy >= ENERGY_THRESHOLD && f.voiced){
        runtime.window.push(f.vector);
        runtime.windowEnergies.push(f.energy);
        if(runtime.window.length > 25){ runtime.window.shift(); runtime.windowEnergies.shift(); }
      }
    }catch(e){}
  }

  function currentWindowFeatures(){
    if(!runtime.window.length) return null;
    if(Date.now() - runtime.lastAt > 3000) return null;
    /* P1 (enao-hear-fix): energy is the MEAN of the kept voiced frames'
       energies -- the utterance's energy -- NOT runtime.lastEnergy, which
       is the single most recent 100 ms poll frame and is trailing
       silence by the time a final transcript arrives (RC1). This
       mirrors the enrollment path, which already reports the mean of
       the kept frames' energies (collectSampleFeatures, base L34323).
       windowEnergies is kept 1:1 with runtime.window; if it is ever
       out of sync the old lastEnergy value is used as a fallback. */
    var meanEnergy = runtime.lastEnergy, maxEnergy = runtime.lastEnergy, i;
    if(runtime.windowEnergies && runtime.windowEnergies.length){
      meanEnergy = 0; maxEnergy = 0;
      for(i = 0; i < runtime.windowEnergies.length; i++){
        meanEnergy += runtime.windowEnergies[i];
        if(runtime.windowEnergies[i] > maxEnergy) maxEnergy = runtime.windowEnergies[i];
      }
      meanEnergy /= runtime.windowEnergies.length;
    }
    return {
      vector: meanVector(runtime.window),
      energy: meanEnergy,
      energyMax: maxEnergy,
      lastEnergy: runtime.lastEnergy,
      frames: runtime.window.length
    };
  }

  /* Test / assembler hook: inject a feature vector directly (used by
     the Node harness and by any mic path that captures its own audio,
     e.g. the P6 live-view mic if it opens its own stream). */
  function injectFeatures(vector, energy){
    if(!isValidVector(vector)) return { ok: false, error: 'bad-vector' };
    runtime.window = [vector.slice()];
    runtime.windowEnergies = [(typeof energy === 'number') ? energy : 0.1];
    runtime.lastEnergy = (typeof energy === 'number') ? energy : 0.1;
    runtime.lastAt = Date.now();
    return { ok: true };
  }

  /* ------------------------------------------------------------------
     BROWSER AUDIO CAPTURE — enrollment recording. Opens its own
     getUserMedia stream (permission is already granted once), records
     for durationMs, aggregates voiced frames, stops the tracks.
     In Node (no navigator) it calls onDone({error:'no-browser'})
     synchronously and never throws.
     ------------------------------------------------------------------ */
  function collectSampleFeatures(analyser, sampleRate, durationMs, onProgress, onDone){
    if(!analyser || typeof analyser.getByteFrequencyData !== 'function'){
      if(typeof onDone === 'function') onDone({ error: 'no-analyser' });
      return;
    }
    var frames = [];
    var energies = [];
    var pitches = [];
    var started = Date.now();
    var dur = durationMs || 2500;
    function tick(){
      try{
        var freq = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freq);
        var time = new Float32Array(analyser.fftSize);
        if(typeof analyser.getFloatTimeDomainData === 'function'){
          analyser.getFloatTimeDomainData(time);
        } else {
          var b = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(b);
          for(var i = 0; i < b.length; i++) time[i] = (b[i] - 128) / 128;
        }
        var f = extractFeatures(time, freq, sampleRate || 48000);
        if(f.energy >= ENERGY_THRESHOLD && f.voiced){
          frames.push(f.vector);
          energies.push(f.energy);
          pitches.push(f.pitchHz);
        }
      }catch(e){}
      var elapsed = Date.now() - started;
      if(typeof onProgress === 'function'){
        try{ onProgress(Math.min(1, elapsed / dur), frames.length); }catch(e){}
      }
      if(elapsed < dur){
        setTimeout(tick, 50);
      } else {
        if(frames.length < 5){
          if(typeof onDone === 'function') onDone({ error: 'too-quiet', frames: frames.length });
          return;
        }
        var meanEnergy = 0, meanPitch = 0, i;
        for(i = 0; i < energies.length; i++){ meanEnergy += energies[i]; meanPitch += pitches[i]; }
        meanEnergy /= energies.length;
        meanPitch /= pitches.length;
        if(typeof onDone === 'function'){
          onDone({
            vector: meanVector(frames), energy: meanEnergy,
            pitchHz: meanPitch, frames: frames.length
          });
        }
      }
    }
    tick();
  }

  function recordSample(durationMs, onProgress, onDone){
    if(typeof navigator === 'undefined' || !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia){
      if(typeof onDone === 'function') onDone({ error: 'no-browser' });
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      var AC = root.AudioContext || root.webkitAudioContext;
      if(!AC){
        stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} });
        if(typeof onDone === 'function') onDone({ error: 'no-audio-context' });
        return;
      }
      var actx = new AC();
      if(actx.state === 'suspended'){ try{ actx.resume(); }catch(e){} }
      var src = actx.createMediaStreamSource(stream);
      var an = actx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      collectSampleFeatures(an, actx.sampleRate, durationMs || 2500, onProgress, function(res){
        stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} });
        try{ actx.close(); }catch(e){}
        if(typeof onDone === 'function') onDone(res);
      });
    }).catch(function(){
      if(typeof onDone === 'function') onDone({ error: 'mic-denied' });
    });
  }

  /* ------------------------------------------------------------------
     GATE WRAPPERS FOR THE ASSEMBLER
     gateVoiceText(text, opts): runs the pure gate on the current
       rolling feature window. opts: {source, store, threshold, lang}.
       Persists rotation; remembers the decision for the queue check.
     gateAndRoute(text, opts): the one-call contract for every mic
       entry point. Returns {proceed, decision}. When proceed is false
       the caller must send nothing, queue nothing and run nothing —
       a refusal has already been spoken + toasted by handleRefusal.
       'chat' decisions proceed (guest conversation, no commands).
     rememberDecision / allowQueued / checkQueued: the second-chance
       check for flushVoiceQueue (v54 L4457). A queued voice text may
       only be sent if the gate already accepted it (or allowed it as
       guest chat). Unknown queued text fails closed (false).
     handleRefusal(decision, deps): speaks the refusal (voice-in ->
       voice-out) via deps.speakText or the page speakText, and shows
       it as a toast via deps.toast or the page toast. No-op unless the
       decision is a refusal. Returns true when speech was attempted.
     ------------------------------------------------------------------ */
  function rememberDecision(text, decision){
    if(!decision) return;
    runtime.decisions.push({
      text: String(text || '').trim(),
      decision: decision.decision,
      at: Date.now()
    });
    if(runtime.decisions.length > 20) runtime.decisions.shift();
  }

  function checkQueued(text){
    var q = String(text || '').trim();
    if(!q) return null;
    var i, e;
    for(i = runtime.decisions.length - 1; i >= 0; i--){
      e = runtime.decisions[i];
      if(e && e.text && (q.indexOf(e.text) !== -1 || e.text.indexOf(q) !== -1)){
        return e.decision;
      }
    }
    return null;
  }

  function allowQueued(text){
    var q = String(text || '').trim();
    if(!q) return false;
    var seenAccept = false, i, e;
    for(i = 0; i < runtime.decisions.length; i++){
      e = runtime.decisions[i];
      if(e && e.text && (q.indexOf(e.text) !== -1 || e.text.indexOf(q) !== -1)){
        if(e.decision === 'refuse' || e.decision === 'ignore') return false;
        if(e.decision === 'accept' || e.decision === 'chat') seenAccept = true;
      }
    }
    return seenAccept;
  }

  function handleRefusal(decision, deps){
    var d = deps || {};
    if(!decision || decision.decision !== 'refuse' || !decision.refusal) return false;
    var speak = null, toastFn = null;
    if(typeof d.speakText === 'function') speak = d.speakText;
    else if(typeof root.speakText === 'function') speak = root.speakText;
    if(typeof d.toast === 'function') toastFn = d.toast;
    else if(typeof root.toast === 'function') toastFn = root.toast;
    var ok = false;
    if(speak){
      try{
        speak(decision.refusal, langForSpeech(decision.refusalLang));
        ok = true;
      }catch(e){}
    }
    if(toastFn){
      try{ toastFn(decision.refusal); }catch(e){}
    }
    return ok;
  }

  function gateVoiceText(text, opts){
    var o = opts || {};
    var store = o.store || defaultStore();
    var rotation = loadRotation(store);
    var ctx = {
      profiles: loadProfiles(store),
      threshold: o.threshold,
      rotation: rotation,
      state: runtime.nudgeState,
      store: store,
      refusalCooldownMs: o.refusalCooldownMs
    };
    var w = currentWindowFeatures();
    var input = {
      text: text,
      vector: w ? w.vector : null,
      energy: w ? w.energy : null,
      lang: o.lang
    };
    var d = gateVoiceInput(input, ctx);
    saveRotation(store, rotation);
    rememberDecision(text, d);
    return d;
  }

  function gateAndRoute(text, opts){
    var o = opts || {};
    var d = gateVoiceText(text, o);
    if(d.decision === 'refuse'){
      var spoke55 = handleRefusal(d, o.deps); return { proceed: false, decision: d, refusalSpoken: !!spoke55 };
    }
    if(d.decision === 'ignore'){
      return { proceed: false, decision: d };
    }
    return { proceed: true, decision: d };
  }

  /* ------------------------------------------------------------------
     SETTINGS UI — enrollment + authorized-voices list. Lives in
     Settings -> Voice & Avatar (buildVoicePane, v54 L14840). The
     assembler appends enrollmentHTML() into paneEls.voice and calls
     mountEnrollment(container) once; the card re-renders itself after
     every enroll / add / remove. All buttons go through ONE delegated
     click handler; every list change requires byRaja:true, passed
     here by the Settings action itself (see the API note above).
     ------------------------------------------------------------------ */
  function escH(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function enrollmentHTML(){
    var html = '';
    html += '<div class="voiceid-card" id="voiceidCard">';
    html += '<h4 class="setsec">Voice identification — only Raja\'s voice</h4>';
    html += '<p class="lrn-note">ENZO follows voice commands only from voices Raja authorizes. ' +
      'Default: Raja only. Record 3 short samples so ENZO recognises Raja\'s voice, ' +
      'and add other people here only when Raja says so.</p>';
    html += '<p class="lrn-note voiceid-note">' + escH(LIMITS_NOTE) + '</p>';
    html += '<div class="voiceid-status" id="voiceidStatus">Checking saved voices…</div>';
    html += '<div class="voiceid-list" id="voiceidList"></div>';
    html += '<div class="voiceid-sec"><b>Enroll Raja\'s voice</b><span>Say each phrase once, clearly, into this device\'s microphone.</span></div>';
    html += '<div class="voiceid-phrases" id="voiceidRajaPhrases"></div>';
    html += '<div class="voiceid-actions">';
    html += '<button type="button" class="actionbtn" data-voiceid-act="save-raja">Save Raja\'s voice</button> ';
    html += '<button type="button" class="actionbtn" data-voiceid-act="reenroll-raja">Re-enroll</button> ';
    html += '<button type="button" class="actionbtn voiceid-danger" data-voiceid-act="delete-raja">Delete Raja\'s voice</button>';
    html += '</div>';
    html += '<div class="voiceid-sec"><b>Add an authorized voice</b><span>Only when Raja says so. That person records 3 samples below.</span></div>';
    html += '<div class="voiceid-add"><input type="text" id="voiceidGuestName" maxlength="60" placeholder="Person\'s name, e.g. Ahmed" aria-label="Authorized person name">';
    html += '<div class="voiceid-phrases" id="voiceidGuestPhrases"></div>';
    html += '<div class="voiceid-actions"><button type="button" class="actionbtn" data-voiceid-act="save-guest">Save this voice</button></div></div>';
    html += '</div>';
    return html;
  }

  var uiSessions = { raja: null, guest: null };
  var uiMountedRoot = null;

  function refreshVoiceIdUI(root, store){
    if(!root) return;
    var st = store || defaultStore();
    var status = root.querySelector ? root.querySelector('#voiceidStatus') : null;
    var listEl = root.querySelector ? root.querySelector('#voiceidList') : null;
    var list = listAuthorizedVoices(st);
    if(status){
      if(!list.length){
        status.textContent = 'No voice enrolled yet — voice commands are accepted for now. Enroll Raja\'s voice below so only his voice is followed.';
      } else {
        var names = [];
        for(var i = 0; i < list.length; i++){
          names.push(list[i].name + (list[i].isRaja ? ' (Raja)' : ''));
        }
        status.textContent = 'Authorized voices (' + list.length + '): ' + names.join(', ') + '.';
      }
    }
    if(listEl){
      if(!list.length){
        listEl.innerHTML = '';
      } else {
        var h = '';
        for(var j = 0; j < list.length; j++){
          h += '<div class="voiceid-row"><span class="voiceid-name">' + escH(list[j].name) + '</span>';
          if(list[j].isRaja) h += '<span class="voiceid-tag">Raja</span>';
          h += '<span class="voiceid-meta">' + (list[j].sampleCount || 0) + ' samples</span>';
          h += '<button type="button" class="actionbtn voiceid-danger" data-voiceid-act="remove" data-voiceid-id="' +
            escH(list[j].id) + '">Remove</button></div>';
        }
        listEl.innerHTML = h;
      }
    }
    renderPhraseButtons(root, 'voiceidRajaPhrases', 'raja', enrollmentPhrases('Raja'));
    var nameInput = root.querySelector ? root.querySelector('#voiceidGuestName') : null;
    var gname = nameInput ? nameInput.value.trim() : '';
    renderPhraseButtons(root, 'voiceidGuestPhrases', 'guest', enrollmentPhrases(gname || 'Guest'));
  }

  function renderPhraseButtons(root, boxId, kind, phrases){
    var box = root.querySelector ? root.querySelector('#' + boxId) : null;
    if(!box) return;
    var sess = uiSessions[kind];
    var h = '';
    for(var i = 0; i < phrases.length; i++){
      var done = sess && sess.count() > i;
      var rec = sess && sess.count() === i;
      h += '<div class="voiceid-phrase' + (done ? ' voiceid-done' : '') + '">' +
        '<span class="voiceid-phrase-text">' + (i + 1) + '. ' + escH(phrases[i]) + '</span>' +
        '<button type="button" class="actionbtn' + (rec ? ' voiceid-rec' : '') + '" ' +
        'data-voiceid-act="record" data-voiceid-kind="' + kind + '" data-voiceid-idx="' + i + '"' +
        (done ? ' disabled' : '') + '>' + (done ? 'Recorded' : (rec ? 'Recording…' : 'Record')) + '</button></div>';
    }
    box.innerHTML = h;
  }

  function voiceIdToast(msg, deps){
    if(deps && typeof deps.toast === 'function'){ try{ deps.toast(msg); }catch(e){} return; }
    if(typeof root.toast === 'function'){ try{ root.toast(msg); }catch(e){} }
  }

  function mountEnrollment(rootEl, deps){
    if(!rootEl) return { ok: false, error: 'no-root' };
    var store = (deps && deps.store) || defaultStore();
    rootEl.innerHTML = enrollmentHTML();
    refreshVoiceIdUI(rootEl, store);
    if(!rootEl.__voiceidMounted){
      rootEl.__voiceidMounted = true;
      uiMountedRoot = rootEl;
      rootEl.addEventListener('click', function(ev){
        var b = ev.target && ev.target.closest
          ? ev.target.closest('[data-voiceid-act]') : null;
        if(!b || b.disabled) return;
        var act = b.getAttribute('data-voiceid-act');
        var status = rootEl.querySelector('#voiceidStatus');
        function setStatus(t){ if(status) status.textContent = t; }
        if(act === 'record'){
          var kind = b.getAttribute('data-voiceid-kind');
          var idx = parseInt(b.getAttribute('data-voiceid-idx') || '0', 10);
          var name = kind === 'raja' ? 'Raja'
            : (rootEl.querySelector('#voiceidGuestName') || { value: '' }).value.trim();
          if(kind === 'guest' && !name){
            setStatus('Type the person\'s name first, then record their 3 samples.');
            return;
          }
          if(!uiSessions[kind] || uiSessions[kind].name !== name){
            uiSessions[kind] = createEnrollmentSession(name, kind === 'raja');
          }
          var sess = uiSessions[kind];
          if(sess.count() !== idx){
            setStatus('Record the phrases in order — phrase ' + (sess.count() + 1) + ' is next.');
            return;
          }
          setStatus('Listening… say phrase ' + (idx + 1) + ': "' + sess.phrases[idx] + '"');
          refreshVoiceIdUI(rootEl, store);
          recordSample(2500, null, function(res){
            if(res.error){
              setStatus(res.error === 'too-quiet'
                ? 'Too quiet — move closer to the microphone and try that phrase again.'
                : res.error === 'mic-denied'
                ? 'Microphone was not allowed — allow it from the lock icon in the address bar, then try again.'
                : 'Recording did not work in this browser — typing still works normally.');
              return;
            }
            var added = sess.addSample(res.vector);
            if(!added.ok){
              setStatus('That sample could not be used — please record it again.');
              return;
            }
            setStatus('Phrase ' + (idx + 1) + ' of 3 recorded.' +
              (sess.isComplete() ? ' Now tap Save.' : ' Next phrase, please.'));
            refreshVoiceIdUI(rootEl, store);
          });
          return;
        }
        if(act === 'save-raja' || act === 'save-guest'){
          var k = act === 'save-raja' ? 'raja' : 'guest';
          var s = uiSessions[k];
          if(!s || !s.isComplete()){
            setStatus('Record all 3 phrases first.');
            return;
          }
          var built = s.build();
          if(!built.ok){
            setStatus(built.error === 'samples-inconsistent'
              ? 'The 3 samples do not sound like one voice — please record all 3 again, same person, same microphone.'
              : 'Need 3 samples before saving.');
            uiSessions[k] = null;
            refreshVoiceIdUI(rootEl, store);
            return;
          }
          var res2 = (k === 'raja')
            ? enrollRaja(s.samplesSnapshot(), { byRaja: true }, store)
            : addAuthorizedVoice(s.name, s.samplesSnapshot(), { byRaja: true }, store);
          if(!res2.ok && res2.error === 'already-enrolled' && k === 'raja'){
            /* Raja re-recording over an existing profile: same action,
               re-enroll path. */
            res2 = reenrollVoice('raja', s.samplesSnapshot(), { byRaja: true }, store);
          }
          if(res2.ok){
            voiceIdToast(k === 'raja'
              ? 'Raja\'s voice is enrolled — ENZO now follows voice commands only from authorized voices.'
              : s.name + '\'s voice is authorized — ENZO will follow their commands too.', deps);
            setStatus(k === 'raja'
              ? 'Raja\'s voice is enrolled.'
              : s.name + '\'s voice is authorized.');
            uiSessions[k] = null;
          } else {
            setStatus(res2.error === 'already-enrolled'
              ? 'Raja\'s voice is already enrolled — use Re-enroll to record it again.'
              : res2.error === 'duplicate-name'
              ? 'That name is already authorized — use a different name.'
              : 'Could not save that voice — please try again.');
          }
          refreshVoiceIdUI(rootEl, store);
          return;
        }
        if(act === 'reenroll-raja'){
          uiSessions.raja = createEnrollmentSession('Raja', true);
          setStatus('Re-enrollment started — record the 3 phrases again.');
          refreshVoiceIdUI(rootEl, store);
          return;
        }
        if(act === 'delete-raja' || act === 'remove'){
          var id = act === 'delete-raja' ? 'raja' : b.getAttribute('data-voiceid-id');
          var r = removeAuthorizedVoice(id, { byRaja: true }, store);
          if(r.ok){
            voiceIdToast('Voice removed — that voice will no longer be followed.', deps);
            setStatus('Voice removed.');
          } else if(r.error === 'empty-list'){
            setStatus('Cannot remove the last authorized voice — at least one voice must stay authorized.');
          } else {
            setStatus('Could not remove that voice.');
          }
          refreshVoiceIdUI(rootEl, store);
          return;
        }
      });
    }
    return { ok: true };
  }

  var EnzoVoiceID = {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    ROTATION_KEY: ROTATION_KEY,
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
    ENERGY_THRESHOLD: ENERGY_THRESHOLD,
    FEATURE_DIM: FEATURE_DIM,
    ENROLL_SAMPLES: ENROLL_SAMPLES,
    MIN_PAIR_SCORE: MIN_PAIR_SCORE,
    REFUSAL_COOLDOWN_MS: REFUSAL_COOLDOWN_MS,
    REFUSALS: REFUSALS,
    LIMITS_NOTE: LIMITS_NOTE,
    /* features + scoring */
    extractFeatures: extractFeatures,
    estimatePitch: estimatePitch,
    similarityScore: similarityScore,
    distance: distance,
    isValidVector: isValidVector,
    buildProfile: buildProfile,
    verifyVoice: verifyVoice,
    isSpeechEnergy: isSpeechEnergy,
    /* storage + authorized list */
    memoryStore: memoryStore,
    defaultStore: defaultStore,
    loadProfiles: loadProfiles,
    saveProfiles: saveProfiles,
    listAuthorizedVoices: listAuthorizedVoices,
    hasProfile: hasProfile,
    enrollRaja: enrollRaja,
    /* Settings management UI only — addAuthorizedVoice is reachable ONLY from the Settings enrollment UI (mountEnrollment save-guest action) with Raja's explicit action (opts.byRaja); it is never called from any voice-input or gate path, so no voice can authorize itself. */
    addAuthorizedVoice: addAuthorizedVoice,
    reenrollVoice: reenrollVoice,
    removeAuthorizedVoice: removeAuthorizedVoice,
    createEnrollmentSession: createEnrollmentSession,
    enrollmentPhrases: enrollmentPhrases,
    requestAddVoiceText: requestAddVoiceText,
    /* utterance classification */
    classifyUtterance: classifyUtterance,
    isDestructiveCommand: isDestructiveCommand,
    detectRefusalLang: detectRefusalLang,
    /* refusal rotation */
    freshRotation: freshRotation,
    loadRotation: loadRotation,
    saveRotation: saveRotation,
    nextRefusal: nextRefusal,
    /* the gate */
    gateVoiceInput: gateVoiceInput,
    gateVoiceText: gateVoiceText,
    gateAndRoute: gateAndRoute,
    rememberDecision: rememberDecision,
    allowQueued: allowQueued,
    checkQueued: checkQueued,
    handleRefusal: handleRefusal,
    /* browser audio */
    attachAnalyser: attachAnalyser,
    detachAnalyser: detachAnalyser,
    currentWindowFeatures: currentWindowFeatures,
    injectFeatures: injectFeatures,
    collectSampleFeatures: collectSampleFeatures,
    recordSample: recordSample,
    resetRuntime: resetRuntime,
    /* settings UI */
    enrollmentHTML: enrollmentHTML,
    mountEnrollment: mountEnrollment,
    refreshVoiceIdUI: refreshVoiceIdUI
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoVoiceID = EnzoVoiceID;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoVoiceID;

})(typeof window !== 'undefined' ? window : this);
