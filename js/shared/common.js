(() => {
  if (window.__chromeNginxCommonLoaded) return;
  window.__chromeNginxCommonLoaded = true;

  const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
  const SECOND_LEVEL_TLDS = new Set(['com', 'net', 'org', 'gov', 'edu', 'ac', 'co', 'ne', 'or', 'go', 'mil', 'ltd', 'biz']);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function sansScheme(u) {
    return String(u).replace(/^https?:\/\//i, '');
  }

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
    host = host.toLowerCase();
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
    return isRuleForHost(rule, pageHost);
  }

  function isRuleForHost(rule, pageHost) {
    if (!rule) return false;
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

  function relevantOf(rules, host) {
    return rules.filter((r) => isRuleRelevant(r, host));
  }

  function relevantOfAll(rules, host) {
    return rules.filter((r) => isRuleForHost(r, host));
  }

  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.sansScheme = sansScheme;
  window.hostOfPattern = hostOfPattern;
  window.registrableDomain = registrableDomain;
  window.isRuleRelevant = isRuleRelevant;
  window.isRuleForHost = isRuleForHost;
  window.relevantOf = relevantOf;
  window.relevantOfAll = relevantOfAll;
})();