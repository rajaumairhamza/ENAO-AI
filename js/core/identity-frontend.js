
/* 31-identity-frontend.js — ENZO identity for the ENAO AI frontend.
 *
 * Defect fixed: asking ENZO its name got "ChatGPT". The artifact's prompt
 * builders say "You are ENZO AI" only inside user-role message content,
 * and the fetch calls send messages:[{role:'user', content:prompt}] with
 * NO system role at all, so Pollinations' openai model answers name
 * questions from its own built-in identity.
 *
 * This piece supplies the fix in one place:
 *   - ENZO_IDENTITY: the canonical identity line, carried as a system
 *     message (buildMessages) and, as defence in depth, as the first line
 *     of the prompt text itself (withIdentity).
 *   - buildMessages(prompt): system identity + user task, for the fetch
 *     calls in callAIOnce, rewritePassage and describeImage.
 *   - withIdentity(prompt): idempotent prompt prefix, for the three
 *     prompt builders (buildPrompt, buildKnowledgePrompt, megaAnswer).
 *   - answerNameQuestion(text, lang): whole-message name fast path, so a
 *     name question never reaches the model at all. It fires only when
 *     the WHOLE message asks the assistant's name / who it is / who made
 *     it, in English, Urdu script, Roman Urdu or Punjabi (Shahmukhi or
 *     Roman). Topic questions about a third party never fire.
 *
 * ES5 style to match the artifact (var, function, no arrow functions,
 * no template literals, no const/let). No emojis. No other behaviour.
 * UMD: window.EnzoIdentity in the browser, module.exports under Node.
 */
