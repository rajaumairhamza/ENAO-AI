
/* ============================================================================
 * ENZO face/avatar upgrade — PIECE 5: micro-animations + responsive + reduced-motion
 * Artifact: enao-ai (builds on v51). ONE file, dependency-free, deploys nothing.
 *
 * WHAT THIS PIECE IS
 *   CSS + tiny JS helpers ONLY. It does NOT draw the face — Piece 1
 *   (01-avatar-component.js) owns the inline SVG face (circular white+silver
 *   metallic frame, glossy black screen, glowing cyan-blue eyes, friendly
 *   smile) inside a container element. This piece adds, on top of that face:
 *     (a) elegant micro-animations — soft eye glow, LED pulse, slow screen
 *         sheen, eased eye/expression transitions, barely-perceptible idle
 *         bob, subtle outer ring light. NOT flashy: no heavy glow, no
 *         flashing, no strobing.
 *     (b) responsive avatar sizes per breakpoint (sidebar / chat / panel),
 *         aspect-ratio-locked SVG scaling.
 *     (c) reduced-motion support — OS media query AND the in-app flag.
 *
 * EXISTING CSS ANCHORS / BREAKPOINTS BUILT ON (v50 export:
 * ~/workspace/your_files/enao-ai/enao-ai.html — 10,340 lines)
 *   .logo                         L83    46px square, radius 12px (generic)
 *   .avatar                       L138   36px circle (generic message avatar)
 *   .avatar.ai                    L781   34px circle (AI message avatar)
 *   .pavatar                      L319   38px circle (sidebar profile)
 *   .avatarbtn                    L328   40px; L441 38px @max-width:560px;
 *                                  L1229 36px @max-width:400px
 *   #sidebar .logo                L638   48px (sidebar brand logo)
 *   .enzo-orb                     L1247  48px circle + orbBreath 3.6s (L1249)
 *                                  + hover scale 1.07 (L1248); face-plate
 *                                  restyle L1463-1467 (::before = black
 *                                  screen, ::after = cyan smile)
 *   .enzo-av                      L1391  34px circle (AI message avatar);
 *                                  face-plate restyle L1468-1471; blink
 *                                  enzoblink 4.6s/5.3s L1515-1517; state
 *                                  animations enzolook/enzotalk L1395-1396
 *   .enzo-panel                   L1010  248px wide; L1020 216px @1180px;
 *                                  L1021-1024 overlay @820px
 *   .enzo-panel-mount             L1013  308px; L1020 272px @1180px
 *   Breakpoints in the export: 400 / 560 / 640 / 820 / 1024 / 1100 / 1180.
 *   Phone-forced single column: L1202-1221 — body becomes a 1fr grid and the
 *   sidebar a fixed drawer @max-width:820px; L243-269 same pattern. This
 *   piece touches NO layout/grid/sidebar rules, so it cannot fight it.
 *   Reduced motion in the export:
 *     L269  global kill-all: @media (prefers-reduced-motion: reduce)
 *           { *{animation:none !important;transition:none !important} }
 *     L918, L1002, L1026, L1093, L1518 — per-component animation:none
 *     In-app flag (Piece 2 §4): L5865-5868 — localStorage 'enao_enzo_rm',
 *       window.__enzoRM (defaults to the OS media query), and
 *       window.setEnzoReducedMotion(on); toggle button #enzoRMBtn wired at
 *       L11973-11986 (syncRM()). NOTE: the in-app flag is honoured by the 3D
 *       room code but NOT by any CSS — that gap is exactly what this piece
 *       closes (see §3 + the JS helper below).
 *
 * DEPENDENCIES
 *   Piece 1 (01-avatar-component.js) — the reusable avatar component. This
 *   piece was written while Piece 1 did not exist yet, so it designs against
 *   this contract: container `.enzo-face` (configurable size via
 *   --enzo-face-size), inner `svg.enzo-face__svg` with a viewBox,
 *   `.enzo-face__screen` (the glossy black screen), `.enzo-face__eyes`,
 *   `.enzo-face__eye-glow` (glow layer), `.enzo-face__led` (frame LED),
 *   `.enzo-face__mouth`. If Piece 1 names things differently, only the
 *   selectors in §1 need renaming — the keyframes, sizes and reduced-motion
 *   blocks are unchanged. Legacy hooks: the eye-glow pulse is ALSO applied
 *   to the v50 classes `.enzo-av .orb-eyes` / `.enzo-orb .orb-eyes`, so the
 *   live app benefits even before Piece 1 lands. The black-screen ::before
 *   and smile ::after of .enzo-av/.enzo-orb are already taken (L1464-1470),
 *   so no sheen/ring is added to the legacy classes.
 *
 * PERFORMANCE BUDGET (held to throughout)
 *   - Animations use ONLY transform and opacity (compositor-friendly). No
 *     width/height/top/left/margin animation, no layout-triggering property.
 *   - box-shadow is NEVER animated (static shadows only) — glow is done by
 *     fading a layer's opacity, not by pulsing a shadow.
 *   - NO extra timers: no setInterval / setTimeout anywhere in this file.
 *     The blink scheduler stays solely in Piece 1. The JS below runs once
 *     at load + on real events (matchMedia change, setter call, button
 *     click via queueMicrotask) and only toggles one attribute on <html>.
 *   - NO will-change anywhere: a chat can hold dozens of avatars and
 *     will-change on all of them would cost memory for no gain; opacity /
 *     transform animations composite without it.
 *   - Long, slow durations (3.4s–9s) keep the paint rate low; the bob moves
 *     1px. If a very long chat ever janks, the integrator can scope the
 *     glow to the newest message or add .enzo-face--still to older avatars.
 *
 * HOW TO USE (integrator)
 *   1. Load this file AFTER the main app script (so window.__enzoRM /
 *      window.setEnzoReducedMotion already exist), or call
 *      window.enzoFaceMicroSync() once after the app boots.
 *   2. Give Piece 1's container the classes .enzo-face plus one of
 *      .enzo-face--sidebar / .enzo-face--chat / .enzo-face--panel.
 *   3. The SVG must carry a viewBox and preserveAspectRatio="xMidYMid meet"
 *      (the default) so it scales by viewBox with aspect-ratio locked.
 *   4. To kill the idle bob on a single avatar (e.g. a static logo):
 *      add .enzo-face--still to that container.
 * ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
 * §1 — THE CSS. Injected as one <style id="enzo-face-micro"> element.
 * ------------------------------------------------------------------------ */
