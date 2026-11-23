
/* ============================================================================
   PIECE 3 — Chat message avatar integration + per-message expressions
   Artifact: enao-ai (builds on v51) | File: 03-chat-avatar.js
   ----------------------------------------------------------------------------
   WHAT THIS PIECE IS
   Replaces the ENZO avatar shown next to AI chat messages (the avatar Raja
   circled red in his 9:23 AM screenshot) with the reusable EnzoAvatar
   component from Piece 1, and drives one expression per message so the face
   follows the conversation: greeting / answering / thinking / explaining /
   listening / surprised. The avatar keeps blinking while a message is being
   written or spoken, and each message's avatar blinks on its own schedule.

   DEPENDENCY — Piece 1 (01-avatar-component.js, same directory)
   Global `EnzoAvatar`, constructor `EnzoAvatar(container, {size, expression})`
   with methods `setExpression(name)`, `setSpeaking(bool)`, `setListening(bool)`.
   Face design (owned by Piece 1, NOT duplicated here): circular white+silver
   metallic frame, glossy black screen, glowing cyan-blue eyes, friendly
   smile. If Piece 1 has not loaded yet, this piece degrades gracefully: the
   34px slot stays in place (layout never shifts) with a plain "E" fallback
   and a console warning — rendering a message must never throw.
   NOTE (verified 22 Nov 2026 ~04:29 PKT): 01-avatar-component.js does NOT
   exist yet in ~/workspace/enao-face-avatar/ — the directory was empty when
   this piece was written. This file is designed against the contract above;
   the coordinator must load Piece 1 BEFORE this file.

   SOURCE FILE VERIFIED AGAINST
   ~/workspace/your_files/enao-ai/enao-ai.html  (10,340 lines, v50 export)
   DISCREPANCY NOTE: the file on disk ALREADY contains the
   "v51 CHAT FIXES — RTL bubbles + SMS-size text" block at lines 1558-1581,
   so the v51 RTL fix is present in this export; the chat rendering code is
   otherwise unchanged from v50. Nothing below touches that block.

   EXACT ANCHORS IN THE CURRENT CODE (all verified by grep in this session)
   ------------------------------------------------------------------------
   A1  L137   `.msg{display:flex;gap:12px;margin:18px 0;align-items:flex-start}`
              Row layout. The avatar is a flex child sitting left of the card,
              top-aligned. The replacement MUST keep `flex:0 0 34px` or the
              card will squeeze/overlap it.
   A2  L783   `.acard{flex:1;min-width:0;background:var(--surface);...padding:14px 18px 12px}`
              The AI answer card the avatar sits beside.
   A3  L1391-1393  `.enzo-av{width:34px;height:34px;flex:0 0 34px;border-radius:50%;...}`
              + `.enzo-av .orb-eyes i{...background:#00D9FF...}` — OLD avatar
              styling (purple/blue orb, two glowing bars). Replaced, not edited.
   A4  L1468-1471  FINAL FIXES face-identity override of `.enzo-av`
              (pearl-white shell, black face plate, cyan smile ::after).
              This is the face identity Piece 1 reproduces; keep this CSS in
              place until the coordinator removes the old orb everywhere.
   A5  L1503  `.msg .acard{flex:0 1 auto;max-width:66%;min-width:0}`
              Width cap lives on the card, NOT on the avatar — the avatar
              never participates in bubble width math, so it cannot overlap
              the bubble or the timestamp.
   A6  L1515-1517 `@keyframes enzoblink{0%,91%,100%{transform:scaleY(1)}94.5%{transform:scaleY(.08)}}`
              + `.enzo-av .orb-eyes i{animation:enzoblink 5.3s ease-in-out infinite}`
              TODAY'S DEFECT: one shared CSS animation drives EVERY `.enzo-av`
              on screen, so all message avatars blink in perfect lockstep.
              This piece fixes it with a per-instance blink seed (see below).
   A7  L1558-1581  `v51 CHAT FIXES — RTL bubbles + SMS-size text` block.
              DO NOT TOUCH. RTL rules verified present (see "RTL CHECK" below).
   A8  L1803  Typing row markup:
              `<div id="typingRow" class="msg" style="display:none" ...><div class="enzo-av" id="typingAv" data-state="thinking" role="img" aria-label="ENZO"><span class="orb-eyes"><i></i><i></i></span></div><div class="bubble">...`
              Secondary avatar anchor (the "Thinking..." row).
   A9  L2507  `function renderMessages(forceScroll){` — re-renders EVERY message
              via `buildMessageEl(m)` (call at L2513). Consequence: the DOM is
              rebuilt on every state change, so expression state MUST live on
              the message object (`m._avatarKind` / `m._avatarExpr`), never
              only on the DOM node, or a re-render would freeze/reset it.
   A10 L2551-2558 `function setCentreEnzo(st){` — THE state funnel. Maps the
              app state, sets `data-state` on the LAST `[data-enzoav]`
              (L2554), sets `#typingAv` (L2556), calls the 3D companion hook
              `window.setEnzoState(st)` (L2557, defined L5851). This piece
              wraps it (Step 4) so every state change also updates the latest
              message avatar. Callers that drive it: L4282 thinking/researching,
              L4407 speaking (streamMessage), L4245/L4462 success, L4202/L4360
              idle, L4137/L4388 error, L4496-4498 setVoiceState funnel
              (listening/speaking/thinking).
   A11 L2609  `function buildMessageEl(m){` — LIVE message renderer.
   A12 L2653  `wrap.className='msg airow';` (AI branch).
   A13 L2657  `var isStreamingThis = !!(state.isGenerating && cNow && cNow.messages.length && cNow.messages[cNow.messages.length-1]===m && !m.html);`
              Tells us this message is currently being written.
   A14 L2673  *** PRIMARY ANCHOR — the avatar markup to replace: ***
              `var html='<div class="enzo-av" data-enzoav data-state="'+(m.error?'error':'idle')+'" role="img" aria-label="ENZO avatar"><span class="orb-eyes"><i></i><i></i></span></div><div class="acard">';`
   A15 L2674  `html+='<div class="aimeta"><span class="aimeta-name">ENZO</span><span>'+esc(atl.date)+' &middot; '+esc(atl.time)+' &middot; '+esc(atl.daypartRoman)+'</span>'+modeChipHtml(m)+...`
              ENZO name + timestamp header inside the card (untouched — the
              avatar sits OUTSIDE the card, left of it, so it can never cover
              the name/timestamp).
   A16 L2719  `wrap.innerHTML=html;` — *** MOUNT HOOK POINT *** (insert the
              mount call immediately after this line, AI branch only).
   A17 L2786  `return wrap;` (end of buildMessageEl).
   A18 L2788  `function buildMessageElLegacy(m){` — DEAD CODE: zero callers
              (only `buildMessageEl(` is called, at L2513). Its avatar anchor
              at L2804 (`<div class="avatar ai"><svg class="ic"><use href="#i-brain"/></svg></div>`)
              is left alone unless the legacy renderer is ever revived; see
              Step 5 (optional).
   A19 L4963  `function showTyping(){` / L4969 `function hideTyping(){` —
              typing-row visibility; the typing avatar's expression is set by
              the setCentreEnzo wrapper (Step 4), no change needed here.
   A20 L4658  `playerStart`: `state.isSpeaking=true; pauseRecognitionForSpeech(); setVoiceState('speaking');`
              Listen Aloud funnels through setVoiceState -> setCentreEnzo, so
              the speaking face follows automatically. Optional per-message
              precision hook in Step 6.

   EXPRESSION-MAPPING TABLE (message kind -> Piece 1 controller state)
   ------------------------------------------------------------------------
   | # | Message kind | When it applies                                  | setExpression | + flag          |
   | 1 | greeting     | answer opens with a greeting (salam/hello/...)  | Happy         | —               |
   | 2 | answering    | streaming a reply, or a plain completed answer  | Friendly      | setSpeaking(true) while streaming/speaking |
   | 3 | thinking     | generating but no answer text yet (typing row)  | Thinking      | —               |
   | 4 | explaining   | deep/mega answer, or long structured answer     | Focused       | —               |
   | 5 | listening    | mic live, ENZO waiting for the user             | Listening     | setListening(true) |
   | 6 | surprised    | error, or an exclamation/wow-style answer       | Surprised     | —               |
   Controller states used: Happy, Friendly, Thinking, Focused, Listening,
   Surprised. (Task brief names the resting friendly state "Neutral/Friendly";
   Piece 1's contract exposes it as Friendly — if Piece 1 names it Neutral,
   change only EXPRESSION_MAP.answering below, nothing else.)
   Detection order in classifyMessageKind(): explicit override (m._avatarKind)
   -> error -> thinking (streaming, no content yet) -> listening -> greeting
   -> surprised -> explaining -> answering (default). Detection is heuristic
   (regex/length/structure on the message); the override field is the exact
   control for any future classifier.

   BLINK SCHEDULER — CHOICE: ONE SHARED SCHEDULER, PER-INSTANCE PHASE
   ------------------------------------------------------------------------
   A single 200 ms interval (ChatAvatar._blinkTick) drives all mounted chat
   avatars. Each message gets its own random phase, persisted as
   `m._avatarSeed` on the message object, so a re-render (A9) rebuilds the
   DOM but the rhythm survives — each avatar keeps blinking on its own
   schedule instead of in lockstep (defect A6). One timer for N messages is
   cheaper than N timers and cannot leak timers across re-renders. The tick
   calls `instance.blink()` ONLY if Piece 1 exposes it; otherwise it does
   nothing and Piece 1's own internal blink runs. Blinking continues while
   a message streams or speaks (blink is independent of setSpeaking).
   Respects `prefers-reduced-motion`: scheduler never starts then.

   RTL CHECK (v51 fix untouched — selectors verified present, NOT edited)
   ------------------------------------------------------------------------
   L1569 `.msg.userrow .bubble p{...overflow-wrap:break-word}`
   L1570 `.msg.userrow .bubble p.urdu{...overflow-wrap:break-word;word-break:normal}`
   L1571 `.msg.userrow .bubble[dir="rtl"]{text-align:right;padding-right:16px;padding-left:14px}`
   L1572 `.msg.userrow .bubble[dir="rtl"] p{text-align:right;unicode-bidi:plaintext}`
   L1574 `.bubble-foot{clear:both;margin-top:8px;...}` (timestamp in normal flow)
   L1578 `.ai-body.urdu{font-size:14px;line-height:2.25}`
   L174  `.ai-body{...overflow-wrap:break-word;word-break:break-word}`
   This piece adds NO rule touching .bubble / .ai-body / .bubble-foot /
   .urdu / [dir="rtl"]. Alignment safety: the avatar is a flex item in the
   `.msg` row (A1, LTR row — only `.ai-body` inside the card gets dir="rtl",
   L2677-area), so in RTL messages the avatar stays at the left edge of the
   row and the card keeps its own wrapping; nothing in this piece can make
   the avatar overlap the bubble or the timestamp.

   STEP-BY-STEP INTEGRATION (coordinator / artifact editor)
   ------------------------------------------------------------------------
   1. Load order, end of <body> (after the main script that defines
      buildMessageEl/setCentreEnzo): Piece 1 (01-avatar-component.js) FIRST,
      then this file (03-chat-avatar.js). Then call `ChatAvatar.install()`.
      install() injects the scoped CSS, mounts the typing-row avatar, wraps
      setCentreEnzo, and mounts any `[data-chatav]` slots already in the DOM.
   2. PRIMARY CHANGE — in buildMessageEl, AI branch, replace line 2673 with:
        var html='<div class="enzo-chat-av" data-chatav role="img" aria-label="ENZO avatar"></div><div class="acard">';
      (Same 34px box, same position — first flex child of `.msg.airow` —
       only the inner face changes from the old orb to the component slot.
       Keep the old `.enzo-av` CSS in place for now: the sidebar orb and any
       other `.enzo-av` user are not this piece's scope.)
   3. MOUNT — immediately after line 2719 (`wrap.innerHTML=html;`), insert:
        ChatAvatar.mount(wrap, m, { isStreaming: isStreamingThis,
          isLast: (cNow && cNow.messages[cNow.messages.length-1]===m) });
      `cNow` is already in scope (defined just above L2657). mount() picks
      the kind, persists it on `m`, constructs EnzoAvatar in the slot, and
      registers the instance for the state funnel + blink scheduler.
      On every later renderMessages() pass the same message re-mounts from
      its persisted `m._avatarKind`, so the expression never freezes or
      resets mid-conversation.
   4. STATE FUNNEL — no edit needed in the artifact: install() wraps the
      existing `setCentreEnzo` (A10) so thinking -> answering -> done flows
      through automatically:
        thinking/researching -> Thinking | speaking -> Friendly + speaking
        listening -> Listening | working/coding -> Focused
        success -> Happy | error -> Surprised | idle -> re-classify latest
      The wrapper calls the original first, so the 3D companion hook
      (window.setEnzoState, L5851) and #typingAv data-state keep working.
   5. TYPING ROW (optional but recommended) — replace the avatar div inside
      the L1803 typingRow markup with
        `<div class="enzo-chat-av" id="typingAv" data-chatav data-typing="1" role="img" aria-label="ENZO"></div>`
      and call `ChatAvatar.mountTypingAv()` once (install() does this
      automatically if the slot exists). Leave the `.bubble` + typing dots
      exactly as they are. NOTE: setCentreEnzo L2556 still does
      `ta.setAttribute('data-state', ...)` on #typingAv — harmless on the
      new slot (plain attribute, no visual effect).
   6. LEGACY RENDERER (optional, dead code) — if buildMessageElLegacy (L2788)
      is ever revived, replace its L2804 avatar div with the same
      `<div class="enzo-chat-av" data-chatav ...></div>` slot and add the
      same mount call after its `wrap.innerHTML=html;`. Do NOT do this
      pre-emptively; it has zero callers today.
   7. OPTIONAL PRECISION HOOK — in playerStart (L4650-4658), after
      `setVoiceState('speaking')`, add
        `if(window.ChatAvatar) ChatAvatar.setSpeakingForWrap(wrapEl, true);`
      so the Listen Aloud face tracks the exact message being spoken rather
      than only the latest one. Safe to skip: the funnel (Step 4) already
      sets the latest avatar speaking.
   8. DO NOT: edit the v51 RTL block (A7); change `.msg`/`.acard` widths;
      remove `.enzo-av` CSS yet; duplicate the face SVG anywhere in this
      piece; call EnzoAvatar before Piece 1 loads (mount() guards for it).

   HONEST LIMITS
   - Piece 1 did not exist when this was written, so mounting against the
     real component is untested; the contract above is the integration point.
     If Piece 1's constructor/options differ, only mount() needs adapting.
   - Expression classification is heuristic text matching, not a model:
     a greeting buried mid-answer, or sarcasm/excitement, can misclassify.
     The `m._avatarKind` override is the escape hatch.
   - If Piece 1 exposes no `blink()` method, per-instance blink phase
     depends on Piece 1 accepting the `blinkSeed` option; if it ignores the
     option, avatars fall back to Piece 1's internal blink (still blinking,
     possibly in sync). The old CSS lockstep blink (A6) is gone for chat
     avatars either way, because the new slot carries no `.enzo-av` class.
   - `renderMessages()` rebuilds the whole list on every push, so mounting
     N EnzoAvatar instances on every keystroke of a long chat is O(N) DOM
     work per render — the artifact already pays that cost for the messages
     themselves; if it ever becomes slow, the fix belongs in renderMessages,
     not here.
   ========================================================================== */

