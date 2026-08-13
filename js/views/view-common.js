async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) {
    return null;
  }
}

function tabHost(tab) {
  if (!tab || !/^https?:/.test(tab.url || '')) return '';
  try {
    return new URL(tab.url).hostname;
  } catch (e) {
    return '';
  }
}

function renderRules(rules, pageHost) {
  const list = document.getElementById('rule-list');
  const shown = pageHost ? relevantOfAll(rules, pageHost) : rules;
  const anyEnabled = shown.some((r) => r.enabled !== false);
  document.getElementById('btn-toggle-all').textContent = anyEnabled ? '停用全部' : '启用全部';
  const countEl = document.getElementById('rule-count');
  if (countEl) countEl.textContent = pageHost ? '(' + shown.length + '/' + rules.length + ')' : '(' + rules.length + ')';
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
    const info = document.createElement('span');
    info.className = 'info';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = rule.name || '(未命名)';
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = '→ ' + (rule.target || '');
    info.append(name, target);
    el.append(cb, info);
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

function renderLogs(logs, rules, pageHost, limit) {
  const list = document.getElementById('log-list');
  const all = Array.isArray(logs) ? logs : [];
  let pool = all;
  if (pageHost) {
    const relevantIds = new Set(relevantOfAll(rules, pageHost).map((r) => r.id));
    pool = all.filter((log) => relevantIds.has(log.ruleId));
  }
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = pageHost ? '(' + pool.length + '/' + all.length + ')' : '(' + pool.length + ')';
  const recent = pool.slice(0, limit || 8);
  if (!recent.length) {
    list.innerHTML = '<p class="empty">' +
      (pageHost && all.length ? '暂无当前页面匹配规则的日志' : '暂无日志，页面调用被代理后会显示在这里。') +
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

async function refreshView(limit) {
  const data = await chrome.storage.local.get({ rules: [], logs: [] });
  const tab = await getActiveTab();
  const host = tabHost(tab);
  renderRules(Array.isArray(data.rules) ? data.rules : [], host);
  renderLogs(data.logs, data.rules, host, limit);
}

function bindToggleAll() {
  document.getElementById('btn-toggle-all').addEventListener('click', async () => {
    const data = await chrome.storage.local.get({ rules: [] });
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const anyEnabled = rules.some((r) => r.enabled !== false);
    rules.forEach((r) => {
      r.enabled = !anyEnabled;
    });
    await chrome.storage.local.set({ rules });
    const tab = await getActiveTab();
    renderRules(rules, tabHost(tab));
  });
}

function bindClearLog() {
  const btn = document.getElementById('btn-clear-log');
  if (!btn) return;
  const originalText = btn.textContent;
  btn.addEventListener('click', async () => {
    await chrome.storage.local.remove('logs');
    btn.textContent = '已清空';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1200);
  });
}

function bindOpenLinks() {
  document.getElementById('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('open-logs').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.storage.local.set({ jumpToLogs: true });
    chrome.runtime.openOptionsPage();
  });
}

async function reinjectActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error('无法获取当前标签页');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    files: ['js/shared/common.js', 'js/content/content.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    files: ['js/content/page-proxy.js'],
  });
}

function bindReinject(limit) {
  const btn = document.getElementById('btn-reinject');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '注入中…';
    try {
      await reinjectActiveTab();
      btn.textContent = '已注入';
    } catch (e) {
      btn.textContent = '注入失败';
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = original;
    }, 1500);
    refreshView(limit);
    renderTabStatus();
  });
}

function bindViewCommon(limit) {
  bindToggleAll();
  bindClearLog();
  bindOpenLinks();
  bindReinject(limit);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rules || changes.logs) refreshView(limit);
  });
}