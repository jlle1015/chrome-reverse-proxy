let rules = [];

async function loadRules() {
  const data = await chrome.storage.local.get({ rules: [] });
  rules = Array.isArray(data.rules) ? data.rules : [];
}

async function saveRules() {
  await chrome.storage.local.set({ rules });
  render();
}

function newId() {
  return 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function readForm() {
  const name = document.getElementById('f-name').value.trim();
  const matchType = document.getElementById('f-matchType').value;
  const pattern = document.getElementById('f-pattern').value.trim();
  const target = document.getElementById('f-target').value.trim();
  const forwardHeaders = document
    .getElementById('f-forwardHeaders')
    .value.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let addHeaders = {};
  const addText = document.getElementById('f-addHeaders').value.trim();
  if (addText) {
    try {
      addHeaders = JSON.parse(addText);
    } catch (e) {
      throw new Error('附加请求头 JSON 格式错误');
    }
  }
  if (!name) throw new Error('请填写规则名称');
  if (!pattern) throw new Error('请填写匹配规则');
  if (!target) throw new Error('请填写转发目标');
  return {
    name,
    matchType,
    pattern,
    target,
    forwardHeaders,
    addHeaders,
    forwardPageCookie: document.getElementById('f-forwardPageCookie').checked,
    includeCookies: document.getElementById('f-includeCookies').checked,
    enabled: document.getElementById('f-enabled').checked,
  };
}

function fillForm(rule) {
  document.getElementById('edit-id').value = rule.id;
  document.getElementById('form-title').textContent = '编辑规则';
  document.getElementById('f-name').value = rule.name || '';
  document.getElementById('f-matchType').value = rule.matchType || 'prefix';
  document.getElementById('f-pattern').value = rule.pattern || '';
  document.getElementById('f-target').value = rule.target || '';
  document.getElementById('f-forwardHeaders').value = (rule.forwardHeaders || []).join(',');
  document.getElementById('f-addHeaders').value = JSON.stringify(rule.addHeaders || {}, null, 2);
  document.getElementById('f-forwardPageCookie').checked = !!rule.forwardPageCookie;
  document.getElementById('f-includeCookies').checked = !!rule.includeCookies;
  document.getElementById('f-enabled').checked = rule.enabled !== false;
  document.getElementById('btn-cancel').hidden = false;
  document.getElementById('form-error').textContent = '';
}

function resetForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = '新增规则';
  document.getElementById('f-name').value = '';
  document.getElementById('f-matchType').value = 'prefix';
  document.getElementById('f-pattern').value = '';
  document.getElementById('f-target').value = '';
  document.getElementById('f-forwardHeaders').value = 'content-type,authorization,x-request-id';
  document.getElementById('f-addHeaders').value = '';
  document.getElementById('f-forwardPageCookie').checked = false;
  document.getElementById('f-includeCookies').checked = false;
  document.getElementById('f-enabled').checked = true;
  document.getElementById('btn-cancel').hidden = true;
  document.getElementById('form-error').textContent = '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function render() {
  const list = document.getElementById('rule-list');
  list.innerHTML = '';
  if (!rules.length) {
    list.innerHTML = '<p class="empty">暂无规则，请在上方新增。</p>';
    return;
  }
  rules.forEach((rule, index) => {
    const el = document.createElement('div');
    el.className = 'rule' + (rule.enabled === false ? ' disabled' : '');
    el.innerHTML =
      '<div class="rule-head">' +
      '<strong>' + escapeHtml(rule.name) + '</strong>' +
      '<span class="badge">' + (rule.enabled === false ? '已停用' : '启用中') + '</span>' +
      '<span class="order">#' + (index + 1) + '</span>' +
      '</div>' +
      '<div class="rule-body"><code>' + escapeHtml(rule.pattern) + '</code>' +
      '<span class="arrow">→</span><code>' + escapeHtml(rule.target) + '</code></div>' +
      '<div class="rule-meta">' +
      '<span>转发头: ' + escapeHtml((rule.forwardHeaders || []).join(', ') || '（无）') + '</span>' +
      '<span>附加请求头: ' + escapeHtml(JSON.stringify(rule.addHeaders || {})) + '</span>' +
      (rule.forwardPageCookie ? '<span>携带页面Cookie</span>' : '') +
      (rule.includeCookies ? '<span>携带目标Cookie</span>' : '') +
      '</div>' +
      '<div class="rule-actions">' +
      '<button data-act="toggle">' + (rule.enabled === false ? '启用' : '停用') + '</button>' +
      '<button data-act="up"' + (index === 0 ? ' disabled' : '') + '>上移</button>' +
      '<button data-act="down"' + (index === rules.length - 1 ? ' disabled' : '') + '>下移</button>' +
      '<button data-act="copy">复制</button>' +
      '<button data-act="edit">编辑</button>' +
      '<button data-act="delete" class="danger">删除</button>' +
      '</div>';
    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(rule, btn.dataset.act));
    });
    list.appendChild(el);
  });
}

