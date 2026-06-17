// ============================================================
// ZenLock - Background Service Worker (Manifest V3)
// 精确网站活跃时间监测 + SW 休眠防护 + 定期数据清理
// ============================================================

console.log('[Zenlock] SW starting at', new Date().toISOString());

// ---- 内存态：当前追踪状态 ----
let currentDomain = null;   // 正在计时的域名
let currentStartTime = null; // 当前会话片段的起始时间戳 (ms)
let isIdle = false;          // 是否处于 idle / locked

// ============================================================
//  工具函数
// ============================================================

/** 返回 yyyy-mm-dd 格式的日期字符串 */
function dateKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** 从完整 URL 提取 hostname；失败返回 null */
function hostname(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * 域名标准化：去掉开头的 www. 前缀
 * 例如 www.bilibili.com → bilibili.com
 */
function normalizeDomain(domain) {
  if (!domain) return domain;
  return domain.startsWith('www.') ? domain.slice(4) : domain;
}

/**
 * 提取根域名（最后两段）
 * 例如 www.bilibili.com → bilibili.com
 * 例如 message.bilibili.com → bilibili.com
 */
function getRootDomain(hostname) {
  if (!hostname) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

/** 获取当前窗口的活跃标签页 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** 解锁页面完整 URL */
const UNLOCK_PAGE = chrome.runtime.getURL('unlock.html');

/** 判断 URL 是否为普通网页（可追踪/可拦截） */
function isWebPage(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

// ============================================================
//  持久化追踪状态 → storage.session（SW 重启恢复用）
// ============================================================

async function persistTrackingState() {
  await chrome.storage.session.set({
    _tracking: { domain: currentDomain, startTime: currentStartTime, isIdle }
  });
}

// ============================================================
//  写入 sessions & timeLog
// ============================================================

/**
 * 结束当前会话片段，写入 sessions + timeLog。
 * @param {number} endTime 结束时间戳 (ms)
 */
async function flushCurrentSegment(endTime) {
  if (!currentDomain || !currentStartTime) return;
  if (endTime <= currentStartTime) return;

  const seconds = Math.floor((endTime - currentStartTime) / 1000);
  if (seconds <= 0) return;

  const today = dateKey(endTime);

  // ---- sessions ----
  const { sessions } = await chrome.storage.local.get('sessions');
  const all = sessions || {};
  const daySessions = all[today] || [];
  daySessions.push({
    domain: currentDomain,
    start: currentStartTime,
    end: endTime
  });
  all[today] = daySessions;

  // ---- timeLog (累加) ----
  const { timeLog } = await chrome.storage.local.get('timeLog');
  const logs = timeLog || {};
  const dayLogs = logs[today] || {};
  dayLogs[currentDomain] = (dayLogs[currentDomain] || 0) + seconds;
  logs[today] = dayLogs;

  await chrome.storage.local.set({ sessions: all, timeLog: logs });
}

// ============================================================
//  域名切换核心
// ============================================================

/**
 * 切换到新域名（或 null 表示停止追踪）。
 * 1. 将当前片段落盘
 * 2. 开启新片段
 */
async function switchDomain(newDomain) {
  const now = Date.now();

  if (!isIdle && currentDomain) {
    await flushCurrentSegment(now);
  }

  if (newDomain) {
    currentDomain = newDomain;
    currentStartTime = now;
    isIdle = false;
  } else {
    currentDomain = null;
    currentStartTime = null;
  }

  await persistTrackingState();
}

// ============================================================
//  标签页事件
// ============================================================

/** 用户切换标签页 */
chrome.tabs.onActivated.addListener(async () => {
  if (isIdle) return;
  try {
    const tab = await getActiveTab();
    const dom = tab ? hostname(tab.url) : null;
    if (dom !== currentDomain) {
      await switchDomain(dom);
    }
  } catch {
    // 标签页已不存在，忽略
  }
});

/** 标签页 URL / 加载状态变化（仅追踪） */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isIdle) return;
  if (!tab.active) return;                         // 只关心活跃标签
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  const url = tab.url || changeInfo.url;
  if (!isWebPage(url)) return;                     // 跳过扩展页/内部页

  const dom = hostname(url);
  if (dom && dom !== currentDomain) {
    await switchDomain(dom);
  }
});

