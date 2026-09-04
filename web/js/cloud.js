/* 库洛米每日打卡 · Supabase 登录与云同步 */
'use strict';

const KUROMI_EMAIL_DOMAIN = 'kuromi.local';
const ACCOUNT_RE = /^[a-zA-Z0-9_]{3,32}$/;
const SESSION_META_KEY = 'kuromi_cloud_meta';

const Cloud = {
  client: null,
  session: null,
  familyId: null,
  childId: null,
  account: null,
  lastRemoteUpdatedAt: null,
  syncStatus: 'idle', // idle | syncing | synced | error | offline
  _realtime: null,
  _persistQueue: Promise.resolve(),
  _onStateFromCloud: null,
  _onAuthChange: null
};

function cloudEnv() {
  return (typeof window !== 'undefined' && window.KUROMI_ENV) || {};
}

function cloudConfigured() {
  const env = cloudEnv();
  return !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY
    && !String(env.SUPABASE_URL).includes('YOUR_PROJECT')
    && !String(env.SUPABASE_ANON_KEY).includes('YOUR_ANON'));
}

function accountToEmail(account) {
  return `${String(account).trim().toLowerCase()}@${KUROMI_EMAIL_DOMAIN}`;
}

function emailToAccount(email) {
  if (!email) return '';
  const lower = String(email).toLowerCase();
  const suffix = `@${KUROMI_EMAIL_DOMAIN}`;
  if (lower.endsWith(suffix)) return lower.slice(0, -suffix.length);
  return lower.split('@')[0] || '';
}

function validateAccount(account) {
  const a = String(account || '').trim();
  if (!ACCOUNT_RE.test(a)) return '账号需为 3–32 位字母、数字或下划线';
  return '';
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 6) return '密码至少 6 位';
  if (p.length > 72) return '密码过长';
  return '';
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function setSyncStatus(status, detail) {
  Cloud.syncStatus = status;
  const el = document.getElementById('syncChip');
  if (!el) return;
  const map = {
    idle: '☁️ 云同步',
    syncing: '☁️ 同步中…',
    synced: '☁️ 已同步',
    error: '☁️ 同步失败',
    offline: '☁️ 离线',
    local: '💾 仅本地'
  };
  el.textContent = detail || map[status] || map.idle;
  el.dataset.status = status;
}

function saveSessionMeta() {
  try {
    sessionStorage.setItem(SESSION_META_KEY, JSON.stringify({
      familyId: Cloud.familyId,
      childId: Cloud.childId,
      account: Cloud.account,
      lastRemoteUpdatedAt: Cloud.lastRemoteUpdatedAt
    }));
  } catch (e) { /* ignore */ }
}

function loadSessionMeta() {
  try {
    const raw = sessionStorage.getItem(SESSION_META_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data) return;
    Cloud.familyId = data.familyId || null;
    Cloud.childId = data.childId || null;
    Cloud.account = data.account || null;
    Cloud.lastRemoteUpdatedAt = data.lastRemoteUpdatedAt || null;
  } catch (e) { /* ignore */ }
}

async function initCloud() {
  loadSessionMeta();
  if (!cloudConfigured()) {
    setSyncStatus('local', '☁️ 未配置云端');
    return { ok: false, reason: 'not_configured' };
  }
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    setSyncStatus('error', '☁️ 缺少 SDK');
    return { ok: false, reason: 'no_sdk' };
  }
  const env = cloudEnv();
  Cloud.client = supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  const { data } = await Cloud.client.auth.getSession();
  Cloud.session = data.session || null;
  if (Cloud.session) {
    Cloud.account = emailToAccount(Cloud.session.user.email);
    const boot = await ensureFamilyBootstrap();
    if (!boot.ok) return boot;
    await subscribeChildState();
    setSyncStatus(isOnline() ? 'synced' : 'offline');
  } else {
    setSyncStatus('idle', '☁️ 请登录');
  }

  Cloud.client.auth.onAuthStateChange(async (event, session) => {
    Cloud.session = session;
    if (session) Cloud.account = emailToAccount(session.user.email);
    else {
      Cloud.account = null;
      Cloud.familyId = null;
      Cloud.childId = null;
      Cloud.lastRemoteUpdatedAt = null;
      saveSessionMeta();
      stopChildStateRealtime();
    }
    if (typeof Cloud._onAuthChange === 'function') Cloud._onAuthChange(event, session);
  });

  window.addEventListener('online', () => {
    if (Cloud.session) setSyncStatus('synced');
  });
  window.addEventListener('offline', () => setSyncStatus('offline'));

  return { ok: true, loggedIn: !!Cloud.session };
}

