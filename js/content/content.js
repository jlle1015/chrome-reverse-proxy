(() => {
  if (window.__chromeNginxContentLoaded) return;
  window.__chromeNginxContentLoaded = true;

  const RULE_VIEW_FIELDS = ['id', 'enabled', 'matchType', 'pattern', 'includeCookies', 'forwardPageCookie'];

  let rulesCache = [];
  let debugMode = false;

  function relevantRules() {
    return rulesCache.filter((r) => isRuleRelevant(r, location.hostname));
  }

  async function refreshRules() {
    const data = await chrome.storage.local.get({ rules: [], debugMode: false });
    rulesCache = Array.isArray(data.rules) ? data.rules : [];
    debugMode = !!data.debugMode;
  }

  function broadcastRules() {
    const view = relevantRules().map((r) => {
      const o = {};
      for (const f of RULE_VIEW_FIELDS) if (r[f] !== undefined) o[f] = r[f];
      return o;
    });
    window.postMessage({ __chromeNginx: true, type: 'rules-update', rules: view, debug: debugMode }, '*');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rules) {
      rulesCache = changes.rules.newValue || [];
    }
    if (changes.debugMode) {
      debugMode = changes.debugMode.newValue === true;
    }
    if (changes.rules || changes.debugMode) {
      broadcastRules();
    }
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__chromeNginx !== true) return;
    const data = e.data;
    if (data.type === 'request-rules') {
      broadcastRules();
      return;
    }
    if (data.type !== 'proxy-request' || !data.id) return;
    chrome.runtime.sendMessage(data, (payload) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        window.postMessage(
          { __chromeNginx: true, type: 'proxy-response', id: data.id, payload: { ok: false, error: lastError.message } },
          '*'
        );
        return;
      }
      window.postMessage({ __chromeNginx: true, type: 'proxy-response', id: data.id, payload }, '*');
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'ping') {
      sendResponse({ ok: true, rules: relevantRules().length, debug: debugMode });
    }
  });

  refreshRules().then(broadcastRules);
})();
