
/* ============================================================================
   ENAO AI — Piece 45: answer-language wiring (LANGUAGE-SPEC.md P2)
   File: 45-lang-answer.js
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines,
   meta v61-deep-triggers-4lang). DO NOT deploy from this file alone;
   the coordinator assembles and deploys it. Do NOT edit the artifact
   from this piece. Do NOT deploy. Zero emojis.

   ORDER (Raja, 22 Nov 2026 ~6:49 PM PKT): ENZO must answer in the SAME
   language as the question — English, Urdu script, Roman Urdu, Punjabi
   (Shahmukhi / Roman) — text AND voice.

   WHAT THIS PIECE FIXES (spec P2 only; nothing else)
   P2a. ask-path language resolution: `askQuestion` (live L7114) and
        `backendAsk` (live L16145) must resolve the language ONCE per
        question via piece 44's `resolveAnswerLang` and carry it on the
        message (`lang`) and in the ask body (`lang` field) — replacing
        the legacy `detectLang` call on the ANSWER path only.
        `detectLang` itself is left untouched (spec section 4).
   P2b. `langInstrFor` (live L6543-6547): no Punjabi branch — a Punjabi
        question fell through to "Answer ONLY in simple, clear
        English." This piece adds the spec's exact Punjabi and
        Roman-Punjabi instruction strings BEFORE the default return.
        The existing Urdu / Roman strings are kept verbatim; `hindi`
        keeps the existing fallback (out of scope, spec P2b).
   P2c. `localizeAnswer` (live L15873-15883): handled only `urdu` /
        `roman`. This piece adds `punjabi` / `roman-punjabi` branches
        via the same `rewriteInLang` helper the `roman` branch uses,
        falling back to the original text on failure — exactly like the
        `roman` branch. `en` / `hindi` return as-is.
   P2d. `backendAsk` ask body (live L16188): adds flat `lang: lang`
        alongside `question`, `deep`, `via_voice`. The only other
        `v2post('/chats/` call sites are file summarize/compare
        (L16178/L16183) — no ask body there, so no second ask call
        site exists (L26394 is a comment, per spec).
   P2e. `romanToEnglish` / ROMAN_MAP (live L6036): adds the spec's
        Punjabi entries so `enQ` (English meaning for the prompt)
        works for Punjabi questions. Existing Roman Urdu entries are
        never overwritten.
   P2f. `langLabel` (live L5282): adds `'Punjabi (Shahmukhi)'` for
        `punjabi` and `'Roman Punjabi'` for `roman-punjabi`.
        `saveChats` default (live L5190): a message with no recorded
        language must no longer default to `'roman'` — default is
        `'en'` (`defaultMessageLang()`).

   DEPENDENCY — PIECE 44 (`44-lang-resolver.js`, `resolveAnswerLang`):
   piece 44 did NOT exist yet when this piece was built (pieces/ held
   only 42/43). This piece consumes it through `getResolver()`, which
   looks up `window.EnzoLang44.resolveAnswerLang` (browser) or the
   Node-injected resolver. The coordinator MUST assemble piece 44
   before / alongside this piece: without it, `resolveAskLang` falls
   back to the legacy `detectLang` supplied by the caller (degraded
   path — Punjabi is never detected there, the exact gap P2a closes),
   and the harness asserts that degraded path is labelled as such.
   This piece invents NO detector of its own (spec section 4).

   ASSEMBLY NOTES (for the coordinator, not live edits here)
   - Replace live `langInstrFor` (L6543-6547) with `langInstrFor`
     from this piece, verbatim.
   - In `askQuestion` (L7114) replace `var lang = detectLang(text);`
     with `var lang = EnzoLang45.resolveAskLang(text, state.langPref,
     detectLang);` — and in `backendAsk` (L16145) replace
     `var lang=detectLang(text);` with the same call. Every later
     `lang:lang` message field then carries the resolved code; no
     other message-plumbing change is needed (spec P2a).
   - In `backendAsk` (L16188) add `lang: lang` to the ask body via
     `EnzoLang45.buildAskBody(body, lang)` (or the equivalent one-line
     edit: `{question:qText55, deep:route.deep, via_voice:!!viaVoice,
     lang:lang, preferences:...}`).
   - Replace live `localizeAnswer` (L15873-15883) with the
     `localizeAnswer` from this piece, passing the live globals
     (`myMemoryUrdu`, `rewriteInLang`) as `deps`.
   - Merge `ROMAN_PUNJABI_ENTRIES` into `ROMAN_MAP` with
     `EnzoLang45.mergeRomanMap(ROMAN_MAP)` (adds only missing keys).
   - Replace live `langLabel` (L5275) with `langLabel` from this
     piece; change the `saveChats` default `m.lang||'roman'` to
     `m.lang||EnzoLang45.defaultMessageLang()`.
   - The backend half of P2 (P2g–P2j) lives in
     `pieces/45-p2-backend/` (patched copies + CHANGES.md) — it is NOT
     applied by this JS file.

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies).
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EnzoLang45 = api;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* Canonical language codes (LANGUAGE-SPEC.md section 0). */
  var LANG_CODES = ['en', 'urdu', 'roman', 'punjabi', 'roman-punjabi', 'hindi'];

  var LANG_NAMES = {
    'en': 'English',
    'urdu': 'Urdu script',
    'roman': 'Roman Urdu',
    'punjabi': 'Punjabi in Shahmukhi script',
    'roman-punjabi': 'Roman Punjabi',
    'hindi': 'Hindi'
  };

  function isCanonical(code) {
    return LANG_CODES.indexOf(code) !== -1;
  }

  /* ------------------------------------------------------------------
     P2b. langInstrFor — replacement for live L6543-6547.
     Punjabi / Roman Punjabi strings are the spec's EXACT strings
     (LANGUAGE-SPEC.md P2b), verbatim. Urdu / Roman strings are the
     live v61 strings, verbatim. `hindi` keeps the existing fallback
     (out of scope, spec P2b). A Punjabi question must NEVER fall
     through to the English instruction again.
     ------------------------------------------------------------------ */
  function langInstrFor(lang) {
    if (lang === 'urdu') return 'Answer ONLY in Urdu script (clear, Nastaliq-friendly Urdu). Never switch to English except names/terms.';
    if (lang === 'roman') return 'Answer ONLY in Roman Urdu — Urdu written in English letters, warm, easy and friendly, like explaining to a close friend. NEVER answer in English sentences and NEVER in Urdu script. Example style: "Dekhein, is sawal ka seedha jawab ye hai ke..."';
    if (lang === 'punjabi') return 'Answer ONLY in Punjabi written in Shahmukhi (Urdu script) — the Punjabi Raja speaks at home. Never answer in English and never in Roman letters except names/terms.';
    if (lang === 'roman-punjabi') return 'Answer ONLY in Roman Punjabi — Punjabi written in English letters, warm and easy, like talking to a close friend. NEVER answer in English sentences and NEVER in Urdu script.';
    return 'Answer ONLY in simple, clear English.';
  }

  /* ------------------------------------------------------------------
     P2a. Ask-path wiring — resolve ONCE per question, carry everywhere.
     ------------------------------------------------------------------ */

  /* Piece-44 dependency: `resolveAnswerLang(question, opts)` returning
     one of en/urdu/roman/punjabi/roman-punjabi (or 'hindi'). Looked up
     at call time so assembly order (44 before 45) is all that matters.
     `injected` lets the Node harness supply a stub resolver. */
  function getResolver(injected) {
    if (injected && typeof injected === 'function') return injected;
    try {
      if (typeof window !== 'undefined' && window.EnzoLang44 &&
          typeof window.EnzoLang44.resolveAnswerLang === 'function') {
        return window.EnzoLang44.resolveAnswerLang;
      }
      if (typeof global !== 'undefined' && global.EnzoLang44 &&
          typeof global.EnzoLang44.resolveAnswerLang === 'function') {
        return global.EnzoLang44.resolveAnswerLang;
      }
    } catch (e) { /* resolver lookup must never throw */ }
    return null;
  }

  /* Resolve the answer language for one question, exactly once.
     - With piece 44 present: `resolveAnswerLang(text, {pref: pref})`.
     - Without it (DEGRADED, documented): fall back to the caller's
       legacy `detectLang` if supplied, then normalise to a canonical
       code, defaulting to 'en'. This fallback is NOT a new detector —
       it is the old path, kept only so the ask still works until
       piece 44 is assembled. Punjabi is never detected on it.
     Returns {lang, degraded} — `degraded` is true only on the
     legacy fallback, so callers/tests can tell the two apart. */
  function resolveAskLang(text, pref, legacyDetect, injectedResolver) {
    var resolver = getResolver(injectedResolver);
    if (resolver) {
      var lang = null;
      try { lang = resolver(text, { pref: pref }); } catch (e) { lang = null; }
      if (typeof lang === 'string' && isCanonical(lang)) {
        return { lang: lang, degraded: false };
      }
      /* Resolver returned something unusable: fall through to legacy. */
    }
    var legacy = null;
    if (typeof legacyDetect === 'function') {
      try { legacy = legacyDetect(text); } catch (e) { legacy = null; }
    }
    if (typeof legacy === 'string' && isCanonical(legacy)) {
      return { lang: legacy, degraded: true };
    }
    return { lang: 'en', degraded: true };
  }

  /* Convenience for the ask call sites: just the code, resolved once.
     `askQuestion` / `backendAsk` call this ONCE and reuse the result
     for the message `lang` field and the ask body. */
  function askLang(text, pref, legacyDetect, injectedResolver) {
    return resolveAskLang(text, pref, legacyDetect, injectedResolver).lang;
  }

  /* ------------------------------------------------------------------
     P2d. Ask body — add the flat `lang` field. Does not mutate the
     input body; returns a shallow copy with `lang` set.
     ------------------------------------------------------------------ */
  function buildAskBody(body, lang) {
    var out = {};
    var k;
    if (body) {
      for (k in body) {
        if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
      }
    }
    out.lang = lang;
    return out;
  }

  /* ------------------------------------------------------------------
     P2c. localizeAnswer — extension of live L15873-15883.
     `deps` defaults to the live globals (myMemoryUrdu, rewriteInLang);
     the harness injects stubs. Behaviour per language:
     - en / hindi: return text as-is (unchanged).
     - urdu: myMemoryUrdu, falling back to rewriteInLang('urdu'),
       falling back to the original text — exactly the live branch.
     - roman: rewriteInLang('roman'), falling back to the original
       text — exactly the live branch.
     - punjabi: rewriteInLang('punjabi'), falling back to the
       original text — exactly like the `roman` branch (spec P2c).
     - roman-punjabi: rewriteInLang('roman-punjabi'), same fallback.
     Always returns a Promise; never rejects on a helper failure.
     ------------------------------------------------------------------ */
  function localizeAnswer(text, lang, deps) {
    var d = deps || {};
    var myMemoryUrdu = d.myMemoryUrdu ||
      (typeof window !== 'undefined' ? window.myMemoryUrdu : null) ||
      (typeof global !== 'undefined' ? global.myMemoryUrdu : null);
    var rewriteInLang = d.rewriteInLang ||
      (typeof window !== 'undefined' ? window.rewriteInLang : null) ||
      (typeof global !== 'undefined' ? global.rewriteInLang : null);
    function asIs() { return Promise.resolve(text); }
    function fallback() { return text; }
    function rewrite(code) {
      if (typeof rewriteInLang !== 'function') return Promise.resolve(text);
      try {
        return Promise.resolve(rewriteInLang(text, code))
          .catch(function () { return text; });
      } catch (e) {
        return Promise.resolve(text);
      }
    }
    if (!text || lang === 'en' || lang === 'english' || lang === 'hindi') {
      return asIs();
    }
    if (lang === 'urdu') {
      if (typeof myMemoryUrdu !== 'function') return rewrite('urdu');
      try {
        return Promise.resolve(myMemoryUrdu(text))
          .catch(function () { return rewrite('urdu'); })
          .catch(function () { return text; });
      } catch (e) {
        return rewrite('urdu');
      }
    }
    if (lang === 'roman') return rewrite('roman');
    if (lang === 'punjabi') return rewrite('punjabi');
    if (lang === 'roman-punjabi') return rewrite('roman-punjabi');
    return asIs();
  }

  /* ------------------------------------------------------------------
     P2e. Punjabi entries for ROMAN_MAP (live L6036) so `enQ` works
     for Punjabi questions. Spec's exact entries, nothing else.
     mergeRomanMap adds ONLY keys that are missing — existing Roman
     Urdu entries are never overwritten (spec P2e).
     ------------------------------------------------------------------ */
  var ROMAN_PUNJABI_ENTRIES = {
    'vekho': 'see/look',
    'labho': 'find',
    'tusi': 'you',
    'tussi': 'you',
    'dasso': 'tell',
    'kiddan': 'how',
    'mainu': 'me',
    'tuhanu': 'you',
    'changa': 'good',
    'ki': 'what',
    'kive': 'how'
  };

  function mergeRomanMap(map) {
    var out = {};
    var k;
    if (map) {
      for (k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) out[k] = map[k];
      }
    }
    for (k in ROMAN_PUNJABI_ENTRIES) {
      if (Object.prototype.hasOwnProperty.call(ROMAN_PUNJABI_ENTRIES, k) &&
          !Object.prototype.hasOwnProperty.call(out, k)) {
        out[k] = ROMAN_PUNJABI_ENTRIES[k];
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
     P2f. langLabel — replacement for live L5275. 'Punjabi' is never
     bare: Shahmukhi is 'Punjabi (Shahmukhi)', Roman is 'Roman Punjabi'.
     defaultMessageLang — replacement for the `saveChats` default
     (live L5190 `m.lang||'roman'`): a message with no recorded
     language must not be assumed Roman Urdu.
     ------------------------------------------------------------------ */
  function langLabel(l) {
    if (l === 'urdu') return 'Urdu Script';
    if (l === 'roman') return 'Roman Urdu';
    if (l === 'punjabi') return 'Punjabi (Shahmukhi)';
    if (l === 'roman-punjabi') return 'Roman Punjabi';
    return 'English';
  }

  function defaultMessageLang() {
    return 'en';
  }

  return {
    LANG_CODES: LANG_CODES,
    LANG_NAMES: LANG_NAMES,
    langInstrFor: langInstrFor,
    getResolver: getResolver,
    resolveAskLang: resolveAskLang,
    askLang: askLang,
    buildAskBody: buildAskBody,
    localizeAnswer: localizeAnswer,
    ROMAN_PUNJABI_ENTRIES: ROMAN_PUNJABI_ENTRIES,
    mergeRomanMap: mergeRomanMap,
    langLabel: langLabel,
    defaultMessageLang: defaultMessageLang
  };
});
