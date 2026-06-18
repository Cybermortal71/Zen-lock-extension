// ============================================================
// ZenLock - 时间到页面逻辑
// 三层自动恢复：页面加载检查 + 定时轮询 + 延长后广播兄弟标签页
// ============================================================

const domainDisplay = document.getElementById('domainDisplay');
const extendBtn = document.getElementById('extendBtn');
const closeBtn = document.getElementById('closeBtn');
const hintText = document.getElementById('hintText');
const toast = document.getElementById('toast');

// --- 解析 URL 参数 ---
const params = new URLSearchParams(location.search);
const domain = params.get('domain') || '未知网站';
const targetUrl = params.get('target') || ('https://' + domain);

domainDisplay.textContent = domain;
document.title = `ZenLock - ${domain} 时间到`;

const HINT_DEFAULT = '你为这个网站设定的专注时间已经用完了。<br>是继续完成工作，还是就此停手？';

/**
 * 提取根域名（最后两段），与 background.js / unlock.js 保持一致
 */
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
const rootDomain = getRootDomain(domain);

// --- Toast ---
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ============================================================
//  自动恢复：检查通行证，有效则直接跳回目标网站
// ============================================================
async function checkAndAutoResume() {
  try {
    const { passes } = await chrome.storage.local.get('passes');
    const all = passes || {};
    const expiry = all[rootDomain];

    if (expiry && Date.now() < expiry) {
      hintText.textContent = '检测到通行证已恢复，正在跳转…';
      console.log('🔄 [自动恢复]', rootDomain, '通行证有效，跳回:', targetUrl);
      location.href = targetUrl;
      return true;
    }
  } catch {
    // storage 读取失败，忽略
  }
  return false;
}

// ============================================================
//  广播恢复：通知其他同域名的 timeup 标签页一起跳回
// ============================================================
async function broadcastResumeToSiblings() {
  try {
    const timeupPrefix = chrome.runtime.getURL('timeup.html');

    // 获取当前标签页 ID，用于排除自身
    let currentTabId = null;
    try {
      const ct = await new Promise(resolve => chrome.tabs.getCurrent(resolve));
      if (ct) currentTabId = ct.id;
    } catch { /* ignore */ }

    const allTabs = await chrome.tabs.query({});

    // 收集需要恢复的标签页
    const pending = [];
    for (const tab of allTabs) {
      if (currentTabId != null && tab.id === currentTabId) continue;
      if (!tab.url || !tab.url.startsWith(timeupPrefix)) continue;

      try {
        const tabParams = new URLSearchParams(new URL(tab.url).search);
        const tabDomain = tabParams.get('domain');
        const tabDomainRoot = tabDomain ? getRootDomain(tabDomain) : '';
        if (tabDomainRoot === rootDomain) {
          const tabTarget = tabParams.get('target') || ('https://' + domain);
          pending.push({ tabId: tab.id, url: tabTarget });
        }
      } catch {
        // URL 解析失败，跳过
      }
    }

    // 逐个跳转，每个带 0~2 秒随机延迟，避免同时大量请求触发网站防护
    for (const item of pending) {
      const delay = Math.floor(Math.random() * 2000);
      await new Promise(resolve => {
        setTimeout(async () => {
          try {
            await chrome.tabs.update(item.tabId, { url: item.url });
            console.log('🔄 [广播恢复] 已恢复标签页', item.tabId, '→', item.url, '(延迟', delay, 'ms)');
          } catch (e) {
            console.warn('[广播恢复] 标签页', item.tabId, '恢复失败:', e);
          }
          resolve();
        }, delay);
      });
    }
  } catch (e) {
    console.warn('[广播恢复] 出错:', e);
  }
}

// ============================================================
//  延长 5 分钟
// ============================================================
extendBtn.addEventListener('click', async () => {
  const now = Date.now();
  const passExpiry = now + 5 * 60 * 1000;
  const alarmBase = rootDomain.replace(/\./g, '_');

  // 写入新通行证（根域名键）
  const { passes } = await chrome.storage.local.get('passes');
  const allPasses = passes || {};
  allPasses[rootDomain] = passExpiry;
  await chrome.storage.local.set({ passes: allPasses });

  // 清除旧闹钟，创建新的
  await chrome.alarms.clear(alarmBase + '_warning');
  await chrome.alarms.clear(alarmBase + '_expire');

  await chrome.alarms.create(alarmBase + '_expire', { delayInMinutes: 5 });
  await chrome.alarms.create(alarmBase + '_warning', { delayInMinutes: 3 });

  console.log('🔄 已延长:', rootDomain, '额外 5 分钟');

  // 广播恢复其他同域名 timeup 标签页
  await broadcastResumeToSiblings();

  // 自身跳回原网站
  location.href = targetUrl;
});

// ============================================================
//  关闭页面
// ============================================================
closeBtn.addEventListener('click', async () => {
  try {
    const tab = await new Promise(resolve => chrome.tabs.getCurrent(resolve));
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // fallthrough
  }
  window.close();
});

// ============================================================
//  启动：立即检查 + 每 2 秒轮询
// ============================================================
checkAndAutoResume();
setInterval(checkAndAutoResume, 2000);
