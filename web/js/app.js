/* 库洛米每日打卡 · 业务逻辑与 UI */
'use strict';

function parentGate(action) {
  if (typeof AndroidApp !== 'undefined' && AndroidApp.verifyParentPassword) {
    const remaining = Number(AndroidApp.parentLockoutRemainingMs ? AndroidApp.parentLockoutRemainingMs() : 0);
    if (remaining > 0) { pop(`密码已锁定，请 ${Math.ceil(remaining / 60000)} 分钟后再试`); return Promise.resolve(false); }
    let input;
    try { input = window.prompt(`家长验证：${action}\n请输入 4–6 位数字密码`); } catch (e) { pop('当前环境无法打开密码输入框'); return Promise.resolve(false); }
    if (input === null) return Promise.resolve(false);
    const ok = !!AndroidApp.verifyParentPassword(input.trim());
    if (!ok) pop('密码错误，无法执行此操作');
    return Promise.resolve(ok);
  }
  const fallback = safeParse(lsGet() || '') || {};
  const hash = (value) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  };
  if (!fallback.parentHash) fallback.parentHash = hash('999000');
  let input;
  try { input = window.prompt(`家长验证：${action}\n请输入 4–6 位数字密码`); } catch (e) { pop('当前环境无法打开密码输入框'); return Promise.resolve(false); }
  if (input === null) return Promise.resolve(false);
  if (!/^\d{4,6}$/.test(input.trim()) || hash(input.trim()) !== fallback.parentHash) { pop('密码错误，无法执行此操作'); return Promise.resolve(false); }
  return Promise.resolve(true);
}
function setParentPassword() {
  const ask = window.prompt('修改家长密码：请输入当前密码');
  if (ask === null) return;
  if (typeof AndroidApp !== 'undefined' && AndroidApp.changeParentPassword) {
    const next = window.prompt('请输入新的 4–6 位数字密码');
    const confirmNext = next === null ? null : window.prompt('请再次输入新密码');
    if (next === null || confirmNext === null) return;
    if (!/^\d{4,6}$/.test(next) || next !== confirmNext) { pop('新密码格式不正确或两次输入不一致'); return; }
    if (AndroidApp.changeParentPassword(ask.trim(), next)) pop('家长密码已修改');
    else pop('当前密码错误，密码未修改');
    return;
  }
  pop('浏览器预览模式不支持修改密码，请在平板应用中操作');
}
function audit(actor, type, detail, delta = 0) {
  state.audit.push({ id: uid(), at: new Date().toISOString(), actor, type, detail: String(detail || ''), delta: Number(delta) || 0 });
  if (state.audit.length > 1000) state.audit = state.audit.slice(-1000);
}
function trustedNow() {
  const localNow = Date.now();
  let sourceNow = localNow;
  let trusted = false;
  if (typeof AndroidApp !== 'undefined' && AndroidApp.getTrustedTimeState) {
    try {
      const data = JSON.parse(AndroidApp.getTrustedTimeState());
      if (data && Number(data.nowMs)) { sourceNow = Number(data.nowMs); trusted = !!data.online || (Number(data.ageMs) <= OFFLINE_TIME_LIMIT_MS); }
    } catch (e) { /* fallback to guarded local time */ }
  }
  if (!trusted && state.clock.lastTrustedMs && (localNow - state.clock.lastTrustedAt) <= OFFLINE_TIME_LIMIT_MS) {
    sourceNow = Math.max(localNow, state.clock.lastTrustedMs);
  }
  if (state.clock.lastSeenMs && sourceNow < state.clock.lastSeenMs - CLOCK_DRIFT_MS) return { ok: false, now: sourceNow };
  state.clock.lastSeenMs = Math.max(state.clock.lastSeenMs || 0, sourceNow);
  if (trusted) { state.clock.lastTrustedMs = sourceNow; state.clock.lastTrustedAt = localNow; }
  return { ok: true, now: sourceNow };
}
function timeGate() {
  if (typeof networkWriteGate === 'function' && !networkWriteGate()) return false;
  const check = trustedNow();
  if (!check.ok) { pop('检测到平板时间回调超过 5 分钟，请家长检查时间'); return false; }
  return true;
}

/* ---------- 每日历史（支撑周报） ---------- */
function ensureHistory(d = todayStr()) {
  if (!state.history[d]) state.history[d] = { planDone: 0, planTotal: state.plan.length, planStats: {}, sport: false, sportType: null, books: 0, mood: null, points: 0, checkinPoints: 0, bonusPoints: 0, deductedPoints: 0, redeemedPoints: 0 };
  const r = state.history[d];
  if (!r.planStats) {
    r.planStats = { school: { done: 0, total: 0 }, weekend: { done: 0, total: 0 } };
    r.planStats[state.planMode] = { done: r.planDone || 0, total: r.planTotal || 0 };
  }
  ['school', 'weekend'].forEach((mode) => {
    const list = state.plansByMode && state.plansByMode[mode] ? state.plansByMode[mode] : [];
    if (!r.planStats[mode]) r.planStats[mode] = { done: 0, total: list.length };
    r.planStats[mode].total = Math.max(r.planStats[mode].total || 0, list.length);
  });
  r.planDone = Object.values(r.planStats).reduce((n, x) => n + (x.done || 0), 0);
  r.planTotal = Object.values(r.planStats).reduce((n, x) => n + (x.total || 0), 0);
}
function dayRec(d = todayStr()) { ensureHistory(d); return state.history[d]; }

/* ---------- 积分 ---------- */
function addPoints(n, source = 'checkin', detail = '', date = todayStr()) {
  if (!timeGate()) return false;
  state.totalPoints += n;
  if (source === 'checkin') state.lifetimePoints += n;
  const r = dayRec(date); r.points += n; if (source === 'checkin') r.checkinPoints += n; else if (source === 'bonus') r.bonusPoints += n;
  audit(source === 'bonus' ? 'parent' : 'child', source === 'bonus' ? '额外积分' : '打卡积分', detail, n);
  return true;
}
function subPoints(n, source = 'checkin', detail = '', date = todayStr()) {
  if (!timeGate()) return false;
  state.totalPoints = Math.max(0, state.totalPoints - n);
  if (source === 'checkin') state.lifetimePoints = Math.max(0, state.lifetimePoints - n);
  const r = dayRec(date); r.points -= n; r.deductedPoints += n; if (source === 'redeem') r.redeemedPoints += n;
  audit(source === 'redeem' ? 'child' : 'parent', source === 'redeem' ? '积分兑换' : '撤销打卡积分', detail, -n);
  return true;
}
function todayPoints() {
  const allPlans = state.plansByMode ? [...state.plansByMode.school, ...state.plansByMode.weekend] : state.plan;
  const planPts = allPlans.filter((p) => p.done).length * 5;
  const sportPts = state.sport.week.filter(Boolean).length * 10;
  const moodPts = state.mood.date === todayStr() ? 3 : 0;
  const bookPts = state.books.filter((b) => b.date === todayStr() && b.credited !== false).length * 5;
  return planPts + sportPts + moodPts + bookPts;
}

