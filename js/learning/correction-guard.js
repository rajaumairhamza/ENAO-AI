/* 44-correction-guard.js — ENAO AI learning piece (d)
 *
 * Correction priority + never-repeat-a-mistake guard + taught-fact
 * contradiction check.
 *
 * Works against the learned store spec (piece 41):
 *   localStorage key `enao_learned_items_v1`, items shaped
 *   {id, kind:'fact'|'preference'|'correction'|'skill', text, detail,
 *    lang, source, ts, topic?, status?}
 *   corrections carry kind 'correction' with detail {wrong, right}
 *   when parsed.
 *
 * Standing replacement rule: a new correction replaces conflicting old
 * behaviour immediately; the old wrong behaviour never returns. Old items
 * are marked superseded, never deleted (audit trail).
 *
 * ACCURACY RULE (Raja, 22 Nov 2026 ~6:57 PM): a taught "fact" that
 * contradicts a verified real source must be flagged plainly, never
 * silently stored as truth.
 *
 * Pure logic, no DOM, no network, no dependencies. ES5 IIFE with a
 * guarded UMD export (window.CorrectionGuard + module.exports).
 * Zero emojis. No fabricated claims.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.CorrectionGuard = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MAX_NOTE = 8;

  var STOPWORDS = {
    that: 1, this: 1, with: 1, from: 1, have: 1, been: 1, about: 1,
    into: 1, your: 1, their: 1, there: 1, when: 1, what: 1, which: 1,
    also: 1, than: 1, then: 1, them: 1, they: 1, were: 1, being: 1,
    after: 1, before: 1, should: 1, would: 1, could: 1, said: 1,
    says: 1, user: 1
  };

  var _uidCounter = 0;

  /* ---------- small helpers ---------- */

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  function normText(s) {
    return trim(String(s == null ? '' : s)).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  }

  function normTopic(t) {
    return normText(t).replace(/\s+/g, '-');
  }

  function makeId(prefix) {
    _uidCounter += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + _uidCounter +
      '_' + Math.floor(Math.random() * 1296).toString(36);
  }

  function significantTokens(text) {
    var out = [];
    var seen = {};
    var parts = normText(text).split(' ');
    var i, w;
    for (i = 0; i < parts.length; i++) {
      w = parts[i];
      if (w.length >= 4 && !STOPWORDS[w] && !seen[w]) {
        seen[w] = 1;
        out.push(w);
      }
    }
    return out;
  }

  function sharedTokens(a, b) {
    var ta = significantTokens(a);
    var tb = {};
    var i;
    var shared = [];
    var bt = significantTokens(b);
    for (i = 0; i < bt.length; i++) { tb[bt[i]] = 1; }
    for (i = 0; i < ta.length; i++) {
      if (tb[ta[i]]) { shared.push(ta[i]); }
    }
    return shared;
  }

  function containsPhrase(haystack, phrase) {
    var h = normText(haystack);
    var p = normText(phrase);
    if (!p) { return false; }
    return (' ' + h + ' ').indexOf(' ' + p + ' ') !== -1;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ---------- store access ---------- */

  // Accepts a store object {items:[...]}, a bare array of items, or
  // null/undefined (treated as an empty store). Returns the items array.
  function getItems(store) {
    if (!store) { return []; }
    if (Object.prototype.toString.call(store) === '[object Array]') {
      return store;
    }
    if (store.items && Object.prototype.toString.call(store.items) === '[object Array]') {
      return store.items;
    }
    return [];
  }

  function ensureStore(store) {
    if (store && Object.prototype.toString.call(store) !== '[object Array]' &&
        store.items && Object.prototype.toString.call(store.items) === '[object Array]') {
      return store;
    }
    if (Object.prototype.toString.call(store) === '[object Array]') {
      return { items: store };
    }
    return { items: [] };
  }

  function isActive(item) {
    if (!item) { return false; }
    var st = item.status;
    return st === undefined || st === null || st === '' || st === 'active';
  }

  function activeItems(store) {
    var items = getItems(store);
    var out = [];
    var i;
    for (i = 0; i < items.length; i++) {
      if (isActive(items[i])) { out.push(items[i]); }
    }
    return out;
  }

  function itemContent(item) {
    var parts = [];
    if (item.text) { parts.push(item.text); }
    if (item.topic) { parts.push(item.topic); }
    if (item.detail) {
      if (item.detail.wrong) { parts.push(item.detail.wrong); }
      if (item.detail.right) { parts.push(item.detail.right); }
    }
    return parts.join(' ');
  }

  /* ---------- correction parsing ---------- */

  // Best-effort parse of "not X but Y" / "wrong: X, right: Y" wording
  // into {wrong, right}. Returns null when nothing can be parsed.
  function parseCorrectionText(text) {
    var t = trim(text);
    var m;
    if (!t) { return null; }
    m = /wrong\s*[:\-]\s*(.+?)\s*[,;]\s*right\s*[:\-]\s*(.+)/i.exec(t);
    if (m) { return { wrong: trim(m[1]), right: trim(m[2]) }; }
    m = /\bnot\s+(.+?)\s+but\s+(.+)/i.exec(t);
    if (m) { return { wrong: trim(m[1]), right: trim(m[2]) }; }
    m = /(.+?)\s+is\s+wrong\s*[,.]?\s*(?:it\s+is|it'?s|it\s+should\s+be)\s+(.+)/i.exec(t);
    if (m) { return { wrong: trim(m[1]), right: trim(m[2]) }; }
    return null;
  }

  function correctionWrong(c) {
    if (c.detail && c.detail.wrong) { return trim(c.detail.wrong); }
    var parsed = parseCorrectionText(c.text || '');
    return parsed ? parsed.wrong : '';
  }

  function correctionRight(c) {
    if (c.detail && c.detail.right) { return trim(c.detail.right); }
    var parsed = parseCorrectionText(c.text || '');
    return parsed ? parsed.right : '';
  }

  /* ---------- conflict detection ---------- */

  // True when an older learned item conflicts with the correction's
  // `right` content: same topic, the corrected-wrong wording, or the
  // same subject said differently. An item that already states the
  // right version does NOT conflict.
  function conflictsWithCorrection(item, correction) {
    if (!item || item.id === correction.id) { return false; }
    if (!isActive(item)) { return false; }

    var right = correctionRight(correction);
    var wrong = correctionWrong(correction);

    if (item.topic && correction.topic &&
        normTopic(item.topic) === normTopic(correction.topic)) {
      return true;
    }

    var content = itemContent(item);
    if (wrong && wrong.length >= 4 &&
        (containsPhrase(content, wrong) || containsPhrase(wrong, content))) {
      return true;
    }

    if (right) {
      // Overlap is measured on the older item's own words (text + topic),
      // not on its stored detail: a previous correction's own right
      // wording must not make it look like it conflicts with the next
      // correction about something else.
      var ownWords = trim(item.text || '') + ' ' + trim(item.topic || '');
      if (normText(ownWords) === normText(right)) { return false; }
      if (containsPhrase(ownWords, right)) { return false; }
      var shared = sharedTokens(ownWords, right);
      if (shared.length >= 2) { return true; }
    }
    return false;
  }

  /* ---------- generic store ---------- */

  function storeLearnedItem(item, store) {
    var s = ensureStore(store);
    var it = item || {};
    if (!it.id) { it.id = makeId('item'); }
    if (!it.ts) { it.ts = Date.now(); }
    if (!it.status) { it.status = 'active'; }
    s.items.push(it);
    return { stored: it, store: s };
  }

  /* ---------- 1. applyCorrection ---------- */

  function applyCorrection(newCorrection, store) {
    var s = ensureStore(store);
    var corr = newCorrection || {};
    var item = {
      id: corr.id || makeId('corr'),
      kind: 'correction',
      text: trim(corr.text || ''),
      detail: {},
      lang: corr.lang || '',
      source: corr.source || 'user-correction',
      ts: corr.ts || Date.now(),
      status: 'active'
    };
    if (corr.topic) { item.topic = corr.topic; }
    if (corr.detail) {
      if (corr.detail.wrong) { item.detail.wrong = trim(corr.detail.wrong); }
      if (corr.detail.right) { item.detail.right = trim(corr.detail.right); }
    }
    if (!item.detail.wrong && !item.detail.right) {
      var parsed = parseCorrectionText(item.text);
      if (parsed) { item.detail = parsed; }
    }

    var supersededIds = [];
    var items = s.items;
    var i;
    for (i = 0; i < items.length; i++) {
      if (conflictsWithCorrection(items[i], item)) {
        items[i].status = 'superseded';
        items[i].supersededBy = item.id;
        items[i].supersededTs = Date.now();
        supersededIds.push(items[i].id);
      }
    }

    s.items.push(item);
    return { stored: item, supersededIds: supersededIds, store: s };
  }

  /* ---------- 2. checkAnswer ---------- */

  // Finds the literal occurrence of `wrong` inside `answer` (case
  // insensitive, punctuation tolerant). Returns the matched slice from
  // the original answer, or the stored wrong wording as a fallback.
  function findWrongInAnswer(answer, wrong) {
    var low = String(answer).toLowerCase();
    var idx = low.indexOf(String(wrong).toLowerCase());
    if (idx !== -1) {
      return String(answer).slice(idx, idx + String(wrong).length);
    }
    // Punctuation-tolerant pass: normalise both sides to words.
    if (containsPhrase(answer, wrong)) { return trim(wrong); }
    return '';
  }

  function checkAnswer(answer, store) {
    var violations = [];
    var text = String(answer == null ? '' : answer);
    if (!trim(text)) { return { violations: violations }; }
    var corrections = activeItems(store);
    var i, c, wrong, right, matched;
    for (i = 0; i < corrections.length; i++) {
      c = corrections[i];
      if (c.kind && c.kind !== 'correction') { continue; }
      wrong = correctionWrong(c);
      if (!wrong || wrong.length < 2) { continue; }
      matched = findWrongInAnswer(text, wrong);
      if (matched) {
        right = correctionRight(c);
        violations.push({
          correctionId: c.id,
          matchedText: matched,
          wrong: wrong,
          right: right
        });
      }
    }
    return { violations: violations };
  }

  /* ---------- 3. fixAnswer ---------- */

  function splitSentences(text) {
    var out = [];
    var re = /[^.!?\n]+[.!?]+["')\]]*|[^.!?\n]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var s = trim(m[0]);
      if (s) { out.push(s); }
    }
    return out.length ? out : [trim(text)];
  }

  function detectLang(text) {
    if (/[\u0600-\u06FF]/.test(text)) { return 'urdu'; }
    if (/\b(mujhe|batao|chahiye|karo|aap|aapko|sahi|galat|ghalat|samjho|likho|bhejo)\b/i.test(text)) {
      return 'roman';
    }
    if (/\b(yeh|ye|hai|nahi|nahin|kya|mera|meri|ka|ki|ko|se|mein)\b/i.test(text)) {
      var hits = text.match(/\b(yeh|ye|hai|nahi|nahin|kya|mera|meri|ka|ki|ko|se|mein)\b/gi);
      if (hits && hits.length >= 2) { return 'roman'; }
    }
    return 'en';
  }

  function correctionNoteForFix(violations, lang) {
    var rights = [];
    var i;
    for (i = 0; i < violations.length; i++) {
      if (violations[i].right && rights.indexOf(violations[i].right) === -1) {
        rights.push(violations[i].right);
      }
    }
    var rightPart = rights.length ? rights.join('; ') : '';
    if (lang === 'urdu') {
      return rightPart ?
        'نوٹ: صارف کی تصحیح یہاں لاگو ہوتی ہے — صحیح ورژن یہ ہے: ' + rightPart + '۔' :
        'نوٹ: صارف کی تصحیح یہاں لاگو ہوتی ہے — غلط جملہ ہٹا دیا گیا ہے۔';
    }
    if (lang === 'roman') {
      return rightPart ?
        'Note: user ki correction yahan laagu hoti hai — sahi version ye hai: ' + rightPart + '.' :
        'Note: user ki correction yahan laagu hoti hai — ghalat jumla hata diya gaya hai.';
    }
    return rightPart ?
      'Note: a correction from the user applies here — the correct version is: ' + rightPart + '.' :
      'Note: a correction from the user applies here — the incorrect sentence was removed.';
  }

  function fixAnswer(answer, checkResult) {
    var text = String(answer == null ? '' : answer);
    var violations = (checkResult && checkResult.violations) || [];
    if (!violations.length) {
      return { fixed: text, blocked: false, violations: violations };
    }

    var sentences = splitSentences(text);
    var badIdx = {};
    var i, j, v;
    for (i = 0; i < sentences.length; i++) {
      for (j = 0; j < violations.length; j++) {
        v = violations[j];
        if (v.wrong && containsPhrase(sentences[i], v.wrong)) {
          badIdx[i] = 1;
        }
      }
    }
    var badCount = 0;
    for (i = 0; i < sentences.length; i++) { if (badIdx[i]) { badCount += 1; } }

    var words = normText(text).split(' ').length;
    // Blocked when the answer ONLY repeats the corrected mistake as its
    // core claim: every sentence carries the mistake, or the whole
    // answer is one short mistaken claim.
    if (badCount === sentences.length || (sentences.length === 1 && words <= 40)) {
      return { fixed: null, blocked: true, violations: violations };
    }

    var kept = [];
    for (i = 0; i < sentences.length; i++) {
      if (!badIdx[i]) { kept.push(sentences[i]); }
    }
    if (!kept.length) {
      return { fixed: null, blocked: true, violations: violations };
    }

    var lang = detectLang(text);
    var fixed = kept.join(' ') + ' ' + correctionNoteForFix(violations, lang);
    return { fixed: fixed, blocked: false, violations: violations };
  }

  /* ---------- 4. checkTaughtFact ---------- */

  // A negation only counts when it negates something the taught fact
  // itself claims. "The Eiffel Tower is in Paris, not London" negates
  // London, so it contradicts a fact claiming London but not a fact
  // claiming Paris. Whole-claim words (false, incorrect, myth...) do
  // negate the entire claim.
  var WHOLE_CLAIM_RE = /\b(false|incorrect|wrong|myth|debunked|no\s+evidence)\b/i;
  var SCOPED_NEG_RE = /\b(not|isn'?t|aren'?t|doesn'?t|does\s+not|did\s+not|don'?t|can'?t|cannot|never)\b/i;

  function negationContradicts(factText, sentence) {
    if (WHOLE_CLAIM_RE.test(sentence)) { return true; }
    var m = SCOPED_NEG_RE.exec(sentence);
    if (!m) { return false; }
    var after = sentence.slice(m.index + m[0].length);
    var negated = significantTokens(after);
    var factToks = significantTokens(factText);
    var i;
    for (i = 0; i < negated.length; i++) {
      if (factToks.indexOf(negated[i]) !== -1) { return true; }
    }
    return false;
  }

  function extractNumbers(text) {
    var nums = [];
    var re = /(?:\$|£|€)?\d[\d,]*(?:\.\d+)?/g;
    var m;
    while ((m = re.exec(String(text))) !== null) {
      nums.push(m[0].replace(/[$£€,]/g, ''));
    }
    return nums;
  }

  function sourceSentences(source) {
    var t = (source && (source.text || source.snippet || '')) || '';
    return splitSentences(t);
  }

  function sourceLabel(source) {
    if (!source) { return 'a verified source'; }
    var label = trim(source.title || '') || trim(source.url || '') || 'a verified source';
    return label;
  }

  // Conservative default matcher: only a strong explicit contradiction
  // counts — a negation in a sentence about the same subject, or a
  // different number/date for the same subject. Weak similarity never
  // flags.
  function defaultMatcher(factText, source) {
    var sentences = sourceSentences(source);
    var i, s, shared, factNums, sentNums, common, k;
    for (i = 0; i < sentences.length; i++) {
      s = sentences[i];
      shared = sharedTokens(factText, s);
      if (shared.length < 2) { continue; }
      if (negationContradicts(factText, s)) {
        return {
          contradicts: true,
          evidence: sourceLabel(source) + ' says: "' + trim(s) + '"'
        };
      }
      factNums = extractNumbers(factText);
      sentNums = extractNumbers(s);
      if (factNums.length && sentNums.length) {
        common = false;
        for (k = 0; k < factNums.length; k++) {
          if (sentNums.indexOf(factNums[k]) !== -1) { common = true; }
        }
        if (!common) {
          return {
            contradicts: true,
            evidence: sourceLabel(source) + ' says: "' + trim(s) + '"'
          };
        }
      }
    }
    return { contradicts: false, evidence: null };
  }

  function checkTaughtFact(factText, verifiedSources, deps) {
    var fact = trim(factText || '');
    if (!fact) { return { contradicts: false, evidence: null }; }
    var sources = verifiedSources || [];
    var matcher = (deps && typeof deps.matcher === 'function') ?
      deps.matcher : defaultMatcher;
    var i, src, res;
    for (i = 0; i < sources.length; i++) {
      src = sources[i];
      try {
        res = matcher(fact, src);
      } catch (e) {
        res = defaultMatcher(fact, src);
      }
      if (res === true) {
        return {
          contradicts: true,
          evidence: sourceLabel(src) + ' states the opposite.'
        };
      }
      if (typeof res === 'string' && res) {
        return { contradicts: true, evidence: res };
      }
      if (res && res.contradicts) {
        return {
          contradicts: true,
          evidence: res.evidence || (sourceLabel(src) + ' states the opposite.')
        };
      }
    }
    return { contradicts: false, evidence: null };
  }

  /* ---------- 5. correctionNote ---------- */

  function correctionNote(store) {
    var corrections = activeItems(store);
    var only = [];
    var i;
    for (i = 0; i < corrections.length; i++) {
      if (!corrections[i].kind || corrections[i].kind === 'correction') {
        only.push(corrections[i]);
      }
    }
    if (!only.length) { return ''; }
    only.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    only = only.slice(0, MAX_NOTE);
    var lines = [];
    for (i = 0; i < only.length; i++) {
      var wrong = correctionWrong(only[i]);
      var right = correctionRight(only[i]);
      if (wrong && right) {
        lines.push((i + 1) + '. Never say "' + wrong + '" — say "' + right + '" instead.');
      } else if (right) {
        lines.push((i + 1) + '. Always use: "' + right + '".');
      } else if (wrong) {
        lines.push((i + 1) + '. Never say "' + wrong + '".');
      } else if (trim(only[i].text || '')) {
        lines.push((i + 1) + '. Remember this correction: "' + trim(only[i].text) + '".');
      }
    }
    if (!lines.length) { return ''; }
    return '[Corrections from the user — never repeat these mistakes:\n' +
      lines.join('\n') + ']';
  }

  return {
    applyCorrection: applyCorrection,
    checkAnswer: checkAnswer,
    fixAnswer: fixAnswer,
    checkTaughtFact: checkTaughtFact,
    correctionNote: correctionNote,
    storeLearnedItem: storeLearnedItem,
    activeItems: activeItems,
    _internals: {
      normText: normText,
      containsPhrase: containsPhrase,
      parseCorrectionText: parseCorrectionText,
      conflictsWithCorrection: conflictsWithCorrection,
      defaultMatcher: defaultMatcher,
      splitSentences: splitSentences,
      detectLang: detectLang
    }
  };
}));
