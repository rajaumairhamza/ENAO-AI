/* 43-settings.js — Settings learned-items UI + chat "forget this"
 * Piece (c) for ENAO AI (artifact slug enao-ai, live build v61-deep-triggers-4lang).
 * EXTENDS the existing Settings "What ENZO knows about me" box
 * (renderLearned / learnedBox / learnedBody in enao-ai.html) — it does NOT
 * rebuild Settings and does NOT duplicate the existing rows (language,
 * answer length, topics, corrections). It adds ONE new section under them
 * for explicit learned items from the learned store (piece 41 spec).
 *
 * Learned store spec (piece 41): localStorage key `enao_learned_items_v1`,
 * items {id, kind:'fact'|'preference'|'correction'|'skill', text, detail,
 * lang, source:'taught'|{type:'internet'|'youtube', url, title, date},
 * ts, topic?}; store API addItem/getItems/deleteItem(id)/clearAll
 * (window.EnzoLearningTeaching if present, else deps.store).
 *
 * "Forget" removes the effect IMMEDIATELY: deleting an item also calls
 * deps.onItemsChanged(), the hook the app uses to rebuild the in-memory
 * learned prompt note (see buildLearnedNote). Deleting never claims a
 * deletion that did not happen.
 *
 * Style: ES5 IIFE, guarded UMD export (window.EnzoSettingsLearned +
 * module.exports), zero emojis, all user text HTML-escaped.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EnzoSettingsLearned = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var STORE_KEY = 'enao_learned_items_v1';
  var MAX_ROWS = 50;
  var EMPTY_STATE = 'Nothing learned yet — teach ENZO something and it will appear here.';

  var KIND_LABELS = {
    fact: 'Fact',
    preference: 'Preference',
    correction: 'Correction',
    skill: 'Skill'
  };

  var TOASTS = {
    deleted: {
      en: 'Deleted — ENZO will no longer use that.',
      roman: 'Delete kar diya — ENZO ab ye use nahi karega.',
      ur: 'حذف کر دیا گیا — ENZO اب اسے استعمال نہیں کرے گا۔',
      pa: 'مٹا دتا گیا — ENZO ہن ایہنوں ورتے گا نہیں۔'
    },
    deletedAll: {
      en: 'Deleted everything ENZO learned — it will no longer use any of it.',
      roman: 'Sab kuch delete kar diya — ENZO ab kuch bhi use nahi karega.',
      ur: 'جو کچھ ENZO نے سیکھا تھا سب حذف کر دیا گیا — وہ اب کچھ بھی استعمال نہیں کرے گا۔',
      pa: 'جو کچھ ENZO نے سکھیا سی سب مٹا دتا گیا — اوہ ہن کچھ وی نہیں ورتے گا۔'
    },
    forgotLast: {
      en: 'Forgotten — ENZO will no longer use that.',
      roman: 'Bhool gaya — ENZO ab ye use nahi karega.',
      ur: 'بھول گیا — ENZO اب اسے استعمال نہیں کرے گا۔',
      pa: 'بھل گیا — ENZO ہن ایہنوں ورتے گا نہیں۔'
    },
    nothingToForget: {
      en: 'Nothing learned yet — there is nothing to forget.',
      roman: 'Abhi kuch seekha hi nahi — bhoolne ke liye kuch nahi hai.',
      ur: 'ابھی کچھ سیکھا ہی نہیں — بھولنے کے لیے کچھ نہیں ہے۔',
      pa: 'اجے کچھ سکھیا ہی نہیں — بھلن لئی کچھ نہیں ہے۔'
    },
    noMatch: {
      en: 'I could not find anything matching that in what ENZO learned — nothing was deleted.',
      roman: 'ENZO ne jo seekha hai us mein is se milta kuch nahi mila — kuch delete nahi hua.',
      ur: 'ENZO نے جو سیکھا ہے اس میں اس سے ملتا کچھ نہیں ملا — کچھ حذف نہیں ہوا۔',
      pa: 'ENZO نے جو سکھیا ہے اوس وچ ایس نال ملدا کچھ نہیں ملیا — کچھ مٹیا نہیں گیا۔'
    }
  };

  /* ---------------- helpers ---------------- */

  function escH(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function esc(deps) {
    if (deps && typeof deps.esc === 'function') return deps.esc;
    return escH;
  }

  function normLang(lang) {
    if (!lang) return 'en';
    var l = String(lang).toLowerCase();
    if (l === 'ur' || l === 'urdu') return 'ur';
    if (l === 'pa' || l === 'punjabi' || l === 'pnj') return 'pa';
    if (l === 'roman' || l === 'roman-urdu' || l === 'romanurdu') return 'roman';
    return 'en';
  }

  /* Detect the user's language from free text. Arabic script with Punjabi
   * markers -> 'pa', other Arabic script -> 'ur'; Latin with Roman-Urdu
   * markers -> 'roman'; otherwise 'en'. */
  function detectLang(text) {
    var t = String(text || '');
    if (/[\u0600-\u06FF]/.test(t)) {
      if (/ایہ|بھل|اینوں|ہن|اوہ|کجھ|سکھیا/.test(t)) return 'pa';
      return 'ur';
    }
    if (/\b(bhool|bhoolna|yaad|rakho|rakhna|jao|jaa|yeh|ye|isay|isko|karo|mujhe|meri|mera)\b/i.test(t)) return 'roman';
    return 'en';
  }

  function langOf(text, deps) {
    if (deps && deps.lang) return normLang(deps.lang);
    return detectLang(text);
  }

  function toastFor(kind, text, deps) {
    var lang = langOf(text, deps);
    var table = TOASTS[kind] || TOASTS.deleted;
    return table[lang] || table.en;
  }

  function formatDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  /* Resolve the learned store: explicit deps.store first, then the piece-41
   * global if present, then a localStorage-backed default. Returns null
   * when no store can be resolved (callers treat as empty). */
  function resolveStore(deps) {
    if (deps && deps.store) return deps.store;
    if (typeof window !== 'undefined' && window.EnzoLearningTeaching) return window.EnzoLearningTeaching;
    if (typeof localStorage !== 'undefined') {
      return {
        getItems: function () {
          try {
            var raw = localStorage.getItem(STORE_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
          } catch (e) { return []; }
        },
        deleteItem: function (id) {
          var items = this.getItems().filter(function (it) { return String(it.id) !== String(id); });
          try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) {}
          return true;
        },
        clearAll: function () {
          try { localStorage.removeItem(STORE_KEY); } catch (e) {}
          return true;
        }
      };
    }
    return null;
  }

  function getItems(store) {
    if (!store || typeof store.getItems !== 'function') return [];
    var items;
    try { items = store.getItems(); } catch (e) { return []; }
    if (!Array.isArray(items)) return [];
    return items.slice().sort(function (a, b) {
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function sourceHtml(item, escFn) {
    var src = item.source;
    if (!src || src === 'taught') return 'Taught by Raja';
    if (typeof src === 'object') {
      var title = escFn(src.title || src.url || (src.type === 'youtube' ? 'YouTube video' : 'Internet source'));
      var url = escFn(src.url || '');
      var label = src.type === 'youtube' ? 'YouTube' : 'Internet';
      if (url) return label + ': <a href="' + url + '" target="_blank" rel="noopener">' + title + '</a>';
      return label + ': ' + title;
    }
    return escFn(String(src));
  }

  /* The in-memory learned prompt note, rebuilt from the current items.
   * The app rebuilds this note inside deps.onItemsChanged() after every
   * delete, so a deleted item stops affecting answers immediately. */
  function buildLearnedNote(items) {
    var list = (items || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (!list.length) return '';
    var lines = ['Things ENZO learned from Raja:'];
    list.forEach(function (it) {
      var label = KIND_LABELS[it.kind] || 'Fact';
      var text = String(it.text || '');
      if (it.detail) text += ' — ' + String(it.detail);
      lines.push('- [' + label + '] ' + text);
    });
    return lines.join('\n');
  }

  /* ---------------- 1. render ---------------- */

  /* Renders the explicit learned-items section into `box` (a DOM element
   * or a DOM-lite object with an innerHTML property). One row per item,
   * newest first, capped at MAX_ROWS with a count line. Each row shows the
   * learned text (escaped), kind label, date, source, and a Delete button.
   * In a real DOM the buttons are wired to delete + re-render; in a
   * DOM-lite container only the HTML is produced. Returns the item count. */
  function renderLearnedItems(box, store, deps) {
    if (!box) return 0;
    deps = deps || {};
    var escFn = esc(deps);
    var items = getItems(store || resolveStore(deps));
    var h = '';
    h += '<div class="lrn-items-head"><h4>Things ENZO learned</h4>';
    h += '<p class="lrn-note">Explicit things you taught ENZO, or ENZO learned from the internet or YouTube for you. Delete anything and ENZO stops using it right away.</p></div>';
    if (!items.length) {
      h += '<div class="lrn-row"><span>' + escFn(EMPTY_STATE) + '</span></div>';
      box.innerHTML = h;
      return 0;
    }
    var shown = items.slice(0, MAX_ROWS);
    h += '<div class="lrn-count">' + (items.length > MAX_ROWS
      ? 'Showing ' + MAX_ROWS + ' of ' + items.length + ' learned items'
      : items.length + (items.length === 1 ? ' learned item' : ' learned items')) + '</div>';
    shown.forEach(function (it) {
      var kind = KIND_LABELS[it.kind] || 'Fact';
      var date = formatDate(it.ts);
      h += '<div class="lrn-item" data-lrn-id="' + escFn(it.id) + '">';
      h += '<div class="lrn-item-text">' + escFn(it.text || '') + '</div>';
      if (it.detail) h += '<div class="lrn-item-detail">' + escFn(it.detail) + '</div>';
      h += '<div class="lrn-item-meta"><span class="lrn-kind">' + escFn(kind) + '</span>';
      if (date) h += ' <span class="lrn-date">' + escFn(date) + '</span>';
      h += ' <span class="lrn-src">' + sourceHtml(it, escFn) + '</span></div>';
      h += '<button type="button" class="lrn-x" data-lrn-item="' + escFn(it.id) + '">Delete</button>';
      h += '</div>';
    });
    h += '<button type="button" class="lrn-clear" data-lrn-clear-all>Delete all learned items</button>';
    box.innerHTML = h;
    if (box.querySelectorAll) {
      box.querySelectorAll('[data-lrn-item]').forEach(function (b) {
        b.onclick = function () {
          deleteLearnedItem(b.getAttribute('data-lrn-item'), store, deps);
          renderLearnedItems(box, store, deps);
        };
      });
      var clr = box.querySelector('[data-lrn-clear-all]');
      if (clr) clr.onclick = function () {
        deleteAllLearned(store, deps);
        renderLearnedItems(box, store, deps);
      };
    }
    return items.length;
  }

  /* ---------------- 2 & 3. delete ---------------- */

  function deleteLearnedItem(id, store, deps) {
    deps = deps || {};
    var s = store || resolveStore(deps);
    if (s && typeof s.deleteItem === 'function') {
      try { s.deleteItem(id); } catch (e) {}
    }
    if (deps.onItemsChanged) { try { deps.onItemsChanged(); } catch (e) {} }
    return toastFor('deleted', '', deps);
  }

  function deleteAllLearned(store, deps) {
    deps = deps || {};
    var s = store || resolveStore(deps);
    if (s && typeof s.clearAll === 'function') {
      try { s.clearAll(); } catch (e) {}
    }
    if (deps.onItemsChanged) { try { deps.onItemsChanged(); } catch (e) {} }
    return toastFor('deletedAll', '', deps);
  }

  /* ---------------- 4. detectForget ---------------- */

  /* Chat command "forget this / forget that" in all 4 languages.
   * Returns {isForget:true, target:'last'|'named', text?} or null.
   * "Forget this" with no naming = the most recent learned item.
   * A named thing ("forget the SEO rule") -> target 'named' + named text.
   * Deliberately does NOT match "don't forget", "never forget",
   * "remember this", "I forgot my password", or "forget-me-not". */
  function detectForget(text) {
    if (text == null) return null;
    var raw = String(text).trim();
    if (!raw) return null;
    var lower = raw.toLowerCase();

    /* Guard: explicit "don't forget" / "never forget" is the opposite. */
    if (/\b(don'?t|do not|never|not)\s+forget\b/.test(lower)) return null;
    if (/forget-me-not/.test(lower)) return null;
    if (/\bi\s+forgot\b/.test(lower) && !/\bforget\s+(this|that|it|the|about)\b/.test(lower)) return null;
    /* "What did I forget to buy?" / "forget to ..." is a question, not a command. */
    if (/\bforget\s+to\b/.test(lower)) return null;
    if (/did\s+(i|you)\s+forget|have\s+i\s+forgotten|what\s+did\s+i\s+forget/.test(lower)) return null;

    /* --- English --- */
    var m;
    m = lower.match(/^(?:please\s+)?(?:forget|don'?t\s+remember|do\s+not\s+remember)\s+(this|that|it|what\s+i\s+(?:just\s+)?told\s+you|what\s+i\s+said)\b/);
    if (m) return { isForget: true, target: 'last' };
    m = lower.match(/\bforget\s+(?:this|that|it)\b/);
    if (m) return { isForget: true, target: 'last' };
    m = lower.match(/\b(?:don'?t|do\s+not)\s+remember\s+(?:this|that|it)\b/);
    if (m) return { isForget: true, target: 'last' };
    m = lower.match(/\bforget\s+(?:about\s+)?(?:the\s+)?(.+)$/);
    if (m && m[1] && !/^(this|that|it)\b/.test(m[1].trim())) {
      var named = cleanNamed(m[1]);
      if (named) return { isForget: true, target: 'named', text: named };
    }
    m = lower.match(/\bforget\s+what\s+i\s+told\s+you\s+about\s+(.+)$/);
    if (m) return { isForget: true, target: 'named', text: cleanNamed(m[1]) };

    /* --- Roman Urdu: "ye bhool jao", "ye yaad na rakho" (+ named before it) --- */
    m = lower.match(/^(yeh|ye|isay|isko|is\s+ko|yeh\s+sab)\s+(bhool\s+jao|bhool\s+ja|bhool\s+jaye|yaad\s+na\s+rakho|mat\s+yaad\s+rakho)\b/);
    if (m) return { isForget: true, target: 'last' };
    if (/\b(bhool\s+jao|bhool\s+ja|yaad\s+na\s+rakho)\b/.test(lower)) {
      var before = lower.replace(/\b(bhool\s+jao|bhool\s+ja|yaad\s+na\s+rakho)\b.*$/, '').trim()
        .replace(/^(please|plz|zara|ab)\s+/, '');
      if (before && !/^(yeh|ye|isay|isko|is|yeh\s+sab)$/.test(before)) {
        return { isForget: true, target: 'named', text: before };
      }
      return { isForget: true, target: 'last' };
    }

    /* --- Urdu script: "یہ بھول جاؤ", "یہ یاد نہ رکھو" --- */
    if (/یہ\s+(بھول\s+جاؤ|بھول\s+جا|یاد\s+نہ\s+رکھو|مت\s+یاد\s+رکھو)/.test(raw) ||
        /اسے\s+بھول\s+جاؤ/.test(raw) || /اس\s+کو\s+بھول\s+جاؤ/.test(raw)) {
      return { isForget: true, target: 'last' };
    }
    m = raw.match(/(.+?)\s*(?:کو\s*)?بھول\s+جاؤ\s*$/);
    if (m && m[1].trim() && !/^(یہ|اسے|اس)$/.test(m[1].trim())) {
      return { isForget: true, target: 'named', text: m[1].trim() };
    }
    m = raw.match(/(.+?)\s*یاد\s+نہ\s+رکھو\s*$/);
    if (m && m[1].trim() && !/^(یہ|اسے)$/.test(m[1].trim())) {
      return { isForget: true, target: 'named', text: m[1].trim() };
    }

    /* --- Punjabi Shahmukhi: "ایہ بھل جاؤ", "ایہ یاد نہ رکھو" --- */
    if (/ایہ\s+(بھل\s+جاؤ|بھل\s+جا|یاد\s+نہ\s+رکھو)/.test(raw) ||
        /اینوں\s+بھل\s+جاؤ/.test(raw)) {
      return { isForget: true, target: 'last' };
    }
    m = raw.match(/(.+?)\s*بھل\s+جاؤ\s*$/);
    if (m && m[1].trim() && !/^(ایہ|اینوں)$/.test(m[1].trim())) {
      return { isForget: true, target: 'named', text: m[1].trim() };
    }

    return null;
  }

  function cleanNamed(s) {
    return String(s || '').trim()
      .replace(/[.!?]+$/, '')
      .replace(/^(the|about)\s+/, '')
      .trim();
  }

  /* ---------------- 5. handleForget ---------------- */

  function findNamed(items, named) {
    var q = String(named || '').toLowerCase().trim();
    if (!q) return null;
    var best = null, bestScore = 0;
    items.forEach(function (it) {
      var hay = ((it.topic || '') + ' ' + (it.text || '') + ' ' + (it.detail || '')).toLowerCase();
      var score = 0;
      if ((it.topic || '').toLowerCase() === q) score = 100;
      else if (hay.indexOf(q) !== -1) score = 50 + q.length;
      else {
        var words = q.split(/\s+/).filter(function (w) { return w.length > 2; });
        var hits = 0;
        words.forEach(function (w) { if (hay.indexOf(w) !== -1) hits++; });
        if (words.length && hits === words.length) score = 20 + hits;
      }
      if (score > bestScore) { bestScore = score; best = it; }
    });
    return best;
  }

  /* Wiring entry: detect -> find item (last, or best text match) -> delete.
   * Returns {deleted:item|null, reply:string}. Never claims a deletion
   * that did not happen; a no-match reply says so plainly. */
  function handleForget(text, store, deps) {
    deps = deps || {};
    var found = detectForget(text);
    if (!found) return { deleted: null, reply: '' };
    var lang = langOf(text, deps);
    var items = getItems(store || resolveStore(deps));
    var target = null;
    if (found.target === 'named') {
      target = findNamed(items, found.text);
      if (!target) {
        return { deleted: null, reply: (TOASTS.noMatch[lang] || TOASTS.noMatch.en) };
      }
    } else {
      if (!items.length) {
        return { deleted: null, reply: (TOASTS.nothingToForget[lang] || TOASTS.nothingToForget.en) };
      }
      target = items[0]; /* newest first */
    }
    deleteLearnedItem(target.id, store, deps);
    var replyTable = TOASTS.forgotLast;
    return { deleted: target, reply: (replyTable[lang] || replyTable.en) };
  }

  return {
    STORE_KEY: STORE_KEY,
    MAX_ROWS: MAX_ROWS,
    EMPTY_STATE: EMPTY_STATE,
    KIND_LABELS: KIND_LABELS,
    escH: escH,
    formatDate: formatDate,
    buildLearnedNote: buildLearnedNote,
    renderLearnedItems: renderLearnedItems,
    deleteLearnedItem: deleteLearnedItem,
    deleteAllLearned: deleteAllLearned,
    detectForget: detectForget,
    handleForget: handleForget,
    detectLang: detectLang,
    resolveStore: resolveStore
  };
}));
