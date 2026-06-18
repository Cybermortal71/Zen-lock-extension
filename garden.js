// ============================================================
// ZenLock - 盆栽页面逻辑（大改版）
// ============================================================

const PLANT_STAGES = [
  { name: '种子', min: 0, emoji: '🌰', css: 'stage-seed', desc: '专注之旅刚刚开始' },
  { name: '发芽', min: 10, emoji: '🌱', css: 'stage-sprout', desc: '小有进展，继续加油' },
  { name: '小苗', min: 30, emoji: '🪴', css: 'stage-seedling', desc: '日渐茁壮，习惯在养成' },
  { name: '花苞', min: 60, emoji: '🌿', css: 'stage-bud', desc: '含苞待放，只差一步' },
  { name: '开花', min: 100, emoji: '🌸', css: 'stage-bloom', desc: '专注之花已经盛开' },
  { name: '结果', min: 150, emoji: '🎁', css: 'stage-harvest', desc: '即将收获果实！' }
];

const ALL_ACHIEVEMENTS = [
  { id: 'firstFocus', name: '初次专注', desc: '第一次解锁网站', icon: '🔓' },
  { id: 'weekStreak', name: '七日君子', desc: '连续7天每天至少1次无超时访问', icon: '📅' },
  { id: 'timeMaster', name: '时间大师', desc: '累积50次无超时访问', icon: '⏱️' },
  { id: 'quietWeek', name: '清净七日', desc: '连续7天没有任何黑名单网站访问记录', icon: '☀️' },
  { id: 'fruitCollector', name: '果实收藏家', desc: '累计收获3颗不同的果实', icon: '🧺' },
  { id: 'timeMillionaire', name: '时间富翁', desc: '非黑名单网站累计浏览超过100小时', icon: '⏳' },
  { id: 'gentleGuardian', name: '温柔守护者', desc: '累计30次在提醒弹出后按时关闭页面', icon: '🕊️' },
  { id: 'ultimateDiscipline', name: '终极自律', desc: '成长值达到150并收获第一颗果实', icon: '🏆' }
];

const plantEmoji = document.getElementById('plantEmoji');
const stageName = document.getElementById('stageName');
const stageDesc = document.getElementById('stageDesc');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const nextStage = document.getElementById('nextStage');
const totalPoints = document.getElementById('totalPoints');
const todayChange = document.getElementById('todayChange');
const todayChangeItem = document.getElementById('todayChangeItem');
const stageIndex = document.getElementById('stageIndex');
const fruitGrid = document.getElementById('fruitGrid');
const diaryList = document.getElementById('diaryList');
const badgeGrid = document.getElementById('badgeGrid');

// --- 规则弹窗 ---
document.getElementById('rulesBtn').addEventListener('click', () => {
  document.getElementById('rulesModal').classList.add('show');
});
document.getElementById('closeRulesBtn').addEventListener('click', () => {
  document.getElementById('rulesModal').classList.remove('show');
});
document.getElementById('rulesModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('rulesModal').classList.remove('show');
});

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function fmtTimeShort(isoStr) {
  const d = new Date(isoStr);
  return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}

// --- 加载 ---
async function load() {
  const { growthPoints, _dailyGrowth, achievements, harvestedFruits, growthEvents } =
    await chrome.storage.local.get([
      'growthPoints', '_dailyGrowth', 'achievements', 'harvestedFruits', 'growthEvents'
    ]);
  const gp = growthPoints || 0;
  const unlocked = achievements || [];
  const fruits = harvestedFruits || [];
  const events = growthEvents || [];

  // --- 植物阶段 ---
  let stage = PLANT_STAGES[0];
  let next = PLANT_STAGES[1];
  for (let i = PLANT_STAGES.length - 1; i >= 0; i--) {
    if (gp >= PLANT_STAGES[i].min) {
      stage = PLANT_STAGES[i]; next = PLANT_STAGES[i + 1] || null; break;
    }
  }

  plantEmoji.className = 'plant-emoji ' + stage.css;
  plantEmoji.textContent = stage.emoji;
  stageName.textContent = stage.name;
  stageDesc.textContent = stage.desc;

  if (next) {
    const range = next.min - stage.min;
    const pct = range > 0 ? ((gp - stage.min) / range) * 100 : 100;
    progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    progressLabel.textContent = gp + ' / ' + next.min;
    nextStage.textContent = next.name;
  } else {
    progressFill.style.width = '100%';
    progressLabel.textContent = gp + ' (已满级)';
    nextStage.textContent = '—';
  }

  // 达到 150 → 收获闪光动画
  if (gp >= 150) {
    const flash = document.getElementById('harvestFlash');
    flash.style.display = 'flex';
    flash.textContent = '🎁';
    // 动画结束后隐藏——由 CSS animation 自动处理，用 setTimeout 清理
    setTimeout(() => { flash.style.display = 'none'; }, 2000);
    // 实际收获由 background.js 的 applyGrowth 处理，这里仅展示动画
  }

  totalPoints.textContent = gp;
  stageIndex.textContent = (PLANT_STAGES.indexOf(stage) + 1) + '/' + PLANT_STAGES.length;

  // --- 今日变化 ---
  const dg = _dailyGrowth || {};
  const today = new Date().toISOString().slice(0, 10);
  const change = (dg.date === today) ? dg.change : 0;
  todayChange.textContent = (change >= 0 ? '+' : '') + change;
  todayChangeItem.className = 'score-item' + (change < 0 ? ' neg' : '');

  // --- 果实陈列室 ---
  if (fruits.length === 0) {
    fruitGrid.innerHTML = '<div class="fruit-empty">还没有收获果实，继续专注吧 🌱</div>';
  } else {
    fruitGrid.innerHTML = fruits.map(f => `
      <div class="fruit-item">
        <span class="f-emoji">${f.emoji}</span>
        <div class="f-info">
          <div class="f-name">${f.name}</div>
          <div class="f-desc">${f.description}</div>
          <div class="f-date">${formatDate(f.time)}</div>
        </div>
      </div>
    `).join('');
  }

  // --- 植物日记 ---
  if (events.length === 0) {
    diaryList.innerHTML = '<li style="text-align:center;color:var(--text-secondary);padding:16px 0;">还没有成长记录 📝</li>';
  } else {
    diaryList.innerHTML = events.slice(0, 5).map(e => {
      const isHarvest = (e.change === 0 || e.change === 'harvest');
      return `
      <li>
        <span class="d-time">${fmtTimeShort(e.time)}</span>
        ${isHarvest
          ? '<span class="d-change" style="color:var(--gold);">🎁</span>'
          : `<span class="d-change ${e.change >= 0 ? 'pos' : 'neg'}">${e.change >= 0 ? '+' : ''}${e.change}</span>`
        }
        <span class="d-reason">${e.reason}</span>
      </li>
    `;}).join('');
  }

  // --- 成就 ---
  badgeGrid.innerHTML = ALL_ACHIEVEMENTS.map(a => {
    const isOk = unlocked.includes(a.id);
    return `<div class="badge ${isOk ? 'unlocked' : 'locked'}">
      <span class="icon">${a.icon}</span>
      <div class="info"><div class="name">${a.name}</div><div class="desc">${a.desc}</div></div>
      <span class="status">${isOk ? '✅' : '🔒'}</span>
    </div>`;
  }).join('');

  console.log('🌿 盆栽加载: gp=' + gp + ' stage=' + stage.name + ' fruits=' + fruits.length + ' events=' + events.length);
}

load();
