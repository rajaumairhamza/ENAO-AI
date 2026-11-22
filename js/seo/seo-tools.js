
/* ============================================================================
   ENAO AI master-intel — PIECE 05: ENZO's OWN SEO toolkit (frontend)
   File: 05-seo-tools.js
   Artifact: enao-ai (web_static). DO NOT EDIT THE ARTIFACT. DO NOT DEPLOY.
   Piece build only. Backend: ~/workspace/enao-platform/seo/ (stdlib-only
   Python package) + POST /api/v2/seo/* endpoints in server/server.py.

   PURPOSE
   -------
   All nine of ENZO's own SEO tools, as Tools-menu entries and chat
   commands, routed to ENZO's own backend endpoints. ENZO's engine is
   fully self-contained (own crawler / analyzer / scorer / database):
   it never fetches a DA checker site, Semrush, Ahrefs, Moz, or any
   external SEO API. Scores are ENZO's own, 0-100, labelled as such.
   Proprietary metrics (Moz DA, Ahrefs DR, Moz PA, Google PR, Moz Spam
   Score, absolute monthly traffic, absolute keyword search volume)
   are always 'available nahi' with one line saying why — never a
   number, never borrowed.

   DISPLAY RULE (Raja, voice call 22 Nov 2026 ~12:41 PM — REPLACES the
   old long-detail display; the old display is out, this is in):
   SEO data is shown SHORT. For each tool/check the default view is
   only a SMALL BUTTON (label + the headline number). Click the button
   and the data comes out. NO long detail is written under every item
   by default. Traceability is intact — every number's evidence
   (source URL + date + method + self-check) exists BEHIND its button
   and is revealed only on click, never by default. The backend report
   structure is unchanged (it still carries full traceability); only
   this default presentation is compact.

   ACCURACY RULE (unchanged): numbers must be accurate — Raja checks
   them against Ahrefs, Semrush and Moz. ENZO's scores will NOT equal
   those tools' scores (different database, different formula — that
   difference is normal and the comparison note says so). Directly
   measurable facts (link present or not, dofollow vs nofollow, site
   live or not, page content) must match all three tools exactly.

   PUBLIC API (pure functions, no DOM except wireSeoButtons, no network
   except the fetch calls the assembler makes — see wiring notes)
   ----------------------------------------------------------------
   parseSeoCommand(text)
     -> { kind, url, domain, keyword, competitor, query, topic, site }
     or null. kind is one of 'audit' | 'onpage' | 'backlinks' |
     'keywords' | 'explorer' | 'rank' | 'competitors' | 'content-gap' |
     'serp' | 'pitch' | 'article'. Pitch/article are local (no endpoint).
   SEO_TOOLS_MENU — 11 entries (9 tools + pitch + article), each
     { id, label, endpoint, example }.
   seoEndpointFor(kind) -> '/api/v2/seo/<tool>' or null for pitch/article.
   seoRequestBody(cmd) -> the POST body for the command's endpoint.
   renderSeoReport(report) — audit / onpage reports (compact buttons).
   renderBacklinks(report) / renderKeywords(result) / renderExplorer /
   renderRank / renderCompetitors / renderContentGap / renderSerp —
     one compact renderer per tool, same button rule.
   renderSeoResult(tool, payload) — dispatcher: picks the renderer.
   seoShortSummary(tool, payload) — one short line for the chat.
   buildPitch(site, topic) — guest-post pitch from the generic template.
   buildArticleOutline(topic) — article outline from the generic template.
   saveSeoReportToLibrary(report, library) — saves to the Library when
     one is supplied, else reports { saved: false } honestly.
   toggleSeoDetail(detailEl) — flips one hidden detail open/closed.
   wireSeoButtons(container) — attaches the click handlers.
   seoDetailHtml(id, title, innerHtml) — one button + hidden detail pair.

   STYLE: plain ES5, var + function declarations, no modules, matching
   the existing piece style. Zero emojis.
   ========================================================================== */

/* ---------- small helpers ---------- */
function seoTrim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function seoEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function seoIsUrlToken(tok) {
  return /^(https?:\/\/)?[a-z0-9][a-z0-9\-]*(\.[a-z0-9\-]+)+(\/\S*)?$/i.test(tok || '');
}
function seoAsUrl(tok) {
  var t = seoTrim(tok);
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  return t;
}
function seoAsDomain(tok) {
  var t = seoTrim(tok).replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  t = t.split('/')[0].split('?')[0].split('#')[0];
  return t.toLowerCase();
}
function seoVal(v) { return (v === null || v === undefined) ? 'available nahi' : String(v); }

/* ---------- Tools menu: all nine tools + writing ---------- */
var SEO_TOOLS_MENU = [
  { id: 'audit', label: 'Site Audit', endpoint: '/api/v2/seo/audit',
    example: 'SEO check https://example.com' },
  { id: 'onpage', label: 'On-Page SEO Checker', endpoint: '/api/v2/seo/onpage',
    example: 'On-page check https://example.com/page' },
  { id: 'backlinks', label: 'Backlink Analysis', endpoint: '/api/v2/seo/backlinks',
    example: 'Backlinks for example.com' },
  { id: 'keywords', label: 'Keyword Research', endpoint: '/api/v2/seo/keywords',
    example: 'Keyword research for example.com' },
  { id: 'explorer', label: 'Site / Domain Explorer', endpoint: '/api/v2/seo/explorer',
    example: 'Domain explorer example.com' },
  { id: 'rank', label: 'Rank Tracker', endpoint: '/api/v2/seo/rank',
    example: 'Rank tracker coffee for example.com' },
  { id: 'competitors', label: 'Competitor Analysis', endpoint: '/api/v2/seo/competitors',
    example: 'Competitors of example.com for coffee' },
  { id: 'content-gap', label: 'Content Gap', endpoint: '/api/v2/seo/content-gap',
    example: 'Content gap example.com vs competitor-a.com' },
  { id: 'serp', label: 'SERP Analysis', endpoint: '/api/v2/seo/serp',
    example: 'SERP analysis for coffee' },
  { id: 'pitch', label: 'Guest Post Pitch', endpoint: null,
    example: 'Guest post pitch for example.com' },
  { id: 'article', label: 'Write an Article', endpoint: null,
    example: 'Write an article about coffee brewing' }
];

