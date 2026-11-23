
/* ============================================================================
   ENAO AI — universal-intel PIECE D2: universal output quality + validation
   File: 17-validation.js
   Artifact: enao-ai (web_static). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
   DO NOT EDIT ANY OTHER FILE. No backend change needed.

   PURPOSE
   -------
   Universal output quality and validation (section 9). Every answer and
   generated artefact is checked BEFORE it is delivered: relevance,
   completeness, logical consistency, language quality, formatting and
   requirements match for answers; lightweight syntax sanity for code;
   source honesty for research reports; style and purpose alignment for
   creative output; and real evidence — not a bare claim — for external
   actions. Nothing here names a subject: checks read the request, the
   requirements and the output themselves, so the same validators apply
   to any subject.

   PUBLIC API (pure functions, no DOM, no network, no dependencies)
   ----------------------------------------------------------------
   validateAnswer(answer, ctx)
     -> { ok, issues }. issues is an array of { code, message }.
        Checks: empty answer; relevance to ctx.question / ctx.topic
        (shared content words); completeness against
        ctx.requiredPoints / ctx.requirements; logical consistency
        (the same short phrase stated and denied); language quality
        (placeholder leftovers, a run-on sentence, shouting in all
        caps); formatting against ctx.format ('list' needs list
        markers); length against ctx.minWords / ctx.maxWords.
   validateCode(code, lang)
     -> { ok, issues }. Lightweight static checks only, no execution:
        balanced (), [], {} ignoring strings and comments; balanced
        quotes; empty code; a TODO / FIXME left in the code; an
        obviously broken line such as a lone closing bracket. lang
        only picks the comment style ('python' uses #; anything else
        uses // and block comments).
   validateResearch(report, ctx)
     -> { ok, issues }. Checks: sources exist; every claim carries at
        least one real source; no invented or invalid URL (a URL that
        is not a well-formed address, or a placeholder host); every
        source dated; contradictions disclosed, never hidden; the same
        source address not counted twice as two sources.
   validateCreative(output, ctx)
     -> { ok, issues }. Checks: empty output; purpose / topic
        relevance against ctx.purpose / ctx.topic / ctx.question;
        required elements present (ctx.requiredElements); forbidden
        elements absent (ctx.forbiddenElements); tone against
        ctx.tone ('formal' rejects slang markers); length against
        ctx.minWords / ctx.maxWords.
   validateAction(result, ctx)
     -> { ok, issues }. Checks: a result exists; the action is marked
        performed with a success status; real evidence is present (an
        id, a receipt, a confirmation, or a success status) — a bare
        "done" with no evidence is not a performed action; the action
        matches ctx.expectedAction; a failed status is reported as a
        failure, never as success.

   Every validator returns { ok, issues } and NEVER throws on bad
   input: null, a wrong type, or a missing field becomes an issue,
   not an exception.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing piece style. Zero emojis.
   ========================================================================== */

/* ---------- small helpers ---------- */
function vaTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function vaIsObj(v) { return v !== null && typeof v === 'object' && !(v instanceof Array); }
function vaIssue(code, message) { return { code: code, message: message }; }
function vaResult(issues) { return { ok: issues.length === 0, issues: issues }; }
function vaWordCount(s) {
  var t = vaTrim(s);
  return t ? t.split(/\s+/).length : 0;
}
/* Content words: lower-case tokens minus stopwords in English, Roman
   Urdu and Urdu script. Topics are never listed: whatever content
   words are left ARE the subject of the text. */