/* ---------- 宠物 SVG（布偶猫原型 · 手绘卡通 · 10 种造型） ---------- */
function costumeOverlays(c) {
  let s = '';
  if (c.bow) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <path d="M150 64 L133 53 L133 75 Z" fill="#ff7ab8"/>
      <path d="M150 64 L167 53 L167 75 Z" fill="#ff7ab8"/>
      <circle cx="150" cy="64" r="6" fill="#ff9ecf"/></g>`;
  }
  if (c.flower) {
    s += `<g stroke="#2b2238" stroke-width="2">
      <circle cx="55" cy="52" r="5.5" fill="#ffd6ec"/><circle cx="67" cy="52" r="5.5" fill="#ffd6ec"/>
      <circle cx="55" cy="64" r="5.5" fill="#ffd6ec"/><circle cx="67" cy="64" r="5.5" fill="#ffd6ec"/>
      <circle cx="61" cy="58" r="5" fill="#ffe08a"/></g>`;
  }
  if (c.strawberry) {
    s += `<g stroke="#2b2238" stroke-width="2.2" stroke-linejoin="round">
      <path d="M140 42 q-12 7 -8 23 q8 10 16 0 q4 -16 -8 -23 z" fill="#ff5d73"/>
      <path d="M132 42 l4 -10 l6 8 l6 -8 l4 10 z" fill="#8fd17a"/>
      <circle cx="136" cy="54" r="1.4" fill="#fff"/><circle cx="143" cy="58" r="1.4" fill="#fff"/><circle cx="139" cy="62" r="1.4" fill="#fff"/></g>`;
  }
  if (c.star) {
    s += `<g stroke="#2b2238" stroke-width="2.2">
      <path d="M60 98 Q100 86 140 98" fill="none" stroke-width="5" stroke="#c9a9ff"/>
      <path d="M100 68 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1 z" fill="#ffe08a" stroke-width="2"/></g>`;
  }
  if (c.glasses) {
    s += `<g>
      <circle cx="82" cy="120" r="13" fill="#cdefff" fill-opacity=".6" stroke="#2b2238" stroke-width="3"/>
      <circle cx="118" cy="120" r="13" fill="#cdefff" fill-opacity=".6" stroke="#2b2238" stroke-width="3"/>
      <path d="M95 120 h10" stroke="#2b2238" stroke-width="3"/></g>`;
  }
  if (c.bowtie) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <path d="M100 182 L84 174 L84 190 Z" fill="#ff9ecf"/>
      <path d="M100 182 L116 174 L116 190 Z" fill="#ff9ecf"/>
      <rect x="95" y="177" width="10" height="10" rx="2" fill="#ff7ab8"/></g>`;
  }
  if (c.scarf) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <path d="M64 176 Q100 196 136 176 L136 188 Q100 206 64 188 Z" fill="#b8f0d8"/>
      <rect x="92" y="184" width="16" height="22" rx="5" fill="#a0e8c8"/>
      <path d="M92 200 L88 214 L98 208 L104 216 L104 200 Z" fill="#a0e8c8"/></g>`;
  }
  if (c.tophat) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <ellipse cx="100" cy="44" rx="38" ry="9" fill="#3a2b4d"/>
      <rect x="80" y="12" width="40" height="32" rx="3" fill="#3a2b4d"/>
      <rect x="80" y="32" width="40" height="8" fill="#b58bff"/></g>`;
  }
  if (c.cap) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <path d="M68 42 Q100 8 132 40 L132 46 Q100 32 68 46 Z" fill="#7ec8ff"/>
      <path d="M126 42 q24 2 28 13 q-16 4 -28 -3 z" fill="#7ec8ff"/>
      <circle cx="100" cy="20" r="4" fill="#fff"/></g>`;
  }
  if (c.crown) {
    s += `<g stroke="#2b2238" stroke-width="2.5" stroke-linejoin="round">
      <path d="M74 46 L80 22 L90 38 L100 16 L110 38 L120 22 L126 46 Z" fill="#ffe08a"/>
      <rect x="74" y="44" width="52" height="9" rx="3" fill="#ffd36b"/>
      <circle cx="100" cy="14" r="3.5" fill="#ff7ab8" stroke="none"/></g>`;
  }
  return s;
}
function petSVG(type, mood, c) {
  // 耳朵（海豹色 + 粉嫩内耳 + 奶白耳尖）
  const ears = `
    <polygon points="50,74 78,24 100,66" fill="#a9805f" stroke="#2b2238" stroke-width="3" stroke-linejoin="round"/>
    <polygon points="150,74 122,24 100,66" fill="#a9805f" stroke="#2b2238" stroke-width="3" stroke-linejoin="round"/>
    <polygon points="62,66 78,42 92,64" fill="#ffd0e0"/>
    <polygon points="138,66 122,42 108,64" fill="#ffd0e0"/>
    <polygon points="78,24 71,38 86,40" fill="#fff7ef" stroke="#2b2238" stroke-width="2"/>
    <polygon points="122,24 129,38 114,40" fill="#fff7ef" stroke="#2b2238" stroke-width="2"/>`;
  // 眉间海豹色花纹（布偶猫标志性）
  const blaze = `<path d="M100 60 q-7 16 -3 30 q3 -5 6 0 q4 -14 -3 -30 z" fill="#c9a98c" opacity=".7"/>`;
  const blueEye = (cx) => `
    <ellipse cx="${cx}" cy="120" rx="12" ry="15" fill="#bfe3f2" stroke="#2b2238" stroke-width="2.5"/>
    <ellipse cx="${cx}" cy="121" rx="8" ry="11" fill="#3f9fd6"/>
    <ellipse cx="${cx}" cy="123" rx="4.5" ry="8" fill="#1d3346"/>
    <circle cx="${cx - 3}" cy="114" r="3.2" fill="#fff"/>`;
  let eyes, mouth;
  if (mood === 'sad') {
    eyes = `<path d="M70 118 q12 10 24 0" stroke="#2b2238" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M106 118 q12 10 24 0" stroke="#2b2238" stroke-width="3" fill="none" stroke-linecap="round"/>
            <circle cx="84" cy="140" r="4" fill="#a9d8ff"/>`;
    mouth = `<path d="M93 150 q7 -7 14 0" stroke="#2b2238" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else if (mood === 'happy') {
    eyes = `<path d="M68 122 q12 -12 24 0" stroke="#2b2238" stroke-width="4" fill="none" stroke-linecap="round"/>
            <path d="M108 122 q12 -12 24 0" stroke="#2b2238" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    mouth = `<path d="M88 146 q12 14 24 0" stroke="#2b2238" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else {
    eyes = blueEye(82) + blueEye(118);
    mouth = `<path d="M100 142 v4 M100 146 q-6 6 -11 2 M100 146 q6 6 11 2" stroke="#2b2238" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }
  const nose = `<path d="M93 134 L107 134 L100 142 Z" fill="#ff9ecf" stroke="#2b2238" stroke-width="2" stroke-linejoin="round"/>`;
  const blush = `<ellipse cx="62" cy="138" rx="11" ry="7" fill="#ffb3d9" opacity=".8"/>
                 <ellipse cx="138" cy="138" rx="11" ry="7" fill="#ffb3d9" opacity=".8"/>`;
  const whiskers = `<g stroke="#2b2238" stroke-width="1.5" opacity=".5" stroke-linecap="round">
      <path d="M52 126 q-16 -3 -24 -8"/><path d="M52 134 q-16 1 -25 0"/><path d="M52 142 q-15 5 -23 10"/>
      <path d="M148 126 q16 -3 24 -8"/><path d="M148 134 q16 1 25 0"/><path d="M148 142 q15 5 23 10"/></g>`;
  const chest = `<path d="M60 172 q40 28 80 0 q-4 20 -40 20 q-36 0 -40 -20 z" fill="#fff7ef" stroke="#2b2238" stroke-width="3"/>`;

  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    ${ears}
    <ellipse cx="100" cy="122" rx="66" ry="60" fill="#fff7ef" stroke="#2b2238" stroke-width="3"/>
    ${chest}
    ${blaze}
    ${blush}
    ${eyes}
    ${nose}
    ${mouth}
    ${whiskers}
    ${costumeOverlays(c || {})}
  </svg>`;
}
function kuromiLogoSVG() {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="100" cy="132" rx="58" ry="54" fill="#fff0f7" stroke="#2b2238" stroke-width="3"/>
    <path d="M42 114 C42 48 158 48 158 114 C148 82 128 72 100 72 C72 72 52 82 42 114 Z" fill="#3a2b4d" stroke="#2b2238" stroke-width="3"/>
    <polygon points="58,64 72,28 86,66" fill="#3a2b4d" stroke="#2b2238" stroke-width="3" stroke-linejoin="round"/>
    <polygon points="142,64 128,28 114,66" fill="#3a2b4d" stroke="#2b2238" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="72" cy="84" r="3" fill="#fff"/><circle cx="100" cy="78" r="3" fill="#fff"/><circle cx="128" cy="84" r="3" fill="#fff"/>
    <g transform="translate(100,90)">
      <circle r="9" fill="#ff9ecf" stroke="#2b2238" stroke-width="2"/>
      <circle cx="-3.4" cy="-1" r="1.8" fill="#2b2238"/><circle cx="3.4" cy="-1" r="1.8" fill="#2b2238"/>
      <path d="M-4 5 q4 4 8 0" stroke="#2b2238" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </g>
    <ellipse cx="68" cy="142" rx="10" ry="6.5" fill="#ffb3d9" opacity=".8"/>
    <ellipse cx="132" cy="142" rx="10" ry="6.5" fill="#ffb3d9" opacity=".8"/>
    <ellipse cx="86" cy="124" rx="7" ry="9" fill="#2b2238"/><ellipse cx="114" cy="124" rx="7" ry="9" fill="#2b2238"/>
    <circle cx="88" cy="120" r="2.2" fill="#fff"/><circle cx="116" cy="120" r="2.2" fill="#fff"/>
    <path d="M93 150 q7 7 14 0" stroke="#2b2238" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* ---------- 等级 / 心情文案 ---------- */
function petLevel() {
  const lv = Math.min(10, Math.floor(state.lifetimePoints / 50) + 1);
  const names = ['蛋仔', '宝宝', '小可爱', '小能手', '打卡星', '打卡王', '自律侠', '库洛米伙伴', '超级明星', '传奇宝贝'];
  return { lv, name: names[lv - 1], pct: (state.lifetimePoints % 50) / 50 * 100 };
}
function petMood() {
  const m = state.mood.mood;
  if (m === 'sad' || m === 'angry') return 'sad';
  if (state.mood.date === todayStr() && m) return 'happy';
  return todayPoints() >= 20 ? 'happy' : 'neutral';
}
function petBubble() {
  const b = petMood();
  if (b === 'sad') return '呜…今天有点不开心，抱抱你 💗';
  if (b === 'happy') return '今天超棒！库洛米为你骄傲 ✨';
  const tips = ['今天也要加油哦～', '一起把任务勾勾掉吧！', '运动完身体棒棒 💪', '读好书，长本领 📚'];
  return tips[new Date().getDate() % tips.length];
}

/* ---------- 渲染 ---------- */
function renderHeader() {
  $('#totalPoints').textContent = state.totalPoints;
  $('#rewardPoints').textContent = state.totalPoints;
  const d = new Date(trustedDateMs());
  const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  $('#dateChip').textContent = `📅 ${d.getMonth() + 1}月${d.getDate()}日 周${wk}`;
}
function renderPet() {
  const mood = petMood();
  $('#petDisplay').innerHTML = petSVG(state.petType, mood, state.costumes);
  $('#petMoodBubble').textContent = petBubble();
  if (document.activeElement !== $('#petNameInput')) $('#petNameInput').value = state.petName;
  const lv = petLevel();
  $('#levelFill').style.width = lv.pct + '%';
  $('#petLevelText').textContent = `Lv.${lv.lv} ${lv.name}`;
  renderWardrobe();
}
function renderWardrobe() {
  const row = $('#costumeRow');
  row.innerHTML = '';
  COSTUMES.forEach((c) => {
    const owned = !!state.owned[c.key];
    const equipped = !!state.costumes[c.key];
    const btn = document.createElement('button');
    btn.className = 'costume-btn' + (equipped ? ' equipped' : '') + (owned ? ' owned' : '');
    if (!owned) {
        const can = state.totalPoints >= c.cost;
      btn.innerHTML = `${c.emoji}<span class="price ${can ? '' : 'poor'}">${c.cost}</span>`;
      btn.title = `${c.name} · ${c.cost} 分兑换`;
    } else {
      btn.innerHTML = `${c.emoji}<span class="ok">${equipped ? '✔' : '·'}</span>`;
      btn.title = equipped ? `${c.name}（点击卸下）` : `${c.name}（点击佩戴）`;
    }
    btn.onclick = () => {
      if (!state.owned[c.key]) {
        if (state.totalPoints < c.cost) { pop(`还差 ${c.cost - state.totalPoints} 分才能兑换「${c.name}」哦～`); return; }
        if (!window.confirm(`确定使用 ${c.cost} 分兑换“${c.name}”吗？兑换后不可撤销。`)) return;
        if (!timeGate()) return;
        state.totalPoints -= c.cost;
        dayRec().points -= c.cost; dayRec().redeemedPoints += c.cost;
        audit('child', '积分兑换', `宠物造型：${c.name}`, -c.cost);
        state.owned[c.key] = true;
        const category = COSTUME_CATEGORIES[c.key];
        Object.keys(state.costumes).forEach((key) => { if (COSTUME_CATEGORIES[key] === category) state.costumes[key] = false; });
        state.costumes[c.key] = true; // 兑换后自动穿上
        pop(`兑换成功：${c.name} ${c.emoji}！`); confetti();
      } else {
        const category = COSTUME_CATEGORIES[c.key];
        if (!state.costumes[c.key]) Object.keys(state.costumes).forEach((key) => { if (COSTUME_CATEGORIES[key] === category) state.costumes[key] = false; });
        state.costumes[c.key] = !state.costumes[c.key];
      }
      save(); renderAll();
    };
    row.appendChild(btn);
  });
  const next = COSTUMES.find((c) => !state.owned[c.key]);
  if (next) $('#costumeHint').textContent = `「${next.name}」${next.emoji} 需 ${next.cost} 分，去完成任务赚积分吧！`;
  else $('#costumeHint').textContent = '🎉 10 套造型全部集齐，布偶猫今天超漂亮！';
}
function renderTemplateToggle() {
  $$('.tmpl-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.planMode));
}
function renderPlan() {
  const list = $('#planList');
  list.innerHTML = '';
  state.plan.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.innerHTML = `
      <div class="plan-check ${p.done ? 'done' : ''}" data-id="${p.id}">${p.done ? '✔' : ''}</div>
      <div class="plan-text ${p.done ? 'done' : ''}">${escapeHtml(p.text)}</div>
      <button class="plan-del" data-id="${p.id}" title="删除">✕</button>`;
    list.appendChild(li);
  });
  const done = state.plan.filter((p) => p.done).length;
  $('#planDoneCount').textContent = `${done}/${state.plan.length} 完成`;
  $('#planTodayPts').textContent = `今日 +${todayPoints()}`;
  renderTemplateToggle();
}
function renderSport() {
  const pick = $('#sportPick');
  pick.innerHTML = '';
  state.sport.options.forEach((o) => {
    const b = document.createElement('button');
    b.className = 'sport-chip' + (state.sport.selected === o ? ' active' : '');
    b.textContent = o;
    b.onclick = () => {
      if (typeof networkWriteGate === 'function' && !networkWriteGate()) return;
      state.sport.selected = o; save(); renderSport();
    };
    pick.appendChild(b);
  });
  const grid = $('#weekGrid');
  grid.innerHTML = '';
  const ti = todayIndex();
  const dates = weekDates();
  state.sport.week.forEach((sportType, i) => {
    const cell = document.createElement('div');
    cell.className = 'week-day' + (sportType ? ' done' : '') + (i === ti ? ' today' : '');
    cell.title = sportType ? `${sportType}（点击取消）` : '点击打卡';
    cell.innerHTML = `<span class="wd-emoji">${sportType ? '⚽' : '·'}</span><span>${WEEK_LABELS[i]}</span>`;
    cell.onclick = async () => {
      if (i > ti) { pop('未来日期不能提前打卡哦～'); return; }
      if (i !== ti && !(await parentGate('补打或修改过去的运动记录'))) return;
      if (sportType && !(await parentGate('取消运动打卡'))) return;
      if (!timeGate()) return;
      if (state.sport.week[i]) {
        if (!subPoints(10, 'checkin', `运动：${sportType || state.sport.selected}`, dates[i])) return;
        state.sport.week[i] = null; dayRec(dates[i]).sport = false; dayRec(dates[i]).sportType = null;
      } else {
        const credited = addPoints(10, 'checkin', `运动：${state.sport.selected}`, dates[i]);
        if (!credited) return;
        state.sport.week[i] = state.sport.selected; dayRec(dates[i]).sport = true; dayRec(dates[i]).sportType = state.sport.selected; pop('运动打卡 +10 分 💪'); confetti();
      }
      save(); renderAll();
    };
    grid.appendChild(cell);
  });
  $('#sportWeekCount').textContent = state.sport.week.filter(Boolean).length;
  let streak = 0;
  for (let i = ti; i >= 0; i--) { if (state.sport.week[i]) streak++; else break; }
  $('#sportStreak').textContent = streak;
}
function renderBooks() {
  const list = $('#bookList');
  list.innerHTML = '';
  if (!state.books.length) { list.innerHTML = '<div class="empty-tip">还没有读书记录，读完一本就记下来吧～</div>'; return; }
  [...state.books].reverse().forEach((b) => {
    const li = document.createElement('li');
    li.className = 'book-item';
    li.innerHTML = `
      <button class="bi-del" data-id="${b.id}" title="删除">✕</button>
      <div class="bi-name">📖 ${escapeHtml(b.name)}</div>
      <div class="bi-meta">${b.pages ? b.pages + ' 页 · ' : ''}${b.date}</div>
      ${b.note ? `<div class="bi-note">“${escapeHtml(b.note)}”</div>` : ''}`;
    list.appendChild(li);
  });
}
function renderMood() {
  const pick = $('#moodPick');
  pick.innerHTML = '';
  Object.keys(MOOD_MAP).forEach((k) => {
    const m = MOOD_MAP[k];
    const b = document.createElement('button');
    b.className = 'mood-chip' + (state.mood.mood === k && state.mood.date === todayStr() ? ' active' : '');
    b.textContent = m.emoji; b.title = m.label;
    b.onclick = () => { state.mood.mood = k; renderMood(); renderPet(); };
    pick.appendChild(b);
  });
  $('#moodText').value = state.mood.date === todayStr() ? state.mood.text : '';
  const box = $('#moodToday');
  if (state.mood.date === todayStr() && state.mood.mood) {
    const m = MOOD_MAP[state.mood.mood];
    box.innerHTML = `今日心情：${m.emoji} ${m.label}${state.mood.text ? ' — “' + escapeHtml(state.mood.text) + '”' : ''}`;
  } else {
    box.innerHTML = '<span style="color:#b3a3c9">今天还没记录心情哦～</span>';
  }
}
function renderRewards() {
  const list = $('#rewardList');
  list.innerHTML = '';
  state.rewards.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'reward-item';
    const can = state.totalPoints >= r.cost;
    li.innerHTML = `
      <span class="r-emoji">${r.emoji}</span>
      <div class="r-info"><div class="r-name">${escapeHtml(r.name)}</div><div class="r-cost">需要 ${r.cost} 分</div></div>
      <button class="reward-btn" data-id="${r.id}" ${can ? '' : 'disabled'}>兑换</button>`;
    list.appendChild(li);
  });
  const rl = $('#redeemList');
  rl.innerHTML = '';
  if (!state.redeemed.length) rl.innerHTML = '<div class="empty-tip">还没有兑换记录～</div>';
  else [...state.redeemed].reverse().forEach((x) => {
    const li = document.createElement('li');
    li.className = 'redeem-item';
    li.textContent = `${x.emoji || '🎁'} ${x.name} · -${x.cost}分 · ${x.date}`;
    rl.appendChild(li);
  });
}
function renderAll() {
  renderHeader(); renderPet(); renderPlan(); renderSport();
  renderBooks(); renderMood(); renderRewards();
  syncReminderStatus();
}
function syncReminderStatus() {
  if (typeof AndroidApp === 'undefined' || !AndroidApp.setDayComplete) return;
  const ti = todayIndex();
  const complete = state.plan.length > 0 && state.plan.every((p) => p.done)
    && !!state.sport.week[ti]
    && state.mood.date === todayStr() && !!state.mood.mood;
  AndroidApp.setDayComplete(complete);
}

