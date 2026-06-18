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

    let currentDate = new Date().toISOString().slice(0, 10);

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

    function setDateStr(d) {
      currentDate = d;
      datePicker.value = d;
      dateLabel.textContent = d;
      loadAndRender(d);
    }

    // --- 事件绑定 ---
    datePicker.addEventListener('change', () => setDateStr(datePicker.value));
    prevDayBtn.addEventListener('click', () => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setDateStr(d.toISOString().slice(0, 10));
    });
    nextDayBtn.addEventListener('click', () => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setDateStr(d.toISOString().slice(0, 10));
    });
    todayBtn.addEventListener('click', () => {
      setDateStr(new Date().toISOString().slice(0, 10));
    });
    document.getElementById('optionsLink').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    // --- Canvas 瀑布图绘制 ---
    let hoverSessions = []; // 当前鼠标悬浮可检测的矩形区域

    function drawWaterfall(canvas, sessions, domainOrder) {
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

      // 清空
      ctx.clearRect(0, 0, W, H);

      // 背景
      ctx.fillStyle = '#fafcfe';
      ctx.fillRect(margin.left, margin.top, plotW, plotH);

      // 网格线 + X轴标签
      ctx.strokeStyle = '#e8edf2';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#7f8c9b';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      for (let h = 0; h <= 24; h += 1) {
        const x = margin.left + (h / 24) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + plotH);
        ctx.stroke();
        if (h % 3 === 0) {
          ctx.fillText(String(h).padStart(2, '0') + ':00', x, H - 8);
        }
      }

      // X轴标签
      ctx.fillStyle = '#7f8c9b';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('时间', margin.left + plotW / 2, H - 2);

      // Y轴域名
      ctx.textAlign = 'right';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#2c3e50';
      const maxDomainW = margin.left - 10;
      domainOrder.forEach((dom, i) => {
        const y = startY + i * rowH + rowH / 2 + 4;
        let text = dom;
        // 截断过长域名
        while (ctx.measureText(text).width > maxDomainW && text.length > 4) {
          text = text.slice(0, -1);
        }
        if (text !== dom) text += '…';
        ctx.fillText(text, margin.left - 8, y);
      });

      // 绘制 session 色条
      hoverSessions = [];
      sessions.forEach(s => {
        const catIdx = domainOrder.indexOf(s.domain);
        if (catIdx < 0) return;
        const startH = tsToHours(s.start);
        const endH = Math.min(tsToHours(s.end), 24);
        if (endH <= startH) return;

        const x1 = margin.left + (startH / 24) * plotW;
        const x2 = margin.left + (endH / 24) * plotW;
        const y = startY + catIdx * rowH + rowH * 0.15;
        const barH = rowH * 0.7;
        const w = Math.max(4, x2 - x1);

        ctx.fillStyle = colorForDomain(s.domain);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;

        // 圆角矩形
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
          x: x1, y: y, w: w, h: barH,
          domain: s.domain,
          startH, endH,
          duration: Math.max(0, Math.floor((s.end - s.start) / 1000))
        });
      });
    }

    // --- 鼠标悬浮 tooltip ---
    chartCanvas.addEventListener('mousemove', (e) => {
      const rect = chartCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

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
        chartCanvas.style.cursor = 'default';
      }
    });

    chartCanvas.addEventListener('mouseleave', () => {
      chartTooltip.style.display = 'none';
    });

    // --- 加载 & 渲染 ---
    async function loadAndRender(dateStr) {
      console.log('[Zenlock Stats] ====== 加载日期:', dateStr, '======');

      const storageData = await chrome.storage.local.get(['sessions', 'timeLog']);
      console.log('[Zenlock Stats] 原始 sessions 对象键:', Object.keys(storageData.sessions || {}));
      console.log('[Zenlock Stats] 原始 timeLog 对象键:', Object.keys(storageData.timeLog || {}));

      const allSessions = storageData.sessions || {};
      let daySessions = allSessions[dateStr] || [];

      // 过滤内部页面
      const INTERNAL_DOMAINS = /^(newtab|extensions|edge_.*|chrome_.*)$/;
      const isExtensionId = /^[a-z]{32}$/;
      daySessions = daySessions.filter(s => {
        const d = s.domain;
        if (INTERNAL_DOMAINS.test(d)) return false;
        if (isExtensionId.test(d)) return false;
        return true;
      });

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

      totalTimeEl.textContent = formatDuration(totalSec);
      domainCountEl.textContent = domainSet.size;
      sessionCountEl.textContent = daySessions.length - skipped;

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

      // --- 绘制 ---
      const validSessions = daySessions.filter(s =>
        typeof s.start === 'number' && s.start > 0 &&
        typeof s.end === 'number' && s.end > 0 &&
        s.end >= s.start &&
        Math.floor((s.end - s.start) / 1000) <= 86400
      );
      console.log('[Zenlock Stats] 有效 session 用于绘图:', validSessions.length);
      drawWaterfall(chartCanvas, validSessions, domainOrder);
      console.log('[Zenlock Stats] Canvas 绘制完成');
    }

    // --- 响应式重绘 ---
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const storageData = chrome.storage.local.get(['sessions']);
        storageData.then(data => {
          const allSessions = data.sessions || {};
          let daySessions = (allSessions[currentDate] || [])
            .filter(s => {
              const d = s.domain;
              if (/^(newtab|extensions|edge_.*|chrome_.*)$/.test(d)) return false;
              if (/^[a-z]{32}$/.test(d)) return false;
              return true;
            })
            .filter(s =>
              typeof s.start === 'number' && s.start > 0 &&
              typeof s.end === 'number' && s.end > 0 &&
              s.end >= s.start &&
              Math.floor((s.end - s.start) / 1000) <= 86400
            );
          const domainFirstSeen = {};
          daySessions.forEach(s => {
            if (!(s.domain in domainFirstSeen)) domainFirstSeen[s.domain] = s.start;
            else domainFirstSeen[s.domain] = Math.min(domainFirstSeen[s.domain], s.start);
          });
          const domainOrder = [...new Set(daySessions.map(s => s.domain))];
          domainOrder.sort((a, b) => (domainFirstSeen[a] || 0) - (domainFirstSeen[b] || 0));
          drawWaterfall(chartCanvas, daySessions, domainOrder);
        });
      }, 200);
    });

    // --- 启动 ---
    datePicker.value = currentDate;
    dateLabel.textContent = currentDate;
    loadAndRender(currentDate);
    console.log('[Zenlock Stats] 初始化完成（Canvas 模式）');
  }
})();
