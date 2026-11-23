
/* ============================================================================
   ENAO AI P48 — Settings language preference UI (48-lang-settings.js)
   Artifact slug: enao-ai, web_static. Built against live v61
   (~/workspace/your_files/enao-ai/enao-ai.html, 48,870 lines,
   meta v61-deep-triggers-4lang). DO NOT deploy from this file alone;
   the coordinator assembles and deploys it. Do NOT edit the artifact
   from this piece.

   SPEC: ~/workspace/enao-voice-fix/LANGUAGE-SPEC.md, section P5
   (Language Spec, order Raja 22 Nov 2026 ~6:49 PM PKT:
   "ENZO ki language set ho jaye — English, Urdu, Roman Urdu aur
   Punjabi.") This piece implements P5 and nothing else.

   DEFECT (spec G5/G6, audit 22 Nov 2026 ~6:50 PM PKT):
   - `enao_lang` is loaded (live L8603), saved (live L8612) and
     displayed (live L8592) — and NEVER read anywhere else in the
     48,870 lines. The setting currently does nothing.
   - The Settings select (live L4843) offers only
     auto / roman / urdu / en — no Punjabi.

   WHAT THIS PIECE DOES (P5a–P5e)
   P5a. The select offers Auto + the four fixed languages:
        auto / en / urdu / roman / punjabi / roman-punjabi, with the
        spec's exact values and labels. The option list is built from
        LANG_OPTIONS, so the select cannot drift from the allowed set.
   P5b. Storage key stays `enao_lang` (do NOT rename — existing users'
        saved `auto` must keep working). Values `punjabi` /
        `roman-punjabi` are new. An unknown stored value falls back
        to `auto` (validated on load).
   P5c. Wiring (the actual fix for G5): the load path (L8603) uses
        getLangSetting() validation; the save path (L8612) uses
        setLangSetting() validation. `askQuestion` L7114 and
        `backendAsk` L16145 already read `state.langPref` via P2a
        (piece 44, resolveAnswerLang) — that IS the wiring. This piece
        only makes the stored value trustworthy and the select complete.
   P5d. Settings description line (live L4842) becomes the spec text.
   P5e. Voice picker note (live L18005) becomes the spec text.

   WHAT THIS PIECE DOES NOT DO
   - It does NOT change what Auto means. Auto = "match the question's
     language" is the resolver's job (piece 44, `resolveAnswerLang`).
   - It does NOT change any other Setting, and does NOT rename the key.
   - It does NOT read the question language itself, and does NOT
     decide any answer language. It only stores and validates the
     user's preference.
   - It does NOT add `hindi` to Settings (spec section 0: Hindi is
     kept where it exists, never surfaced in Settings).

   HOW A CHANGE TAKES EFFECT WITHOUT A RELOAD (P5c / task item 3d)
   The save path (patchSaveLangPref, live L8612) writes the validated
   value to `enao_lang` AND updates `state.langPref` in the same
   handler. The next question's answer path (P2a) calls
   `resolveAnswerLang(text, state.langPref)`, so it sees the new
   preference immediately — no reload, no re-read of storage needed.
   The resolver (piece 44) may ALSO read the key live per question
   with getLangSetting() — see getEffectivePref() below — which reads
   localStorage on every call, so even a value written outside the
   Settings modal (another tab, the console) is picked up by the very
   next question. Either route gives the same value, because both
   validate against the same allowed set.

   DEPENDENCY
   Piece 44 (`44-lang-resolver.js`, `resolveAnswerLang`) does NOT exist
   yet in ~/workspace/enao-voice-fix/pieces/ at build time. This piece
   is coded against its spec'd interface only: the resolver takes
   (text, pref) where pref is one of the LANG_OPTIONS values (or
   'auto'), and returns the answer language. This piece guarantees
   that every value it can ever hand the resolver is one of those
   values. No code in this file calls the resolver.

   LIVE ANCHORS (verified by grep against the live v61 file)
   - Settings select ............................ L4843
   - Settings description span ................. L4842
   - Display in refreshSettingsUI .............. L8592
     `var lp=$('langPref'); if(lp) lp.value=state.langPref;`
   - Load ...................................... L8603
     `state.langPref=loadPref('enao_lang','auto');`
   - Save (saveSettings onclick) ............... L8612
     `state.langPref=$('langPref').value; savePref('enao_lang', state.langPref);`
   - loadPref / savePref (localStorage wrappers)  L4998 / L4999
   - Voice picker note (JS-built voice pane) ... L18005

   STYLE: plain ES5, var + function declarations, no modules, no new
   dependencies. The only export tail is a guarded window assignment
   plus a module.exports assignment so the Node harness can load this
   exact file (the file itself has no dependencies). Zero emojis.
   ========================================================================== */
