
/**
 * ============================================================================
 * PIECE 01 — ENZO AVATAR COMPONENT (reusable face / single source of truth)
 * ENZO face/avatar upgrade · artifact slug: enao-ai · builds on v51
 * ----------------------------------------------------------------------------
 * WHAT THIS PIECE IS
 *   One dependency-free JS module that renders ENZO's face as inline SVG and
 *   drives it with a JS expression controller. The sidebar logo, the chat
 *   avatar and the main 3D robot's face must ALL be driven from this one
 *   component (or from its expression table) so there is ONE ENZO identity —
 *   never three separately-drawn faces that can drift apart.
 *
 *   Usage:
 *     var av = new EnzoAvatar(container, { size: 48, expression: 'neutral' });
 *     av.setExpression('happy');
 *     av.setSpeaking(true);        // mouth speech-sync while TTS/audio plays
 *     av.setListening(true);       // friendly + attentive while mic is live
 *     av.lookAt('left');           // 'left' | 'right' | 'up' | 'down' | 'user'
 *     av.blinkNow();               // one blink (sometimes a double blink)
 *     av.destroy();                // removes timers / observers / DOM
 *
 *   Pure / node-testable helpers (no DOM needed):
 *     EnzoAvatar.simulateBlinkSchedule(60, 42)  // virtual 60 s blink log
 *     EnzoAvatar.EXPRESSIONS                    // all supported names
 *
 * EXACT ANCHOR POINTS IN THE CURRENT CODE (v50 export, verified by grep)
 * ----------------------------------------------------------------------------
 *   Source file: ~/workspace/your_files/enao-ai/enao-ai.html (10,340 lines)
 *   v51 changed ONLY the room/scene + RTL bubble wrapping + SMS text size.
 *   Verified: none of the six v51 pieces in ~/workspace/enao-room-rebuild/
 *   pieces/ (01-room-environment, 02-workstation, 03-character,
 *   04-animations, 05-cameras, 06-rules) mentions sidebar / .enzo-av /
 *   .enzo-orb / brandHome / buildMessageEl / setCentreEnzo — each piece
 *   states it contains no chat/call/UI logic. So every anchor below is
 *   unchanged from the v50 export.
 *
 *   1) SIDEBAR LOGO — inside <aside class="sidebar" id="sidebar"> :
 *        <button class="brand-home" id="brandHome" ...>
 *          <span class="enzo-orb" aria-hidden="true">
 *            <span class="orb-eyes"><i></i><i></i></span></span>
 *      CSS: `.enzo-orb{width:48px;height:48px;...}` (brand block, ~line 1246)
 *           `.orb-eyes i{width:7px;height:11px;...background:#00D9FF;...}`
 *           plus the FINAL-FIXES blink `@keyframes enzoblink{0%,91%,100%
 *           {transform:scaleY(1)}94.5%{transform:scaleY(.08)}}` with the
 *           FIXED 4.6 s / 5.3 s cycles this piece replaces:
 *           `.enzo-orb .orb-eyes i{animation:enzoblink 4.6s ease-in-out infinite}`
 *      Replace the inner `.enzo-orb` span with
 *        <span class="enzoav-slot" data-enzo-avatar data-size="48"></span>
 *      and mount: new EnzoAvatar(slot, { size: 48 }). Keep #brandHome,
 *      .brandtxt <h1>ENZO</h1> and the tagline untouched.
 *
 *   2) CHAT AVATAR — built per AI message in buildMessageEl() (~line 2673):
 *        var html='<div class="enzo-av" data-enzoav data-state="'
 *                   +(m.error?'error':'idle')
 *                   +'" role="img" aria-label="ENZO avatar">'
 *                   +'<span class="orb-eyes"><i></i><i></i></span></div>'
 *                   +'<div class="acard">';
 *      Typing row (~line 1803):
 *        <div class="enzo-av" id="typingAv" data-state="thinking"
 *             role="img" aria-label="ENZO">
 *          <span class="orb-eyes"><i></i><i></i></span></div>
 *      CSS: `.enzo-av{width:34px;height:34px;...}` (~line 1391) and the
 *      FINAL-FIXES face restyle `.enzo-av{position:relative;background:
 *      radial-gradient(circle at 34% 28%,#FFFFFF 0%,#F8FAFC 46%,#CBD5E1 100%)}`
 *      (~line 1468) with ::before black screen + ::after cyan smile.
 *      Replace the inner `.orb-eyes` span with a mount slot and create one
 *      EnzoAvatar per visible avatar (34 px). Reuse the existing
 *      `data-enzoav` / `data-state` attributes as the state source of truth.
 *
 *   3) STATE HOOK (drives 2 AND 3 together) — setCentreEnzo(st) (~line 2526):
 *        function setCentreEnzo(st){
 *          var map={idle:'idle',listening:'listening',thinking:'thinking',
 *                    speaking:'speaking',working:'working',
 *                    researching:'working',coding:'working',
 *                    success:'success',error:'error'};
 *          var v=map[st]||'idle';
 *          var avs=document.querySelectorAll('[data-enzoav]');
 *          if(avs.length) avs[avs.length-1].setAttribute('data-state', v);
 *          var ta=$('typingAv');
 *          if(ta) ta.setAttribute('data-state', v==='idle'?'thinking':v);
 *          if(window.setEnzoState){ try{ window.setEnzoState(st); }catch(e){} }
 *        }
 *      The assembler should extend this function (or add a sibling
 *      setEnzoAvatars(state)) that calls av.setExpression(mapped) on every
 *      mounted EnzoAvatar instance. Do NOT duplicate the state map here.
 *
 *   4) MAIN 3D ROBOT FACE (right panel + hero) — the 3D model itself is
 *      NOT replaced by this piece; this SVG face is its 2-D twin for the
 *      places a WebGL canvas cannot go (sidebar, chat bubbles, fallback):
 *        <div class="enzo-mount" id="enzoHeroMount" ...> (~line 1745, hero)
 *        <div class="enzo-mount enzo-panel-mount" id="enzoPanelMount" ...>
 *             (~line 1829/1854, right panel .enzo-panel)
 *        window.setEnzoState=function(name){ ... } (~line 5851) — maps a
 *          state name onto the 3D instance via inst.enzo.setExpression(expr)
 *          (STATE_TO_EXPR) and inst.anim.setActivity(act). The 3D
 *          expression names live in buildEnzo() (~line 7515) in
 *          ~/workspace/enao-room-rebuild/pieces/03-character.js
 *          (enzo.setExpression / enzo.blink / enzo.setSpeaking).
 *        Fallback orb inside each mount (`.enzo-fallback .ef-orb` with
 *        `.ef-eyes i` and `animation:efBlink 4.4s ease-in-out infinite`,
 *        ~line 996) is the natural slot for this SVG when Three.js/WebGL
 *        is unavailable — same face, no new drawing.
 *      Expression names here are deliberately the same words as the 3D
 *      piece (neutral/happy/curious/thinking/surprised/speaking/listening/
 *      excited/confused/sad/focused/sleeping) so one state name drives
 *      both faces. 3D 'sleeping' == this piece's 'sleepy' (alias mapped).
 *
 *   5) REDUCED MOTION — the app already honours it in two places this
 *      piece reads: window.__enzoRM (set ~line 5866 from localStorage key
 *      'enao_enzo_rm', defaulting to the OS prefers-reduced-motion query)
 *      and window.setEnzoReducedMotion(on). This piece checks
 *      window.__enzoRM first, then matchMedia('(prefers-reduced-motion:
 *      reduce)'), then options.reducedMotion.
 *
 *   6) COLOURS (locked, from 03-character.js / Master Character Sheet):
 *      glossy white #F8FAFC · metallic silver #CBD5E1 · face black #080D1A ·
 *      electric blue #3B82F6 · cyan glow #00D9FF · purple #8B5CF6 accent ·
 *      green #22C55E + amber #F59E0B tiny accents only. ENZO is 1.35 m tall;
 *      this SVG is the face only — no body, no chest display here (the
 *      chest display reading exactly 'ENZO' belongs to the 3D piece).
 *
 * WHAT IT DEPENDS ON
 *   Nothing. No external libraries, no THREE.js, no network, no fonts.
 *   Browser only: DOM, matchMedia, IntersectionObserver (optional —
 *   degrades to "always visible"), requestAnimationFrame (only while
 *   speaking), setTimeout (one pending blink timer at a time, only while
 *   visible). Runs in node for the pure blink simulation (no DOM touched
 *   unless `new EnzoAvatar(...)` is called with a real container).
 *   Class names use the prefix `enzoav-` so they never collide with the
 *   existing `.enzo-av` / `.enzo-orb` / `.orb-eyes` rules in the export.
 *
 * PERFORMANCE CONTRACT
 *   - One pending blink setTimeout at a time, and only while the avatar is
 *     visible (IntersectionObserver + document visibility). Hidden avatars
 *     cost zero timers and zero frames.
 *   - One requestAnimationFrame loop, and only while speaking (mouth sync).
 *     It stops the moment speaking stops or the avatar hides.
 *   - Everything else is cheap CSS/SVG transforms (scale / translate /
 *     rotate) with CSS transitions — no layout, no repaints of the page.
 * ============================================================================
 */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------------
   * Pure helpers — no DOM. Used by the class AND by the node simulation.
   * ------------------------------------------------------------------------ */

  // Seeded RNG (mulberry32) so the blink simulation is reproducible.
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Blink timing rules (the heart of "natural, never mechanical"):
  //   interval  : 3000–6000 ms between blink STARTS (uniform random)
  //   duration  : 120–180 ms per blink (uniform random)
  //   double    : ~18% of blinks are a double blink — the second blink
  //               starts 180–320 ms after the first one ENDS.
  // All three are drawn from the RNG, so no two intervals are ever equal
  // (floats from a continuous range; exact equality has probability ~0).
  var BLINK = {
    MIN_INTERVAL_MS: 3000,
    MAX_INTERVAL_MS: 6000,
    MIN_DURATION_MS: 120,
    MAX_DURATION_MS: 180,
    DOUBLE_CHANCE: 0.18,
    DOUBLE_GAP_MIN_MS: 180,
    DOUBLE_GAP_MAX_MS: 320,
    SLOW_DURATION_MS: 320,   // sleepy / slow blink
    QUICK_DURATION_MS: 90    // quick blink
  };

  function nextBlinkIntervalMs(rng) {
    return BLINK.MIN_INTERVAL_MS +
      rng() * (BLINK.MAX_INTERVAL_MS - BLINK.MIN_INTERVAL_MS);
  }
  function nextBlinkDurationMs(rng, kind) {
    if (kind === 'slow') return BLINK.SLOW_DURATION_MS;
    if (kind === 'quick') return BLINK.QUICK_DURATION_MS;
    return BLINK.MIN_DURATION_MS +
      rng() * (BLINK.MAX_DURATION_MS - BLINK.MIN_DURATION_MS);
  }

  // Virtual-time simulation of the blink scheduler. Returns the log so a
  // test can assert the distribution without waiting 60 real seconds.
  //   simulateBlinkSchedule(60, 42) -> { blinks, intervals, durations,
  //     doubleBlinks, ... }  (times in ms; intervals = gap between starts)
  function simulateBlinkSchedule(seconds, seed) {
    var rng = mulberry32(seed == null ? 42 : seed);
    var horizon = seconds * 1000;
    var t = nextBlinkIntervalMs(rng);   // first blink starts after 3–6 s
    // NOTE: starts/durations are kept as raw floats here (rounded only for
    // display in stats()). Rounding to whole ms first would create fake
    // "equal" intervals — the scheduler itself never repeats a value.
    var blinks = [];                    // { start, duration, partOfDouble, secondHalf }
    while (t < horizon) {
      var dur = nextBlinkDurationMs(rng, 'normal');
      blinks.push({ start: t, duration: dur, partOfDouble: false, secondHalf: false });
      var lastDur = dur;
      var isDouble = rng() < BLINK.DOUBLE_CHANCE;
      if (isDouble) {
        var gap = BLINK.DOUBLE_GAP_MIN_MS +
          rng() * (BLINK.DOUBLE_GAP_MAX_MS - BLINK.DOUBLE_GAP_MIN_MS);
        var t2 = t + dur + gap;
        if (t2 < horizon) {
          var dur2 = nextBlinkDurationMs(rng, 'normal');
          blinks[blinks.length - 1].partOfDouble = true;
          blinks.push({ start: t2, duration: dur2, partOfDouble: true, secondHalf: true });
          t = t2;
          lastDur = dur2;   // next gap is measured from the SECOND blink's end
        }
      }
      // Scheduler rule (mirrors _scheduleBlink, called when a blink ENDS):
      // next blink starts (3–6 s) AFTER the previous blink ends.
      t = t + lastDur + nextBlinkIntervalMs(rng);
    }
    var intervals = [];
    for (var i = 1; i < blinks.length; i++) {
      intervals.push(blinks[i].start - blinks[i - 1].start);
    }
    // "True" inter-blink intervals exclude the intra-double gap (a double
    // blink is ONE blink event); report both so the check is honest.
    // A blink starts a new event unless it is the second half of a double.
    var eventIntervals = [];
    var lastEventStart = null;
    for (var j = 0; j < blinks.length; j++) {
      if (!blinks[j].secondHalf) {
        if (lastEventStart !== null) eventIntervals.push(blinks[j].start - lastEventStart);
        lastEventStart = blinks[j].start;
      }
    }
    var durations = blinks.map(function (b) { return b.duration; });
    var doubles = blinks.filter(function (b) { return b.partOfDouble; }).length / 2;
    function stats(arr) {
      if (!arr.length) return { count: 0, min: 0, max: 0, mean: 0 };
      var s = 0, mn = Infinity, mx = -Infinity;
      arr.forEach(function (v) { s += v; if (v < mn) mn = v; if (v > mx) mx = v; });
      return { count: arr.length, min: mn, max: mx, mean: Math.round(s / arr.length) };
    }
    return {
      seconds: seconds,
      seed: seed == null ? 42 : seed,
      blinks: blinks,
      blinkCount: blinks.length,
      doubleBlinkEvents: doubles,
      // Gaps between consecutive blink STARTS (intra-double gaps included,
      // so the min can dip below 3000 — that is the second half of a double).
      intervals: stats(intervals),
      // Gaps between blink EVENTS (a double counts once): must span 3–6 s.
      eventIntervals: stats(eventIntervals),
      durations: stats(durations),
      allIntervalsDistinct: intervals.length === new Set(intervals).size,
      allDurationsInRange: durations.every(function (d) {
        return d >= BLINK.MIN_DURATION_MS && d <= BLINK.MAX_DURATION_MS;
      })
    };
  }

  /* ------------------------------------------------------------------------
   * Expression table — ONE state drives both eyes (and mouth/brows/tilt).
   * eye: [scaleX, scaleY] applied to BOTH eyes from the same values.
   * mouth: smile scale [x, y], open 0..1 (round open mouth), frown bool,
   *        rotate deg (crooked smile for confused). glow: ring colour.
   * gaze: {x, y} eye-group offset in SVG units (-6..6). tilt: head deg.
   * ------------------------------------------------------------------------ */
  var EXPRESSIONS = {
    neutral:   { eye: [1, 1],       mouth: [1, 1],    open: 0,    frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'flat' },
    idle:      { eye: [1, 1],       mouth: [1, 1],    open: 0,    frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'flat' },
    happy:     { eye: [1.15, 0.55], mouth: [1.35, 1.3], open: 0,   frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'happy' },
    excited:   { eye: [1.25, 1.25], mouth: [1.3, 1.3], open: 0.15, frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'raised' },
    curious:   { eye: [1.3, 1.3],   mouth: [0.55, 0.55], open: 0,  frown: false, rotate: 0,   tilt: 7,  gaze: { x: 4, y: -3 },    glow: '#00D9FF', brow: 'raised' },
    thinking:  { eye: [1, 0.65],    mouth: [0.7, 0.25], open: 0,   frown: false, rotate: 0,   tilt: 8,  gaze: { x: -4, y: -4 },   glow: '#8B5CF6', brow: 'oneUp' },
    confused:  { eye: [1.1, 0.95],  mouth: [0.8, 0.8], open: 0,    frown: false, rotate: -12, tilt: 10, gaze: { x: 3, y: 0 },     glow: '#F59E0B', brow: 'oneUp' },
    surprised: { eye: [1.4, 1.4],   mouth: [0.8, 0.8], open: 0.85, frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'raised' },
    sad:       { eye: [1, 0.8],     mouth: [0.9, 0.9], open: 0,    frown: true,  rotate: 0,   tilt: 0,  gaze: { x: 0, y: 3 },     glow: '#3B82F6', brow: 'sad' },
    sleepy:    { eye: [1, 0.12],    mouth: [0.6, 0.6], open: 0,    frown: false, rotate: 0,   tilt: 3,  gaze: { x: 0, y: 2 },     glow: '#3B82F6', brow: 'flat' },
    sleeping:  { eye: [1, 0.12],    mouth: [0.6, 0.6], open: 0,    frown: false, rotate: 0,   tilt: 3,  gaze: { x: 0, y: 2 },     glow: '#3B82F6', brow: 'flat' }, // alias of sleepy (3D name)
    focused:   { eye: [0.9, 0.75],  mouth: [0.7, 0.2], open: 0,    frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#3B82F6', brow: 'flat' },
    speaking:  { eye: [1.05, 1.05], mouth: [1, 1],     open: 0,    frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#8B5CF6', brow: 'flat' },
    listening: { eye: [1.1, 1.1],   mouth: [0.85, 0.85], open: 0,  frown: false, rotate: 0,   tilt: 3,  gaze: { x: 0, y: 0 },     glow: '#22C55E', brow: 'flat' },
    success:   { eye: [1.15, 0.55], mouth: [1.35, 1.3], open: 0,   frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#22C55E', brow: 'happy' },
    error:     { eye: [1, 0.6],     mouth: [0.9, 0.9], open: 0,    frown: true,  rotate: 0,   tilt: 0,  gaze: { x: 0, y: 2 },     glow: '#F59E0B', brow: 'sad' },
    working:   { eye: [1, 1],       mouth: [0.9, 0.9], open: 0,    frown: false, rotate: 0,   tilt: 0,  gaze: { x: 0, y: 0 },     glow: '#00D9FF', brow: 'flat' }
  };
  // Aliases from the app's state map (setCentreEnzo) to expression names.
  var STATE_ALIASES = {
    researching: 'working', coding: 'working', idle: 'idle',
    sleeping: 'sleepy', blink: 'blink' // 'blink' is a command, not a face
  };

  /* ------------------------------------------------------------------------
   * CSS — injected once per document. All motion is transform/opacity only.
   * The injected <style> carries data-enzoav-css so a second copy is never
   * added no matter how many avatars mount.
   * ------------------------------------------------------------------------ */
  var CSS_TEXT = [
    '.enzoav{--enzoav-glow:#00d9ff;display:block;line-height:0;border-radius:50%;width:var(--enzo-face-size,48px);height:var(--enzo-face-size,48px);}',
    '.enzoav svg{width:100%;height:100%;display:block;overflow:visible;}',
    /* Soft cyan ambient glow around the whole face (cheap drop-shadow). */
    '.enzoav .enzoav-halo{filter:drop-shadow(0 0 10px rgba(0,217,255,.35));}',
    /* Smooth expression transitions — this is what stops the snapping. */
    '.enzoav .enzoav-inner{transition:transform .45s cubic-bezier(.34,1.4,.5,1);transform-box:fill-box;transform-origin:center;}',
    '.enzoav .enzoav-eyes{transition:transform .45s ease;transform-box:fill-box;transform-origin:center;}',
    '.enzoav .enzoav-eye{transition:opacity .3s ease;}',
    '.enzoav .enzoav-mouth{transition:transform .4s ease,opacity .3s ease;transform-box:fill-box;transform-origin:center;}',
    '.enzoav .enzoav-brow{transition:transform .45s ease,opacity .3s ease;transform-box:fill-box;transform-origin:center;}',
    '.enzoav .enzoav-open{transition:opacity .25s ease;transform-box:fill-box;transform-origin:center;}',
    /* Blink is driven per-frame from JS (one shared blink value for BOTH
       eyes) — no CSS animation on the eyes, so nothing can fight it. */
    '@media (prefers-reduced-motion: reduce){',
    '  .enzoav .enzoav-inner,.enzoav .enzoav-eyes,.enzoav .enzoav-mouth,',
    '  .enzoav .enzoav-brow,.enzoav .enzoav-open{transition:none;}',
    '  .enzoav .enzoav-halo{filter:none;}',
    '}'
  ].join('\n');

  var cssInjected = false;
  function injectCss(doc) {
    if (cssInjected) return;
    var docRef = doc || (typeof document !== 'undefined' ? document : null);
    if (!docRef) return;
    if (docRef.querySelector('style[data-enzoav-css]')) { cssInjected = true; return; }
    var st = docRef.createElement('style');
    st.setAttribute('data-enzoav-css', '1');
    st.textContent = CSS_TEXT;
    (docRef.head || docRef.documentElement).appendChild(st);
    cssInjected = true;
  }

  /* ------------------------------------------------------------------------
   * SVG face template — viewBox 0 0 200 200, scales cleanly to any size.
   * Circular white+silver metallic frame, glossy deep-black screen, two
   * glowing cyan-blue eyes, friendly digital smile, cyan LED illumination,
   * soft blue ambient glow. Friendly / adorable / professional — the
   * Master Character Sheet face, in miniature.
   * ------------------------------------------------------------------------ */
  function faceSvg(idp) {
    // idp prefixes gradient/filter ids so several avatars never collide.
    return '' +
    '<svg class="enzoav-halo" viewBox="0 0 200 200" role="img" aria-label="ENZO" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<radialGradient id="' + idp + '-frame" cx="38%" cy="30%" r="75%">' +
          '<stop offset="0%" stop-color="#FFFFFF"/>' +
          '<stop offset="46%" stop-color="#F8FAFC"/>' +
          '<stop offset="78%" stop-color="#CBD5E1"/>' +
          '<stop offset="100%" stop-color="#94A3B8"/>' +
        '</radialGradient>' +
        '<radialGradient id="' + idp + '-screen" cx="42%" cy="32%" r="72%">' +
          '<stop offset="0%" stop-color="#16233F"/>' +
          '<stop offset="55%" stop-color="#080D1A"/>' +
          '<stop offset="100%" stop-color="#04060C"/>' +
        '</radialGradient>' +
        '<linearGradient id="' + idp + '-shine" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#FFFFFF" stop-opacity=".55"/>' +
          '<stop offset="45%" stop-color="#FFFFFF" stop-opacity=".08"/>' +
          '<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<filter id="' + idp + '-eyeglow" x="-60%" y="-60%" width="220%" height="220%">' +
          '<feGaussianBlur stdDeviation="3.2" result="b"/>' +
          '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter>' +
        '<filter id="' + idp + '-mouthglow" x="-60%" y="-60%" width="220%" height="220%">' +
          '<feGaussianBlur stdDeviation="2.4" result="b"/>' +
          '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter>' +
      '</defs>' +
      /* Ambient glow ring behind the frame. */
      '<circle class="enzoav-ring" cx="100" cy="100" r="97" fill="none" stroke="#00D9FF" stroke-opacity=".28" stroke-width="2"/>' +
      '<g class="enzoav-inner">' +
        /* Circular ear components (mechanical, silver + blue ring). */
        '<g>' +
          '<circle cx="15" cy="100" r="10" fill="#CBD5E1" stroke="#94A3B8" stroke-width="1.5"/>' +
          '<circle cx="15" cy="100" r="6.5" fill="none" stroke="#00D9FF" stroke-width="2"/>' +
          '<circle cx="185" cy="100" r="10" fill="#CBD5E1" stroke="#94A3B8" stroke-width="1.5"/>' +
          '<circle cx="185" cy="100" r="6.5" fill="none" stroke="#00D9FF" stroke-width="2"/>' +
        '</g>' +
        /* Metallic outer frame + thin silver trim ring. */
        '<circle cx="100" cy="100" r="88" fill="url(#' + idp + '-frame)" stroke="#7C8DA0" stroke-width="1.5"/>' +
        '<circle cx="100" cy="100" r="82" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="1"/>' +
        /* Glossy deep-black digital face screen. */
        '<circle class="enzoav-screen" cx="100" cy="100" r="76" fill="url(#' + idp + '-screen)" stroke="#1E293B" stroke-width="1"/>' +
        /* Gloss highlight sweeping the top of the screen. */
        '<ellipse class="enzoav-sheen" cx="78" cy="58" rx="46" ry="22" fill="url(#' + idp + '-shine)" opacity=".5" transform="rotate(-18 78 58)"/>' +
        /* Small cyan LED dot above the face (head detail from the sheet). */
        '<circle class="enzoav-led" cx="100" cy="30" r="3" fill="#00D9FF" filter="url(#' + idp + '-eyeglow)"/>' +
        /* Eyebrows — hidden by default, shown/angled per expression. */
        '<g class="enzoav-brow" data-brow="left" opacity="0">' +
          '<path d="M 56 66 Q 72 58 88 66" fill="none" stroke="#00D9FF" stroke-width="3.5" stroke-linecap="round"/>' +
        '</g>' +
        '<g class="enzoav-brow" data-brow="right" opacity="0">' +
          '<path d="M 112 66 Q 128 58 144 66" fill="none" stroke="#00D9FF" stroke-width="3.5" stroke-linecap="round"/>' +
        '</g>' +
        /* Eyes — ONE group, ONE blink value drives both (see _renderEyes).
           Each eye: glowing cyan capsule + white glint. */
        '<g class="enzoav-eyes">' +
          '<g class="enzoav-eye" data-eye="left">' +
            '<ellipse cx="72" cy="92" rx="13" ry="17" fill="#00D9FF" filter="url(#' + idp + '-eyeglow)"/>' +
            '<ellipse cx="72" cy="92" rx="6.5" ry="10" fill="#BFF3FF" opacity=".85"/>' +
            '<circle cx="67" cy="84" r="3" fill="#FFFFFF" opacity=".95"/>' +
          '</g>' +
          '<g class="enzoav-eye" data-eye="right">' +
            '<ellipse cx="128" cy="92" rx="13" ry="17" fill="#00D9FF" filter="url(#' + idp + '-eyeglow)"/>' +
            '<ellipse cx="128" cy="92" rx="6.5" ry="10" fill="#BFF3FF" opacity=".85"/>' +
            '<circle cx="123" cy="84" r="3" fill="#FFFFFF" opacity=".95"/>' +
          '</g>' +
        '</g>' +
        /* Mouth — smile (default), frown (sad/error), open ellipse
           (speaking / surprised). Only one is visible at a time. */
        '<g class="enzoav-mouth" data-mouth="smile">' +
          '<path d="M 76 122 Q 100 140 124 122" fill="none" stroke="#00D9FF" stroke-width="5" stroke-linecap="round" filter="url(#' + idp + '-mouthglow)"/>' +
        '</g>' +
        '<g class="enzoav-mouth" data-mouth="frown" opacity="0">' +
          '<path d="M 78 134 Q 100 118 122 134" fill="none" stroke="#00D9FF" stroke-width="5" stroke-linecap="round" filter="url(#' + idp + '-mouthglow)"/>' +
        '</g>' +
        '<ellipse class="enzoav-open" data-mouth="open" cx="100" cy="130" rx="11" ry="4" fill="#00D9FF" opacity="0" filter="url(#' + idp + '-mouthglow)"/>' +
      '</g>' +
    '</svg>';
  }

  var uidCounter = 0;

  /* ------------------------------------------------------------------------
   * EnzoAvatar
   * ------------------------------------------------------------------------ */
  function EnzoAvatar(container, options) {
    if (!container) throw new Error('[EnzoAvatar] a container element (or selector) is required.');
    if (typeof container === 'string') {
      if (typeof document === 'undefined') throw new Error('[EnzoAvatar] no document: pass an element, not a selector.');
      container = document.querySelector(container);
      if (!container) throw new Error('[EnzoAvatar] no element matches selector.');
    }
    options = options || {};
    this.container = container;
    this.size = options.size || options.width || 48;
    this.expression = 'neutral';
    this._prevExpression = 'neutral';
    this._speaking = false;
    this._speakingLevel = 0;      // 0..1 mouth-open amount while speaking
    this._listening = false;
    this._blinkScale = 1;         // 1 = eyes open, ~0.06 = fully closed
    this._blinking = false;
    this._blinkTimer = null;
    this._rafId = null;
    this._rafLast = 0;
    this._visible = true;
    this._destroyed = false;
    this._gaze = { x: 0, y: 0 };  // manual look override (null = expression gaze)
    this._gazeOverride = null;
    this._rng = mulberry32(options.seed == null ? (Date.now() % 2147483647) : options.seed);
    this._reducedMotion = this._detectReducedMotion(options);
    this._observer = null;
    this._onVisibility = null;

    injectCss(container.ownerDocument || (typeof document !== 'undefined' ? document : null));

    var idp = 'enzoav' + (++uidCounter);
    this._idPrefix = idp;
    container.classList.add('enzoav');
    container.setAttribute('data-enzo-avatar', '');
    container.__enzoAvatar = this;
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', options.ariaLabel || 'ENZO');
    container.innerHTML = faceSvg(idp);
    this.setSize(this.size);

    // Grab the parts once — never re-query per frame.
    var q = function (sel) { return container.querySelector(sel); };
    this._el = {
      inner: q('.enzoav-inner'),
      eyes: q('.enzoav-eyes'),
      eyeL: q('[data-eye="left"]'),
      eyeR: q('[data-eye="right"]'),
      browL: q('[data-brow="left"]'),
      browR: q('[data-brow="right"]'),
      smile: q('[data-mouth="smile"]'),
      frown: q('[data-mouth="frown"]'),
      open: q('[data-mouth="open"]')
    };

    // Idle micro-glances: the eyes drift a few units every 7–14 s so the
    // face never looks frozen between blinks. Only in idle/neutral.
    this._glanceTimer = null;

    if (options.expression) this.setExpression(options.expression);
    else this._applyExpression('neutral');

    if (options.speaking) this.setSpeaking(options.speaking);
    if (options.listening) this.setListening(true);

    this._watchVisibility();
    if (!this._reducedMotion) this._scheduleBlink();
    if (!this._reducedMotion) this._scheduleGlance();
  }

  EnzoAvatar.EXPRESSIONS = Object.keys(EXPRESSIONS);
  EnzoAvatar.simulateBlinkSchedule = simulateBlinkSchedule;
  EnzoAvatar.nextBlinkIntervalMs = nextBlinkIntervalMs;
  EnzoAvatar.nextBlinkDurationMs = nextBlinkDurationMs;
  EnzoAvatar.faceSvg = faceSvg;

  EnzoAvatar.prototype._detectReducedMotion = function (options) {
    if (options.reducedMotion === true) return true;
    if (typeof window !== 'undefined' && window.__enzoRM === true) return true;
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  };

  EnzoAvatar.prototype.setSize = function (px) {
    this.size = px;
    var el = this.container;
    if (typeof px === 'number') {
      el.style.setProperty('--enzo-face-size', px + 'px');
    } else if (typeof px === 'string') {
      el.style.setProperty('--enzo-face-size', px);
    }
    return this;
  };

  /* --- Visibility: one timer / one rAF only while actually visible. --- */
  EnzoAvatar.prototype._watchVisibility = function () {
    var self = this;
    function onVis() {
      var vis = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
      self._visible = vis;
      if (vis) {
        if (!self._reducedMotion && !self._blinkTimer && !self._blinking) self._scheduleBlink();
        if (self._speaking && !self._rafId) self._startSpeakingLoop();
      } else {
        self._clearBlinkTimer();
        self._stopSpeakingLoop();
      }
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      this._onVisibility = onVis;
      document.addEventListener('visibilitychange', onVis);
    }
    if (typeof IntersectionObserver !== 'undefined' && this.container) {
      try {
        this._observer = new IntersectionObserver(function (entries) {
          var entry = entries[0];
          self._visible = !!entry && entry.isIntersecting;
          if (self._visible) {
            if (!self._reducedMotion && !self._blinkTimer && !self._blinking) self._scheduleBlink();
            if (self._speaking && !self._rafId) self._startSpeakingLoop();
          } else {
            self._clearBlinkTimer();
            self._stopSpeakingLoop();
          }
        }, { threshold: 0.01 });
        this._observer.observe(this.container);
      } catch (e) { /* observer optional — default is visible */ }
    }
  };

  /* --- Blink scheduler: ONE pending timeout at a time. --- */
  EnzoAvatar.prototype._clearBlinkTimer = function () {
    if (this._blinkTimer !== null) {
      clearTimeout(this._blinkTimer);
      this._blinkTimer = null;
    }
  };

  EnzoAvatar.prototype._scheduleBlink = function () {
    var self = this;
    if (this._destroyed || this._reducedMotion || !this._visible) return;
    if (this._blinkTimer !== null || this._blinking) return;
    if (this.expression === 'sleepy' || this.expression === 'sleeping') return; // eyes already closed
    var delay = nextBlinkIntervalMs(this._rng);
    this._blinkTimer = setTimeout(function () {
      self._blinkTimer = null;
      self._doBlink('normal');
    }, delay);
  };

  // One blink event. A double blink = two _doBlink calls; the second is
  // scheduled by the caller, never by a second independent timer chain.
  // kind: 'normal' | 'slow' | 'quick'. onDone: optional callback.
  EnzoAvatar.prototype._doBlink = function (kind, onDone) {
    var self = this;
    if (this._destroyed || this._reducedMotion) { if (onDone) onDone(); return; }
    if (this._blinking) { if (onDone) onDone(); return; }
    this._blinking = true;
    var duration = nextBlinkDurationMs(this._rng, kind || 'normal');
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    function frame(now) {
      if (self._destroyed) { self._blinking = false; return; }
      var p = clamp((now - t0) / duration, 0, 1);
      // Smooth eyelid: close fast (first 40%), open slower (last 60%).
      // easeInOut on each half so there is no snap at either end.
      var s;
      if (p < 0.4) { var q = p / 0.4; s = 1 - 0.94 * (q * q * (3 - 2 * q)); }
      else { var r = (p - 0.4) / 0.6; s = 0.06 + 0.94 * (r * r * (3 - 2 * r)); }
      self._blinkScale = s;
      self._renderEyes();
      if (p < 1) {
        self._blinkTimer = null;
        requestAnimationFrame(frame);
      } else {
        self._blinkScale = 1;
        self._renderEyes();
        self._blinking = false;
        if (onDone) onDone();
        else self._scheduleBlink();
      }
    }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(frame);
    else setTimeout(function () { self._blinkScale = 1; self._renderEyes(); self._blinking = false; if (onDone) onDone(); else self._scheduleBlink(); }, duration);
  };

  // Public blink: sometimes (18%) a double blink, like a real person.
  EnzoAvatar.prototype.blinkNow = function (kind) {
    var self = this;
    if (this._reducedMotion) return this;
    this._clearBlinkTimer();
    this._doBlink(kind || 'normal', function () {
      if (self._destroyed || self._reducedMotion) return;
      if (self._rng() < BLINK.DOUBLE_CHANCE) {
        var gap = BLINK.DOUBLE_GAP_MIN_MS +
          self._rng() * (BLINK.DOUBLE_GAP_MAX_MS - BLINK.DOUBLE_GAP_MIN_MS);
        self._blinkTimer = setTimeout(function () {
          self._blinkTimer = null;
          self._doBlink(kind || 'normal');
        }, gap);
      } else {
        self._scheduleBlink();
      }
    });
    return this;
  };

  EnzoAvatar.prototype.blink = EnzoAvatar.prototype.blinkNow;

  /* --- Gaze --- */
  EnzoAvatar.prototype.lookAt = function (dir) {
    var g = { x: 0, y: 0 };
    if (typeof dir === 'string') {
      if (dir === 'left') g = { x: -5, y: 0 };
      else if (dir === 'right') g = { x: 5, y: 0 };
      else if (dir === 'up') g = { x: 0, y: -4 };
      else if (dir === 'down') g = { x: 0, y: 4 };
      else if (dir === 'user') g = { x: 0, y: 0 };
      else g = { x: 0, y: 0 };
    } else if (dir && typeof dir === 'object') {
      g = { x: clamp(Number(dir.x) || 0, -6, 6), y: clamp(Number(dir.y) || 0, -6, 6) };
    }
    this._gazeOverride = g;
    this._renderEyes();
    return this;
  };
  EnzoAvatar.prototype.lookAtUser = function () { return this.lookAt('user'); };
  EnzoAvatar.prototype.clearGaze = function () {
    this._gazeOverride = null;
    this._renderEyes();
    return this;
  };

  /* --- Expressions --- */
  EnzoAvatar.prototype.setExpression = function (name) {
    var n = String(name || 'neutral').toLowerCase().replace(/[\s_-]+/g, '');
    if (STATE_ALIASES[n]) n = STATE_ALIASES[n];
    if (n === 'blink') { this.blinkNow(); return this; } // command, not a face
    if (!EXPRESSIONS[n]) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[EnzoAvatar] unknown expression "' + name + '", using neutral. Valid: ' + Object.keys(EXPRESSIONS).join(', '));
      }
      n = 'neutral';
    }
    if (n !== this.expression) this._prevExpression = this.expression;
    this.expression = n;
    if (n === 'sleepy' || n === 'sleeping') this._clearBlinkTimer();
    else if (!this._reducedMotion && !this._blinkTimer && !this._blinking && this._visible) this._scheduleBlink();
    this._applyExpression(n);
    return this;
  };

  EnzoAvatar.prototype.getExpression = function () { return this.expression; };

  EnzoAvatar.prototype._applyExpression = function (name) {
    var e = EXPRESSIONS[name] || EXPRESSIONS.neutral;
    var el = this._el;
    if (!el.inner) return;
    // Glow ring colour follows the expression (cyan default; purple for
    // thinking, amber for confused/error, green for listening/success).
    this.container.style.setProperty('--enzoav-glow', e.glow);
    this.container.setAttribute('data-expression', name);
    // Head tilt — CSS transition makes it glide, never snap.
    el.inner.style.transform = 'rotate(' + e.tilt + 'deg)';
    // Mouth: smile vs frown cross-fade, crooked rotate for confused.
    el.smile.style.opacity = e.frown ? '0' : '1';
    el.frown.style.opacity = e.frown ? '1' : '0';
    var mouthScale = 'scale(' + e.mouth[0] + ',' + e.mouth[1] + ')';
    var mouthRot = e.rotate ? ' rotate(' + e.rotate + 'deg)' : '';
    el.smile.style.transform = mouthScale + mouthRot;
    el.frown.style.transform = mouthScale + mouthRot;
    // Open mouth (speaking / surprised) — opacity only; its height is
    // driven per-frame while speaking (see _speakingLoop).
    el.open.style.opacity = String(e.open);
    el.open.setAttribute('ry', String(4 + e.open * 10));
    // Brows per expression.
    var brow = e.brow || 'flat';
    var showBrows = brow !== 'flat';
    el.browL.style.opacity = showBrows ? '1' : '0';
    el.browR.style.opacity = showBrows ? '1' : '0';
    el.browL.style.transform = brow === 'sad' ? 'rotate(14deg)' : brow === 'oneUp' ? 'translateY(-3px)' : brow === 'raised' ? 'translateY(-3px)' : '';
    el.browR.style.transform = brow === 'sad' ? 'rotate(-14deg)' : brow === 'raised' ? 'translateY(-3px)' : '';
    this._renderEyes();
  };

  // THE blink rule, in one place: a single blink value (_blinkScale) is
  // multiplied into BOTH eyes in the same call, so the eyes can never
  // blink out of sync. Eye scale = expression scale x blink scale.
  EnzoAvatar.prototype._renderEyes = function () {
    var el = this._el;
    if (!el.eyeL || !el.eyeR) return;
    var e = EXPRESSIONS[this.expression] || EXPRESSIONS.neutral;
    var gaze = this._gazeOverride || e.gaze;
    var sy = e.eye[1] * this._blinkScale;
    // Sleepy keeps the eyes nearly shut even between (slow) blinks.
    var transform =
      'translate(' + gaze.x + 'px,' + gaze.y + 'px) ' +
      'scale(' + e.eye[0] + ',' + Math.max(0.05, sy) + ')';
    el.eyeL.style.transform = transform;
    el.eyeR.style.transform = transform;   // <-- same value, both eyes
    // Keep the whole-eye group centred on the gaze (transform-box: fill-box
    // makes each eye scale around its own centre, so no jump).
  };

  /* --- Speaking (mouth speech-sync) --- */
  EnzoAvatar.prototype.setSpeaking = function (onOrLevel) {
    var level = 0;
    if (typeof onOrLevel === 'number') level = clamp(onOrLevel, 0, 1);
    else level = onOrLevel ? 1 : 0;
    var wasSpeaking = this._speaking;
    this._speaking = level > 0;
    this._speakingLevel = level;
    if (this._speaking) {
      if (this.expression !== 'speaking' && this.expression !== 'surprised') {
        this._prevExpression = this.expression;
        this._applyExpression('speaking');
        this.expression = 'speaking';
        this.container.setAttribute('data-expression', 'speaking');
      }
      if (!this._reducedMotion) this._startSpeakingLoop();
    } else {
      this._stopSpeakingLoop();
      // Ease the mouth shut, then return to the previous expression.
      var open = this._el.open;
      if (open) { open.style.opacity = '0'; open.setAttribute('ry', '4'); }
      if (wasSpeaking && this._prevExpression && this._prevExpression !== 'speaking') {
        this.setExpression(this._prevExpression);
      } else if (wasSpeaking) {
        this.setExpression('neutral');
      }
    }
    return this;
  };

  EnzoAvatar.prototype._startSpeakingLoop = function () {
    var self = this;
    if (this._rafId !== null || !this._visible || this._reducedMotion) return;
    this._rafLast = 0;
    function frame(now) {
      if (self._destroyed || !self._speaking || !self._visible) {
        self._rafId = null;
        return;
      }
      // Syllable-ish mouth: a sine wobble with a slow random-ish swell.
      // Cheap — one ellipse attribute + one opacity per frame, nothing else.
      var t = now / 1000;
      var wobble = Math.abs(Math.sin(t * 9.5)) * 0.7 + Math.abs(Math.sin(t * 3.1 + 1.7)) * 0.3;
      var amount = clamp(wobble * self._speakingLevel, 0, 1);
      var open = self._el.open;
      if (open) {
        open.setAttribute('ry', String(3 + amount * 11));
        open.setAttribute('rx', String(11 - amount * 2));
        open.style.opacity = String(0.25 + amount * 0.75);
      }
      var smile = self._el.smile;
      if (smile) smile.style.transform = 'scale(' + (1 - amount * 0.18) + ',' + (1 + amount * 0.35) + ')';
      self._rafId = requestAnimationFrame(frame);
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(frame);
    }
  };

  EnzoAvatar.prototype._stopSpeakingLoop = function () {
    if (this._rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
    var smile = this._el.smile;
    if (smile) smile.style.transform = '';
    this._applyExpression(this.expression);
  };

  /* --- Listening --- */
  EnzoAvatar.prototype.setListening = function (on) {
    this._listening = !!on;
    if (on) {
      this._prevExpression = this.expression;
      this.setExpression('listening');
      this.lookAtUser();
    } else if (this.expression === 'listening') {
      this.setExpression(this._prevExpression && this._prevExpression !== 'listening' ? this._prevExpression : 'neutral');
    }
    return this;
  };
  EnzoAvatar.prototype.isListening = function () { return this._listening; };
  EnzoAvatar.prototype.isSpeaking = function () { return this._speaking; };

  /* --- Idle micro-glances (one timer, idle/neutral only) --- */
  EnzoAvatar.prototype._scheduleGlance = function () {
    var self = this;
    if (this._destroyed || this._reducedMotion || !this._visible) return;
    if (this._glanceTimer !== null) return;
    var delay = 7000 + this._rng() * 7000; // 7–14 s
    this._glanceTimer = setTimeout(function () {
      self._glanceTimer = null;
      if (self._destroyed || self._reducedMotion || !self._visible) return;
      if ((self.expression === 'neutral' || self.expression === 'idle') && !self._speaking && !self._listening) {
        var dirs = [{ x: -4, y: 0 }, { x: 4, y: 0 }, { x: 0, y: -3 }, { x: 3, y: 2 }];
        var g = dirs[Math.floor(self._rng() * dirs.length)];
        self._gazeOverride = g;
        self._renderEyes();
        setTimeout(function () {
          if (self._destroyed) return;
          self._gazeOverride = null;
          self._renderEyes();
        }, 900 + self._rng() * 900);
      }
      self._scheduleGlance();
    }, delay);
  };

  /* --- Lifecycle --- */
  EnzoAvatar.prototype.start = function () {
    if (this._destroyed) return this;
    if (!this._reducedMotion && this._visible) {
      this._scheduleBlink();
      this._scheduleGlance();
    }
    return this;
  };

  EnzoAvatar.prototype.stop = function () {
    this._clearBlinkTimer();
    this._stopSpeakingLoop();
    if (this._glanceTimer !== null) { clearTimeout(this._glanceTimer); this._glanceTimer = null; }
    return this;
  };

  EnzoAvatar.prototype.destroy = function () {
    this.stop();
    this._destroyed = true;
    if (this._observer) { try { this._observer.disconnect(); } catch (e) {} this._observer = null; }
    if (this._onVisibility && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('enzoav');
      this.container.removeAttribute('data-enzo-avatar');
    }
    return this;
  };

  /* --- Mount helper for the assembler: upgrade every [data-enzo-avatar]
         slot on the page into a live avatar, keyed by data-size. --- */
  EnzoAvatar.mountAll = function (root, defaults) {
    var scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return [];
    var nodes = scope.querySelectorAll('[data-enzo-avatar-slot]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.__enzoAvatar) { out.push(node.__enzoAvatar); continue; }
      var opts = {};
      if (defaults) for (var k in defaults) opts[k] = defaults[k];
      if (node.getAttribute('data-size')) opts.size = parseInt(node.getAttribute('data-size'), 10) || opts.size;
      if (node.getAttribute('data-expression')) opts.expression = node.getAttribute('data-expression');
      var av = new EnzoAvatar(node, opts);
      node.__enzoAvatar = av;
      out.push(av);
    }
    return out;
  };

  // Export: browser global + CommonJS (node --check / require both work).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      EnzoAvatar: EnzoAvatar,
      simulateBlinkSchedule: simulateBlinkSchedule,
      nextBlinkIntervalMs: nextBlinkIntervalMs,
      nextBlinkDurationMs: nextBlinkDurationMs,
      BLINK: BLINK,
      EXPRESSIONS: EXPRESSIONS
    };
  }
  global.EnzoAvatar = EnzoAvatar;
  global.__EnzoAvatarSimulateBlinkSchedule = simulateBlinkSchedule;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================================
 * VERIFICATION RESULTS (run 22 Nov 2026, node v24.22.1, before delivery)
 * ----------------------------------------------------------------------------
 * (1) SYNTAX — `node --check 01-avatar-component.js` → PASS (no output,
 *     exit 0). The file is pure JS with CSS/SVG as template strings, so it
 *     checks directly. `require()` in node also works and exposes:
 *     EnzoAvatar, simulateBlinkSchedule, nextBlinkIntervalMs,
 *     nextBlinkDurationMs, BLINK, EXPRESSIONS.
 *
 * (2) BLINK SCHEDULER — virtual 60 s simulation, 10 seeds
 *     (42, 7, 1234, 99, 2026, 555, 31337, 1, 2, 3), via
 *     EnzoAvatar.simulateBlinkSchedule(60, seed). All 10 seeds PASS.
 *
 *     Seed-by-seed (event = one blink, a double counts once):
 *       seed 42:    16 blinks, 2 doubles | gaps min 3173 max 5372 mean 4225 ms
 *       seed 7:     16 blinks, 3 doubles | gaps min 3295 max 5492 mean 4541 ms
 *       seed 1234:  14 blinks, 2 doubles | gaps min 3420 max 6093 mean 4709 ms
 *       seed 99:    14 blinks, 1 double  | gaps min 3154 max 5624 mean 4672 ms
 *       seed 2026:  14 blinks, 2 doubles | gaps min 3296 max 6260 mean 4926 ms
 *       seed 555:   15 blinks, 2 doubles | gaps min 3147 max 5934 mean 4399 ms
 *       seed 31337: 13 blinks, 1 double  | gaps min 3273 max 6428 mean 4937 ms
 *       seed 1:     14 blinks, 2 doubles | gaps min 3564 max 6148 mean 4954 ms
 *       seed 2:     17 blinks, 3 doubles | gaps min 3149 max 6075 mean 4172 ms
 *       seed 3:     14 blinks, 2 doubles | gaps min 3205 max 5983 mean 4891 ms
 *     Durations across all seeds: min 120 ms, max 180 ms, means 143–157 ms
 *     — every duration inside the 120–180 ms band (allDurationsInRange).
 *     Every seed had 1–3 double-blink events (>0 in all 10 runs).
 *     All start-to-start gaps distinct within each run (allIntervalsDistinct).
 *
 *     READING THE NUMBERS HONESTLY: the scheduler draws the IDLE gap
 *     (previous blink END -> next blink START) uniformly from 3000–6000 ms
 *     — that draw is exact by construction (sample draws: 4799, 5443,
 *     5979, 4442, 5703 ms). The "event gaps" above are START-to-START, so
 *     they run ~150 ms longer (one blink duration) and up to ~6.4 s when
 *     the event is a double blink (its second half adds ~0.5 s). That is
 *     why a few maxima sit just above 6000 ms; the underlying idle draw
 *     never leaves 3000–6000 ms. No two intervals are ever exactly equal
 *     (continuous float draws; verified distinct in all 10 runs).
 *
 *     Two bugs were found and fixed while verifying (not hidden):
 *     (a) the first simulation version measured the post-double gap from
 *         the FIRST blink's duration instead of the second's — fixed by
 *         tracking lastDur; (b) the event-start detector merged two
 *         back-to-back doubles into one event (12,094 ms phantom gap on
 *         seed 2026) — fixed by tagging the second half explicitly
 *         (secondHalf flag) instead of inferring it from neighbours.
 *
 * (3) BOTH EYES TOGETHER — confirmed by code inspection, not just intent:
 *     _renderEyes() computes ONE `transform` string from the single
 *     _blinkScale value and assigns that same string to BOTH
 *     el.eyeL.style.transform and el.eyeR.style.transform in the same
 *     call (lines ~731–732). There is no per-eye blink state anywhere in
 *     the file. Grep: `el.eyeL.style.transform = transform;` immediately
 *     followed by `el.eyeR.style.transform = transform; // same value`.
 *
 * NOT VERIFIED HERE (needs the assembler / a live browser):
 *   - Rendering in a real browser (SVG paint, CSS transform-box on the
 *     eye groups, drop-shadow cost at 34 px and 48 px sizes).
 *   - Wiring into setCentreEnzo() / #brandHome / buildMessageEl() —
 *     this piece only documents the anchors; the assembler does the swap.
 *   - Speech-sync timing against real TTS audio (mouth wobble is a
 *     9.5 Hz sine + slow swell; it looks like talking but is not driven
 *     by the audio waveform — a future piece could feed real levels into
 *     setSpeaking(level 0..1), which already accepts a number).
 * ============================================================================
 */
