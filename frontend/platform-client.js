/* ENAO AI — Platform Frontend Adapter (piece P11)
 *
 * Standalone, framework-free client for the ENAO platform backend (/api/v2/).
 * ES5-compatible style (var, function expressions, string concatenation) to
 * match the existing single-file UI (enao-ai.html), which is plain JS.
 *
 * Exposes one global: EnaoPlatform.
 *
 * What it does:
 *  - ask a question (normal / research / clarify modes, per PLAN.md section 3.3)
 *  - list/get tasks, pause / resume / cancel / modify a task
 *  - long-poll chat events and render live progress from REAL backend data
 *  - upload files and ask questions about them
 *  - render sources with pubDate and real final_url links; a Google News
 *    redirect URL is NEVER rendered as an openable link (see renderSources)
 *  - per-chat Deep Research mode state (fixes the known bug where the mode
 *    persisted across chats and could not be turned off)
 *
 * What it does NOT do:
 *  - it never edits enao-ai.html and never auto-hooks into the page.
 *    Wiring is explicit: the UI-redesign track calls EnaoPlatform.bind(hooks)
 *    at the insertion points listed in MERGE-SPEC.md.
 *  - it never invents progress, percentages, or ETAs. ETA is shown only when
 *    the backend returns a non-null eta_s; otherwise "estimating…" is shown.
 *  - no paid APIs, no API keys, no emojis in UI strings, no Upgrade/Pro UI.
 *
 * Fallback contract (see README.md section "Fallback contract"):
 *  - If the backend is unreachable (fetch/XHR fails, or /api/v2/health does
 *    not answer), the client reports backend_unavailable and hands control
 *    back to the existing client-side behaviour UNCHANGED. It never throws,
 *    never blocks the composer, and never fabricates an answer.
 */
