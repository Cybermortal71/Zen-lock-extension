// ============================================================
// ZenLock - Background Service Worker (Manifest V3)
// 精确网站活跃时间监测 + SW 休眠防护 + 定期数据清理
// ============================================================


// --- 安全写存储 ---
async function safeSet(obj) {
  try { await chrome.storage.local.set(obj); }
  catch (e) { console.error('存储写入失败:', e); }
}

// ---- 内存态：当前追踪状态 ----
let currentDomain = null;   // 正在计时的域名
let currentStartTime = null; // 当前会话片段的起始时间戳 (ms)
let isIdle = false;          // 是否处于 idle / locked

// ============================================================
//  工具函数
// ============================================================

/** 返回 yyyy-mm-dd 格式的日期字符串（本地时间） */
function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  // 国内双后缀列表：取最后三段才是根域名
  const DOUBLE_SUFFIX = ['edu.cn','gov.cn','com.cn','org.cn','net.cn','ac.cn','mil.cn'];
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (DOUBLE_SUFFIX.includes(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return last2;
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

  // 清净日奖励：非黑名单浏览累计
  awardQuietDayBonus(currentDomain, seconds);
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
    // 跳过内部页面（扩展页/新标签等），只追踪真实网站
    if (!tab || !isWebPage(tab.url)) {
      if (currentDomain) await switchDomain(null);
      return;
    }
    const dom = hostname(tab.url);
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
    return true;
  }

  // 已过期 → 清理
  delete all[domain];
  await chrome.storage.local.set({ passes: all });
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


  if (!isBlocked) return; // 不在黑名单，放行

  // --- 检查通行证（使用根域名） ---
  if (await hasValidPass(getRootDomain(dom))) return; // 通行证有效，放行

  // --- 拦截！重定向到解锁页 ---
  const unlockUrl = chrome.runtime.getURL('unlock.html') +
    '?target=' + encodeURIComponent(url);

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
  }

  // --- 生长值结算 ---
  await settleGrowth(domain);
}

// ============================================================
//  盆栽生长值 & 成就系统（大改版）
// ============================================================

const PLANT_STAGES = [
  { name: '种子', min: 0, emoji: '🌰' },
  { name: '发芽', min: 10, emoji: '🌱' },
  { name: '小苗', min: 30, emoji: '🪴' },
  { name: '花苞', min: 60, emoji: '🌿' },
  { name: '开花', min: 100, emoji: '🌸' },
  { name: '结果', min: 150, emoji: '🎁' }
];

const FRUIT_POOL = [
  { name: '专注番茄', emoji: '🍅', description: '番茄是一种态度' },
  { name: '耐心多肉', emoji: '🪴', description: '慢慢来，比较快' },
  { name: '死线射手', emoji: '🎯', description: '在截止时间前优雅离场。' },
  { name: '摸鱼克星', emoji: '🦈', description: '大哈鱼别乱摸' },
  { name: '时间琥珀', emoji: '💎', description: '璀璨时间凝聚的晶石' },
  { name: '自律荔枝', emoji: '🍒', description: '别让欲望击穿了你的荔枝' },
  { name: '早睡仙人掌', emoji: '🌵', description: '不早睡扎你。' },
  { name: '反拖延松果', emoji: '🥜', description: '快行动起来！（其实是花生）' }
];

// 当次会话结果
let sessionOutcome = {};

/** 写入生长事件日志（最多 5 条） */
async function logGrowthEvent(change, reason) {
  const { growthEvents } = await chrome.storage.local.get('growthEvents');
  const events = growthEvents || [];
  events.unshift({ time: new Date().toISOString(), change, reason });
  if (events.length > 5) events.length = 5;
  await chrome.storage.local.set({ growthEvents: events });
}

/** 应用生长值（含上限、收获） */
async function applyGrowth(points, reason) {
  const { growthPoints, _dailyGrowth } = await chrome.storage.local.get(['growthPoints', '_dailyGrowth']);
  const today = dateKey();
  const dg = (_dailyGrowth && _dailyGrowth.date === today) ? _dailyGrowth : { date: today, change: 0 };

  const newChange = dg.change + points;
  const cappedChange = Math.max(-20, Math.min(20, newChange));
  const actualPoints = cappedChange - dg.change;
  if (actualPoints === 0) return 0;

  dg.change = cappedChange;
  let gp = (growthPoints || 0) + actualPoints;
  if (gp < 0) gp = 0;

  await chrome.storage.local.set({ growthPoints: gp, _dailyGrowth: dg });
  await logGrowthEvent(actualPoints, reason);

  // 达到 150 → 收获果实
  if (gp >= 150) {
    await harvestFruit();
  }

  return actualPoints;
}

