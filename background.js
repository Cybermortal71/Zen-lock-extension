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

/** 获取当前窗口的活跃标签页 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
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

/** 标签页 URL / 加载状态变化 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isIdle) return;
  if (!tab.active) return;                         // 只关心活跃标签
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  const dom = hostname(tab.url || changeInfo.url);
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
  if (alarm.name === 'keepAlive') {
    console.log('💓 keepAlive @', new Date().toISOString());
    // 主动读写 storage，让浏览器认为 SW 在做有用工作，减少被回收概率
    await chrome.storage.local.get('timeLog');
    await verifyTracking();
  } else if (alarm.name === 'dailyCleanup') {
    await dailyCleanup();
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

  const deleted = sessionsChanged || timeLogChanged;
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
