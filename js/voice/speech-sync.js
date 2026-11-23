
/* ============================================================================
 * PIECE 4 — SPEECH SYNC (ENZO face/avatar upgrade, artifact slug: enao-ai)
 * File: 04-speech-sync.js  |  Builds on v51 (room/scene + RTL bubbles + SMS
 * text size). Depends on: Piece 1 (01-avatar-component.js) — see §5.
 *
 * WHAT THIS PIECE IS
 * ------------------
 * The speaking/listening state machine + mouth-sync driver for ENZO's face.
 * While ENZO speaks (real TTS audio), the face shows the Speaking
 * expression and the mouth moves IN SYNC WITH ACTUAL SPEECH ACTIVITY —
 * never on a fixed loop. While listening, the face is attentive and the
 * mouth is still. When speech stops, the face returns to idle + normal
 * blinking. When the user asked for a text reply, there is no speaking
 * animation at all. The 3D robot is driven from the SAME speech-activity
 * source (see §6), so avatar and robot can never disagree.
 *
 * MOUTH-SYNC SOURCE — DECISION (read this first)
 * ----------------------------------------------
 * PRIMARY: SpeechSynthesisUtterance `onboundary` (word-boundary) events.
 * Each boundary tick kicks the mouth open in proportion to the spoken
 * word's length; the mouth then decays toward closed until the next tick.
 * This is real speech timing, not a loop.
 * FALLBACK: a lightweight amplitude PROXY. Chrome's `onboundary` is
 * unreliable — many voices (notably ur-PK and several en-US voices) never
 * fire it, which would leave a frozen mouth on Raja's device. So: if no
 * boundary event arrives within 600 ms of speech starting, the driver
 * switches to proxy mode — short syllable-shaped mouth kicks
 * (90–160 ms, open 0.35–0.9) that run ONLY while
 * `window.speechSynthesis.speaking === true` AND `!speechSynthesis.paused`.
 * The proxy is hard-gated on the engine provably speaking; the instant
 * `speaking` is false, paused, ended or errored, the mouth freezes shut.
 * It is therefore NOT a fixed loop: it cannot run without live speech.
 * The active source is exposed as `EnzoSpeechSync.state().mouthSource`
 * ('boundary' | 'proxy' | 'none') so a live check can report which one
 * Raja's browser actually used.
 * PAUSE: the answer player pauses via `speechSynthesis.pause()` (see
 * anchor A9). The driver polls `speechSynthesis.paused` in its decay
 * loop and freezes the mouth closed while paused; resume re-arms it.
 * FALSE-START GUARD: `speakText` calls `beginSpeak()` on a 120 ms timer
 * (anchor A5) even before audio starts, so "speaking state" can be on
 * while no sound plays yet. This piece opens the mouth ONLY on a boundary
 * tick or a proxy tick gated on `speechSynthesis.speaking === true` —
 * never on `beginSpeak` / `setVoiceState('speaking')` alone.
 *
 * ============================================================================
 * §1 — ANCHORS IN THE CURRENT CODE (verified by grep against the v50 export
 *      ~/workspace/your_files/enao-ai/enao-ai.html, 10,340 lines, on
 *      22 Nov 2026; v51 changed only room/scene + RTL bubbles + SMS text,
 *      so the speech code below is unchanged from v50)
 * ----------------------------------------------------------------------------
 *  A1  wantsTextReply(text) ............ line 4427
 *      `function wantsTextReply(text){`
 *      Regexes match 'text mein bhejo / text me send / likh kar bhej /
 *      sirf text / reply in text' (+ Urdu). THE text-reply detector.
 *  A2  flushVoiceQueue() ............... line 4440
 *      `function flushVoiceQueue(){`
 *      Guard: `if(state.isGenerating || state.isSpeaking) return;`
 *  A3  maybeSpeak(msg) ................. line 4450
 *      `function maybeSpeak(msg){`
 *      Text-reply early return, lines 4451–4455:
 *        `if(msg && msg.viaVoice && msg.question && wantsTextReply(msg.question)){`
 *        `  if(state.voiceLive) setVoiceState('on');`
 *        `  flushVoiceQueue();`
 *        `  return;`
 *      Speech path, line ~4458: `if(md==='on' || msg.viaVoice) speakText(msg.plain, msg.lang);`
 *      (md === answersMode(); 'off' branch also returns without speaking.)
 *  A4  setVoiceState(vs) ............... line 4479
 *      `function setVoiceState(vs){`
 *      THE single funnel: every speech path announces itself here
 *      ('listening' / 'processing' / 'speaking' / 'on' / 'off' / 'blocked').
 *      It also calls `setCentreEnzo('listening'|'speaking'|'thinking')`
 *      (lines ~4496–4498), which is what drives the face + robot today.
 *  A5  speakText(text, lang) ........... line 4538
 *      `function speakText(text, lang){`
 *      Inner `beginSpeak()` lines 4558–4563:
 *        `function beginSpeak(){`
 *        `  if(started) return; started=true;`
 *        `  state.isSpeaking=true;`
 *        `  pauseRecognitionForSpeech();`
 *        `  setVoiceState('speaking');`
 *      Utterance wiring lines 4564–4567:
 *        `u.onstart=beginSpeak;`                                            (4564)
 *        `u.onboundary=function(){ if(!started) beginSpeak(); };`            (4565)
 *        `u.onend=function(){ currentUtterance=null; afterSpeaking(); };`   (4566)
 *        `u.onerror=function(){ currentUtterance=null; afterSpeaking(); };` (4567)
 *      `setTimeout(beginSpeak, 120);` — fires even before audio starts     (4571)
 *      Safety timeout line ~4573: if `!speechSynthesis.speaking`, calls
 *      `afterSpeaking()` (covers silently-dropped utterances).
 *      NOTE: `onboundary` here only (re)starts the speaking STATE — it
 *      carries no mouth data today. This piece chains onto it.
 *  A6  afterSpeaking() ................. line 4576
 *      `function afterSpeaking(){`
 *      Sets `state.isSpeaking=false`, `setVoiceState('on'|'off')`,
 *      `resumeRecognitionAfterSpeech()`, `flushVoiceQueue()`.
 *      THE single "speech has ended" funnel for the auto path.
 *  A7  stopSpeaking() .................. line 4584
 *      `function stopSpeaking(){` — `speechSynthesis.cancel()` + clears
 *      `currentUtterance` / `state.isSpeaking`.
 *  A8  playerSpeakChunk() .............. line 4620
 *      `function playerSpeakChunk(){`
 *      Per-chunk utterance. Has ONLY `u.onend` (line 4629, advances to the
 *      next chunk) and `u.onerror` (line 4630). NO `onstart`, NO
 *      `onboundary` — so the Listen-Aloud player gets NO mouth ticks
 *      unless this piece adds them (it does, via the §3 speak() wrap).
 *      Ends via `playerCleanup()` (line 4611) → `afterSpeaking()`.
 *  A9  playerStart(wrapEl, m) .......... line 4650
 *      `function playerStart(wrapEl, m){`
 *      Speaking state, line ~4658:
 *        `state.isSpeaking=true; pauseRecognitionForSpeech(); setVoiceState('speaking');`
 *      `playerToggle` (line 4669) pauses/resumes via
 *      `speechSynthesis.pause()` / `.resume()` — mouth must freeze on pause.
 *      `playerStop(user)` line 4644 → `playerStopInternal()` (4637) +
 *      `afterSpeaking()`.
 * A10  buildRecognition() .............. line 4676
 *      `function buildRecognition(){`
 *        `r.onstart=function(){ state.isListening=true;`                    (4681)
 *        `  if(state.voiceLive && !state.isSpeaking) setVoiceState('listening'); };`
 *        `r.onend=function(){ state.isListening=false; ... restart ... };`  (4682)
 *        `r.onerror=function(e){ ... 'not-allowed' → showMicBlocked(); ... };` (4689)
 *        `r.onresult=function(ev){ ... }`                                    (4699)
 *          interim → fills the input box; final text while
 *          `state.isGenerating || state.isSpeaking` → queued into
 *          `state.voiceQueue` (NOT spoken, NOT lost); otherwise
 *          `setVoiceState('processing', ...)` + `sendCurrent()` after 300 ms.
 * A11  startRecognition() .............. line 4725
 *      pauseRecognitionForSpeech() ..... line 4732 (`recognition.stop()` while speaking)
 *      resumeRecognitionAfterSpeech() .. line 4735 (restart 350 ms after speech)
 *      turnMicOn() ..................... line 4748 / turnMicOff(reason) line 4765
 * A12  setCentreEnzo(st) ............... line 2551
 *      `function setCentreEnzo(st){`
 *      Sets `data-state` on `[data-enzoav]` + `#typingAv`, then calls
 *      `window.setEnzoState(st)` (line 2557) — the bridge to the 3D robot.
 * A13  window.setEnzoState ............. line 5851 (3D panel block)
 *      `window.setEnzoState=function(name){ ... }`
 *      Maps via STATE_TO_EXPR (line 5839: speaking→'speaking',
 *      listening→'listening') and STATE_TO_ACTIVITY (line 5838:
 *      speaking→'speaking', listening→'idle'), then per 3D instance:
 *      `inst.enzo.setExpression(expr)` + `inst.anim.setActivity(act)` +
 *      `inst.cams.autoSelect(act)` (lines 5844–5848).
 * A14  Existing orb speaking CSS ....... line 1396
 *      `.enzo-av[data-state="speaking"] .orb-eyes i{animation:enzotalk .5s ...}`
 *      + `@keyframes enzotalk` (~line 1402, eyes scaleY .7↔1.15).
 *      EYE-ONLY, fixed-loop, no mouth element exists in the v50 orb.
 *      This piece does NOT use it for the mouth; see §5 for the mouth node.
 * A15  Existing voice patch ............ lines 10020–10027
 *      `if('speechSynthesis' in window && !window.__enzoVoicePatched){`
 *      Already wraps `speechSynthesis.speak` once. This piece's §3 wrap
 *      MUST chain onto whatever `speak` currently is — never replace it.
 *
 * §2 — V51 ANIMATION-PIECE HOOKS (~/workspace/enao-room-rebuild/pieces/
 *      04-animations.js — the v51 room rebuild, NOT the v50 export)
 * ----------------------------------------------------------------------------
 *  B1  Internal `setExpression(name)` — line 266 → `enzo.setExpression(name)`.
 *  B2  Internal `setSpeaking(on)` .... — line 272 → `enzo.setSpeaking(!!on)`.
 *      B1/B2 are CLOSURE-PRIVATE: `createAnimationSystem()` returns only
 *      `{play, update, stop, current, setActivity, setStartPosition,
 *      getPose, getHeld, isHolding, listSequences, SEQUENCES, _state}`
 *      (lines 1331–1347). There is NO public `setSpeaking`/`setExpression`
 *      on the animation system — do NOT call `anim.setSpeaking(...)`.
 *  B3  ACTIVITY_MAP, line ~203: `speaking: ['talkToCamera']` (loopable).
 *      `speaking` builder, line ~1112: `buildExpression('speaking', 2.5, true)`
 *      — a 2.5 s ONE-SHOT. For continuous TTS, hold the state via the
 *      activity path (`setActivity('speaking')` → talkToCamera), never by
 *      re-playing the 2.5 s expression per boundary tick.
 *  B4  Ambient blink layer, lines 1189–1196: `nextBlink` 2.5–5 s random →
 *      `doBlink()` → `enzo.blink()`. The robot already blinks on its own;
 *      this piece must NOT fight it — it only drives the 2D avatar blink,
 *      and never disables the robot's ambient layer.
 *
 * ============================================================================
 * §3 — INTEGRATION (paste these; nothing else in the app changes)
 * ----------------------------------------------------------------------------
 *  STEP 1 — Load order (after Piece 1, after the app's own scripts):
 *      <script src="01-avatar-component.js"><\/script>
 *      <script src="04-speech-sync.js"><\/script>
 *      <script>EnzoSpeechSync.install();<\/script>
 *    `install()` is idempotent and safe to call before Piece 1 loads:
 *    the avatar is resolved lazily on every state change, so load order
 *    between Pieces 1 and 4 does not matter.
 *  STEP 2 — Zero-edit mode (recommended): `install()` wraps the two
 *    funnels — `setVoiceState` (A4) and `speechSynthesis.speak` (A15,
 *    chained) — so speaking/listening/processing/text-reply all flow
 *    through this piece with NO edits to the app's speech pipeline.
 *    The wraps call the originals first, then notify this piece; if
 *    this piece throws, the original behaviour is untouched (try/catch
 *    around every notification).
 *  STEP 3 — Explicit one-line hooks (optional but preferred for the
 *    text-reply case, so the intent is visible in the app code):
 *      A3  maybeSpeak, inside the text-reply branch (after line 4453
 *          `flushVoiceQueue();`, before `return;`):
 *            `if(window.EnzoSpeechSync) EnzoSpeechSync.noteTextReply();`
 *      A5  speakText, inside `beginSpeak()` (after line 4562
 *          `setVoiceState('speaking');`):
 *            `if(window.EnzoSpeechSync) EnzoSpeechSync.noteSpeechStarted();`
 *      A6  afterSpeaking(), at the top (before the `speechOwner` guard):
 *            `if(window.EnzoSpeechSync) EnzoSpeechSync.noteSpeechEnded('afterSpeaking');`
 *      A10 `r.onresult`, in the final-text branch where it queues while
 *          busy (after `state.voiceQueue=...`): nothing needed — the
 *          queued words are NOT speech, and the state is already
 *          'speaking'; do NOT add a hook there (a hook there would be
 *          the classic bug: mouth moving for queued text).
 *      A9  playerToggle pause/resume: nothing needed — the decay loop
 *          polls `speechSynthesis.paused` (see §"MOUTH-SYNC SOURCE").
 *    If Steps 2 and 3 are BOTH applied, nothing double-fires: every
 *    `note*` method is idempotent for the current mode.
 *  STEP 4 — CSS: `install()` injects the scoped stylesheet (see §7).
 *    No app CSS file needs editing. It also pauses the fixed-loop
 *    `.enzo-av` eye flutter (A14) while this piece drives the eyes, so
 *    the two eye motions never fight.
 *  STEP 5 — Do NOT: rewrite `speakText`/`playerSpeakChunk`/`maybeSpeak`,
 *    add a `setInterval` mouth loop gated on nothing, call
 *    `anim.setSpeaking` (does not exist, B2), re-play the 2.5 s
 *    `speaking` expression per word (B3), or create a second face SVG.
 *
 * §4 — STATE MACHINE (modes; `EnzoSpeechSync.state()` reports all of these)
 * ----------------------------------------------------------------------------
 *    IDLE       — expr Idle, mouth 0, blink normal (2.8–5.5 s random).
 *    LISTENING  — expr Listening, mouth 0 FORCED (no mouth motion even
 *                 while the mic level meter moves), blink normal,
 *                 eyes attentive (slight forward focus).
 *    THINKING   — expr Thinking (recognizer final → 'processing'),
 *                 mouth 0, blink normal.
 *    SPEAKING   — expr Speaking, mouth driven by boundary ticks or the
 *                 gated proxy, slight eye movement per tick, occasional
 *                 blink, gentle head sway (±2.5°). Mouth freezes at 0
 *                 while TTS is paused. Ends → IDLE, or → LISTENING if
 *                 `state.voiceLive` is still on (live call continues).
 *    TEXT-REPLY — not a held mode: `noteTextReply()` forces IDLE with
 *                 mouth 0 and sets a guard so a stale `beginSpeak`
 *                 timer (A5, line 4571) cannot re-enter SPEAKING for
 *                 that answer. Never shows the Speaking expression.
 *  Priority (highest wins): TEXT-REPLY guard > SPEAKING > THINKING >
 *  LISTENING > IDLE. A `noteSpeechEnded` while listening resumes
 *  LISTENING only if the app says the mic is still live; otherwise IDLE.
 *
 * §5 — DEPENDENCIES + CONTRACT FOR PIECE 1 (01-avatar-component.js)
 * ----------------------------------------------------------------------------
 *  UPDATE (22 Nov 2026, after this piece was drafted): Piece 1 LANDED in
 *  parallel — ~/workspace/enao-face-avatar/01-avatar-component.js now
 *  exists, and this piece was updated to drive its REAL API (verified by
 *  reading it, not by the draft contract). What the real Piece 1 is:
 *    - `EnzoAvatar` is a CONSTRUCTOR (global), not a singleton object:
 *      `new EnzoAvatar(container, {size, expression})`. Mounted instances
 *      are found via `EnzoAvatar.mountAll(root)` and cached on each slot
 *      node as `node.__enzoAvatar`. This piece NEVER calls `mountAll`
 *      (mounting is the assembler's job); it discovers already-mounted
 *      instances lazily on every state change.
 *    - `setExpression(name)` lowercases/normalises, so the capitalised
 *      names in the draft contract (Speaking/Listening/Idle/Thinking)
 *      work unchanged. `setListening(on)` applies 'listening' itself +
 *      `lookAtUser()`. `setSpeaking(onOrLevel)` accepts a BOOLEAN or a
 *      NUMBER 0..1 mouth level.
 *    - `setSpeaking(level)` ALSO starts Piece 1's own rAF mouth loop
 *      (`_startSpeakingLoop`, lines ~772–798), whose motion is a SINE
 *      WOBBLE: `amount = clamp(wobble * level, 0, 1)` with
 *      `wobble = |sin(t*9.5)|*0.7 + |sin(t*3.1+1.7)|*0.3`. CONSEQUENCE:
 *      the on-screen mouth is (Piece 1 sine wobble) × (this piece's
 *      boundary/proxy level). This piece's level GATES it — the mouth is
 *      fully closed between words, while paused, while listening and
 *      while silent — but WITHIN a word the shape is Piece 1's sine,
 *      not the boundary shape. For TRUE boundary-only mouth motion,
 *      Piece 1 needs a level-only path (e.g. `setMouthLevel(level)`
 *      writing the `[data-mouth="open"]` ellipse directly WITHOUT
 *      starting the wobble loop). That is a Piece 1 change for the
 *      assembler to approve — this piece does NOT edit Piece 1.
 *    - `setSpeaking(false)` / `setListening(false)` RESTORE the previous
 *      expression internally. This piece therefore always asserts its own
 *      expression AFTER any stop call (see `enterMode` ordering).
 *    - Piece 1 owns its own blink scheduler (`_scheduleBlink`) and its
 *      own gaze/tilt. This piece's blink layer only drives the legacy
 *      `[data-enzoav]` orb fallback and skips Piece 1 roots.
 *  This piece still honours the DRAFT contract as a fallback: if a
 *  global `EnzoAvatar` OBJECT (not a constructor) with `setExpression` /
 *  `setSpeaking` / `setListening` exists, it is driven as a singleton.
 *  MOUTH NODE (real Piece 1): the open mouth is the SVG ellipse
 *  `[data-mouth="open"]` (class `.enzoav-open`); the smile/frown paths
 *  are `[data-mouth="smile"]` / `[data-mouth="frown"]`. There is NO
 *  `[data-enzo-mouth]` node in Piece 1 — that selector remains only as
 *  the fallback contract for other avatar hosts. This piece sets BOTH:
 *  the per-instance `setSpeaking(level)` (primary, Piece 1) and the CSS
 *  variable `--enzo-mouth-open` + inline transform on any
 *  `[data-enzo-mouth]` node (fallback hosts). If no mouth node of either
 *  kind exists yet, the mouth value is still tracked
 *  (`state().mouthOpen`), still exposed on the roots as the variable,
 *  and still asserted in the simulation.
 *  HEAD/EYES: Piece 1 drives tilt/gaze from its expression table, so
 *  this piece does NOT move its head/eyes (no `[data-enzo-head]` /
 *  `[data-enzo-eyes]` nodes exist in Piece 1). The `--enzo-head-yaw` /
 *  `--enzo-eye-x` variables are still set on avatar roots for fallback
 *  hosts. Absent = skipped, never an error.
 *
 * §6 — ROBOT SYNC (avatar + 3D robot from the SAME source)
 * ----------------------------------------------------------------------------
 *  There is NO direct robot mouth hook to drive: the v51 animation
 *  piece's `setSpeaking` is closure-private (B2) and its public API has
 *  no speaking setter. The robot is ALREADY driven from the same source
 *  this piece uses: `setVoiceState` (A4) → `setCentreEnzo` (A12) →
 *  `window.setEnzoState` (A13) → `STATE_TO_EXPR speaking→'speaking'` +
 *  `STATE_TO_ACTIVITY speaking→'speaking'` → `enzo.setExpression` +
 *  `anim.setActivity('speaking')` → talkToCamera (B3). So this piece
 *  deliberately does NOT call `setEnzoState` itself while the app chain
 *  is intact — one source, no second path that could disagree. Only if
 *  `setCentreEnzo` is missing does `install()` fall back to calling
 *  `window.setEnzoState` directly. The robot's ambient blink (B4) is
 *  untouched. Honest limit: the 3D robot's mouth is whatever Piece 3's
 *  `enzo.setSpeaking` does internally — this piece cannot verify it
 *  from here; it can only guarantee the robot receives the same
 *  speaking/listening/idle signal at the same moment as the avatar.
 *
 * §7 — SCOPED CSS (injected by install(); all selectors prefixed)
 * ----------------------------------------------------------------------------
 *  See `SPEECH_SYNC_CSS` below. It styles only `[data-enzo-mouth]`,
 *  `[data-enzo-head]`, `[data-enzo-eyes]`, `[data-enzo-speaking]` and
 *  the `.enzo-av` fallback, honours `prefers-reduced-motion` (mouth
 *  still, expression only), and pauses the fixed-loop A14 eye flutter
 *  while this piece drives the eyes.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var hasWindow = typeof window !== 'undefined';
  var hasDocument = typeof document !== 'undefined';

  /* ------------------------------------------------------------------ */
  /* Constants (tuned for a natural, non-mechanical feel)                */
  /* ------------------------------------------------------------------ */
  var BOUNDARY_TIMEOUT_MS = 600;   /* no onboundary in this long -> proxy */
  var PROXY_TICK_MS = 120;         /* syllable-ish cadence of proxy kicks */
  var MOUTH_DECAY_PER_MS = 0.004;  /* open decays toward 0 between ticks  */
  var MOUTH_MIN_OPEN = 0.15;       /* mouth never fully vanishes (rest)   */
  var BLINK_MIN_MS = 2800;         /* natural blink interval, randomised  */
  var BLINK_MAX_MS = 5500;
  var BLINK_CLOSE_MS = 150;        /* ~120-180 ms lid closure             */
  var HEAD_SWAY_DEG = 2.5;         /* gentle head sway while speaking     */
  var CSS_ID = 'enzo-speech-sync-css';

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  var mode = 'idle';               /* idle|listening|thinking|speaking   */
  var expression = 'Idle';         /* Idle|Listening|Thinking|Speaking   */
  var mouthOpen = 0;               /* 0..1, what the mouth shows now     */
  var mouthSource = 'none';        /* none|boundary|proxy                 */
  var speaking = false;            /* TTS audio actually in progress     */
  var listening = false;           /* recognizer active, user may speak  */
  var paused = false;              /* TTS paused (playerToggle)          */
  var textReplyGuardUntil = 0;     /* ms timestamp; stale beginSpeak blocked */
  var lastBoundaryAt = 0;          /* ms timestamp of last onboundary    */
  var boundarySeenThisUtterance = false;
  var blinkTimer = null;
  var decayTimer = null;
  var proxyTimer = null;
  var headPhase = 0;
  var installed = false;

  function now() { return Date.now(); }

  /* ------------------------------------------------------------------ */
  /* Avatar resolution (lazy — Piece 1 may mount after this piece loads) */
  /* Two shapes are supported, in this order:                           */
  /*  (a) REAL Piece 1: global EnzoAvatar CONSTRUCTOR; mounted          */
  /*      instances cached on their slot nodes as node.__enzoAvatar.    */
  /*  (b) DRAFT contract: global EnzoAvatar OBJECT (not a constructor)  */
  /*      with setExpression/setSpeaking/setListening — driven as a      */
  /*      singleton.                                                    */
  /* ------------------------------------------------------------------ */
  var injectedInstances = null;   /* test seam only (see _injectInstances) */
  var lastInstanceLevel = -1;     /* -1 = unknown/off, else last level sent */
  var lastInstanceOn = false;

  function getAvatarSingleton() {
    var av = null;
    if (typeof global.EnzoAvatar !== 'undefined') av = global.EnzoAvatar;
    else if (hasWindow && typeof window.EnzoAvatar !== 'undefined') av = window.EnzoAvatar;
    /* A constructor function is NOT a singleton — instances live on slots. */
    if (!av || typeof av === 'function') return null;
    if (typeof av.setExpression === 'function') return av;
    return null;
  }
  function resolveInstances() {
    if (injectedInstances) return injectedInstances.slice();
    var out = [];
    var single = getAvatarSingleton();
    if (single) out.push(single);
    if (hasDocument) {
      var slots = document.querySelectorAll('[data-enzo-avatar-slot]');
      for (var i = 0; i < slots.length; i++) {
        var inst = slots[i].__enzoAvatar;
        if (inst && out.indexOf(inst) === -1) out.push(inst);
      }
      var avNodes = document.querySelectorAll('[data-enzo-avatar]');
      for (var k = 0; k < avNodes.length; k++) {
        var inst2 = avNodes[k].__enzoAvatar;
        if (inst2 && out.indexOf(inst2) === -1) out.push(inst2);
      }
    }
    return out;
  }
  function avatarRoots() {
    if (!hasDocument) return [];
    var roots = [];
    var avs = document.querySelectorAll('[data-enzoav]');
    for (var i = 0; i < avs.length; i++) roots.push(avs[i]);
    var typing = document.getElementById('typingAv');
    if (typing && roots.indexOf(typing) === -1) roots.push(typing);
    var slots = document.querySelectorAll('[data-enzo-avatar-slot]');
    for (var j = 0; j < slots.length; j++) {
      if (roots.indexOf(slots[j]) === -1) roots.push(slots[j]);
    }
    var avNodes = document.querySelectorAll('[data-enzo-avatar]');
    for (var n = 0; n < avNodes.length; n++) {
      if (roots.indexOf(avNodes[n]) === -1) roots.push(avNodes[n]);
    }
    var single = getAvatarSingleton();
    if (single && typeof single.getRoot === 'function') {
      try { var r = single.getRoot(); if (r && roots.indexOf(r) === -1) roots.push(r); } catch (e) {}
    }
    return roots;
  }
  function hostsPiece1(root) {
    if (!root) return false;
    try {
      if (root.__enzoAvatar) return true;
      if (root.hasAttribute && root.hasAttribute('data-enzo-avatar-slot')) return true;
      if (root.hasAttribute && root.hasAttribute('data-enzo-avatar')) return true;
      if (root.querySelector && root.querySelector('[data-enzo-avatar-slot]')) return true;
    } catch (e) {}
    return false;
  }
  function setExpressionOnAvatar(name) {
    expression = name;
    var insts = resolveInstances();
    for (var i = 0; i < insts.length; i++) {
      var av = insts[i];
      if (av && typeof av.setExpression === 'function') {
        try { av.setExpression(name); } catch (e) {}
      }
    }
    /* Fallback when no avatar instance exists: the existing data-state
       path (A12) already maps Idle/Listening/Thinking/Speaking onto the
       orb; the app's setCentreEnzo drives it, so nothing else is needed. */
  }
  /* Drive the per-instance mouth level (real Piece 1: setSpeaking(level)).
     Piece 1's setSpeaking(false) STOPS its loop and restores the previous
     expression, so it is called ONLY on a true stop/pause — never for a
     mid-utterance decay to ~0. While speaking, the level is floored at
     0.05 (mouth ~closed, loop alive, no expression restore flicker).
     Throttled to >=0.05 changes so a 60 fps decay loop does not spam it. */
  function driveInstanceMouth(force, overrideOn) {
    var wantOn = (typeof overrideOn === 'boolean') ? overrideOn : (speaking && !paused);
    var insts = resolveInstances();
    if (!wantOn) {
      if (lastInstanceOn || force) {
        for (var i = 0; i < insts.length; i++) {
          try { if (typeof insts[i].setSpeaking === 'function') insts[i].setSpeaking(false); } catch (e) {}
        }
      }
      lastInstanceOn = false;
      lastInstanceLevel = -1;
      return;
    }
    var level = Math.max(0.05, mouthOpen);
    if (!force && lastInstanceOn && Math.abs(level - lastInstanceLevel) < 0.05) return;
    for (var j = 0; j < insts.length; j++) {
      try { if (typeof insts[j].setSpeaking === 'function') insts[j].setSpeaking(level); } catch (e) {}
    }
    lastInstanceOn = true;
    lastInstanceLevel = level;
  }
  function setSpeakingOnAvatar(on) {
    driveInstanceMouth(true, !!on);
  }
  function setListeningOnAvatar(on) {
    var insts = resolveInstances();
    for (var i = 0; i < insts.length; i++) {
      var av = insts[i];
      if (av && typeof av.setListening === 'function') {
        try { av.setListening(!!on); } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mouth / head / eyes application                                     */
  /* ------------------------------------------------------------------ */
  function applyMouth() {
    /* Primary mouth path (real Piece 1) runs even without a DOM — the
       Node simulation drives injected instances through this same call. */
    driveInstanceMouth(false);
    if (!hasDocument) return;
    var v = mouthOpen;
    var roots = avatarRoots();
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      try {
        root.style.setProperty('--enzo-mouth-open', String(v));
        root.style.setProperty('--enzo-head-yaw', (speaking && !paused ? (Math.sin(headPhase) * HEAD_SWAY_DEG).toFixed(2) + 'deg' : '0deg'));
        if (speaking) root.setAttribute('data-enzo-speaking', 'true');
        else root.removeAttribute('data-enzo-speaking');
      } catch (e) {}
    }
    /* Inline transform on the mouth node itself (Piece 1 contract, §5).
       scaleY floor keeps a resting mouth line instead of a vanishing slit. */
    var mouths = document.querySelectorAll('[data-enzo-mouth]');
    for (var j = 0; j < mouths.length; j++) {
      try {
        mouths[j].style.transform = 'scaleY(' + (MOUTH_MIN_OPEN + (1 - MOUTH_MIN_OPEN) * v).toFixed(3) + ')';
      } catch (e) {}
    }
    var heads = document.querySelectorAll('[data-enzo-head]');
    for (var k = 0; k < heads.length; k++) {
      try {
        heads[k].style.transform = 'rotate(' + (speaking && !paused ? (Math.sin(headPhase) * HEAD_SWAY_DEG).toFixed(2) + 'deg' : '0deg') + ')';
      } catch (e) {}
    }
    /* Fallback hosts get the CSS variable + inline transform above;
       the primary Piece 1 instance path already ran at the top of
       applyMouth (driveInstanceMouth). */
  }
  function setMouth(value) {
    var next = Math.max(0, Math.min(1, value));
    if (next === mouthOpen) return;
    mouthOpen = next;
    applyMouth();
  }
  function closeMouth() {
    mouthSource = 'none';
    setMouth(0);
    applyMouth();
  }

  /* ------------------------------------------------------------------ */
  /* Blink engine — natural, randomised, both eyes together; runs in    */
  /* every mode (including speaking, occasionally) and never blocks the   */
  /* mouth. The 3D robot's own ambient blink (B4) is untouched.          */
  /* ------------------------------------------------------------------ */
  function scheduleBlink() {
    if (!hasDocument) return;
    clearTimeout(blinkTimer);
    var delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimer = setTimeout(function () {
      var roots = avatarRoots();
      for (var i = 0; i < roots.length; i++) {
        /* Piece 1 instances blink themselves (_scheduleBlink) — never
           double-drive their eyes from here. */
        if (hostsPiece1(roots[i])) continue;
        try { roots[i].setAttribute('data-enzo-blink', 'true'); } catch (e) {}
      }
      setTimeout(function () {
        for (var j = 0; j < roots.length; j++) {
          if (hostsPiece1(roots[j])) continue;
          try { roots[j].removeAttribute('data-enzo-blink'); } catch (e) {}
        }
      }, BLINK_CLOSE_MS);
      scheduleBlink();
    }, delay);
  }

  /* ------------------------------------------------------------------ */
  /* Mouth driver                                                        */
  /*                                                                     */
  /* _advance(dtMs): decay step. Called by the rAF/setTimeout loop in    */
  /* the browser and directly by the Node simulation (see §9).           */
  /* ------------------------------------------------------------------ */
  function engineSpeakingNow() {
    try {
      if (!hasWindow || !window.speechSynthesis) return speaking;
      return !!window.speechSynthesis.speaking;
    } catch (e) { return speaking; }
  }
  function enginePausedNow() {
    try {
      if (!hasWindow || !window.speechSynthesis) return paused;
      return !!window.speechSynthesis.paused;
    } catch (e) { return paused; }
  }
  function _advance(dtMs) {
    if (!speaking) { if (mouthOpen !== 0) closeMouth(); return; }
    paused = enginePausedNow();
    if (paused) { if (mouthOpen !== 0) setMouth(0); applyMouth(); return; }
    /* Proxy fallback arming: boundary mode stays authoritative while
       ticks keep arriving; only silence > 600 ms hands over to proxy. */
    if (!boundarySeenThisUtterance && now() - lastBoundaryAt > BOUNDARY_TIMEOUT_MS) {
      if (mouthSource !== 'proxy') mouthSource = engineSpeakingNow() ? 'proxy' : 'none';
    }
    headPhase += (dtMs / 1000) * 0.9;
    /* Decay toward closed between ticks; a tick re-kicks (see below). */
    if (mouthOpen > 0) setMouth(mouthOpen - MOUTH_DECAY_PER_MS * dtMs);
    applyMouth();
  }
  function startDecayLoop() {
    if (!hasWindow) return;
    stopDecayLoop();
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(now()); }, 50); };
    var caf = window.cancelAnimationFrame || function (id) { clearTimeout(id); };
    var last = now();
    var cancelled = false;
    var rafId = null;
    function loop(t) {
      if (cancelled) return;
      var dt = Math.min(100, Math.max(0, t - last));
      last = t;
      _advance(dt);
      rafId = raf(loop);
    }
    decayTimer = { cancel: function () { cancelled = true; if (rafId != null) { try { caf(rafId); } catch (e) {} } } };
    rafId = raf(loop);
  }
  function stopDecayLoop() {
    if (decayTimer) {
      try { if (decayTimer.cancel) decayTimer.cancel(); } catch (e) {}
      decayTimer = null;
    }
  }
  function startProxyTicks() {
    if (!hasWindow) return;
    stopProxyTicks();
    proxyTimer = setInterval(function () {
      if (!speaking || paused) return;
      if (mouthSource !== 'proxy') return; /* boundary mode owns the mouth */
      if (!engineSpeakingNow()) return;    /* hard gate: no speech, no motion */
      proxyKick();
    }, PROXY_TICK_MS);
  }
  function stopProxyTicks() {
    if (proxyTimer) { clearInterval(proxyTimer); proxyTimer = null; }
  }
  /* Syllable-shaped kick: open scaled by a pseudo-random syllable weight.
     Only ever called while the engine reports speaking (see startProxyTicks
     and onBoundaryTick), so this can never animate a silent mouth. */
  function proxyKick() {
    if (!speaking || paused || !engineSpeakingNow()) return;
    var w = 0.35 + Math.random() * 0.55;
    setMouth(Math.max(mouthOpen, w));
  }
  /* Boundary tick: `charIndex`/`charLength` come from the
     SpeechSynthesisUtterance onboundary event. Longer words open wider;
     the eye also darts slightly, so the face looks alive, not mechanical. */
  function onBoundaryTick(ev) {
    if (!speaking || paused) return;
    lastBoundaryAt = now();
    boundarySeenThisUtterance = true;
    mouthSource = 'boundary';
    var len = (ev && typeof ev.charLength === 'number' && ev.charLength > 0) ? ev.charLength : 5;
    var open = Math.min(1, 0.45 + len * 0.06);
    setMouth(Math.max(mouthOpen, open));
    if (hasDocument) {
      var eyes = document.querySelectorAll('[data-enzo-eyes]');
      var dx = (Math.random() * 4 - 2).toFixed(1);
      for (var i = 0; i < eyes.length; i++) {
        try { eyes[i].style.setProperty('--enzo-eye-x', dx + 'px'); } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mode transitions (the state machine)                                */
  /* ------------------------------------------------------------------ */
  function enterMode(next, expr) {
    mode = next;
    /* Ordering matters — Piece 1's setSpeaking(false)/setListening(false)
       restore the previous expression internally, so stop-flags run FIRST
       and this piece's expression is asserted AFTER them. Entering
       speaking/listening is the reverse: expression first, then the flag
       (Piece 1's setSpeaking/setListening re-apply the same expression,
       which is a harmless no-op when it already matches). */
    if (next !== 'speaking') setSpeakingOnAvatar(false);
    setExpressionOnAvatar(expr);
    if (next === 'speaking') setSpeakingOnAvatar(true);
    if (next === 'listening') setListeningOnAvatar(true);
    else setListeningOnAvatar(false);
  }
  function noteListeningStarted() {
    if (speaking) return; /* speech wins while TTS is active */
    listening = true;
    closeMouth();
    enterMode('listening', 'Listening');
  }
  function noteListeningStopped() {
    listening = false;
    if (!speaking) { closeMouth(); enterMode('idle', 'Idle'); }
  }
  function noteProcessing() {
    if (speaking) return;
    listening = false;
    closeMouth();
    enterMode('thinking', 'Thinking');
  }
  /* Called when real TTS audio is confirmed (onstart / first boundary /
     or the app's beginSpeak). Opens the SPEAKING expression but NOT the
     mouth — the mouth waits for a boundary tick or a gated proxy tick
     (false-start guard, see header). */
  function noteSpeechStarted() {
    if (textReplyGuardUntil && now() < textReplyGuardUntil) return;
    listening = false;
    speaking = true;
    paused = false;
    lastBoundaryAt = now();
    boundarySeenThisUtterance = false;
    mouthSource = 'none';
    setMouth(0);
    enterMode('speaking', 'Speaking');
    startDecayLoop();
    startProxyTicks();
    scheduleBlink();
  }
  function noteSpeechEnded(reason) {
    speaking = false;
    paused = false;
    boundarySeenThisUtterance = false;
    closeMouth();
    stopProxyTicks();
    stopDecayLoop();
    /* Back to listening if the live call is still on, else idle. The app
       is the source of truth for mic-liveness; read it defensively. */
    var live = false;
    try {
      if (hasWindow && window.state && typeof window.state.voiceLive !== 'undefined') live = !!window.state.voiceLive;
      else if (listening) live = true;
    } catch (e) {}
    if (live) { listening = true; enterMode('listening', 'Listening'); }
    else { listening = false; enterMode('idle', 'Idle'); }
    return reason || 'ended';
  }
  /* Text-reply case (A1/A3): never enter SPEAKING for this answer, and
     arm a guard so a stale beginSpeak timer (A5 line 4571) cannot
     re-enter it. Idempotent. */
  function noteTextReply() {
    textReplyGuardUntil = now() + 5000;
    if (speaking) {
      try { if (hasWindow && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    }
    noteSpeechEnded('text-reply');
    listening = false;
    closeMouth();
    enterMode('idle', 'Idle');
  }
  function notePaused(on) {
    paused = !!on;
    if (paused) setMouth(0);
    /* Unconditional: if the mouth was already 0, setMouth() early-returns
       without driving — but pause must still stop the instance loop. */
    applyMouth();
  }

  /* ------------------------------------------------------------------ */
  /* install() — wraps the two funnels; never rewrites the pipeline     */
  /* ------------------------------------------------------------------ */
  var SPEECH_SYNC_CSS = [
    '/* ENZO speech sync (Piece 4) — scoped, no app selectors touched. */',
    '[data-enzo-mouth]{transform-origin:50% 50%;transition:transform 70ms linear;will-change:transform}',
    '[data-enzo-head]{transform-origin:50% 85%;transition:transform 120ms ease-out}',
    '[data-enzo-eyes]{transition:transform 120ms ease-out;transform:translateX(var(--enzo-eye-x,0px))}',
    '[data-enzo-blink="true"] [data-enzo-eyes], [data-enzo-blink="true"].enzo-av .orb-eyes i{transform:scaleY(.08) !important}',
    '[data-enzo-speaking="true"] .enzo-av[data-state="speaking"] .orb-eyes i{animation:none}',
    '@media (prefers-reduced-motion: reduce){',
    '  [data-enzo-mouth]{transition:none}',
    '  [data-enzo-head]{transition:none}',
    '}'
  ].join('\n');

  function injectCSS() {
    if (!hasDocument) return;
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.type = 'text/css';
    if (style.styleSheet) style.styleSheet.cssText = SPEECH_SYNC_CSS;
    else style.appendChild(document.createTextNode(SPEECH_SYNC_CSS));
    (document.head || document.getElementsByTagName('head')[0] || document.documentElement).appendChild(style);
  }

  function wrapSetVoiceState() {
    if (!hasWindow || typeof window.setVoiceState !== 'function') return false;
    if (window.setVoiceState.__enzoSpeechSyncWrapped) return true;
    var orig = window.setVoiceState;
    function wrapped(vs) {
      var r = orig.apply(this, arguments);
      try {
        if (vs === 'speaking') noteSpeechStarted();
        else if (vs === 'listening') noteListeningStarted();
        else if (vs === 'processing') noteProcessing();
        else if (vs === 'on' || vs === 'off' || vs === 'blocked') {
          if (!speaking) { listening = false; closeMouth(); enterMode('idle', 'Idle'); }
        }
      } catch (e) {}
      return r;
    }
    wrapped.__enzoSpeechSyncWrapped = true;
    wrapped.__enzoOriginal = orig;
    window.setVoiceState = wrapped;
    return true;
  }

  /* Chain onto speechSynthesis.speak (A15): attach boundary/start/end
     handlers to every utterance WITHOUT disturbing handlers the app
     already set (speakText A5, playerSpeakChunk A8, voice test). The
     existing handlers run first; ours run after. */
  function wrapSpeechSynthesisSpeak() {
    if (!hasWindow || !window.speechSynthesis) return false;
    var synth = window.speechSynthesis;
    if (synth.speak && synth.speak.__enzoSpeechSyncWrapped) return true;
    var origSpeak = synth.speak.bind(synth);
    function wrappedSpeak(u) {
      try {
        if (u) {
          var prevBoundary = u.onboundary;
          var prevStart = u.onstart;
          var prevEnd = u.onend;
          var prevError = u.onerror;
          u.onboundary = function (ev) {
            try { if (prevBoundary) prevBoundary.call(u, ev); } catch (e) {}
            try { onBoundaryTick(ev); } catch (e) {}
          };
          u.onstart = function (ev) {
            try { if (prevStart) prevStart.call(u, ev); } catch (e) {}
            try { noteSpeechStarted(); } catch (e) {}
          };
          u.onend = function (ev) {
            try { if (prevEnd) prevEnd.call(u, ev); } catch (e) {}
            try { noteSpeechEnded('utterance-end'); } catch (e) {}
          };
          u.onerror = function (ev) {
            try { if (prevError) prevError.call(u, ev); } catch (e) {}
            try { noteSpeechEnded('utterance-error'); } catch (e) {}
          };
        }
      } catch (e) {}
      return origSpeak(u);
    }
    wrappedSpeak.__enzoSpeechSyncWrapped = true;
    wrappedSpeak.__enzoOriginal = origSpeak;
    try { synth.speak = wrappedSpeak; } catch (e) { return false; }
    return true;
  }

  /* If the app chain (A12 -> A13) is missing, drive the robot directly
     from the same source. Only a fallback — never a second live path. */
  function robotFallback() {
    if (!hasWindow) return;
    if (typeof window.setCentreEnzo === 'function') return; /* app chain intact */
    try {
      if (typeof window.setEnzoState === 'function') {
        window.setEnzoState(mode === 'speaking' ? 'speaking' : mode === 'listening' ? 'listening' : mode === 'thinking' ? 'thinking' : 'idle');
      }
    } catch (e) {}
  }

  function install() {
    if (installed) return true;
    installed = true;
    injectCSS();
    scheduleBlink();
    wrapSetVoiceState();
    wrapSpeechSynthesisSpeak();
    /* Re-wrap late: the app may define setVoiceState after this file
       loads (script order). One deferred retry, then stop. */
    if (hasWindow) {
      setTimeout(function () {
        wrapSetVoiceState();
        wrapSpeechSynthesisSpeak();
      }, 1000);
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Public API + test hooks                                             */
  /* ------------------------------------------------------------------ */
  var api = {
    install: install,
    state: function () {
      return {
        mode: mode,
        expression: expression,
        mouthOpen: Math.round(mouthOpen * 1000) / 1000,
        mouthSource: mouthSource,
        speaking: speaking,
        listening: listening,
        paused: paused,
        textReplyGuard: textReplyGuardUntil > now()
      };
    },
    /* Event inputs (also the explicit one-line hooks from §3). */
    noteSpeechStarted: noteSpeechStarted,
    noteSpeechEnded: noteSpeechEnded,
    noteListeningStarted: noteListeningStarted,
    noteListeningStopped: noteListeningStopped,
    noteProcessing: noteProcessing,
    noteTextReply: noteTextReply,
    notePaused: notePaused,
    onBoundaryTick: onBoundaryTick,
    /* Test/sim hooks (no-ops in production use). */
    _advance: _advance,
    _proxyKick: proxyKick,
    _injectInstances: function (arr) { injectedInstances = arr || null; lastInstanceLevel = -1; lastInstanceOn = false; },
    _reset: function () {
      mode = 'idle'; expression = 'Idle'; mouthOpen = 0; mouthSource = 'none';
      speaking = false; listening = false; paused = false;
      textReplyGuardUntil = 0; lastBoundaryAt = 0;
      boundarySeenThisUtterance = false; headPhase = 0;
      lastInstanceLevel = -1; lastInstanceOn = false;
      stopProxyTicks(); stopDecayLoop();
      if (hasDocument) {
        var roots = avatarRoots();
        for (var i = 0; i < roots.length; i++) {
          try { roots[i].removeAttribute('data-enzo-speaking'); roots[i].removeAttribute('data-enzo-blink'); } catch (e) {}
        }
      }
    },
    _robotFallback: robotFallback
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.EnzoSpeechSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
