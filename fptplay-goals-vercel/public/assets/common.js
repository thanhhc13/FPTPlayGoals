// Dùng chung cho Cổng Manager & Trang HR – FPT Play Goals
export const EMAIL_DOMAIN = 'fpt.com';

export async function api(action, { method = 'GET', body, query, base = '/api/manager' } = {}) {
  const qs = new URLSearchParams({ action, ...(query || {}) });
  let r;
  try {
    r = await fetch(`${base}?${qs}`, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.'), { code: 'NETWORK' });
  }
  let j;
  try { j = await r.json(); } catch { j = { ok: false, message: `Lỗi máy chủ (${r.status}).` }; }
  if (!j.ok) throw Object.assign(new Error(j.message || 'Có lỗi xảy ra.'), { code: j.error, status: r.status });
  return j.data;
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="ell" title="$1">$1</a>');
export const makeId = (p) => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`);

/** 2.666666 → "2,6667"; 8 → "8"; null → "—" */
export const fmtPts = (v) => {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
  return String(Number(Number(v).toFixed(4))).replace('.', ',');
};
const TZ = { timeZone: 'Asia/Ho_Chi_Minh' };
export const fmtDT = (d) => (d ? new Date(d).toLocaleString('vi-VN', { ...TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export const GROUPS = ['Must', 'Should', 'Could'];
export const GROUP_POINTS = { Must: 8, Should: 1.5, Could: 0.5 };
export const GROUP_INFO = {
  Must: { label: 'MUST', title: 'Mục tiêu bắt buộc · tối đa 8 điểm', hint: '(tối thiểu 2 mục tiêu)' },
  Should: { label: 'SHOULD', title: 'Nâng cao hiệu quả · tối đa 1,5 điểm', hint: '(không bắt buộc)' },
  Could: { label: 'COULD', title: 'Tạo giá trị gia tăng · tối đa 0,5 điểm', hint: '(không bắt buộc · cần BĐH xác nhận)' },
};

export function rankFromScore(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score)) || score < 0 || score > 10) return null;
  const s = Number(Number(score).toFixed(4));
  if (s >= 10) return { rank: 'A+', coefficient: '1,4' };
  if (s >= 9.7) return { rank: 'A', coefficient: '1,3' };
  if (s >= 9.4) return { rank: 'B+', coefficient: '1,2' };
  if (s >= 9.0) return { rank: 'B', coefficient: '1,1' };
  if (s >= 8.0) return { rank: 'C', coefficient: '1,0' };
  if (s >= 7.5) return { rank: 'D', coefficient: '0,8' };
  return { rank: 'E', coefficient: '0,6' };
}

/** Ô nhập dài: tự giãn tối đa ~8 dòng rồi cuộn + đếm ký tự. */
export function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 200) + 'px'; };
  const cnt = ta.nextElementSibling?.classList.contains('cnt') ? ta.nextElementSibling : null;
  const count = () => { if (cnt) cnt.textContent = `${ta.value.length}/${ta.maxLength} ký tự`; };
  ta.addEventListener('input', () => { fit(); count(); });
  requestAnimationFrame(fit); count();
}

/** Nút Xem đầy đủ / Thu gọn cho đoạn văn bị cắt 3 dòng. */
export function bindClamp(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]'); if (!b) return;
    const box = b.previousElementSibling;
    const open = box.classList.toggle('clamp') === false;
    b.textContent = open ? 'Thu gọn ▴' : 'Xem đầy đủ ▾';
  });
  requestAnimationFrame(() => $$('[data-more]', root).forEach((b) => {
    const box = b.previousElementSibling;
    if (box.scrollHeight <= box.clientHeight + 2) b.remove(); // ngắn → không cần nút
  }));
}
export const clampHtml = (text) => text ? `<div class="muted small clamp pre">${esc(text)}</div><button type="button" class="more" data-more>Xem đầy đủ ▾</button>` : '';

// ---------------------------------------------------------------- UI helpers
export function toast(msg, type = 'ok', ms = 4500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  const html = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${html}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}
export function modal({ title, body, footer = '', size = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="mh"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Đóng">×</button></div>
    <div class="mb">${body}</div>${footer ? `<div class="mf">${footer}</div>` : ''}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  return { el: bg, close };
}
function waitClose(m, resolveFn) {
  new MutationObserver((_, o) => { if (!document.body.contains(m.el)) { o.disconnect(); resolveFn(); } }).observe(document.body, { childList: true });
}
export function confirmBox(message, { ok = 'Xác nhận', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title: 'Xác nhận', body: `<p style="margin:0">${message}</p>`,
      footer: `<button class="btn" data-close>Hủy</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(ok)}</button>` });
    let done = false;
    $('#cf-ok', m.el).onclick = () => { done = true; m.close(); resolve(true); };
    waitClose(m, () => { if (!done) resolve(false); });
  });
}
export function promptBox(title, label, { required = true, ok = 'Gửi', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<label class="f">${esc(label)}</label><textarea id="pb-v" rows="4" maxlength="2000" placeholder="${esc(placeholder)}"></textarea>`,
      footer: `<button class="btn" data-close>Hủy</button><button class="btn primary" id="pb-ok">${esc(ok)}</button>` });
    let done = false;
    const ta = $('#pb-v', m.el); ta.focus();
    $('#pb-ok', m.el).onclick = () => {
      const v = ta.value.trim();
      if (required && !v) { ta.classList.add('err'); return; }
      done = true; m.close(); resolve(v);
    };
    waitClose(m, () => { if (!done) resolve(null); });
  });
}

