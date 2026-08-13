const RULE_VIEW_FIELDS = ['id', 'enabled', 'matchType', 'pattern', 'includeCookies', 'forwardPageCookie'];

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

const SECOND_LEVEL_TLDS = new Set(['com', 'net', 'org', 'gov', 'edu', 'ac', 'co', 'ne', 'or', 'go', 'mil', 'ltd', 'biz']);

let rulesCache = [];
let debugMode = false;

function hostOfPattern(pattern) {
  let p = String(pattern || '').trim();
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = p.search(/[/?#]/);
  if (slash >= 0) p = p.slice(0, slash);
  const colon = p.indexOf(':');
  if (colon >= 0) p = p.slice(0, colon);
  return HOST_RE.test(p) ? p.toLowerCase() : '';
}

function registrableDomain(host) {
  if (!host) return '';
  if (IP_RE.test(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const last = labels.length - 1;
  if (/^[a-z]{2}$/.test(labels[last]) && SECOND_LEVEL_TLDS.has(labels[last - 1])) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

function isRuleRelevant(rule, pageHost) {
  if (!rule || rule.enabled === false) return false;
  if (rule.matchType === 'regex') return true;
  const host = hostOfPattern(rule.pattern);
  if (!host) return true;
  const ph = String(pageHost || '').toLowerCase();
  const h = host.toLowerCase();
  if (h === ph) return true;
  if (ph.endsWith('.' + h) || h.endsWith('.' + ph)) return true;
  const rootH = registrableDomain(h);
  const rootP = registrableDomain(ph);
  return !!rootH && rootH === rootP;
}

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
