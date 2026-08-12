const HOP_BY_HOP = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'te',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
]);

const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

const LOG_KEY = 'logs';
const LOG_LIMIT = 200;
const LOG_BODY_MAX = 4096;

function bytesToText(bytes) {
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

function truncateText(s, max) {
  if (s == null) return '';
  s = String(s);
  if (s.length > max) return s.slice(0, max) + '\n…(截断 ' + (s.length - max) + ' 字符)';
  return s;
}

function bodyPreview(base64, contentType) {
  if (typeof base64 !== 'string' || !base64.length) return '';
  const bytes = base64ToBytes(base64);
  if (!bytes.length) return '';
  const ct = String(contentType || '');
  if (/text|json|xml|javascript|form-urlencoded|urlencoded/i.test(ct)) {
    return truncateText(bytesToText(bytes), LOG_BODY_MAX);
  }
  return '[二进制 ' + bytes.length + ' 字节，内容类型: ' + (ct || '未知') + ']';
}

function headersToObject(headers) {
  const out = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

async function getRules() {
  const data = await chrome.storage.local.get({ rules: [] });
  return Array.isArray(data.rules) ? data.rules : [];
}

async function isLoggingEnabled() {
  const data = await chrome.storage.local.get({ loggingEnabled: true });
  return data.loggingEnabled !== false;
}

async function appendLog(entry) {
  try {
    if (!(await isLoggingEnabled())) return;
    const data = await chrome.storage.local.get({ logs: [] });
    const logs = Array.isArray(data.logs) ? data.logs : [];
    logs.unshift(entry);
    if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
    await chrome.storage.local.set({ logs });
  } catch (e) {
    console.warn('Chrome Reverse Proxy appendLog failed:', e);
  }
}

function sansScheme(u) {
  return String(u).replace(/^https?:\/\//i, '');
}

function matchRule(url, rule) {
  if (!rule || rule.enabled === false) return false;
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern).test(url);
    } catch (e) {
      return false;
    }
  }
  const p = sansScheme(rule.pattern || '');
  if (!p) return false;
  return sansScheme(url).startsWith(p);
}

function rewriteUrl(url, rule) {
  if (rule.matchType === 'regex') {
    return url.replace(new RegExp(rule.pattern), rule.target || '');
  }
  return (rule.target || '') + sansScheme(url).slice(sansScheme(rule.pattern || '').length);
}

function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'proxy-request') {
    handleProxy(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
});

async function handleProxy(msg) {
  const start = Date.now();
  const entry = {
    ts: start,
    time: new Date(start).toLocaleString(),
    method: msg.method || 'GET',
    url: msg.url,
    ruleId: msg.ruleId || '',
  };

  const fail = (error) => {
    entry.ok = false;
    entry.error = error;
    entry.duration = Date.now() - start;
    appendLog(entry);
    return { ok: false, error, ruleId: msg.ruleId };
  };

  let rules;
  try {
    rules = await getRules();
  } catch (e) {
    return fail(String((e && e.message) || e));
  }

  const rule = rules.find((r) => r.id === msg.ruleId && matchRule(msg.url, r));
  if (!rule) {
    entry.ruleName = '(规则已删除/停用)';
    return fail('NO_RULE');
  }
  entry.ruleName = rule.name || rule.id;

  const targetUrl = rewriteUrl(msg.url, rule);
  entry.target = targetUrl;

  const forward = (rule.forwardHeaders || []).map((h) => String(h).toLowerCase());
  const forwardAll = forward.includes('*');

  const headers = new Headers();
  const forwardedNames = [];
  if (Array.isArray(msg.headers)) {
    for (const pair of msg.headers) {
      const name = String(pair[0]);
      const value = String(pair[1]);
      const lname = name.toLowerCase();
      if (HOP_BY_HOP.has(lname)) continue;
      if (forwardAll || forward.includes(lname)) {
        headers.append(name, value);
        forwardedNames.push(lname);
      }
    }
  }

  if (rule.forwardPageCookie && msg.pageCookie) {
    headers.set('Cookie', msg.pageCookie);
    forwardedNames.push('cookie');
  }

  const authNames = [];
  for (const [name, value] of Object.entries(rule.addHeaders || {})) {
    headers.set(name, String(value));
    authNames.push(String(name).toLowerCase());
  }

  entry.forwardedHeaders = forwardedNames.join(', ');
  entry.addedAuthHeaders = authNames.join(', ');
  entry.requestHeaders = headersToObject(headers);
  entry.requestBody = bodyPreview(msg.bodyBase64, headers.get('Content-Type') || headers.get('content-type') || '');

  const init = { method: msg.method || 'GET', headers, redirect: 'follow' };
  if (rule.includeCookies) init.credentials = 'include';
  if (typeof msg.bodyBase64 === 'string' && msg.bodyBase64.length) {
    init.body = base64ToBytes(msg.bodyBase64);
  }

  let res;
  try {
    res = await fetch(targetUrl, init);
    const buf = await res.arrayBuffer();

    const resHeaders = {};
    res.headers.forEach((value, name) => {
      if (!FORBIDDEN_RESPONSE_HEADERS.has(name.toLowerCase())) resHeaders[name] = value;
    });
    resHeaders['X-Chrome-Nginx'] = '1';

    entry.ok = true;
    entry.status = res.status;
    entry.statusText = res.statusText;
    entry.duration = Date.now() - start;
    entry.responseHeaders = resHeaders;
    entry.responseBody = bodyPreview(bytesToBase64(new Uint8Array(buf)), resHeaders['content-type'] || '');
    appendLog(entry);

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      contentType: resHeaders['content-type'] || '',
      bodyBase64: bytesToBase64(new Uint8Array(buf)),
    };
  } catch (e) {
    return fail(String((e && e.message) || e));
  }
}