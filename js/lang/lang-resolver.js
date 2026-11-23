
'use strict';
/* 44-lang-resolver.js — SPEC P1: the SINGLE language resolver (ENZO 4-language set).
 *
 * Implements LANGUAGE-SPEC.md §3 P1 exactly. Every other piece (45/46/47)
 * and the answer path must call resolveAnswerLang() here — do NOT build
 * another detector and do NOT call legacy detectLang for the answer path.
 *
 * ES5, UMD/IIFE. Exposes window.EnzoLang44 in the browser and
 * module.exports in Node. Pure function: no DOM, no network, no side
 * effects (the only read is the stored preference, via an injectable
 * opts.getSetting with a live-page default that reads localStorage).
 * Zero emojis.
 *
 * Return vocabulary (exact, per spec §0):
 *   en | urdu | roman | punjabi | roman-punjabi
 * plus 'hindi' (Devanagari) when detected — kept as-is, never surfaced
 * in Settings, never a valid fixed setting value.
 *
 * Consumer mapping (implemented by the consumer pieces, NOT here):
 *   - Answer prompt (P2, langInstrFor): 'punjabi' -> Shahmukhi-only
 *     instruction; 'roman-punjabi' -> Roman Punjabi instruction;
 *     'urdu'/'roman'/'en' -> their existing instructions.
 *   - TTS lang (P3, TTS_LANG): en->en-US, urdu->ur-PK, roman->ur-PK,
 *     punjabi->pa-PK, roman-punjabi->pa-PK, hindi->hi-IN.
 *   - Clarify strings (P4, CLARIFY_T): every reason group has a
 *     'roman-punjabi' entry; 'punjabi' uses the existing Shahmukhi
 *     templates; the other codes use their existing templates.
 *   - Settings (P5): stored under key 'enao_lang'; valid values
 *     auto/en/urdu/roman/punjabi/roman-punjabi. Unknown stored value
 *     falls back to 'auto'.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EnzoLang44 = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {

  /* ---- Canonical vocabularies (spec §0 + §3 P1) ---- */
  var LANGS = ['en', 'urdu', 'roman', 'punjabi', 'roman-punjabi', 'hindi'];
  /* Valid fixed-setting values (spec §3 P5b). 'auto' is not a language;
   * 'hindi' is deliberately NOT a setting value. */
  var SETTING_VALUES = ['auto', 'en', 'urdu', 'roman', 'punjabi', 'roman-punjabi'];
  var SETTING_KEY = 'enao_lang';

  /* ---- v61 detectLanguage — copied VERBATIM from enao-ai.html L737 area.
   * Do not re-implement differently; do not extend. ---- */
  var ROMAN_MARKER_RE = /\b(kya|kia|hai|hain|karo|kar|karke|batao|samjhao|kaam|kidhar|kahan|kab|tum|aap|mera|meri|mujhe|mujhay|ye|yeh|wo|woh|matlab|baare|bare|mein|nahi|nahin|abhi|aur|bhi|zara|theek|chahiye|dhoond\w*|dhund\w*|talaash|talash|khoj|dakho|dikha\w*|dekh\w*|nikaal\w*|nikal\w*|kasy|kaise|kaisy|karty|karte|par|pe|ko|ki|ke|ka|tha|thi|wala|wali|kahan|kidhar|kisko|kaunsa|konsa|kyun|kyu|kaisa|aj|kal|bohat|acha|achi|jaldi|bhai|yaar|shodh|tehqeeq|tahqeeq|jaanch|taftish|naye|naya|sab|acha|bata|labho|vekho|tusi|tussi|se|seekho|sikho|faida|uthao|nazarandaz)\b/i;
  var SHAHMUKHI_PUNJABI_RE = /لبھو|ویکھو|چھڈو|چکو|وکھ|توں|تسی|تواڈا|ایس\s+دے|پاسے|(?:^|\s)(وچ|نال|دا|وی|تے)(?:\s|$|[؟۔،؛!?.])/;

  function hasUrdu(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }
  function hasDevanagari(s) { return /[\u0900-\u097F]/.test(String(s || '')); }

  function detectLanguage(text) {
    var raw = String(text || '');
    if (hasUrdu(raw)) {
      if (SHAHMUKHI_PUNJABI_RE.test(raw)) return 'punjabi';
      return 'urdu';
    }
    if (hasDevanagari(raw)) return 'hindi';
    if (ROMAN_MARKER_RE.test(raw)) return 'roman';
    return 'en';
  }

  /* ---- P1 refinement: 'roman' -> 'roman-punjabi' (spec §3 P1 step 3).
   * Exact marker list from the spec. Shared words (karo, hai, mera)
   * are deliberately NOT in this list. ---- */
  var ROMAN_PUNJABI_RE = /\b(labho|vekho|tusi|tussi|dasso|daso|kiddan|kidda|kive|kiwen|mainu|tainu|tuhanu|tuhada|twada|saada|changa)\b|ki haal/i;

  function isRomanPunjabi(text) {
    return detectLanguage(text) === 'roman' && ROMAN_PUNJABI_RE.test(String(text || ''));
  }

  /* Canonical code for a detected value: 'roman' + Roman Punjabi markers. */
  function canonicalDetected(text) {
    if (isRomanPunjabi(text)) return 'roman-punjabi';
    return detectLanguage(text);
  }

  /* ---- P1 normaliseLang: maps legacy values to canonical codes. ---- */
  function normaliseLang(code) {
    if (code === 'ur') return 'urdu';
    if (code === 'english') return 'en';
    if (code === 'pa') return 'punjabi';
    if (LANGS.indexOf(code) !== -1) return code;
    return 'en';
  }

  /* ---- Live-page default: read the stored preference (spec §3 P5b).
   * Key 'enao_lang'. Never throws; missing storage / missing key -> 'auto'.
   * Testability: pass opts.getSetting to override this. ---- */
  function defaultGetSetting() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
        var v = localStorage.getItem(SETTING_KEY);
        return v == null ? 'auto' : String(v);
      }
    } catch (e) { /* storage unavailable (e.g. Node) -> auto */ }
    return 'auto';
  }

  /* ---- P1 resolver: THE SINGLE resolver every other piece must use.
   *
   * resolveAnswerLang(question, opts)
   *   question: the user's question text (string; null/undefined tolerated).
   *   opts: either
   *     - a string: the fixed preference ('auto' | 'en' | 'urdu' | 'roman'
   *       | 'punjabi' | 'roman-punjabi'), spec-style resolveAnswerLang(text, pref);
   *     - an object: { pref | setting, getSetting, detectLanguage }
   *       * pref / setting: explicit preference string (wins over getSetting).
   *       * getSetting: function () -> stored preference string.
   *       * detectLanguage: injectable v61-compatible detector
   *         function (text) -> 'urdu'|'punjabi'|'hindi'|'roman'|'en'.
   *     - omitted/null: preference read via the live-page default
   *       (localStorage 'enao_lang', else 'auto').
   *
   * Behaviour (spec §3 P1, steps 1-5):
   *   1. Fixed pref (one of en|urdu|roman|punjabi|roman-punjabi) wins over
   *      detection — even for short/greeting/empty text.
   *   2. Else (auto / missing / invalid): detect with the injected
   *      detector if given, else the in-file v61 detectLanguage.
   *      NEVER legacy detectLang.
   *   3. 'roman' + a distinctive Roman Punjabi marker -> 'roman-punjabi'.
   *   4. 'hindi' is kept as-is.
   *   5. Empty/whitespace text -> fixed pref if set, else 'en'.
   */
  function resolveAnswerLang(question, opts) {
    var pref;
    var detectFn = detectLanguage;
    if (typeof opts === 'string') {
      pref = opts;
    } else if (opts && typeof opts === 'object') {
      if (typeof opts.detectLanguage === 'function') detectFn = opts.detectLanguage;
      if (opts.pref != null) {
        pref = String(opts.pref);
      } else if (opts.setting != null) {
        pref = String(opts.setting);
      } else if (typeof opts.getSetting === 'function') {
        try { pref = String(opts.getSetting()); } catch (e) { pref = 'auto'; }
      } else {
        pref = defaultGetSetting();
      }
    } else {
      pref = defaultGetSetting();
    }
    if (pref == null) pref = 'auto';
    pref = String(pref);
    /* Step 1: fixed setting wins (invalid values fall through to Auto). */
    if (SETTING_VALUES.indexOf(pref) !== -1 && pref !== 'auto') return pref;
    /* Step 5: empty/whitespace text, no fixed pref -> 'en'. */
    if (!String(question || '').trim()) return 'en';
    /* Steps 2-4: v61 detection, then the Roman Punjabi refinement. */
    var d;
    try {
      d = detectFn(question);
    } catch (e) {
      d = detectLanguage(question);
    }
    d = normaliseLang(d);
    if (d === 'roman' && ROMAN_PUNJABI_RE.test(String(question || ''))) return 'roman-punjabi';
    return d;
  }

  /* Spec-style alias: resolveLanguage(text, pref) — same behaviour. */
  function resolveLanguage(text, pref) {
    return resolveAnswerLang(text, pref);
  }

  return {
    LANGS: LANGS,
    SETTING_VALUES: SETTING_VALUES,
    SETTING_KEY: SETTING_KEY,
    ROMAN_MARKER_RE: ROMAN_MARKER_RE,
    SHAHMUKHI_PUNJABI_RE: SHAHMUKHI_PUNJABI_RE,
    ROMAN_PUNJABI_RE: ROMAN_PUNJABI_RE,
    detectLanguage: detectLanguage,
    isRomanPunjabi: isRomanPunjabi,
    canonicalDetected: canonicalDetected,
    normaliseLang: normaliseLang,
    resolveAnswerLang: resolveAnswerLang,
    resolveLanguage: resolveLanguage
  };
}));
