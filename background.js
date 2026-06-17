// ============================================================
// ZenLock - Background Service Worker (Manifest V3)
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  // --- 同步存储初始化 ---
  await chrome.storage.sync.set({
    blacklist: [],
    didaToken: '',
    zhipuKey: ''
  });

  // --- 本地存储初始化 ---
  await chrome.storage.local.set({
    timeLog: {},
    sessions: {},
    growthPoints: 0,
    achievements: []
  });

  // --- 创建周期性闹钟，每 24 小时清理一次旧数据 ---
  await chrome.alarms.create('dailyCleanup', {
    periodInMinutes: 24 * 60
  });

  console.log('ZenLock initialized successfully.');
});

// --- 闹钟触发时的占位逻辑 ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyCleanup') {
    dailyCleanup();
  }
});

/**
 * 每日清理旧数据（占位函数，后续实现）
 */
function dailyCleanup() {
  // TODO: 清理过期的 timeLog / sessions 等数据
  console.log('Daily cleanup triggered at', new Date().toISOString());
}
