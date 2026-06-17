// ============================================================
// ZenLock - 内容脚本（注入到所有页面）
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'timeWarning') {
    showWarningBar(message.domain);
  }
});

/**
 * 在页面顶部显示半透明提醒浮条，8 秒后渐隐
 */
function showWarningBar(domain) {
  // 移除已有浮条，避免重复
  const existing = document.getElementById('zenlock-warning-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'zenlock-warning-bar';
  bar.textContent = '距离规划结束还有 2 分钟，任务完成了吗？';

  bar.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 2147483647',
    'background: rgba(74, 144, 217, 0.93)',
    'color: #fff',
    'text-align: center',
    'padding: 11px 16px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'font-size: 14px',
    'font-weight: 500',
    'letter-spacing: 0.3px',
    'box-shadow: 0 2px 12px rgba(0,0,0,0.15)',
    'transition: opacity 0.8s ease-out',
    'cursor: default'
  ].join(';');

  document.documentElement.appendChild(bar);

  // 8 秒后渐隐并移除
  setTimeout(() => {
    bar.style.opacity = '0';
    setTimeout(() => {
      if (bar.parentNode) bar.remove();
    }, 800);
  }, 8000);
}