var VA_STOP = {};
(function () {
  var words = ('what is are was were who whom whose when where why how which ' +
    'that this it its the a an of about tell me please explain in simple words ' +
    'define definition meaning do does did you your think know can could would ' +
    'should give list and or for to on with by from as at first also more some ' +
    'any all new lets let us discuss talk research using sources actually ' +
    'change topic per anymore again just like want need go deeper into compare ' +
    'something else be been being have has had there here they them their he ' +
    'she his her we our i my am not no yes if then than so but very really ' +
    'quite only even still already now today second create creates created ' +
    'make makes made invent invents invented found founded discover discovers ' +
    'discovered write writes wrote written build builds built develop develops ' +
    'developed produce produces produced cause causes caused happen happens ' +
    'happened work works worked use uses used come comes came goes went take ' +
    'takes took get gets got gives gave say says said see sees saw knows knew ' +
    'thinks thought feel feels felt live lives lived grow grows grew help helps ' +
    'helped show shows showed play plays played run runs ran start starts ' +
    'started stop stops stopped changes changed mean means meant call calls ' +
    'called name names named set sets put puts keep keeps kept find finds ask ' +
    'asks asked answer answers answered learn learns learned study studies ' +
    'studied teach teaches taught read reads speak speaks spoke listen listens ' +
    'listened watch watches watched look looks looked try tries tried needs ' +
    'needed wants wanted likes liked love loves loved become becomes became ' +
    'seem seems seemed will shall may might must ' +
    'kya kia hai ha hain hen ka ki ke ko se mein me par pe batao batayein ' +
    'bataen samjhao samjhaen samjhaein konsa kaunsa kyun kab kaisa mera meri ' +
    'mere mujhe aap ap tum tu yeh ye woh wo nahi nahin aur tha thi the kar ' +
    'karo karein chahiye wala wali aj aaj kal bohat bahut acha achha theek ' +
    'thik rahe rahay rahy ho is us isko usko iska iske iski uska uske uski ' +
    'kis kisne ne banaya banaye banata karta karte karti karna karne hona ' +
    'hone jana jane aana aane dena dene lena lene milna milne matlab kehte ' +
    'kehtay pehle ab chalo baat zara cheez hota hoti hote sunao shukriya na ' +
    'hi toh to phir bhi ya jo jis jin raha rahi ga gi ge jayega jayegi lage ' +
    'lagega time kitne kitna kitni kahan kidhar kaun kon konsi kaunsi aisi ' +
    'aisay aise waisay aisa waisa thora thoda zyada kam hoon hun gaya gayi ' +
    'gaye aaya aayi aaye lagta lagti lagte hoga hogi').split(' ');
  var i;
  for (i = 0; i < words.length; i++) VA_STOP[words[i]] = 1;
})();
function vaContentWords(text) {
  var tokens = String(text || '').toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}_\/\\\-–—~…؟۔،؛]+/g, ' ')
    .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').split(/\s+/);
  var out = [], i;
  for (i = 0; i < tokens.length; i++) {
    var w = tokens[i];
    if (!w || VA_STOP[w] || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}
function vaStem(w) {
  w = String(w || '');
  if (w.length > 3 && w.slice(-1) === 's') return w.slice(0, -1);
  return w;
}
function vaSharedWords(a, b) {
  var aw = vaContentWords(a), bw = vaContentWords(b);
  var i, j, shared = 0;
  for (i = 0; i < aw.length; i++) {
    for (j = 0; j < bw.length; j++) {
      if (vaStem(aw[i]) === vaStem(bw[j])) { shared++; break; }
    }
  }
  return shared;
}
function vaMentions(text, point) {
  var words = vaContentWords(point);
  if (!words.length) return vaTrim(text).toLowerCase().indexOf(vaTrim(point).toLowerCase()) !== -1;
  var hits = 0, i;
  var hay = vaContentWords(text);
  for (i = 0; i < words.length; i++) {
    var j;
    for (j = 0; j < hay.length; j++) {
      if (vaStem(words[i]) === vaStem(hay[j])) { hits++; break; }
    }
  }
  /* A required point counts as covered when at least half its content
     words appear, or its full phrase appears verbatim. */
  return hits * 2 >= words.length ||
    vaTrim(text).toLowerCase().indexOf(vaTrim(point).toLowerCase()) !== -1;
}
function vaLengthCheck(text, ctx, issues) {
  var words = vaWordCount(text);
  if (ctx && typeof ctx.minWords === 'number' && words < ctx.minWords) {
    issues.push(vaIssue('too-short', 'answer is ' + words + ' words, but at least ' + ctx.minWords + ' were required'));
  }
  if (ctx && typeof ctx.maxWords === 'number' && words > ctx.maxWords) {
    issues.push(vaIssue('too-long', 'answer is ' + words + ' words, but at most ' + ctx.maxWords + ' were allowed'));
  }
}
function vaRequirementsCheck(text, ctx, issues) {
  var req = null;
  if (ctx) {
    if (ctx.requiredPoints instanceof Array) req = ctx.requiredPoints;
    else if (ctx.requirements instanceof Array) req = ctx.requirements;
  }
  if (!req) return;
  var i;
  for (i = 0; i < req.length; i++) {
    var point = typeof req[i] === 'string' ? req[i] : (vaIsObj(req[i]) ? (req[i].text || req[i].point || '') : '');
    if (!vaTrim(point)) continue;
    if (!vaMentions(text, point)) {
      issues.push(vaIssue('missing-point', 'required point not covered: ' + vaTrim(point)));
    }
  }
}

/* ---------- PUBLIC: validateAnswer ---------- */
function validateAnswer(answer, ctx) {
  var issues = [];
  if (typeof answer !== 'string' || !vaTrim(answer)) {
    issues.push(vaIssue('empty-answer', 'the answer is empty'));
    return vaResult(issues);
  }
  var text = answer;
  /* Relevance: the answer must share at least one content word with
     the question or the stated topic. A one-word answer ("Yes") is
     exempt: it has no content to compare. */
  var subject = ctx ? (ctx.question || ctx.topic || '') : '';
  if (vaTrim(subject) && vaWordCount(text) > 1 && vaContentWords(subject).length) {
    if (vaSharedWords(text, subject) === 0) {
      issues.push(vaIssue('off-topic', 'the answer shares no content word with the question or topic'));
    }
  }
  /* Completeness + requirements match. */
  vaRequirementsCheck(text, ctx, issues);
  /* Logical consistency: the same short phrase stated and denied
     ("is open" and "is not open", "are ready" and "are not ready"). */
  var lower = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  var m, seen = {};
  var re = /\b(is|are|was|were|has|have)\s+not\s+([a-z][a-z ]{0,20}?)\b/g;
  while ((m = re.exec(lower)) !== null) {
    var denied = vaTrim(m[2]);
    if (denied && !seen[denied]) {
      seen[denied] = 1;
      var affirmed = new RegExp('\\b' + m[1] + '\\s+' + denied.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (affirmed.test(lower)) {
        issues.push(vaIssue('contradiction', 'the answer both states and denies: "' + m[1] + ' ' + denied + '"'));
      }
    }
  }
  /* Language quality. */
  if (/\[(TODO|FIXME|XXX)\]|\{[^}]{0,30}(placeholder|todo)\}|lorem ipsum/i.test(text)) {
    issues.push(vaIssue('placeholder-left', 'the answer still contains a placeholder or filler text'));
  }
  var sentences = text.split(/[.!?]+/);
  var i;
  for (i = 0; i < sentences.length; i++) {
    if (vaWordCount(sentences[i]) > 80) {
      issues.push(vaIssue('run-on-sentence', 'one sentence is over 80 words long'));
      break;
    }
  }
  var letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 20) {
    var upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper * 10 >= letters.length * 9) {
      issues.push(vaIssue('all-caps', 'the answer is written in all capital letters'));
    }
  }
  /* Formatting: a list was asked for, so list markers must be there. */
  if (ctx && (ctx.format === 'list' || ctx.requiresList === true)) {
    if (!/(^|\n)\s*([-*•]|\d+[.)])\s+\S/.test(text)) {
      issues.push(vaIssue('format-mismatch', 'a list was requested but the answer has no list items'));
    }
  }
  vaLengthCheck(text, ctx, issues);
  return vaResult(issues);
}