function seoEndpointFor(kind) {
  var i;
  for (i = 0; i < SEO_TOOLS_MENU.length; i++) {
    if (SEO_TOOLS_MENU[i].id === kind) return SEO_TOOLS_MENU[i].endpoint;
  }
  return null;
}

/* ---------- shared result/trace builder ----------
   buildSeoResult: every tool's result carries its trace — evidence
   (source URL) + date (checked_at) + method. Each of the nine tools
   builds its result through this builder, so no tool's result path
   can lose its trace. Unmeasurable fields are never given a number
   here: they stay 'available nahi' (see seoVal / the renderers). */
function buildSeoResult(tool, data, trace) {
  var t = trace || {};
  return {
    tool: tool,
    data: data || null,
    source: t.source || t.source_url || '',
    source_url: t.source || t.source_url || '',
    checked_at: t.checked_at || t.checkedAt || '',
    method: t.method || ''
  };
}

/* ENZO scores use the 0-100 scale: a score outside 0-100 is clamped
   into range, never reported as-is. */
function seoClampScore(v) {
  var n = Number(v);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/* Each score states its basis: pages read, links found, quality
   measure. The basis comes from the backend report when it carries
   one; when it does not, the score says so honestly instead of
   inventing a basis. */
function seoScoreBasis(score) {
  var b = score.basis || {};
  var inputs = score.inputs || {};
  var pages = (b.pages_read !== undefined && b.pages_read !== null)
    ? b.pages_read
    : ((inputs.pages_read !== undefined && inputs.pages_read !== null)
      ? inputs.pages_read : 'not reported');
  var links = (b.links_found !== undefined && b.links_found !== null)
    ? b.links_found
    : ((inputs.links_found !== undefined && inputs.links_found !== null)
      ? inputs.links_found : 'not reported');
  var quality = b.quality_measure || inputs.quality_measure
    || 'ENZO content quality measure';
  return 'Basis: pages read ' + pages + ', links found ' + links
    + ', quality measure: ' + quality + '.';
}

/* ---------- chat-command detection ---------- */
function parseSeoCommand(text) {
  var raw = seoTrim(text);
  if (!raw) return null;
  var m;
  /* 1. Site Audit — "SEO check <url>", "site audit <url>", "audit <url>" */
  m = raw.match(/^(?:seo\s+check|site\s+audit|audit)\s+(\S+)\s*$/i);
  if (m && seoIsUrlToken(m[1])) return { kind: 'audit', url: seoAsUrl(m[1]) };
  /* 2. On-Page — "on-page check <url>", "on page SEO <url>" */
  m = raw.match(/^on[\s\-]?page\s+(?:check|seo)?\s*(\S+)\s*$/i);
  if (m && seoIsUrlToken(m[1])) return { kind: 'onpage', url: seoAsUrl(m[1]) };
  /* 3. Backlinks — "backlinks for <site>" */
  m = raw.match(/^backlinks?\s+for\s+(\S+)\s*$/i);
  if (m) return { kind: 'backlinks', domain: seoAsDomain(m[1]) };
  /* 4. Keyword Research — "keyword research for <site>", "keywords for <site>" */
  m = raw.match(/^keywords?\s+research\s+for\s+(\S+)(?:\s+about\s+(.+))?\s*$/i);
  if (m) return { kind: 'keywords', domain: seoAsDomain(m[1]),
    url: seoAsUrl(m[1]), topic: m[2] ? seoTrim(m[2]) : '' };
  m = raw.match(/^keywords?\s+for\s+(\S+)\s*$/i);
  if (m) return { kind: 'keywords', domain: seoAsDomain(m[1]),
    url: seoAsUrl(m[1]) };
  /* 5. Domain Explorer — "domain explorer <site>", "explore <site>" */
  m = raw.match(/^(?:domain\s+explorer|site\s+explorer|explore\s+domain)\s+(\S+)\s*$/i);
  if (m) return { kind: 'explorer', domain: seoAsDomain(m[1]) };
  m = raw.match(/^explore\s+(\S+)\s*$/i);
  if (m && seoIsUrlToken(m[1])) return { kind: 'explorer', domain: seoAsDomain(m[1]) };
  /* 6. Rank Tracker — "rank tracker <keyword> for <site>",
     "where does <site> rank for <keyword>", "rank for <keyword> on <site>" */
  m = raw.match(/^rank\s+tracker\s+(.+?)\s+for\s+(\S+)\s*$/i);
  if (m) return { kind: 'rank', keyword: seoTrim(m[1]), domain: seoAsDomain(m[2]) };
  m = raw.match(/^where\s+does\s+(\S+)\s+rank\s+for\s+(.+?)\s*$/i);
  if (m) return { kind: 'rank', domain: seoAsDomain(m[1]), keyword: seoTrim(m[2]) };
  m = raw.match(/^rank\s+for\s+(.+?)\s+(?:on|for)\s+(\S+)\s*$/i);
  if (m) return { kind: 'rank', keyword: seoTrim(m[1]), domain: seoAsDomain(m[2]) };
  /* 7. Competitors — "competitors of <site> for <keyword>" */
  m = raw.match(/^competitors?\s+(?:of|for)\s+(\S+)(?:\s+for\s+(.+?))?\s*$/i);
  if (m) return { kind: 'competitors', domain: seoAsDomain(m[1]),
    keyword: m[2] ? seoTrim(m[2]) : '' };
  /* 8. Content Gap — "content gap <site> vs <competitor>" */
  m = raw.match(/^content\s+gap\s+(\S+)\s+vs\.?\s+(\S+)\s*$/i);
  if (m) return { kind: 'content-gap', domain: seoAsDomain(m[1]),
    competitor: seoAsDomain(m[2]) };
  /* 9. SERP — "SERP analysis for <query>", "serp for <query>" */
  m = raw.match(/^serp\s+(?:analysis\s+)?for\s+(.+?)\s*$/i);
  if (m) return { kind: 'serp', query: seoTrim(m[1]) };
  m = raw.match(/^serp\s+(.+?)\s*$/i);
  if (m) return { kind: 'serp', query: seoTrim(m[1]) };
  /* Writing — "guest post pitch for <site>", "write an article about X" */
  m = raw.match(/^guest\s+post\s+pitch\s+for\s+(\S+)(?:\s+about\s+(.+?))?\s*$/i);
  if (m) return { kind: 'pitch', site: seoAsDomain(m[1]),
    topic: m[2] ? seoTrim(m[2]) : '' };
  m = raw.match(/^write\s+(?:an?\s+)?article\s+about\s+(.+?)\s*$/i);
  if (m) return { kind: 'article', topic: seoTrim(m[1]) };
  return null;
}

function seoRequestBody(cmd) {
  if (!cmd) return null;
  var body = {};
  if (cmd.url) body.url = cmd.url;
  if (cmd.domain) body.domain = cmd.domain;
  if (cmd.keyword) body.keyword = cmd.keyword;
  if (cmd.competitor) body.competitor = cmd.competitor;
  if (cmd.query) body.query = cmd.query;
  return body;
}

/* ---------- compact display: one small button + hidden detail ----------
   DISPLAY RULE: the default view is ONLY the button. The detail div is
   hidden (hidden attribute) and is revealed only when Raja clicks the
   button. Evidence (source URL + date + method + self-check) lives
   inside the hidden div — it exists for every number, but is never
   shown by default. */
var _seoDetailCounter = 0;
function seoDetailHtml(id, buttonLabel, innerHtml) {
  var safeId = seoEsc(id);
  return '<div class="seo-item">'
    + '<button type="button" class="seo-btn" data-seo-target="' + safeId + '">'
    + seoEsc(buttonLabel) + '</button>'
    + '<div class="seo-detail" id="' + safeId + '" hidden>' + innerHtml + '</div>'
    + '</div>';
}
function seoNextDetailId(prefix) {
  _seoDetailCounter += 1;
  return prefix + '-' + _seoDetailCounter;
}
function seoEvidenceHtml(traced) {
  if (!traced) return '';
  return '<p class="seo-evidence">Source: ' + seoEsc(traced.source_url || '')
    + '<br>Checked: ' + seoEsc(traced.checked_at || '')
    + '<br>Method: ' + seoEsc(traced.method || '') + '</p>';
}
function seoTracedRow(label, traced) {
  return '<tr><td>' + seoEsc(label) + '</td><td>'
    + seoEsc(seoVal(traced ? traced.value : null)) + '</td></tr>'
    + (traced ? '<tr class="seo-evidence-row"><td colspan="2">'
      + seoEvidenceHtml(traced) + '</td></tr>' : '');
}
function seoScoreButton(score, prefix) {
  var id = seoNextDetailId(prefix);
  var clamped = seoClampScore(score.value_0_100);
  var label = score.label + ': ' + clamped + '/100';
  var inner = '<p>' + seoEsc(score.direction || '') + '</p>'
    + '<p>' + seoEsc(seoScoreBasis(score)) + '</p>'
    + '<p>Formula: ' + seoEsc(score.formula || '') + '</p>'
    + '<p>Inputs: ' + seoEsc(JSON.stringify(score.inputs || {})) + '</p>'
    + seoEvidenceHtml(score.evidence)
    + '<p class="seo-note">' + seoEsc(score.comparison_note || '') + '</p>';
  return seoDetailHtml(id, label, inner);
}
function seoUnavailableHtml(unavailable) {
  var i, out = '<ul>';
  for (i = 0; i < (unavailable || []).length; i++) {
    out += '<li><strong>' + seoEsc(unavailable[i].metric) + ':</strong> '
      + seoEsc(unavailable[i].value) + ' — '
      + seoEsc(unavailable[i].reason || '') + '</li>';
  }
  return out + '</ul>';
}

/* ---------- renderers: one per tool, all compact ---------- */
function renderSeoReport(report) {
  if (!report) return '';
  /* Site Audit (and On-Page, which shares this renderer): the result
     carries its trace — source + checked_at + method — via the shared
     builder buildSeoResult. */
  var traced = buildSeoResult(report.tool || 'site-audit', report,
    { source: report.url || '', checked_at: report.checked_at || '',
      method: 'ENZO crawler: direct GET' });
  var scores = report.enzo_scores || {};
  var verified = report.verified_metrics || {};
  var keys = ['live', 'http_status', 'ssl_present', 'response_time_ms',
    'page_size_bytes', 'title', 'meta_description', 'headings',
    'word_count', 'images_total', 'images_missing_alt',
    'internal_link_count', 'external_link_count', 'dofollow_count',
    'nofollow_count', 'broken_link_count', 'robots_txt_present',
    'sitemap_present'];
  var i, rows = '<table><tr><th>Metric</th><th>Value</th></tr>';
  for (i = 0; i < keys.length; i++) {
    if (verified[keys[i]]) rows += seoTracedRow(keys[i], verified[keys[i]]);
  }
  rows += '</table>';
  var issues = report.issues || [];
  var issueHtml = '<ul>';
  for (i = 0; i < issues.length; i++) {
    issueHtml += '<li><strong>' + seoEsc(issues[i].issue) + '</strong> — '
      + seoEsc(issues[i].evidence || '') + '<br>Fix: '
      + seoEsc(issues[i].fix || '') + '</li>';
  }
  issueHtml += '</ul>';
  if (!issues.length) issueHtml = '<p>No issues found in the checked facts.</p>';
  var selfCheck = report.self_check || {};
  var corrections = report.corrections || [];
  /* Click-revealed self-check detail: trace + self-check (mismatch
     shows both values) — built by seoClickDetailHtml. */
  var checkHtml = seoClickDetailHtml(traced, selfCheck);
  for (i = 0; i < corrections.length; i++) {
    checkHtml += '<p><strong>Correction — ' + seoEsc(corrections[i].metric)
      + ':</strong> ' + seoEsc(corrections[i].note || '') + '</p>';
  }
  var out = '<div class="seo-report" data-seo-tool="' + seoEsc(report.tool || 'site-audit') + '">'
    + '<p><strong>' + seoEsc(report.tool || 'site-audit') + '</strong> — '
    + seoEsc(report.url || '') + ' — checked '
    + seoEsc(report.checked_at || '') + '</p>';
  var order = ['enzo_authority', 'enzo_content_quality', 'enzo_spam_signals', 'enzo_visibility'];
  for (i = 0; i < order.length; i++) {
    if (scores[order[i]]) out += seoScoreButton(scores[order[i]], 'seo-score');
  }
  out += seoDetailHtml(seoNextDetailId('seo-verified'), 'Verified metrics',
    rows + '<p>Each value carries its source URL, date and method above.</p>');
  out += seoDetailHtml(seoNextDetailId('seo-unavailable'),
    'Not available (proprietary metrics): ' + (report.unavailable_metrics || []).length,
    seoUnavailableHtml(report.unavailable_metrics));
  out += seoDetailHtml(seoNextDetailId('seo-issues'), 'Issues found: ' + issues.length, issueHtml);
  out += seoDetailHtml(seoNextDetailId('seo-selfcheck'),
    'Self-check: ' + seoVal(selfCheck.matched) + '/' + seoVal(selfCheck.metrics_remeasured) + ' matched',
    checkHtml);
  out += seoDetailHtml(seoNextDetailId('seo-note'), 'About ENZO scores vs Ahrefs / Semrush / Moz',
    '<p>' + seoEsc(report.comparison_note || '') + '</p>');
  out += '</div>';
  return out;
}

function renderBacklinks(report) {
  if (!report) return '';
  /* Backlink Analysis: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('backlink-analysis', report,
    { source: report.url || '', checked_at: report.checked_at || '',
      method: 'ENZO crawler: fetched the linking page' });
  var profile = report.backlink_profile || {};
  var links = profile.verified_backlinks || [];
  var i, items = '<ul>';
  for (i = 0; i < links.length; i++) {
    items += '<li><a href="' + seoEsc(links[i].linking_page_url || '') + '">'
      + seoEsc(links[i].linking_page_url || '') + '</a> — anchor: '
      + seoEsc(links[i].anchor || '') + ' — '
      + seoEsc(links[i].link_type || (links[i].nofollow ? 'nofollow' : 'dofollow'))
      + '<br>Checked: ' + seoEsc(links[i].checked_at || '')
      + '<br>Method: ' + seoEsc(links[i].method || '') + '</li>';
  }
  items += '</ul>';
  if (!links.length) items = '<p>No verified backlinks found in the checked pages.</p>';
  items += seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method });
  var out = '<div class="seo-report" data-seo-tool="backlink-analysis">'
    + '<p><strong>Backlink Analysis</strong> — ' + seoEsc(report.url || '')
    + ' — checked ' + seoEsc(report.checked_at || '') + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-bl'), 'Verified backlinks: '
      + seoVal(profile.verified_backlink_count)
      + ' (' + seoVal(profile.dofollow_count) + ' dofollow, '
      + seoVal(profile.nofollow_count) + ' nofollow)', items)
    + seoDetailHtml(seoNextDetailId('seo-bl-dom'), 'Referring domains: '
      + seoVal(profile.referring_domain_count),
      '<p>Only links seen live in fetched HTML are counted. First seen / '
      + 'last seen dates are kept in ENZO\u2019s own database.</p>')
    + seoDetailHtml(seoNextDetailId('seo-bl-note'), 'About ENZO scores vs Ahrefs / Semrush / Moz',
      '<p>' + seoEsc(report.comparison_note || '') + '</p>')
    + '</div>';
  return out;
}

function renderKeywords(result) {
  if (!result) return '';
  /* Keyword Research / Explorer: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('keyword-research', result,
    { source: result.target || '', checked_at: result.checked_at || '',
      method: 'ENZO analyzer: crawled pages' });
  var i, terms = result.top_terms || [], termHtml = '<ul>';
  for (i = 0; i < terms.length; i++) {
    termHtml += '<li><strong>' + seoEsc(terms[i].term) + '</strong> — score '
      + seoVal(terms[i].weighted_score) + ' (headings '
      + seoVal(terms[i].headings) + ', anchors ' + seoVal(terms[i].anchors)
      + ', body ' + seoVal(terms[i].body) + ', pages '
      + seoVal(terms[i].pages_seen_on) + ')</li>';
  }
  termHtml += '</ul>';
  if (!terms.length) termHtml = '<p>No terms found in the crawled pages.</p>';
  var req = result.requested_keywords || [], reqHtml = '<ul>';
  for (i = 0; i < req.length; i++) {
    var diff = req[i].difficulty || {};
    reqHtml += '<li><strong>' + seoEsc(req[i].keyword) + '</strong> — present: '
      + (req[i].present_in_corpus ? 'yes' : 'no') + ', occurrences: '
      + seoVal(req[i].occurrences_in_crawled_pages) + ', difficulty: '
      + seoEsc(seoVal(diff.difficulty)) + '</li>';
  }
  reqHtml += '</ul>';
  if (!req.length) reqHtml = '<p>No keyword was requested.</p>';
  reqHtml += seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method });
  var out = '<div class="seo-report" data-seo-tool="keyword-research">'
    + '<p><strong>Keyword Research</strong> — ' + seoEsc(result.target || '')
    + ' — checked ' + seoEsc(result.checked_at || '')
    + ' — pages crawled: ' + seoVal(result.pages_checked) + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-kw'), 'Top terms: ' + terms.length, termHtml)
    + seoDetailHtml(seoNextDetailId('seo-kw-req'), 'Requested keywords: ' + req.length, reqHtml)
    + seoDetailHtml(seoNextDetailId('seo-kw-vol'), 'Search volume: available nahi',
      '<p>' + seoEsc((result.search_volume || {}).reason || '') + '</p>')
    + '</div>';
  return out;
}

function renderExplorer(result) {
  if (!result) return '';
  /* Site / Domain Explorer: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('domain-explorer', result,
    { source: result.domain || '', checked_at: result.checked_at || '',
      method: 'ENZO crawler: direct GET' });
  var i, pages = result.top_pages || [], pageHtml = '<ul>';
  for (i = 0; i < pages.length; i++) {
    pageHtml += '<li><a href="' + seoEsc(pages[i].url || '') + '">'
      + seoEsc(pages[i].title || pages[i].url || '') + '</a> — ENZO Content '
      + seoVal(pages[i].enzo_content_quality) + '/100, words '
      + seoVal(pages[i].word_count) + '</li>';
  }
  pageHtml += '</ul>';
  if (!pages.length) pageHtml = '<p>No pages were crawled.</p>';
  var overview = result.overview || {};
  var out = '<div class="seo-report" data-seo-tool="domain-explorer">'
    + '<p><strong>Site / Domain Explorer</strong> — ' + seoEsc(result.domain || '')
    + ' — checked ' + seoEsc(result.checked_at || '') + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-ex-top'), 'Top pages: ' + pages.length, pageHtml)
    + seoDetailHtml(seoNextDetailId('seo-ex-over'), 'Overview: '
      + seoVal(result.pages_checked) + ' pages, '
      + seoVal(overview.total_words_crawled) + ' words',
      '<p>Pages with title: ' + seoVal(overview.pages_with_title)
      + '<br>Pages missing title: ' + seoVal(overview.pages_missing_title)
      + '<br>Internal links: ' + seoVal(overview.total_internal_links)
      + '<br>External links: ' + seoVal(overview.total_external_links) + '</p>'
      + seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method }))
    + seoDetailHtml(seoNextDetailId('seo-ex-traf'), 'Monthly traffic: available nahi',
      '<p>' + seoEsc((result.monthly_traffic || {}).reason || '') + '</p>')
    + (result.enzo_visibility
      ? seoScoreButton(result.enzo_visibility, 'seo-ex-vis') : '')
    + '</div>';
  return out;
}

function renderRank(result) {
  if (!result) return '';
  /* Rank Tracker: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('rank-tracker', result,
    { source: result.domain || '', checked_at: result.checked_at || '',
      method: result.method || 'ENZO SERP view' });
  var history = result.history || [], i, histHtml = '<ul>';
  for (i = 0; i < history.length; i++) {
    histHtml += '<li>' + seoEsc(history[i].checked_at || '') + ' — position '
      + seoVal(history[i].position)
      + (history[i].movement_vs_previous !== null
        && history[i].movement_vs_previous !== undefined
        ? ' (moved ' + seoVal(history[i].movement_vs_previous) + ')' : '')
      + '</li>';
  }
  histHtml += '</ul>';
  if (!history.length) histHtml = '<p>No earlier snapshots in ENZO\u2019s own database yet.</p>';
  histHtml += seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method });
  var out = '<div class="seo-report" data-seo-tool="rank-tracker">'
    + '<p><strong>Rank Tracker</strong> — ' + seoEsc(result.keyword || '')
    + ' — ' + seoEsc(result.domain || '') + ' — checked '
    + seoEsc(result.checked_at || '') + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-rank'), 'Position in ENZO SERP view: '
      + (result.position === null || result.position === undefined
        ? 'not found' : '#' + result.position),
      '<p>' + seoEsc(result.note || '') + '</p><p>' + seoEsc(result.method || '') + '</p>')
    + seoDetailHtml(seoNextDetailId('seo-rank-hist'), 'History: ' + history.length + ' snapshots', histHtml)
    + '</div>';
  return out;
}

function renderCompetitors(result) {
  if (!result) return '';
  /* Competitor Analysis: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('competitor-analysis', result,
    { source: result.domain || '', checked_at: result.checked_at || '',
      method: 'ENZO crawler: direct GET' });
  var i, out = '<div class="seo-report" data-seo-tool="competitor-analysis">'
    + '<p><strong>Competitor Analysis</strong> — ' + seoEsc(result.domain || '')
    + ' — keyword: ' + seoEsc(result.keyword || '') + ' — checked '
    + seoEsc(result.checked_at || '') + '</p>';
  var comps = result.competitors || [];
  for (i = 0; i < comps.length; i++) {
    var c = comps[i];
    out += seoDetailHtml(seoNextDetailId('seo-comp'), c.domain
      + ' — ENZO Content ' + seoVal(c.enzo_content_quality)
      + '/100, ENZO Authority ' + seoVal(c.enzo_authority) + '/100',
      '<p>Results for keyword: ' + seoVal(c.results_for_keyword)
      + '<br>Live: ' + (c.live ? 'yes' : 'no')
      + '<br>Words: ' + seoVal(c.word_count)
      + (c.error ? '<br>' + seoEsc(c.error) : '') + '</p>'
      + seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method }));
  }
  if (!comps.length) {
    out += seoDetailHtml(seoNextDetailId('seo-comp-none'), 'Competitors: 0',
      '<p>No other domain appeared in ENZO\u2019s own search results for this keyword.</p>'
      + seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method }));
  }
  out += '</div>';
  return out;
}

function renderContentGap(result) {
  if (!result) return '';
  /* Content Gap: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('content-gap', result,
    { source: result.own_domain || '', checked_at: result.checked_at || '',
      method: 'ENZO analyzer: crawled pages' });
  var i, gap = result.gap_terms || [], gapHtml = '<ul>';
  for (i = 0; i < gap.length; i++) {
    gapHtml += '<li><strong>' + seoEsc(gap[i].term) + '</strong> — competitor score '
      + seoVal(gap[i].competitor_weighted_score) + ' (headings '
      + seoVal(gap[i].competitor_headings) + ', body '
      + seoVal(gap[i].competitor_body) + '), own score 0</li>';
  }
  gapHtml += '</ul>';
  if (!gap.length) gapHtml = '<p>No gap terms found in the crawled pages.</p>';
  var out = '<div class="seo-report" data-seo-tool="content-gap">'
    + '<p><strong>Content Gap</strong> — ' + seoEsc(result.own_domain || '')
    + ' vs ' + seoEsc(result.competitor_domain || '') + ' — checked '
    + seoEsc(result.checked_at || '') + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-gap'), 'Gap terms: ' + gap.length, gapHtml)
    + seoDetailHtml(seoNextDetailId('seo-gap-shared'), 'Shared terms: '
      + seoVal(result.shared_terms),
      '<p>Own pages: ' + seoVal(result.own_pages_checked)
      + ', competitor pages: ' + seoVal(result.competitor_pages_checked)
      + '<br>Own distinct terms: ' + seoVal(result.own_distinct_terms)
      + '<br>Competitor distinct terms: ' + seoVal(result.competitor_distinct_terms)
      + '</p><p>' + seoEsc(result.note || '') + '</p>'
      + seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method }))
    + '</div>';
  return out;
}

function renderSerp(result) {
  if (!result) return '';
  /* SERP Analysis: result carries its trace via buildSeoResult. */
  var traced = buildSeoResult('serp-analysis', result,
    { source: result.query || '', checked_at: result.checked_at || '',
      method: result.method || 'ENZO SERP view' });
  var i, results = result.results || [], resHtml = '<ol>';
  for (i = 0; i < results.length; i++) {
    resHtml += '<li><a href="' + seoEsc(results[i].url || '') + '">'
      + seoEsc(results[i].title || results[i].url || '') + '</a>'
      + (results[i].pub_date ? ' (' + seoEsc(results[i].pub_date) + ')' : '')
      + '</li>';
  }
  resHtml += '</ol>';
  if (!results.length) resHtml = '<p>No results returned by ENZO\u2019s search providers.</p>';
  var domains = result.top_domains || [], domHtml = '<ul>';
  for (i = 0; i < domains.length; i++) {
    domHtml += '<li>' + seoEsc(domains[i].domain) + ' — '
      + seoVal(domains[i].results) + ' result(s)</li>';
  }
  domHtml += '</ul>';
  var out = '<div class="seo-report" data-seo-tool="serp-analysis">'
    + '<p><strong>SERP Analysis</strong> — ' + seoEsc(result.query || '')
    + ' — checked ' + seoEsc(result.checked_at || '') + '</p>'
    + seoDetailHtml(seoNextDetailId('seo-serp'), 'Results: ' + seoVal(result.result_count), resHtml)
    + seoDetailHtml(seoNextDetailId('seo-serp-dom'), 'Domains: ' + seoVal(result.distinct_domains), domHtml)
    + seoDetailHtml(seoNextDetailId('seo-serp-note'), 'About this SERP view',
      '<p>' + seoEsc(result.method || '') + '</p><p>' + seoEsc(result.note || '') + '</p>'
      + seoEvidenceHtml({ source_url: traced.source, checked_at: traced.checked_at, method: traced.method }))
    + '</div>';
  return out;
}

function renderSeoResult(tool, payload) {
  var report = payload && payload.report ? payload.report : payload;
  if (tool === 'backlinks' || tool === 'backlink-analysis') return renderBacklinks(report);
  if (tool === 'keywords' || tool === 'keyword-research') return renderKeywords(report);
  if (tool === 'explorer' || tool === 'domain-explorer') return renderExplorer(report);
  if (tool === 'rank' || tool === 'rank-tracker') return renderRank(report);
  if (tool === 'competitors' || tool === 'competitor-analysis') return renderCompetitors(report);
  if (tool === 'content-gap') return renderContentGap(report);
  if (tool === 'serp' || tool === 'serp-analysis') return renderSerp(report);
  return renderSeoReport(report);
}

function seoShortSummary(tool, payload) {
  var report = payload && payload.report ? payload.report : payload;
  if (!report) return 'SEO result unavailable.';
  var scores = report.enzo_scores || {};
  if (tool === 'backlinks' || tool === 'backlink-analysis') {
    var p = report.backlink_profile || {};
    return 'Backlinks for ' + (report.url || '') + ': '
      + seoVal(p.verified_backlink_count) + ' verified, '
      + seoVal(p.referring_domain_count) + ' referring domains. Details behind the buttons.';
  }
  if (tool === 'rank' || tool === 'rank-tracker') {
    return 'Rank for "' + (report.keyword || '') + '" on ' + (report.domain || '')
      + ': ' + (report.position === null || report.position === undefined
        ? 'not found in ENZO SERP view' : '#' + report.position)
      + '. Details behind the buttons.';
  }
  if (scores.enzo_authority) {
    return 'SEO ' + (report.tool || tool) + ': ' + (report.url || '')
      + ' — ENZO Authority ' + seoVal(scores.enzo_authority.value_0_100)
      + '/100, ENZO Content ' + seoVal(scores.enzo_content_quality.value_0_100)
      + '/100, ' + (report.issues || []).length + ' issue(s). Details behind the buttons.';
  }
  return 'SEO ' + (report.tool || tool) + ' done for ' + (report.url || report.domain || report.query || '')
    + '. Details behind the buttons.';
}

/* ---------- writing support (generic templates, no client data) ---------- */
function buildPitch(site, topic) {
  var s = seoAsDomain(site || '');
  var t = seoTrim(topic) || '[Topic]';
  return {
    template: 'guest-post pitch',
    site: s,
    topic: t,
    author: '{your_name}',
    author_role: '{your_role}',
    contact_email: '{your_email}',
    contact_website: '{your_website}',
    subjects: [
      'Guest post idea for ' + s + ': ' + t,
      'Would you accept a guest post on ' + t + '?',
      'Free expert article for ' + s + ' — ' + t
    ],
    structure: ['greeting', 'intro', 'value', 'topic_options', 'bio', 'close'],
    body: 'Hello,\n\nI am {your_name} ({your_role}). I read your article on [article you read] and I would like to contribute a guest post for ' + s + '.\n\nThe piece would help your readers by [concrete benefit for this site\u2019s audience].\n\nTopic options:\n1. ' + t + '\n2. [Second specific topic for ' + s + ']\n3. [Third specific topic for ' + s + ']\n\nAbout me: {your_name} — [only real placements, or what you do]. You can reach me at {your_email} or through {your_website}.\n\nWould you like me to send the draft? I am happy to adjust the angle to fit your audience.\n\nThank you,\n{your_name}',
    rules: ['Short: the whole pitch fits on one screen.',
      'Only facts that were verified — no invented credentials, no invented placements, no invented traffic numbers.',
      'One site at a time; the pitch names that site\u2019s real content.',
      'Fill in every {placeholder} with your own details before sending; never send the template with placeholders still in it, and never put anyone else\u2019s email or name in it.']
  };
}

function buildArticleOutline(topic) {
  var t = seoTrim(topic);
  return {
    template: 'article',
    topic: t,
    author: '{your_name}',
    contact_email: '{your_email}',
    title_options: [
      t + ': What Actually Matters',
      'How to Approach ' + t + ', Step by Step',
      t + ' — The Practical Guide'
    ],
    outline: [
      { section: 'hook', purpose: 'First two sentences: the problem or question the reader already has, in their words.' },
      { section: 'intro', purpose: 'What the article will answer, and what the reader will be able to do after reading it.' },
      { section: 'headings', purpose: 'One H2 per step or idea, in the order the reader needs them.' },
      { section: 'evidence', purpose: 'Every factual claim tied to a real source that was actually read, with its URL and date.' },
      { section: 'practical_steps', purpose: 'Concrete steps the reader can follow, in order.' },
      { section: 'conclusion', purpose: 'The one thing to remember and the one thing to do next.' }
    ],
    checklist: [
      'Hook answers a real reader question.',
      'Every factual claim has a source that was actually read.',
      'Headings carry the argument on their own.',
      'No invented numbers, dates or quotes anywhere.',
      'Word count fits the brief; nothing padded to fill space.'
    ]
  };
}

/* ---------- ENZO's own database (in-memory, frontend mirror) ----------
   ENZO's own database records rank snapshots, audit history and
   backlink first-seen / last-seen dates, so measurements can be read
   back over time. This is the frontend mirror of the backend store
   (seo/store.py, same tables: rank snapshots, audit history,
   backlink sightings with first_seen kept from the first sighting
   and last_seen advanced on every later sighting). Nothing here
   fetches a third-party checker: every record comes from ENZO's own
   crawler / analyzer / scorer, with source + checked_at + method. */
function createSeoDatabase() {
  var rankSnapshots = [];
  var auditHistory = [];
  var backlinkSightings = {};
  var allRecords = [];
  function cloneRecord(record) {
    var out = {}, k;
    for (k in record) {
      if (Object.prototype.hasOwnProperty.call(record, k)) out[k] = record[k];
    }
    return out;
  }
  function save(record) {
    if (!record || typeof record !== 'object') return null;
    var stored = cloneRecord(record);
    if (!stored.checked_at) stored.checked_at = new Date().toISOString();
    if (stored.type === 'rank') {
      rankSnapshots.push(stored);
    } else if (stored.type === 'audit') {
      auditHistory.push(stored);
    } else if (stored.type === 'backlink') {
      var key = (stored.linking_page_url || stored.url || '') + '|'
        + (stored.anchor || '');
      var seen = backlinkSightings[key];
      if (!seen) {
        stored.first_seen = stored.checked_at;
        stored.last_seen = stored.checked_at;
        backlinkSightings[key] = stored;
      } else {
        stored.first_seen = seen.first_seen;
        stored.last_seen = stored.checked_at;
        backlinkSightings[key] = stored;
      }
    }
    allRecords.push(stored);
    return stored;
  }
  function matches(query, record) {
    if (!query) return true;
    if (query.type && record.type !== query.type) return false;
    if (query.keyword && record.keyword !== query.keyword) return false;
    if (query.domain && record.domain !== query.domain) return false;
    if (query.url && record.url !== query.url) return false;
    return true;
  }
  function getHistory(query) {
    var out = [], i;
    for (i = 0; i < allRecords.length; i++) {
      if (matches(query, allRecords[i])) out.push(allRecords[i]);
    }
    return out;
  }
  function getSnapshots(query) {
    var out = [], i;
    for (i = 0; i < rankSnapshots.length; i++) {
      if (matches(query, rankSnapshots[i])) out.push(rankSnapshots[i]);
    }
    return out;
  }
  function getAuditHistory(query) {
    var out = [], i;
    for (i = 0; i < auditHistory.length; i++) {
      if (matches(query, auditHistory[i])) out.push(auditHistory[i]);
    }
    return out;
  }
  function getBacklinks() {
    var out = [], k;
    for (k in backlinkSightings) {
      if (Object.prototype.hasOwnProperty.call(backlinkSightings, k)) {
        out.push(backlinkSightings[k]);
      }
    }
    return out;
  }
  return {
    save: save,
    saveMeasurement: save,
    record: save,
    addSnapshot: save,
    getHistory: getHistory,
    readHistory: getHistory,
    getSnapshots: getSnapshots,
    getAuditHistory: getAuditHistory,
    getBacklinks: getBacklinks
  };
}
function createDatabase() { return createSeoDatabase(); }

/* ---------- Library save ---------- */
function saveSeoReportToLibrary(report, library) {
  if (!report) return { saved: false, reason: 'no report to save' };
  if (library && typeof library.save === 'function') {
    try {
      library.save(report);
      return { saved: true, reason: '' };
    } catch (e) {
      return { saved: false, reason: 'library save failed: ' + String(e && e.message ? e.message : e) };
    }
  }
  return { saved: false, reason: 'no Library available in this view' };
}

/* ---------- DOM wiring (assembler) ---------- */
function toggleSeoDetail(detailEl) {
  if (!detailEl) return false;
  detailEl.hidden = !detailEl.hidden;
  return !detailEl.hidden;
}
function wireSeoButtons(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return 0;
  var buttons = container.querySelectorAll('.seo-btn');
  var i, count = 0;
  for (i = 0; i < buttons.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-seo-target');
        var detail = null;
        if (typeof document !== 'undefined' && document.getElementById) {
          detail = document.getElementById(id);
        }
        if (!detail && container.querySelector) {
          detail = container.querySelector('#' + id);
        }
        if (detail) toggleSeoDetail(detail);
      });
    })(buttons[i]);
    count += 1;
  }
  return count;
}

