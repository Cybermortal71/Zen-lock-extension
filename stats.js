// ============================================================
// ZenLock - 时间统计页面逻辑（Canvas 瀑布图，零外部依赖）
// ============================================================

(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('[Zenlock Stats] 页面初始化开始');

    const datePicker = document.getElementById('datePicker');
    const prevDayBtn = document.getElementById('prevDayBtn');
    const nextDayBtn = document.getElementById('nextDayBtn');
    const todayBtn = document.getElementById('todayBtn');
    const dateLabel = document.getElementById('dateLabel');
    const chartCard = document.getElementById('chartCard');
    const chartCanvas = document.getElementById('chartCanvas');
    const chartTooltip = document.getElementById('chartTooltip');
    const emptyState = document.getElementById('emptyState');
    const totalTimeEl = document.getElementById('totalTime');
    const domainCountEl = document.getElementById('domainCount');
    const sessionCountEl = document.getElementById('sessionCount');
    const unlockCountEl = document.getElementById('unlockCount');
    const resetZoomBtn = document.getElementById('resetZoomBtn');

    // 本地时间日期键（与 background.js 的 dateKey() 保持一致）
    function localDateKey(ts) {
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    let currentDate = localDateKey(Date.now());

    // --- 缩放状态 ---
    let zoomRange = null;       // { start, end } 或 null（全屏 0–24）
    let brushStart = null;      // { x, hour } 拖拽起点
    let brushEnd = null;        // { x, hour } 拖拽终点
    let isBrushing = false;

    // --- 域名标准化（与 background.js 一致） ---
    function normalizeDomain(domain) {
      if (!domain) return domain;
      return domain.startsWith('www.') ? domain.slice(4) : domain;
    }

    /** 提取根域名（最后两段），与 background.js getRootDomain 一致 */
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

    function isBlacklisted(domain, blacklist) {
      if (!domain || !blacklist || !blacklist.length) return false;
      const nd = normalizeDomain(domain);
      if (!nd) return false;
      return blacklist.some(entry => {
        const ne = normalizeDomain(entry);
        if (!ne) return false;
        if (nd === ne) return true;
        if (nd.endsWith('.' + ne)) return true;
        return false;
      });
    }

    // --- 域名颜色表 ---
    const COLOR_PALETTE = [
      '#4a90d9', '#6db9cf', '#91cfc5', '#b5e5bb',
      '#d9a06c', '#ed8062', '#f7705d', '#e05555',
      '#8e7cc3', '#6aa84f', '#e69138', '#a64d79',
      '#45818e', '#cc4125', '#674ea7', '#3d85c6',
    ];

    function colorForDomain(domain) {
      let hash = 0;
      for (let i = 0; i < domain.length; i++) {
        hash = ((hash << 5) - hash) + domain.charCodeAt(i);
        hash |= 0;
      }
      return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
    }

    // --- 工具函数 ---

    function formatDuration(sec) {
      if (sec == null || isNaN(sec) || sec < 0) return '0秒';
      if (sec < 60) return `${sec}秒`;
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0) return `${h}小时${m}分钟`;
      if (m > 0) return `${m}分钟${s}秒`;
      return `${s}秒`;
    }

    function fmtTime(hours) {
      const clamped = Math.max(0, Math.min(24, hours));
      const h = Math.floor(clamped);
      const m = Math.floor((clamped - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function tsToHours(ts) {
      const d = new Date(ts);
      return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }

    function setDateStr(d, skipPicker) {
      console.log('[Zenlock Stats] setDateStr d=' + d + ' skipPicker=' + skipPicker + ' currentDate=' + currentDate);
      if (d === currentDate) {
        console.log('[Zenlock Stats] 日期未变，跳过');
        return;
      }
      currentDate = d;
      if (!skipPicker) datePicker.value = d;
      dateLabel.textContent = d;
      loadAndRender(d);
    }

    // --- 事件绑定 ---
    datePicker.addEventListener('change', () => setDateStr(datePicker.value, true));
    prevDayBtn.addEventListener('click', () => {
      const parts = currentDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() - 1);
      setDateStr(localDateKey(d.getTime()));
    });
    nextDayBtn.addEventListener('click', () => {
      const parts = currentDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + 1);
      setDateStr(localDateKey(d.getTime()));
    });
    todayBtn.addEventListener('click', () => {
      setDateStr(localDateKey(Date.now()));
    });
    document.getElementById('optionsLink').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    // --- Canvas 瀑布图绘制 ---
    let hoverSessions = []; // 当前鼠标悬浮可检测的矩形区域

    // 缓存当前数据，供刷选重绘使用
    let daySessionsCache = [];
    let domainOrderCache = [];

    function drawWaterfall(canvas, sessions, domainOrder, zoom) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;

      const containerW = canvas.parentElement.clientWidth;
      const H = 500;
      canvas.width = containerW * dpr;
      canvas.height = H * dpr;
      canvas.style.width = containerW + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const W = containerW;
      const margin = { top: 12, right: 16, bottom: 38, left: 138 };
      const plotW = W - margin.left - margin.right;
      const plotH = H - margin.top - margin.bottom;

      const domainCount = domainOrder.length;
      const rowH = Math.min(36, Math.max(16, plotH / domainCount));
      const totalRowsH = domainCount * rowH;
      const startY = margin.top + (plotH - totalRowsH) / 2;

      // 缩放参数
      const zMin = zoom ? zoom.start : 0;
      const zMax = zoom ? zoom.end : 24;
      const zSpan = zMax - zMin;

      function hourToX(h) {
        return margin.left + ((h - zMin) / zSpan) * plotW;
      }
      function xToHour(px) {
        return zMin + ((px - margin.left) / plotW) * zSpan;
      }

      ctx.clearRect(0, 0, W, H);

      // 背景
      ctx.fillStyle = '#fafcfe';
      ctx.fillRect(margin.left, margin.top, plotW, plotH);

      // 动态网格
      const gridStep = zSpan <= 1 ? 0.25 : zSpan <= 4 ? 0.5 : zSpan <= 12 ? 1 : 2;
      const labelStep = zSpan <= 1 ? 0.25 : zSpan <= 4 ? 1 : zSpan <= 12 ? 2 : 3;

      ctx.strokeStyle = '#e8edf2';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#7f8c9b';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';

      for (let h = Math.floor(zMin / gridStep) * gridStep; h <= zMax; h += gridStep) {
        if (h < zMin - 0.001) continue;
        const x = hourToX(h);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + plotH);
        ctx.stroke();

        // 标签只画在大刻度上
        const isLabel = Math.abs(h - Math.round(h / labelStep) * labelStep) < 0.001;
        if (isLabel) {
          const hh = Math.floor(h);
          const mm = Math.round((h - hh) * 60);
          ctx.fillText(
            String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
            x, H - 8
          );
        }
      }

      ctx.fillText('时间', margin.left + plotW / 2, H - 2);

      // Y轴
      ctx.textAlign = 'right';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#2c3e50';
      const maxDomainW = margin.left - 10;
      domainOrder.forEach((dom, i) => {
        const y = startY + i * rowH + rowH / 2 + 4;
        let text = dom;
        while (ctx.measureText(text).width > maxDomainW && text.length > 4) text = text.slice(0, -1);
        if (text !== dom) text += '…';
        ctx.fillText(text, margin.left - 8, y);
      });

      // 绘制色条
      hoverSessions = [];
      sessions.forEach(s => {
        const catIdx = domainOrder.indexOf(s.domain);
        if (catIdx < 0) return;
        let startH = tsToHours(s.start);
        let endH = Math.min(tsToHours(s.end), 24);
        if (endH <= startH) return;

        // 裁剪到可视范围
        const visibleStart = Math.max(startH, zMin);
        const visibleEnd = Math.min(endH, zMax);
        if (visibleEnd <= visibleStart) return;

        const x1 = hourToX(visibleStart);
        const x2 = hourToX(visibleEnd);
        const y = startY + catIdx * rowH + rowH * 0.15;
        const barH = rowH * 0.7;
        const w = Math.max(4, x2 - x1);

        ctx.fillStyle = colorForDomain(s.domain);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;

        const r = Math.min(3, barH / 3);
        ctx.beginPath();
        ctx.moveTo(x1 + r, y);
        ctx.lineTo(x1 + w - r, y);
        ctx.arcTo(x1 + w, y, x1 + w, y + r, r);
        ctx.lineTo(x1 + w, y + barH - r);
        ctx.arcTo(x1 + w, y + barH, x1 + w - r, y + barH, r);
        ctx.lineTo(x1 + r, y + barH);
        ctx.arcTo(x1, y + barH, x1, y + barH - r, r);
        ctx.lineTo(x1, y + r);
        ctx.arcTo(x1, y, x1 + r, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        hoverSessions.push({
          x: x1, y, w, h: barH,
          domain: s.domain,
          startH, endH,
          duration: Math.max(0, Math.floor((s.end - s.start) / 1000))
        });
      });

      // 刷选半透明遮罩
      if (isBrushing && brushStart && brushEnd) {
        const bx = Math.min(brushStart.x, brushEnd.x);
        const bw = Math.abs(brushEnd.x - brushStart.x);
        ctx.fillStyle = 'rgba(74,144,217,0.18)';
        ctx.fillRect(bx, margin.top, bw, plotH);
        ctx.strokeStyle = 'rgba(74,144,217,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, margin.top, bw, plotH);
      }
    }

    // --- 鼠标事件：刷选缩放 + tooltip ---
    let redrawPending = null;
    function scheduleRedraw() {
      if (redrawPending) return;
      redrawPending = requestAnimationFrame(() => {
        redrawPending = null;
        const valid = daySessionsCache.filter(s =>
          typeof s.start === 'number' && s.start > 0 &&
          typeof s.end === 'number' && s.end > 0 &&
          s.end >= s.start &&
          Math.floor((s.end - s.start) / 1000) <= 86400
        );
        const order = domainOrderCache.length ? domainOrderCache : [...new Set(valid.map(s => s.domain))];
        drawWaterfall(chartCanvas, valid, order, zoomRange);
      });
    }

    chartCanvas.addEventListener('mousedown', (e) => {
      const rect = chartCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // 只响应左键
      if (e.button !== 0) return;

      // 检查是否在绘图区域内
      const W = rect.width;
      const margin = { left: 138, right: 16, top: 12 };
      const H = 500;
      const plotW = W - margin.left - margin.right;
      const plotH = H - margin.top - 38;

      if (mx >= margin.left && mx <= margin.left + plotW &&
          my >= margin.top && my <= margin.top + plotH) {
        const zMin = zoomRange ? zoomRange.start : 0;
        const zMax = zoomRange ? zoomRange.end : 24;
        const zSpan = zMax - zMin;
        const hour = zMin + ((mx - margin.left) / plotW) * zSpan;
        brushStart = { x: mx, hour };
        brushEnd = { x: mx, hour };
        isBrushing = true;
        chartTooltip.style.display = 'none';
        e.preventDefault();
      }
    });

    chartCanvas.addEventListener('mousemove', (e) => {
      const rect = chartCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (isBrushing) {
        const zMin = zoomRange ? zoomRange.start : 0;
        const zMax = zoomRange ? zoomRange.end : 24;
        const zSpan = zMax - zMin;
        const W = rect.width;
        const margin = { left: 138, right: 16 };
        const plotW = W - margin.left - margin.right;
        const hour = zMin + ((mx - margin.left) / plotW) * zSpan;
        brushEnd = { x: mx, hour };
        scheduleRedraw();
        return;
      }

      const hit = hoverSessions.find(h =>
        mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h
      );

      if (hit) {
        chartTooltip.style.display = 'block';
        chartTooltip.innerHTML =
          `<b>${hit.domain}</b><br>时间：${fmtTime(hit.startH)} – ${fmtTime(hit.endH)}<br>时长：${formatDuration(hit.duration)}`;
        chartTooltip.style.left = (e.clientX - chartCard.getBoundingClientRect().left + 14) + 'px';
        chartTooltip.style.top = (e.clientY - chartCard.getBoundingClientRect().top - 10) + 'px';
        chartCanvas.style.cursor = 'pointer';
      } else {
        chartTooltip.style.display = 'none';
        chartCanvas.style.cursor = isBrushing ? 'col-resize' : 'default';
      }
    });

    chartCanvas.addEventListener('mouseup', (e) => {
      if (!isBrushing || !brushStart || !brushEnd) {
        isBrushing = false;
        brushStart = brushEnd = null;
        return;
      }

      const startH = Math.min(brushStart.hour, brushEnd.hour);
      const endH = Math.max(brushStart.hour, brushEnd.hour);

      isBrushing = false;
      brushStart = brushEnd = null;

      // 拖拽距离太小 → 视为点击，重置缩放
      if (endH - startH < 0.05) {
        if (zoomRange) {
          zoomRange = null;
          resetZoomBtn.style.display = 'none';
          console.log('[Zenlock Stats] 缩放已重置');
          scheduleRedraw();
        }
        return;
      }

      zoomRange = { start: startH, end: endH };
      resetZoomBtn.style.display = 'inline-block';
      console.log('[Zenlock Stats] 缩放至:', fmtTime(startH), '–', fmtTime(endH));
      scheduleRedraw();
    });

    chartCanvas.addEventListener('mouseleave', () => {
      chartTooltip.style.display = 'none';
      if (isBrushing) {
        isBrushing = false;
        brushStart = brushEnd = null;
        scheduleRedraw();
      }
    });

    // --- 重置缩放按钮 ---
    resetZoomBtn.addEventListener('click', () => {
      zoomRange = null;
      brushStart = brushEnd = null;
      isBrushing = false;
      resetZoomBtn.style.display = 'none';
      const valid = daySessionsCache.filter(s =>
        typeof s.start === 'number' && s.start > 0 &&
        typeof s.end === 'number' && s.end > 0 &&
        s.end >= s.start &&
        Math.floor((s.end - s.start) / 1000) <= 86400
      );
      const order = domainOrderCache.length ? domainOrderCache : [...new Set(valid.map(s => s.domain))];
      drawWaterfall(chartCanvas, valid, order, null);
      console.log('[Zenlock Stats] 缩放已重置');
    });

    // --- 加载 & 渲染 ---
    async function loadAndRender(dateStr) {
      // 取消待处理的刷选重绘（上一日期的残留）
      if (redrawPending) {
        cancelAnimationFrame(redrawPending);
        redrawPending = null;
      }

      console.log('[Zenlock Stats] ====== 加载日期:', dateStr, '======');

      const storageData = await chrome.storage.local.get(['sessions', 'timeLog']);

      // 强力诊断：打印每个日期的 session 数量 + 首条样本
      const allSessionsRaw = storageData.sessions || {};
      const dateKeys = Object.keys(allSessionsRaw).sort();
      console.log('[Zenlock Stats] ========== 全部日期诊断 ==========');
      dateKeys.forEach(k => {
        const arr = allSessionsRaw[k] || [];
        const sample = arr.length > 0 ? `${arr[0].domain} ${new Date(arr[0].start).toLocaleTimeString()}-${new Date(arr[0].end).toLocaleTimeString()}` : '(空)';
        console.log(`[Zenlock Stats]   日期键=${k}  session数=${arr.length}  首条=${sample}`);
      });
      console.log('[Zenlock Stats] ==========================================');

      let daySessions = (allSessionsRaw[dateStr] || []).slice(); // 浅拷贝避免引用问题

      // 过滤内部页面
      const INTERNAL_DOMAINS = /^(newtab|extensions|edge_.*|chrome_.*|local-ntp|ntp\.msn\.com)$/;
      const isExtensionId = /^[a-z]{32}$/;
      daySessions = daySessions.filter(s => {
        const d = s.domain;
        if (!d) return false;                             // null/undefined 域名
        if (INTERNAL_DOMAINS.test(d)) return false;
        if (isExtensionId.test(d)) return false;
        return true;
      });

      // --- 按根域名合并显示 ---
      const mergeStats = {}; // { rootDomain: { count, before: [子域名...] } }
      daySessions.forEach(s => {
        const root = getRootDomain(s.domain);
        s._origDomain = s.domain;  // 保留原始域名
        s.domain = root;            // 替换为根域名
        if (!mergeStats[root]) mergeStats[root] = { count: 0, before: new Set() };
        mergeStats[root].count++;
        mergeStats[root].before.add(s._origDomain);
      });
      console.log('[Zenlock Stats] 根域名合并结果:', Object.entries(mergeStats).map(([k,v]) =>
        `${k}(${[...v.before].join(',')}) ${v.count}条`
      ));

      console.log('[Zenlock Stats] 当天 session 数量:', daySessions.length, '(过滤后)');
      if (daySessions.length > 0) {
        console.log('[Zenlock Stats] 前 3 条 sessions:', JSON.stringify(daySessions.slice(0, 3)));
        daySessions.forEach((s, i) => {
          const durMs = s.end - s.start;
          const durSec = Math.floor(durMs / 1000);
          console.log(`[Zenlock Stats]   [${i}] domain=${s.domain} gap_ms=${durMs} gap_sec=${durSec} gap_fmt=${formatDuration(durSec)}`);
        });
      }

      if (daySessions.length === 0) {
        chartCard.style.display = 'none';
        emptyState.style.display = 'block';
        totalTimeEl.textContent = '--';
        domainCountEl.textContent = '--';
        sessionCountEl.textContent = '--';
        unlockCountEl.textContent = '--';
        daySessionsCache = [];
        domainOrderCache = [];
        return;
      }

      chartCard.style.display = 'block';
      emptyState.style.display = 'none';

      // --- 汇总 ---
      const domainSet = new Set();
      let totalSec = 0;
      let skipped = 0;

      daySessions.forEach((s, i) => {
        domainSet.add(s.domain);
        if (typeof s.start !== 'number' || typeof s.end !== 'number') { skipped++; return; }
        if (s.start <= 0 || s.end <= 0) { skipped++; return; }
        if (s.end < s.start) { skipped++; return; }
        const dur = Math.floor((s.end - s.start) / 1000);
        if (dur > 86400) { console.warn('[Zenlock Stats] 跳过超长 session (>24h):', s); skipped++; return; }
        totalSec += dur;
      });

      console.log('[Zenlock Stats] 汇总 totalSec:', totalSec, '→', formatDuration(totalSec), '| 域名:', domainSet.size, '| 跳过:', skipped);

      // --- 累计解锁次数（每次确认解锁 +1） ---
      const { unlockCount } = await chrome.storage.local.get('unlockCount');
      const ulk = unlockCount || 0;
      console.log('[Zenlock Stats] 累计解锁次数:', ulk);

      totalTimeEl.textContent = formatDuration(totalSec);
      domainCountEl.textContent = domainSet.size;
      sessionCountEl.textContent = daySessions.length - skipped;
      unlockCountEl.textContent = ulk;

      // --- 日期切换时重置缩放 ---
      zoomRange = null;
      brushStart = brushEnd = null;
      isBrushing = false;
      resetZoomBtn.style.display = 'none';

      // --- 域名排序 ---
      const domainFirstSeen = {};
      daySessions.forEach(s => {
        if (typeof s.start !== 'number') return;
        if (!(s.domain in domainFirstSeen)) {
          domainFirstSeen[s.domain] = s.start;
        } else {
          domainFirstSeen[s.domain] = Math.min(domainFirstSeen[s.domain], s.start);
        }
      });
      const domainOrder = [...new Set(daySessions.map(s => s.domain))];
      domainOrder.sort((a, b) => (domainFirstSeen[a] || 0) - (domainFirstSeen[b] || 0));
      console.log('[Zenlock Stats] 域名顺序:', domainOrder);

      // --- 缓存供缩放时重绘 ---
      const validSessions = daySessions.filter(s =>
        typeof s.start === 'number' && s.start > 0 &&
        typeof s.end === 'number' && s.end > 0 &&
        s.end >= s.start &&
        Math.floor((s.end - s.start) / 1000) <= 86400
      );
      daySessionsCache = validSessions;
      domainOrderCache = domainOrder;

      console.log('[Zenlock Stats] 有效 session 用于绘图:', validSessions.length, '域名:', domainOrder.join(', '));
      if (validSessions.length > 0) {
        console.log('[Zenlock Stats] 绘图数据样本:', JSON.stringify(validSessions.slice(0, 3).map(s => ({ d: s.domain, t: fmtTime(tsToHours(s.start)) + '-' + fmtTime(tsToHours(s.end)) }))));
      }
      drawWaterfall(chartCanvas, validSessions, domainOrder, null);
      console.log('[Zenlock Stats] Canvas 绘制完成');
    }

    // ============================================================
    //  AI 周报
    // ============================================================
    const generateReportBtn = document.getElementById('generateReportBtn');
    const reportResult = document.getElementById('reportResult');

    generateReportBtn.addEventListener('click', async () => {
      // 读取 API Key
      const { deepseekKey } = await chrome.storage.sync.get('deepseekKey');
      if (!deepseekKey) {
        reportResult.style.display = 'block';
        reportResult.innerHTML = '<span style="color:#e05555;">⚠️ 请先在<a href="#" id="goOptions">设置页</a>配置 DeepSeek API Key。</span>';
        document.getElementById('goOptions').addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.openOptionsPage();
        });
        return;
      }

      // 收集过去 7 天的 timeLog
      const { timeLog } = await chrome.storage.local.get('timeLog');
      const logs = timeLog || {};
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = localDateKey(d.getTime());
        days.push(key);
      }

      // 构建纯文本摘要
      const lines = [];
      days.forEach(dateKey => {
        const dayLogs = logs[dateKey];
        if (!dayLogs || Object.keys(dayLogs).length === 0) return;
        const d = new Date(dateKey + 'T00:00:00');
        const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日`;
        const entries = Object.entries(dayLogs)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([domain, sec]) => {
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            return h > 0 ? `${domain} ${h}小时${m}分钟` : `${domain} ${m}分钟`;
          });
        if (entries.length > 0) {
          lines.push(`${dateLabel}：${entries.join('，')}`);
        }
      });

      if (lines.length === 0) {
        reportResult.style.display = 'block';
        reportResult.innerHTML = '<span style="color:var(--text-secondary);">暂无最近7天的浏览数据。</span>';
        return;
      }

      const summary = lines.join('\n');
      console.log('[Zenlock Stats] 周报数据摘要:\n', summary);

      // 显示 loading
      generateReportBtn.disabled = true;
      generateReportBtn.textContent = '⏳ 生成中...';
      reportResult.style.display = 'block';
      reportResult.innerHTML = '<span style="color:var(--text-secondary);">正在请求 DeepSeek API，请稍候…</span>';

      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + deepseekKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: '你是一位亲切的时间管理教练。根据用户的浏览数据，用中文给出200字左右的总结，包括时间分配特点、值得注意的习惯，以及两条具体可行的改善建议。'
              },
              {
                role: 'user',
                content: '以下是我过去7天的网页浏览记录（仅包含域名和时长）：\n' + summary
              }
            ],
            max_tokens: 600,
            temperature: 0.7
          })
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('API Key 无效（401），请检查设置。');
          }
          throw new Error('API 请求失败（' + response.status + '）');
        }

        const data = await response.json();
        const aiText = data.choices?.[0]?.message?.content || '（AI 返回为空）';
        reportResult.innerHTML =
          '<div style="font-weight:600;color:var(--primary);margin-bottom:8px;">📋 AI 周报总结</div>' +
          '<div>' + aiText.replace(/\n/g, '<br>') + '</div>';
        console.log('[Zenlock Stats] AI 周报生成成功');

      } catch (e) {
        console.error('[Zenlock Stats] AI 周报失败:', e);
        reportResult.innerHTML = '<span style="color:#e05555;">❌ ' + e.message + '</span>';
      } finally {
        generateReportBtn.disabled = false;
        generateReportBtn.textContent = '📊 生成周报';
      }
    });

    // --- 响应式重绘 ---
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (daySessionsCache.length && domainOrderCache.length) {
          drawWaterfall(chartCanvas, daySessionsCache, domainOrderCache, zoomRange);
        }
      }, 200);
    });

    // --- 启动 ---
    datePicker.value = currentDate;
    dateLabel.textContent = currentDate;
    loadAndRender(currentDate);
    console.log('[Zenlock Stats] 初始化完成（Canvas 模式）');
  }
})();
