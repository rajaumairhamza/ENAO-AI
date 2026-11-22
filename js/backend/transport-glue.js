
/* v59-live-research-fix glue: one shared guarded transport + PollingFix install.
   The transport is created once, on the shared EnzoPollingFix registry, with
   the backend base resolved by EnzoPagesBackend for the host actually serving
   this page (same-origin on enzoai.cu.gy, absolute backend URL elsewhere). */
window.__enzoTransport59 = null;
window.__enzoGetTransport59 = function () {
  try {
    if (!window.__enzoTransport59 && window.EnzoPollingFix && window.EnzoPagesBackend && typeof window.fetch === 'function') {
      window.__enzoTransport59 = window.EnzoPollingFix.createTransport(window.fetch.bind(window), window.EnzoPollingFix._registry, { base: window.EnzoPagesBackend.getBackendBase() });
    }
  } catch (e) {}
  return window.__enzoTransport59;
};
(function () {
  var tries59 = 0;
  function attempt59() {
    tries59++;
    try {
      if (window.EnzoPollingFix) window.EnzoPollingFix.install();
      if (window.EnzoMonitor) return true;
    } catch (e) {}
    return false;
  }
  if (attempt59()) return;
  var iv59 = setInterval(function () {
    if (attempt59() || tries59 > 120) clearInterval(iv59);
  }, 500);
})();