/* ---------- PUBLIC: validateCode ---------- */
function validateCode(code, lang) {
  var issues = [];
  if (typeof code !== 'string' || !vaTrim(code)) {
    issues.push(vaIssue('empty-code', 'no code was supplied'));
    return vaResult(issues);
  }
  var isPython = String(lang || '').toLowerCase().indexOf('python') !== -1;
  var lines = code.split('\n');
  var stack = [];
  var openers = { '(': ')', '[': ']', '{': '}' };
  var closers = { ')': '(', ']': '[', '}': '{' };
  var inSingle = false, inDouble = false, inTemplate = false, escaped = false;
  var inBlockComment = false;
  var quoteLine = 0;
  var i, j;
  for (i = 0; i < lines.length; i++) {
    var line = lines[i];
    var inLineComment = false;
    for (j = 0; j < line.length; j++) {
      var ch = line.charAt(j);
      var next = j + 1 < line.length ? line.charAt(j + 1) : '';
      if (escaped) { escaped = false; continue; }
      if (inSingle || inDouble || inTemplate) {
        if (ch === '\\') { escaped = true; continue; }
        if (inSingle && ch === "'") inSingle = false;
        else if (inDouble && ch === '"') inDouble = false;
        else if (inTemplate && ch === '`') inTemplate = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (inLineComment) break;
      if (isPython) {
        if (ch === '#') { inLineComment = true; break; }
      } else {
        if (ch === '/' && next === '/') { inLineComment = true; break; }
        if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      }
      if (ch === "'") { inSingle = true; quoteLine = i + 1; continue; }
      if (ch === '"') { inDouble = true; quoteLine = i + 1; continue; }
      if (ch === '`') { inTemplate = true; quoteLine = i + 1; continue; }
      if (openers[ch]) { stack.push({ ch: ch, line: i + 1 }); continue; }
      if (closers[ch]) {
        if (!stack.length) {
          issues.push(vaIssue('unbalanced-bracket', 'closing "' + ch + '" on line ' + (i + 1) + ' has no matching opener'));
        } else {
          var top = stack[stack.length - 1];
          if (top.ch === closers[ch]) stack.pop();
          else {
            issues.push(vaIssue('mismatched-bracket', 'closing "' + ch + '" on line ' + (i + 1) + ' does not match opener "' + top.ch + '" from line ' + top.line));
            stack.pop();
          }
        }
      }
    }
  }
  if (inSingle || inDouble || inTemplate) {
    issues.push(vaIssue('unbalanced-quote', 'a quote opened on line ' + quoteLine + ' is never closed'));
  }
  if (inBlockComment) {
    issues.push(vaIssue('unclosed-comment', 'a block comment is never closed'));
  }
  for (i = stack.length - 1; i >= 0; i--) {
    issues.push(vaIssue('unbalanced-bracket', 'opener "' + stack[i].ch + '" on line ' + stack[i].line + ' is never closed'));
  }
  if (/\b(TODO|FIXME|XXX)\b/.test(code)) {
    issues.push(vaIssue('incomplete-code', 'the code still contains a TODO / FIXME marker'));
  }
  return vaResult(issues);
}

/* ---------- research helpers ---------- */
function vaUrlLooksInvented(url) {
  var u = vaTrim(url);
  if (!u) return true;
  if (/[\s\[\]{}<>]/.test(u)) return true;
  if (/example\.(com|org|net)|placeholder|your-?domain|domain\.com/i.test(u)) return true;
  if (!/^https?:\/\/[a-z0-9][a-z0-9\-]*(\.[a-z0-9\-]+)+(\/\S*)?$/i.test(u)) return true;
  return false;
}
function vaReportSources(report) {
  if (!vaIsObj(report)) return [];
  if (report.sources instanceof Array) return report.sources;
  if (report.sourceList instanceof Array) return report.sourceList;
  return [];
}
function vaReportClaims(report) {
  if (!vaIsObj(report)) return [];
  if (report.claims instanceof Array) return report.claims;
  if (report.findings instanceof Array) return report.findings;
  return [];
}
function vaSourceUrl(src) {
  if (typeof src === 'string') return src;
  if (vaIsObj(src)) return vaTrim(src.url || src.source_url || src.link || '');
  return '';
}
function vaSourceDate(src) {
  if (!vaIsObj(src)) return '';
  return vaTrim(src.date || src.publishedAt || src.published || src.checked_at || src.checkedAt || '');
}

/* ---------- PUBLIC: validateResearch ---------- */
function validateResearch(report, ctx) {
  var issues = [];
  if (!vaIsObj(report)) {
    issues.push(vaIssue('no-report', 'no research report was supplied'));
    return vaResult(issues);
  }
  var sources = vaReportSources(report);
  var claims = vaReportClaims(report);
  if (!sources.length) {
    issues.push(vaIssue('missing-sources', 'the report lists no sources'));
  }
  /* Every claim must carry at least one real source: a source id or
     URL that actually appears in the report's source list. */
  var knownUrls = {}, knownIds = {}, i, j;
  for (i = 0; i < sources.length; i++) {
    var u = vaSourceUrl(sources[i]).toLowerCase();
    if (u) knownUrls[u] = 1;
    if (vaIsObj(sources[i]) && sources[i].id) knownIds[String(sources[i].id)] = 1;
  }
  for (i = 0; i < claims.length; i++) {
    var claim = claims[i];
    var text = typeof claim === 'string' ? claim : (vaIsObj(claim) ? vaTrim(claim.text || claim.claim || '') : '');
    var claimSources = vaIsObj(claim) ? (claim.sources || claim.sourceIds || claim.source_urls || []) : [];
    if (!(claimSources instanceof Array)) claimSources = [];
    var real = 0;
    for (j = 0; j < claimSources.length; j++) {
      var ref = typeof claimSources[j] === 'string' ? claimSources[j] : (vaIsObj(claimSources[j]) ? vaSourceUrl(claimSources[j]) || String(claimSources[j].id || '') : '');
      if (!ref) continue;
      if (knownUrls[ref.toLowerCase()] || knownIds[ref]) real++;
    }
    if (!real) {
      issues.push(vaIssue('unsupported-claim', 'claim has no real source in the report: ' + (text ? text.slice(0, 80) : 'claim ' + (i + 1))));
    }
  }
  /* No invented URLs, and no source counted twice as two sources. */
  var seenUrls = {};
  var undated = 0;
  for (i = 0; i < sources.length; i++) {
    var url = vaSourceUrl(sources[i]);
    if (vaUrlLooksInvented(url)) {
      issues.push(vaIssue('invented-url', 'source URL looks invented or invalid: ' + (url || 'missing URL')));
    } else if (url) {
      var key = url.toLowerCase();
      if (seenUrls[key]) {
        issues.push(vaIssue('duplicate-source', 'the same source address is listed twice: ' + url));
      }
      seenUrls[key] = 1;
    }
    if (!vaSourceDate(sources[i])) undated++;
  }
  if (sources.length && undated) {
    issues.push(vaIssue('missing-date', undated + ' of ' + sources.length + ' source(s) have no date'));
  }
  /* Contradictions must be disclosed, never hidden. */
  var conflicts = report.contradictions || report.conflicts || report.contradictoryClaims || null;
  var hasConflict = conflicts instanceof Array && conflicts.length > 0;
  var disclosed = report.contradictionsDisclosed === true || report.disclosedContradictions === true ||
    (typeof report.note === 'string' && /contradict/i.test(report.note));
  if (hasConflict && !disclosed) {
    issues.push(vaIssue('undisclosed-contradiction', conflicts.length + ' contradiction(s) found but not disclosed in the report'));
  }
  if (ctx && ctx.requireSources === true && !sources.length) {
    /* Already reported as missing-sources; no second issue. */
  }
  return vaResult(issues);
}

/* ---------- PUBLIC: validateCreative ---------- */
function validateCreative(output, ctx) {
  var issues = [];
  if (typeof output !== 'string' || !vaTrim(output)) {
    issues.push(vaIssue('empty-output', 'the creative output is empty'));
    return vaResult(issues);
  }
  var text = output;
  var subject = ctx ? (ctx.topic || ctx.question || ctx.purpose || '') : '';
  if (vaTrim(subject) && vaWordCount(text) > 1 && vaContentWords(subject).length) {
    if (vaSharedWords(text, subject) === 0) {
      issues.push(vaIssue('off-brief', 'the output shares no content word with the brief or topic'));
    }
  }
  /* Required elements present, forbidden elements absent. */
  if (ctx && ctx.requiredElements instanceof Array) {
    var i;
    for (i = 0; i < ctx.requiredElements.length; i++) {
      var el = vaTrim(ctx.requiredElements[i]);
      if (!el) continue;
      if (!vaMentions(text, el)) {
        issues.push(vaIssue('missing-element', 'required element not present: ' + el));
      }
    }
  }
  if (ctx && ctx.forbiddenElements instanceof Array) {
    var k;
    for (k = 0; k < ctx.forbiddenElements.length; k++) {
      var bad = vaTrim(ctx.forbiddenElements[k]);
      if (!bad) continue;
      if (vaMentions(text, bad) || text.toLowerCase().indexOf(bad.toLowerCase()) !== -1) {
        issues.push(vaIssue('forbidden-element', 'forbidden element present: ' + bad));
      }
    }
  }
  /* Tone: a formal brief rejects slang markers; nothing else is
     tone-checked, so a playful brief is never punished for being
     playful. */
  if (ctx && String(ctx.tone || '').toLowerCase() === 'formal') {
    if (/\b(gonna|wanna|lol|omg|hey guys|yeah+|nah+|kinda|sorta)\b/i.test(text)) {
      issues.push(vaIssue('tone-mismatch', 'the output uses informal slang but a formal tone was requested'));
    }
  }
  if (ctx && String(ctx.tone || '').toLowerCase() === 'formal' && /!!!+/.test(text)) {
    issues.push(vaIssue('tone-mismatch', 'the output uses excited punctuation but a formal tone was requested'));
  }
  vaLengthCheck(text, ctx, issues);
  return vaResult(issues);
}

/* ---------- PUBLIC: validateAction ---------- */
function validateAction(result, ctx) {
  var issues = [];
  if (result == null || (typeof result !== 'object' && typeof result !== 'string')) {
    issues.push(vaIssue('no-result', 'no action result was supplied'));
    return vaResult(issues);
  }
  if (typeof result === 'string') {
    issues.push(vaIssue('evidence-missing', 'the action is only claimed in words, with no evidence of it being performed'));
    return vaResult(issues);
  }
  var status = String(result.status || result.state || '').toLowerCase();
  if (status === 'failed' || status === 'error' || result.error) {
    issues.push(vaIssue('action-failed', 'the action reported a failure' + (result.error ? ': ' + vaTrim(String(result.error)).slice(0, 120) : '')));
    return vaResult(issues);
  }
  var performed = result.performed === true || result.done === true || result.success === true ||
    status === 'success' || status === 'completed' || status === 'done';
  if (!performed) {
    issues.push(vaIssue('action-not-confirmed', 'the result does not show the action as performed'));
  }
  var evidence = vaTrim(result.id || result.receipt || result.receiptId || result.confirmation ||
    result.confirmationId || result.reference || result.ticket || '');
  var hasEvidence = !!evidence || status === 'success' || status === 'completed' || status === 'done' ||
    (result.evidence != null && vaTrim(String(result.evidence)) !== '');
  if (performed && !hasEvidence) {
    issues.push(vaIssue('evidence-missing', 'the action is claimed as done but carries no evidence (no id, receipt, confirmation or success status)'));
  }
  if (!performed && !hasEvidence) {
    issues.push(vaIssue('evidence-missing', 'no evidence that the action was performed'));
  }
  if (ctx && vaTrim(ctx.expectedAction || '')) {
    var actual = vaTrim(result.action || result.type || result.kind || '');
    if (actual && actual.toLowerCase() !== vaTrim(ctx.expectedAction).toLowerCase()) {
      issues.push(vaIssue('wrong-action', 'expected action "' + vaTrim(ctx.expectedAction) + '" but the result shows "' + actual + '"'));
    }
    if (!actual && !performed) {
      issues.push(vaIssue('wrong-action', 'no action named in the result, expected "' + vaTrim(ctx.expectedAction) + '"'));
    }
  }
  return vaResult(issues);
}

/* ---------- export tail (guarded) ---------- */
var VERSION = '17-validation v1.0 (enao-universal-intel, 22 Nov 2026)';

var EnzoUniversalValidation = {
  VERSION: VERSION,
  validateAnswer: validateAnswer,
  validateCode: validateCode,
  validateResearch: validateResearch,
  validateCreative: validateCreative,
  validateAction: validateAction
};

(function (root) {
  if (typeof root !== 'undefined') root.EnzoUniversalValidation = EnzoUniversalValidation;
  if (typeof module !== 'undefined' && module.exports) module.exports = EnzoUniversalValidation;
})(typeof window !== 'undefined' ? window : this);
