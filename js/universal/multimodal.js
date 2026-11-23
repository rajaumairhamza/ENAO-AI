
/* ============================================================================
 * ENAO AI — UNIVERSAL INTELLIGENCE ENGINE, Piece E2: MULTIMODAL
 * File: 19-multimodal.js  (section 10 of the universal-intel audit)
 * ----------------------------------------------------------------------------
 * What this piece does:
 *  - createPipeline(): the ONE central pipeline every input must pass
 *    through, in order: INPUT -> PROCESSING -> MEANING -> CONTEXT ->
 *    UNIVERSAL REASONING -> INTENT/TASK -> CAPABILITY/TOOL ROUTING ->
 *    EXECUTION -> VALIDATION -> RESPONSE. Every stage is required;
 *    `skippable` is empty by design. There is no second pipeline.
 *  - funnelInput(input, ctx): normalises ANY input — text, voice
 *    transcript, file, image description — into one canonical
 *    { kind, text, lang, viaVoice, meta } shape, and returns the
 *    full pipeline stages it must pass through. No input type may
 *    skip the reasoning or routing stages.
 *  - routeByModality(input, ctx): modality-specific preprocessing
 *    (transcript cleanup for voice, readable-text extraction for a
 *    file, description-only handling for an image), then the SAME
 *    central intent/routing as text. Modality changes only the
 *    preprocessing, never the route.
 *  - voiceAnswerRule(input, ctx): the SINGLE voice answer rule —
 *    voice-in gives a voice-out answer, text-in gives a text-only
 *    answer. It consumes the v54 voice funnel (EnaoV54Voice /
 *    shouldAutoSpeak) when one is supplied or present, and only
 *    falls back to the same rule implemented locally when no v54
 *    funnel exists. There is never a second, competing rule.
 *
 * What it does NOT do:
 *  - No speech recognition, no speech synthesis, no file reading,
 *    no image-pixel analysis: those are device / browser / backend
 *    capabilities. This piece normalises what they hand it. An
 *    image is handled from its written description only — the piece
 *    never claims pixels were analysed.
 *  - No answering of its own: it funnels and routes. The answer
 *    comes from the central pipeline, fed by funnelInput.
 *  - No invented content: a file with no readable text reports
 *    gap 'no-readable-text'; an image with no description reports
 *    gap 'no-description'. Nothing is guessed to fill either.
 *  - No hardcoded topics: the pipeline, the funnel and the voice
 *    rule are identical for any subject, and the harness proves
 *    topic-invariance across unrelated subjects.
 *
 * Style: plain ES5, no dependencies, no network, no DOM, no emojis.
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = 'universal-e2-multimodal-v1';

  /* ------------------------------------------------------------------ */
  /* Small helpers (same shape as 07-universal-preset.js)                */
  /* ------------------------------------------------------------------ */

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function asNonEmptyString(v) {
    var s = asString(v).replace(/^\s+|\s+$/g, '');
    return s ? s : null;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function hasUrduScript(text) {
    return /[\u0600-\u06FF]/.test(asString(text));
  }

  var ROMAN_URDU_WORDS = [
    'mujhe', 'mujh', 'mera', 'meri', 'mere', 'bana', 'banao', 'banaa',
    'bata', 'batao', 'kya', 'kia', 'hai', 'hain', 'kar', 'karo',
    'rahe', 'raha', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par',
    'aur', 'chahiye', 'chahta', 'chahti', 'ye', 'wo', 'kahan', 'kab',
    'kaise', 'kitne', 'kaisa', 'sunao', 'likh', 'bhej', 'do', 'de'
  ];

  function detectLanguage(text) {
    var raw = asString(text);
    if (hasUrduScript(raw)) return 'ur';
    var words = raw.toLowerCase().replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').split(' ');
    var hits = 0;
    var i;
    for (i = 0; i < words.length; i++) {
      if (ROMAN_URDU_WORDS.indexOf(words[i]) !== -1) hits++;
    }
    if (hits > 0) return 'roman';
    return 'en';
  }

  /* ------------------------------------------------------------------ */
  /* The ONE central pipeline                                          */
  /* ------------------------------------------------------------------ */
  var PIPELINE_STAGES = [
    { id: 'input', name: 'INPUT', what: 'The raw input arrives, in whatever modality it came in.' },
    { id: 'processing', name: 'PROCESSING', what: 'The input is normalised into the canonical shape.' },
    { id: 'meaning', name: 'MEANING', what: 'What the input means is worked out, not just its words.' },
    { id: 'context', name: 'CONTEXT', what: 'The input is placed against the conversation and what is already known.' },
    { id: 'reasoning', name: 'UNIVERSAL REASONING', what: 'The one reasoning engine decides what the input needs.' },
    { id: 'intent', name: 'INTENT/TASK', what: 'The intent and the task it implies are fixed.' },
    { id: 'routing', name: 'CAPABILITY/TOOL ROUTING', what: 'The capability or tool that can do the task is chosen.' },
    { id: 'execution', name: 'EXECUTION', what: 'The chosen capability runs the task.' },
    { id: 'validation', name: 'VALIDATION', what: 'The result is checked before it is delivered.' },
    { id: 'response', name: 'RESPONSE', what: 'The answer is delivered in the right form for how the input arrived.' }
  ];

  function stageIds() {
    var out = [];
    var i;
    for (i = 0; i < PIPELINE_STAGES.length; i++) out.push(PIPELINE_STAGES[i].id);
    return out;
  }

  function stageCopies() {
    var out = [];
    var i;
    for (i = 0; i < PIPELINE_STAGES.length; i++) {
      out.push({
        id: PIPELINE_STAGES[i].id,
        name: PIPELINE_STAGES[i].name,
        what: PIPELINE_STAGES[i].what,
        required: true
      });
    }
    return out;
  }

  /* createPipeline(): the single pipeline definition. Every stage is
     required and none is skippable — that is the whole point: a
     shortcut that jumps from input to response is a bypass, and this
     piece defines no bypass. */
  function createPipeline() {
    return {
      stages: stageCopies(),
      stageIds: stageIds(),
      required: stageIds(),
      skippable: []
    };
  }

  /* ------------------------------------------------------------------ */
  /* funnelInput(input, ctx)                                             */
  /* ------------------------------------------------------------------ */
  /* Normalise any input into { kind, text, lang, viaVoice, meta }.
     Accepted input shapes:
       - a plain string: text input.
       - { text, kind: 'text' | 'voice' | 'file' | 'image' } (kind
         may also be given as `type` or `modality`).
       - voice: { transcript, viaVoice: true } or kind 'voice'.
       - file: { file: { name, kind, text } } or { fileName, fileText }.
       - image: { imageDescription } or { description, alt } or
         { image: { description } }.
     The returned stages are ALWAYS the full pipeline, for every
     kind — voice, file and image inputs pass through reasoning and
     routing exactly like text. `bypass` is always empty. */
  function funnelInput(input, ctx) {
    var context = isPlainObject(ctx) ? ctx : {};
    var kind = null;
    var text = '';
    var viaVoice = false;
    var lang = null;
    var meta = {};
    var gap = null;

    var raw = input;
    if (typeof raw === 'string') {
      kind = 'text';
      text = raw;
    } else if (isPlainObject(raw)) {
      var givenKind = asNonEmptyString(raw.kind || raw.type || raw.modality || null);
      if (givenKind) givenKind = givenKind.toLowerCase();
      if (givenKind === 'voice' || givenKind === 'text' || givenKind === 'file' || givenKind === 'image') {
        kind = givenKind;
      } else if (raw.viaVoice === true || asNonEmptyString(raw.transcript) !== null) {
        kind = 'voice';
      } else if (isPlainObject(raw.file) || asNonEmptyString(raw.fileName) !== null || asNonEmptyString(raw.fileText) !== null) {
        kind = 'file';
      } else if (asNonEmptyString(raw.imageDescription) !== null || isPlainObject(raw.image) || asNonEmptyString(raw.alt) !== null) {
        kind = 'image';
      } else {
        kind = 'text';
      }

      if (kind === 'voice') {
        text = asString(raw.transcript || raw.text || '');
        viaVoice = true;
        if (asNonEmptyString(raw.transcript) !== null) meta.hasTranscript = true;
      } else if (kind === 'file') {
        var file = isPlainObject(raw.file) ? raw.file : {};
        var fileName = asNonEmptyString(file.name || raw.fileName || null);
        var fileKind = asNonEmptyString(file.kind || raw.fileKind || null);
        text = asString(file.text || raw.fileText || raw.text || '');
        if (fileName) meta.fileName = fileName;
        if (fileKind) meta.fileKind = fileKind;
        meta.source = 'file';
        if (!asNonEmptyString(text)) gap = 'no-readable-text';
      } else if (kind === 'image') {
        var image = isPlainObject(raw.image) ? raw.image : {};
        var imageName = asNonEmptyString(image.name || raw.imageName || null);
        text = asString(raw.imageDescription || image.description || raw.description || raw.alt || image.alt || raw.text || '');
        if (imageName) meta.imageName = imageName;
        meta.source = 'image-description';
        if (!asNonEmptyString(text)) gap = 'no-description';
      } else {
        text = asString(raw.text || '');
        viaVoice = raw.viaVoice === true;
      }

      if (raw.viaVoice === true) viaVoice = true;
      if (asNonEmptyString(raw.lang) !== null) {
        var givenLang = asString(raw.lang).toLowerCase();
        if (givenLang === 'en' || givenLang === 'roman' || givenLang === 'ur' || givenLang === 'urdu') {
          lang = givenLang === 'urdu' ? 'ur' : givenLang;
        }
      }
      if (asNonEmptyString(raw.source) !== null) meta.source = asString(raw.source);
    } else {
      kind = 'text';
      text = asString(raw);
    }

    if (!lang) lang = detectLanguage(text);
    if (kind === 'voice') viaVoice = true;
    if (!asNonEmptyString(text) && !gap) gap = 'empty';
    meta.modality = kind;
    if (context.chatId) meta.chatId = asString(context.chatId);

    var pipeline = createPipeline();
    return {
      canonical: { kind: kind, text: text, lang: lang, viaVoice: viaVoice, meta: meta },
      stages: pipeline.stageIds,
      pipeline: pipeline.stages,
      mustPass: ['reasoning', 'intent', 'routing'],
      bypass: [],
      gap: gap
    };
  }

  /* ------------------------------------------------------------------ */
  /* routeByModality(input, ctx)                                         */
  /* ------------------------------------------------------------------ */
  /* Modality-specific preprocessing, then the SAME central
     intent/routing as text. The preprocessing steps differ per
     modality; the route never does. Returns { canonical,
     preprocessing, route, stages, mustPass, bypass, gap }. */
  var PREPROCESSING_BY_KIND = {
    text: [
      'Trim whitespace',
      'Normalise spacing',
      'Keep the original wording'
    ],
    voice: [
      'Use the transcript as the text',
      'Normalise spacing',
      'Keep the viaVoice flag for the answer rule',
      'Do not answer from the transcript alone — send it through the central pipeline'
    ],
    file: [
      'Read the file text when present',
      'Keep the file name and kind in meta',
      'If no readable text is present, report the gap instead of inventing content'
    ],
    image: [
      'Use the written description as the text',
      'Do not claim pixels were analysed',
      'Keep the image name in meta when given'
    ]
  };

  function routeByModality(input, ctx) {
    var funnelled = funnelInput(input, ctx);
    var canonical = funnelled.canonical;
    var steps = PREPROCESSING_BY_KIND[canonical.kind] || PREPROCESSING_BY_KIND.text;
    var notes = [];
    if (canonical.kind === 'file' && funnelled.gap === 'no-readable-text') {
      notes.push('No readable text could be taken from the file — ask for the text instead of inventing it.');
    }
    if (canonical.kind === 'image') {
      notes.push('Image handling here is description-only; no pixels were analysed.');
    }
    if (canonical.kind === 'voice') {
      notes.push('Voice input keeps its viaVoice flag so the answer rule can speak the reply.');
    }
    return {
      canonical: canonical,
      preprocessing: { modality: canonical.kind, steps: steps.slice(), notes: notes },
      route: { name: 'central', intent: 'universal', stages: funnelled.stages, sameAsText: true },
      stages: funnelled.stages,
      mustPass: funnelled.mustPass,
      bypass: [],
      gap: funnelled.gap
    };
  }

  /* ------------------------------------------------------------------ */
  /* voiceAnswerRule(input, ctx) — the SINGLE voice rule                */
  /* ------------------------------------------------------------------ */
  /* Voice-in gives a voice-out answer; text-in gives a text-only
     answer. The text-reply override ('text mein bhejo' and its
     forms) beats even mode 'on', for that one answer only; mode
     'on' speaks every answer; mode 'off' never speaks. This is the
     v54 rule (EnaoV54Voice.shouldAutoSpeak): when a v54 funnel is
     supplied in ctx (ctx.voiceFunnel / ctx.v54) or present as a
     global, THIS function calls it and returns its decision — it
     does not keep a second rule beside it. The local implementation
     below runs only when no v54 funnel exists, and it follows the
     same order as v54, so the decision is identical either way.
     `source` in the result says which one decided. */
  function wantsTextReply(text) {
    var t = ' ' + asString(text || '').toLowerCase() + ' ';
    return /(text|ٹیکسٹ)[\s-]*(mein|me|میں)?[\s-]*(bhej\w*|send|likh\w*|jawab|reply|answer|do|de)\b/.test(t)
      || /likh\s*(kar|ke)\s*bhej/.test(t)
      || /(sirf|only)\s+text\b/.test(t)
      || /(reply|answer|send|respond)\s+in\s+text\b/.test(t)
      || /لکھ کر بھیج/.test(t);
  }

  function resolveVoiceMessage(input) {
    if (typeof input === 'string') {
      return { plain: input, question: input, viaVoice: false, lang: detectLanguage(input) };
    }
    if (isPlainObject(input)) {
      if (isPlainObject(input.canonical)) {
        var c = input.canonical;
        return {
          plain: asString(c.text || ''),
          question: asString(c.text || ''),
          viaVoice: c.kind === 'voice' || c.viaVoice === true,
          lang: c.lang || detectLanguage(c.text || '')
        };
      }
      return {
        plain: asString(input.plain || input.text || input.transcript || ''),
        question: asString(input.question || input.text || input.transcript || ''),
        viaVoice: input.viaVoice === true || input.kind === 'voice' || input.modality === 'voice',
        lang: input.lang || detectLanguage(input.plain || input.text || input.transcript || '')
      };
    }
    return { plain: '', question: '', viaVoice: false, lang: 'en' };
  }

  function voiceFunnelFrom(ctx) {
    if (isPlainObject(ctx)) {
      if (ctx.voiceFunnel && typeof ctx.voiceFunnel.shouldAutoSpeak === 'function') return ctx.voiceFunnel;
      if (ctx.v54 && typeof ctx.v54.shouldAutoSpeak === 'function') return ctx.v54;
      if (ctx.EnaoV54Voice && typeof ctx.EnaoV54Voice.shouldAutoSpeak === 'function') return ctx.EnaoV54Voice;
    }
    try {
      if (typeof globalThis !== 'undefined' && globalThis.EnaoV54Voice &&
          typeof globalThis.EnaoV54Voice.shouldAutoSpeak === 'function') {
        return globalThis.EnaoV54Voice;
      }
    } catch (e) { /* global lookup is best-effort */ }
    return null;
  }

  function voiceAnswerRule(input, ctx) {
    var context = isPlainObject(ctx) ? ctx : {};
    var msg = resolveVoiceMessage(input);
    var mode = 'auto';
    if (typeof context.answersMode === 'function') {
      try {
        var m = context.answersMode();
        if (m === 'on' || m === 'off' || m === 'auto') mode = m;
      } catch (e) { mode = 'auto'; }
    } else if (context.mode === 'on' || context.mode === 'off' || context.mode === 'auto') {
      mode = context.mode;
    }

    var funnel = voiceFunnelFrom(context);
    var textReply = false;
    if (funnel && typeof funnel.wantsTextReply === 'function') {
      try { textReply = !!funnel.wantsTextReply(msg.question); } catch (e) { textReply = wantsTextReply(msg.question); }
    } else {
      textReply = wantsTextReply(msg.question);
    }

    if (!asNonEmptyString(msg.plain)) {
      return { speak: false, viaVoice: msg.viaVoice, mode: mode, rule: 'voice-in-voice-out', source: funnel ? 'v54' : 'local-fallback', reason: 'no-text-to-speak', wantsTextReply: textReply };
    }
    if (funnel) {
      var speak = false;
      try {
        speak = !!funnel.shouldAutoSpeak(
          { plain: msg.plain, text: msg.plain, question: msg.question, viaVoice: msg.viaVoice, lang: msg.lang },
          mode
        );
      } catch (e) { speak = false; }
      var reason = textReply ? 'text-reply-requested' : (mode === 'on' ? 'mode-on' : (mode === 'off' ? 'mode-off' : (msg.viaVoice ? 'voice-in' : 'text-in')));
      return { speak: speak, viaVoice: msg.viaVoice, mode: mode, rule: 'voice-in-voice-out', source: 'v54', reason: reason, wantsTextReply: textReply };
    }
    /* Local fallback — same order as v54: text-reply override first,
       then mode on/off, then the voice flag in auto mode. */
    if (textReply) {
      return { speak: false, viaVoice: msg.viaVoice, mode: mode, rule: 'voice-in-voice-out', source: 'local-fallback', reason: 'text-reply-requested', wantsTextReply: true };
    }
    if (mode === 'on') {
      return { speak: true, viaVoice: msg.viaVoice, mode: mode, rule: 'voice-in-voice-out', source: 'local-fallback', reason: 'mode-on', wantsTextReply: false };
    }
    if (mode === 'off') {
      return { speak: false, viaVoice: msg.viaVoice, mode: mode, rule: 'voice-in-voice-out', source: 'local-fallback', reason: 'mode-off', wantsTextReply: false };
    }
    return {
      speak: !!msg.viaVoice,
      viaVoice: msg.viaVoice,
      mode: mode,
      rule: 'voice-in-voice-out',
      source: 'local-fallback',
      reason: msg.viaVoice ? 'voice-in' : 'text-in',
      wantsTextReply: false
    };
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  var api = {
    VERSION: VERSION,
    PIPELINE_STAGES: PIPELINE_STAGES,
    createPipeline: createPipeline,
    funnelInput: funnelInput,
    routeByModality: routeByModality,
    voiceAnswerRule: voiceAnswerRule,
    wantsTextReply: wantsTextReply,
    detectLanguage: detectLanguage
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalMultimodal = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalMultimodal = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