(function (root, factory) {
  'use strict';
  /* UMD-lite: browser global `ChatAvatar`; Node gets module.exports so the
     expression mapping can be simulated/tested with `node 03-chat-avatar.js`. */
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatAvatar = api;
  /* Self-test when run directly under Node: `node 03-chat-avatar.js` */
  if (typeof module !== 'undefined' && typeof require !== 'undefined' &&
      require.main === module) api._selfTest();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var SIZE = 34; /* px — must match .enzo-av geometry (A3, L1391) so the
                    row layout does not shift by a single pixel. */

  /* Message kind -> Piece 1 controller expression (see header table). */
  var EXPRESSION_MAP = {
    greeting: 'Happy',
    answering: 'Neutral',
    thinking: 'Thinking',
    explaining: 'Focused',
    listening: 'Listening',
    surprised: 'Surprised'
  };

  /* App state (setCentreEnzo funnel, A10) -> controller expression.
     idle maps to null: re-classify the latest message from its own content
     instead of freezing it on one resting face. */
  var APP_STATE_MAP = {
    idle: null,
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Neutral',
    working: 'Focused',
    researching: 'Focused',
    coding: 'Focused',
    success: 'Happy',
    error: 'Surprised'
  };

  /* Greeting: only the OPENING of the answer counts, and only for short
     greeting-style replies — a greeting buried mid-answer is not a greeting. */
  var GREETING_RE = /^\s*(assalamu?\s?alaikum|aoa|salam|salaam|adaab|hello|hi\b|hey\b|good\s(morning|afternoon|evening)|wa\s?alaikum)/i;
  var GREETING_URDU_RE = /^\s*(السلام|وعلیکم)/;
  /* Surprise: wow-style openings or heavy exclamation in the first lines. */
  var SURPRISED_RE = /\b(wow|amazing|unbelievable|incredible|unexpected|surprise|surprised|oh\s+(no|wow|my)|what\s+a)\b/i;

  var CSS_ID = 'chat-avatar-css';
  var BLINK_TICK_MS = 200;
  var BLINK_MIN_GAP_MS = 2800; /* natural blink cadence: ~every 3–6 s */
  var BLINK_RAND_MS = 3600;

  /* ------------------------------------------------------------------ */
  /* Small helpers (no dependencies, no DOM at load time)               */
  /* ------------------------------------------------------------------ */
  function plainOf(m) {
    if (!m) return '';
    var t = m.plain || '';
    if (!t && m.html) t = String(m.html).replace(/<[^>]+>/g, ' ');
    return String(t).replace(/\s+/g, ' ').trim();
  }
  function hasStructure(html) {
    return /<(h[1-4]|ul|ol|pre|table|blockquote)\b/i.test(html || '');
  }
  function reducedMotion() {
    try {
      return !!(typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* Expression classification — PURE function (no window/document).     */
  /* ctx: { isStreaming, isLast, voiceListening, speaking } — all optional. */
  /* ------------------------------------------------------------------ */
  function classifyMessageKind(m, ctx) {
    ctx = ctx || {};
    if (!m || m.role === 'user') return 'answering'; /* never called for users */
    /* 1. Explicit override wins — the escape hatch for any classifier. */
    if (m._avatarKind && EXPRESSION_MAP[m._avatarKind]) return m._avatarKind;
    /* 2. An errored answer is the surprising outcome. */
    if (m.error) return 'surprised';
    /* 3. Generating with no answer text yet: still thinking. */
    if (ctx.isStreaming && !m.html && !plainOf(m)) return 'thinking';
    /* 4. Mic live and waiting for the user. */
    if (ctx.voiceListening && !ctx.speaking) return 'listening';
    var text = plainOf(m);
    var head = text.slice(0, 160);
    var headLong = text.slice(0, 300);
    /* 5. Greeting — opening words + short greeting-style reply. */
    if ((GREETING_RE.test(head) || GREETING_URDU_RE.test(head)) && text.length < 400)
      return 'greeting';
    /* 6. Surprised — wow/exclamation style, or an error-flavoured opening. */
    if (SURPRISED_RE.test(headLong) || (headLong.slice(0, 200).split('!').length - 1) >= 2)
      return 'surprised';
    /* 7. Explaining — deep research, or a long structured answer. */
    if (m.deep || m.mega || hasStructure(m.html) || text.length > 800)
      return 'explaining';
    /* 8. Default: a plain completed (or streaming) answer is friendly. */
    return 'answering';
  }

  function expressionForKind(kind) {
    return EXPRESSION_MAP[kind] || EXPRESSION_MAP.answering;
  }

  /* ------------------------------------------------------------------ */
  /* Scoped CSS — ONLY the avatar slot. No .bubble/.ai-body/.urdu rules. */
  /* ------------------------------------------------------------------ */
  var CHAT_AVATAR_CSS = [
    /* Same 34px box as the old .enzo-av (A3): first flex child of .msg,
       top-aligned with the card, can never overlap bubble or timestamp. */
    '.enzo-chat-av{width:34px;height:34px;flex:0 0 34px;flex-shrink:0;',
    'align-self:flex-start;margin-top:2px;border-radius:50%;overflow:hidden;',
    'background:#0B1530;',
    /* Cyan ring mirrors the old orb ring (L1391) until Piece 1's own frame
       owns the border — delete this line if Piece 1 already draws the ring. */
    'box-shadow:0 0 0 2px rgba(0,217,255,.35),0 0 10px rgba(59,130,246,.40)}',
    '.enzo-chat-av svg{display:block;width:100%;height:100%}',
    /* Degraded fallback (Piece 1 not loaded): a plain letter, NOT a face. */
    '.enzo-chat-av--fallback{display:grid;place-items:center;color:#00D9FF;',
    'font-weight:800;font-size:15px}',
    /* Typing row uses the same slot class; nothing special needed. */
    '#typingRow .enzo-chat-av{margin-top:0}'
  ].join('\n');

  function injectCss() {
    if (typeof document === 'undefined') return false;
    if (document.getElementById(CSS_ID)) return true;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = CHAT_AVATAR_CSS;
    document.head.appendChild(st);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Registry + shared blink scheduler (one timer, per-instance phase).  */
  /* ------------------------------------------------------------------ */
  var latest = null;      /* most recently mounted message record */
  var typingRec = null;   /* typing-row avatar record */
  var blinkTimer = null;
  var blinkEntries = [];  /* { instance, nextAt } */

  function blinkNow() {
    if (typeof Date === 'undefined') return 0;
    return Date.now();
  }
  function nextBlinkDelay(seed) {
    /* Deterministic-ish spread from the per-message seed + randomness:
       first blink 1.2–4.8 s after mount, then every ~2.8–6.4 s. */
    var base = BLINK_MIN_GAP_MS + ((seed || 0) % 1700);
    return base + Math.random() * BLINK_RAND_MS * 0.5;
  }
  function registerBlink(instance, seed) {
    if (!instance || typeof instance.blink !== 'function') return; /* Piece 1
      blinks internally — nothing to schedule (see header, Honest Limits). */
    blinkEntries.push({ instance: instance, nextAt: blinkNow() + nextBlinkDelay(seed) });
    ensureBlinkTimer();
  }
  function ensureBlinkTimer() {
    if (blinkTimer !== null || blinkEntries.length === 0) return;
    if (reducedMotion()) return; /* never animate against the user's setting */
    blinkTimer = setInterval(function () {
      var now = blinkNow();
      for (var i = 0; i < blinkEntries.length; i++) {
        var e = blinkEntries[i];
        if (now >= e.nextAt) {
          try { e.instance.blink(); } catch (err) { /* one bad instance must
            never stop the others blinking */ }
          e.nextAt = now + BLINK_MIN_GAP_MS + Math.random() * BLINK_RAND_MS;
        }
      }
    }, BLINK_TICK_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Mounting                                                            */
  /* ------------------------------------------------------------------ */
  function seedFor(m) {
    /* Persisted on the message object so a re-render (A9) keeps the same
       blink phase — the rhythm survives DOM rebuilds. */
    if (typeof m._avatarSeed !== 'number')
      m._avatarSeed = Math.floor(Math.random() * 100000);
    return m._avatarSeed;
  }

  function mountInstance(slot, m, ctx) {
    var kind = classifyMessageKind(m, ctx);
    var expr = expressionForKind(kind);
    m._avatarKind = kind;
    m._avatarExpr = expr;
    slot.setAttribute('data-msgkind', kind);
    slot.setAttribute('data-expression', expr);
    var rec = { slot: slot, message: m, kind: kind, expression: expr, instance: null };
    var Ctor = (typeof window !== 'undefined') ? window.EnzoAvatar : undefined;
    if (typeof Ctor === 'function') {
      try {
        var inst = new Ctor(slot, { size: SIZE, expression: expr, seed: seedFor(m) });
        rec.instance = inst;
        if (ctx.speaking && inst.setSpeaking) inst.setSpeaking(true);
        if (ctx.voiceListening && inst.setListening) inst.setListening(true);
        registerBlink(inst, m._avatarSeed);
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn)
          console.warn('[ChatAvatar] EnzoAvatar failed, using fallback slot:', e);
        slot.classList.add('enzo-chat-av--fallback');
        slot.textContent = 'E';
      }
    } else {
      /* Piece 1 not loaded (yet) — keep the layout slot, do not crash. */
      if (typeof console !== 'undefined' && console.warn)
        console.warn('[ChatAvatar] EnzoAvatar (Piece 1) not loaded — chat avatar slot left as fallback. Load 01-avatar-component.js before 03-chat-avatar.js.');
      slot.classList.add('enzo-chat-av--fallback');
      slot.textContent = 'E';
    }
    return rec;
  }

  /* Mount the avatar for one built message element.
     Call immediately after `wrap.innerHTML=html;` (A16, L2719). */
  function mount(wrapEl, m, ctx) {
    if (!wrapEl || !m || typeof document === 'undefined') return null;
    ctx = ctx || {};
    var slot = wrapEl.querySelector('[data-chatav]');
    if (!slot) return null;
    if (slot._chatAvatarMounted) {
      /* Re-mounted after a re-render: same slot element reused — refresh
         expression from the persisted kind instead of rebuilding. */
      setMessageExpression(wrapEl, m._avatarKind || classifyMessageKind(m, ctx), ctx);
      return wrapEl._chatAvatar || null;
    }
    slot._chatAvatarMounted = true;
    var rec = mountInstance(slot, m, ctx);
    wrapEl._chatAvatar = rec;
    latest = rec; /* mounts happen in DOM order; last one is the last message */
    return rec;
  }

  /* Mount every unmounted [data-chatav] slot in the document (safety net
     for dynamically inserted messages that bypassed buildMessageEl). */
  function mountAll() {
    if (typeof document === 'undefined') return 0;
    var slots = document.querySelectorAll('[data-chatav]');
    var n = 0;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i]._chatAvatarMounted) continue;
      var wrap = slots[i].closest ? slots[i].closest('.msg') : null;
      if (wrap) { mount(wrap, { role: 'ai' }, {}); n++; }
    }
    return n;
  }

  /* Mount the typing-row avatar (#typingAv, A8/L1803) with Thinking. */
  function mountTypingAv() {
    if (typeof document === 'undefined') return null;
    var slot = document.getElementById('typingAv');
    if (!slot || slot._chatAvatarMounted) return typingRec;
    slot.classList.add('enzo-chat-av');
    slot.innerHTML = '';
    slot._chatAvatarMounted = true;
    var fake = { role: 'ai', _avatarKind: 'thinking', _avatarSeed: 7 };
    typingRec = mountInstance(slot, fake, {});
    return typingRec;
  }

  /* ------------------------------------------------------------------ */
  /* Expression updates (the anti-freeze path)                           */
  /* ------------------------------------------------------------------ */
  function setMessageExpression(wrapEl, kind, ctx) {
    if (!wrapEl) return false;
    var rec = wrapEl._chatAvatar;
    if (!rec) return false;
    ctx = ctx || {};
    if (!EXPRESSION_MAP[kind]) kind = classifyMessageKind(rec.message, ctx);
    var expr = expressionForKind(kind);
    rec.kind = kind;
    rec.expression = expr;
    rec.message._avatarKind = kind;
    rec.message._avatarExpr = expr;
    if (rec.slot) {
      rec.slot.setAttribute('data-msgkind', kind);
      rec.slot.setAttribute('data-expression', expr);
    }
    if (rec.instance) {
      try {
        if (rec.instance.setExpression) rec.instance.setExpression(expr);
        if (rec.instance.setSpeaking) rec.instance.setSpeaking(!!ctx.speaking);
        if (rec.instance.setListening) rec.instance.setListening(!!ctx.voiceListening && !ctx.speaking);
      } catch (e) { /* never break rendering for an avatar failure */ }
    }
    return true;
  }

  /* Update the LATEST message avatar from an app state (setCentreEnzo arg).
     idle -> re-classify from content, so a finished answer settles on its
     real kind instead of freezing on the speaking/thinking face. */
  function updateLatestFromAppState(appState) {
    if (!latest) return false;
    var st = String(appState || 'idle').toLowerCase();
    var expr = APP_STATE_MAP.hasOwnProperty(st) ? APP_STATE_MAP[st] : null;
    if (st === 'idle') {
      return setMessageExpression(
        latest.slot && latest.slot.closest ? latest.slot.closest('.msg') : null,
        classifyMessageKind(latest.message, {}), {});
    }
    if (expr === null) return false;
    /* Map the controller expression back to a kind for persistence. */
    var kind = 'answering';
    for (var k in EXPRESSION_MAP) {
      if (EXPRESSION_MAP[k] === expr) { kind = k; break; }
    }
    var wrap = (latest.slot && latest.slot.closest) ? latest.slot.closest('.msg') : null;
    var ok = setMessageExpression(wrap, kind, {
      speaking: st === 'speaking',
      voiceListening: st === 'listening'
    });
    /* Typing row mirrors thinking/listening while it is visible. */
    if (typingRec && typingRec.instance && typingRec.instance.setExpression) {
      try {
        typingRec.instance.setExpression(
          st === 'thinking' || st === 'researching' || st === 'working' ? 'Thinking' :
          st === 'listening' ? 'Listening' :
          st === 'speaking' ? 'Neutral' : typingRec.expression);
      } catch (e) {}
    }
    return ok;
  }

  /* Optional precision hook for Listen Aloud (Step 7): mark the exact
     message being spoken, not just the latest one. */
  function setSpeakingForWrap(wrapEl, on) {
    if (!wrapEl) return false;
    var rec = wrapEl._chatAvatar;
    if (!rec) return false;
    return setMessageExpression(wrapEl, on ? 'answering' : (rec.message._avatarKind || 'answering'),
      { speaking: !!on });
  }

  /* ------------------------------------------------------------------ */
  /* install() — wraps setCentreEnzo, mounts typing avatar, injects CSS  */
  /* ------------------------------------------------------------------ */
  var funnelInstalled = false;
  var funnelRetries = 0;

  function installStateFunnel() {
    if (funnelInstalled) return true;
    if (typeof window === 'undefined' || typeof window.setCentreEnzo !== 'function') {
      /* Main script may not have run yet — retry briefly, then give up
         quietly (mount() still works; only live state sync is lost). */
      if (funnelRetries < 20) {
        funnelRetries++;
        setTimeout(installStateFunnel, 250);
      }
      return false;
    }
    var orig = window.setCentreEnzo;
    window.setCentreEnzo = function (st) {
      var r = orig.apply(this, arguments); /* 3D companion + #typingAv first */
      try { updateLatestFromAppState(st); } catch (e) { /* never break the funnel */ }
      return r;
    };
    funnelInstalled = true;
    return true;
  }

  function install() {
    injectCss();
    mountTypingAv();
    installStateFunnel();
    mountAll();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Node self-test: expression-mapping simulation (no DOM needed).       */
  /* ------------------------------------------------------------------ */
  function selfTest() {
    var cases = [
      { name: 'greeting',   m: { role: 'ai', plain: 'Assalamualaikum, Raja! Kya haal hai? Main aapki kya madad kar sakta hoon?' }, ctx: {}, want: 'Happy' },
      { name: 'answering',  m: { role: 'ai', plain: 'Bitcoin ek decentralised digital currency hai jo blockchain par chalti hai.' }, ctx: {}, want: 'Neutral' },
      { name: 'thinking',   m: { role: 'ai', plain: '', html: '' }, ctx: { isStreaming: true }, want: 'Thinking' },
      { name: 'explaining', m: { role: 'ai', deep: true, plain: 'Yeh raha tafseeli jawab.', html: '<h3>Step 1</h3><ul><li>pehla</li></ul>' }, ctx: {}, want: 'Focused' },
      { name: 'listening',  m: { role: 'ai', plain: '' }, ctx: { voiceListening: true }, want: 'Listening' },
      { name: 'surprised',  m: { role: 'ai', plain: 'Wow! Yeh to bilkul unexpected result hai!' }, ctx: {}, want: 'Surprised' },
      { name: 'error->surprised', m: { role: 'ai', error: true, plain: 'Sorry, kuch ghalat ho gaya.' }, ctx: {}, want: 'Surprised' },
      { name: 'streaming answer', m: { role: 'ai', plain: 'Bitcoin ek...', html: '' }, ctx: { isStreaming: true }, want: 'Neutral' },
      { name: 'override wins',    m: { role: 'ai', _avatarKind: 'listening', plain: 'Hello there.' }, ctx: {}, want: 'Listening' },
      { name: 'long structured->explaining', m: { role: 'ai', plain: new Array(900).join('x'), html: '<p>' + new Array(900).join('x') + '</p>' }, ctx: {}, want: 'Focused' }
    ];
    var pass = 0;
    console.log('ChatAvatar expression-mapping simulation (03-chat-avatar.js)');
    console.log('kind'.padEnd(26) + 'mapped'.padEnd(12) + 'expected'.padEnd(12) + 'result');
    cases.forEach(function (c) {
      var kind = classifyMessageKind(c.m, c.ctx);
      var got = expressionForKind(kind);
      var ok = got === c.want;
      if (ok) pass++;
      console.log(c.name.padEnd(26) + got.padEnd(12) + c.want.padEnd(12) + (ok ? 'PASS' : 'FAIL (kind=' + kind + ')'));
    });
    console.log(pass + '/' + cases.length + ' cases passed.');
    if (pass !== cases.length && typeof process !== 'undefined') process.exitCode = 1;
    return pass === cases.length;
  }

  /* ------------------------------------------------------------------ */
  return {
    SIZE: SIZE,
    EXPRESSION_MAP: EXPRESSION_MAP,
    APP_STATE_MAP: APP_STATE_MAP,
    classifyMessageKind: classifyMessageKind,
    expressionForKind: expressionForKind,
    mount: mount,
    mountAll: mountAll,
    mountTypingAv: mountTypingAv,
    setMessageExpression: setMessageExpression,
    setSpeakingForWrap: setSpeakingForWrap,
    updateLatestFromAppState: updateLatestFromAppState,
    install: install,
    injectCss: injectCss,
    _selfTest: selfTest
  };
});