/** 收获果实：随机选一个，重置生长值，发通知 */
async function harvestFruit() {
  const fruit = FRUIT_POOL[Math.floor(Math.random() * FRUIT_POOL.length)];
  const entry = { ...fruit, time: new Date().toISOString() };

  const { harvestedFruits } = await chrome.storage.local.get('harvestedFruits');
  const fruits = harvestedFruits || [];
  fruits.push(entry);
  await chrome.storage.local.set({ harvestedFruits: fruits, growthPoints: 0 });

  // 终极自律：首次收获
  if (fruits.length === 0) {
    const { achievements } = await chrome.storage.local.get('achievements');
    const unlocked = achievements || [];
    if (!unlocked.includes('ultimateDiscipline')) {
      unlocked.push('ultimateDiscipline');
      await chrome.storage.local.set({ achievements: unlocked });
      const a = ACHIEVEMENTS.ultimateDiscipline;
      chrome.notifications.create('achieve_ultimateDiscipline', {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🏆 成就解锁！', message: a.icon + ' ' + a.name + ' — ' + a.desc
      });
    }
  }

  // 果实收藏家：3 种不同果实
  const uniqueNames = new Set(fruits.map(f => f.name));
  if (uniqueNames.size >= 3) {
    const { achievements } = await chrome.storage.local.get('achievements');
    const unlocked = achievements || [];
    if (!unlocked.includes('fruitCollector')) {
      unlocked.push('fruitCollector');
      await chrome.storage.local.set({ achievements: unlocked });
      const a = ACHIEVEMENTS.fruitCollector;
      chrome.notifications.create('achieve_fruitCollector', {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🏆 成就解锁！', message: a.icon + ' ' + a.name + ' — ' + a.desc
      });
    }
  }

  chrome.notifications.create('harvest_' + Date.now(), {
    type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '🎉 你的植物结出了【' + fruit.name + '】！',
    message: fruit.emoji + ' ' + fruit.description
  });
  await logGrowthEvent(0, '🌳 植物结出了【' + fruit.name + '】，新的一轮开始啦！');
}

/** 结算黑名单访问 */
async function settleGrowth(domain) {
  const root = getRootDomain(domain);

  // 先从内存读取，如果被 SW 重启清空则从 storage.session 恢复
  let outcome = sessionOutcome[root];
  if (!outcome) {
    const { _sessionOutcome } = await chrome.storage.session.get('_sessionOutcome');
    const saved = _sessionOutcome || {};
    outcome = saved[root];
  }
  if (!outcome) {
    return;
  }

  let points = 0, reason = '';
  if (outcome.lowQuality) {
    points = -3; reason = '低质量访问 ' + root;
  } else if (outcome.extended) {
    points = 2; reason = '超时后延长完成 ' + root;
  } else {
    points = 4; reason = '按时完成 ' + root;
  }

  const actual = await applyGrowth(points, reason);

  // 清理内存和持久化的记录
  delete sessionOutcome[root];
  const { _sessionOutcome } = await chrome.storage.session.get('_sessionOutcome');
  const saved = _sessionOutcome || {};
  delete saved[root];
  await chrome.storage.session.set({ _sessionOutcome: saved });

  if (actual > 0 && actual === points) {
    await checkAchievements(true);
  } else if (actual > 0) {
    await checkAchievements(true);
  }
}

/** 清净日奖励：非黑名单浏览每 30 分钟 +2，日上限 12 */
async function awardQuietDayBonus(domain, seconds) {
  // 检查域名是否在黑名单
  const { blacklist } = await chrome.storage.sync.get('blacklist');
  const list = blacklist || [];
  const nd = normalizeDomain(domain);
  const isBlocked = list.some(entry => {
    const ne = normalizeDomain(entry);
    if (!ne) return false;
    if (nd === ne || nd.endsWith('.' + ne)) return true;
    return false;
  });
  if (isBlocked) return; // 黑名单网站不参与清净日

  const today = dateKey();
  const { _quietDay } = await chrome.storage.local.get('_quietDay');
  const qd = (_quietDay && _quietDay.date === today) ? _quietDay : { date: today, seconds: 0, awarded: 0 };

  qd.seconds += seconds;
  // 累加非黑名单分钟数（用于时间富翁成就）
  const { _productiveTotalMinutes } = await chrome.storage.local.get('_productiveTotalMinutes');
  await chrome.storage.local.set({ _productiveTotalMinutes: (_productiveTotalMinutes || 0) + Math.floor(seconds / 60) });

  // 每 30 分钟（1800 秒）触发一次 +2，日上限 12（6 次）
  while (qd.seconds >= 1800 && qd.awarded < 6) {
    qd.seconds -= 1800;
    qd.awarded++;
    const actual = await applyGrowth(2, '清净日奖励（非黑名单专注30分钟）');
    if (actual <= 0) break; // 已达日上限
  }

  await chrome.storage.local.set({ _quietDay: qd });
}

