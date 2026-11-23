
/* ============================================================================
 * ENAO AI — FUTURE RULE-SETTING: Raja sets standing rules, ENZO keeps them
 * Piece P9 (09-rule-setting.js)
 * ----------------------------------------------------------------------------
 * Raja's requirement (voice call, 22 Nov 2026 ~1:10 PM PKT): later,
 * whenever Raja wants to set ANY rule, he just says 'ye system aage se
 * set rakho' (or an equivalent) and ENZO saves it as a STANDING RULE —
 * for anything, any kind of work, any topic. This capability itself must
 * be built into ENZO.
 *
 * What this piece does:
 *  - parseRuleCommand(text): recognises a rule-setting command in
 *    English, Urdu script, Roman Urdu and mixed language, and returns
 *    the rule text (cleaned) + scope (what it applies to, if stated).
 *    A bare command with no rule in it ('ye system aage se set rakho'
 *    on its own) is still recognised, but with rule: null and
 *    needsRuleText: true, so the caller can ask Raja for the rule
 *    itself (usually the sentence just before it). Ordinary chat and
 *    questions return null — never a rule.
 *  - saveRule(rule, store): persists a standing rule (id, text, scope,
 *    created date, source: Raja) under storage key 'enao_rules_v1'
 *    (localStorage in the browser, an injectable store in Node).
 *  - listRules(store), getRule(id, store), deleteRule(id, store).
 *  - applyRules(context, store): returns the ACTIVE rules relevant to
 *    a given work context (by scope / topic keywords), so ENZO applies
 *    them to future work of any kind.
 *  - Conflict handling per the standing REPLACEMENT RULE (Raja, 22 Nov
 *    2026 ~12:23 PM): a NEW instruction always wins. When a new rule
 *    conflicts with an existing one (same scope, contradictory
 *    instruction — detected by scope overlap plus an opposite side of
 *    a contradiction group), the NEW rule replaces the old one; the
 *    old one is marked replaced (status 'replaced', replacedBy,
 *    replacedAt) and kept in history, never applied again. Replacement
 *    is explicit in the data, never silent. replaceRule(id, rule,
 *    store) does the same replacement on purpose, for one named rule.
 *  - settingsRows(store): a plain data shape for a Settings list
 *    (id, text, scope, created, status active/replaced), plus an
 *    optional renderSettingsList(store, element) DOM helper.
 *
 * What it does NOT do:
 *  - No backend, no network, no paid service: rules live in local
 *    storage only. Syncing rules to another device is a later step,
 *    not this piece.
 *  - No deep language understanding: contradiction is checked with a
 *    small, explicit list of opposite pairs (short/long, Roman Urdu/
 *    English/Urdu, first/later, always/never). A contradiction the
 *    list does not know is kept as two live rules, and the EVIDENCE
 *    file says so plainly instead of pretending otherwise.
 *  - No guessing: a rule command that names no rule saves nothing
 *    until Raja supplies the rule text.
 *
 * Style: plain ES5, no dependencies, no emojis anywhere.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var STORAGE_KEY = 'enao_rules_v1';
  var RULE_SOURCE = 'Raja';

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function trim(s) {
    return asString(s).replace(/^\s+|\s+$/g, '');
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function hasUrduScript(text) {
    return /[\u0600-\u06FF]/.test(asString(text));
  }

  /* Normalise for matching: lower-case, collapse whitespace, strip
     surrounding punctuation. Urdu-script words are kept as tokens. */
  function normText(text) {
    var s = asString(text).toLowerCase();
    s = s.replace(/[\u0600-\u06FF]+/g, function (m) { return ' ' + m + ' '; });
    s = s.replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  var ROMAN_URDU_WORDS = [
    'rakho', 'bana', 'lo', 'do', 'karo', 'karna', 'aage', 'se', 'ye',
    'yeh', 'isay', 'ise', 'hamesha', 'yaad', 'aisa', 'aise', 'yehi',
    'jawab', 'aisa', 'pehle', 'baad', 'chhota', 'lamba', 'kya', 'hai'
  ];

  function detectLanguage(text) {
    var raw = asString(text);
    if (hasUrduScript(raw)) return 'ur';
    var words = normText(raw).split(' ');
    var hits = 0;
    for (var i = 0; i < words.length; i++) {
      if (ROMAN_URDU_WORDS.indexOf(words[i]) !== -1) hits++;
    }
    if (hits > 0) return 'roman';
    return 'en';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /* ------------------------------------------------------------------ */
  /* Store resolution — localStorage in the browser, injectable in Node  */
  /* ------------------------------------------------------------------ */

  var memoryStore = null;

  function getMemoryStore() {
    if (!memoryStore) {
      var data = {};
      memoryStore = {
        getItem: function (k) { return (k in data) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; }
      };
    }
    return memoryStore;
  }

  /* A store is any localStorage-compatible object (getItem / setItem /
     removeItem). The caller may pass one in; otherwise the browser's
     localStorage is used when it exists; otherwise an in-memory store
     is used so the piece never throws in Node or in a browser without
     storage. */
  function resolveStore(store) {
    if (store && typeof store.getItem === 'function' &&
        typeof store.setItem === 'function') {
      return store;
    }
    try {
      if (typeof localStorage !== 'undefined' && localStorage &&
          typeof localStorage.getItem === 'function') {
        return localStorage;
      }
    } catch (e) { /* storage unavailable: fall through to memory */ }
    return getMemoryStore();
  }

  function freshData() {
    return { version: 1, nextId: 1, rules: [] };
  }

  function loadData(store) {
    var s = resolveStore(store);
    var raw = null;
    try { raw = s.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return freshData();
    try {
      var parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !Array.isArray(parsed.rules)) {
        return freshData();
      }
      if (typeof parsed.nextId !== 'number' || parsed.nextId < 1) {
        parsed.nextId = parsed.rules.length + 1;
      }
      if (typeof parsed.version !== 'number') parsed.version = 1;
      return parsed;
    } catch (e) {
      return freshData();
    }
  }

  function saveData(store, data) {
    var s = resolveStore(store);
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function copyRule(rule) {
    if (!isPlainObject(rule)) return null;
    return {
      id: rule.id,
      text: rule.text,
      scope: rule.scope,
      created: rule.created,
      source: rule.source,
      status: rule.status,
      replacedBy: rule.replacedBy || null,
      replacedAt: rule.replacedAt || null
    };
  }

  function normRuleText(text) {
    return normText(text);
  }

  /* ------------------------------------------------------------------ */
  /* Scope detection — what the rule applies to                          */
  /* ------------------------------------------------------------------ */
  /* Ordered by specificity: the first group that matches wins the
     scope string. topics lists every group that matches, so a rule
     about 'research sources in Roman Urdu' carries both. */

  var SCOPE_KEYWORDS = [
    { scope: 'language',
      words: ['roman urdu', 'urdu', 'english', 'zuban', 'زبان', 'language'] },
    { scope: 'voice',
      words: ['voice', 'awaz', 'آواز', 'mic', 'microphone', 'bolo', 'bolna',
              'speak', 'speaking'] },
    { scope: 'research',
      words: ['research', 'tehqeeq', 'تحقیق', 'dhoond', 'search', 'sources',
              'source', 'authentic'] },
    { scope: 'seo',
      words: ['seo', 'backlink', 'guest post', 'dofollow'] },
    { scope: 'youtube',
      words: ['youtube', 'video', 'channel'] },
    { scope: 'website',
      words: ['website', 'site', 'portfolio', 'web'] },
    { scope: 'design',
      words: ['design', 'ui', 'ux', '3d'] },
    { scope: 'email',
      words: ['email', 'mail'] },
    { scope: 'coding',
      words: ['code', 'coding', 'python', 'laravel', 'javascript', 'app'] },
    { scope: 'answers',
      words: ['jawab', 'جواب', 'answer', 'reply'] }
  ];

  function scopeKeywordsFor(scope) {
    for (var i = 0; i < SCOPE_KEYWORDS.length; i++) {
      if (SCOPE_KEYWORDS[i].scope === scope) return SCOPE_KEYWORDS[i].words;
    }
    return [];
  }

  function detectScope(text) {
    var n = ' ' + normText(text) + ' ';
    var topics = [];
    for (var i = 0; i < SCOPE_KEYWORDS.length; i++) {
      var group = SCOPE_KEYWORDS[i];
      for (var j = 0; j < group.words.length; j++) {
        var w = group.words[j];
        /* 'urdu' must not match inside 'roman urdu': the language
           group is checked with the longer phrase first, and a match
           on 'roman urdu' already consumed it. A bare 'urdu' match
           here only fires when 'roman urdu' is absent. */
        if (w === 'urdu' && n.indexOf('roman urdu') !== -1) continue;
        if (n.indexOf(w) !== -1) {
          topics.push(group.scope);
          break;
        }
      }
    }
    return {
      scope: topics.length > 0 ? topics[0] : 'general',
      topics: topics
    };
  }

  /* ------------------------------------------------------------------ */
  /* parseRuleCommand(text)                                              */
  /*                                                                     */
  /* Returns null when the text is NOT a rule-setting command.           */
  /* Otherwise returns { isRuleCommand: true, rule, scope, topics,      */
  /* lang, needsRuleText, marker }. rule is the cleaned rule text, or   */
  /* null when the command names no rule (needsRuleText: true).          */
  /* ------------------------------------------------------------------ */

  /* Rule-setting markers. kind 'bare-from-now-on' is the only one that
     needs the extra guard below: 'from now on I will...' is a statement
     about the speaker, not a rule for ENZO. */
  var MARKERS = [
    /* Roman Urdu */
    { kind: 'roman', re: /\byeh?\s+system\s+aage\s+se\s+set\s+rakho\b/i },
    { kind: 'roman', re: /\bis\s+system\s+ko\s+aage\s+se\s+set\s+rakho\b/i },
    { kind: 'roman', re: /\bsystem\s+aage\s+se\s+set\s+rakho\b/i },
    { kind: 'roman', re: /\baage\s+se\s+set\s+rakho\b/i },
    { kind: 'roman', re: /\bis(?:ay|e)?\s+rule\s+bana\s*(lo|do)\b/i },
    { kind: 'roman', re: /\byeh?\s+rule\s+bana\s*(lo|do)\b/i },
    { kind: 'roman', re: /\bis\s+ko\s+rule\s+bana\s*(lo|do)?\b/i },
    { kind: 'roman', re: /\brule\s+bana\s*(lo|do)\b/i },
    { kind: 'roman', re: /\byeh?\s+hamesha\s+yaad\s+rakho\b/i },
    { kind: 'roman', re: /\bis(?:ay|e)?\s+hamesha\s+yaad\s+rakho\b/i },
    { kind: 'roman', re: /\bhamesha\s+yaad\s+rakho\b/i },
    { kind: 'roman', re: /\baage\s+se\s+(aisa|aise\s+hi|yehi)\s+karna\b/i },
    { kind: 'roman', re: /\baage\s+se\s+yehi\s+(hoga|karna)\b/i },
    { kind: 'roman', re: /\byeh?\s+rule\s+hai\s*(ke)?\b/i },
    /* English */
    { kind: 'en', re: /\bset\s+this\s+as\s+a\s+rule(\s+from\s+now\s+on)?\b/i },
    { kind: 'en', re: /\bmake\s+this\s+a\s+rule\b/i },
    { kind: 'en', re: /\bsave\s+this\s+as\s+a\s+rule\b/i },
    { kind: 'en', re: /\bremember\s+this\s+(as\s+a\s+)?rule\b/i },
    { kind: 'en', re: /\bthis\s+is\s+a\s+(standing\s+)?rule(\s+from\s+now\s+on)?\b/i },
    { kind: 'bare-from-now-on', re: /\bfrom\s+now\s+on\b/i },
    /* Urdu script */
    { kind: 'ur', re: /یہ سسٹم آگے سے سیٹ رکھو/ },
    { kind: 'ur', re: /سسٹم آگے سے سیٹ رکھو/ },
    { kind: 'ur', re: /آگے سے سیٹ رکھو/ },
    { kind: 'ur', re: /اسے رول بنا لو/ },
    { kind: 'ur', re: /یہ رول بنا لو/ },
    { kind: 'ur', re: /رول بنا لو/ },
    { kind: 'ur', re: /یہ ہمیشہ یاد رکھو/ },
    { kind: 'ur', re: /اسے ہمیشہ یاد رکھو/ },
    { kind: 'ur', re: /ہمیشہ یاد رکھو/ },
    { kind: 'ur', re: /آگے سے ایسا کرنا/ },
    { kind: 'ur', re: /یہ رول ہے کہ/ },
    { kind: 'ur', re: /یہ رول ہے/ }
  ];

  /* Words that are only pointers to the rule, never the rule itself.
     After the marker is stripped, a remainder made of only these
     means the command named no rule. */
  var FILLER_WORDS = [
    'ye', 'yeh', 'is', 'isay', 'ise', 'is ko', 'isko', 'us', 'usse',
    'this', 'that', 'it', 'yehi', 'aisa', 'aise', 'aage', 'se', 'ko',
    'ka', 'ki', 'ke', 'aur', 'bhi', 'please', 'zara', 'the', 'a', 'an'
  ];

  function stripMarker(text) {
    var matched = null;
    var cleaned = text;
    for (var i = 0; i < MARKERS.length; i++) {
      var m = MARKERS[i].re.exec(text);
      if (m) {
        matched = MARKERS[i];
        cleaned = text.slice(0, m.index) + ' ' +
          text.slice(m.index + m[0].length);
        break;
      }
    }
    return { marker: matched, cleaned: cleaned };
  }

  /* Clean the rule text left after the marker is removed: collapse
     whitespace, drop leading/trailing punctuation and connectors, drop
     a leading 'aage se' / 'from now on' (the standing nature is in the
     record, not the text). */
  function cleanRuleText(text) {
    var s = trim(asString(text).replace(/\s+/g, ' '));
    s = s.replace(/^[\s.,!?;:()\[\]"'“”‘’—–\-]+/, '');
    s = s.replace(/[\s.,!?;:()\[\]"'“”‘’—–\-]+$/, '');
    s = s.replace(/^(aage se|from now on|آگے سے)[\s,;:]+/i, '');
    s = s.replace(/[\s,;:]+(aage se|from now on)$/i, '');
    s = s.replace(/^(ke|ki|to|toh|that)\s+/i, '');
    s = trim(s.replace(/\s+/g, ' '));
    return s;
  }

  function isOnlyFiller(text) {
    var words = normText(text).split(' ').filter(function (w) {
      return w !== '';
    });
    if (words.length === 0) return true;
    for (var i = 0; i < words.length; i++) {
      if (FILLER_WORDS.indexOf(words[i]) === -1) return false;
    }
    return true;
  }

  function parseRuleCommand(text) {
    var raw = asString(text);
    if (!trim(raw)) return null;
    var lang = detectLanguage(raw);
    var found = stripMarker(raw);
    if (!found.marker) return null;

    var ruleText = cleanRuleText(found.cleaned);

    /* Guard: a bare 'from now on' followed by a statement about the
       speaker ('from now on I will...') is not a rule for ENZO. */
    if (found.marker.kind === 'bare-from-now-on' &&
        /^(i will|i'll|i am going to|main|mein)\b/i.test(ruleText)) {
      return null;
    }

    /* A question is never a rule-setting command ('aage se kya karna
       hai?', 'is this a rule?'). The markers above are imperative
       forms; a trailing '?' means the user is asking, not ordering. */
    if (/\?\s*$/.test(trim(raw))) return null;

    if (!ruleText || isOnlyFiller(ruleText)) {
      return {
        isRuleCommand: true,
        rule: null,
        scope: 'general',
        topics: [],
        lang: lang,
        needsRuleText: true,
        marker: found.marker.kind
      };
    }

    var detected = detectScope(ruleText);
    return {
      isRuleCommand: true,
      rule: ruleText,
      scope: detected.scope,
      topics: detected.topics,
      lang: lang,
      needsRuleText: false,
      marker: found.marker.kind
    };
  }

  /* ------------------------------------------------------------------ */
  /* Contradiction check (REPLACEMENT RULE)                              */
  /*                                                                     */
  /* Two rules conflict when their scopes overlap AND they take opposite
     sides of the same contradiction group. Scope 'general' overlaps
     with every scope: a universal rule and a topic rule on the same
     point do contradict.                                               */
  /* ------------------------------------------------------------------ */

  var CONTRADICTION_GROUPS = [
    { name: 'length', sides: [
      ['chhota', 'chhoti', 'short', 'mukhtasar', 'concise', 'brief'],
      ['lamba', 'lambi', 'long', 'tafseel', 'tafsil', 'detail',
       'detailed', 'gehra', 'gehrai'] ] },
    { name: 'language', sides: [
      ['roman urdu'],
      ['english'],
      ['urdu', 'اردو'] ] },
    { name: 'timing', sides: [
      ['pehle', 'pehlay', 'first'],
      ['baad', 'later', 'after'] ] },
    { name: 'frequency', sides: [
      ['hamesha', 'always', 'har dafa', 'har roz'],
      ['kabhi nahi', 'never', 'kabhi na'] ] }
  ];

  function sideOfGroup(normed, group) {
    var found = -1;
    for (var s = 0; s < group.sides.length; s++) {
      var side = group.sides[s];
      for (var w = 0; w < side.length; w++) {
        var word = side[w];
        /* 'urdu' must not match inside 'roman urdu'. */
        if (word === 'urdu' && normed.indexOf('roman urdu') !== -1) {
          continue;
        }
        if (normed.indexOf(word) !== -1) {
          if (found !== -1 && found !== s) return -2; /* both sides: unclear */
          found = s;
          break;
        }
      }
    }
    return found;
  }

  function scopesOverlap(a, b) {
    if (!a || !b) return false;
    if (a === 'general' || b === 'general') return true;
    return a === b;
  }

  function conflictsWith(ruleA, ruleB) {
    if (!isPlainObject(ruleA) || !isPlainObject(ruleB)) return false;
    if (!scopesOverlap(ruleA.scope, ruleB.scope)) return false;
    var na = ' ' + normRuleText(ruleA.text) + ' ';
    var nb = ' ' + normRuleText(ruleB.text) + ' ';
    for (var i = 0; i < CONTRADICTION_GROUPS.length; i++) {
      var group = CONTRADICTION_GROUPS[i];
      var sa = sideOfGroup(na, group);
      var sb = sideOfGroup(nb, group);
      if (sa >= 0 && sb >= 0 && sa !== sb) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Persistence: save / list / get / delete / replace                   */
  /* ------------------------------------------------------------------ */

  function buildRuleRecord(data, text, scope) {
    var detected = scope ? { scope: scope, topics: [] } : detectScope(text);
    return {
      id: 'rule_' + data.nextId,
      text: text,
      scope: detected.scope,
      created: nowIso(),
      source: RULE_SOURCE,
      status: 'active',
      replacedBy: null,
      replacedAt: null
    };
  }

  function markReplaced(data, oldRule, newId) {
    oldRule.status = 'replaced';
    oldRule.replacedBy = newId;
    oldRule.replacedAt = nowIso();
    return oldRule;
  }

  /* Save a standing rule. rule is a string ('jawab chhota ho') or an
     object { text, scope }. Returns { rule, replaced, duplicate }:
     rule is the saved record, replaced is the list of old rules this
     new rule replaced (empty when none), duplicate is true when an
     identical active rule already existed (nothing new saved). */
  function saveRule(rule, store) {
    var text = '';
    var scope = null;
    if (typeof rule === 'string') {
      text = trim(rule);
    } else if (isPlainObject(rule)) {
      text = trim(rule.text);
      if (typeof rule.scope === 'string' && trim(rule.scope)) {
        scope = trim(rule.scope);
      }
    }
    if (!text) return null;

    var data = loadData(store);
    var normed = normRuleText(text);

    /* Identical active rule already exists: keep the one copy. */
    for (var i = 0; i < data.rules.length; i++) {
      var existing = data.rules[i];
      if (existing.status === 'active' &&
          normRuleText(existing.text) === normed) {
        return { rule: copyRule(existing), replaced: [], duplicate: true };
      }
    }

    var record = buildRuleRecord(data, text, scope);
    data.nextId += 1;

    /* REPLACEMENT RULE: every conflicting active rule is replaced by
       the new one — marked, kept in history, never applied again. */
    var replaced = [];
    for (var j = 0; j < data.rules.length; j++) {
      var old = data.rules[j];
      if (old.status === 'active' && conflictsWith(record, old)) {
        markReplaced(data, old, record.id);
        replaced.push(copyRule(old));
      }
    }

    data.rules.push(record);
    saveData(store, data);
    return { rule: copyRule(record), replaced: replaced, duplicate: false };
  }

  /* Explicitly replace one named rule with a new one. Returns
     { rule, replaced } or null when the old rule does not exist or is
     not active. The old rule is marked replaced in the stored data. */
  function replaceRule(oldId, newRule, store) {
    var text = '';
    var scope = null;
    if (typeof newRule === 'string') {
      text = trim(newRule);
    } else if (isPlainObject(newRule)) {
      text = trim(newRule.text);
      if (typeof newRule.scope === 'string' && trim(newRule.scope)) {
        scope = trim(newRule.scope);
      }
    }
    if (!text) return null;

    var data = loadData(store);
    var old = null;
    for (var i = 0; i < data.rules.length; i++) {
      if (data.rules[i].id === oldId) { old = data.rules[i]; break; }
    }
    if (!old || old.status !== 'active') return null;

    var record = buildRuleRecord(data, text, scope);
    data.nextId += 1;
    markReplaced(data, old, record.id);
    data.rules.push(record);
    saveData(store, data);
    return { rule: copyRule(record), replaced: copyRule(old) };
  }

  /* List rules. By default only active rules; pass
     { includeReplaced: true } to see history too. */
  function listRules(store, options) {
    var includeReplaced = !!(options && options.includeReplaced);
    var data = loadData(store);
    var out = [];
    for (var i = 0; i < data.rules.length; i++) {
      var r = data.rules[i];
      if (r.status === 'active' || includeReplaced) out.push(copyRule(r));
    }
    return out;
  }

  function getRule(id, store) {
    if (!id) return null;
    var data = loadData(store);
    for (var i = 0; i < data.rules.length; i++) {
      if (data.rules[i].id === id) return copyRule(data.rules[i]);
    }
    return null;
  }

  /* Delete a rule entirely (active or replaced). Returns true when a
     rule was removed, false when the id did not exist. */
  function deleteRule(id, store) {
    if (!id) return false;
    var data = loadData(store);
    var kept = [];
    var removed = false;
    for (var i = 0; i < data.rules.length; i++) {
      if (data.rules[i].id === id) { removed = true; continue; }
      kept.push(data.rules[i]);
    }
    if (!removed) return false;
    data.rules = kept;
    saveData(store, data);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* applyRules(context, store)                                          */
  /*                                                                     */
  /* Returns the ACTIVE rules relevant to a work context, so ENZO        */
  /* applies them to future work of any kind. context is a string        */
  /* ('research bitcoin') or an object { text, scope, topic }. A rule    */
  /* applies when its scope is 'general' (a universal standing rule),   */
  /* when it matches the context's scope, or when a keyword of its       */
  /* scope appears in the context text. Replaced rules are never         */
  /* returned.                                                           */
  /* ------------------------------------------------------------------ */

  function applyRules(context, store) {
    var ctxText = '';
    var ctxScope = null;
    if (typeof context === 'string') {
      ctxText = context;
    } else if (isPlainObject(context)) {
      ctxText = asString(context.text || context.topic || '');
      if (typeof context.scope === 'string' && trim(context.scope)) {
        ctxScope = trim(context.scope);
      }
    }
    var normedCtx = ' ' + normText(ctxText) + ' ';
    if (!ctxScope && ctxText) {
      ctxScope = detectScope(ctxText).scope;
    }

    var active = listRules(store);
    var out = [];
    for (var i = 0; i < active.length; i++) {
      var rule = active[i];
      if (rule.scope === 'general') { out.push(copyRule(rule)); continue; }
      /* A rule matches on its scope OR on any of its topics: a rule
         about 'YouTube videos ka SEO' carries topics seo + youtube,
         so it applies to a YouTube-video context as well as an SEO
         one. Topics are recomputed from the stored text, so rules
         saved before topics existed still match. */
      var ruleTopics = detectScope(rule.text).topics;
      if (ruleTopics.indexOf(rule.scope) === -1) {
        ruleTopics.push(rule.scope);
      }
      var matched = false;
      for (var t = 0; t < ruleTopics.length && !matched; t++) {
        var topic = ruleTopics[t];
        if (ctxScope && topic === ctxScope) { matched = true; break; }
        var words = scopeKeywordsFor(topic);
        for (var j = 0; j < words.length; j++) {
          var w = words[j];
          if (w === 'urdu' && normedCtx.indexOf('roman urdu') !== -1) {
            continue;
          }
          if (normedCtx.indexOf(w) !== -1) { matched = true; break; }
        }
      }
      if (matched) out.push(copyRule(rule));
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Settings list shape + optional DOM render                           */
  /* ------------------------------------------------------------------ */

  /* Plain data shape for a Settings list: every rule (active first,
     then replaced history), each with id, text, scope, created and
     status. The assembler renders this; nothing here assumes a DOM. */
  function settingsRows(store) {
    var all = listRules(store, { includeReplaced: true });
    var active = [];
    var replaced = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].status === 'active') active.push(all[i]);
      else replaced.push(all[i]);
    }
    return active.concat(replaced);
  }

  /* Optional DOM helper: renders the Settings list into a container
     element. Each row shows the rule text, its scope and its status,
     plus a delete button (data-rule-id) that deletes the rule and
     re-renders. Returns the list element, or null when there is no
     document or no container. */
  function renderSettingsList(store, container) {
    if (typeof document === 'undefined' || !document.createElement) {
      return null;
    }
    if (!container || typeof container.appendChild !== 'function') {
      return null;
    }
    var rows = settingsRows(store);
    var list = document.createElement('ul');
    list.className = 'enzo-rules-list';
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        var li = document.createElement('li');
        li.className = 'enzo-rules-row enzo-rules-row-' + row.status;
        li.setAttribute('data-rule-id', row.id);
        var text = document.createElement('span');
        text.className = 'enzo-rules-text';
        text.textContent = row.text;
        li.appendChild(text);
        var meta = document.createElement('span');
        meta.className = 'enzo-rules-meta';
        meta.textContent = row.scope + ' — ' + row.status +
          (row.created ? ' — ' + row.created.slice(0, 10) : '');
        li.appendChild(meta);
        if (row.status === 'active') {
          var btn = document.createElement('button');
          btn.className = 'enzo-rules-delete';
          btn.setAttribute('data-rule-id', row.id);
          btn.textContent = 'Delete';
          btn.addEventListener('click', function () {
            deleteRule(row.id, store);
            renderSettingsList(store, container);
          });
          li.appendChild(btn);
        }
        list.appendChild(li);
      })(rows[i]);
    }
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(list);
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Confirmation lines, in the user's language                          */
  /* ------------------------------------------------------------------ */

  var CONFIRM = {
    saved: {
      ur: 'Theek hai — ye rule save kar diya gaya hai, aage se is par amal hoga.',
      roman: 'Theek hai — ye rule save kar diya gaya hai, aage se is par amal hoga.',
      en: 'Done — this rule is saved and will apply from now on.'
    },
    replaced: {
      ur: 'Theek hai — naya rule save ho gaya hai, aur purana rule jo is se takrata tha, wo khatam kar diya gaya hai.',
      roman: 'Theek hai — naya rule save ho gaya hai, aur purana rule jo is se takrata tha, wo khatam kar diya gaya hai.',
      en: 'Done — the new rule is saved, and the old rule it contradicted has been replaced.'
    },
    deleted: {
      ur: 'Wo rule delete kar diya gaya hai.',
      roman: 'Wo rule delete kar diya gaya hai.',
      en: 'That rule has been deleted.'
    },
    needsRule: {
      ur: 'Theek hai — kaunsa rule set karna hai, wo batayein.',
      roman: 'Theek hai — kaunsa rule set karna hai, wo batayein.',
      en: 'Understood — tell me which rule to set.'
    }
  };

  function confirmText(kind, lang) {
    var group = CONFIRM[kind] || CONFIRM.saved;
    return group[lang] || group.en;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  var api = {
    parseRuleCommand: parseRuleCommand,
    saveRule: saveRule,
    listRules: listRules,
    getRule: getRule,
    deleteRule: deleteRule,
    replaceRule: replaceRule,
    applyRules: applyRules,
    conflictsWith: conflictsWith,
    detectScope: detectScope,
    detectLanguage: detectLanguage,
    settingsRows: settingsRows,
    renderSettingsList: renderSettingsList,
    confirmText: confirmText,
    STORAGE_KEY: STORAGE_KEY,
    /* Test-only seam (not for production use): clears the in-memory
       fallback store used when no store is passed and no localStorage
       exists. */
    _resetForTest: function () {
      memoryStore = null;
    }
  };

  try {
    if (typeof window !== 'undefined') window.EnzoRules = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoRules = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