function handleAction(rule, act) {
  if (act === 'toggle') {
    rule.enabled = rule.enabled === false;
    saveRules();
  } else if (act === 'up') {
    const i = rules.indexOf(rule);
    if (i > 0) {
      const t = rules[i];
      rules[i] = rules[i - 1];
      rules[i - 1] = t;
      saveRules();
    }
  } else if (act === 'down') {
    const i = rules.indexOf(rule);
    if (i < rules.length - 1) {
      const t = rules[i];
      rules[i] = rules[i + 1];
      rules[i + 1] = t;
      saveRules();
    }
  } else if (act === 'edit') {
    fillForm(rule);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (act === 'copy') {
    const i = rules.indexOf(rule);
    const clone = JSON.parse(JSON.stringify(rule));
    clone.id = newId();
    clone.name = rule.name + '（副本）';
    rules.splice(i + 1, 0, clone);
    saveRules();
  } else if (act === 'delete') {
    if (confirm('确认删除规则「' + rule.name + '」？')) {
      rules = rules.filter((r) => r !== rule);
      saveRules();
    }
  }
}

document.getElementById('btn-save').addEventListener('click', () => {
  const err = document.getElementById('form-error');
  let data;
  try {
    data = readForm();
  } catch (e) {
    err.textContent = e.message;
    return;
  }
  err.textContent = '';
  const editId = document.getElementById('edit-id').value;
  if (editId) {
    const rule = rules.find((r) => r.id === editId);
    if (rule) Object.assign(rule, data);
  } else {
    rules.push(Object.assign({ id: newId() }, data));
  }
  saveRules().then(resetForm);
});

document.getElementById('btn-cancel').addEventListener('click', resetForm);

function normalizeRule(raw) {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  return {
    id,
    name: String(raw.name || '未命名'),
    matchType: raw.matchType === 'regex' ? 'regex' : 'prefix',
    pattern: String(raw.pattern || ''),
    target: String(raw.target || ''),
    forwardHeaders: Array.isArray(raw.forwardHeaders) ? raw.forwardHeaders.map(String).filter(Boolean) : [],
    addHeaders: raw.addHeaders && typeof raw.addHeaders === 'object' ? raw.addHeaders : {},
    forwardPageCookie: !!raw.forwardPageCookie,
    includeCookies: !!raw.includeCookies,
    enabled: raw.enabled !== false,
  };
}

function buildConfigJson() {
  return JSON.stringify(
    {
      app: 'chrome-reverse-proxy',
      version: 1,
      exportedAt: new Date().toISOString(),
      loggingEnabled: document.getElementById('f-logging').checked,
      rules,
    },
    null,
    2
  );
}

function handleExport() {
  const blob = new Blob([buildConfigJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chrome-reverse-proxy-config.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text)
    );
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  ta.remove();
  return ok;
}

let currentDetailEntry = null;

function kvTable(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '<p class="hint">（无）</p>';
  return (
    '<table class="detail-table"><tbody>' +
    entries.map((kv) => '<tr><th>' + escapeHtml(kv[0]) + '</th><td>' + escapeHtml(kv[1]) + '</td></tr>').join('') +
    '</tbody></table>'
  );
}

function showLogDetail(entry) {
  currentDetailEntry = entry;
  const ok = !!entry.ok;
  const status = ok
    ? entry.status + (entry.statusText ? ' ' + entry.statusText : '')
    : entry.error || '失败';
  const meta = [
    ['时间', entry.time || ''],
    ['规则', entry.ruleName || entry.ruleId || '-'],
    ['方法', entry.method || ''],
    ['状态', status],
    ['耗时', entry.duration != null ? entry.duration + 'ms' : ''],
    ['原始URL', entry.url || ''],
    ['目标URL', entry.target || ''],
  ];
  document.getElementById('log-detail-body').innerHTML =
    '<div class="detail-block"><div class="detail-label">基本信息</div>' +
    '<div class="detail-meta">' +
    meta.map((m) => '<div class="meta-item"><span class="k">' + escapeHtml(m[0]) + ':</span><span class="v" title="' + escapeAttr(m[1]) + '">' + escapeHtml(m[1]) + '</span></div>').join('') +
    '</div></div>' +
    '<div class="detail-block"><div class="detail-label">请求头（实际转发）</div>' + kvTable(entry.requestHeaders) + '</div>' +
    '<div class="detail-block"><div class="detail-label">请求体（入参）</div>' +
    '<pre class="detail-pre">' + escapeHtml(entry.requestBody || '（无）') + '</pre></div>' +
    '<div class="detail-block"><div class="detail-label">响应头</div>' + kvTable(entry.responseHeaders) + '</div>' +
    '<div class="detail-block"><div class="detail-label">响应体（出参）</div>' +
    '<pre class="detail-pre">' + escapeHtml(entry.responseBody || '（无）') + '</pre></div>';
  document.getElementById('log-detail').hidden = false;
  document.getElementById('log-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeLogDetail() {
  document.getElementById('log-detail').hidden = true;
  currentDetailEntry = null;
}

document.getElementById('btn-copy-config').addEventListener('click', async () => {
  const ok = await copyText(buildConfigJson());
  const btn = document.getElementById('btn-copy-config');
  btn.textContent = ok ? '已复制' : '复制失败';
  btn.classList.add('primary');
  setTimeout(() => {
    btn.textContent = '复制配置';
  }, 1500);
});

document.getElementById('btn-copy-log').addEventListener('click', async () => {
  if (!currentDetailEntry) return;
  const ok = await copyText(JSON.stringify(currentDetailEntry, null, 2));
  const btn = document.getElementById('btn-copy-log');
  if (ok) {
    btn.textContent = '已复制';
    setTimeout(() => {
      btn.textContent = '复制日志';
    }, 1500);
  }
});

document.getElementById('btn-close-detail').addEventListener('click', closeLogDetail);

function handleImportText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    alert('导入失败：JSON 解析错误');
    return;
  }
  const arr = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.rules) ? parsed.rules : null;
  if (!arr) {
    alert('导入失败：未找到有效的 rules 数组');
    return;
  }
  const imported = arr.map(normalizeRule);
  const loggingEnabled =
    parsed && typeof parsed === 'object' && typeof parsed.loggingEnabled === 'boolean'
      ? parsed.loggingEnabled
      : undefined;
  if (!confirm('导入 ' + imported.length + ' 条规则，将替换当前 ' + rules.length + ' 条规则。继续？')) return;
  rules = imported;
  const toSet = { rules };
  if (loggingEnabled !== undefined) {
    toSet.loggingEnabled = loggingEnabled;
    syncLoggingToggle(loggingEnabled);
  }
  chrome.storage.local.set(toSet).then(() => {
    alert('导入成功：' + imported.length + ' 条规则');
    render();
  });
}