// --- 成就定义 ---
const ACHIEVEMENTS = {
  firstFocus:          { id:'firstFocus',          name:'初次专注',   desc:'第一次解锁网站', icon:'🔓' },
  weekStreak:          { id:'weekStreak',          name:'七日君子',   desc:'连续7天每天至少1次无超时访问', icon:'📅' },
  timeMaster:          { id:'timeMaster',          name:'时间大师',   desc:'累积50次无超时访问', icon:'⏱️' },
  quietWeek:           { id:'quietWeek',           name:'清净七日',   desc:'连续7天没有任何黑名单网站访问记录', icon:'☀️' },
  fruitCollector:      { id:'fruitCollector',      name:'果实收藏家', desc:'累计收获3颗不同的果实', icon:'🧺' },
  timeMillionaire:     { id:'timeMillionaire',     name:'时间富翁',   desc:'非黑名单网站累计浏览超过100小时', icon:'⏳' },
  gentleGuardian:      { id:'gentleGuardian',      name:'温柔守护者', desc:'累计30次在提醒弹出后按时关闭页面', icon:'🕊️' },
  ultimateDiscipline:  { id:'ultimateDiscipline',  name:'终极自律',   desc:'成长值达到150并收获第一颗果实', icon:'🏆' }
};

async function unlockAchievement(id, unlocked, newlyUnlocked) {
  if (!unlocked.includes(id)) {
    newlyUnlocked.push(id); unlocked.push(id);
  }
}

async function checkAchievements(wasPositive) {
  const { achievements } = await chrome.storage.local.get('achievements');
  const unlocked = achievements || [];
  const newlyUnlocked = [];

  // 初次专注
  unlockAchievement('firstFocus', unlocked, newlyUnlocked);

  // 时间大师：累积无超时完成次数
  if (!unlocked.includes('timeMaster')) {
    const { _completedCount } = await chrome.storage.local.get('_completedCount');
    const count = (_completedCount || 0) + (wasPositive ? 1 : 0);
    await chrome.storage.local.set({ _completedCount: count });
    if (count >= 50) unlockAchievement('timeMaster', unlocked, newlyUnlocked);
  }

  // 七日君子：连续7天有正增长
  if (!unlocked.includes('weekStreak')) {
    const { _streakDays } = await chrome.storage.local.get('_streakDays');
    const today = dateKey(); const streak = _streakDays || {};
    if (wasPositive) {
      streak[today] = true;
      const days = []; for (let i=0;i<7;i++) { const d=new Date(); d.setDate(d.getDate()-i); days.push(dateKey(d.getTime())); }
      if (days.every(d=>streak[d])) unlockAchievement('weekStreak', unlocked, newlyUnlocked);
    }
    await chrome.storage.local.set({ _streakDays: streak });
  }

  // 时间富翁：非黑名单累计分钟 ≥ 6000（100小时）
  if (!unlocked.includes('timeMillionaire')) {
    const { _productiveTotalMinutes } = await chrome.storage.local.get('_productiveTotalMinutes');
    if ((_productiveTotalMinutes || 0) >= 6000) unlockAchievement('timeMillionaire', unlocked, newlyUnlocked);
  }

  if (newlyUnlocked.length > 0) {
    await chrome.storage.local.set({ achievements: unlocked });
    for (const id of newlyUnlocked) {
      const a = ACHIEVEMENTS[id];
      chrome.notifications.create('achieve_' + id, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🏆 成就解锁！', message: a.icon + ' ' + a.name + ' — ' + a.desc
      });
    }
  }
}