(function(root){
  'use strict';

  var VERSION = '48-lang-settings';

  /* Storage key — unchanged from live v61. Do NOT rename. */
  var LANG_KEY = 'enao_lang';
  var DEFAULT_LANG = 'auto';

  /* P5a — the option list, in the spec's order, with the spec's exact
     values and labels. `hindi` is deliberately absent (spec section 0:
     never surfaced in Settings). */
  var LANG_OPTIONS = [
    { value: 'auto',          label: "Auto — question's language" },
    { value: 'en',            label: 'English' },
    { value: 'urdu',          label: 'Urdu Script' },
    { value: 'roman',         label: 'Roman Urdu' },
    { value: 'punjabi',       label: 'Punjabi (Shahmukhi)' },
    { value: 'roman-punjabi', label: 'Roman Punjabi' }
  ];

  /* P5d — Settings description line (live L4842). Exact spec text. */
  var SETTINGS_DESCRIPTION =
    'Auto follows the language of your question — English, Urdu, ' +
    'Roman Urdu or Punjabi. Pick one language to always answer in ' +
    'that language.';

  /* P5e — voice picker note (live L18005). Exact spec text. The old
     sentence it replaces is kept here so the patch can find it. */
  var VOICE_PICKER_NOTE_OLD =
    '\u201CAutomatic\u201D picks the best voice for each language.';
  var VOICE_PICKER_NOTE_NEW =
    '\u201CAutomatic\u201D picks the best voice for each language on ' +
    'this device. If this device has no voice for a language, ENZO ' +
    'says so and uses the closest voice.';

  /* --- storage access ------------------------------------------------- */

  /* Resolve a storage object: an explicit one (harness / assembler),
     else the page's localStorage, else null (no storage available —
     treated as "missing key" everywhere, never an exception). */
  function resolveStorage(storage){
    if(storage && typeof storage.getItem === 'function' &&
       typeof storage.setItem === 'function') return storage;
    try{
      if(typeof localStorage !== 'undefined' && localStorage) return localStorage;
    }catch(e){}
    return null;
  }

  function readStored(storage){
    var s = resolveStorage(storage);
    if(!s) return null;
    try{
      var v = s.getItem(LANG_KEY);
      return (typeof v === 'string') ? v : null;
    }catch(e){
      return null;
    }
  }

  /* --- validation (P5b) ----------------------------------------------- */

  /* True only for one of the six allowed values, exactly as stored
     (case-sensitive; 'EN', 'Punjabi', 'french' are all invalid). */
  function isValidLangSetting(v){
    var i;
    if(typeof v !== 'string') return false;
    for(i = 0; i < LANG_OPTIONS.length; i++){
      if(LANG_OPTIONS[i].value === v) return true;
    }
    return false;
  }

  /* Validate a raw value (stored string, select value, anything).
     Returns the value itself when valid, else 'auto'. Leading/trailing
     whitespace is trimmed first — a stored ' punjabi ' is a typo, not
     a different language. Empty string, null, undefined and any
     unknown string all become 'auto'. */
  function normaliseLangSetting(v){
    if(typeof v === 'string'){
      v = v.replace(/^\s+|\s+$/g, '');
      if(isValidLangSetting(v)) return v;
    }
    return DEFAULT_LANG;
  }

  /* Label for a value, or null when the value is not one of the six. */
  function langLabelFor(v){
    var i;
    if(typeof v !== 'string') return null;
    for(i = 0; i < LANG_OPTIONS.length; i++){
      if(LANG_OPTIONS[i].value === v) return LANG_OPTIONS[i].label;
    }
    return null;
  }

  /* --- persistence (P5b): same key, validated both ways ------------- */

  /* Read the stored preference, validated. Missing key, empty string,
     unknown value, unreadable storage -> 'auto'. Never throws. */
  function getLangSetting(storage){
    return normaliseLangSetting(readStored(storage));
  }

  /* Save a preference, validated. Invalid values are REJECTED: returns
     false and the stored value is left untouched (the old value is
     kept). Valid values are written and return true. A write failure
     (storage unavailable / throws) also returns false. */
  function setLangSetting(v, storage){
    var s, value;
    if(typeof v === 'string') v = v.replace(/^\s+|\s+$/g, '');
    if(!isValidLangSetting(v)) return false;
    value = v;
    s = resolveStorage(storage);
    if(!s) return false;
    try{
      s.setItem(LANG_KEY, value);
    }catch(e){
      return false;
    }
    return true;
  }

  /* The preference the resolver should use for the next question.
     Reads the key live from storage on every call, so a change made
     anywhere (Settings modal, another tab, the console) is visible
     to the very next question with no reload. Falls back to the
     in-memory state.langPref when storage is unavailable, and to
     'auto' when neither has a valid value. */
  function getEffectivePref(state, storage){
    var s = resolveStorage(storage);
    if(s){
      var stored = readStored(s);
      if(stored !== null) return normaliseLangSetting(stored);
    }
    if(state && typeof state.langPref === 'string') return normaliseLangSetting(state.langPref);
    return DEFAULT_LANG;
  }

  /* --- wiring patches (assembler wires these to the live lines) ----- */

  /* P5a — option markup, built from LANG_OPTIONS so the select cannot
     drift from the allowed set. `selectedValue` (optional) marks one
     option selected; invalid values select nothing. */
  function langSelectOptionsHTML(selectedValue){
    var html = '';
    var i, sel;
    for(i = 0; i < LANG_OPTIONS.length; i++){
      sel = (LANG_OPTIONS[i].value === selectedValue) ? ' selected' : '';
      html += '<option value="' + LANG_OPTIONS[i].value + '"' + sel + '>' +
              LANG_OPTIONS[i].label + '</option>';
    }
    return html;
  }

  /* P5a — rebuild the Settings select (live L4843) from LANG_OPTIONS.
     Works with a real <select> (innerHTML path) and with a minimal
     stub that only has an `options` array and an `add` function
     (harness). Returns the select, or null when none was given.
     The previously selected valid value is preserved; an invalid or
     missing selection falls back to 'auto'. */
  function buildLangSelectOptions(selectEl, currentValue){
    var i, opt, value;
    if(!selectEl) return null;
    value = normaliseLangSetting(currentValue);
    if(typeof selectEl.innerHTML === 'string'){
      selectEl.innerHTML = langSelectOptionsHTML(value);
      try{ selectEl.value = value; }catch(e){}
      return selectEl;
    }
    /* Minimal-stub path: an options array + add(). */
    if(selectEl.options && typeof selectEl.add === 'function'){
      selectEl.options.length = 0;
      for(i = 0; i < LANG_OPTIONS.length; i++){
        opt = null;
        try{ opt = new Option(LANG_OPTIONS[i].label, LANG_OPTIONS[i].value); }catch(e){}
        if(!opt && typeof document !== 'undefined' && document.createElement){
          opt = document.createElement('option');
          opt.value = LANG_OPTIONS[i].value;
          opt.text = LANG_OPTIONS[i].label;
        }
        if(!opt) opt = { value: LANG_OPTIONS[i].value, text: LANG_OPTIONS[i].label };
        if(LANG_OPTIONS[i].value === value) opt.selected = true;
        selectEl.add(opt);
      }
      try{ selectEl.value = value; }catch(e){}
      return selectEl;
    }
    return selectEl;
  }

  /* P5a + P5c — the select patch the assembler wires once at startup
     (and again whenever the Settings modal is opened, so a stale DOM
     can never lose the Punjabi options): rebuild the options from
     LANG_OPTIONS, then show the current validated preference. */
  function patchLangSelect(selectEl, state){
    var current = (state && typeof state.langPref === 'string')
      ? state.langPref : getLangSetting();
    buildLangSelectOptions(selectEl, current);
    syncLangSelect(selectEl, state);
    return selectEl;
  }

  /* Live L8592 (refreshSettingsUI display line): show the validated
     preference in the select. Rebuilds the options first, so the
     value can never point at an option that does not exist (the old
     bug: a stored 'punjabi' with no Punjabi option in the DOM). */
  function syncLangSelect(selectEl, state){
    var value;
    if(!selectEl) return null;
    value = (state && typeof state.langPref === 'string')
      ? normaliseLangSetting(state.langPref) : getLangSetting();
    buildLangSelectOptions(selectEl, value);
    try{ selectEl.value = value; }catch(e){}
    return selectEl;
  }

  /* Live L8603 (load path): replace
       state.langPref = loadPref('enao_lang','auto');
     with
       state.langPref = EnzoLang48.getLangSetting();
     (or call patchLoadLangPref(state) from the assembler).
     Unknown stored values fall back to 'auto' here, at load. */
  function patchLoadLangPref(state, storage){
    if(!state) return DEFAULT_LANG;
    state.langPref = getLangSetting(storage);
    return state.langPref;
  }

  /* Live L8612 (save path, saveSettings onclick): replace
       state.langPref = $('langPref').value;
       savePref('enao_lang', state.langPref);
     with
       EnzoLang48.patchSaveLangPref(state, $('langPref'));
     On success the validated value is stored AND state.langPref is
     updated in the same handler — so the next question (P2a) uses the
     new preference with no reload. On an invalid select value the
     stored value and state.langPref are left untouched and the select
     is restored to the kept value; returns false. */
  function patchSaveLangPref(state, selectEl, storage){
    var value;
    if(!state || !selectEl) return false;
    value = (typeof selectEl.value === 'string') ? selectEl.value : '';
    if(!setLangSetting(value, storage)){
      /* Invalid: keep the old value everywhere, restore the select. */
      try{ selectEl.value = normaliseLangSetting(state.langPref); }catch(e){}
      return false;
    }
    state.langPref = normaliseLangSetting(value);
    return true;
  }

  /* Re-read the stored preference into state.langPref (for the
     resolver to call per question if it prefers the in-memory value
     over a live storage read). Same validation as the load path. */
  function syncLangPrefFromStorage(state, storage){
    if(!state) return DEFAULT_LANG;
    state.langPref = getLangSetting(storage);
    return state.langPref;
  }

  /* --- P5d / P5e text patches ---------------------------------------- */

  /* P5d — Settings description line (live L4842, the <span> next to
     "Answer language"). Sets the exact spec text. Accepts the span
     element itself, or an object with a textContent/innerText field. */
  function patchSettingsDescription(descEl){
    if(!descEl) return null;
    if(typeof descEl.textContent === 'string') descEl.textContent = SETTINGS_DESCRIPTION;
    else if(typeof descEl.innerText === 'string') descEl.innerText = SETTINGS_DESCRIPTION;
    else descEl.textContent = SETTINGS_DESCRIPTION;
    return descEl;
  }

  /* P5e — pure string rewrite for the voice picker note (live L18005).
     Replaces the old "Automatic picks the best voice for each
     language." sentence with the new spec sentence inside any text
     that contains it; text without the old sentence is returned
     unchanged. */
  function rewriteVoicePickerNoteText(text){
    if(typeof text !== 'string') return text;
    if(text.indexOf(VOICE_PICKER_NOTE_OLD) === -1) return text;
    return text.split(VOICE_PICKER_NOTE_OLD).join(VOICE_PICKER_NOTE_NEW);
  }

  /* P5e — apply the note rewrite to a container element (the voice
     pane built by buildVoicePane). Works with a real element
     (innerHTML path) and with a stub carrying innerHTML as a string.
     Returns the element, or null when none was given. */
  function patchVoicePickerNote(containerEl){
    if(!containerEl) return null;
    if(typeof containerEl.innerHTML === 'string'){
      containerEl.innerHTML = rewriteVoicePickerNoteText(containerEl.innerHTML);
      return containerEl;
    }
    if(typeof containerEl.textContent === 'string'){
      containerEl.textContent = rewriteVoicePickerNoteText(containerEl.textContent);
      return containerEl;
    }
    return containerEl;
  }

  var EnzoLang48 = {
    VERSION: VERSION,
    LANG_KEY: LANG_KEY,
    DEFAULT_LANG: DEFAULT_LANG,
    LANG_OPTIONS: LANG_OPTIONS,
    SETTINGS_DESCRIPTION: SETTINGS_DESCRIPTION,
    VOICE_PICKER_NOTE_OLD: VOICE_PICKER_NOTE_OLD,
    VOICE_PICKER_NOTE_NEW: VOICE_PICKER_NOTE_NEW,
    isValidLangSetting: isValidLangSetting,
    normaliseLangSetting: normaliseLangSetting,
    langLabelFor: langLabelFor,
    getLangSetting: getLangSetting,
    setLangSetting: setLangSetting,
    getEffectivePref: getEffectivePref,
    langSelectOptionsHTML: langSelectOptionsHTML,
    buildLangSelectOptions: buildLangSelectOptions,
    patchLangSelect: patchLangSelect,
    syncLangSelect: syncLangSelect,
    patchLoadLangPref: patchLoadLangPref,
    patchSaveLangPref: patchSaveLangPref,
    syncLangPrefFromStorage: syncLangPrefFromStorage,
    patchSettingsDescription: patchSettingsDescription,
    rewriteVoicePickerNoteText: rewriteVoicePickerNoteText,
    patchVoicePickerNote: patchVoicePickerNote
  };

  /* Export tail (guarded): browser global for the live page, and a
     module.exports assignment so the Node harness loads this exact
     file with no copy of the logic. No dependencies either way. */
  if(typeof root !== 'undefined') root.EnzoLang48 = EnzoLang48;
  if(typeof module !== 'undefined' && module.exports) module.exports = EnzoLang48;

})(typeof window !== 'undefined' ? window : this);
