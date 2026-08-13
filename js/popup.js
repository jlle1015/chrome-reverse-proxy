function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const SECOND_LEVEL_TLDS = new Set(['com', 'net', 'org', 'gov', 'edu', 'ac', 'co', 'ne', 'or', 'go', 'mil', 'ltd', 'biz']);

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

function relevantOf(rules, host) {
  return rules.filter((r) => isRuleRelevant(r, host));
}

async function getTabHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) return '';
    return new URL(tab.url).hostname;
  } catch (e) {
    return '';
  }
}

function renderRules(rules, pageHost) {
  const list = document.getElementById('rule-list');
  const shown = pageHost ? relevantOf(rules, pageHost) : rules;
  const anyEnabled = shown.some((r) => r.enabled !== false);
  const btn = document.getElementById('btn-toggle-all');
  btn.textContent = anyEnabled ? '停用全部' : '启用全部';
  const countEl = document.getElementById('rule-count');
  countEl.textContent = pageHost ? '(' + shown.length + '/' + rules.length + ')' : '(' + rules.length + ')';
  if (!shown.length) {
    list.innerHTML = '<p class="empty">' +
      (rules.length ? '当前页面无匹配规则' : '暂无规则，请到配置页新增。') +
      '</p>';
    return;
  }
  list.innerHTML = '';
  shown.forEach((rule) => {
    const el = document.createElement('div');
    el.className = 'rule' + (rule.enabled === false ? ' off' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rule.enabled !== false;
    cb.addEventListener('change', async () => {
      rule.enabled = cb.checked;
      el.className = 'rule' + (rule.enabled === false ? ' off' : '');
      await chrome.storage.local.set({ rules });
      renderRules(rules, pageHost);
    });
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = rule.name || '(未命名)';
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = '→ ' + (rule.target || '');
    el.append(cb, name, target);
    list.appendChild(el);
  });
}

function kvTable(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '<p class="p-empty">（无）</p>';
  return entries
    .map((kv) => '<div class="kv"><span class="k">' + escapeHtml(kv[0]) + '</span><span class="v">' + escapeHtml(kv[1]) + '</span></div>')
    .join('');
}

async function renderLogs() {
  const data = await chrome.storage.local.get({ logs: [], rules: [] });
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const host = await getTabHost();
  let pool = logs;
  if (host) {
    const relevantIds = new Set(relevantOf(rules, host).map((r) => r.id));
    pool = logs.filter((log) => relevantIds.has(log.ruleId));
  }
  const list = document.getElementById('log-list');
  const recent = pool.slice(0, 8);
  if (!recent.length) {
    list.innerHTML = '<p class="empty">' +
      (host && logs.length ? '暂无当前页面匹配规则的日志' : '暂无日志，页面调用被代理后会显示在这里。') +
      '</p>';
    return;
  }
  list.innerHTML = '';
  recent.forEach((log) => {
    const row = document.createElement('div');
    row.className = 'log ' + (log.ok ? 'ok' : 'err');
    const status = log.ok ? String(log.status || '') : (log.error || '失败');
    const duration = log.duration != null ? log.duration + 'ms' : '';
    row.innerHTML =
      '<span class="log-time">' + escapeHtml(log.time || '') + '</span>' +
      '<span class="log-method">' + escapeHtml(log.method || '') + '</span>' +
      '<span class="log-status">' + escapeHtml(status) + '</span>' +
      '<span class="log-url" title="' + escapeAttr(log.url || '') + '">' + escapeHtml(log.url || '') + '</span>' +
      (duration ? '<span class="log-duration">' + escapeHtml(duration) + '</span>' : '') +
      '<span class="log-toggle">▸</span>';

    const meta = [
      ['规则', log.ruleName || log.ruleId || '-'],
      ['耗时', duration],
      ['目标URL', log.target || ''],
    ]
      .map((m) => '<div class="kv"><span class="k">' + escapeHtml(m[0]) + '</span><span class="v">' + escapeHtml(m[1]) + '</span></div>')
      .join('');

    const detail = document.createElement('div');
    detail.className = 'log-detail';
    detail.hidden = true;
    detail.innerHTML =
      '<div class="detail-sec">' + meta + '</div>' +
      '<div class="detail-sec"><div class="sec-label">请求头</div>' + kvTable(log.requestHeaders) + '</div>' +
      '<div class="detail-sec"><div class="sec-label">请求体（入参）</div><pre>' + escapeHtml(log.requestBody || '（无）') + '</pre></div>' +
      '<div class="detail-sec"><div class="sec-label">响应头</div>' + kvTable(log.responseHeaders) + '</div>' +
      '<div class="detail-sec"><div class="sec-label">响应体（出参）</div><pre>' + escapeHtml(log.responseBody || '（无）') + '</pre></div>';

    row.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      row.classList.toggle('expanded', !detail.hidden);
      const t = row.querySelector('.log-toggle');
      if (t) t.textContent = detail.hidden ? '▸' : '▾';
    });
    list.appendChild(row);
    list.appendChild(detail);
  });
}

async function renderTabStatus() {
  const el = document.getElementById('tab-status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) {
      el.className = 'status-warn';
      el.textContent = '当前页面不注入 Content Script';
      return;
    }
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    el.className = 'status-ok';
    el.textContent =
      '当前页面：已注入（规则 ' + (resp && resp.rules || 0) + ' 条' + (resp && resp.debug ? '，调试模式开启' : '') + '）';
  } catch (e) {
    el.className = 'status-warn';
    el.textContent = '当前页面：未检测到 Content Script，请刷新页面或重新加载扩展';
  }
}

document.getElementById('btn-toggle-all').addEventListener('click', async () => {
  const data = await chrome.storage.local.get({ rules: [] });
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const anyEnabled = rules.some((r) => r.enabled !== false);
  rules.forEach((r) => {
    r.enabled = !anyEnabled;
  });
  await chrome.storage.local.set({ rules });
  const host = await getTabHost();
  renderRules(rules, host);
});

document.getElementById('btn-clear-log').addEventListener('click', async () => {
  const btn = document.getElementById('btn-clear-log');
  await chrome.storage.local.remove('logs');
  btn.textContent = '已清空';
  setTimeout(() => {
    btn.textContent = '清空日志';
  }, 1200);
});

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-logs').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.set({ jumpToLogs: true });
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.rules) {
    const host = getTabHost().then((h) => renderRules(changes.rules.newValue || [], h));
  }
  if (changes.logs) renderLogs();
});

(async () => {
  const data = await chrome.storage.local.get({ rules: [], logs: [] });
  const host = await getTabHost();
  renderRules(data.rules || [], host);
  renderLogs();
  renderTabStatus();
})();
