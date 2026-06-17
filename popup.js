// ============================================================
// ZenLock - 弹出窗口逻辑
// ============================================================

/** yyyy-mm-dd */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 秒数 → 可读时长 */
function formatDuration(sec) {
  if (sec < 60) return `${sec}秒`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

/** 渲染 Top 5 */
function renderTop5(dayLogs, hasTimeLog) {
  const list = document.getElementById('topList');

  // timeLog 完全为空 → SW 可能尚未启动或刚安装
  if (!hasTimeLog) {
    list.innerHTML = '<li class="empty-hint">暂无数据（后台可能尚未启动）</li>';
    return;
  }

  // timeLog 存在但今天无记录
  if (!dayLogs || Object.keys(dayLogs).length === 0) {
    list.innerHTML = '<li class="empty-hint">今天还没有浏览记录 🌱</li>';
    return;
  }

  // 按秒数降序排列，取前 5
  const sorted = Object.entries(dayLogs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  list.innerHTML = sorted
    .map(([domain, sec], i) => `
      <li>
        <span class="rank">${i + 1}</span>
        <span class="domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
        <span class="duration">${formatDuration(sec)}</span>
      </li>
    `)
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- 加载所有数据 ---
async function loadAll() {
  const today = todayKey();

  // 读取黑名单数量
  const sync = await chrome.storage.sync.get('blacklist');
  document.getElementById('blacklistCount').textContent = (sync.blacklist || []).length;

  // 读取今日 timeLog
  const { timeLog } = await chrome.storage.local.get('timeLog');
  renderTop5(timeLog ? timeLog[today] : null, !!timeLog);
}

// --- 导航 ---
document.getElementById('optionsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('gardenLink').addEventListener('click', (e) => {
  e.preventDefault();
  // TODO: 花园页面（后续实现）
  chrome.tabs.create({ url: chrome.runtime.getURL('garden.html') });
});

document.getElementById('statsLink').addEventListener('click', (e) => {
  e.preventDefault();
  // TODO: 统计页面（后续实现）
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

// --- 启动 ---
loadAll();