/* ---------- click-revealed detail (trace + self-check) ----------
   seoClickDetailHtml: the HTML a button click reveals for one item.
   It always carries the item's trace — evidence (source) + date
   (checked_at) + method — AND its self-check: how many metrics were
   re-measured, how many matched, and on a mismatch BOTH values (the
   first value and the re-measured value) so the two can be compared.
   The renderers build their hidden detail divs with this function
   (renderSeoReport uses it for the self-check detail), so what the
   click reveals is exactly this trace + self-check, never a number
   without its evidence. */
function seoClickDetailHtml(traced, selfCheck) {
  var t = traced || {};
  var s = selfCheck || {};
  var source = t.source || t.source_url || '';
  var html = '<p class="seo-evidence">Source: ' + seoEsc(source)
    + '<br>Checked: ' + seoEsc(t.checked_at || '')
    + '<br>Method: ' + seoEsc(t.method || '') + '</p>'
    + '<p class="seo-self-check">Self-check: re-measured '
    + seoVal(s.metrics_remeasured) + ', matched ' + seoVal(s.matched)
    + ', mismatched ' + seoVal(s.mismatched)
    + ', not re-measured ' + seoVal(s.not_remeasured) + '.</p>';
  if (s.mismatched) {
    html += '<p class="seo-self-check">Mismatch: the first value and the '
      + 're-measured value disagreed — both values are shown in the '
      + 'correction note below, so the first value can be compared with '
      + 'the re-measured value.</p>';
  }
  return html;
}