document.getElementById('btn-export').addEventListener('click', handleExport);

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => handleImportText(String(reader.result));
    reader.readAsText(file);
  }
  e.target.value = '';
});

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function syncDebugToggle(enabled) {
  document.getElementById('f-debug').checked = !!enabled;
}

function sansScheme(u) {
  return String(u).replace(/^https?:\/\//i, '');
}

function rewriteForTest(url, rule) {
  if (rule.matchType === 'regex') {
    return url.replace(new RegExp(rule.pattern), rule.target || '');
  }
  return (rule.target || '') + sansScheme(url).slice(sansScheme(rule.pattern || '').length);
}

function testMatch(url) {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const matched =
      rule.matchType === 'regex'
        ? (() => {
            try {
              return new RegExp(rule.pattern).test(url);
            } catch (e) {
              return false;
            }
          })()
        : (() => {
            const p = sansScheme(rule.pattern || '');
            return !!p && sansScheme(url).startsWith(p);
          })();
    if (matched) return rule;
  }
  return null;
}

document.getElementById('btn-test-match').addEventListener('click', () => {
  const url = document.getElementById('test-url').value.trim();
  const out = document.getElementById('test-result');
  if (!url) {
    out.textContent = '请输入要测试的 URL';
    return;
  }
  const rule = testMatch(url);
  if (!rule) {
    out.textContent = '未命中任何启用中的规则，该请求将直连原地址（不会代理，也不会产生日志）';
    return;
  }
  out.innerHTML =
    '命中规则「' + escapeHtml(rule.name) + '」→ 重写为 <code>' + escapeHtml(rewriteForTest(url, rule)) + '</code>';
});