/** 标签页关闭 */
chrome.tabs.onRemoved.addListener(async () => {
  if (isIdle) return;
  // 等 Chrome 切换到新标签页后再检查
  setTimeout(async () => {
    try {
      const tab = await getActiveTab();
      const dom = tab ? hostname(tab.url) : null;
      if (dom !== currentDomain) {
        await switchDomain(dom);
      }
    } catch {
      await switchDomain(null);
    }
  }, 150);
});

// ============================================================
//  网站锁：黑名单拦截（独立于追踪监听器）
// ============================================================

/**
 * 检查通行证是否有效；顺带清理过期条目
 */
async function hasValidPass(domain) {
  const { passes } = await chrome.storage.local.get('passes');
  const all = passes || {};
  const expiry = all[domain];
  if (!expiry) return false;

  if (Date.now() < expiry) {
    console.log('[Zenlock] 通行证有效，剩余', Math.floor((expiry - Date.now()) / 60000), '分钟:', domain);
    return true;
  }

  // 已过期 → 清理
  delete all[domain];
  await chrome.storage.local.set({ passes: all });
  console.log('[Zenlock] 通行证已过期，已清理:', domain);
  return false;
}

/** 拦截检查：每个标签页加载完成时触发 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 只拦截页面加载完成
  if (changeInfo.status !== 'complete') return;

  const url = tab.url;
  if (!url) return;

  // --- 排除非网页 URL ---
  // 扩展自身的 unlock 页面 → 放行（重定向循环防护）
  if (url.startsWith(UNLOCK_PAGE)) return;

  // 浏览器内部页面 / 扩展管理页 / 新标签页等 → 放行
  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url === 'chrome://newtab/' ||
    url === 'edge://newtab/'
  ) return;

  // 只拦截 http / https 页面
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // --- 提取域名 ---
  let dom;
  try {
    dom = new URL(url).hostname;
  } catch {
    return; // URL 解析失败，放行
  }
  if (!dom) return;

  // --- 域名标准化 + 子域名匹配 ---
  const normalizedDom = normalizeDomain(dom);

  const { blacklist } = await chrome.storage.sync.get(['blacklist']);
  const list = blacklist || [];

  // 逐条比对：精确匹配 或 子域名匹配（防止 notbilibili.com 误伤）
  const isBlocked = list.some(entry => {
    const normalizedEntry = normalizeDomain(entry);
    if (!normalizedEntry) return false;
    if (normalizedDom === normalizedEntry) return true;
    if (normalizedDom.endsWith('.' + normalizedEntry)) return true;
    return false;
  });

  console.log('[拦截检查]', dom, '(标准化:', normalizedDom, ') 是否在黑名单:', isBlocked, '| 黑名单:', list);

  if (!isBlocked) return; // 不在黑名单，放行

  // --- 检查通行证（使用根域名） ---
  if (await hasValidPass(getRootDomain(dom))) return; // 通行证有效，放行

  // --- 拦截！重定向到解锁页 ---
  const unlockUrl = chrome.runtime.getURL('unlock.html') +
    '?target=' + encodeURIComponent(url);

  console.log('🔒 [拦截]', dom, '→ 重定向到解锁页:', unlockUrl);
  await chrome.tabs.update(tabId, { url: unlockUrl });
});

// ============================================================
//  空闲状态
// ============================================================

chrome.idle.onStateChanged.addListener(async (state) => {
  const now = Date.now();

  if (state === 'idle' || state === 'locked') {
    // 暂停计时
    if (!isIdle && currentDomain) {
      isIdle = true;
      await flushCurrentSegment(now);
      currentDomain = null;
      currentStartTime = null;
      await persistTrackingState();
      console.log('⏸ 空闲/锁定，计时已暂停');
    }
  } else if (state === 'active') {
    // 恢复计时
    if (isIdle) {
      isIdle = false;
      try {
        const tab = await getActiveTab();
        const dom = tab ? hostname(tab.url) : null;
        if (dom) {
          currentDomain = dom;
          currentStartTime = now;
          await persistTrackingState();
          console.log('▶ 恢复计时:', dom);
        }
      } catch {
        // 无活跃标签页
      }
    }
  }
});

// ============================================================
//  闹钟
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const name = alarm.name;

  if (name === 'keepAlive') {
    console.log('💓 keepAlive @', new Date().toISOString());
    await chrome.storage.local.get('timeLog');
    await verifyTracking();

  } else if (name === 'dailyCleanup') {
    await dailyCleanup();

  } else if (name.endsWith('_warning')) {
    // 解析域名：bilibili_com_warning → bilibili.com
    const domain = name.slice(0, -8).replace(/_/g, '.');
    await handleTimeWarning(domain);

  } else if (name.endsWith('_expire')) {
    const domain = name.slice(0, -7).replace(/_/g, '.');
    await handleTimeExpire(domain);
  }
});

/**
 * keepAlive 触发时做一致性校验：
 * - 如果内存中正在计时但实际活跃标签域名已变化 → 修正
 * - 如果活跃标签消失 → 停止计时
 */
