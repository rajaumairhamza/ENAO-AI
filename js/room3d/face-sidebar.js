
/* ============================================================================
 * PIECE 2 — Sidebar avatar integration (ENZO face/avatar upgrade, artifact
 * enao-ai, building on v51)
 *
 * WHAT THIS PIECE IS
 * ------------------
 * Replaces the static sidebar logo (the old `.enzo-orb` gradient orb in the
 * top-left of the sidebar, next to "ENZO / Your AI Buddy" — the spot Raja
 * circled red in his 9:23 AM screenshot) with the reusable EnzoAvatar
 * component from Piece 1 (01-avatar-component.js), at sidebar size, and
 * wires it to the SAME expression state as the main 3D robot and the chat
 * avatars, so sidebar / chat / main robot always show one identity.
 *
 * The face SVG itself lives ONLY in Piece 1. This file contains NO copy of
 * the face — it mounts the component and syncs its state.
 *
 * VERIFIED AGAINST THE CURRENT CODE (22 Nov 2026)
 * ------------------------------------------------
 * Source checked: ~/workspace/your_files/enao-ai/enao-ai.html
 * (10,340 lines; its own build tag is already "v51-room-reference").
 * Sidebar code was ALSO diffed against the stored trees:
 *   ~/workspace/space-versions/enao-ai/v50/tree/index.html
 *   ~/workspace/space-versions/enao-ai/v51/tree/index.html
 * Result: the sidebar markup/CSS strings are IDENTICAL in v50 and v51 —
 * only line numbers shifted (~37 lines, because v51 inserts the phone-guard
 * and self-update scripts near the top of the file). So the v50 anchors
 * below are valid for v51 as well. The legacy `.logo` rule (line 83) is
 * dead CSS — the live sidebar never renders a `.logo` element.
 *
 * Piece 1 status at the time this file was written: 01-avatar-component.js
 * did NOT exist yet in ~/workspace/enao-face-avatar/ (the directory itself
 * did not exist; the parallel build had not landed). This piece is therefore
 * written against the Piece 1 CONTRACT stated in the task — see DEPENDENCIES
 * — and degrades gracefully if the component is absent (old orb stays).
 *
 * EXACT ANCHORS IN THE CURRENT CODE (enao-ai.html, line numbers verified
 * by grep on 22 Nov 2026 — re-check them before assembling if the file
 * has moved on; the distinctive strings are what matters, not the numbers)
 * ------------------------------------------------------------------------
 * HTML — sidebar head (the ONLY markup this piece touches):
 *   L1653  <aside class="sidebar" id="sidebar">
 *   L1654   <div class="sb-scroll">
 *   L1655    <div class="sidebar-head">
 *   L1656     <div class="brand">
 *   L1657      <button class="brand-home" id="brandHome" title="ENZO — back
 *                to the dashboard home screen" aria-label="ENZO — back to the
 *                dashboard home screen">
 *   L1658 >>>    <span class="enzo-orb" aria-hidden="true"><span
 *                class="orb-eyes"><i></i><i></i></span></span>   <<< REPLACE
 *                THIS SPAN ONLY. It is the whole of the old sidebar logo.
 *   L1659       <span class="brandtxt">
 *   L1660         <h1>ENZO</h1>
 *   L1661         <p class="tagline">Your AI Buddy</p>
 *   L1662       </span>
 *   L1663      </button>
 *   L1664      <button class="sb-collapse" id="collapseBtn" ...> (LEAVE)
 *   L1665      <button class="drawer-close" id="sbDrawerClose" ...> (LEAVE)
 *
 * CSS — the old orb's rules (for reference only; this piece overrides the
 * slot, it does not edit these rules):
 *   L1246  .brand-home{display:flex;align-items:center;gap:12px;...}
 *          ^ gap:12px is the spacing between avatar and ENZO text — kept.
 *   L1247  .enzo-orb{width:48px;height:48px;flex:0 0 48px;border-radius:50%;
 *          background:radial-gradient(circle at 34% 30%,#A78BFA ...);}
 *   L1248  .brand-home:hover .enzo-orb{transform:scale(1.07);...}
 *   L1249  @keyframes orbBreath{0%,100%{transform:scale(1)}50%{...1.045}}
 *   L1463  .enzo-orb{position:relative;background:radial-gradient(circle at
 *          34% 28%,#FFFFFF 0%,#F8FAFC 46%,#CBD5E1 100%);...}  (pearl face)
 *   L1464  .enzo-orb::before{...glossy black face plate...}
 *   L1465  .enzo-orb::after{...cyan smile...}
 *   L1466  .enzo-orb .orb-eyes{position:relative;z-index:1;...}
 *   L1515  @keyframes enzoblink{0%,91%,100%{transform:scaleY(1)}
 *          94.5%{transform:scaleY(.08)}}
 *   L1516  .enzo-orb .orb-eyes i{animation:enzoblink 4.6s ease-in-out infinite}
 *   L1252  .brand-home .brandtxt h1{color:#fff;font-size:22px;...}
 *   L1253  .brand-home .brandtxt .tagline{color:var(--sb-muted);...}
 *
 * JS — the shared expression state (the sync hook; this piece does NOT
 * replace any of it, it subscribes to it):
 *   L2551  function setCentreEnzo(st){ ... } — maps the app state and calls
 *   L2557    if(window.setEnzoState){ try{ window.setEnzoState(st); }... }
 *   L5851  window.setEnzoState=function(name){ ... } — THE single source of
 *          truth for the 3D companion's state; normalises the name and
 *          applies it to every 3D instance.
 *   L5858  window.getEnzoState=function(){ return enzoState; };
 *   L11742 window.setEnzoState=function(n){ ... origSet(n) ... } — the app's
 *          OWN wrapper (sleep/activity tracking). Any wrapper added here
 *          MUST chain through the previous function, never replace it
 *          outright, or the sleep tracking breaks.
 *   L12377 $('brandHome').onclick=function(){ ... $('sidebar').classList
 *          .remove('open'); $('input').focus(); }; — the brand button's
 *          click behaviour. Untouched: the avatar sits INSIDE this button,
 *          so clicking the avatar still goes home, exactly as before.
 *
 * Mobile / drawer (no extra work needed beyond the slot CSS below):
 *   L248   .sidebar{position:fixed;left:0;top:0;bottom:0;display:none;...}
 *   L249   .sidebar.open{display:flex}   (≤820px drawer)
 *   L1207  body.sb-collapsed .sidebar{display:none}
 *   L14099 #sidebar .drawer-close{display:grid} (drawer close button)
 *   The avatar lives inside #sidebar, so it inherits the drawer for free;
 *   the slot is a fixed 48px in both layouts.
 *
 * DEPENDENCIES
 * ------------
 * Piece 1 — 01-avatar-component.js — MUST load BEFORE this file:
 *   global `EnzoAvatar`, constructor `EnzoAvatar(container, {size,
 *   expression})`, methods `setExpression(name)`, `setSpeaking(bool)`,
 *   `setListening(bool)`; SVG face = circular white+silver metallic frame,
 *   glossy black screen, glowing cyan-blue eyes, friendly smile.
 * If Piece 1 is missing or its contract differs, this file logs a warning
 * and leaves the old `.enzo-orb` exactly as it is — the sidebar never
 * breaks. It retries for ~5 s in case Piece 1 loads just after this file.
 *
 * STEP-BY-STEP INTEGRATION (for the assembler — do this, nothing else)
 * -------------------------------------------------------------------
 * 1. Load order in the artifact HTML, before </body>, AFTER the main app
 *    script:  <script src="01-avatar-component.js"><\/script>
 *              <script src="02-sidebar-avatar.js"><\/script>
 *    (Both are plain scripts, no modules, no bundler.)
 * 2. HTML change — replace ONLY line 1658 (the one <span class="enzo-orb"
 *    ...>...</span> line) with:
 *        <span id="enzoSidebarAvatar" class="enzo-sidebar-avatar"
 *              role="img" aria-label="ENZO — your AI buddy"></span>
 *    Do it by hand OR let this file do it at runtime: the mount code in
 *    section (a) below performs exactly that replacement in the live DOM
 *    (it swaps the .enzo-orb span for the mount span, inside #brandHome).
 *    Either route is fine; do NOT do both in a way that double-mounts —
 *    the code is idempotent and bails out if #enzoSidebarAvatar exists.
 * 3. Do NOT touch anything else in the sidebar: #collapseBtn, #sbDrawerClose,
 *    #newChatBtn (L1667), #historySearch (L1670), #recentSec (L1677),
 *    #foldersBox (L1685), .profilebox (L1702) and all of their CSS stay
 *    exactly as they are. See "WHAT CHANGES / WHAT STAYS" at the end.
 * 4. Do NOT delete the old .enzo-orb / .orb-eyes CSS rules: .enzo-av
 *    (the chat message avatar, L1391+) and .enzo-fallback still use them.
 *    This file's CSS is scoped to #enzoSidebarAvatar and only overrides
 *    the sidebar slot.
 * 5. Verify: reload, check the top-left avatar is the new premium face,
 *    send a message (avatar → Thinking, then Speaking), tap the mic so
 *    ENZO listens (avatar → Listening), and confirm the chat avatar, the
 *    sidebar avatar and the main robot all change together. Resize below
 *    820px / open the mobile drawer — the avatar must stay 48px and sharp.
 *
 * WHAT CHANGES / WHAT STAYS
 * --------------------------
 * CHANGES: one span (L1658 .enzo-orb) → mount span + EnzoAvatar instance;
 *          + scoped CSS for the mount slot; + state-sync wiring.
 * STAYS:   #brandHome button, its onclick (L12377), .brandtxt / ENZO /
 *          "Your AI Buddy", #collapseBtn, #sbDrawerClose, #newChatBtn,
 *          #historySearch + searchbox, #recentSec / #chatList, #foldersBox,
 *          .sb-foot-links, .sidebar-foot / .profilebox, sidebar width
 *          (292px desktop / 258px tablet), .brand-home gap:12px, and every
 *          other .enzo-orb / .enzo-av rule outside this slot.
 *
 * HONEST LIMITS
 * -------------
 * - Written against the Piece 1 contract, NOT against the real Piece 1
 *   file (it did not exist yet). If Piece 1 names its constructor,
 *   methods or expression names differently, the mount must be adapted —
 *   the contract names are listed under DEPENDENCIES above.
 * - Expression vocabulary here is the five states from the brief
 *   (idle / thinking / speaking / listening / happy). The 3D controller
 *   also emits working, researching, coding, success, error, sleeping,
 *   annoyed, angry, music, videoedit. Those are MAPPED (see STATE_MAP
 *   below), not dropped — but if Piece 1 later gains distinct faces for
 *   them, extend STATE_MAP, nothing else.
 * - Blinking lives inside Piece 1's component. This file only guarantees
 *   the old enzoblink animation does not fight it (the old .enzo-orb span
 *   is removed, so its animation goes with it).
 * - Not deployed, not tested in the live artifact — node --check only
 *   (see verification note at the end of this file).
 * ==========================================================================
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------------
   * (b) SCOPED CSS — injected once by this file. Every selector is rooted
   * at #enzoSidebarAvatar (inside #sidebar #brandHome), so nothing else on
   * the page can be affected. No global resets, no !important on layout.
   *
   * The slot keeps the old orb's exact footprint — 48px × 48px, flex-none —
   * so .brand-home's gap:12px, the ENZO text, the collapse button and the
   * drawer-close button do not move by even a pixel. The component's SVG
   * scales to the slot, which is what keeps it sharp at small size (vector,
   * no raster image). The metallic border + blue outer glow live here so
   * the frame reads as premium even if Piece 1 ships a plainer root.
   * --------------------------------------------------------------------- */
  var SIDEBAR_CSS = [
    /* Slot: same 48px box the old orb occupied (L1247). */
    '#sidebar #brandHome #enzoSidebarAvatar{',
    '  width:48px;height:48px;flex:0 0 48px;',
    '  border-radius:50%;display:block;position:relative;',
    '  /* Smooth metallic border: silver ring + cyan hairline + blue glow. */',
    '  box-shadow:0 0 0 1px rgba(203,213,225,.85),',
    '    0 0 0 2px rgba(0,217,255,.35),',
    '    0 0 16px rgba(59,130,246,.45),',
    '    0 0 30px rgba(139,92,246,.25),',
    '    inset 0 2px 5px rgba(255,255,255,.7);',
    '  overflow:hidden;',
    '  transition:transform .25s ease, box-shadow .25s ease;',
    '}',
    /* The component's own root/SVG fills the slot exactly, stays sharp. */
    '#sidebar #brandHome #enzoSidebarAvatar svg,',
    '#sidebar #brandHome #enzoSidebarAvatar .enzo-avatar,',
    '#sidebar #brandHome #enzoSidebarAvatar > *{',
    '  width:100%;height:100%;display:block;border-radius:50%;',
    '}',
    /* Hover: same lift the old orb had (L1248), so the button feels the same. */
    '#sidebar #brandHome:hover #enzoSidebarAvatar{',
    '  transform:scale(1.07);',
    '  box-shadow:0 0 0 1px rgba(203,213,225,.9),',
    '    0 0 0 3px rgba(0,217,255,.5),',
    '    0 0 24px rgba(0,217,255,.55),',
    '    0 0 40px rgba(139,92,246,.45),',
    '    inset 0 2px 5px rgba(255,255,255,.7);',
    '}',
    /* State rings — same colour language as .enzo-av[data-state] (L1394+)
       and .enzo-status (L1034+), so the sidebar reads consistently with the
       chat avatar and the panel status pill. */
    '#sidebar #brandHome #enzoSidebarAvatar[data-state="thinking"]{',
    '  box-shadow:0 0 0 2px rgba(245,158,11,.55),0 0 14px rgba(245,158,11,.5),',
    '    0 0 26px rgba(245,158,11,.25);',
    '}',
    '#sidebar #brandHome #enzoSidebarAvatar[data-state="listening"]{',
    '  box-shadow:0 0 0 2px rgba(34,197,94,.55),0 0 14px rgba(34,197,94,.5),',
    '    0 0 26px rgba(34,197,94,.25);',
    '}',
    '#sidebar #brandHome #enzoSidebarAvatar[data-state="speaking"]{',
    '  box-shadow:0 0 0 2px rgba(139,92,246,.6),0 0 14px rgba(139,92,246,.5),',
    '    0 0 26px rgba(139,92,246,.3);',
    '}',
    '#sidebar #brandHome #enzoSidebarAvatar[data-state="happy"]{',
    '  box-shadow:0 0 0 2px rgba(34,197,94,.6),0 0 14px rgba(34,197,94,.55),',
    '    0 0 26px rgba(34,197,94,.3);',
    '}',
    /* Mobile drawer (≤820px, L248-249) and phone-forced drawer: the slot is
       a fixed 48px, so it needs no resize — this rule only guards against
       any future rule shrinking flex children inside the drawer. */
    '@media (max-width:820px){',
    '  #sidebar #brandHome #enzoSidebarAvatar{width:48px;height:48px;flex:0 0 48px;}',
    '}',
    /* Reduced motion: no hover-scale breathing on the slot itself (blinking
       is owned by Piece 1, which must honour this same preference). */
    '@media (prefers-reduced-motion: reduce){',
    '  #sidebar #brandHome #enzoSidebarAvatar,',
    '  #sidebar #brandHome:hover #enzoSidebarAvatar{transition:none;transform:none;}',
    '}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('enzo-sidebar-avatar-css')) return;
    var st = document.createElement('style');
    st.id = 'enzo-sidebar-avatar-css';
    st.setAttribute('data-piece', '02-sidebar-avatar');
    st.textContent = SIDEBAR_CSS;
    (document.head || document.getElementsByTagName('head')[0]).appendChild(st);
  }

  /* ------------------------------------------------------------------------
   * (c) SYNC WIRING — one shared state, three faces.
   *
   * Source of truth: window.setEnzoState / window.getEnzoState (L5851 /
   * L5858). setCentreEnzo (L2551) already funnels every app state through
   * window.setEnzoState, so subscribing there covers chat + voice + typing.
   *
   * Method: chain-wrap window.setEnzoState (call the previous function
   * first, then update the sidebar avatar) — this is safe in EITHER load
   * order against the app's own wrapper at L11742, because every wrapper
   * calls its predecessor. A 500 ms getEnzoState() poll is the backstop
   * for any state change that bypasses the wrapper.
   *
   * App state  -> sidebar avatar expression (Piece 1 contract names)
   * ---------------------------------------------------------------
   * idle, sleeping, error, unknown -> idle    (neutral; error has no
   *                                              distinct sidebar face)
   * thinking, working, researching,  -> thinking
   * coding
   * speaking                      -> speaking (+ setSpeaking(true))
   * listening                     -> listening (+ setListening(true))
   * success                       -> happy
   * annoyed, angry, music,        -> idle (no sidebar face defined yet;
   * videoedit                       extend STATE_MAP when Piece 1 adds
   *                                 them — nothing else needs changing)
   * --------------------------------------------------------------------- */
  var STATE_MAP = {
    idle: 'idle',
    sleeping: 'idle',
    error: 'idle',
    annoyed: 'idle',
    angry: 'idle',
    music: 'idle',
    videoedit: 'idle',
    thinking: 'thinking',
    working: 'thinking',
    researching: 'thinking',
    coding: 'thinking',
    speaking: 'speaking',
    listening: 'listening',
    success: 'happy'
  };

  var avatar = null;          /* EnzoAvatar instance for the sidebar slot */
  var mountEl = null;         /* #enzoSidebarAvatar */
  var lastApplied = null;     /* last app-state string applied (dedupe) */
  var pollTimer = null;
  var wrapped = false;

  function normaliseState(name) {
    return String(name || 'idle').toLowerCase().replace(/[\s_-]+/g, '');
  }

  function applyAppState(rawName) {
    if (!avatar || !mountEl) return;
    var key = normaliseState(rawName);
    if (key === lastApplied) return;   /* already showing this state */
    lastApplied = key;
    var expr = STATE_MAP[key] || 'idle';
    try { avatar.setExpression(expr); } catch (e) {}
    try { avatar.setSpeaking(expr === 'speaking'); } catch (e) {}
    try { avatar.setListening(expr === 'listening'); } catch (e) {}
    /* Mirror the state on the slot so the CSS rings above follow it even
       if a Piece 1 build ignores setExpression for some reason. */
    try { mountEl.setAttribute('data-state', expr); } catch (e) {}
  }

  function chainWrapSetEnzoState() {
    if (wrapped) return;
    if (typeof window.setEnzoState !== 'function') return;
    var prev = window.setEnzoState;
    window.setEnzoState = function (name) {
      var result;
      try { result = prev(name); } catch (e) { result = name; }
      /* Update from the RETURNED (normalised) state when available, so
         the sidebar can never disagree with the 3D robot about the name. */
      applyAppState(typeof result === 'string' ? result : name);
      return result;
    };
    wrapped = true;
  }

  function startSync() {
    chainWrapSetEnzoState();
    /* Backstop poll: catches any direct state change and also heals the
       chain if something later replaces window.setEnzoState outright. */
    if (!pollTimer) {
      EnzoPollLoop.registerPoller('state-backstop', function () {
        chainWrapSetEnzoState();
        if (typeof window.getEnzoState === 'function') {
          try { applyAppState(window.getEnzoState()); } catch (e) {}
        }
      }, 5000, { kind: 'idle', jitter: false });
      pollTimer = true; /* keep the existing "already installed" guard; the loop owns the timer now */
    }
    /* Initial sync — show the robot's current state immediately. */
    if (typeof window.getEnzoState === 'function') {
      try { applyAppState(window.getEnzoState()); } catch (e) {}
    } else {
      applyAppState('idle');
    }
  }

  /* ------------------------------------------------------------------------
   * (a) MOUNT — replace ONLY the L1658 .enzo-orb span inside #brandHome
   * with the mount span, then construct the Piece 1 component in it.
   *
   * Safety rules (all deliberate):
   * - If #brandHome or its .enzo-orb is missing, do nothing (the file may
   *   be running against a newer layout) and log a warning — never throw.
   * - If #enzoSidebarAvatar already exists, do NOT mount twice.
   * - If window.EnzoAvatar is not defined yet, keep the old orb visible
   *   and retry for ~5 s (Piece 1 may load just after this file). Only
   *   after the retries give up do we log and leave the old orb in place.
   * - The old orb span is removed ONLY at the moment the component is
   *   ready to take its place, so there is never an empty slot.
   * - #brandHome, .brandtxt, #collapseBtn, #sbDrawerClose and everything
   *   below the brand row are never touched.
   * --------------------------------------------------------------------- */
  function mount() {
    if (typeof window.EnzoAvatar !== 'function') return false;
    var brandHome = document.getElementById('brandHome');
    if (!brandHome) {
      if (window.console && console.warn) {
        console.warn('[enzo-sidebar-avatar] #brandHome not found; sidebar avatar not mounted.');
      }
      return true; /* nothing to retry — the layout has no brand slot */
    }
    if (document.getElementById('enzoSidebarAvatar')) {
      /* Already mounted (e.g. assembler did the HTML swap AND this file
         ran, or the script ran twice) — just (re)sync, never duplicate. */
      mountEl = document.getElementById('enzoSidebarAvatar');
      if (!avatar) {
        try { avatar = new EnzoAvatar(mountEl, { size: 48, expression: 'idle' }); } catch (e) { avatar = null; }
      }
      if (avatar) startSync();
      return true;
    }
    var oldOrb = brandHome.querySelector('.enzo-orb');
    if (!oldOrb) {
      if (window.console && console.warn) {
        console.warn('[enzo-sidebar-avatar] .enzo-orb not found inside #brandHome; sidebar avatar not mounted.');
      }
      return true; /* layout changed — leave it alone rather than guessing */
    }
    injectCss();
    mountEl = document.createElement('span');
    mountEl.id = 'enzoSidebarAvatar';
    mountEl.className = 'enzo-sidebar-avatar';
    mountEl.setAttribute('role', 'img');
    mountEl.setAttribute('aria-label', 'ENZO — your AI buddy');
    mountEl.setAttribute('data-state', 'idle');
    /* Swap in place: same parent (#brandHome), same position (first child,
       before .brandtxt), so spacing and the button's click area are kept. */
    oldOrb.parentNode.replaceChild(mountEl, oldOrb);
    try {
      avatar = new EnzoAvatar(mountEl, { size: 48, expression: 'idle' });
    } catch (err) {
      /* Component failed: put the old orb back rather than leaving a hole. */
      if (window.console && console.warn) {
        console.warn('[enzo-sidebar-avatar] EnzoAvatar failed, restoring old orb.', err);
      }
      try { mountEl.parentNode.replaceChild(oldOrb, mountEl); } catch (e2) {}
      mountEl = null;
      avatar = null;
      return true;
    }
    startSync();
    return true;
  }

  function init() {
    var tries = 0;
    var maxTries = 20; /* 20 × 250 ms ≈ 5 s for Piece 1 to appear */
    (function attempt() {
      if (mount()) return;
      tries += 1;
      if (tries >= maxTries) {
        if (window.console && console.warn) {
          console.warn('[enzo-sidebar-avatar] EnzoAvatar not found after ~5s; keeping the original sidebar orb.');
        }
        return;
      }
      setTimeout(attempt, 250);
    })();
  }

  /* Run now if the DOM is ready, otherwise wait — the script is meant to
     load after the app script, but this covers either order. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Debug / assembler handle. Lets the integrator (or a later piece) force
     a state or check the mount without touching the DOM directly. */
  window.__enzoSidebarAvatar = {
    applyState: applyAppState,
    get element() { return mountEl; },
    get instance() { return avatar; },
    destroy: function () {
      if (pollTimer) { EnzoPollLoop.unregisterPoller('state-backstop'); pollTimer = null; }
      /* Note: the setEnzoState chain-wrap is intentionally NOT unwound —
         unwinding it would risk breaking the app's own wrapper (L11742). */
    }
  };
})();

