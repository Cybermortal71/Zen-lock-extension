// ============================================================
// ZenLock - 解锁页面逻辑
// ============================================================

const targetDomainEl = document.getElementById('targetDomain');
const purposeInput = document.getElementById('purpose');
const durationSelect = document.getElementById('duration');
const customRow = document.getElementById('customRow');
const customMinutesInput = document.getElementById('customMinutes');
const confirmBtn = document.getElementById('confirmBtn');
const backBtn = document.getElementById('backBtn');
const toast = document.getElementById('toast');

// --- 解析 URL 参数 ---
const params = new URLSearchParams(location.search);
const targetUrl = params.get('target');

if (!targetUrl) {
  targetDomainEl.textContent = '未指定目标网址';
  confirmBtn.disabled = true;
} else {
  try {
    const host = new URL(targetUrl).hostname;
    targetDomainEl.textContent = host;
    document.title = `ZenLock - 解锁 ${host}`;
  } catch {
    targetDomainEl.textContent = targetUrl;
  }
}

// --- Toast ---
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// --- 自定义分钟切换 ---
durationSelect.addEventListener('change', () => {
  if (durationSelect.value === 'custom') {
    customRow.classList.add('show');
    customMinutesInput.focus();
  } else {
    customRow.classList.remove('show');
  }
});

// --- 获取规划分钟数 ---
function getPlannedMinutes() {
  if (durationSelect.value === 'custom') {
    const v = parseInt(customMinutesInput.value, 10);
    if (isNaN(v) || v < 1) return 1;
    if (v > 120) return 120;
    return v;
  }
  return parseInt(durationSelect.value, 10);
}

// --- 确认解锁 ---
confirmBtn.addEventListener('click', async () => {
  if (!targetUrl) {
    showToast('缺少目标网址，无法解锁');
    return;
  }

  const purpose = purposeInput.value.trim();
  if (!purpose) {
    showToast('请填写访问目的');
    purposeInput.focus();
    return;
  }

  const plannedMinutes = getPlannedMinutes();
  const now = Date.now();
  const passExpiry = now + plannedMinutes * 60 * 1000;

  // 提取域名
  let domain;
  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    domain = targetUrl;
  }

  // 1. 写入通行证
  const { passes } = await chrome.storage.local.get('passes');
  const allPasses = passes || {};
  allPasses[domain] = passExpiry;
  await chrome.storage.local.set({ passes: allPasses });

  // 2. 写入 currentSession（为后续审核/盆栽做准备）
  await chrome.storage.local.set({
    currentSession: {
      domain,
      targetUrl,
      purpose,
      plannedMinutes,
      passExpiry,
      startTime: now
    }
  });

  console.log('🔓 已解锁:', domain, '有效期', plannedMinutes, '分钟');

  // 3. 延迟 300ms 确保 storage 已落盘，再跳转
  setTimeout(() => {
    location.href = targetUrl;
  }, 300);
});

// --- 返回 ---
backBtn.addEventListener('click', async () => {
  // 尝试关闭标签页；不支持则回退
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.getCurrent(resolve);
    });
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // fallthrough
  }
  // 无法关闭：回退到上一页或空白页
  if (history.length > 1) {
    history.back();
  } else {
    window.close();
  }
});

// --- 回车快捷确认 ---
purposeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmBtn.click();
});