async function verifyTracking() {
  if (!currentDomain || isIdle) return;
  try {
    const tab = await getActiveTab();
    if (!tab) {
      await switchDomain(null);
      return;
    }
    const dom = hostname(tab.url);
    if (dom !== currentDomain) {
      console.log('🔧 keepAlive 发现域名不一致，自动修正:', currentDomain, '→', dom);
      await switchDomain(dom);
    }
  } catch {
    // 忽略
  }
}

// ============================================================
//  通行证告警处理
// ============================================================

/**
 * 查找所有匹配域名的标签页（标准化比对）
 */
async function findTabsByDomain(domain) {
  const rootDomain = getRootDomain(domain);
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => {
    try {
      return getRootDomain(new URL(tab.url).hostname) === rootDomain;
    } catch {
      return false;
    }
  });
}

/**
 * 时间提醒：距离规划结束还有 2 分钟
 */
async function handleTimeWarning(domain) {
  console.log('⏰ [提醒]', domain, '— 距离规划结束还有 2 分钟');

  const tabs = await findTabsByDomain(domain);
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'timeWarning',
        domain,
        remaining: 120
      });
    } catch {
      // 该标签页未加载 content script，忽略
    }
  }
}

/**
 * 时间到：清除通行证，重定向到 timeup 页面
 */
async function handleTimeExpire(domain) {
  console.log('⏰ [到期]', domain, '— 通行证已失效');

  // 清除该根域名的通行证
  const rootDomain = getRootDomain(domain);
  const { passes } = await chrome.storage.local.get('passes');
  if (passes && passes[rootDomain]) {
    delete passes[rootDomain];
    await chrome.storage.local.set({ passes });
  }

  // 查找并重定向所有匹配标签页
  const tabs = await findTabsByDomain(domain);
  for (const tab of tabs) {
    // 跳过已在 timeup 页面的标签
    if (tab.url && tab.url.includes('timeup.html')) continue;

    // 发送 timeUp 消息
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'timeUp', domain });
    } catch {
      // content script 可能未加载
    }

    // 重定向到 timeup 页面
    const timeupUrl = chrome.runtime.getURL('timeup.html') +
      '?domain=' + encodeURIComponent(domain) +
      '&target=' + encodeURIComponent(tab.url);

    await chrome.tabs.update(tab.id, { url: timeupUrl });
    console.log('🔒 [到期] 已重定向标签页:', tab.id, domain);
  }
}

// ============================================================
//  数据清理：删除 30 天前的 sessions & timeLog
// ============================================================

