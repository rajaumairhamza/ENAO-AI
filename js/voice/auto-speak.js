
/* ============================================================================
   ENAO AI v54 — Piece 1: voice auto-speak (01-voice-auto-speak.js)
   Artifact slug: enao-ai, web_static. Built against live v53-monitor
   (~/workspace/your_files/enao-ai/enao-ai.html, 21,826 lines).
   DEPLOY ON HOLD (Raja, 22 Nov 2026 ~11:58 AM): this piece is built and
   tested only. The coordinator assembles and deploys it later, once
   Raja's further detail arrives. Do NOT deploy from this file alone.

   WHAT THIS PIECE DOES
   One single funnel — speakIfVoice(msg, mode, deps) — through which EVERY
   delivered AI answer passes at delivery time, so a voice-in question
   always gets a spoken answer no matter which delivery path served it.
   It does NOT replace the streaming path: finishStream keeps calling the
   same funnel (PATCH P2), and an idempotency flag on the message
   (msg._v54Spoken) makes a double call speak exactly once.

   LOCKED RULES THIS PIECE PRESERVES (do not change in assembly)
   - Typed question = text-only answer, never auto-spoken (auto mode).
   - Voice question (mic, voice message, live call) = spoken answer.
   - wantsTextReply override wins over everything, including mode 'on':
     "text mein bhejo / likh kar bhejo / reply in text" (and Urdu) means
     this one answer stays text-only, even mid-call.
   - Mode 'on' speaks every answer; mode 'off' never auto-speaks.
   - The manual Listen Aloud player is untouched (it is a separate path).
   - Voice state is shown ONLY on the composer's mic button (untouched).
   - Zero emojis anywhere in this file.
   - No topic is special-cased: no single topic, style or keyword is
     hardcoded anywhere in this piece. The decision uses only the
     message's viaVoice flag, its question text (for the text-reply
     override) and the answers mode.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies).

   V53 ANCHORS (verified by grep/read against the live file)
   - askQuestion(text, viaVoice, forcedDeep) ............ L4224
   - sendCurrent() (viaVoice = !!state.nextAskViaVoice) . L4208
   - recognition onresult (final -> nextAskViaVoice) .... L4705
   - flushVoiceQueue() ................................. L4446
   - maybeSpeak(msg) ................................... L4456
   - finishStream(chat, msg) -> maybeSpeak(msg) ......... L4467 / L4475
   - streamMessage(chat, msg) ........................... L4405
   - answersMode() / wantsTextReply(text) ............... L4428 / L4433
   - speakText(text, lang) .............................. L4544
   - deliverAnswer(ctx, ...) ............................ L12806
   - deliverClarify(ctx, ...) ........................... L12831
   - deliverError(ctx) .................................. L12848
   - fallbackLegacy(ctx) ................................ L12861
   - defaultCtx(chat, task) ............................. L13064
   - restoreBackendForChat(chat) ........................ L13069
   - backendAsk(text, viaVoice, forcedDeep) ............. L13012
   - remReplyAi(chat, ctx, plain) ....................... L13410
   - pushPair(...) / pushClarifyPair(...) ............... L13738 / L15081
   - window.askQuestion wrappers (viaVoice preserved) ... L13554, L13788, L15141
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'v54-piece1-voice-auto-speak';

  /* ------------------------------------------------------------------
     wantsTextReply(text) — copied exactly from v53 L4433-L4443.
     The user explicitly asked for this answer in TEXT. This override
     beats the voice-in / voice-out rule AND mode 'on', for this one
     answer only. Kept verbatim so the harness tests the real logic.
     ------------------------------------------------------------------ */
  function wantsTextReply(text){
    var t = ' ' + String(text || '').toLowerCase() + ' ';
    return /(text|ٹیکسٹ)[\s-]*(mein|me|میں)?[\s-]*(bhej\w*|send|likh\w*|jawab|reply|answer|do|de)\b/.test(t)
      || /likh\s*(kar|ke)\s*bhej/.test(t)
      || /(sirf|only)\s+text\b/.test(t)
      || /(reply|answer|send|respond)\s+in\s+text\b/.test(t)
      || /لکھ کر بھیج/.test(t);
  }

  /* ------------------------------------------------------------------
     shouldAutoSpeak(msg, mode) — PURE decision function. No DOM, no
     speechSynthesis, no state, no network. Fully unit-testable.
     msg:   an AI message object as v53 builds it — needs only
            { plain, viaVoice, question, lang }.
     mode:  'auto' | 'on' | 'off' (answersMode() value). Any other
            value (including undefined/null) is treated as 'auto',
            exactly like v53 answersMode() L4428.
     Returns true only when this answer should be spoken aloud now.
       voice-in  -> speak (auto mode)
       typed     -> never speak (auto mode)
       wantsTextReply(question) -> never speak (beats mode 'on' too,
            same order as v53 maybeSpeak L4456-L4464)
       mode 'on' -> always speak (unless wantsTextReply)
       mode 'off'-> never speak
       nothing readable to speak -> never speak
     ------------------------------------------------------------------ */
  function shouldAutoSpeak(msg, mode){
    var m = msg || {};
    var plain = m.plain || m.text || '';
    if(!plain) return false;
    if(m.question && wantsTextReply(m.question)) return false;
    if(mode === 'on') return true;
    if(mode === 'off') return false;
    return !!m.viaVoice;
  }

  /* ------------------------------------------------------------------
     viaVoiceFromChat(chat) — recover the voice flag from the chat
     itself. The last user message in the chat carries viaVoice
     (set by pushUserMsg / askQuestion, persisted by saveChats).
     Used by PATCH P4 for restored backend tasks, where the ctx is
     rebuilt from task metadata that carries no voice flag.
     Returns false when there is no user message or it was typed.
     ------------------------------------------------------------------ */
  function viaVoiceFromChat(chat){
    if(!chat || !chat.messages || !chat.messages.length) return false;
    var i;
    for(i = chat.messages.length - 1; i >= 0; i--){
      if(chat.messages[i] && chat.messages[i].role === 'user'){
        return !!chat.messages[i].viaVoice;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
     speakIfVoice(msg, mode, deps) — THE SINGLE FUNNEL.
     Every delivered AI answer must pass through this call, exactly
     once per answer, at its delivery site (see PATCH P1-P3).
     deps (optional, for the harness and for assembly):
       { speakText: fn(text, lang), flushVoiceQueue: fn() }
     When deps are omitted, the live page globals speakText /
     flushVoiceQueue are used when present.
     Behaviour:
       - If this message already had a speak attempt
         (msg._v54Spoken), return false immediately: calling the hook
         at BOTH the delivery site and finishStream can never speak
         the same answer twice.
       - If shouldAutoSpeak is false (typed / text-reply / mode off),
         flush the voice queue when a flush fn is available, exactly
         like v53 maybeSpeak does on those branches, so a live call
         keeps going to the next queued question. Return false.
       - Otherwise mark msg._v54Spoken = true FIRST (so a re-entrant
         call cannot double-speak), then speak msg.plain in msg.lang.
         Return true. A throwing speakText never breaks delivery:
         the call is guarded and still counts as attempted.
     ------------------------------------------------------------------ */
  function speakIfVoice(msg, mode, deps){
    var d = deps || {};
    if(!msg) return false;
    if(msg._v54Spoken) return false;
    if(!shouldAutoSpeak(msg, mode)){
      if(typeof d.flushVoiceQueue === 'function'){
        try{ d.flushVoiceQueue(); }catch(e){}
      } else if(typeof root.flushVoiceQueue === 'function'){
        try{ root.flushVoiceQueue(); }catch(e){}
      }
      return false;
    }
    msg._v54Spoken = true;
    var speak = null;
    if(typeof d.speakText === 'function') speak = d.speakText;
    else if(typeof root.speakText === 'function') speak = root.speakText;
    if(speak){
      try{ if(window.EnzoVoiceFix43) window.EnzoVoiceFix43.checkVolumeBeforeSpeak(msg, state); }catch(e){}
    try{ speak(msg.plain || msg.text || '', msg.lang); }catch(e){}
    }
    return true;
  }

  /* ==================================================================
     PATCH FUNCTIONS — for the assembler to INLINE at the exact v53
     delivery sites listed. Each one is a one-line call to the single
     funnel above; they exist so the assembly diff shows the site
     name, not an anonymous call. None of them changes any other
     behaviour at its site.
     ================================================================== */

  /* PATCH P1 — deliverAnswer (v53 L12806-L12830), THE LIVE BACKEND
     PATH and the core of this fix.
     INLINE: call patchDeliverAnswer(msg, mode, deps) in BOTH branches,
     right after chat.messages.push(msg) + saveChats():
       active branch (L12820-L12822): after streamMessage(chat, msg);
         the funnel is idempotent, so the later finishStream call
         cannot double-speak.
       inactive branch (L12823-L12828): after msg.html = msg._fullHtml;
         THIS branch had NO speak call at all in v53 — an answer that
         finished while the user was on another chat was never spoken,
         even for a voice question. This one line fixes it.
     mode: answersMode() at the call site (v53 L4428). */
  function patchDeliverAnswer(msg, mode, deps){
    return speakIfVoice(msg, mode, deps);
  }

  /* PATCH P2 — finishStream (v53 L4467-L4476), the legacy streaming
     path (askQuestion answers, mega answers, fallback answers).
     INLINE: REPLACE the maybeSpeak(msg) call at L4475 with
     patchFinishStream(msg, mode, deps). Same funnel, same decision.
     If PATCH P1 already spoke this message at delivery time, the
     _v54Spoken guard makes this call a no-op — never double speech. */
  function patchFinishStream(msg, mode, deps){
    return speakIfVoice(msg, mode, deps);
  }

  /* PATCH P3 — every direct-maybeSpeak delivery site in v53.
     INLINE: replace the maybeSpeak(msg) call at each site with
     patchDirectSpeak(msg, mode, deps). One funnel, same decision.
     Sites (all verified in v53):
       greeting / small-talk reply, askQuestion ...... L4249
       clarifying question, askQuestion ............. L4367
       error fallback, askQuestion .................. L4401
       mega clarifying question, megaSearchFlow ..... L4113
       mega error, megaSearchFlow ................... L4146
       deliverClarify (backend) ..................... L12841
       deliverError (backend) ....................... L12857
       remReplyAi (reminders) ....................... L13412
       pushPair (confirm / private-answer) .......... L13745
       pushClarifyPair (clarify gate) ............... L15089 */
  function patchDirectSpeak(msg, mode, deps){
    return speakIfVoice(msg, mode, deps);
  }

  /* PATCH P4 — defaultCtx (v53 L13064-L13068), restored backend tasks.
     v53 hardcodes viaVoice:false here, so any backend task resumed
     after a chat switch or a page reload (restoreBackendForChat,
     L13069) delivers its answer with the voice flag already lost —
     auto mode then stays text-only even for a voice question.
     INLINE: replace `viaVoice:false` in defaultCtx with
     `viaVoice: EnaoV54Voice.viaVoiceFromChat(chat)`.
     Returns the recovered flag (true when the chat's last user
     message was sent by voice). The task argument is accepted for
     signature compatibility and is intentionally unused: the chat
     history is the only source of the flag on the frontend. */
  function patchDefaultCtxViaVoice(chat, task){
    return viaVoiceFromChat(chat);
  }

  var EnaoV54Voice = {
    VERSION: VERSION,
    wantsTextReply: wantsTextReply,
    shouldAutoSpeak: shouldAutoSpeak,
    viaVoiceFromChat: viaVoiceFromChat,
    speakIfVoice: speakIfVoice,
    patchDeliverAnswer: patchDeliverAnswer,
    patchFinishStream: patchFinishStream,
    patchDirectSpeak: patchDirectSpeak,
    patchDefaultCtxViaVoice: patchDefaultCtxViaVoice
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnaoV54Voice = EnaoV54Voice;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnaoV54Voice;

})(typeof window !== 'undefined' ? window : this);
