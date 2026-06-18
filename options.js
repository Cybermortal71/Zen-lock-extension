// ============================================================
// ZenLock - 选项页面逻辑
// ============================================================

const domainInput = document.getElementById('domainInput');
const addBtn = document.getElementById('addBtn');
const blacklistUl = document.getElementById('blacklistUl');
const countSpan = document.getElementById('count');
const toast = document.getElementById('toast');
const deepseekKeyInput = document.getElementById('deepseekKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');

let blacklist = [];

// --- 工具函数 ---

/** 显示轻提示 */
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

/** 简单校验域名格式 */
function isValidDomain(raw) {
  const trimmed = raw.trim();
  // 匹配 example.com 或 sub.example.com
  return /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(trimmed);
}

// --- 加载 & 渲染 ---

async function loadBlacklist() {
  const result = await chrome.storage.sync.get('blacklist');
  blacklist = result.blacklist || [];
  render();
}

function render() {
  countSpan.textContent = blacklist.length;

  if (blacklist.length === 0) {
    blacklistUl.innerHTML = '<li class="empty-hint">暂无屏蔽网站，添加一个开始吧 ✨</li>';
    return;
  }

  blacklistUl.innerHTML = blacklist
    .map((domain, index) => `
      <li>
        <span class="domain">${escapeHtml(domain)}</span>
        <button class="btn-delete" data-index="${index}">移除</button>
      </li>
    `)
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- 添加域名 ---

async function addDomain() {
  const raw = domainInput.value.trim();

  if (!raw) {
    showToast('请输入域名');
    return;
  }

  if (!isValidDomain(raw)) {
    showToast('域名格式不正确，例如：youtube.com');
    return;
  }

  const domain = raw.toLowerCase();

  if (blacklist.includes(domain)) {
    showToast('该域名已在黑名单中');
    return;
  }

  blacklist.push(domain);
  await chrome.storage.sync.set({ blacklist });
  domainInput.value = '';
  domainInput.focus();
  render();
  showToast(`已添加 ${domain}`);
}

// --- 删除域名 ---

async function removeDomain(index) {
  const domain = blacklist[index];
  blacklist.splice(index, 1);
  await chrome.storage.sync.set({ blacklist });
  render();
  showToast(`已移除 ${domain}`);
}

// --- 事件绑定 ---

addBtn.addEventListener('click', addDomain);

domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});

blacklistUl.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const index = parseInt(btn.dataset.index, 10);
  removeDomain(index);
});

// --- DeepSeek API Key ---
async function loadKey() {
  const { deepseekKey } = await chrome.storage.sync.get('deepseekKey');
  if (deepseekKey) deepseekKeyInput.value = deepseekKey;
}

saveKeyBtn.addEventListener('click', async () => {
  const key = deepseekKeyInput.value.trim();
  await chrome.storage.sync.set({ deepseekKey: key });
  showToast(key ? 'API Key 已保存' : 'API Key 已清空');
});

// --- 统计页面入口 ---
document.getElementById('statsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

// --- 启动 ---
loadBlacklist();
loadKey();
