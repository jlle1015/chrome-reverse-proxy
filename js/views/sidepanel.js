const LOG_PREVIEW = 20;

async function renderTabStatus() {
  const el = document.getElementById('tab-status');
  const tab = await getActiveTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    el.className = 'status-warn';
    el.textContent = '当前页面不注入 Content Script';
    return;
  }
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    el.className = 'status-ok';
    el.textContent =
      tab.url + ' — 已注入（规则 ' + (resp && resp.rules || 0) + ' 条' + (resp && resp.debug ? '，调试模式开启' : '') + '）';
  } catch (e) {
    el.className = 'status-warn';
    el.textContent = tab.url + ' — 未检测到 Content Script，请刷新页面或重新加载扩展';
  }
}

bindViewCommon(LOG_PREVIEW);

chrome.tabs.onActivated.addListener(() => {
  refreshView(LOG_PREVIEW);
  renderTabStatus();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) refreshView(LOG_PREVIEW);
});

refreshView(LOG_PREVIEW);
renderTabStatus();