(function (global) {
  'use strict';

  var ENZO_IDENTITY = 'You are ENZO, also called ENZO AI \u2014 a personal AI assistant built for Raja. Your name is ENZO. Never say your name is ChatGPT, OpenAI, GPT, or any other AI. If asked who you are, what your name is, or who made you, say you are ENZO (ENZO AI), Raja\'s personal AI assistant.';

  /* ---------- messages / prompt helpers ---------- */

  function buildMessages(prompt) {
    var p = (prompt === null || prompt === undefined) ? '' : String(prompt);
    return [
      { role: 'system', content: ENZO_IDENTITY },
      { role: 'user', content: p }
    ];
  }

  function withIdentity(prompt) {
    var p = (prompt === null || prompt === undefined) ? '' : String(prompt);
    if (p.indexOf(ENZO_IDENTITY) === 0) return p;
    if (!p) return ENZO_IDENTITY;
    return ENZO_IDENTITY + '\n\n' + p;
  }

  /* ---------- name fast path ---------- */

  var NAME_ANSWERS = {
    en: {
      name: 'My name is ENZO (ENZO AI). I am Raja\'s personal AI assistant.',
      maker: 'I am ENZO (ENZO AI), Raja\'s personal AI assistant. I was built for Raja.'
    },
    roman: {
      name: 'Mera naam ENZO hai (ENZO AI). Main Raja ka personal AI assistant hoon.',
      maker: 'Main ENZO hoon (ENZO AI), Raja ka personal AI assistant. Mujhe Raja ke liye banaya gaya hai.'
    },
    urdu: {
      name: '\u0645\u06cc\u0631\u0627 \u0646\u0627\u0645 \u0627\u06cc\u0646\u0632\u0648 \u06c1\u06d2 (ENZO AI)\u06d4 \u0645\u06cc\u06ba \u0631\u0627\u062c\u06c1 \u06a9\u0627 \u0630\u0627\u062a\u06cc AI \u0627\u0633\u0633\u0679\u0646\u0679 \u06c1\u0648\u06ba\u06d4',
      maker: '\u0645\u06cc\u06ba \u0627\u06cc\u0646\u0632\u0648 \u06c1\u0648\u06ba (ENZO AI)\u060c \u0631\u0627\u062c\u06c1 \u06a9\u0627 \u0630\u0627\u062a\u06cc AI \u0627\u0633\u0633\u0679\u0646\u0679\u06d4 \u0645\u062c\u06be\u06d2 \u0631\u0627\u062c\u06c1 \u06a9\u06d2 \u0644\u06cc\u06d2 \u0628\u0646\u0627\u06cc\u0627 \u06af\u06cc\u0627 \u06c1\u06d2\u06d4'
    },
    punjabi: {
      name: '\u0645\u06cc\u0631\u0627 \u0646\u0627\u06ba \u0627\u06cc\u0646\u0632\u0648 \u0627\u06d2 (ENZO AI)\u06d4 \u0645\u06cc\u06ba \u0631\u0627\u062c\u06c1 \u062f\u0627 \u0630\u0627\u062a\u06cc AI \u0627\u0633\u0633\u0679\u0646\u0679 \u0622\u06ba\u06d4',
      maker: '\u0645\u06cc\u06ba \u0627\u06cc\u0646\u0632\u0648 \u0622\u06ba (ENZO AI)\u060c \u0631\u0627\u062c\u06c1 \u062f\u0627 \u0630\u0627\u062a\u06cc AI \u0627\u0633\u0633\u0679\u0646\u0679\u06d4 \u0645\u06cc\u0646\u0648\u06ba \u0631\u0627\u062c\u06c1 \u0644\u0626\u06cc \u0628\u0646\u0627\u06cc\u0627 \u06af\u06cc\u0627 \u0627\u06d2\u06d4'
    },
    punjabiRoman: {
      name: 'Mera naa ENZO ae (ENZO AI). Main Raja da personal AI assistant aan.',
      maker: 'Main ENZO aan (ENZO AI), Raja da personal AI assistant. Mainu Raja layi banaya gaya ae.'
    }
  };

  /* Whole-message patterns only: anchored ^...$, so a name word inside a
     longer or topic question never matches. One entry per language;
     'maker' patterns are the who-made-you form of the same question. */
  var NAME_PATTERNS = {
    en: [
      { re: /^(who are you|who are u|what is your name|whats your name|what is ur name|whats ur name|tell me your name|your name|what are you called)$/, kind: 'name' },
      { re: /^(who made you|who created you|who built you)$/, kind: 'maker' }
    ],
    roman: [
      { re: /^(tum kaun ho|aap kaun ho|tu kaun hai|tu kaun ho|tum kon ho|aap kon ho|tumhara naam kya hai|tumhara naam kya he|tumhara naam kya ha|tumhara naam kya|aapka naam kya hai|aapka naam kya|aap ka naam kya hai|tumhara naam batao|aapka naam batao)$/, kind: 'name' },
      { re: /^(tumhe kisne banaya|tumhe kis ne banaya|tum ko kisne banaya|tum ko kis ne banaya|aapko kisne banaya|aap ko kisne banaya|aap ko kis ne banaya)$/, kind: 'maker' }
    ],
    urdu: [
      { re: /^(\u062a\u0645 \u06a9\u0648\u0646 \u06c1\u0648|\u0622\u067e \u06a9\u0648\u0646 \u06c1\u0648|\u062a\u0645\u06c1\u0627\u0631\u0627 \u0646\u0627\u0645 \u06a9\u06cc\u0627 \u06c1\u06d2|\u0622\u067e \u06a9\u0627 \u0646\u0627\u0645 \u06a9\u06cc\u0627 \u06c1\u06d2|\u062a\u06cc\u0631\u0627 \u0646\u0627\u0645 \u06a9\u06cc\u0627 \u06c1\u06d2|\u062a\u0645\u06c1\u0627\u0631\u0627 \u0646\u0627\u0645 \u0628\u062a\u0627\u0624|\u0622\u067e \u06a9\u0627 \u0646\u0627\u0645 \u0628\u062a\u0627\u0626\u06cc\u06ba)$/, kind: 'name' },
      { re: /^(\u062a\u0645\u06c1\u06cc\u06ba \u06a9\u0633 \u0646\u06d2 \u0628\u0646\u0627\u06cc\u0627|\u0622\u067e \u06a9\u0648 \u06a9\u0633 \u0646\u06d2 \u0628\u0646\u0627\u06cc\u0627)$/, kind: 'maker' }
    ],
    punjabi: [
      { re: /^(\u062a\u0648\u06ba \u06a9\u0648\u0646 \u0627\u06cc\u06ba|\u062a\u0648\u06ba \u06a9\u0648\u0646 \u0627\u06d2|\u062a\u0633\u06cc \u06a9\u0648\u0646 \u0627\u0648|\u062a\u0633\u06cc \u06a9\u0648\u0646 \u06c1\u0648|\u062a\u06cc\u0631\u0627 \u0646\u0627\u06ba \u06a9\u06cc \u0627\u06d2|\u062a\u0648\u0627\u0688\u0627 \u0646\u0627\u06ba \u06a9\u06cc \u0627\u06d2|\u062a\u06c1\u0627\u0688\u0627 \u0646\u0627\u06ba \u06a9\u06cc \u0627\u06d2|\u062a\u06cc\u0631\u0627 \u0646\u0627\u06ba \u06a9\u06cc \u06c1\u06d2)$/, kind: 'name' },
      { re: /^(\u062a\u06cc\u0646\u0648\u06ba \u06a9\u0633 \u0646\u06d2 \u0628\u0646\u0627\u06cc\u0627|\u062a\u06cc\u0646\u0648\u06ba \u06a9\u0633 \u0646\u06d2 \u0628\u0646\u0627\u06cc\u0627 \u0627\u06d2)$/, kind: 'maker' }
    ],
    punjabiRoman: [
      /* Optional leading 'mainu das / mainu daso / mainu dso' ('tell me').
         The prefix alone never fires — a name question must follow it. */
      { re: /^((mainu das|mainu daso|mainu dso) )?(tu kaun ain|tu kaun ae|tussi kaun ho|tusi kaun ho|tussi kaun o|tera naam ki hai|tera naa ki ae|tera naam ki ae|tera naa ki hai)$/, kind: 'name' },
      { re: /^(tainu kisne banaya|tenu kis ne banaya|tainu kis ne banaya)$/, kind: 'maker' }
    ]
  };

  function hasUrduScript(s) {
    return /[\u0600-\u06FF]/.test(s);
  }

  function isPunjabiScript(s) {
    /* Shahmukhi Punjabi markers. The sharpest is NAAN with noon ghunna
       (U+06BA) instead of Urdu NAAM: 'میرا ناں' is Punjabi, 'میرا نام' is
       Urdu. 'توں / تسی / تواڈا / تینوں' and 'کون ایں / کون اے' are
       Punjabi-only; 'وچ / نال / دا' alone are weaker, so they are not
       used here on their own. */
    return /(\u0646\u0627\u06ba|\u062a\u0648\u06ba|\u062a\u0633\u06cc|\u062a\u0648\u0627\u0688\u0627|\u062a\u06cc\u0646\u0648\u06ba|\u06a9\u0648\u0646 \u0627\u06cc\u06ba|\u06a9\u0648\u0646 \u0627\u06d2)/.test(s);
  }

  function isPunjabiRoman(s) {
    /* Roman Punjabi markers: 'tera / tainu / tenu' + 'ki / ae / ain',
       or 'tu kaun ain/ae', 'tussi/tusi kaun'. Plain 'tum / aap / kya /
       hai' stays Roman Urdu. */
    return /(^|\s)(tera|tainu|tenu|tussi|tusi)(\s|$)/.test(s) ||
      /\btu kaun (ain|ae)\b/.test(s) ||
      /\b(naa ki|naam ki hai)\b/.test(s);
  }

  function isRomanUrdu(s) {
    return /\b(tum|aap|tumhara|aapka|kaun|kon|naam|kya|kia|hai|he|ho|batao|kisne|banaya)\b/.test(s);
  }

  /* Language of the question text itself. The caller's lang is only a
     tiebreak hint and never overrides what the text says. */
  function detectNameLang(text, lang) {
    var s = String(text || '');
    if (hasUrduScript(s)) return isPunjabiScript(s) ? 'punjabi' : 'urdu';
    var n = s.toLowerCase();
    if (isPunjabiRoman(n)) return 'punjabiRoman';
    if (isRomanUrdu(n)) return 'roman';
    if (lang === 'punjabi' || lang === 'punjabiRoman') return 'punjabiRoman';
    if (lang === 'roman' || lang === 'urdu') return lang;
    return 'en';
  }

  function normalizeNameQuestion(text) {
    var s = String(text || '').toLowerCase();
    s = s.replace(/['\u2018\u2019]/g, '');
    s = s.replace(/[?!.,;:()"'\u060C\u061B\u061F\u06D4]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    s = s.replace(/^(hi|hello|hey|salam|assalamualaikum|aoa)\s+/, '');
    s = s.replace(/\s+(please|batao|batayen|bataein|daso)$/, '');
    return s;
  }

  function wordCount(s) {
    if (!s) return 0;
    return s.split(' ').length;
  }

  function answerNameQuestion(text, lang) {
    if (text === null || text === undefined) return null;
    var raw = String(text);
    if (!raw.replace(/^\s+|\s+$/g, '')) return null;
    var norm = normalizeNameQuestion(raw);
    if (!norm) return null;
    /* Whole-message questions are short. Anything longer is a compound
       or topic question, never a bare name question. */
    if (wordCount(norm) > 12) return null;
    /* Third-party guard: a question ABOUT ChatGPT / Gemini / Claude /
       OpenAI is a topic question, never a question about this assistant.
       The one exception is the identity-denial form ("are you ChatGPT?",
       "tum ChatGPT ho?"), which is a question about this assistant and
       is answered with the ENZO name answer (which never names ChatGPT). */
    var mentionsOther = /\b(chatgpt|chat gpt|gemini|claude|openai|gpt-?4|gpt-?3)\b/.test(norm);
    if (mentionsOther) {
      var denial = /^(are you (chatgpt|chat gpt|openai|gpt)|kya tum (chatgpt|chat gpt|openai) ho|tum (chatgpt|chat gpt|openai) ho)$/.test(norm);
      if (!denial) return null;
      var denialLang = detectNameLang(raw, lang);
      return NAME_ANSWERS[denialLang].name;
    }
    var detected = detectNameLang(raw, lang);
    var order = [detected, 'en', 'roman', 'urdu', 'punjabi', 'punjabiRoman'];
    var seen = {};
    var i, j, set, entry, ans;
    for (i = 0; i < order.length; i++) {
      if (seen[order[i]]) continue;
      seen[order[i]] = true;
      set = NAME_PATTERNS[order[i]];
      if (!set) continue;
      for (j = 0; j < set.length; j++) {
        entry = set[j];
        if (entry.re.test(norm)) {
          ans = NAME_ANSWERS[order[i]];
          return entry.kind === 'maker' ? ans.maker : ans.name;
        }
      }
    }
    return null;
  }

  var api = {
    ENZO_IDENTITY: ENZO_IDENTITY,
    NAME_ANSWERS: NAME_ANSWERS,
    buildMessages: buildMessages,
    withIdentity: withIdentity,
    detectNameLang: detectNameLang,
    answerNameQuestion: answerNameQuestion
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.EnzoIdentity = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