var ENZO_MICRO_CSS = [
'/* ---- Piece 5 §1a (R2-translated to Piece 1 .enzoav classes): sizing.',
'   One variable per placement; the container is always square',
'   (aspect-ratio locked) and the SVG fills it by viewBox, so circles',
'   stay circular and eyes never stretch at any size. ---- */',
'.enzoav{',
'  --enzo-face-size:34px; /* default = chat avatar (matches .enzo-av) */',
'  width:var(--enzo-face-size);',
'  height:var(--enzo-face-size);',
'  flex:0 0 var(--enzo-face-size);',
'  aspect-ratio:1 / 1;',
'  border-radius:50%;',
'  position:relative;',
'  display:grid;',
'  place-items:center;',
'  /* Idle bob lives on the container; Piece 1 animates only .enzoav-inner,',
'     so the two never fight. */',
'  animation:enzoIdleBob 6s ease-in-out infinite;',
'}',
'#enzoSidebarAvatar{ --enzo-face-size:48px; } /* sidebar slot (Piece 2) */',
'.enzo-chat-av{ --enzo-face-size:34px; }      /* chat slot (Piece 3) */',
'#enzoPanelMount.enzoav, #enzoPanelMount .enzoav{ --enzo-face-size:40px; }',
'.enzoav svg,',
'.enzoav .enzoav-halo{',
'  width:100%;',
'  height:100%;',
'  display:block;',
'  shape-rendering:geometricPrecision;',
'}',
'',
'/* ---- Piece 5 §1b: micro-animations (transform / opacity only). ---- */',
'/* Soft cyan eye glow: the eye layer fades gently, never flashes. */',
'.enzoav-eye{ animation:enzoMicroGlow 4.2s ease-in-out infinite; }',
'/* Gentle LED pulse on the frame LED dot. */',
'.enzoav-led{ animation:enzoLedPulse 3.4s ease-in-out infinite; }',
'/* Subtle outer ring lighting: the SVG glow ring breathes (R3 choice:',
'   the .enzoav-ring circle, not a container ::after). */',
'.enzoav-ring{ animation:enzoRingLight 5s ease-in-out infinite; }',
'/* Slow-moving soft highlight sweeping the black screen (R2: SVG has no',
'   ::after, so the shine ellipse itself sweeps, transform-box:fill-box). */',
'.enzoav-sheen{ transform-box:fill-box; animation:enzoSheen 9s ease-in-out infinite; }',
'/* Smooth eye / expression transitions: every state change eases. */',
'.enzoav-eyes,',
'.enzoav-mouth{',
'  transition:transform .35s cubic-bezier(.34,1.3,.5,1), opacity .35s ease;',
'}',
'.enzoav-eye,',
'.enzoav-led{',
'  transition:opacity .35s ease;',
'}',
'/* Opt-out: a single static avatar. */',
'.enzoav--still{ animation:none; }',
'.enzoav--still .enzoav-eye,',
'.enzoav--still .enzoav-led,',
'.enzoav--still .enzoav-ring,',
'.enzoav--still .enzoav-sheen{ animation:none; }',
'',
'/* Legacy hooks (v50 classes, until Piece 1 replaces them everywhere):',
'   the eye-glow pulse only. */',
'.enzo-av .orb-eyes,',
'.enzo-orb .orb-eyes{ animation:enzoMicroGlow 4.2s ease-in-out infinite; }',
'',
'/* ---- Piece 5 §1c: keyframes. transform / opacity only. ---- */',
'@keyframes enzoMicroGlow{ 0%,100%{opacity:.72} 50%{opacity:1} }',
'@keyframes enzoLedPulse{ 0%,100%{opacity:.45} 50%{opacity:1} }',
'@keyframes enzoRingLight{ 0%,100%{opacity:.35} 50%{opacity:.7} }',
'@keyframes enzoIdleBob{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-1px)} }',
'@keyframes enzoSheen{',
'  0%,55%{ transform:translateX(-70px); }',
'  85%,100%{ transform:translateX(70px); }',
'}',
'',
'/* ---- Piece 5 §1d: responsive sizes (breakpoints 1180 / 820 / 560 /',
'   400). The size var AND the box are forced with !important at small',
'   widths so the breakpoints beat the inline var set by Piece 1',
'   setSize() (R4) and the fixed slot sizes from Pieces 2/3. ---- */',
'@media (max-width:1180px){',
'  #enzoSidebarAvatar{ --enzo-face-size:44px !important; width:44px !important; height:44px !important; flex:0 0 44px !important; }',
'  .enzo-chat-av{ --enzo-face-size:32px !important; width:32px !important; height:32px !important; flex:0 0 32px !important; }',
'  #enzoPanelMount.enzoav, #enzoPanelMount .enzoav{ --enzo-face-size:36px !important; }',
'  .enzo-orb{ width:44px; height:44px; flex-basis:44px; }',
'  .enzo-av, .avatar.ai{ width:32px; height:32px; flex-basis:32px; }',
'}',
'@media (max-width:820px){',
'  #enzoSidebarAvatar{ --enzo-face-size:44px !important; }',
'  .enzo-chat-av{ --enzo-face-size:32px !important; }',
'  #enzoPanelMount.enzoav, #enzoPanelMount .enzoav{ --enzo-face-size:36px !important; }',
'}',
'@media (max-width:560px){',
'  #enzoSidebarAvatar{ --enzo-face-size:40px !important; width:40px !important; height:40px !important; flex:0 0 40px !important; }',
'  .enzo-chat-av{ --enzo-face-size:30px !important; width:30px !important; height:30px !important; flex:0 0 30px !important; }',
'  #enzoPanelMount.enzoav, #enzoPanelMount .enzoav{ --enzo-face-size:32px !important; }',
'  .enzo-orb{ width:40px; height:40px; flex-basis:40px; }',
'  .enzo-av, .avatar.ai{ width:30px; height:30px; flex-basis:30px; }',
'}',
'@media (max-width:400px){',
'  #enzoSidebarAvatar{ --enzo-face-size:36px !important; width:36px !important; height:36px !important; flex:0 0 36px !important; }',
'  .enzo-chat-av{ --enzo-face-size:28px !important; width:28px !important; height:28px !important; flex:0 0 28px !important; }',
'  #enzoPanelMount.enzoav, #enzoPanelMount .enzoav{ --enzo-face-size:32px !important; }',
'  .enzo-orb{ width:36px; height:36px; flex-basis:36px; }',
'  .enzo-av, .avatar.ai{ width:28px; height:28px; flex-basis:28px; }',
'}',
'',
'/* ---- Piece 5 §1e: reduced motion. (A) OS preference, (B) the in-app',
'   flag mirrored onto <html> by the JS helper below. ---- */',
'@media (prefers-reduced-motion: reduce){',
'  .enzoav,',
'  .enzoav-eye, .enzoav-led,',
'  .enzoav-ring, .enzoav-sheen,',
'  .enzo-av .orb-eyes, .enzo-orb .orb-eyes,',
'  .enzo-av .orb-eyes i, .enzo-orb .orb-eyes i,',
'  .enzo-orb,',
'  .enzo-av[data-state="thinking"] .orb-eyes i,',
'  .enzo-av[data-state="speaking"] .orb-eyes i{ animation:none !important; }',
'  .enzoav-eyes, .enzoav-mouth,',
'  .enzoav-eye, .enzoav-led{ transition:none !important; }',
'  .enzoav-eye, .enzo-av .orb-eyes, .enzo-orb .orb-eyes{ opacity:1; }',
'  .enzoav-ring{ opacity:.45; }',
'}',
'html[data-enzo-rm="on"] .enzoav,',
'html.enzo-rm-on .enzoav,',
'html[data-enzo-rm="on"] .enzoav-eye,',
'html.enzo-rm-on .enzoav-eye,',
'html[data-enzo-rm="on"] .enzoav-led,',
'html.enzo-rm-on .enzoav-led,',
'html[data-enzo-rm="on"] .enzoav-ring,',
'html.enzo-rm-on .enzoav-ring,',
'html[data-enzo-rm="on"] .enzoav-sheen,',
'html.enzo-rm-on .enzoav-sheen,',
'html[data-enzo-rm="on"] .enzo-av .orb-eyes,',
'html.enzo-rm-on .enzo-av .orb-eyes,',
'html[data-enzo-rm="on"] .enzo-orb .orb-eyes,',
'html.enzo-rm-on .enzo-orb .orb-eyes,',
'html[data-enzo-rm="on"] .enzo-av .orb-eyes i,',
'html.enzo-rm-on .enzo-av .orb-eyes i,',
'html[data-enzo-rm="on"] .enzo-orb .orb-eyes i,',
'html.enzo-rm-on .enzo-orb .orb-eyes i,',
'html[data-enzo-rm="on"] .enzo-orb,',
'html.enzo-rm-on .enzo-orb,',
'html[data-enzo-rm="on"] .enzo-av[data-state="thinking"] .orb-eyes i,',
'html.enzo-rm-on .enzo-av[data-state="thinking"] .orb-eyes i,',
'html[data-enzo-rm="on"] .enzo-av[data-state="speaking"] .orb-eyes i,',
'html.enzo-rm-on .enzo-av[data-state="speaking"] .orb-eyes i{ animation:none !important; }',
'html[data-enzo-rm="on"] .enzoav-eyes,',
'html.enzo-rm-on .enzoav-eyes,',
'html[data-enzo-rm="on"] .enzoav-mouth,',
'html.enzo-rm-on .enzoav-mouth,',
'html[data-enzo-rm="on"] .enzoav-eye,',
'html.enzo-rm-on .enzoav-eye,',
'html[data-enzo-rm="on"] .enzoav-led,',
'html.enzo-rm-on .enzoav-led{ transition:none !important; }',
'html[data-enzo-rm="on"] .enzoav-eye,',
'html.enzo-rm-on .enzoav-eye,',
'html[data-enzo-rm="on"] .enzo-av .orb-eyes,',
'html.enzo-rm-on .enzo-av .orb-eyes,',
'html[data-enzo-rm="on"] .enzo-orb .orb-eyes,',
'html.enzo-rm-on .enzo-orb .orb-eyes{ opacity:1; }',
'html[data-enzo-rm="on"] .enzoav-ring,',
'html.enzo-rm-on .enzoav-ring{ opacity:.45; }'
].join('\n');