/* ---------- assembler wiring notes (not executed by this piece) ----------
   Call parseSeoCommand(text) FIRST on every chat message. When it returns
   a kind with an endpoint, POST the seoRequestBody(cmd) JSON to
   seoEndpointFor(kind) (same-origin /api/v2/seo/*), then render with
   renderSeoResult(kind, payload) and call wireSeoButtons(container) on
   the rendered node. Show seoShortSummary(kind, payload) as the chat
   line above the buttons. When the kind is 'pitch', render
   buildPitch(cmd.site, cmd.topic) locally (no network). When it is
   'article', render buildArticleOutline(cmd.topic) locally. Save every
   completed report with saveSeoReportToLibrary(report, window.EnzoLibrary)
   when a Library object exists. Tools-menu entries come from
   SEO_TOOLS_MENU (label + example command). The backend endpoints are
   POST /api/v2/seo/audit | onpage | backlinks | keywords | explorer |
   rank | competitors | content-gap | serp, plus GET
   /api/v2/seo/rank/history?domain=&keyword= — see server/server.py.
   ---------------------------------------------------------------------- */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseSeoCommand: parseSeoCommand,
    SEO_TOOLS_MENU: SEO_TOOLS_MENU,
    seoEndpointFor: seoEndpointFor,
    seoRequestBody: seoRequestBody,
    seoDetailHtml: seoDetailHtml,
    seoEsc: seoEsc,
    buildSeoResult: buildSeoResult,
    seoClampScore: seoClampScore,
    seoScoreBasis: seoScoreBasis,
    seoClickDetailHtml: seoClickDetailHtml,
    createSeoDatabase: createSeoDatabase,
    createDatabase: createDatabase,
    renderSeoReport: renderSeoReport,
    renderBacklinks: renderBacklinks,
    renderKeywords: renderKeywords,
    renderExplorer: renderExplorer,
    renderRank: renderRank,
    renderCompetitors: renderCompetitors,
    renderContentGap: renderContentGap,
    renderSerp: renderSerp,
    renderSeoResult: renderSeoResult,
    seoShortSummary: seoShortSummary,
    buildPitch: buildPitch,
    buildArticleOutline: buildArticleOutline,
    saveSeoReportToLibrary: saveSeoReportToLibrary,
    toggleSeoDetail: toggleSeoDetail,
    wireSeoButtons: wireSeoButtons
  };
}