document.getElementById('f-debug').addEventListener('change', (e) => {
  chrome.storage.local.set({ debugMode: e.target.checked });
});

function syncLoggingToggle(enabled) {
  document.getElementById('f-logging').checked = !!enabled;
}

function renderLogs() {
  chrome.storage.local.get({ logs: [], loggingEnabled: true }).then((data) => {
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const tbody = document.querySelector('#log-table tbody');
    const el = document.getElementById('log-table');
    el.style.display = logs.length ? '' : 'none';
    const empty = document.getElementById('log-empty');
    empty.hidden = logs.length > 0;
    syncLoggingToggle(data.loggingEnabled);
    tbody.innerHTML = '';
    logs.forEach((entry) => {
      const ok = !!entry.ok;
      const tr = document.createElement('tr');
      tr.className = 'log-table-row';
      const statusHtml = ok
        ? '<span class="status-ok">' + escapeHtml(entry.status) + '</span> <span class="duration">' +
          escapeHtml(entry.duration) + 'ms</span>'
        : '<span class="status-err">' + escapeHtml(entry.error || '失败') + '</span>';
      const metaTitle = ok
        ? '转发头: ' + (entry.forwardedHeaders || '无') + '\n附加请求头: ' + (entry.addedAuthHeaders || '无')
        : '错误: ' + (entry.error || '');
      tr.title = metaTitle;
      tr.innerHTML =
        '<td class="duration">' + escapeHtml(entry.time || '') + '</td>' +
        '<td class="method-cell">' + escapeHtml(entry.method || '') + '</td>' +
        '<td>' + escapeHtml(entry.ruleName || entry.ruleId || '-') + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td class="url-cell" title="' + escapeAttr(entry.url || '') + '">' + escapeHtml(entry.url || '') + '</td>' +
        '<td class="url-cell" title="' + escapeAttr(entry.target || '') + '">' + escapeHtml(entry.target || '-') + '</td>';
      tr.addEventListener('click', () => showLogDetail(entry));
      tbody.appendChild(tr);
    });
  });
}

document.getElementById('f-logging').addEventListener('change', (e) => {
  chrome.storage.local.set({ loggingEnabled: e.target.checked });
});

document.getElementById('btn-clear-log').addEventListener('click', () => {
  chrome.storage.local.remove('logs').then(renderLogs);
});

document.getElementById('btn-refresh-log').addEventListener('click', renderLogs);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.logs) renderLogs();
  if (changes.loggingEnabled) syncLoggingToggle(changes.loggingEnabled.newValue !== false);
  if (changes.debugMode) syncDebugToggle(changes.debugMode.newValue === true);
});

if (location.hash === '#logs') {
  const card = document.getElementById('logs-card');
  if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth' }), 100);
}

chrome.storage.local.get('jumpToLogs').then((data) => {
  if (!data.jumpToLogs) return;
  chrome.storage.local.remove('jumpToLogs');
  const card = document.getElementById('logs-card');
  if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth' }), 100);
});

loadRules().then(render).then(renderLogs).then(() => {
  chrome.storage.local.get({ debugMode: false }).then((data) => syncDebugToggle(data.debugMode));
});