/* --------------------------------------------------------------------------
 * §2 — Tiny JS helper: inject the CSS once, and mirror the in-app Reduced
 * Motion flag (v50 L5865-5868: window.__enzoRM / window.setEnzoReducedMotion,
 * localStorage 'enao_enzo_rm', toggle #enzoRMBtn L11973-11986) onto <html>
 * as data-enzo-rm="on|off" (+ class .enzo-rm-on), so §1e(B) applies.
 * No timers: sync runs at load, on matchMedia change, when the app's own
 * setter is called (wrapped once), and on #enzoRMBtn clicks (microtask).
 * ------------------------------------------------------------------------ */
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var STYLE_ID = 'enzo-face-micro';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ENZO_MICRO_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* The in-app flag wins when it exists; otherwise fall back to the OS
     preference — the same default rule as v50 L5866-5867. */
  function reducedMotionOn() {
    if (typeof window.__enzoRM === 'boolean') return window.__enzoRM;
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function syncEnzoMicroMotion() {
    var on = reducedMotionOn();
    var root = document.documentElement;
    if (!root) return on;
    if (on) {
      root.setAttribute('data-enzo-rm', 'on');
      root.classList.add('enzo-rm-on');
    } else {
      root.setAttribute('data-enzo-rm', 'off');
      root.classList.remove('enzo-rm-on');
    }
    return on;
  }

  /* Wrap the app's setter once so every toggle re-syncs with no polling.
     Safe to call repeatedly and safe if the app script loads after this
     file: window.enzoFaceMicroSync() re-attempts the wrap. */
  function wrapSetter() {
    if (typeof window.setEnzoReducedMotion !== 'function') return;
    if (window.setEnzoReducedMotion.__enzoMicroWrapped) return;
    var original = window.setEnzoReducedMotion;
    var wrapped = function (on) {
      var result = original.apply(this, arguments);
      syncEnzoMicroMotion();
      return result;
    };
    wrapped.__enzoMicroWrapped = true;
    window.setEnzoReducedMotion = wrapped;
  }

  function init() {
    injectCSS();
    wrapSetter();
    syncEnzoMicroMotion();
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', syncEnzoMicroMotion);
        else if (mq.addListener) mq.addListener(syncEnzoMicroMotion);
      }
    } catch (e) { /* matchMedia unavailable — the flag + CSS still work */ }
    /* Belt-and-braces for the #enzoRMBtn click path (v50 L11984-11986):
       the wrapper above already covers it, but if the button ever sets
       window.__enzoRM directly, this re-syncs after the click handler. */
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('#enzoRMBtn') : null;
      if (!t) return;
      wrapSetter();
      if (typeof queueMicrotask === 'function') queueMicrotask(syncEnzoMicroMotion);
      else syncEnzoMicroMotion();
    });
  }

  /* Public hook for the integrator: re-run the wrap + sync after the app
     boots (needed only if this file loads before the main app script). */
  window.enzoFaceMicroSync = function () {
    injectCSS();
    wrapSetter();
    return syncEnzoMicroMotion();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
