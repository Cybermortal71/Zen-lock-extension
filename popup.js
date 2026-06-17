// ============================================================
// ZenLock - 弹出窗口逻辑
// ============================================================

// --- 加载黑名单数量 ---
async function loadStats() {
  const result = await chrome.storage.sync.get('blacklist');
  const blacklist = result.blacklist || [];
  document.getElementById('blacklistCount').textContent = blacklist.length;
}

// --- 导航链接 ---
document.getElementById('optionsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('gardenLink').addEventListener('click', (e) => {
  e.preventDefault();
  // TODO: 打开花园页面（后续实现）
  chrome.tabs.create({ url: chrome.runtime.getURL('garden.html') });
});

document.getElementById('statsLink').addEventListener('click', (e) => {
  e.preventDefault();
  // TODO: 打开统计页面（后续实现）
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

// --- 启动 ---
loadStats();