(function (global) {
  'use strict';

  var DEFAULT_BASE = '/api/v2';
  var MODE_STORE_KEY = 'enao_platform_modes_v1';
  var LONG_POLL_TIMEOUT_MS = 26000; /* server holds up to 25 s */
  var POLL_ERROR_BACKOFF_MS = 2000;
  var MAX_POLL_ERROR_BACKOFF_MS = 30000;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function isFunction(v) { return typeof v === 'function'; }
  function isObject(v) { return v !== null && typeof v === 'object'; }

  function extend(target, source) {
    var k;
    for (k in source) {
      if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k];
    }
    return target;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Format seconds as m:ss. Only called with a real, non-null eta_s. */
  function formatEta(etaS) {
    var s = Math.max(0, Math.round(etaS));
    var m = Math.floor(s / 60);
    return m + ':' + pad2(s % 60);
  }

  /* Format an ISO pubDate (or epoch ms) for display. Returns '' when the
     date is missing or unparsable — the caller then shows "date not given". */
  function formatPubDate(pubDate) {
    var d;
    if (pubDate === undefined || pubDate === null || pubDate === '') return '';
    if (typeof pubDate === 'number') { d = new Date(pubDate); }
    else { d = new Date(String(pubDate)); }
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isRedirectUrl(url) {
    if (!url) return false;
    return url.indexOf('news.google.com') !== -1 ||
           url.indexOf('/rss/articles/') !== -1;
  }

  /* A source link is openable only when the backend resolved a real final
     URL and did NOT mark it unverified. Anything else is shown as text. */
  function openableUrl(source) {
    if (!source) return null;
    if (source.unverified_link) return null;
    var url = source.final_url || source.url || '';
    if (!url) return null;
    if (isRedirectUrl(url)) return null;
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return null;
    return url;
  }

  /* ------------------------------------------------------------------ */
  /* Transport: fetch when available, XHR otherwise.                     */
  /* Every request resolves (callback-style) with either                 */
  /*   { ok: true, status, data }  or  { ok: false, error, message }    */
  /* A network failure yields error 'backend_unavailable' — never a throw. */
  /* ------------------------------------------------------------------ */

  function httpRequest(base, method, path, body, isFormData, timeoutMs, cb) {
    var url = base + path;
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      cb(result);
    }
    var timer = null;
    if (timeoutMs) {
      timer = setTimeout(function () {
        finish({ ok: false, error: 'timeout', message: 'Request timed out.' });
      }, timeoutMs);
    }

    if (typeof global.fetch === 'function') {
      var opts = { method: method, credentials: 'same-origin' };
      if (body !== null && body !== undefined) {
        if (isFormData) { opts.body = body; }
        else {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(body);
        }
      }
      global.fetch(url, opts).then(function (resp) {
        if (timer) clearTimeout(timer);
        resp.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (resp.status >= 200 && resp.status < 300) {
            finish({ ok: true, status: resp.status, data: data });
          } else {
            var err = (data && data.error) ? data.error : 'http_' + resp.status;
            var msg = (data && data.message) ? data.message : ('HTTP ' + resp.status);
            finish({ ok: false, error: err, message: msg, status: resp.status, data: data });
          }
        }, function () {
          finish({ ok: false, error: 'bad_response', message: 'Unreadable response from server.' });
        });
      }, function () {
        if (timer) clearTimeout(timer);
        finish({ ok: false, error: 'backend_unavailable', message: 'Platform backend is unreachable.' });
      });
      return;
    }

    /* XHR fallback (very old browsers / headless stubs without fetch). */
    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = timeoutMs || 0;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (timer) clearTimeout(timer);
        var data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          finish({ ok: true, status: xhr.status, data: data });
        } else if (xhr.status === 0) {
          finish({ ok: false, error: 'backend_unavailable', message: 'Platform backend is unreachable.' });
        } else {
          var err2 = (data && data.error) ? data.error : 'http_' + xhr.status;
          var msg2 = (data && data.message) ? data.message : ('HTTP ' + xhr.status);
          finish({ ok: false, error: err2, message: msg2, status: xhr.status, data: data });
        }
      };
      xhr.ontimeout = function () {
        finish({ ok: false, error: 'timeout', message: 'Request timed out.' });
      };
      xhr.onerror = function () {
        finish({ ok: false, error: 'backend_unavailable', message: 'Platform backend is unreachable.' });
      };
      if (body !== null && body !== undefined && !isFormData) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(body));
      } else {
        xhr.send(body || null);
      }
    } catch (e) {
      if (timer) clearTimeout(timer);
      finish({ ok: false, error: 'backend_unavailable', message: 'Platform backend is unreachable.' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Per-chat mode state (fixes the known Deep Research persistence bug) */
  /*                                                                     */
  /* The old page kept ONE global boolean (state.deep) that survived     */
  /* switching chats and reloads and could not be turned off reliably.   */
  /* Here the mode is stored PER CHAT in localStorage, keyed by chat id: */
  /*   { "<chatId>": "normal" | "research" }                             */
  /* A chat with no stored entry defaults to "normal". Switching chats   */
  /* never carries the other chat's mode over.                           */
  /* ------------------------------------------------------------------ */

  function loadModes() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(MODE_STORE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch (e) { return {}; }
  }

  function saveModes(modes) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(MODE_STORE_KEY, JSON.stringify(modes));
      }
    } catch (e) { /* storage full / unavailable: modes still work in memory */ }
  }

  /* ------------------------------------------------------------------ */
  /* Client constructor                                                  */
  /* ------------------------------------------------------------------ */

  function PlatformClient(options) {
    options = options || {};
    this.base = options.base || DEFAULT_BASE;
    /* PIECE E (P6 addendum — timeout budget chain, Piece A) +
       assembler budget (23 Nov 2026): absolute worst for one normal
       ask is 100 s, so backend 100 s <= nginx 110 s <= frontend
       120 s (10 s margin each step), so the frontend never races
       nginx and never aborts a recovering ask. Was 100000 (Piece E).
       Original default was 45000. */
    this.timeoutMs = options.timeoutMs || 120000;
    this.available = null; /* null = unknown, true/false = last health result */
    this._modes = loadModes();
    this._pollers = {}; /* chatId -> poller state */
    this._bound = false;
  }

  PlatformClient.prototype._req = function (method, path, body, cb, timeoutMs) {
    var self = this;
    var to = (timeoutMs !== undefined && timeoutMs !== null) ? timeoutMs : this.timeoutMs;
    var isForm = body && typeof FormData !== 'undefined' && body instanceof FormData;
    httpRequest(this.base, method, path, body === undefined ? null : body, isForm, to,
      function (res) {
        if (res.error === 'backend_unavailable' || res.error === 'timeout') {
          self.available = false;
        } else if (res.ok) {
          self.available = true;
        }
        cb(res);
      });
  };

  /* Wrap a callback-style call so callers may also use Promises when they
     exist and no callback was given. */
  PlatformClient.prototype._maybePromise = function (fn, cb) {
    if (isFunction(cb)) { fn(cb); return undefined; }
    if (typeof Promise !== 'undefined') {
      var self = this;
      return new Promise(function (resolve) { fn(resolve); });
    }
    var result = null;
    fn(function (r) { result = r; });
    return result;
  };

  /* ---------------- health / availability ---------------- */

  PlatformClient.prototype.checkHealth = function (cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/health', null, function (res) {
        self.available = !!res.ok;
        done(res);
      }, 5000);
    }, cb);
  };

  PlatformClient.prototype.isAvailable = function () { return this.available === true; };
  PlatformClient.prototype.isBackendKnownDown = function () { return this.available === false; };

  /* ---------------- per-chat mode ---------------- */

  PlatformClient.prototype.getMode = function (chatId) {
    if (!chatId) return 'normal';
    var m = this._modes[chatId];
    return (m === 'research' || m === 'normal') ? m : 'normal';
  };

  PlatformClient.prototype.setMode = function (chatId, mode) {
    if (!chatId) return 'normal';
    var m = (mode === 'research') ? 'research' : 'normal';
    this._modes[chatId] = m;
    saveModes(this._modes);
    return m;
  };

  PlatformClient.prototype.toggleMode = function (chatId) {
    return this.setMode(chatId, this.getMode(chatId) === 'research' ? 'normal' : 'research');
  };

  PlatformClient.prototype.clearMode = function (chatId) {
    if (!chatId) return;
    delete this._modes[chatId];
    saveModes(this._modes);
  };

  /* Convenience for the merge: returns the mode the newly active chat
     should show, so the UI can re-sync its (per-chat) indicator. */
  PlatformClient.prototype.modeForChat = function (chatId) {
    return this.getMode(chatId);
  };

  /* ---------------- chats ---------------- */

  PlatformClient.prototype.listChats = function (cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/chats', null, done);
    }, cb);
  };

  PlatformClient.prototype.createChat = function (title, cb) {
    var self = this;
    if (isFunction(title)) { cb = title; title = undefined; }
    return this._maybePromise(function (done) {
      self._req('POST', '/chats', { title: title || 'New Chat' }, done);
    }, cb);
  };

  PlatformClient.prototype.getChat = function (chatId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/chats/' + encodeURIComponent(chatId), null, done);
    }, cb);
  };

  PlatformClient.prototype.getMessages = function (chatId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/chats/' + encodeURIComponent(chatId) + '/messages', null, done);
    }, cb);
  };

  /* ---------------- ask ----------------
   * opts: { via_voice, idempotency_key }
   * Response data (on success) is the backend envelope:
   *   { ok:true, task_id, mode:"normal"|"research"|"clarify",
   *     clarification_question?, answer?, sources? }
   * mode "clarify" means the backend asked ONE question and created NO
   * task — the UI must show clarification_question and wait for the user.
   * mode "normal" may already carry answer + sources inline.
   * mode "research" means a background task was created; follow it with
   * getProgress() / event polling until task_completed.
   * On backend failure the result is { ok:false, error:'backend_unavailable',
   * fallback:true } — the caller MUST run the legacy client-side ask.
   */
  PlatformClient.prototype.ask = function (chatId, question, opts, cb) {
    var self = this;
    if (isFunction(opts)) { cb = opts; opts = {}; }
    opts = opts || {};
    return this._maybePromise(function (done) {
      if (!chatId || !question) {
        done({ ok: false, error: 'bad_request', message: 'chatId and question are required.' });
        return;
      }
      var body = { question: question, via_voice: !!opts.via_voice };
      if (opts.idempotency_key) body.idempotency_key = opts.idempotency_key;
      self._req('POST', '/chats/' + encodeURIComponent(chatId) + '/ask', body,
        function (res) {
          if (!res.ok && res.error === 'backend_unavailable') {
            res.fallback = true;
          }
          done(res);
        });
    }, cb);
  };

  /* ---------------- tasks ---------------- */

  PlatformClient.prototype.listTasks = function (chatId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/chats/' + encodeURIComponent(chatId) + '/tasks', null, done);
    }, cb);
  };

  PlatformClient.prototype.getTask = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/tasks/' + encodeURIComponent(taskId), null, done);
    }, cb);
  };

  PlatformClient.prototype.getProgress = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/tasks/' + encodeURIComponent(taskId) + '/progress', null, done);
    }, cb);
  };

  PlatformClient.prototype.pauseTask = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('POST', '/tasks/' + encodeURIComponent(taskId) + '/pause', {}, done);
    }, cb);
  };

  PlatformClient.prototype.resumeTask = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('POST', '/tasks/' + encodeURIComponent(taskId) + '/resume', {}, done);
    }, cb);
  };

  PlatformClient.prototype.cancelTask = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('POST', '/tasks/' + encodeURIComponent(taskId) + '/cancel', {}, done);
    }, cb);
  };

  PlatformClient.prototype.modifyTask = function (taskId, instruction, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('POST', '/tasks/' + encodeURIComponent(taskId) + '/modify',
        { instruction: instruction }, done);
    }, cb);
  };

  PlatformClient.prototype.getSources = function (taskId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/tasks/' + encodeURIComponent(taskId) + '/sources', null, done);
    }, cb);
  };

  /* ---------------- files ---------------- */

  PlatformClient.prototype.listFiles = function (chatId, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('GET', '/chats/' + encodeURIComponent(chatId) + '/files', null, done);
    }, cb);
  };

  /* file: a File/Blob from an <input type="file">. Requires FormData. */
  PlatformClient.prototype.uploadFile = function (chatId, file, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      if (typeof FormData === 'undefined' || !file) {
        done({ ok: false, error: 'unsupported',
          message: 'File upload needs FormData support and a file.' });
        return;
      }
      var fd = new FormData();
      fd.append('file', file, file.name || 'upload');
      self._req('POST', '/chats/' + encodeURIComponent(chatId) + '/files', fd, done, 120000);
    }, cb);
  };

  PlatformClient.prototype.askFile = function (chatId, fileId, question, cb) {
    var self = this;
    return this._maybePromise(function (done) {
      self._req('POST', '/chats/' + encodeURIComponent(chatId) + '/files/' +
        encodeURIComponent(fileId) + '/ask', { question: question }, done);
    }, cb);
  };

  /* ---------------- events (long-poll) ----------------
   * startEventPolling(chatId, handlers, since)
   *   handlers: { onEvent(event), onError(result), onTaskUpdate(taskId) }
   * Returns a handle { stop() }. Polling uses GET
   * /chats/{id}/events?since=<last event_id>; the server holds up to 25 s.
   * On a transport error the poller backs off (2 s, doubling to 30 s max)
   * and retries; it NEVER invents events. Call stop() when leaving the chat.
   */
  PlatformClient.prototype.startEventPolling = function (chatId, handlers, since) {
    var self = this;
    handlers = handlers || {};
    var poller = {
      chatId: chatId,
      since: (since === undefined || since === null) ? 0 : since,
      stopped: false,
      backoffMs: POLL_ERROR_BACKOFF_MS,
      stop: function () { poller.stopped = true; }
    };
    this._pollers[chatId] = poller;

    function pollOnce() {
      if (poller.stopped) return;
      self._req('GET', '/chats/' + encodeURIComponent(chatId) + '/events?since=' + poller.since,
        null,
        function (res) {
          if (poller.stopped) return;
          if (!res.ok) {
            if (isFunction(handlers.onError)) handlers.onError(res);
            poller.backoffMs = Math.min(poller.backoffMs * 2, MAX_POLL_ERROR_BACKOFF_MS);
            setTimeout(pollOnce, poller.backoffMs);
            return;
          }
          poller.backoffMs = POLL_ERROR_BACKOFF_MS;
          var data = res.data || {};
          var events = data.events || [];
          var i, ev;
          for (i = 0; i < events.length; i++) {
            ev = events[i];
            if (ev && typeof ev.event_id === 'number' && ev.event_id > poller.since) {
              poller.since = ev.event_id;
            }
            if (isFunction(handlers.onEvent)) handlers.onEvent(ev);
            if (ev && ev.task_id && isFunction(handlers.onTaskUpdate)) {
              handlers.onTaskUpdate(ev.task_id, ev);
            }
          }
          /* Long-poll returns immediately when events exist, after ~25 s
             when none do — either way, poll again at once. */
          setTimeout(pollOnce, 0);
        }, LONG_POLL_TIMEOUT_MS + 5000);
    }
    setTimeout(pollOnce, 0);
    return poller;
  };

  PlatformClient.prototype.stopEventPolling = function (chatId) {
    var poller = this._pollers[chatId];
    if (poller) { poller.stop(); delete this._pollers[chatId]; }
  };

  PlatformClient.prototype.stopAllPolling = function () {
    var id;
    for (id in this._pollers) {
      if (Object.prototype.hasOwnProperty.call(this._pollers, id)) {
        this._pollers[id].stop();
      }
    }
    this._pollers = {};
  };

  /* ------------------------------------------------------------------ */
  /* Rendering helpers — pure HTML-string builders. They render ONLY     */
  /* what the backend returned. Progress comes from done/total + agent   */
  /* statuses; ETA only from a non-null eta_s.                           */
  /* ------------------------------------------------------------------ */

  /* progressData (from GET /tasks/{id}/progress):
   * { state, done, total, agents:[{agent_id, role, status}],
   *   elapsed_s, eta_s (number|null), eta_basis ("measured"|null),
   *   findings_preview: [...] }
   * Returns an HTML string for insertion into #progressBox (or any box).
   * Returns '' when there is nothing to show (no task / terminal state
   * with zero subtasks). */
  PlatformClient.prototype.renderProgress = function (progressData, taskTitle) {
    if (!progressData || !isObject(progressData)) return '';
    var total = (typeof progressData.total === 'number') ? progressData.total : 0;
    var done = (typeof progressData.done === 'number') ? progressData.done : 0;
    if (total <= 0) return '';
    var state = progressData.state || '';
    var pct = Math.round((done / total) * 100);
    var h = '<div class="progress research">';
    h += '<div class="progress-head">Live progress</div>';
    if (taskTitle) h += '<div class="progress-step done"><span>' + esc(taskTitle) + '</span></div>';
    h += '<div class="progress-step done"><span>' + done + ' of ' + total +
         ' steps done (' + pct + '%)</span></div>';
    h += '<div class="ac-progress" style="width:100%"><i style="width:' + pct + '%"></i></div>';
    var agents = progressData.agents || [];
    var i, a;
    for (i = 0; i < agents.length; i++) {
      a = agents[i] || {};
      var status = a.status || 'queued';
      var mark = (status === 'done') ? 'done' : (status === 'running') ? 'running' : 'queued';
      h += '<div class="progress-step' + (status === 'done' ? ' done' : '') + '">';
      h += '<span>' + esc(a.role || 'agent') + ' — ' + esc(status) + '</span></div>';
      void mark;
    }
    /* ETA: shown ONLY when the backend measured one. Otherwise the honest
       "estimating…" — never a guessed number. */
    if (typeof progressData.eta_s === 'number' && progressData.eta_s !== null) {
      h += '<div class="progress-step"><span>Estimated time left: ' +
           esc(formatEta(progressData.eta_s)) + '</span></div>';
    } else {
      h += '<div class="progress-step"><span>Estimated time left: estimating…</span></div>';
    }
    if (state) {
      h += '<div class="progress-step"><span>State: ' + esc(state) + '</span></div>';
    }
    var findings = progressData.findings_preview || [];
    for (i = 0; i < findings.length; i++) {
      h += '<div class="progress-step"><span>' + esc(String(findings[i])) + '</span></div>';
    }
    h += '</div>';
    return h;
  };

  /* Render a progress payload into a container element (clears it when
     there is nothing to show). Returns true when something was rendered. */
  PlatformClient.prototype.showProgress = function (containerEl, progressData, taskTitle) {
    if (!containerEl) return false;
    var html = this.renderProgress(progressData, taskTitle);
    containerEl.innerHTML = html;
    return html !== '';
  };

  /* sources: rows from GET /tasks/{id}/sources:
   * { source_id, url, final_url, title, outlet, pub_date,
   *   quality, supports_claim, unverified_link }
   * Rules (PLAN.md section 3.5):
   *  - link only to final_url when it exists and is verified;
   *  - a Google News redirect (or any unverified_link) is rendered as
   *    plain text with the label "unverified link" and NO <a href>;
   *  - pubDate is always shown when present, otherwise "date not given".
   */
  PlatformClient.prototype.renderSources = function (sources) {
    var list = sources || [];
    if (!list.length) return '';
    var h = '<div class="platform-sources"><div class="progress-head">Sources</div><ul>';
    var i, s, url, date;
    for (i = 0; i < list.length; i++) {
      s = list[i] || {};
      url = openableUrl(s);
      date = formatPubDate(s.pub_date);
      h += '<li>';
      if (url) {
        h += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
             esc(s.title || url) + '</a>';
      } else {
        h += '<span>' + esc(s.title || s.url || 'Source') + '</span>' +
             ' <span class="platform-unverified">(unverified link — not openable)</span>';
      }
      if (s.outlet) h += ' <span>— ' + esc(s.outlet) + '</span>';
      h += ' <span>(' + (date ? esc(date) : 'date not given') + ')</span>';
      if (typeof s.quality === 'number') {
        h += ' <span>quality ' + esc(s.quality.toFixed(2)) + '</span>';
      }
      h += '</li>';
    }
    h += '</ul></div>';
    return h;
  };

  PlatformClient.prototype.showSources = function (containerEl, sources) {
    if (!containerEl) return false;
    var html = this.renderSources(sources);
    containerEl.innerHTML = html;
    return html !== '';
  };

  /* Clarification rendering: the backend asked ONE question and created no
     task. Returns HTML the UI can show as an AI message. */
  PlatformClient.prototype.renderClarification = function (question) {
    if (!question) return '';
    return '<div class="platform-clarify"><p>' + esc(question) + '</p>' +
      '<p>Please answer so I can run the right research.</p></div>';
  };

  /* ------------------------------------------------------------------ */
  /* Explicit page binding (opt-in only — the adapter NEVER auto-hooks). */
  /*                                                                     */
  /* bind(hooks) wires this client into the existing page at the points  */
  /* listed in MERGE-SPEC.md. hooks:                                     */
  /*   { getActiveChatId(), onBackendAnswer(result), onFallback(question),
  /*     onClarify(question), onProgress(taskId, progressData),
  /*     onTaskEvent(event), getMode(chatId), setMode(chatId, mode) }     */
  /* Returns a controller with askViaPlatform(question, opts) and        */
  /* setActiveChat(chatId) helpers. The page keeps full control: if      */
  /* askViaPlatform reports fallback, the page runs its legacy           */
  /* askQuestion() path unchanged.                                       */
  /* ------------------------------------------------------------------ */

  PlatformClient.prototype.bind = function (hooks) {
    var self = this;
    hooks = hooks || {};
    if (this._bound) return this._binding;
    this._bound = true;

    var controller = {
      client: self,
      hooks: hooks,
      activeChatId: null,
      activePoller: null,

      setActiveChat: function (chatId) {
        if (controller.activeChatId) self.stopEventPolling(controller.activeChatId);
        controller.activeChatId = chatId || null;
        if (chatId) {
          controller.activePoller = self.startEventPolling(chatId, {
            onEvent: function (ev) {
              if (isFunction(hooks.onTaskEvent)) hooks.onTaskEvent(ev);
            },
            onTaskUpdate: function (taskId) {
              self.getProgress(taskId, function (res) {
                if (res.ok && isFunction(hooks.onProgress)) {
                  hooks.onProgress(taskId, res.data);
                }
              });
            },
            onError: function (res) {
              if (isFunction(hooks.onPollError)) hooks.onPollError(res);
            }
          });
        }
        return self.modeForChat(chatId);
      },

      /* Try the platform backend for one question. Result object:
       *  { handled:true, mode }        — backend took the question
       *  { handled:false, fallback:true } — backend down; page must run
       *    its legacy askQuestion() path unchanged.
       */
      askViaPlatform: function (question, opts, cb) {
        opts = opts || {};
        var chatId = controller.activeChatId ||
          (isFunction(hooks.getActiveChatId) ? hooks.getActiveChatId() : null);
        if (!chatId) {
          if (isFunction(cb)) cb({ handled: false, fallback: true, error: 'no_active_chat' });
          return;
        }
        self.ask(chatId, question, opts, function (res) {
          if (!res.ok) {
            if (res.error === 'backend_unavailable' && isFunction(hooks.onFallback)) {
              hooks.onFallback(question);
            }
            if (isFunction(cb)) {
              cb({ handled: false, fallback: res.error === 'backend_unavailable', error: res.error });
            }
            return;
          }
          var data = res.data || {};
          if (data.mode === 'clarify') {
            if (isFunction(hooks.onClarify)) hooks.onClarify(data.clarification_question);
          } else if (isFunction(hooks.onBackendAnswer)) {
            hooks.onBackendAnswer(data);
          }
          if (isFunction(cb)) cb({ handled: true, mode: data.mode, task_id: data.task_id });
        });
      }
    };

    this._binding = controller;
    return controller;
  };

  /* ------------------------------------------------------------------ */
  /* Public surface                                                      */
  /* ------------------------------------------------------------------ */

  var api = {
    Client: PlatformClient,
    create: function (options) { return new PlatformClient(options); },
    /* Shared default instance (base '/api/v2' — same origin as the page). */
    defaultClient: new PlatformClient({}),
    /* Test-only helpers, also used by test-page.html. */
    _esc: esc,
    _formatEta: formatEta,
    _formatPubDate: formatPubDate,
    _openableUrl: openableUrl,
    _isRedirectUrl: isRedirectUrl,
    VERSION: '0.1.0'
  };

  global.EnaoPlatform = api;

})(typeof window !== 'undefined' ? window : this);
