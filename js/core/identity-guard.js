
/* ENAO AI — piece 32: identity safety net.
 *
 * Last line of defence for self-identification: the model can still
 * occasionally answer "I am ChatGPT" even with identity prompts fixed.
 * correctIdentity() rewrites FIRST-PERSON self-identification claims
 * (assistant is ChatGPT / OpenAI / GPT) to ENZO after the answer
 * arrives and before display or speech.
 *
 * It MUST NOT alter topic discussion ("ChatGPT is a chatbot by
 * OpenAI"), comparisons, code blocks, URLs or quoted text — only
 * first-person self-identification sentences are corrected.
 *
 * UMD / IIFE, ES5 style. Exposes window.EnzoIdentityGuard in the
 * browser and module.exports under Node. Python mirror:
 * 32-identity-safetynet.py (same rules, same order, same behaviour).
 * Shared test cases: shared_cases.json.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EnzoIdentityGuard = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Name token for the claimed identity (EN / Latin script).
   * Longest alternatives first so "OpenAI's GPT-4" and "ChatGPT-4o"
   * are consumed whole instead of leaving a version suffix behind. */
  var NAME_EN = "(OpenAI['\u2019]s GPT(?:-?(?:4o?|5|3\\.?5)|\\s(?:4o?|5|3\\.?5))?" +
    "|Chat\\s?GPT(?:-?(?:4o?|5|3\\.?5)|\\s(?:4o?|5|3\\.?5))?" +
    "|OpenAI" +
    "|GPT(?:-?(?:4o?|5|3\\.?5)|\\s(?:4o?|5|3\\.?5))?" +
    "|GPT)";

  /* Name token for the claimed identity (Urdu script, plus Latin name
   * inside an Urdu sentence). Words may be joined by a space or a
   * zero-width non-joiner. */
  var NAME_UR = "(\u0686\u06cc\u0679[\\s\u200c]*\u062c\u06cc[\\s\u200c]*\u067e\u06cc[\\s\u200c]*\u0679\u06cc" +
    "|\u0627\u0648\u067e\u0646[\\s\u200c]*\u0627\u06d2[\\s\u200c]*\u0622\u0626\u06cc" +
    "|\u062c\u06cc[\\s\u200c]*\u067e\u06cc[\\s\u200c]*\u0679\u06cc(?:[\\s\u200c]*\u0641\u0648\u0631)?" +
    "|Chat\\s?GPT(?:-?(?:4o?|5|3\\.?5)|\\s(?:4o?|5|3\\.?5))?" +
    "|OpenAI)";

  var WS_UR = "[\\s\u200c]+";

  /* A span that must never be touched: fenced code, inline code,
   * URLs, double-quoted text (straight or curly), single-quoted
   * text naming ChatGPT/OpenAI/GPT. */
  var PROTECTED_RE = /(```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|\u201c[^\u201d]*\u201d|"[^"]*"|'[^']*(?:Chat\s?GPT|OpenAI|GPT)[^']*')/g;

  /* Sentence boundaries: . ! ? plus Urdu full stop / question mark.
   * A period followed by a digit (GPT-3.5, 3.5) is not a boundary. */
  var SENTENCE_RE = /([.!?\u06d4\u061f]+(?![0-9])[\s\t\r\n]*|\n+)/;

  /* "created by OpenAI" left over in a sentence that already had a
   * self-claim corrected (e.g. "I am ChatGPT, an AI assistant created
   * by OpenAI"). Only applied when a rule below already changed the
   * sentence, so third-person topic sentences such as "ChatGPT was
   * created by OpenAI" are never touched. */
  var CREATED_BY_RE = /(created|developed|built|made)\s+by\s+OpenAI/gi;

  function normSubject(subj) {
    var low = subj.toLowerCase();
    if (low === 'i am') { return 'I am'; }
    if (low === "i'm" || low === 'i\u2019m') { return "I'm"; }
    if (low === 'i was') { return 'I was'; }
    return subj;
  }

  /* Each rule: [RegExp, replacer(match, g1, g2, ...)].
   * Rules carry an optional "(not\s+)?" group: a negated claim
   * ("I am not ChatGPT", "My name is not ChatGPT") is returned
   * unchanged. Order matters: specific frames before general ones. */
  var RULES = [
    /* EN: I am an OpenAI (AI) (language) model */
    [new RegExp('\\b(I am|I\'m|I\u2019m)\\s+(not\\s+)?(an?\\s+)?OpenAI\\s+(AI\\s+)?(language\\s+)?model\\b', 'gi'),
      function (m, subj, neg, art, ai, lang) {
        if (neg) { return m; }
        return normSubject(subj) + ' ENZO';
      }],
    /* EN: I am / I'm ChatGPT | OpenAI's GPT | OpenAI | GPT-4/4o/5/3.5 */
    [new RegExp('\\b(I am|I\'m|I\u2019m)\\s+(not\\s+)?(an?\\s+|the\\s+)?' + NAME_EN + '(\\s+model)?\\b', 'gi'),
      function (m, subj, neg, art, name, model) {
        if (neg) { return m; }
        return normSubject(subj) + ' ENZO';
      }],
    /* EN: My name is / My name's / Call me / I go by / I am known as */
    [new RegExp('\\b(My name is|My name\'s|My name\u2019s|Call me|I go by|I am known as)\\s+(not\\s+)?' + NAME_EN + '\\b', 'gi'),
      function (m, frame, neg, name) {
        if (neg) { return m; }
        return frame + ' ENZO';
      }],
    /* EN: I was / I am created|developed|built|made by OpenAI */
    [new RegExp('\\b(I was|I am|I\'m|I\u2019m)\\s+(not\\s+)?(created|developed|built|made)\\s+by\\s+(OpenAI|Open\\s+AI)\\b', 'gi'),
      function (m, subj, neg, verb, maker) {
        if (neg) { return m; }
        return normSubject(subj) + ' ' + verb + ' for Raja as ENZO';
      }],
    /* EN: OpenAI created|developed|built|made me */
    [/\bOpenAI\s+(created|developed|built|made)\s+me\b/gi,
      function (m, verb) {
        return 'Raja ' + verb + ' me as ENZO';
      }],
    /* EN: As ChatGPT, I ... (comma required: "As ChatGPT becomes more
       popular" is topic discussion and must pass through). */
    [new RegExp('\\b(As)\\s+(Chat\\s?GPT|OpenAI)\\s*,', 'gi'),
      function (m, asWord, name) {
        return asWord + ' ENZO,';
      }],
    /* EN: As an AI language model built by OpenAI, I ... */
    [new RegExp('\\b(As\\s+an?\\s+AI\\s+language\\s+model\\s+)(created|developed|built|made)\\s+by\\s+OpenAI\\b', 'gi'),
      function (m, frame, verb) {
        return frame + verb + ' for Raja as ENZO';
      }],
    /* Roman Urdu: mera naam / mera naan ChatGPT hai|he|ae */
    [new RegExp('\\b(mera naam|mera naan)\\s+' + NAME_EN + '\\s+(hai|he|ae)\\b', 'gi'),
      function (m, frame, name, copula) {
        return frame + ' ENZO ' + copula;
      }],
    /* Roman Urdu / Punjabi: main|mein ChatGPT hoon|hun|haan|aan */
    [new RegExp('\\b(main|mein)\\s+' + NAME_EN + '\\s+(hoon|hun|haan|aan)\\b', 'gi'),
      function (m, subj, name, copula) {
        return subj + ' ENZO ' + copula;
      }],
    /* Roman Urdu: mujhe OpenAI ne banaya hai|tha */
    [/\b(mujhe)\s+OpenAI\s+ne\s+banaya\s+(hai|tha)\b/gi,
      function (m, obj, tense) {
        return obj + ' Raja ke liye ENZO ke tor par banaya gaya ' + tense;
      }],
    /* Roman Urdu: OpenAI ne mujhe banaya hai|tha */
    [/\bOpenAI\s+ne\s+(mujhe)\s+banaya\s+(hai|tha)\b/gi,
      function (m, obj, tense) {
        return 'Raja ne ' + obj + ' ENZO ke tor par banaya ' + tense;
      }],
    /* Roman Urdu: main OpenAI ka banaya hua hoon|hun */
    [/\b(main|mein)\s+OpenAI\s+ka\s+banaya\s+hua\s+(hoon|hun)\b/gi,
      function (m, subj, copula) {
        return subj + ' Raja ke liye ENZO ke tor par banaya gaya ' + copula;
      }],
    /* Urdu script: mera naam / mera naan ... hai|ae */
    [new RegExp('(\u0645\u06cc\u0631\u0627 \u0646\u0627\u0645|\u0645\u06cc\u0631\u0627 \u0646\u0627\u06ba)' + WS_UR + NAME_UR + WS_UR + '(\u06c1\u06d2|\u0627\u06d2)', 'g'),
      function (m, frame, name, copula) {
        return frame + ' \u0627\u06cc\u0646\u0632\u0648 ' + copula;
      }],
    /* Urdu script: main ... hoon|haan|aan (incl. Punjabi) */
    [new RegExp('(\u0645\u06cc\u06ba)' + WS_UR + NAME_UR + WS_UR + '(\u06c1\u0648\u06ba|\u06c1\u0627\u06ba|\u0622\u06ba)', 'g'),
      function (m, subj, name, copula) {
        return subj + ' \u0627\u06cc\u0646\u0632\u0648 ' + copula;
      }],
    /* Urdu script: mujhe OpenAI ne banaya hai|tha */
    [new RegExp('(\u0645\u062c\u06be\u06d2)' + WS_UR + '\u0627\u0648\u067e\u0646[\\s\u200c]*\u0627\u06d2[\\s\u200c]*\u0622\u0626\u06cc' + WS_UR + '\u0646\u06d2' + WS_UR + '\u0628\u0646\u0627\u06cc\u0627' + WS_UR + '(\u06c1\u06d2|\u062a\u06be\u0627)', 'g'),
      function (m, obj, tense) {
        return obj + ' \u0631\u0627\u062c\u06c1 \u06a9\u06d2 \u0644\u06cc\u06d2 \u0627\u06cc\u0646\u0632\u0648 \u06a9\u06d2 \u0637\u0648\u0631 \u067e\u0631 \u0628\u0646\u0627\u06cc\u0627 \u06af\u06cc\u0627 ' + tense;
      }],
    /* Urdu script: OpenAI ne mujhe banaya hai|tha */
    [new RegExp('\u0627\u0648\u067e\u0646[\\s\u200c]*\u0627\u06d2[\\s\u200c]*\u0622\u0626\u06cc' + WS_UR + '\u0646\u06d2' + WS_UR + '(\u0645\u062c\u06be\u06d2)' + WS_UR + '\u0628\u0646\u0627\u06cc\u0627' + WS_UR + '(\u06c1\u06d2|\u062a\u06be\u0627)', 'g'),
      function (m, obj, tense) {
        return '\u0631\u0627\u062c\u06c1 \u0646\u06d2 ' + obj + ' \u0627\u06cc\u0646\u0632\u0648 \u06a9\u06d2 \u0637\u0648\u0631 \u067e\u0631 \u0628\u0646\u0627\u06cc\u0627 ' + tense;
      }]
  ];

  /* Apply every rule to one sentence. Afterwards, if a rule already
   * changed the sentence, fix a leftover "created by OpenAI" in the
   * same sentence (see CREATED_BY_RE note above). */
  function correctSentence(text) {
    var out = text;
    var i;
    for (i = 0; i < RULES.length; i++) {
      RULES[i][0].lastIndex = 0;
      out = out.replace(RULES[i][0], RULES[i][1]);
    }
    if (out !== text) {
      CREATED_BY_RE.lastIndex = 0;
      if (CREATED_BY_RE.test(out)) {
        CREATED_BY_RE.lastIndex = 0;
        out = out.replace(CREATED_BY_RE, function (m, verb) {
          return verb + ' for Raja as ENZO';
        });
      }
    }
    return out;
  }

  /* Split an unprotected span into sentences (delimiters kept) and
   * correct each piece. Splitting keeps the gate above sentence-local:
   * a topic sentence never inherits a self-claim from its neighbour. */
  function correctUnprotected(text) {
    var parts = text.split(SENTENCE_RE);
    var i;
    for (i = 0; i < parts.length; i++) {
      parts[i] = correctSentence(parts[i]);
    }
    return parts.join('');
  }

  function correctIdentity(answer) {
    if (typeof answer !== 'string') { return answer; }
    if (answer === '') { return answer; }
    var out = '';
    var last = 0;
    var m;
    PROTECTED_RE.lastIndex = 0;
    while ((m = PROTECTED_RE.exec(answer)) !== null) {
      if (m.index > last) {
        out += correctUnprotected(answer.slice(last, m.index));
      }
      out += m[0];
      last = m.index + m[0].length;
    }
    if (last < answer.length) {
      out += correctUnprotected(answer.slice(last));
    }
    return out;
  }

  function needsCorrection(answer) {
    if (typeof answer !== 'string') { return false; }
    return correctIdentity(answer) !== answer;
  }

  return {
    correctIdentity: correctIdentity,
    needsCorrection: needsCorrection
  };
}));