/* ---------- 周报 / 打卡表 ---------- */
function weekDates(anchor) {
  const now = anchor ? new Date(`${anchor}T12:00:00`) : new Date(trustedDateMs());
  const off = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - off);
  const arr = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); arr.push(fmtDate(d)); }
  return arr;
}
function buildReport(anchor, includeAudit = false) {
  const dates = weekDates(anchor);
  let planDone = 0, planTotal = 0, sport = 0, books = 0, points = 0, checkinPoints = 0, bonusPoints = 0, deductedPoints = 0;
  const moodCount = {};
  dates.forEach((d) => {
    const r = state.history[d]; if (!r) return;
    planDone += r.planDone; planTotal += r.planTotal;
    if (r.sport) sport++;
    books += r.books; points += r.points; checkinPoints += r.checkinPoints || r.points || 0; bonusPoints += r.bonusPoints || 0; deductedPoints += r.deductedPoints || 0;
    if (r.mood) moodCount[r.mood] = (moodCount[r.mood] || 0) + 1;
  });
  const weekBooks = state.books.filter((b) => dates.includes(b.date));
  const rate = planTotal ? Math.min(100, Math.round(planDone / planTotal * 100)) : 0;
  const lv = petLevel();
  const range = `${dates[0].slice(5).replace('-', '/')} - ${dates[6].slice(5).replace('-', '/')}`;
  const moodLine = Object.keys(moodCount).length
    ? Object.keys(moodCount).map((k) => `${MOOD_MAP[k].emoji}${MOOD_MAP[k].label}×${moodCount[k]}`).join('　')
    : '本周暂未记录心情';
  let praise;
  if (rate >= 90 && sport >= 5) praise = '太棒了！你是自律小达人，库洛米为你疯狂打 call 🌟';
  else if (rate >= 70) praise = '这周表现很棒，好习惯正在养成，继续保持！';
  else if (sport >= 3 || books >= 2) praise = '这周有亮点（运动/阅读很积极），下周一起完成更多计划吧 💪';
  else praise = '每一小步都是进步，下周我们慢慢来，库洛米陪你一起加油 💗';

  const auditSection = includeAudit ? `<div class="sec-title">🧾 家长与兑换操作记录</div>${state.audit.filter((x) => dates.includes((x.at || '').slice(0, 10))).slice(-50).map((x) => `<div class="book-line">${escapeHtml(x.at.slice(0, 16).replace('T', ' '))} · ${escapeHtml(x.actor)} · ${escapeHtml(x.type)}${x.detail ? ' · ' + escapeHtml(x.detail) : ''}${x.delta ? ' · ' + (x.delta > 0 ? '+' : '') + x.delta + '分' : ''}</div>`).join('') || '<div class="book-line">本周暂无操作记录</div>'}` : '';
  $('#reportBody').innerHTML = `
    <div class="sheet">
      <h2>📊 ${state.petName || '宝贝'} 的每周打卡报告</h2>
      <div class="sheet-sub">${range}　·　宠物 ${lv.name}（Lv.${lv.lv}）</div>
      <div class="sheet-grid">
        <div class="stat"><div class="num">${rate}%</div><div class="lbl">计划完成率（${planDone}/${planTotal}）</div></div>
        <div class="stat"><div class="num">${sport}</div><div class="lbl">运动打卡天数</div></div>
        <div class="stat"><div class="num">${books}</div><div class="lbl">读完整本书</div></div>
        <div class="stat"><div class="num">${points}</div><div class="lbl">本周净积分</div></div>
      </div>
      <div class="mood-line">打卡获得 ${checkinPoints} 分 · 家长额外奖励 ${bonusPoints} 分 · 扣回 ${deductedPoints} 分</div>
      <div class="sec-title">📚 本周读过的书</div>
      ${weekBooks.length ? weekBooks.map((b) => `<div class="book-line">📖 ${escapeHtml(b.name)}${b.pages ? '（' + escapeHtml(b.pages) + '页）' : ''}${b.note ? ' — ' + escapeHtml(b.note) : ''}</div>`).join('') : '<div class="book-line">本周还没有读书记录～</div>'}
      <div class="sec-title">💗 心情一览</div>
      <div class="mood-line">${moodLine}</div>
      <div class="praise">${praise}</div>
      ${auditSection}
      <div class="sign"><span>家长签字：＿＿＿＿＿</span><span>日期：＿＿＿＿＿</span></div>
    </div>`;
}
function buildSheet() {
  const dates = weekDates();
  const heads = WEEK_LABELS.map((w, i) => `<th>${w}${i === todayIndex() ? '·今' : ''}</th>`).join('');
  const sportRow = dates.map((d) => `<td>${state.history[d] && state.history[d].sport ? escapeHtml(state.history[d].sportType || '⚽') : '—'}</td>`).join('');
  const bookRow = dates.map((d) => { const n = state.history[d] ? state.history[d].books : 0; return `<td>${n || '—'}</td>`; }).join('');
  const moodRow = dates.map((d) => { const m = state.history[d] && state.history[d].mood; return `<td>${m ? MOOD_MAP[m].emoji : '—'}</td>`; }).join('');
  const planRow = dates.map((d) => { const r = state.history[d]; return `<td>${r ? r.planDone + '/' + r.planTotal : '—'}</td>`; }).join('');
  const lv = petLevel();
  const range = `${dates[0].slice(5).replace('-', '/')} - ${dates[6].slice(5).replace('-', '/')}`;
  const checklist = state.plan.map((p) => `<div class="book-line">☐ ${escapeHtml(p.text)}${p.done ? '　✔' : ''}</div>`).join('');
  const weekBooks = state.books.filter((b) => dates.includes(b.date));

  $('#sheetBody').innerHTML = `
    <div class="sheet">
      <h2>🌙 每周打卡表</h2>
      <div class="sheet-sub">${range}　·　${state.petName || '宝贝'} 的打卡表　·　可用积分 ${state.totalPoints}</div>
      <table>
        <tr><th>项目</th>${heads}</tr>
        <tr><td>运动打卡</td>${sportRow}</tr>
        <tr><td>读书(本)</td>${bookRow}</tr>
        <tr><td>今日心情</td>${moodRow}</tr>
        <tr><td>计划完成</td>${planRow}</tr>
      </table>
      <div class="sec-title">📝 今日计划清单（${state.planMode === 'weekend' ? '周末版' : '上学日版'}）</div>
      ${checklist}
      <div class="sec-title">📚 本周读书</div>
      ${weekBooks.length ? weekBooks.map((b) => `<div class="book-line">📖 ${escapeHtml(b.name)}${b.pages ? '（' + escapeHtml(b.pages) + '页）' : ''}</div>`).join('') : '<div class="book-line">本周还没有读书记录～</div>'}
      <div class="sign"><span>家长签字：＿＿＿＿＿</span><span>日期：＿＿＿＿＿</span></div>
    </div>`;
}