// ---------------------------------------------------------------- Đăng nhập OTP (requestManagerOtp / verifyManagerOtp)
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
export function renderLogin(root, { subtitle, onDone, message = '' }) {
  root.innerHTML = `<div class="login"><div class="box">
    <div class="logo"><i>FPT</i><div>FPT Play Goals<div class="muted small" style="font-weight:400">${esc(subtitle)}</div></div></div>
    <div id="lg-msg" class="alert info" style="margin:0 0 14px">${esc(message || 'Vui lòng xác minh email để tiếp tục.')}</div>
    <form id="lg-email">
      <label class="f" for="lg-e">Email công ty</label>
      <input id="lg-e" type="email" autocomplete="email" required placeholder="Acc email @${EMAIL_DOMAIN}">
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px">Gửi mã xác nhận</button>
    </form>
    <form id="lg-otp" class="hidden">
      <label class="f" for="lg-c">Mã xác nhận (6 chữ số) gửi tới <b id="lg-to"></b></label>
      <input id="lg-c" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px">Xác minh</button>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <button type="button" class="btn link" id="lg-back">← Dùng email khác</button>
        <button type="button" class="btn link" id="lg-resend">Gửi lại mã</button>
      </div>
    </form></div></div>`;
  const fE = $('#lg-email', root), fO = $('#lg-otp', root), msg = $('#lg-msg', root);
  const inE = $('#lg-e', root), inC = $('#lg-c', root), resend = $('#lg-resend', root);
  let challengeId = '', timer;
  inE.value = store.get('goals_email') || '';
  inE.focus();
  const show = (t, type = 'info') => { msg.className = `alert ${type}`; msg.textContent = t; };
  const cooldown = (s) => {
    clearInterval(timer); resend.disabled = true;
    const tick = () => { resend.textContent = s > 0 ? `Gửi lại mã (${s}s)` : 'Gửi lại mã'; if (s-- <= 0) { clearInterval(timer); resend.disabled = false; } };
    tick(); timer = setInterval(tick, 1000);
  };
  const send = (btn) => busy(btn, async () => {
    const email = inE.value.trim().toLowerCase();
    if (!new RegExp(`^[^\\s@]+@${EMAIL_DOMAIN.replace('.', '\\.')}$`).test(email)) return show(`Vui lòng nhập email công ty @${EMAIL_DOMAIN}.`, 'err');
    show('Đang gửi mã…');
    try {
      const r = await api('request-otp', { method: 'POST', body: { email }, base: '/api/auth' });
      show(r.message, r.challengeId ? 'info' : 'warn');
      if (!r.challengeId) return;
      challengeId = r.challengeId;
      store.set('goals_email', email);
      $('#lg-to', root).textContent = email;
      fE.classList.add('hidden'); fO.classList.remove('hidden'); inC.value = ''; inC.focus();
      cooldown(60);
    } catch (e) { show(e.message, 'err'); }
  });
  fE.onsubmit = (e) => { e.preventDefault(); send(fE.querySelector('button')); };
  resend.onclick = () => send(resend);
  $('#lg-back', root).onclick = () => { fO.classList.add('hidden'); fE.classList.remove('hidden'); show('Vui lòng nhập email công ty để tiếp tục.'); };
  inC.oninput = () => { inC.value = inC.value.replace(/\D/g, ''); if (inC.value.length === 6) fO.requestSubmit(); };
  fO.onsubmit = (e) => {
    e.preventDefault();
    busy(fO.querySelector('button.primary'), async () => {
      if (!/^\d{6}$/.test(inC.value)) return show('Mã xác nhận gồm 6 chữ số.', 'err');
      show('Đang xác minh mã…');
      try {
        const user = await api('verify-otp', { method: 'POST', body: { challengeId, code: inC.value }, base: '/api/auth' });
        clearInterval(timer); onDone(user);
      } catch (err) { show(err.message, 'err'); inC.select(); }
    });
  };
}

export async function logout() {
  try { await api('logout', { method: 'POST', base: '/api/auth' }); } catch { /* ignore */ }
  location.reload();
}

export function topbar(user, subtitle, extra = '') {
  return `<header class="topbar"><div class="in">
    <div class="logo"><i>FPT</i><div>FPT Play Goals<div class="muted small" style="font-weight:400">${esc(subtitle)}</div></div></div>
    <div class="sp"></div>${extra}
    <div class="who"><b>${esc(user.name || user.email)}</b><span>${esc([user.department, user.email].filter(Boolean).join(' · '))}</span></div>
    <button class="btn sm" id="btn-logout">Đổi tài khoản</button>
  </div></header>`;
}
