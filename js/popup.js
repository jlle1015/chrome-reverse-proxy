function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function renderRules(rules) {
  const list = document.getElementById('rule-list');
  const anyEnabled = rules.some((r) => r.enabled !== false);
  const btn = document.getElementById('btn-toggle-all');
  btn.textContent = anyEnabled ? '停用全部' : '启用全部';
  if (!rules.length) {
    list.innerHTML = '<p class="empty">暂无规则，请到配置页新增。</p>';
    return;
  }
  list.innerHTML = '';
  rules.forEach((rule) => {
    const el = document.createElement('div');
    el.className = 'rule' + (rule.enabled === false ? ' off' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rule.enabled !== false;
    cb.addEventListener('change', async () => {
      rule.enabled = cb.checked;
      el.className = 'rule' + (rule.enabled === false ? ' off' : '');
      await chrome.storage.local.set({ rules });
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

function renderLogs(logs) {
  const list = document.getElementById('log-list');
  const recent = (Array.isArray(logs) ? logs : []).slice(0, 8);
  if (!recent.length) {
    list.innerHTML = '<p class="empty">暂无日志，页面调用被代理后会显示在这里。</p>';
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
  renderRules(rules);
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
  if (changes.rules) renderRules(changes.rules.newValue || []);
  if (changes.logs) renderLogs(changes.logs.newValue || []);
});

(async () => {
  const data = await chrome.storage.local.get({ rules: [], logs: [] });
  renderRules(data.rules || []);
  renderLogs(data.logs || []);
  renderTabStatus();
})();
