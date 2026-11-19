import crypto from 'node:crypto';
import { query, one, tx, audit } from './db.js';
import { HttpError, bad, forbidden, getIp } from './http.js';
import { sendMail, buildOtpEmail } from './mail.js';

// Giống MANAGER_AUTH trong ManagerAuth.gs
export const AUTH = Object.freeze({ otpMinutes: 5, sessionHours: 8, maxAttempts: 5, resendSeconds: 60 });
const COOKIE = 'goals_sid';
const GENERIC = 'Nếu email đủ điều kiện, mã xác nhận sẽ được gửi tới hộp thư.';
const INVALID = 'Mã không hợp lệ hoặc đã hết hạn.';

const domain = () => String(process.env.ALLOWED_EMAIL_DOMAIN || 'fpt.com').toLowerCase();
export const normalizeEmail = (v) => String(v || '').trim().toLowerCase();
export const isCompanyEmail = (e) => e.length <= 254 && e.endsWith('@' + domain()) && /^[^\s@]+@[^\s@]+$/.test(e);

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET chưa cấu hình (tối thiểu 32 ký tự)');
  return s;
}
const hmac = (v) => crypto.createHmac('sha256', secret()).update(String(v)).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Được đăng nhập: Role = Manager hoặc isHR (giống authUserByEmail_ + điều kiện cũ). */
export const canLogin = (u) => u && u.active && (u.role === 'Manager' || u.is_hr);

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((p) => p.trim()).filter(Boolean)
    .map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
}
const setCookie = (res, token, maxAge) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);

export const publicUser = (u) => u && ({
  email: u.email, name: u.full_name, department: u.department, team: u.team, role: u.role,
  isManager: u.role === 'Manager', isHR: !!u.is_hr, isAdmin: !!u.is_admin,
});

// ------------------------------------------------------------ requestManagerOtp
export async function requestOtp(emailInput, ip) {
  const email = normalizeEmail(emailInput);
  if (!isCompanyEmail(email)) return { message: GENERIC };       // không tiết lộ email hợp lệ hay không

  const user = await one('SELECT * FROM users WHERE email = $1', [email]);
  if (!canLogin(user)) return { message: GENERIC };

  const latest = await one('SELECT * FROM otp_challenges WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
  if (latest && Date.now() - new Date(latest.created_at).getTime() < AUTH.resendSeconds * 1000) {
    const usable = !latest.used_at && new Date(latest.expires_at) > new Date();
    return usable
      ? { challengeId: latest.id, message: 'Mã đã gửi gần đây vẫn còn hiệu lực. Vui lòng dùng mã trong email trước đó.' }
      : { message: 'Vui lòng đợi ít phút trước khi yêu cầu mã mới.' };
  }
  const recent = await one(`SELECT count(*)::int AS n FROM otp_challenges WHERE email = $1 AND created_at > now() - interval '15 minutes'`, [email]);
  if (recent.n >= 5) return { message: 'Anh/Chị đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 15 phút.' };

  const challengeId = crypto.randomUUID();
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await tx(async (t) => {
    await t.query('UPDATE otp_challenges SET used_at = now() WHERE email = $1 AND used_at IS NULL', [email]); // OTP cũ mất hiệu lực
    await t.query(
      `INSERT INTO otp_challenges (id, email, code_hash, expires_at, ip) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval, $5)`,
      [challengeId, email, hmac(`${challengeId}:${otp}`), String(AUTH.otpMinutes), ip || null]);
  });

  try {
    const m = buildOtpEmail(otp);
    await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html, meta: { otp } });
  } catch (e) {
    console.error('Gửi OTP lỗi:', e);
    await query('UPDATE otp_challenges SET used_at = now() WHERE id = $1', [challengeId]);
    throw new HttpError(502, 'MAIL_FAILED', 'Chưa gửi được mã. Vui lòng thử lại.');
  }
  return { challengeId, message: GENERIC };
}

// ------------------------------------------------------------ verifyManagerOtp
export async function verifyOtp(challengeIdInput, codeInput, req, res) {
  const challengeId = String(challengeIdInput || '').trim();
  const code = String(codeInput || '').trim();
  if (!/^[a-f0-9-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) throw bad('OTP_INVALID', 'Mã xác nhận không hợp lệ.');

  const row = await one('SELECT * FROM otp_challenges WHERE id = $1', [challengeId]);
  if (!row || row.used_at || new Date(row.expires_at) <= new Date() || row.attempts >= AUTH.maxAttempts) throw bad('OTP_INVALID', INVALID);
  const newer = await one('SELECT 1 FROM otp_challenges WHERE email = $1 AND id <> $2 AND created_at > $3', [row.email, row.id, row.created_at]);
  if (newer) throw bad('OTP_INVALID', INVALID);

  if (!safeEqual(row.code_hash, hmac(`${challengeId}:${code}`))) {
    await query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw bad('OTP_INVALID', INVALID);
  }
  const used = await one('UPDATE otp_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id]);
  if (!used) throw bad('OTP_INVALID', INVALID);

  const user = await one('SELECT * FROM users WHERE email = $1', [row.email]);
  if (!canLogin(user)) throw forbidden('Tài khoản không còn quyền truy cập FPT Play Goals.');

  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [hmac(token), user.id, String(AUTH.sessionHours), String(req.headers['user-agent'] || '').slice(0, 300), getIp(req) || null]);
  setCookie(res, token, AUTH.sessionHours * 3600);
  await audit(user.id, 'LOGIN', 'user', user.id);
  return { ...publicUser(user), message: 'Đã xác minh email.' };
}

// ------------------------------------------------------------ checkMyAccess
export async function getUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = await one(
    `SELECT u.*, s.token_hash, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [hmac(token)]);
  // Kiểm tra lại Users mỗi lần: bị khóa / bỏ quyền thì phiên còn hạn cũng không dùng được
  if (!row || !canLogin(row)) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [row.token_hash]);
  }
  return row;
}

export async function requireUser(req) {
  const u = await getUser(req);
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn. Vui lòng nhận mã xác nhận mới.');
  return u;
}
export async function requireManager(req) {
  const u = await requireUser(req);
  if (u.role !== 'Manager') throw forbidden('Tài khoản không có quyền Manager.');
  return u;
}
export async function requireHR(req) {
  const u = await requireUser(req);
  if (!u.is_hr) throw forbidden('Tài khoản không có quyền xem tổng hợp.');
  return u;
}

export async function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hmac(token)]);
  setCookie(res, '', 0);
}
