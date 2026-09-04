/* 库洛米每日打卡 · 登录门禁 UI */
'use strict';

function showAuthGate(show) {
  const gate = $('#authGate');
  const appRoot = $('#appRoot');
  if (!gate) return;
  gate.hidden = !show;
  if (appRoot) appRoot.classList.toggle('blurred', !!show);
  document.body.classList.toggle('auth-locked', !!show);
}

function setAuthMessage(text, isError) {
  const el = $('#authMessage');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function switchAuthTab(mode) {
  const isLogin = mode === 'login';
  $('#authLoginPanel').hidden = !isLogin;
  $('#authRegisterPanel').hidden = isLogin;
  $$('.auth-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  setAuthMessage('');
}

function updateAccountChip() {
  const chip = $('#accountChip');
  if (!chip) return;
  if (isLoggedIn()) {
    chip.hidden = false;
    chip.textContent = `👤 ${Cloud.account || '已登录'}`;
    chip.title = '点击退出登录';
  } else {
    chip.hidden = true;
  }
}

async function handleAuthSubmit(mode) {
  if (!cloudConfigured()) {
    setAuthMessage('请先配置 web/js/env.js（从 env.example.js 复制）', true);
    return;
  }
  if (!Cloud.client) {
    setAuthMessage('云端初始化失败，请刷新重试', true);
    return;
  }
  const account = (mode === 'login' ? $('#loginAccount') : $('#registerAccount')).value.trim();
  const password = (mode === 'login' ? $('#loginPassword') : $('#registerPassword')).value;
  const password2 = mode === 'register' ? $('#registerPassword2').value : '';
  const inviteCode = mode === 'register' ? (($('#registerInvite') && $('#registerInvite').value) || '') : '';
  if (mode === 'register' && password !== password2) {
    setAuthMessage('两次输入的密码不一致', true);
    return;
  }

  const btn = mode === 'login' ? $('#loginSubmit') : $('#registerSubmit');
  btn.disabled = true;
  setAuthMessage(mode === 'login' ? '登录中…' : '注册中…');
  try {
    const result = mode === 'login'
      ? await cloudLogin(account, password)
      : await cloudRegister(account, password, inviteCode);
    if (!result.ok) {
      setAuthMessage(result.message || '失败', true);
      return;
    }
    setAuthMessage('成功！正在加载数据…');
    await loadFromCloudOrDefault();
    showAuthGate(false);
    updateAccountChip();
    renderAll();
    if (mode === 'login') pop('登录成功，数据已同步 ☁️');
    else if (result.joined) pop('已加入家庭，数据已同步 💜');
    else pop('注册成功，家庭已创建 💜');
  } catch (e) {
    setAuthMessage(String(e.message || e), true);
  } finally {
    btn.disabled = false;
  }
}

function bindAuthEvents() {
  $$('.auth-tab').forEach((btn) => {
    btn.onclick = () => switchAuthTab(btn.dataset.mode);
  });
  $('#loginSubmit').onclick = () => handleAuthSubmit('login');
  $('#registerSubmit').onclick = () => handleAuthSubmit('register');
  ['loginPassword', 'loginAccount'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit('login'); });
  });
  ['registerPassword2', 'registerAccount', 'registerPassword'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit('register'); });
  });
  const chip = $('#accountChip');
  if (chip) {
    chip.onclick = async () => {
      if (!isLoggedIn()) return;
      if (!window.confirm('确定退出登录吗？退出后需重新登录才能同步。')) return;
      await cloudLogout();
      updateAccountChip();
      showAuthGate(true);
      switchAuthTab('login');
      setAuthMessage('已退出，请重新登录');
    };
  }
}

function renderAuthConfigHint() {
  const hint = $('#authConfigHint');
  if (!hint) return;
  if (!cloudConfigured()) {
    hint.hidden = false;
    hint.innerHTML = '尚未配置云端密钥。请复制 <code>web/js/env.example.js</code> 为 <code>env.js</code>，填入 Supabase URL 与 anon key，并执行 <code>docs/supabase-schema.sql</code>。';
  } else {
    hint.hidden = true;
  }
}
