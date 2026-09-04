/* 库洛米每日打卡 · 本地持久化与备份 */
'use strict';

let state;
let storageMode = 'local'; // 'local' | 'idb' | 'none'

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function lsGet() { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } }
function lsSet(str) { try { localStorage.setItem(STORE_KEY, str); return true; } catch (e) { return false; } }
function lsRemove() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

/* IndexedDB 兜底：隐私模式 / 沙盒预览 / file:// 下 localStorage 可能不可用或被清空 */
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject('no-idb');
    let req; try { req = indexedDB.open('kuromi_checkin_db', 1); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch (e) {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet() {
  return new Promise((resolve) => {
    idbOpen().then((db) => {
      try {
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get('state');
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    }).catch(() => resolve(null));
  });
}
function idbSet(str) {
  return new Promise((resolve) => {
    idbOpen().then((db) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(str, 'state');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    }).catch(() => resolve(false));
  });
}

/* 本地缓存 + 云端立刻同步（登录后） */
async function persistLocalOnly() {
  const str = JSON.stringify(state);
  if (lsSet(str)) { storageMode = 'local'; }
  else { storageMode = (await idbSet(str)) ? 'idb' : 'none'; }
  if (storageMode === 'none') showStorageWarn();
  return storageMode !== 'none';
}

async function persist() {
  await persistLocalOnly();
  if (typeof isLoggedIn === 'function' && isLoggedIn()) {
    if (!isOnline()) {
      setSyncStatus('offline');
      return false;
    }
    const result = await queuePushChildState(state);
    return !!(result && result.ok);
  }
  return storageMode !== 'none';
}

function save() {
  if (typeof isLoggedIn === 'function' && isLoggedIn()) {
    if (!isOnline()) {
      pop('需要联网才能保存修改哦');
      setSyncStatus('offline');
      return;
    }
  }
  persist().then((ok) => {
    if (typeof isLoggedIn === 'function' && isLoggedIn()) {
      Cloud._appliedAt = Cloud.lastRemoteUpdatedAt;
      if (ok === false) pop('同步失败，请检查网络后重试');
    }
  });
}

function applyCloudState(remoteState) {
  state = remoteState && typeof remoteState === 'object' ? remoteState : defaultState();
  migrateState();
  if (state.date !== todayStr()) dailyReset();
  resetWeekIfNeeded();
  ensureHistory();
  persistLocalOnly();
}

async function loadFromCloudOrDefault() {
  if (typeof isLoggedIn === 'function' && isLoggedIn()) {
    const remote = await pullChildState();
    if (remote.ok && !remote.empty && remote.state) {
      applyCloudState(remote.state);
      return true;
    }
    if (remote.ok && remote.empty) {
      state = defaultState();
      migrateState();
      ensureHistory();
      await persist();
      return true;
    }
    pop('云端加载失败，请检查网络后重试');
    return false;
  }
  loadLocal();
  return true;
}

function loadLocal() {
  const raw = lsGet();
  if (raw) {
    state = safeParse(raw) || defaultState();
  } else {
    state = defaultState();
    idbGet().then((idbRaw) => {
      if (idbRaw && !lsGet()) {
        state = safeParse(idbRaw) || state;
        migrateState();
        if (state.date !== todayStr()) dailyReset();
        resetWeekIfNeeded();
        ensureHistory();
        if (typeof renderAll === 'function') renderAll();
        persistLocalOnly();
      }
    });
  }
  migrateState();
  if (state.date !== todayStr()) dailyReset();
  resetWeekIfNeeded();
  ensureHistory();
  persistLocalOnly();
}

function migrateState() {
  const def = defaultState();
  ['version','planMode','templates','costumes','history','books','redeemed','rewards','sport','mood','owned','date','petName','petType','totalPoints','lifetimePoints','audit','clock','plansByMode'].forEach((k) => {
    if (state[k] === undefined) state[k] = def[k];
  });
  state.version = APP_SCHEMA_VERSION;
  if (!state.templates || !state.templates.school) state.templates = def.templates;
  if (!state.costumes) state.costumes = def.costumes;
  if (!state.owned) state.owned = {};
  if (!state.history) state.history = {};
  if (!state.sport || !Array.isArray(state.sport.week)) state.sport = def.sport;
  state.sport.week = state.sport.week.map((x) => x === true ? (state.sport.selected || '跳绳') : (x || null));
  if (!state.sport.weekKey) state.sport.weekKey = weekKey(new Date());
  if (!state.plansByMode || !state.plansByMode.school || !state.plansByMode.weekend) state.plansByMode = { school: [], weekend: [] };
  if (!state.plansByMode.school.length && Array.isArray(state.plan) && state.plan.length) state.plansByMode[state.planMode] = state.plan;
  ['school', 'weekend'].forEach((mode) => {
    if (!Array.isArray(state.plansByMode[mode]) || !state.plansByMode[mode].length) {
      state.plansByMode[mode] = state.templates[mode].map((t) => ({ id: uid(), text: t, done: false, credited: false }));
    }
    state.plansByMode[mode] = state.plansByMode[mode].map((p) => ({ id: p.id || uid(), text: String(p.text || ''), done: !!p.done, credited: p.credited === undefined ? !!p.done : !!p.credited }));
  });
  state.plan = state.plansByMode[state.planMode];
  state.books = Array.isArray(state.books) ? state.books.map((b) => ({ ...b, credited: b.credited !== false })) : [];
  if (!Array.isArray(state.audit)) state.audit = [];
  if (!state.clock || typeof state.clock !== 'object') state.clock = def.clock;
}
function weekKey(d) { const x = new Date(d); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); return fmtDate(x); }
function resetWeekIfNeeded() {
  const key = weekKey(new Date());
  if (state.sport.weekKey !== key) {
    state.sport.weekKey = key;
    state.sport.week = [null, null, null, null, null, null, null];
  }
}
function dailyReset() {
  state.date = todayStr();
  const wd = new Date(trustedDateMs()).getDay();
  state.planMode = (wd === 0 || wd === 6) ? 'weekend' : 'school';
  state.plansByMode = { school: state.templates.school.map((t) => ({ id: uid(), text: t, done: false, credited: false })), weekend: state.templates.weekend.map((t) => ({ id: uid(), text: t, done: false, credited: false })) };
  state.plan = state.plansByMode[state.planMode];
  resetWeekIfNeeded();
  state.mood = { date: null, mood: null, text: '' };
}
function load() {
  // 兼容旧调用：云同步启用后请走 loadFromCloudOrDefault()
  loadLocal();
}

/* 手动备份 / 恢复（存储完全不可用时的最终保障，确保第二天不丢） */
function exportBackup() {
  const data = { app: 'kuromi_checkin', version: 2, exported: todayStr(), state };
  const fileName = `库洛米打卡备份_${todayStr()}.json`;
  if (typeof AndroidApp !== 'undefined' && AndroidApp.saveBackup) {
    AndroidApp.saveBackup(JSON.stringify(data, null, 2), fileName);
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  pop('已下载备份文件，请妥善保存 💾');
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const s = data && data.state ? data.state : data;
      if (!s || typeof s !== 'object' || !('planMode' in s) || !('templates' in s)) throw new Error('bad');
      if (!(await parentGate('恢复备份并替换当前数据'))) return;
      if (typeof networkWriteGate === 'function' && !networkWriteGate()) return;
      if (!window.confirm('恢复备份会替换当前所有数据，确定继续吗？')) return;
      state = s;
      const def = defaultState();
      ['templates','costumes','history','books','redeemed','rewards','sport','mood','owned','date','petName','petType','totalPoints','lifetimePoints','planMode'].forEach((k) => { if (state[k] === undefined) state[k] = def[k]; });
      if (!Array.isArray(state.plan) || !state.plan.length) state.plan = state.templates[state.planMode].map((t) => ({ id: uid(), text: t, done: false }));
      delete state.parentHash;
      migrateState();
      audit('parent', '恢复备份', '替换当前数据', 0);
      save(); renderAll();
      pop('数据已恢复并同步到云端 💜');
    } catch (e) {
      pop('备份文件无法识别，请确认是导出的 JSON 哦');
    }
  };
  reader.readAsText(file);
}
function showStorageWarn() {
  const b = $('#storageBanner');
  if (b) b.hidden = false;
}
