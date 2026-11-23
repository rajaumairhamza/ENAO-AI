
/* ============================================================================
   ENAO AI v43 — voice flag on Regenerate/Retry + volume-0 honest hint
   (43-voice-flag-and-volume.js)
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines,
   meta v61-deep-triggers-4lang). DO NOT deploy from this file alone;
   the coordinator assembles and deploys it. Do NOT edit the artifact
   from this piece.

   DEFECT (Raja, 22 Nov 2026 ~6:42 PM PKT): mic question -> ENZO never
   answers in voice.

   WHAT THIS PIECE FIXES (two small, separate fixes, each independently
   testable — see the PATCH functions below)
   FIX 1 — Regenerate / Retry Search lose the voice flag.
     Live L5632, L5760 (Regenerate) and L5635, L5764 (Retry Search):
       askQuestion(m.question, false, !!m.deep)
     The hardcoded `false` drops viaVoice even though the same message
     object carries `m.viaVoice`. A voice question that is regenerated
     or retried comes back text-only. Contrast L5458 (edit resend),
     which already does it right: askQuestion(nt, !!m.viaVoice, wasDeep).
     This piece passes the ORIGINAL message's voice flag instead:
       askQuestion(m.question, resolveViaVoice(m, chat), !!m.deep)
     `deep` is untouched — a Deep Research question still retries as
     Deep Research, exactly as the old comment promised.
   FIX 2 — Volume 0 = silent speech with no hint.
     Live L7594 (speakText): u.volume = state.voiceVolume. Live L7933
     (and L5614/L5742 per-answer sliders): dragging the volume slider
     to 0 stores 0, and reload resets it to 1 (L5000). So a 0 volume
     only ever happens in-session, after the slider was dragged to 0 —
     and then every auto-spoken answer runs silently with no indication
     why. This piece adds one honest toast at the auto-speak decision
     point when an answer WOULD be auto-spoken but the volume is 0.
     It does NOT change the volume value and does NOT force volume up.

   LOCKED RULES THIS PIECE PRESERVES (do not change in assembly)
   - Typed question = text-only answer, never auto-spoken.
   - Voice question (mic, voice message, live call) = spoken answer.
   - `deep` keeps its exact current meaning; this piece never flips it.
   - The volume value is never changed by this piece — no forcing up,
     no reset, no write to prefs. Only a toast explains the silence.
   - The toast fires at most once per answer — never spam.
   - The manual Listen Aloud player is untouched (separate path).
   - Zero emojis anywhere in this file.
   - No topic is special-cased: no single topic, style or keyword is
     hardcoded anywhere in this piece. The decision uses only the
     message's viaVoice flag, the chat history fallback, and the
     volume value.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies).

   LIVE ANCHORS (verified by grep/read against the live v61 file)
   - Regenerate handler (live renderer) .............. L5632
   - Retry Search handler (live renderer) ............ L5635
   - Retry comment (misleading — see FIX 1) ......... L5634, L5762-L5763
   - Regenerate handler (legacy renderer, dead code:
     zero callers, audit ref A18) ................... L5760
   - Retry Search handler (legacy renderer) .......... L5764
   - Edit resend (correct pattern to copy) ........... L5458
   - buildMessageEl(m): chat in scope as cNow ....... L5485, L5545
     (var cNow = activeChat(); — pass cNow as the chat argument)
   - viaVoiceFromChat (v54, same recovery logic) ..... L47778-L47786
   - speakText volume ............................... L7594
   - Settings volume slider ......................... L7933
   - Per-answer volume sliders ...................... L5614, L5742
   - Volume default / reload reset to 1 ............. L4995, L5000
   - toast(msg) ..................................... L5209
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = 'v43-voice-flag-and-volume';

  /* The one honest toast for FIX 2. Exact wording from the brief.
     It states the fact (volume is 0) and the fix (turn it up) and
     never pretends speech happened. */
  var VOLUME_ZERO_TOAST = 'Voice volume is 0 — turn the volume up to hear the answer';

  /* Messages this piece has already warned about, so the volume-0
     toast fires at most once per answer. Stores message OBJECT
     references (each delivered answer is its own object), plus the
     per-message _v43VolumeToastShown flag as a second guard. */
  var volumeToastSeen = [];

  function markVolumeToastSeen(msg){
    if(!msg) return;
    try{ msg._v43VolumeToastShown = true; }catch(e){}
    if(volumeToastSeen.indexOf(msg) === -1) volumeToastSeen.push(msg);
  }

  function alreadyVolumeToasted(msg){
    if(!msg) return false;
    if(msg._v43VolumeToastShown) return true;
    return volumeToastSeen.indexOf(msg) !== -1;
  }

  /* Reset the once-per-answer toast memory. For the harness only;
     live code never needs to call this (each new answer is a new
     object, so a new answer gets its own single toast). */
  function resetVolumeToastSeen(){
    volumeToastSeen = [];
  }

  /* ------------------------------------------------------------------
     viaVoiceFromChat(chat) — recover the voice flag from the chat
     itself. Same logic as v54 (live L47778-L47786): the last user
     message in the chat carries viaVoice (set by pushUserMsg /
     askQuestion, persisted by saveChats). Returns false when there
     is no user message or it was typed. Accepts a chat object with
     a .messages array, or a bare messages array.
     ------------------------------------------------------------------ */
  function viaVoiceFromChat(chat){
    var msgs = null;
    if(!chat) return false;
    if(Object.prototype.toString.call(chat) === '[object Array]') msgs = chat;
    else msgs = chat.messages;
    if(!msgs || !msgs.length) return false;
    var i;
    for(i = msgs.length - 1; i >= 0; i--){
      if(msgs[i] && msgs[i].role === 'user'){
        return !!msgs[i].viaVoice;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
     resolveViaVoice(m, chat) — the voice flag for a re-ask of message
     m. Rule, in order:
       1. If the message object itself carries viaVoice (the normal
          case — every AI message is built with viaVoice:askViaVoice),
          use it. An explicit false on the message beats the chat
          history: a typed question stays typed even if an earlier
          question in the same chat was voice.
       2. If the message has no viaVoice field at all (older saved
          message), recover it from the chat history the same way
          v54 viaVoiceFromChat does: the last user message's flag.
       3. If no chat is passed, try the live page's activeChat()
          when it exists (guarded — the harness has no such global
          and simply gets false).
     Returns a boolean, never undefined.
     ------------------------------------------------------------------ */
  function resolveViaVoice(m, chat){
    var c = chat;
    if(m && typeof m.viaVoice !== 'undefined' && m.viaVoice !== null){
      return !!m.viaVoice;
    }
    if(!c && root && typeof root.activeChat === 'function'){
      try{ c = root.activeChat(); }catch(e){ c = null; }
    }
    return viaVoiceFromChat(c);
  }

  /* ------------------------------------------------------------------
     regenArgs(m, chat) / retryArgs(m, chat) — the exact arguments a
     Regenerate / Retry Search re-ask must pass to askQuestion:
       [ question, viaVoice (preserved), deep (preserved) ]
     Returned as { question, viaVoice, deep } so the harness can
     assert each argument separately. Returns null when there is no
     question to re-ask (mirrors the live Retry guard `if(m.question)`
     and the Regenerate button only rendering when m.question exists).
     The two functions are separate on purpose: Regenerate and Retry
     Search are two different buttons at two different live sites,
     and each must be testable on its own. Their argument rule is
     identical by design — only the call site differs.
     ------------------------------------------------------------------ */
  function regenArgs(m, chat){
    if(!m || !m.question) return null;
    return { question: m.question, viaVoice: resolveViaVoice(m, chat), deep: !!m.deep };
  }

  function retryArgs(m, chat){
    if(!m || !m.question) return null;
    return { question: m.question, viaVoice: resolveViaVoice(m, chat), deep: !!m.deep };
  }

  /* ==================================================================
     PATCH FUNCTIONS — FIX 1. For the assembler to INLINE at the exact
     live sites listed. Each one calls askQuestion with the preserved
     voice flag and returns the args object it passed (null when there
     was no question to re-ask). askFn defaults to the live page
     global askQuestion; the harness passes a recording stub.
     The `state.isGenerating` guard and the toast('Wait for the
     current answer to finish') stay at the live call site, unchanged
     — these functions only replace the askQuestion(...) call itself.
     ================================================================== */

  /* PATCH R1 — Regenerate button.
     INLINE at live L5632 (live renderer) and L5760 (legacy renderer):
       BEFORE: askQuestion(m.question, false, !!m.deep);
       AFTER:  EnzoVoiceFix43.patchRegenerate(m, cNow);
     (cNow is already in scope in buildMessageEl — L5545
     `var cNow = activeChat();`. In the legacy renderer there is no
     cNow; pass the chat the same way its caller holds it, or omit
     it — resolveViaVoice then falls back to activeChat().) */
  function patchRegenerate(m, chat, askFn){
    var args = regenArgs(m, chat);
    if(!args) return null;
    var ask = askFn;
    if(typeof ask !== 'function' && root && typeof root.askQuestion === 'function') ask = root.askQuestion;
    if(typeof ask === 'function') ask(args.question, args.viaVoice, args.deep);
    return args;
  }

  /* PATCH R2 — Retry Search button.
     INLINE at live L5635 (live renderer) and L5764 (legacy renderer):
       BEFORE: if(m.question) askQuestion(m.question, false, !!m.deep);
       AFTER:  EnzoVoiceFix43.patchRetrySearch(m, cNow);
     ALSO fix the misleading comment at L5634 and L5762-L5763:
       BEFORE: "Retry re-runs the question in the SAME mode it was
                originally asked in" (only deep was preserved)
       AFTER:  "Retry re-runs the question in the SAME mode it was
                originally asked in — a Deep Research question retries
                as Deep Research, never as Normal, and a voice
                question retries as voice, never as text-only."
     `deep` is untouched by this patch. */
  function patchRetrySearch(m, chat, askFn){
    var args = retryArgs(m, chat);
    if(!args) return null;
    var ask = askFn;
    if(typeof ask !== 'function' && root && typeof root.askQuestion === 'function') ask = root.askQuestion;
    if(typeof ask === 'function') ask(args.question, args.viaVoice, args.deep);
    return args;
  }

  /* ------------------------------------------------------------------
     readVolume(state, deps) — where the current volume comes from,
     in priority order. The live page has exactly one source of
     truth: state.voiceVolume (set by the Settings slider L7933 and
     the per-answer sliders L5614/L5742, read by speakText L7594).
     A caller may override it with deps.volume (harness) or
     deps.getVolume() (a custom reader). A stored slider value of 0
     is a real 0 — parseFloat('0')||1 would wrongly turn it into 1,
     so this function never uses || fallbacks on the parsed number.
     Returns NaN when no volume can be read at all (unknown — the
     caller must NOT toast on unknown, only on a known 0).
     ------------------------------------------------------------------ */
  function readVolume(state, deps){
    var d = deps || {};
    var v;
    if(typeof d.volume !== 'undefined' && d.volume !== null){
      v = parseFloat(d.volume);
      if(!isNaN(v)) return v;
    }
    if(typeof d.getVolume === 'function'){
      try{
        v = parseFloat(d.getVolume());
        if(!isNaN(v)) return v;
      }catch(e){}
    }
    if(state && typeof state.voiceVolume !== 'undefined' && state.voiceVolume !== null){
      v = parseFloat(state.voiceVolume);
      if(!isNaN(v)) return v;
    }
    if(typeof document !== 'undefined' && document && typeof document.getElementById === 'function'){
      try{
        var el = document.getElementById('voiceVolume');
        if(el && typeof el.value !== 'undefined'){
          v = parseFloat(el.value);
          if(!isNaN(v)) return v;
        }
      }catch(e){}
    }
    return NaN;
  }

  /* ------------------------------------------------------------------
     wouldAutoSpeak(msg, deps) — would this answer be auto-spoken if
     the volume were up? True only when the message carries readable
     text AND was asked by voice. Typed questions never auto-speak,
     so they never get the toast either (a typed user with volume 0
     has nothing to be warned about). When the v54 funnel is present
     on the live page, its wantsTextReply override is honoured too:
     an explicit "reply in text" request means no speak, hence no
     toast. The check is guarded — without the v54 global the
     override is simply skipped, never assumed.
     ------------------------------------------------------------------ */
  function wouldAutoSpeak(msg, deps){
    if(!msg) return false;
    var plain = msg.plain || msg.text || '';
    if(!plain) return false;
    if(!msg.viaVoice) return false;
    if(msg.question && root && root.EnaoV54Voice && typeof root.EnaoV54Voice.wantsTextReply === 'function'){
      try{
        if(root.EnaoV54Voice.wantsTextReply(msg.question)) return false;
      }catch(e){}
    }
    if(deps && typeof deps.wantsTextReply === 'function'){
      try{
        if(deps.wantsTextReply(msg.question)) return false;
      }catch(e){}
    }
    return true;
  }

  /* ==================================================================
     PATCH FUNCTION — FIX 2. For the assembler to wire at the
     auto-speak decision point: inside the v54 funnel path
     (speakIfVoice, live L47811) or its maybeSpeak fallback, right
     where the decision to speak has been made and before speakText
     runs — i.e. call it wherever shouldAutoSpeak(msg, mode) has
     just returned true:
       EnzoVoiceFix43.checkVolumeBeforeSpeak(msg, state);
     It never speaks, never blocks speech, and never changes the
     volume. It only shows the toast (once per answer) and reports
     back so the caller — and any log — knows the answer will be
     silent despite the speak attempt:
       { wouldSpeak, volumeZero, toasted }
       wouldSpeak  — this answer would be auto-spoken (voice-in,
                     readable text, no text-reply override).
       volumeZero  — wouldSpeak AND the volume is a known 0.
       toasted     — this call actually showed the toast (false on
                     a repeat call for the same answer, or when
                     there was nothing to warn about).
     Toast delivery: deps.toast when passed (harness), else the live
     page global toast(msg) (live L5209). If no toast function
     exists at all, volumeZero is still reported honestly and
     toasted stays false — the signal never depends on the toast.
     ================================================================== */
  function checkVolumeBeforeSpeak(msg, state, deps){
    var d = deps || {};
    var result = { wouldSpeak: false, volumeZero: false, toasted: false };
    if(!wouldAutoSpeak(msg, d)) return result;
    result.wouldSpeak = true;
    var vol = readVolume(state, d);
    if(isNaN(vol) || vol !== 0) return result;
    result.volumeZero = true;
    if(alreadyVolumeToasted(msg)) return result;
    markVolumeToastSeen(msg);
    var showToast = null;
    if(typeof d.toast === 'function') showToast = d.toast;
    else if(root && typeof root.toast === 'function') showToast = root.toast;
    if(showToast){
      try{ showToast(VOLUME_ZERO_TOAST); result.toasted = true; }catch(e){}
    }
    return result;
  }

  var EnzoVoiceFix43 = {
    VERSION: VERSION,
    VOLUME_ZERO_TOAST: VOLUME_ZERO_TOAST,
    viaVoiceFromChat: viaVoiceFromChat,
    resolveViaVoice: resolveViaVoice,
    regenArgs: regenArgs,
    retryArgs: retryArgs,
    patchRegenerate: patchRegenerate,
    patchRetrySearch: patchRetrySearch,
    wouldAutoSpeak: wouldAutoSpeak,
    checkVolumeBeforeSpeak: checkVolumeBeforeSpeak,
    resetVolumeToastSeen: resetVolumeToastSeen
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoVoiceFix43 = EnzoVoiceFix43;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoVoiceFix43;

})(typeof window !== 'undefined' ? window : this);
