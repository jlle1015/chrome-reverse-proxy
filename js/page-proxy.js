(() => {
  if (window.__chromeNginxProxyLoaded) return;
  window.__chromeNginxProxyLoaded = true;

  let nextId = 1;
  const pendingFetches = new Map();
  const pendingXHRs = new Map();
  let rulesCache = [];
  let debug = false;

  const TAG = '__chromeNginx';

  function newId() {
    return (nextId++).toString(36) + '_' + Date.now().toString(36);
  }

  function post(msg) {
    window.postMessage(Object.assign({ __chromeNginx: true }, msg), '*');
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

  function normalizeHeaderObj(obj) {
    const out = Object.create(null);
    for (const key of Object.keys(obj)) out[key.toLowerCase()] = obj[key];
    return out;
  }

  function parseRawHeaders(raw) {
    const out = {};
    if (!raw) return out;
    raw.trim().split(/\r?\n/).forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return out;
  }

  function decodeBytes(bytes) {
    try {
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return '';
    }
  }

  function sansScheme(u) {
    return String(u).replace(/^https?:\/\//i, '');
  }

  function matchRule(url) {
    if (!/^https?:/i.test(url)) return null;
    for (const rule of rulesCache) {
      if (!rule || rule.enabled === false) continue;
      if (rule.matchType === 'regex') {
        try {
          if (new RegExp(rule.pattern).test(url)) return rule;
        } catch (e) {
          continue;
        }
      } else {
        const p = sansScheme(rule.pattern || '');
        if (p && sansScheme(url).startsWith(p)) return rule;
      }
    }
    return null;
  }

  window.__chromeNginxStatus = function () {
    return {
      injected: true,
      rulesLoaded: rulesCache.length,
      rules: rulesCache.map((r) => ({ id: r.id, pattern: r.pattern, enabled: r.enabled !== false })),
    };
  };

  window.__chromeNginxProbe = async function (url) {
    const start = Date.now();
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      return {
        ok: res.ok,
        status: res.status,
        url: res.url,
        duration: Date.now() - start,
        proxiedByExtension: res.headers.get('x-chrome-nginx') === '1',
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };

  async function bodyToBase64(body) {
    if (body == null) return { bodyBase64: null, bodyType: '' };
    let bytes;
    let bodyType;
    if (typeof body === 'string') {
      bytes = new TextEncoder().encode(body);
      bodyType = 'text';
    } else if (body instanceof URLSearchParams) {
      bytes = new TextEncoder().encode(body.toString());
      bodyType = 'urlencoded';
    } else if (body instanceof FormData) {
      const sp = new URLSearchParams();
      body.forEach((value, key) => sp.append(key, value));
      bytes = new TextEncoder().encode(sp.toString());
      bodyType = 'urlencoded';
    } else if (body instanceof Blob) {
      bytes = new Uint8Array(await body.arrayBuffer());
      bodyType = body.type || '';
    } else if (body instanceof ArrayBuffer) {
      bytes = new Uint8Array(body);
      bodyType = 'buffer';
    } else if (ArrayBuffer.isView(body)) {
      bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      bodyType = 'buffer';
    } else {
      bytes = new TextEncoder().encode(String(body));
      bodyType = 'text';
    }
    return { bodyBase64: bytesToBase64(bytes), bodyType };
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__chromeNginx !== true) return;
    const data = e.data;
    if (data.type === 'rules-update' && Array.isArray(data.rules)) {
      rulesCache = data.rules;
      debug = !!data.debug;
      if (debug) {
        console.info('[Chrome Reverse Proxy] 规则缓存已更新，共', rulesCache.length, '条', rulesCache.map((r) => r.name || r.id));
      }
      return;
    }
    if (data.type === 'proxy-response' && data.id) {
      if (pendingFetches.has(data.id)) {
        const resolve = pendingFetches.get(data.id);
        pendingFetches.delete(data.id);
        resolve(data.payload);
        return;
      }
      const xhr = pendingXHRs.get(data.id);
      if (xhr) {
        pendingXHRs.delete(data.id);
        xhr._onProxyResponse(data.payload);
      }
    }
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    let url;
    let method = 'GET';
    let headers;
    let body;
    let signal;

    if (typeof input === 'string') {
      url = new URL(input, location.href).href;
      headers = init.headers;
      body = init.body;
      signal = init.signal;
    } else if (input && typeof input === 'object') {
      if (input instanceof Request) {
        url = new URL(input.url, location.href).href;
        method = init.method || input.method || 'GET';
        headers = 'headers' in init ? init.headers : input.headers;
        body = 'body' in init ? init.body : input.body;
        signal = init.signal || input.signal;
      } else if (typeof input.url === 'string') {
        url = new URL(input.url, location.href).href;
        headers = init.headers;
        body = init.body;
        signal = init.signal;
      } else {
        return origFetch.apply(this, arguments);
      }
    } else {
      return origFetch.apply(this, arguments);
    }

    method = (method || 'GET').toUpperCase();
    if (!rulesCache.length) post({ type: 'request-rules' });
    const rule = matchRule(url);
    if (debug) {
      console.info('[Chrome Reverse Proxy] fetch', method, url, rule ? '→ 命中规则 ' + rule.id + '，已拦截' : '→ 未命中，直连');
    }
    if (!rule || body instanceof ReadableStream) {
      return origFetch.apply(this, arguments);
    }

    return (async () => {
      const hd = headers instanceof Headers ? headers : new Headers(headers || {});
      const headerPairs = [];
      hd.forEach((value, name) => headerPairs.push([name, value]));
      const bodyData = await bodyToBase64(body);
      const id = newId();
      if (debug) console.info('[Chrome Reverse Proxy] 已拦截 fetch', method, url, '规则', rule.id, '发送到后台');
      const payload = await new Promise((resolve, reject) => {
        pendingFetches.set(id, resolve);
        if (signal) {
          const onAbort = () => {
            pendingFetches.delete(id);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
        const msg = {
          type: 'proxy-request',
          id,
          url,
          method,
          headers: headerPairs,
          credentials: init.credentials || 'same-origin',
          ruleId: rule.id,
        };
        if (bodyData.bodyBase64 != null) {
          msg.bodyBase64 = bodyData.bodyBase64;
          msg.bodyType = bodyData.bodyType;
        }
        if (rule.forwardPageCookie) msg.pageCookie = document.cookie;
        post(msg);
      });

      if (!payload || payload.ok === false) {
        if (payload && payload.error === 'NO_RULE') {
          return origFetch.apply(this, arguments);
        }
        throw new TypeError('Chrome Reverse Proxy proxy failed: ' + ((payload && payload.error) || 'unknown error'));
      }

      const noBodyStatus = [204, 205, 304];
      const bodyBytes = payload.bodyBase64 ? base64ToBytes(payload.bodyBase64) : null;
      return new Response(noBodyStatus.indexOf(payload.status) >= 0 ? null : bodyBytes, {
        status: payload.status,
        statusText: payload.statusText,
        headers: new Headers(payload.headers || {}),
      });
    })();
  };

  const OrigXHR = window.XMLHttpRequest;
  const XHR_EVENTS = ['loadstart', 'progress', 'abort', 'error', 'load', 'timeout', 'loadend', 'readystatechange'];

  class ProxyUpload {
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }

  class ProxyXHR {
    constructor() {
      this._method = 'GET';
      this._url = '';
      this._user = undefined;
      this._password = undefined;
      this._headerOrder = [];
      this._headers = Object.create(null);
      this._body = null;
      this._resHeaders = null;
      this._bytes = null;
      this._responseText = '';
      this._contentType = '';
      this._native = null;
      this._nativeDone = false;
      this._events = Object.create(null);
      this.readyState = 0;
      this.status = 0;
      this.statusText = '';
      this.responseURL = '';
      this.responseType = '';
      this.timeout = 0;
      this.withCredentials = false;
      this.upload = new ProxyUpload();
    }

    open(method, url, asyncFlag, user, password) {
      this._method = String(method).toUpperCase();
      try {
        this._url = new URL(String(url), location.href).href;
      } catch (e) {
        this._url = String(url);
      }
      this._user = user;
      this._password = password;
      if (this.readyState === 0) {
        this.readyState = 1;
        this._fire('readystatechange');
      }
    }

    setRequestHeader(name, value) {
      const lname = String(name).toLowerCase();
      const existing = this._headers[lname];
      if (existing) {
        this._headers[lname] = existing + ', ' + value;
      } else {
        this._headers[lname] = String(value);
        this._headerOrder.push([lname, String(value)]);
      }
    }

    getResponseHeader(name) {
      if (this.readyState < 2 || !this._resHeaders) return null;
      return this._resHeaders[String(name).toLowerCase()] || null;
    }

    getAllResponseHeaders() {
      if (this.readyState < 2 || !this._resHeaders) return '';
      return Object.keys(this._resHeaders)
        .map((k) => k + ': ' + this._resHeaders[k] + '\r\n')
        .join('');
    }

    overrideMimeType() {}

    abort() {
      if (this._native) this._native.abort();
      if (this.readyState !== 4) {
        this.readyState = 4;
        this.status = 0;
        this._fire('readystatechange');
        this._fire('abort');
        this._fire('loadend');
      }
    }

    addEventListener(type, fn) {
      (this._events[type] || (this._events[type] = [])).push(fn);
    }

    removeEventListener(type, fn) {
      const list = this._events[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }

    dispatchEvent(evt) {
      this._fire(evt.type, evt);
      return true;
    }

    _fire(type, evt) {
      const list = this._events[type];
      const event = evt || new Event(type);
      if (list) list.slice().forEach((fn) => fn.call(this, event));
      const handler = this['on' + type];
      if (typeof handler === 'function') handler.call(this, event);
    }

    send(body) {
      this._body = body;
      if (!rulesCache.length) post({ type: 'request-rules' });
      const rule = matchRule(this._url);
      if (debug) {
        console.info('[Chrome Reverse Proxy] XHR', this._method, this._url, rule ? '→ 命中规则 ' + rule.id + '，已拦截' : '→ 未命中，直连');
      }
      if (rule) {
        this._sendProxied(body, rule);
      } else {
        this._sendNative(body);
      }
    }

    async _sendProxied(body, rule) {
      this._fire('loadstart');
      this._fire('readystatechange');
      const headerPairs = this._headerOrder.map(([k, v]) => [k, v]);
      const bodyData = await bodyToBase64(body);
      const id = newId();
      pendingXHRs.set(id, this);
      if (debug) console.info('[Chrome Reverse Proxy] 已拦截 XHR', this._method, this._url, '规则', rule.id, '发送到后台');
      const msg = {
        type: 'proxy-request',
        id,
        url: this._url,
        method: this._method,
        headers: headerPairs,
        credentials: this.withCredentials ? 'include' : 'same-origin',
        ruleId: rule.id,
      };
      if (bodyData.bodyBase64 != null) {
        msg.bodyBase64 = bodyData.bodyBase64;
        msg.bodyType = bodyData.bodyType;
      }
      if (rule.forwardPageCookie) msg.pageCookie = document.cookie;
      post(msg);
    }

    _onProxyResponse(payload) {
      if (payload && payload.ok) {
        this.status = payload.status;
        this.statusText = payload.statusText;
        this.responseURL = this._url;
        this._resHeaders = normalizeHeaderObj(payload.headers || {});
        this._contentType = payload.contentType || '';
        this.readyState = 2;
        this._fire('readystatechange');
        const bytes = payload.bodyBase64 ? base64ToBytes(payload.bodyBase64) : new Uint8Array(0);
        this._bytes = bytes;
        this._responseText = decodeBytes(bytes);
        this.readyState = 4;
        this._fire('readystatechange');
        this._fire('load');
        this._fire('loadend');
      } else if (payload && payload.error === 'NO_RULE') {
        this._sendNative(this._body);
      } else {
        this.status = 0;
        this.statusText = '';
        this.readyState = 4;
        this._fire('readystatechange');
        this._fire('error');
        this._fire('loadend');
      }
    }

    _sendNative(body) {
      const native = new OrigXHR();
      this._native = native;
      try {
        native.open(this._method, this._url, true, this._user, this._password);
      } catch (err) {
        this.readyState = 4;
        this._fire('error');
        this._fire('loadend');
        return;
      }
      for (const pair of this._headerOrder) native.setRequestHeader(pair[0], pair[1]);
      if (this.responseType) native.responseType = this.responseType;
      if (this.timeout) native.timeout = this.timeout;
      native.withCredentials = this.withCredentials;
      const mirror = (type) => (evt) => {
        this.readyState = native.readyState;
        this.status = native.status;
        this.statusText = native.statusText;
        this.responseURL = native.responseURL;
        if (native.readyState === 4) {
          this._resHeaders = normalizeHeaderObj(parseRawHeaders(native.getAllResponseHeaders()));
          this._contentType = this._resHeaders['content-type'] || '';
          this._nativeDone = true;
          if (this.responseType === '' || this.responseType === 'text') {
            this._responseText = native.responseText;
          }
        }
        this._fire(type, evt);
      };
      native.onloadstart = mirror('loadstart');
      native.onprogress = mirror('progress');
      native.onreadystatechange = mirror('readystatechange');
      native.onload = mirror('load');
      native.onerror = mirror('error');
      native.ontimeout = mirror('timeout');
      native.onabort = mirror('abort');
      native.onloadend = mirror('loadend');
      native.send(body);
    }

    get response() {
      if (this.readyState !== 4) return null;
      if (this._nativeDone) return this._native ? this._native.response : null;
      switch (this.responseType) {
        case 'arraybuffer':
          if (!this._bytes) return null;
          return this._bytes.buffer.slice(this._bytes.byteOffset, this._bytes.byteOffset + this._bytes.byteLength);
        case 'blob':
          return this._bytes ? new Blob([this._bytes], { type: this._contentType }) : null;
        case 'json':
          try {
            return JSON.parse(this._responseText);
          } catch (e) {
            return null;
          }
        case 'document':
          return this._responseText;
        default:
          return this._responseText;
      }
    }

    get responseText() {
      return this.readyState !== 4 ? '' : this._responseText;
    }
  }

  ProxyXHR.UNSENT = 0;
  ProxyXHR.OPENED = 1;
  ProxyXHR.HEADERS_RECEIVED = 2;
  ProxyXHR.LOADING = 3;
  ProxyXHR.DONE = 4;

  XHR_EVENTS.forEach((type) => {
    Object.defineProperty(ProxyXHR.prototype, 'on' + type, {
      configurable: true,
      get() {
        return this['_on' + type] || null;
      },
      set(fn) {
        this['_on' + type] = typeof fn === 'function' ? fn : null;
      },
    });
  });

  window.XMLHttpRequest = ProxyXHR;

  post({ type: 'request-rules' });
})();