// --- 页面消息处理 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.action === 'sessionStart') {
      const root = getRootDomain(message.domain);
      const entry = { extended: false, lowQuality: message.lowQuality || false };
      sessionOutcome[root] = entry;
      // 持久化到 storage.session，防止 SW 重启丢失
      const { _sessionOutcome } = await chrome.storage.session.get('_sessionOutcome');
      const saved = _sessionOutcome || {};
      saved[root] = entry;
      await chrome.storage.session.set({ _sessionOutcome: saved });
      sendResponse({ ok: true });
    }
    else if (message.action === 'sessionExtend') {
      const root = getRootDomain(message.domain);
      if (sessionOutcome[root]) { sessionOutcome[root].extended = true; }
      // 同步到持久化
      const { _sessionOutcome } = await chrome.storage.session.get('_sessionOutcome');
      const saved = _sessionOutcome || {};
      if (saved[root]) { saved[root].extended = true; await chrome.storage.session.set({ _sessionOutcome: saved }); }
      sendResponse({ ok: true });
    }
    else if (message.action === 'sessionClose') {
      const root = getRootDomain(message.domain);
      if (sessionOutcome[root]) { delete sessionOutcome[root]; }
      const { _sessionOutcome } = await chrome.storage.session.get('_sessionOutcome');
      const saved = _sessionOutcome || {};
      delete saved[root];
      await chrome.storage.session.set({ _sessionOutcome: saved });
      // 温柔守护者计数
      const { _gentleCloseCount } = await chrome.storage.local.get('_gentleCloseCount');
      const gCount = (_gentleCloseCount || 0) + 1;
      await chrome.storage.local.set({ _gentleCloseCount: gCount });
      if (gCount >= 30) await checkGentleGuardian();
      sendResponse({ ok: true });
    }
  })();
  return true;
});

async function checkGentleGuardian() {
  const { achievements } = await chrome.storage.local.get('achievements');
  const unlocked = achievements || [];
  if (!unlocked.includes('gentleGuardian')) {
    unlocked.push('gentleGuardian');
    await chrome.storage.local.set({ achievements: unlocked });
    const a = ACHIEVEMENTS.gentleGuardian;
    chrome.notifications.create('achieve_gentleGuardian', {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🏆 成就解锁！', message: a.icon + ' ' + a.name + ' — ' + a.desc
    });
  }
}

// ============================================================
//  数据清理：删除 30 天前的 sessions & timeLog
// ============================================================

async function dailyCleanup() {

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

  // ---- 清净七日：检查昨天是否有黑名单访问 ----
  const yesterday = dateKey(Date.now() - 86400000);
  const { blacklist } = await chrome.storage.sync.get('blacklist');
  const blist = blacklist || [];
  const yesterdaySessions = sessions ? (sessions[yesterday] || []) : [];
  const hadBlacklistYesterday = yesterdaySessions.some(s => {
    const nd = normalizeDomain(s.domain);
    return blist.some(e => {
      const ne = normalizeDomain(e);
      if (!ne) return false;
      return nd === ne || nd.endsWith('.' + ne);
    });
  });

  const { _noBlacklistStreak } = await chrome.storage.local.get('_noBlacklistStreak');
  let streak = _noBlacklistStreak || 0;
  if (hadBlacklistYesterday) {
    streak = 0;
  } else {
    streak++;
  }
  await chrome.storage.local.set({ _noBlacklistStreak: streak });

  if (streak >= 7) {
    const { achievements } = await chrome.storage.local.get('achievements');
    const unlocked = achievements || [];
    if (!unlocked.includes('quietWeek')) {
      unlocked.push('quietWeek');
      await chrome.storage.local.set({ achievements: unlocked });
      const a = ACHIEVEMENTS.quietWeek;
      chrome.notifications.create('achieve_quietWeek', {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🏆 成就解锁！', message: a.icon + ' ' + a.name + ' — ' + a.desc
      });
    }
  }

  const deleted = sessionsChanged || timeLogChanged || passesChanged;
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
    } else {
      currentDomain = null;
      currentStartTime = null;
      await persistTrackingState();
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

  const local = await chrome.storage.local.get([
    'timeLog', 'sessions', 'growthPoints', 'achievements',
    '_dailyGrowth', '_completedCount', '_streakDays',
    '_quietDay', 'harvestedFruits', 'growthEvents',
    '_productiveTotalMinutes', '_gentleCloseCount', '_noBlacklistStreak'
  ]);
  await chrome.storage.local.set({
    timeLog: local.timeLog || {},
    sessions: local.sessions || {},
    growthPoints: local.growthPoints ?? 0,
    achievements: local.achievements || [],
    _dailyGrowth: local._dailyGrowth || { date: '', change: 0 },
    _completedCount: local._completedCount ?? 0,
    _streakDays: local._streakDays || {},
    _quietDay: local._quietDay || { date: '', seconds: 0, awarded: 0 },
    harvestedFruits: local.harvestedFruits || [],
    growthEvents: local.growthEvents || [],
    _productiveTotalMinutes: local._productiveTotalMinutes ?? 0,
    _gentleCloseCount: local._gentleCloseCount ?? 0,
    _noBlacklistStreak: local._noBlacklistStreak ?? 0
  });

});

// ============================================================
//  顶层：强制注册 keepAlive 闹钟（防止 SW 休眠）
// ============================================================
chrome.alarms.clear('keepAlive').then(() => {
  chrome.alarms.create('keepAlive', { periodInMinutes: 15 });
});

// ============================================================
//  启动
// ============================================================
boot();