function isLoggedIn() {
  return !!(Cloud.client && Cloud.session && Cloud.childId);
}

async function ensureFamilyBootstrap(displayName) {
  if (!Cloud.client || !Cloud.session) return { ok: false, reason: 'no_session' };
  const { data, error } = await Cloud.client.rpc('bootstrap_family', {
    p_display_name: displayName || Cloud.account || null
  });
  if (error) {
    console.error('bootstrap_family', error);
    setSyncStatus('error');
    return { ok: false, reason: error.message || 'bootstrap_failed' };
  }
  Cloud.familyId = data.family_id;
  Cloud.childId = data.child_id;
  saveSessionMeta();
  return { ok: true, created: !!data.created };
}

async function cloudRegister(account, password) {
  const aErr = validateAccount(account);
  if (aErr) return { ok: false, message: aErr };
  const pErr = validatePassword(password);
  if (pErr) return { ok: false, message: pErr };
  if (!isOnline()) return { ok: false, message: '需要联网才能注册' };
  if (!Cloud.client) return { ok: false, message: '云端未配置' };

  const email = accountToEmail(account);
  const { data, error } = await Cloud.client.auth.signUp({
    email,
    password,
    options: { data: { account: String(account).trim().toLowerCase() } }
  });
  if (error) return { ok: false, message: mapAuthError(error) };
  Cloud.session = data.session;
  if (!Cloud.session) {
    // 若仍要求确认邮箱，会没有 session
    return { ok: false, message: '注册成功但未登录。请在 Supabase 关闭 Confirm email 后重试登录。' };
  }
  Cloud.account = String(account).trim().toLowerCase();
  const boot = await ensureFamilyBootstrap(Cloud.account);
  if (!boot.ok) return { ok: false, message: '创建家庭失败：' + (boot.reason || '') };
  await seedCloudStateIfEmpty();
  await subscribeChildState();
  setSyncStatus('synced');
  return { ok: true };
}

async function cloudLogin(account, password) {
  const aErr = validateAccount(account);
  if (aErr) return { ok: false, message: aErr };
  if (!password) return { ok: false, message: '请输入密码' };
  if (!isOnline()) return { ok: false, message: '需要联网才能登录' };
  if (!Cloud.client) return { ok: false, message: '云端未配置' };

  const { data, error } = await Cloud.client.auth.signInWithPassword({
    email: accountToEmail(account),
    password
  });
  if (error) return { ok: false, message: mapAuthError(error) };
  Cloud.session = data.session;
  Cloud.account = String(account).trim().toLowerCase();
  const boot = await ensureFamilyBootstrap(Cloud.account);
  if (!boot.ok) return { ok: false, message: '加载家庭失败：' + (boot.reason || '') };
  await subscribeChildState();
  setSyncStatus('synced');
  return { ok: true };
}

async function cloudLogout() {
  stopChildStateRealtime();
  if (Cloud.client) await Cloud.client.auth.signOut();
  Cloud.session = null;
  Cloud.familyId = null;
  Cloud.childId = null;
  Cloud.account = null;
  Cloud.lastRemoteUpdatedAt = null;
  saveSessionMeta();
  setSyncStatus('idle', '☁️ 请登录');
}

function mapAuthError(error) {
  const msg = (error && error.message) || '操作失败';
  if (/already registered|User already registered/i.test(msg)) return '该账号已注册，请直接登录';
  if (/Invalid login credentials/i.test(msg)) return '账号或密码错误';
  if (/Email not confirmed/i.test(msg)) return '邮箱未确认：请在 Supabase 关闭 Confirm email';
  if (/rate limit|too many/i.test(msg)) return '尝试过于频繁，请稍后再试';
  return msg;
}