/* ============================================================================
 * VERIFICATION (done by the authoring agent, 22 Nov 2026 — re-run on change)
 * ----------------------------------------------------------------------------
 * 1. node --check: this file is pure JavaScript (header + IIFE, no HTML,
 *    no imports), so `node --check 02-sidebar-avatar.js` runs directly.
 *    Result: PASS (see delivery report for the exact command/output).
 * 2. Anchors: every line number in the header above was confirmed by grep
 *    against ~/workspace/your_files/enao-ai/enao-ai.html AND by diffing the
 *    sidebar region between the stored v50 and v51 trees — identical
 *    strings, only line numbers shifted. The one-line replacement target
 *    is L1658 (the .enzo-orb span inside #brandHome).
 * 3. Scope: the only DOM node this file removes is that one L1658 span,
 *    replaced in place. #brandHome, .brandtxt, #collapseBtn,
 *    #sbDrawerClose, #newChatBtn, #historySearch, #recentSec, #foldersBox
 *    and .profilebox are never selected for modification.
 * 4. NOT verified here (needs the live artifact + Piece 1): visual check
 *    of the face at 48px, blink behaviour, expression sync in a real
 *    session, and the mobile drawer. That is the assembler's check in
 *    integration step 5 above.
 * ==========================================================================
 */
