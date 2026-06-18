// ============================================================
// ZenLock - 弹出窗口逻辑
// ============================================================

/** yyyy-mm-dd（本地时间） */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 提取根域名（与 background.js getRootDomain 一致） */
function getRootDomain(hostname) {
  if (!hostname) return hostname;
  const DOUBLE_SUFFIX = ['edu.cn','gov.cn','com.cn','org.cn','net.cn','ac.cn','mil.cn'];
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (DOUBLE_SUFFIX.includes(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return last2;
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

  if (!hasTimeLog) {
    list.innerHTML = '<li class="empty-hint">暂无数据（后台可能尚未启动）</li>';
    return;
  }

  if (!dayLogs || Object.keys(dayLogs).length === 0) {
    list.innerHTML = '<li class="empty-hint">今天还没有浏览记录 🌱</li>';
    return;
  }

  // 按根域名合并秒数
  const merged = {};
  Object.entries(dayLogs).forEach(([domain, sec]) => {
    const root = getRootDomain(domain);
    merged[root] = (merged[root] || 0) + sec;
  });

  // 按秒数降序排列，取前 5
  const sorted = Object.entries(merged)
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