async function dailyCleanup() {
  console.log('🧹 每日清理 @', new Date().toISOString());

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = dateKey(cutoff.getTime());
  const todayKey = dateKey();

  let sessionsChanged = false;
  let timeLogChanged = false;

  // ---- 清理 sessions ----
  const { sessions } = await chrome.storage.local.get('sessions');
  if (sessions) {
    for (const key of Object.keys(sessions)) {
      if (key < cutoffKey && key !== todayKey) {
        delete sessions[key];
        sessionsChanged = true;
      }
    }
    if (sessionsChanged) {
      await chrome.storage.local.set({ sessions });
    }
  }

  // ---- 清理 timeLog ----
  const { timeLog } = await chrome.storage.local.get('timeLog');
  if (timeLog) {
    for (const key of Object.keys(timeLog)) {
      if (key < cutoffKey && key !== todayKey) {
        delete timeLog[key];
        timeLogChanged = true;
      }
    }
    if (timeLogChanged) {
      await chrome.storage.local.set({ timeLog });
    }
  }

  // ---- 清理过期通行证 ----
  let passesChanged = false;
  const { passes } = await chrome.storage.local.get('passes');
  if (passes) {
    const now = Date.now();
    for (const domain of Object.keys(passes)) {
      if (passes[domain] < now) {
        delete passes[domain];
        passesChanged = true;
      }
    }
    if (passesChanged) {
      await chrome.storage.local.set({ passes });
    }
  }

  const deleted = sessionsChanged || timeLogChanged || passesChanged;
  console.log(deleted ? `  已删除 ${cutoffKey} 之前的数据` : '  无需清理');
}

// ============================================================
//  SW 启动 / 恢复
// ============================================================

async function boot() {
  // ---- 确保 dailyCleanup 闹钟存在 ----
  const existing = await chrome.alarms.getAll();
  if (!existing.some(a => a.name === 'dailyCleanup')) {
    await chrome.alarms.create('dailyCleanup', { periodInMinutes: 24 * 60 });
  }

  // ---- 尝试恢复上次追踪状态 ----
  const { _tracking } = await chrome.storage.session.get('_tracking');

  if (_tracking && _tracking.domain && !_tracking.isIdle) {
    // SW 曾被迫休眠，残留一个未落盘的片段
    const lastStart = _tracking.startTime;
    const now = Date.now();
    // 最多补偿 30 分钟，防止虚高
    const cappedEnd = Math.min(now, lastStart + 30 * 60 * 1000);

    currentDomain = _tracking.domain;
    currentStartTime = lastStart;
    isIdle = false;
    await flushCurrentSegment(cappedEnd);
    console.log('🔄 已恢复并结束残留片段:', currentDomain);
  }

  // ---- 开始追踪当前活跃标签 ----
  isIdle = false;
  try {
    const tab = await getActiveTab();
    const dom = tab ? hostname(tab.url) : null;
    if (dom) {
      currentDomain = dom;
      currentStartTime = Date.now();
      await persistTrackingState();
      console.log('🚀 ZenLock 启动，当前追踪:', dom);
    } else {
      currentDomain = null;
      currentStartTime = null;
      await persistTrackingState();
      console.log('🚀 ZenLock 启动，无活跃网页标签');
    }
  } catch {
    currentDomain = null;
    currentStartTime = null;
    await persistTrackingState();
  }
}

// ============================================================
//  安装 / 更新
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  // 只在首次安装时初始化默认值，避免覆盖已有数据
  const sync = await chrome.storage.sync.get(['blacklist', 'didaToken', 'zhipuKey']);
  await chrome.storage.sync.set({
    blacklist: sync.blacklist || [],
    didaToken: sync.didaToken || '',
    zhipuKey: sync.zhipuKey || ''
  });

  const local = await chrome.storage.local.get(['timeLog', 'sessions', 'growthPoints', 'achievements']);
  await chrome.storage.local.set({
    timeLog: local.timeLog || {},
    sessions: local.sessions || {},
    growthPoints: local.growthPoints ?? 0,
    achievements: local.achievements || []
  });

  console.log('✅ ZenLock 初始化完成 (install/update)');
});

// ============================================================
//  顶层：强制注册 keepAlive 闹钟（防止 SW 休眠）
// ============================================================
chrome.alarms.clear('keepAlive').then(() => {
  chrome.alarms.create('keepAlive', { periodInMinutes: 15 });
  console.log('[Zenlock] keepAlive alarm registered');
});

// ============================================================
//  启动
// ============================================================
boot();
