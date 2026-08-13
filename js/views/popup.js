const LOG_PREVIEW = 8;

async function renderTabStatus() {
  const el = document.getElementById('tab-status');
  try {
    const tab = await getActiveTab();
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

document.getElementById('open-sidepanel').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const tab = await getActiveTab();
    if (chrome.sidePanel && tab && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } else {
      chrome.runtime.openOptionsPage();
    }
  } catch (err) {
    chrome.runtime.openOptionsPage();
  }
});

bindViewCommon(LOG_PREVIEW);

refreshView(LOG_PREVIEW);
renderTabStatus();