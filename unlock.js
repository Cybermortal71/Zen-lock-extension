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
const purposeHint = document.getElementById('purposeHint');
const toast = document.getElementById('toast');

// --- 意图审核状态 ---
let promptCount = 0; // 当前解锁流程中已追问次数
const MAX_PROMPTS = 3; // 最多追问 3 次，第 4 次放行但标记

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

// --- 意图审核：检测模糊目的 ---
const FUZZY_KEYWORDS = ['随便看看', '不知道', '无聊', '打发时间', '没什么', '不想说', '看看', '逛逛'];

function isFuzzyPurpose(text) {
  const t = text.trim();
  if (t.length < 5) return true;
  const lower = t.toLowerCase();
  return FUZZY_KEYWORDS.some(kw => lower.includes(kw));
}

function showPurposeHint(times) {
  const remaining = MAX_PROMPTS - times;
  const suffix = remaining > 0 ? `（还可以追问 ${remaining} 次）` : '（最后一次提醒）';
  purposeHint.textContent = `能再具体一点吗？比如「查资料」或「看一集更新的剧」。${suffix}`;
  purposeHint.style.display = 'block';
}

function hidePurposeHint() {
  purposeHint.style.display = 'none';
}

// --- 确认解锁 ---
confirmBtn.addEventListener('click', async () => {
  if (!targetUrl) {
    showToast('缺少目标网址，无法解锁');
    return;
  }

  const purpose = purposeInput.value.trim();
  if (!purpose) {
    hidePurposeHint();
    showToast('请填写访问目的');
    purposeInput.focus();
    return;
  }

  // --- 意图审核 ---
  let lowQuality = false;
  if (isFuzzyPurpose(purpose)) {
    if (promptCount < MAX_PROMPTS) {
      promptCount++;
      showPurposeHint(promptCount);
      purposeInput.focus();
      return; // 追问，阻止解锁
    }
    // 超过追问次数上限 → 放行但标记
    lowQuality = true;
    hidePurposeHint();
    promptCount = 0;
  } else {
    hidePurposeHint();
    promptCount = 0;
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

  // 提取根域名（通行证/闹钟均以此为键）
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

  // 1. 写入通行证（根域名键）
  const { passes } = await chrome.storage.local.get('passes');
  const allPasses = passes || {};
  allPasses[rootDomain] = passExpiry;
  await chrome.storage.local.set({ passes: allPasses });

  // 1.5 累计解锁计数 +1
  const { unlockCount } = await chrome.storage.local.get('unlockCount');
  await chrome.storage.local.set({ unlockCount: (unlockCount || 0) + 1 });

  // 1.6 低质量目的计数
  if (lowQuality) {
    const { lowQualityCount } = await chrome.storage.local.get('lowQualityCount');
    await chrome.storage.local.set({ lowQualityCount: (lowQualityCount || 0) + 1 });
    console.log('⚠️ 低质量目的解锁:', purpose);
  }

  // 2. 写入 currentSession（为后续审核/盆栽做准备）
  await chrome.storage.local.set({
    currentSession: {
      domain: rootDomain,
      targetUrl,
      purpose,
      plannedMinutes,
      passExpiry,
      startTime: now,
      lowQuality
    }
  });

  // 3. 创建通行证到期闹钟（根域名）
  const alarmBase = rootDomain.replace(/\./g, '_');

  // 先清除同名旧闹钟
  await chrome.alarms.clear(alarmBase + '_warning');
  await chrome.alarms.clear(alarmBase + '_expire');

  // expire 闹钟：规划用时结束时触发（至少 0.1 分钟）
  const expireDelay = Math.max(0.1, plannedMinutes);
  await chrome.alarms.create(alarmBase + '_expire', { delayInMinutes: expireDelay });
  console.log('⏰ 到期闹钟已创建:', alarmBase + '_expire', '延迟', expireDelay, '分钟');

  // warning 闹钟：规划结束前 2 分钟触发（仅当 > 2 分钟时）
  if (plannedMinutes > 2) {
    const warningDelay = Math.max(0.1, plannedMinutes - 2);
    await chrome.alarms.create(alarmBase + '_warning', { delayInMinutes: warningDelay });
    console.log('⏰ 提醒闹钟已创建:', alarmBase + '_warning', '延迟', warningDelay, '分钟');
  }

  // 通知 background 会话开始（用于生长值追踪）
  chrome.runtime.sendMessage({
    action: 'sessionStart',
    domain: rootDomain,
    lowQuality
  });

  console.log('🔓 已解锁:', domain, '(根:', rootDomain, ') 有效期', plannedMinutes, '分钟');

  // 4. 延迟 300ms 确保 storage 已落盘，再跳转
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

// --- 今日待办（滴答清单） ---
const todoContent = document.getElementById('todoContent');

async function loadTodoList() {
  const { didaToken } = await chrome.storage.sync.get('didaToken');
  if (!didaToken) {
    todoContent.innerHTML = '<span style="color:var(--text-secondary);">未连接滴答清单</span>';
    return;
  }

  const headers = { 'Authorization': 'Bearer ' + didaToken };

  // 正确的 API 基础路径：https://api.dida365.com/open/v1
  const BASE = 'https://api.dida365.com/open/v1';

  try {
    // 第一步：获取所有项目
    const projRes = await fetch(BASE + '/project', { headers });
    console.log('滴答清单 /project → HTTP', projRes.status);
    if (!projRes.ok) {
      const text = await projRes.text().catch(() => '');
      console.error('滴答清单 /project 响应:', text.slice(0, 300));
      throw new Error('HTTP ' + projRes.status);
    }
    const projects = await projRes.json();
    console.log('滴答清单 项目:', Array.isArray(projects) ? projects.length : '非数组', '个');

    // 打印每个项目的名称和 kind，帮助定位收集箱
    if (Array.isArray(projects)) {
      projects.forEach(p => console.log('  ', p.kind, p.name, '(' + p.id + ')'));
    }

    if (!Array.isArray(projects) || projects.length === 0) {
      todoContent.innerHTML = '<span style="color:var(--text-secondary);">今天没有待办任务 🎉</span>';
      return;
    }

    // 收集箱的 projectId 固定为字符串 "inbox"
    const targetProjects = [{ id: 'inbox', name: '收集箱' }];
    console.log('滴答清单 收集箱: 使用固定 projectId="inbox"');

    // 从目标项目获取未完成任务（每项目最多 3 条，总计最多 5 条）
    let allTasks = [];
    for (const proj of targetProjects) {
      if (allTasks.length >= 5) break;
      try {
        const dataRes = await fetch(BASE + '/project/' + encodeURIComponent(proj.id) + '/data', { headers });
        console.log('  ' + proj.name, '→ HTTP', dataRes.status, 'kind=' + proj.kind);
        if (!dataRes.ok) continue;
        const data = await dataRes.json();
        const tasks = data.tasks || data.syncTaskBean || [];

        // 打印前 2 条任务的字段名，查看日期字段
        if (tasks.length > 0) {
          console.log('    任务字段:', Object.keys(tasks[0]));
          console.log('    前2条样本:', JSON.stringify(tasks.slice(0, 2)));
        }

        // 过滤：未完成 + 日期为今天或更早（逾期也显示）
        const todayStr = new Date().toISOString().slice(0, 10); // "2026-06-18"
        const incomplete = tasks.filter(t => {
          if (t.completedTime) return false;
          if (t.status !== 0 && t.status !== '0') return false;
          // 检查是否是今天或逾期的任务
          const taskDate = t.dueDate || t.startDate || '';
          if (!taskDate) return true; // 没有日期的也显示
          return taskDate <= todayStr;
        }).slice(0, 8);
        console.log('    任务', tasks.length, '条, 未完成(今日/逾期)', incomplete.length, '条');
        allTasks = allTasks.concat(incomplete.map(t => ({ ...t, projectName: proj.name })));
      } catch (e) { console.log('    请求异常:', e.message); }
    }
    allTasks = allTasks.slice(0, 8); // 总计最多 8 条

    console.log('滴答清单 未完成任务:', allTasks.length, '条');
    if (allTasks.length === 0) {
      todoContent.innerHTML = '<span style="color:var(--text-secondary);">今天没有待办任务 🎉</span>';
      return;
    }

    todoContent.innerHTML = '<ul class="todo-list">' +
      allTasks.slice(0, 8).map(t =>
        '<li><span class="todo-check">☐</span><span class="todo-title">' +
        escapeHtml(t.title) +
        '</span></li>'
      ).join('') +
      '</ul>';

  } catch (e) {
    console.error('滴答清单获取失败:', e);
    todoContent.innerHTML = '<span style="color:#e05555;">获取失败，请检查 Token</span>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadTodoList();

// --- 小问号提示 ---
const HELP_TEXTS = {
  purpose: '想清楚这次访问的目的，能帮你更自觉地控制时间。如果目的太模糊，我会再问你一次哦。',
  duration: '设定一个合理的时间，时间快到时我会温柔提醒你。'
};
let activeBubble = null;
document.querySelectorAll('.help-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeBubble) { activeBubble.remove(); activeBubble = null; }
    const key = btn.dataset.help;
    const bubble = document.createElement('div');
    bubble.className = 'help-bubble';
    bubble.textContent = HELP_TEXTS[key] || '';
    bubble.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const parentRect = btn.parentElement.getBoundingClientRect();
    bubble.style.left = '0px';
    bubble.style.top = (rect.bottom - parentRect.top + 6) + 'px';
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(bubble);
    activeBubble = bubble;
  });
});
document.addEventListener('click', () => { if (activeBubble) { activeBubble.remove(); activeBubble = null; } });

// --- 回车快捷确认 ---
purposeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmBtn.click();
});
