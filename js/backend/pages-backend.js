
/* ==========================================================================
 * Piece 33 — GitHub Pages backend fix (ENAO AI live-defect track, defect 4)
 * File: pieces/33-pages-backend.js
 * Exposes: window.EnzoPagesBackend
 *
 * PROBLEM (verified live 22 Nov 2026, see VERIFICATION-33.md in this dir):
 *   - https://rajaumairhamza.github.io/api/v2/health  -> 404 (GitHub
 *     Pages serves static files only; there is no backend on github.io).
 *   - https://enzoai.cu.gy/api/v2/health              -> 200.
 *   The live export calls the backend same-origin (V2='/api/v2' and
 *   several API_BASE='/api/v2' definitions), so on GitHub Pages live
 *   research can NEVER work as shipped.
 *
 * FIX, PART 1 — this piece (frontend, no backend change):
 *   Resolve the backend base at runtime from window.location.hostname:
 *     enzoai.cu.gy, enao.130.210.18.252.nip.io -> same-origin '/api/v2'
 *     ANY other host (github.io Pages, localhost preview, file preview,
 *     anything else) -> absolute 'https://enzoai.cu.gy/api/v2'
 *   The same rule covers the search proxy (/api/search, /api/fetch):
 *     same-origin hosts keep '/api/search' etc.; every other host uses
 *     'https://enzoai.cu.gy/api/search' etc. (the proxy already sends
 *     Access-Control-Allow-Origin: *, verified live — those calls work
 *     cross-origin today).
 *
 * FIX, PART 2 — backend CORS (REQUIRED, not optional):
 *   The platform backend (enao-platform/server/server.py) currently
 *   sends NO Access-Control-Allow-Origin on /api/v2 responses, and
 *   answers OPTIONS preflight with 501 Unsupported method. A browser
 *   on github.io will therefore refuse to read ANY /api/v2 response
 *   and refuse the POST preflight, even with the absolute URL from
 *   Part 1. Until the backend diff in cors-diff-server-py.diff is
 *   deployed to the Oracle VM and the service restarted, live research
 *   from the Pages build WILL fail in a real browser — curl succeeding
 *   proves nothing about the browser, because curl does not enforce
 *   CORS. This piece therefore never pretends the backend is reachable
 *   until a real in-page check succeeds (see checkBackendReachable).
 *
 * HONEST-UNREACHABLE CONTRACT (assembler must wire this into the ask
 * path — see WIRING below):
 *   Before sending an ask, call checkBackendReachable(). If it reports
 *   reachable === false, show buildUnavailableNotice(result) in the
 *   chat and STOP. Do NOT send the ask, do NOT fall back to a silent
 *   normal-mode answer, and do NOT fabricate research. The notice
 *   states the reason in plain words.
 *
 * STYLE: plain ES5, var + function declarations, no modules, no
 * dependencies, no emojis. No paid service anywhere.
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  /* Hosts that serve the page from the SAME origin as the backend, so
     a relative /api/v2 base works. Only these two hosts were verified
     live to answer /api/v2/health with 200. Anything else — including
     www.enzoai.cu.gy, which was NOT verified — takes the absolute
     backend URL, which is correct once the backend CORS diff is live. */
  var SAME_ORIGIN_HOSTS = [
    'enzoai.cu.gy',
    'enao.130.210.18.252.nip.io'
  ];

  var ABSOLUTE_BACKEND_ORIGIN = 'https://enzoai.cu.gy';
  var ABSOLUTE_BACKEND_BASE = 'https://enzoai.cu.gy/api/v2';
  var RELATIVE_BACKEND_BASE = '/api/v2';

  /* The search proxy lives on the same Oracle host, behind the same
     nginx, at /api/search and /api/fetch. Same host rule as the
     platform backend; only the path prefix differs. */
  var RELATIVE_SEARCH_PREFIX = '/api';
  var HEALTH_TIMEOUT_MS = 8000;

  /* ------------------------------------------------------------------ */
  /* Pure helpers (no window access — unit-testable in node)             */
  /* ------------------------------------------------------------------ */

  /* Normalise a hostname for comparison: lower-case, trim, drop a
     trailing dot, drop any :port, and accept a full URL by taking the
     host part. Returns '' for anything unusable (null, undefined,
     non-string, empty) — '' never matches a same-origin host, so an
     unusable hostname safely resolves to the absolute backend. */
  function normaliseHostname(hostname) {
    if (typeof hostname !== 'string') return '';
    var h = hostname.replace(/^\s+|\s+$/g, '').toLowerCase();
    if (h === '') return '';
    var scheme = h.indexOf('://');
    if (scheme !== -1) h = h.slice(scheme + 3);
    var slash = h.indexOf('/');
    if (slash !== -1) h = h.slice(0, slash);
    var colon = h.indexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
    if (h.charAt(h.length - 1) === '.') h = h.slice(0, -1);
    return h;
  }

  /* True only for the two verified same-origin hosts. */
  function isSameOriginHost(hostname) {
    var h = normaliseHostname(hostname);
    if (h === '') return false;
    for (var i = 0; i < SAME_ORIGIN_HOSTS.length; i++) {
      if (h === SAME_ORIGIN_HOSTS[i]) return true;
    }
    return false;
  }

  /* PURE, REQUIRED: the backend base for a given page hostname.
     Same-origin hosts -> '/api/v2'. Every other host (github.io
     Pages, localhost / 127.0.0.1 preview, file:// preview, unknown)
     -> 'https://enzoai.cu.gy/api/v2'. */
  function resolveBackendBase(hostname) {
    return isSameOriginHost(hostname)
      ? RELATIVE_BACKEND_BASE
      : ABSOLUTE_BACKEND_BASE;
  }

  /* PURE: the origin to prefix search-proxy paths (/api/search,
     /api/fetch) with. Same-origin hosts -> '' (relative path stays
     relative). Every other host -> 'https://enzoai.cu.gy'. */
  function resolveSearchOrigin(hostname) {
    return isSameOriginHost(hostname) ? '' : ABSOLUTE_BACKEND_ORIGIN;
  }

  /* PURE: full backend URL for a path such as '/health',
     '/chats/<id>/ask' or '/tasks/<id>/progress'. A leading slash on
     the path is optional; a path already starting with the resolved
     base is returned unchanged (idempotent for callers that already
     built a full URL). */
  function backendUrl(path, hostname) {
    var p = (typeof path === 'string') ? path : '';
    if (p.indexOf('http://') === 0 || p.indexOf('https://') === 0) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    var base = resolveBackendBase(hostname);
    if (p === base || p.indexOf(base + '/') === 0) return p;
    return base + p;
  }

  /* PURE: full search-proxy URL for a path such as
     '/api/search?q=...' or '/api/fetch?url=...'. Same idempotency
     rule as backendUrl. */
  function searchUrl(path, hostname) {
    var p = (typeof path === 'string') ? path : '';
    if (p.indexOf('http://') === 0 || p.indexOf('https://') === 0) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    var origin = resolveSearchOrigin(hostname);
    if (origin === '') return p;
    if (p.indexOf(origin + '/') === 0) return p;
    return origin + p;
  }

  /* ------------------------------------------------------------------ */
  /* Runtime helpers (read window.location when available)               */
  /* ------------------------------------------------------------------ */

  function currentHostname() {
    try {
      if (typeof window !== 'undefined' && window.location &&
          typeof window.location.hostname === 'string') {
        return window.location.hostname;
      }
    } catch (e) {}
    return '';
  }

  /* Backend base for the page actually running. */
  function getBackendBase() {
    return resolveBackendBase(currentHostname());
  }

  /* Search-proxy origin prefix for the page actually running
     ('' on same-origin hosts, 'https://enzoai.cu.gy' elsewhere). */
  function getSearchOrigin() {
    return resolveSearchOrigin(currentHostname());
  }

  function getBackendUrl(path) {
    return backendUrl(path, currentHostname());
  }

  function getSearchUrl(path) {
    return searchUrl(path, currentHostname());
  }

  /* ------------------------------------------------------------------ */
  /* Honest reachability check + unavailable notice                      */
  /* ------------------------------------------------------------------ */

  /* Human-readable reason strings. Every string states what was
     observed, never guesses a cause the check cannot see. A browser
     TypeError on a cross-origin fetch is reported as "could not be
     reached" with BOTH honest possibilities named, because the page
     cannot distinguish a down backend from a missing CORS header. */
  function reasonFor(status, detail) {
    if (status === 'ok') return '';
    if (status === 'http-error') {
      return 'The research backend answered with HTTP ' + detail +
        ' instead of a healthy reply.';
    }
    if (status === 'bad-health') {
      return 'The research backend answered, but its health reply ' +
        'was not a healthy one.';
    }
    if (status === 'timeout') {
      return 'The research backend did not answer within ' +
        'the time allowed.';
    }
    if (status === 'no-fetch') {
      return 'This browser cannot make network requests, so the ' +
        'research backend could not be checked.';
    }
    /* 'unreachable' — includes CORS-blocked fetches. */
    return 'The research backend at https://enzoai.cu.gy could not ' +
      'be reached from this page. This usually means the backend ' +
      'is down, or its cross-origin permission (CORS) has not been ' +
      'deployed yet.';
  }

  /* Check whether the resolved backend answers GET <base>/health.
     Returns a Promise that NEVER rejects; it always resolves to:
       { reachable, base, sameOrigin, host, httpStatus, status,
         reason, checkedAt }
     - reachable: true only when health returned HTTP 2xx with
       { ok: true } (or a database/search_upstream field saying ok).
     - status: 'ok' | 'http-error' | 'bad-health' | 'timeout' |
       'unreachable' | 'no-fetch'.
     - reason: plain-language explanation ('' when reachable).
     opts: { fetchFn, timeoutMs, hostname } — fetchFn defaults to
     the page fetch; timeoutMs defaults to 8000. Pass hostname in
     tests to resolve the base without window.location.
     IMPORTANT: a fetch that the browser blocks for CORS rejects with
     a TypeError; that is reported as unreachable, never as ok, and
     never retried silently in a loop. */
  function checkBackendReachable(opts) {
    var o = opts || {};
    var hostname = (typeof o.hostname === 'string')
      ? o.hostname : currentHostname();
    var base = resolveBackendBase(hostname);
    var timeoutMs = (typeof o.timeoutMs === 'number' && o.timeoutMs > 0)
      ? o.timeoutMs : HEALTH_TIMEOUT_MS;
    var fetchFn = (typeof o.fetchFn === 'function')
      ? o.fetchFn
      : ((typeof fetch === 'function') ? fetch : null);
    var startedAt = new Date().toISOString();
    var result = {
      reachable: false,
      base: base,
      sameOrigin: isSameOriginHost(hostname),
      host: normaliseHostname(hostname),
      httpStatus: null,
      status: 'unreachable',
      reason: '',
      checkedAt: startedAt
    };
    function finish(status, httpStatus) {
      result.status = status;
      result.httpStatus = httpStatus;
      result.reason = reasonFor(status, httpStatus);
      result.reachable = (status === 'ok');
      return result;
    }
    if (!fetchFn) {
      return Promise.resolve(finish('no-fetch', null));
    }
    var url = base + '/health';
    var ctl = null;
    var timer = null;
    var settled = false;
    function settle(status, httpStatus) {
      if (settled) return null;
      settled = true;
      if (timer) clearTimeout(timer);
      return finish(status, httpStatus);
    }
    var fetchOpts = {};
    try {
      if (typeof AbortController !== 'undefined') {
        ctl = new AbortController();
        fetchOpts.signal = ctl.signal;
        timer = setTimeout(function () {
          try { ctl.abort(); } catch (e) {}
        }, timeoutMs);
      } else {
        timer = setTimeout(function () {}, timeoutMs);
      }
    } catch (e) {}
    var p;
    try {
      p = fetchFn(url, fetchOpts);
    } catch (e) {
      return Promise.resolve(settle('unreachable', null));
    }
    return Promise.resolve(p).then(function (resp) {
      if (!resp || typeof resp.status !== 'number') {
        return settle('unreachable', null);
      }
      if (resp.status < 200 || resp.status >= 300) {
        return settle('http-error', resp.status);
      }
      if (typeof resp.json === 'function') {
        return resp.json().then(function (j) {
          if (j && j.ok === true) return settle('ok', resp.status);
          return settle('bad-health', resp.status);
        }, function () {
          /* Body unreadable but HTTP was 2xx: the backend answered,
             but the page cannot confirm health — do not call it ok. */
          return settle('bad-health', resp.status);
        });
      }
      return settle('ok', resp.status);
    }, function (err) {
      var name = (err && err.name) || '';
      if (name === 'AbortError' || name === 'TimeoutError') {
        return settle('timeout', null);
      }
      return settle('unreachable', null);
    });
  }

  /* Plain-language notice for the chat when live research cannot run.
     Takes the object returned by checkBackendReachable (or null, in
     which case a generic reason is used). The text names the backend
     and the working alternative; it never invents an answer and never
     claims research happened. No emojis. */
  function buildUnavailableNotice(check) {
    var reason = (check && typeof check.reason === 'string' && check.reason)
      ? check.reason
      : 'The research backend at https://enzoai.cu.gy could not be ' +
        'reached from this page.';
    var lines = 'Live research is unavailable right now. ' + reason +
      ' No research was run and no answer was made up.' +
      ' You can try again from https://enzoai.cu.gy/ , where live ' +
      'research runs on the same site as the backend.';
    if (check && check.base) {
      lines += ' (Backend checked: ' + check.base + '/health' +
        (check.httpStatus ? ', HTTP ' + check.httpStatus : '') + '.)';
    }
    return lines;
  }

  /* Assembler gate: true when the ask path must STOP and show the
     notice instead of sending anything. */
  function shouldBlockAsk(check) {
    return !check || check.reachable !== true;
  }

  /* One-line monitor text for a check result, for the live panel. */
  function describeCheck(check) {
    if (!check) return 'Backend not checked yet.';
    if (check.reachable === true) {
      return 'Backend reachable at ' + check.base +
        ' (health HTTP ' + check.httpStatus + ').';
    }
    return 'Backend unreachable at ' + check.base + ': ' + check.reason;
  }

  /* ------------------------------------------------------------------ */
  /* WIRING — instructions for the assembler (read before merging).     */
  /* Do NOT edit the export by hand: apply these replacements exactly.  */
  /* ------------------------------------------------------------------ */
  /*
   * PREREQUISITE (backend, deploy separately — this file alone is NOT
   * enough for a browser on GitHub Pages):
   *   Apply cors-diff-server-py.diff to
   *   enao-platform/server/server.py on the Oracle VM and restart the
   *   platform service. Until then, checkBackendReachable() from a
   *   github.io origin reports unreachable (CORS-blocked fetch), and
   *   the UI correctly shows the unavailable notice instead of a
   *   fabricated answer. Verify after deploy with the curl commands
   *   in VERIFICATION-33.md (expect Access-Control-Allow-Origin: *
   *   on GET /api/v2/health and HTTP 204 on OPTIONS preflight).
   *
   * LOAD ORDER: include this piece BEFORE every script that defines a
   * backend base below, so window.EnzoPagesBackend exists when they run.
   *
   * REPLACEMENTS in the live export (enao-ai.html, 45,471 lines;
   * line numbers below are from the export verified 22 Nov 2026):
   *
   *  [1] Line 12721 — P-F platform adapter (main ask path):
   *      var V2='/api/v2';
   *      -> var V2 = window.EnzoPagesBackend.getBackendBase();
   *      (v2req() already does fetch(V2+path), so every ask, chat,
   *      task, file and SEO call through v2req follows the fix.)
   *
   *  [2] Line 19715 — monitor data layer (window.EnzoMonitor):
   *      var API_BASE = '/api/v2'; // Same-origin, ...
   *      -> var API_BASE = window.EnzoPagesBackend.getBackendBase();
   *
   *  [3] Line 24524 — live fullscreen monitor:
   *      var API_BASE = '/api/v2';
   *      -> var API_BASE = window.EnzoPagesBackend.getBackendBase();
   *
   *  [4] Line 28074 — monitor agents panel:
   *      var API_BASE = '/api/v2';
   *      -> var API_BASE = window.EnzoPagesBackend.getBackendBase();
   *
   *  [5] Line 39039 — lifecycle / orchestrator cancel helper:
   *      var DEFAULT_API_BASE = '/api/v2';
   *      -> var DEFAULT_API_BASE =
   *           window.EnzoPagesBackend.getBackendBase();
   *      (opts.apiBase still overrides when a caller passes one.)
   *
   *  [6] Lines 41608-41609 — livescreen:
   *      var API_BASE = '/api/v2';
   *      var FETCH_BASE_DEFAULT = '/api/fetch';
   *      -> var API_BASE = window.EnzoPagesBackend.getBackendBase();
   *         var FETCH_BASE_DEFAULT =
   *           window.EnzoPagesBackend.getSearchUrl('/api/fetch');
   *      (fetchPageUrl() builds FETCH_BASE + '?url=...', so the
   *      livescreen page-fetch follows the fix. The livescreen
   *      control/progress/sources URLs all hang off API_BASE.)
   *
   *  [7] SEO tool endpoints — relative '/api/v2/seo/<tool>' literals
   *      used by fetch(endpoint) at line ~44945:
   *      - SEO_TOOLS_MENU, lines 27205-27221 (9 entries, audit /
   *        onpage / backlinks / keywords / explorer / rank /
   *        competitors / content-gap / serp)
   *      - the endpoint table at lines 35012-35052 (same 9 tools)
   *      At the fetch call site (line ~44945), wrap the endpoint:
   *        fetch(window.EnzoPagesBackend.getBackendUrl(endpoint), ...)
   *      getBackendUrl() is idempotent: a path already starting with
   *      the resolved base is returned unchanged, so wrapping is safe
   *      even if a literal is later made absolute. Do NOT rewrite
   *      the menu literals themselves — they are also used as labels
   *      in the router table (lines 35074-35184 list the same
   *      '/api/v2/tasks/{id}/...' endpoints as documentation strings
   *      for the monitor/control handlers; those are NOT fetched
   *      directly and must be left as-is).
   *
   *  [8] Search-proxy call sites — same absolute-URL rule:
   *      The proxy already sends Access-Control-Allow-Origin: *
   *      (verified live), so these work cross-origin as soon as the
   *      URL is absolute. Wrap each URL at its construction site
   *      with window.EnzoPagesBackend.getSearchUrl(...):
   *      - line 3016:  fetchJSONT('/api/search?q=' + ...)
   *      - line 3048:  fetchJSONT('/api/fetch?url=' + ...)
   *      - line 40513: var url = '/api/search?q=' + socEncode(...)
   *      - line 40546: var url = '/api/fetch?url=' + socEncode(...)
   *      - line 41263: fetchJson('/api/search?q=' + ...)
   *      - lines 41305, 41326: fetchText('/api/fetch?url=' + ...)
   *      - lines 44161-44162: search58 / fetch58 ('/api/search?q=',
   *        '/api/fetch?url=') — wrap inside fetchJson58 callers or
   *        inside search58/fetch58 themselves.
   *      getSearchUrl() is idempotent and returns the input unchanged
   *      on same-origin hosts, so wrapping is safe everywhere.
   *      (socDefaultFetcher at line 40487 takes the URL as given, so
   *      wrapping the construction sites above covers it.)
   *
   *  [9] ASK-PATH GATE (honest-unreachable handling — mandatory):
   *      In the ask flow, BEFORE any fetch to the backend, run:
   *        window.EnzoPagesBackend.checkBackendReachable()
   *          .then(function (check) {
   *            if (window.EnzoPagesBackend.shouldBlockAsk(check)) {
   *              show the notice from
   *              window.EnzoPagesBackend.buildUnavailableNotice(check)
   *              in the chat, in the user's language, and STOP —
   *              do not send the ask, do not answer in normal mode,
   *              do not fall back to the search proxy and present
   *              its snippets as a researched answer;
   *            } else { proceed with the normal ask flow; }
   *          });
   *      Cache a successful check for the session (one check per page
   *      load is enough; re-check on the next ask only after a
   *      failure, or when the user retries). A failed check must be
   *      re-run on retry — never cache a failure as permanent.
   *      NOTE: this gate is in ADDITION to the existing v2Up fallback
   *      line — the fallback line must not be used to present a
   *      normal-mode answer as if research had run.
   *
   *  [10] MONITOR LINE: where the export shows backend state
   *      (v2StateLine / setFallbackLine, around line 12750), use
   *      describeCheck(check) so the panel states the resolved base
   *      and the real reason when unreachable.
   *
   *  KNOWN LIVE LIMIT (not fixed by this piece — separate defect):
   *    Research-route asks currently return HTTP 500 internal_error
   *    from the live backend (verified twice 22 Nov 2026 with fresh
   *    idempotency keys; normal-route asks return 200). After the
   *    CORS deploy, Pages research will still fail at the ask step
   *    until that 500 is fixed. This piece surfaces that failure
   *    through the same honest notice path (the ask returns an error
   *    instead of a task) — it must never be papered over with a
   *    fabricated answer.
   */

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  var api = {
    SAME_ORIGIN_HOSTS: SAME_ORIGIN_HOSTS,
    ABSOLUTE_BACKEND_ORIGIN: ABSOLUTE_BACKEND_ORIGIN,
    ABSOLUTE_BACKEND_BASE: ABSOLUTE_BACKEND_BASE,
    RELATIVE_BACKEND_BASE: RELATIVE_BACKEND_BASE,
    normaliseHostname: normaliseHostname,
    isSameOriginHost: isSameOriginHost,
    resolveBackendBase: resolveBackendBase,
    resolveSearchOrigin: resolveSearchOrigin,
    backendUrl: backendUrl,
    searchUrl: searchUrl,
    getBackendBase: getBackendBase,
    getSearchOrigin: getSearchOrigin,
    getBackendUrl: getBackendUrl,
    getSearchUrl: getSearchUrl,
    checkBackendReachable: checkBackendReachable,
    buildUnavailableNotice: buildUnavailableNotice,
    shouldBlockAsk: shouldBlockAsk,
    describeCheck: describeCheck
  };

  root.EnzoPagesBackend = api;

  /* CommonJS export for node-based tests (harmless in the browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : this);