async function seedCloudStateIfEmpty() {
  const remote = await pullChildState();
  if (!remote.ok) return remote;
  if (remote.empty) {
    const initial = typeof defaultState === 'function' ? defaultState() : {};
    return pushChildState(initial);
  }
  return remote;
}

async function pullChildState() {
  if (!Cloud.client || !Cloud.childId) return { ok: false, reason: 'no_child' };
  if (!isOnline()) return { ok: false, reason: 'offline' };
  setSyncStatus('syncing');
  const { data, error } = await Cloud.client
    .from('child_state')
    .select('state_json, updated_at')
    .eq('child_id', Cloud.childId)
    .maybeSingle();
  if (error) {
    setSyncStatus('error');
    return { ok: false, reason: error.message };
  }
  if (!data) {
    setSyncStatus('synced');
    return { ok: true, empty: true };
  }
  Cloud.lastRemoteUpdatedAt = data.updated_at;
  saveSessionMeta();
  const json = data.state_json;
  const empty = !json || typeof json !== 'object' || !Object.keys(json).length
    || json.planMode === undefined;
  setSyncStatus('synced');
  return { ok: true, empty, state: empty ? null : json, updatedAt: data.updated_at };
}

async function pushChildState(nextState) {
  if (!Cloud.client || !Cloud.childId || !Cloud.familyId) return { ok: false, reason: 'no_child' };
  if (!isOnline()) {
    setSyncStatus('offline');
    return { ok: false, reason: 'offline' };
  }
  setSyncStatus('syncing');
  const updatedAt = new Date().toISOString();
  const { error } = await Cloud.client.from('child_state').upsert({
    child_id: Cloud.childId,
    family_id: Cloud.familyId,
    state_json: nextState,
    updated_at: updatedAt,
    updated_by: Cloud.session && Cloud.session.user ? Cloud.session.user.id : null
  }, { onConflict: 'child_id' });
  if (error) {
    console.error('pushChildState', error);
    setSyncStatus('error');
    return { ok: false, reason: error.message };
  }
  Cloud.lastRemoteUpdatedAt = updatedAt;
  saveSessionMeta();
  setSyncStatus('synced');
  return { ok: true, updatedAt };
}

function queuePushChildState(nextState) {
  Cloud._persistQueue = Cloud._persistQueue.then(() => pushChildState(nextState)).catch((e) => {
    console.error(e);
    return { ok: false, reason: String(e) };
  });
  return Cloud._persistQueue;
}

async function subscribeChildState() {
  stopChildStateRealtime();
  if (!Cloud.client || !Cloud.childId) return;
  Cloud._realtime = Cloud.client
    .channel(`child_state:${Cloud.childId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'child_state',
      filter: `child_id=eq.${Cloud.childId}`
    }, (payload) => {
      const row = payload.new;
      if (!row || !row.state_json) return;
      if (Cloud.lastRemoteUpdatedAt && row.updated_at <= Cloud.lastRemoteUpdatedAt) return;
      Cloud.lastRemoteUpdatedAt = row.updated_at;
      saveSessionMeta();
      if (typeof Cloud._onStateFromCloud === 'function') {
        Cloud._onStateFromCloud(row.state_json, row.updated_at);
      }
    })
    .subscribe();
}

function stopChildStateRealtime() {
  if (Cloud._realtime && Cloud.client) {
    Cloud.client.removeChannel(Cloud._realtime);
  }
  Cloud._realtime = null;
}

function networkWriteGate() {
  if (!cloudConfigured()) {
    pop('尚未配置云端：请复制 js/env.example.js 为 env.js 并填入 Supabase 信息');
    return false;
  }
  if (!isLoggedIn()) {
    pop('请先登录家长账号');
    showAuthGate(true);
    return false;
  }
  if (!isOnline()) {
    pop('需要联网才能打卡和修改哦');
    setSyncStatus('offline');
    return false;
  }
  return true;
}
