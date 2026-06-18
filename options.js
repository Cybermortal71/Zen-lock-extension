// ============================================================
// ZenLock - 选项页面逻辑
// ============================================================

const domainInput = document.getElementById('domainInput');
const addBtn = document.getElementById('addBtn');
const blacklistUl = document.getElementById('blacklistUl');
const countSpan = document.getElementById('count');
const toast = document.getElementById('toast');
const didaTokenInput = document.getElementById('didaTokenInput');
const saveDidaBtn = document.getElementById('saveDidaBtn');
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

// --- 滴答清单 Token ---
async function loadDidaToken() {
  const { didaToken } = await chrome.storage.sync.get('didaToken');
  if (didaToken) didaTokenInput.value = didaToken;
}

saveDidaBtn.addEventListener('click', async () => {
  const token = didaTokenInput.value.trim();
  await chrome.storage.sync.set({ didaToken: token });
  showToast(token ? 'Token 已保存' : 'Token 已清空');
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

// --- 小问号提示 ---
const HELP_TEXTS = {
  bl: '将容易让你分心的网站加入此列表。访问这些网站时，Zenlock 会温柔地提醒你，并请你输入访问目的。',
  dida: '用于在解锁页面显示今日待办任务。获取方式见安装指南。',
  ds: '用于生成 AI 周报总结。免费申请地址：https://platform.deepseek.com/'
};
let activeBubble = null;

document.querySelectorAll('.help-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeBubble) { activeBubble.remove(); activeBubble = null; }
    const key = btn.dataset.help;
    const bubble = document.createElement('div');
    bubble.className = 'help-bubble';
    bubble.textContent = HELP_TEXTS[key] || '';
    bubble.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const parentRect = btn.parentElement.getBoundingClientRect();
    bubble.style.left = (rect.left - parentRect.left) + 'px';
    bubble.style.top = (rect.bottom - parentRect.top + 6) + 'px';
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(bubble);
    activeBubble = bubble;
  });
});
document.addEventListener('click', () => { if (activeBubble) { activeBubble.remove(); activeBubble = null; } });

// --- 统计页面入口 ---
document.getElementById('statsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

// --- 启动 ---
loadBlacklist();
loadDidaToken();
loadKey();