/* ---------- 小工具 ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pop(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;top:80px;transform:translateX(-50%);background:#fff;border:3px solid #2b2238;border-radius:16px;padding:10px 20px;font-family:inherit;color:#4a2f73;box-shadow:3px 4px 0 rgba(75,47,115,.25);z-index:99;animation:pop 1.6s ease forwards;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function confetti() {
  const box = $('#confetti');
  const colors = ['#ff9ecf', '#ffe08a', '#a9d8ff', '#b8f0d8', '#c9a9ff'];
  for (let i = 0; i < 28; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.3 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(c);
    setTimeout(() => c.remove(), 1700);
  }
}
function openModal(id) { $('#' + id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $('#' + id).classList.remove('open'); document.body.style.overflow = ''; }
function printCurrentView() {
  if (typeof AndroidApp !== 'undefined' && AndroidApp.printPage) AndroidApp.printPage();
  else window.print();
}
async function grantBonusPoints() {
  if (!(await parentGate('发放额外积分'))) return;
  const raw = window.prompt('请输入额外积分（1–1000 的整数）');
  if (raw === null) return;
  const amount = Number(raw.trim());
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) { pop('积分必须是 1–1000 的整数'); return; }
  const reason = window.prompt('请输入奖励原因（必填）');
  if (reason === null || !reason.trim()) { pop('奖励原因不能为空'); return; }
  if (!addPoints(amount, 'bonus', reason.trim())) return;
  pop(`家长额外奖励 +${amount} 分 ⭐`); confetti(); save(); renderAll();
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('#logoPet').innerHTML = kuromiLogoSVG();

  let dateTapCount = 0;
  let dateTapTimer = null;
  $('#dateChip').onclick = () => {
    dateTapCount++;
    clearTimeout(dateTapTimer);
    dateTapTimer = setTimeout(() => { dateTapCount = 0; }, 1800);
    if (dateTapCount >= 5) { dateTapCount = 0; setParentPassword(); }
  };
  let pointsPressTimer = null;
  const pointsChip = $('#totalPoints').closest('.points-chip');
  if (pointsChip) {
    pointsChip.addEventListener('pointerdown', () => { pointsPressTimer = setTimeout(() => { pointsPressTimer = null; grantBonusPoints(); }, 3000); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((event) => pointsChip.addEventListener(event, () => { if (pointsPressTimer) clearTimeout(pointsPressTimer); pointsPressTimer = null; }));
  }

  // 宠物改名
  $('#savePetName').onclick = () => {
    const v = $('#petNameInput').value.trim();
    if (!v) return;
    if (typeof networkWriteGate === 'function' && !networkWriteGate()) return;
    state.petName = v; save(); pop('宠物改名成功 💜');
  };

  // 模板切换
  $('#tmplToggle').onclick = async (e) => {
    const btn = e.target.closest('.tmpl-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.planMode) return;
    if (!(await parentGate('切换上学日 / 周末任务模板'))) return;
    if (typeof networkWriteGate === 'function' && !networkWriteGate()) return;
    state.plansByMode[state.planMode] = state.plan;
    state.planMode = mode;
    state.plan = state.plansByMode[mode];
    save(); renderAll();
  };

  // 每日计划
  $('#planList').onclick = async (e) => {
    const check = e.target.closest('.plan-check');
    const del = e.target.closest('.plan-del');
    if (check) {
      const p = state.plan.find((x) => x.id === check.dataset.id);
      if (!p) return;
      if (p.done && !(await parentGate('取消已完成计划'))) return;
      if (p.done) {
        if (p.credited && !subPoints(5, 'checkin', `计划：${p.text}`)) return;
        p.done = false; p.credited = false;
        const stat = dayRec().planStats[state.planMode]; if (stat) stat.done = Math.max(0, stat.done - 1);
      } else {
        if (!timeGate()) return;
        p.done = true;
        p.credited = addPoints(5, 'checkin', `计划：${p.text}`);
        if (!p.credited) { p.done = false; return; }
        const stat = dayRec().planStats[state.planMode]; if (stat) stat.done++;
        if (p.credited) { pop('完成计划 +5 分 ⭐'); confetti(); }
      }
      dayRec().planDone = Object.values(dayRec().planStats).reduce((n, x) => n + (x.done || 0), 0);
      save(); renderAll();
    } else if (del) {
      if (!(await parentGate('删除每日计划'))) return;
      const p = state.plan.find((x) => x.id === del.dataset.id);
      if (!p) return;
      if (p.done && p.credited && !subPoints(5, 'checkin', `删除计划：${p.text}`)) return;
      state.plan = state.plan.filter((x) => x.id !== del.dataset.id);
      state.plansByMode[state.planMode] = state.plan;
      const scope = window.prompt('删除范围：输入 1 仅今天，输入 2 永久修改模板', '1');
      if (scope === '2') state.templates[state.planMode] = state.plan.map((x) => x.text);
      ensureHistory(); save(); renderAll();
    }
  };
  $('#addPlanBtn').onclick = async () => {
    const v = $('#planInput').value.trim();
    if (!v) return;
    if (!(await parentGate('添加每日计划'))) return;
    const scope = window.prompt('添加范围：输入 1 仅今天，输入 2 永久修改模板', '1');
    state.plan.push({ id: uid(), text: v, done: false, credited: false });
    state.plansByMode[state.planMode] = state.plan;
    if (scope === '2') state.templates[state.planMode].push(v);
    $('#planInput').value = '';
    ensureHistory(); save(); renderPlan();
  };
  $('#planInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addPlanBtn').click(); });

  // 读书笔记
  $('#addBookBtn').onclick = () => {
    const name = $('#bookName').value.trim();
    if (!name) { pop('先写书名哦～'); return; }
    const pages = $('#bookPages').value.trim();
    const note = $('#bookNote').value.trim();
    if (!timeGate()) return;
    const normalized = name.replace(/\s+/g, '').toLocaleLowerCase();
    const rewardedToday = state.books.some((b) => b.date === todayStr() && b.name.replace(/\s+/g, '').toLocaleLowerCase() === normalized && b.credited !== false);
    const book = { id: uid(), name, pages, note, date: todayStr(), credited: !rewardedToday };
    state.books.push(book);
    dayRec().books++;
    if (!rewardedToday) addPoints(5, 'checkin', `读书：${name}`);
    $('#bookName').value = ''; $('#bookPages').value = ''; $('#bookNote').value = '';
    pop(rewardedToday ? '读书笔记已记录（今日同名书籍不重复奖励）📚' : '读书笔记 +5 分 📚'); if (!rewardedToday) confetti();
    save(); renderAll();
  };
  $('#bookList').onclick = async (e) => {
    const del = e.target.closest('.bi-del');
    if (del) {
      if (!(await parentGate('删除读书记录'))) return;
      const book = state.books.find((x) => x.id === del.dataset.id);
      if (!book) return;
      if (book.credited !== false && !subPoints(5, 'checkin', `删除读书记录：${book.name}`, book.date)) return;
      state.books = state.books.filter((x) => x.id !== del.dataset.id);
      const r = dayRec(book.date); r.books = Math.max(0, r.books - 1);
      audit('parent', '删除读书记录', book.name, 0);
      save(); renderAll();
    }
  };

  // 心情日记
  $('#saveMoodBtn').onclick = () => {
    if (!state.mood.mood) { pop('先选一个心情表情吧～'); return; }
    const already = state.mood.date === todayStr();
    state.mood.text = $('#moodText').value.trim();
    state.mood.date = todayStr();
    if (!already) { if (!addPoints(3, 'checkin', `心情：${state.mood.mood}`)) return; dayRec().mood = state.mood.mood; pop('记录心情 +3 分 💗'); confetti(); }
    else { dayRec().mood = state.mood.mood; }
    save(); renderAll();
  };

  // 奖励兑换
  $('#rewardList').onclick = (e) => {
    const btn = e.target.closest('.reward-btn');
    if (!btn || btn.disabled) return;
    const r = state.rewards.find((x) => x.id === btn.dataset.id);
    if (state.totalPoints < r.cost) return;
    if (!window.confirm(`确定使用 ${r.cost} 分兑换“${r.name}”吗？兑换后不可撤销。`)) return;
    if (!subPoints(r.cost, 'redeem', `奖励：${r.name}`)) return;
    state.redeemed.push({ name: r.name, cost: r.cost, emoji: r.emoji, date: todayStr() });
    pop(`兑换成功：${r.name} 🎉`); confetti();
    save(); renderAll();
  };

  // 周报 / 打卡表
  $('#reportBtn').onclick = () => { buildReport(); openModal('reportModal'); };
  let reportPressTimer = null;
  $('#reportBtn').addEventListener('pointerdown', () => {
    reportPressTimer = setTimeout(async () => {
      reportPressTimer = null;
      if (!(await parentGate('查看历史周报和家长操作记录'))) return;
      const monday = window.prompt('请输入要查看的周一日期（YYYY-MM-DD）');
      if (!monday || !/^\d{4}-\d{2}-\d{2}$/.test(monday)) { pop('日期格式不正确'); return; }
      const d = new Date(`${monday}T12:00:00`);
      if (Number.isNaN(d.getTime()) || d.getDay() !== 1) { pop('请输入周一日期'); return; }
      buildReport(monday, true); openModal('reportModal');
    }, 1200);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((event) => $('#reportBtn').addEventListener(event, () => { if (reportPressTimer) clearTimeout(reportPressTimer); reportPressTimer = null; }));
  $('#sheetBtn').onclick = () => { buildSheet(); openModal('sheetModal'); };
  $('#reportPrintBtn').onclick = printCurrentView;
  $('#sheetPrintBtn').onclick = printCurrentView;
  $$('[data-close]').forEach((b) => b.onclick = () => closeModal(b.dataset.close));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); }));

  // 分享链接
  $('#shareBtn').onclick = () => {
    const url = SHARE_URL || location.href;
    if (typeof AndroidApp !== 'undefined' && AndroidApp.shareText) {
      AndroidApp.shareText(url);
      return;
    }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => pop('链接已复制，去平板打开吧 🔗'), () => {});
    window.prompt('复制下面的链接，在平板或手机上打开：', url);
  };

  $('#inviteBtn').onclick = async () => {
    if (!isLoggedIn()) { pop('请先登录'); return; }
    const code = Cloud.inviteCode || await refreshInviteCode();
    if (!code) {
      pop('获取邀请码失败。请先在 Supabase 执行 docs/supabase-invite-migration.sql');
      return;
    }
    const text = `家庭邀请码：${code}\n其他家长注册时填写此码即可加入同一家庭。\n网页：${SHARE_URL}`;
    if (typeof AndroidApp !== 'undefined' && AndroidApp.shareText) {
      AndroidApp.shareText(text);
      return;
    }
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => pop(`邀请码已复制：${code}`), () => {});
    window.prompt('把邀请码发给其他家长（注册时填写）：', code);
  };

  // 重置
  $('#resetBtn').onclick = async () => {
    if (await parentGate('重置全部数据') && confirm('确定要清空所有打卡数据吗？积分和记录都会归零哦。')) {
      if (typeof networkWriteGate === 'function' && !networkWriteGate()) return;
      lsRemove();
      state = defaultState();
      if (typeof AndroidApp !== 'undefined' && AndroidApp.resetParentPassword) AndroidApp.resetParentPassword();
      save(); renderAll(); pop('已重置并同步到云端 ✨');
    }
  };

  // 备份 / 恢复（跨设备、跨环境的最终记忆保障）
  $('#backupBtn').onclick = exportBackup;
  $('#restoreBtn').onclick = () => $('#restoreInput').click();
  $('#restoreInput').onchange = (e) => {
    if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  };
}

/* ---------- 星空 ---------- */
function makeStars() {
  const sky = $('#sky');
  const chars = ['⭐', '💜', '🌙', '✨', '🍬'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    s.textContent = chars[i % chars.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = 8 + Math.random() * 10 + 's';
    s.style.animationDelay = -Math.random() * 12 + 's';
    s.style.fontSize = 12 + Math.random() * 16 + 'px';
    sky.appendChild(s);
  }
}

/* ---------- 启动 ---------- */
async function init() {
  if (typeof AndroidApp !== 'undefined') document.body.classList.add('android-app');
  bindAuthEvents();
  renderAuthConfigHint();
  bindEvents();
  makeStars();
  const authLogo = $('#authLogo');
  if (authLogo) authLogo.innerHTML = kuromiLogoSVG();

  Cloud._onStateFromCloud = (remoteState, updatedAt) => {
    Cloud._appliedAt = updatedAt || Cloud.lastRemoteUpdatedAt;
    applyCloudState(remoteState);
    renderAll();
    pop('已同步其他设备的最新数据 ☁️');
  };
  Cloud._onAuthChange = () => updateAccountChip();

  const cloud = await initCloud();
  if (cloudConfigured() && isLoggedIn()) {
    showAuthGate(false);
    await refreshInviteCode();
    await loadFromCloudOrDefault();
    Cloud._appliedAt = Cloud.lastRemoteUpdatedAt;
    updateAccountChip();
    renderAll();
  } else if (cloudConfigured()) {
    state = defaultState();
    migrateState();
    ensureHistory();
    showAuthGate(true);
    switchAuthTab('login');
    renderAll();
  } else {
    loadLocal();
    showAuthGate(true);
    switchAuthTab('login');
    setAuthMessage('请先配置 env.js 后再注册/登录', true);
    renderAll();
  }

  setInterval(async () => {
    if (!state) return;
    if (typeof isLoggedIn === 'function' && isLoggedIn() && isOnline()) {
      const applied = Cloud._appliedAt || Cloud.lastRemoteUpdatedAt;
      const remote = await pullChildState();
      if (remote.ok && !remote.empty && remote.state && remote.updatedAt && remote.updatedAt !== applied) {
        Cloud._appliedAt = remote.updatedAt;
        applyCloudState(remote.state);
        renderAll();
      } else if (remote.ok && remote.updatedAt) {
        Cloud._appliedAt = remote.updatedAt;
      }
    }
    if (state.date !== todayStr()) {
      if (typeof isLoggedIn === 'function' && isLoggedIn() && !networkWriteGate()) return;
      dailyReset(); ensureHistory(); save(); renderAll();
    } else if (state.sport.weekKey !== weekKey(new Date(trustedDateMs()))) {
      if (typeof isLoggedIn === 'function' && isLoggedIn() && !networkWriteGate()) return;
      resetWeekIfNeeded(); save(); renderSport();
    }
  }, 30000);
}
document.addEventListener('DOMContentLoaded', init);

/* 离开页面 / 切到后台时自动保存，避免漏存导致第二天没数据 */
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
window.addEventListener('pagehide', () => persist());
window.addEventListener('beforeunload', () => { persist(); });

const style = document.createElement('style');
style.textContent = '@keyframes pop{0%{opacity:0;transform:translate(-50%,-10px)}15%{opacity:1;transform:translate(-50%,0)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-8px)}}';
document.head.appendChild(style);
