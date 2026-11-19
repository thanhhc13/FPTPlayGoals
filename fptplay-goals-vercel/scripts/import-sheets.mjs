// Chuyển dữ liệu từ Google Sheet FPT Play Goals sang Postgres.
// Trên Sheet: chọn từng tab → File → Download → Comma-separated values (.csv).
//
//   node --env-file=.env scripts/import-sheets.mjs \
//     --users Users.csv --periods KPIPeriods.csv \
//     --plans ManagerPlanVersions.csv --results ManagerResultVersions.csv [--dry-run]
//
// Cột được đọc đúng theo tên tiêu đề như Code.gs (Email, Họ tên, Phòng, Nhóm, Role, isHR, Kì KPI, ...).
// CC lấy cột N (vị trí 14) của tab Users. Chạy lại nhiều lần an toàn: bản ghi đã có sẽ được bỏ qua / cập nhật.
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { getPool } from '../lib/db.js';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');
const pool = DRY ? null : getPool();
const q = (t, p) => pool.query(t, p).then((r) => r.rows);
const warns = [];
const warn = (m) => { warns.push(m); console.warn('  ⚠ ' + m); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normEmail = (v) => String(v || '').trim().toLowerCase();

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
async function readTable(file, required) {
  const [header, ...rows] = parseCsv(await readFile(file, 'utf8'));
  const h = header.map((x) => String(x).trim());
  for (const name of required) {
    const n = h.filter((x) => x === name).length;
    if (n !== 1) throw new Error(`${file}: thiếu hoặc trùng cột "${name}". Tiêu đề hiện có: ${h.join(' | ')}`);
  }
  return { header: h, rows: rows.map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? '').trim()]))), raw: rows };
}
const toDate = (v) => { const d = new Date(v); return v && !Number.isNaN(+d) ? d : null; };

// ------------------------------------------------------------------ Users
async function importUsers(file) {
  const t = await readTable(file, ['Email', 'Họ tên', 'Phòng', 'Nhóm', 'Role', 'isHR']);
  let n = 0;
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i], raw = t.raw[i];
    const email = normEmail(r.Email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { warn(`Users dòng ${i + 2}: email không hợp lệ "${r.Email}" – bỏ qua`); continue; }
    const cc = String(raw[13] || '').split(/[,;\s]+/).map(normEmail).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e !== email);
    const activeCol = ['Active', 'Trạng thái'].find((k) => k in r);
    const active = activeCol ? !/^(0|false|no|inactive|nghỉ|khóa|đã nghỉ)$/i.test(r[activeCol]) : true;
    const extra = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ''));
    const vals = [email, r['Họ tên'], r['Phòng'], r['Nhóm'], r.Role || '', r.isHR.toLowerCase() === 'x', [...new Set(cc)], active, JSON.stringify(extra)];
    n++;
    if (DRY) { if (n <= 5) console.log('   ', vals.slice(0, 8)); continue; }
    await q(`INSERT INTO users (email, full_name, department, team, role, is_hr, cc_emails, active, extra) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, department=EXCLUDED.department, team=EXCLUDED.team, role=EXCLUDED.role,
               is_hr = users.is_hr OR EXCLUDED.is_hr, cc_emails=EXCLUDED.cc_emails, active=EXCLUDED.active, extra=EXCLUDED.extra, updated_at=now()`, vals);
  }
  console.log(`✔ Users: ${n} dòng${DRY ? ' (dry-run)' : ''}`);
}

// ------------------------------------------------------------------ KPIPeriods
async function importPeriods(file) {
  const t = await readTable(file, ['Kì KPI', 'Tên kỳ', 'Trạng thái kỳ', 'Giai đoạn']);
  const open = t.rows.filter((r) => r['Trạng thái kỳ'].toUpperCase() === 'OPEN');
  if (open.length > 1) throw new Error('KPIPeriods có nhiều hơn một kỳ OPEN – sửa trên Sheet trước khi import.');
  let n = 0;
  for (const [i, r] of t.rows.entries()) {
    const id = r['Kì KPI'];
    if (!id) { warn(`KPIPeriods dòng ${i + 2}: thiếu mã kỳ – bỏ qua`); continue; }
    const st = r['Trạng thái kỳ'].toUpperCase();
    const status = ['OPEN', 'CLOSED'].includes(st) ? st : 'DRAFT';
    const phase = r['Giai đoạn'].toUpperCase() === 'RESULT' ? 'RESULT' : 'PLAN';
    if (!['PLAN', 'RESULT'].includes(r['Giai đoạn'].toUpperCase())) warn(`KPIPeriods ${id}: Giai đoạn "${r['Giai đoạn']}" không phải PLAN/RESULT → PLAN`);
    n++;
    if (DRY) { console.log('   ', [id, r['Tên kỳ'], status, phase]); continue; }
    if (status === 'OPEN') await q(`UPDATE kpi_periods SET status = 'CLOSED' WHERE status = 'OPEN' AND id <> $1`, [id]);
    await q(`INSERT INTO kpi_periods (id, name, status, phase, created_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' milliseconds')::interval)
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, phase=EXCLUDED.phase, updated_at=now()`,
    [id, r['Tên kỳ'] || id, status, phase, String(i)]);
  }
  console.log(`✔ KPIPeriods: ${n} dòng${DRY ? ' (dry-run)' : ''}`);
}

// ------------------------------------------------------------------ helpers cho Versions
const userCache = new Map();
async function userIdFor(email, name, dept) {
  if (userCache.has(email)) return userCache.get(email);
  let u = (await q('SELECT id FROM users WHERE email = $1', [email]))[0];
  if (!u) {
    warn(`Email ${email} có dữ liệu KPI nhưng không có trong Users → tạo tài khoản ĐÃ KHÓA để giữ lịch sử`);
    u = (await q(`INSERT INTO users (email, full_name, department, role, active) VALUES ($1,$2,$3,'Manager',false) RETURNING id`, [email, name || '', dept || '']))[0];
  }
  userCache.set(email, u.id);
  return u.id;
}
const idMap = new Map(); // VersionID cũ → uuid mới (nếu VersionID không phải UUID)
const mapId = (v) => { if (UUID_RE.test(v)) return v.toLowerCase(); if (!idMap.has(v)) idMap.set(v, crypto.randomUUID()); return idMap.get(v); };
const mail = (r) => [['', 'PENDING', 'PROCESSING', 'SENT', 'FAILED'].includes(r.MailStatus) ? r.MailStatus : '', toDate(r.MailSentAt), r.MailLastError || ''];

// ------------------------------------------------------------------ ManagerPlanVersions
async function importPlans(file) {
  const t = await readTable(file, ['VersionID', 'RequestID', 'Kì KPI', 'Email', 'Họ tên', 'Phòng', 'Status', 'SavedAt', 'TasksJSON', 'MailStatus', 'MailSentAt', 'MailLastError']);
  const seen = new Set(); let n = 0, skip = 0;
  for (const [i, r] of t.rows.entries()) {
    const line = `ManagerPlanVersions dòng ${i + 2}`;
    const email = normEmail(r.Email);
    let tasks;
    try { tasks = JSON.parse(r.TasksJSON); if (!Array.isArray(tasks)) throw 0; } catch { warn(`${line}: TasksJSON lỗi – bỏ qua`); skip++; continue; }
    if (!['DRAFT', 'SUBMITTED'].includes(r.Status)) { warn(`${line}: Status "${r.Status}" lạ – bỏ qua`); skip++; continue; }
    const key = `${r['Kì KPI']}|${email}`;
    if (r.Status === 'SUBMITTED') {
      if (seen.has(key)) { warn(`${line}: ${email} có nhiều bản SUBMITTED kỳ ${r['Kì KPI']} – chỉ giữ bản đầu, cần HR đối soát`); skip++; continue; }
      seen.add(key);
    }
    n++;
    if (DRY) continue;
    const uid = await userIdFor(email, r['Họ tên'], r['Phòng']);
    await q(`INSERT INTO plan_versions (id, request_id, period_id, user_id, full_name, department, revision, status, saved_at, tasks, mail_status, mail_sent_at, mail_last_error)
             VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [mapId(r.VersionID), r.RequestID || `legacy-${r.VersionID}`, r['Kì KPI'], uid, r['Họ tên'], r['Phòng'], r.Status,
      toDate(r.SavedAt) || new Date(), JSON.stringify(tasks), ...mail(r)]);
  }
  console.log(`✔ ManagerPlanVersions: ${n} dòng${DRY ? ' (dry-run)' : ''}, bỏ qua ${skip}`);
}

// ------------------------------------------------------------------ ManagerResultVersions
async function importResults(file) {
  const t = await readTable(file, ['VersionID', 'RequestID', 'PlanVersionID', 'Kì KPI', 'Email', 'Status', 'SavedAt', 'ResultsJSON', 'TotalScore', 'MailStatus', 'MailSentAt', 'MailLastError']);
  const seen = new Set(); let n = 0, skip = 0;
  for (const [i, r] of t.rows.entries()) {
    const line = `ManagerResultVersions dòng ${i + 2}`;
    const email = normEmail(r.Email);
    let results;
    try { results = JSON.parse(r.ResultsJSON); if (!Array.isArray(results)) throw 0; } catch { warn(`${line}: ResultsJSON lỗi – bỏ qua`); skip++; continue; }
    if (!['DRAFT', 'SUBMITTED'].includes(r.Status)) { warn(`${line}: Status "${r.Status}" lạ – bỏ qua`); skip++; continue; }
    const key = `${r['Kì KPI']}|${email}`;
    if (r.Status === 'SUBMITTED') {
      if (seen.has(key)) { warn(`${line}: ${email} có nhiều báo cáo SUBMITTED – chỉ giữ bản đầu`); skip++; continue; }
      seen.add(key);
    }
    n++;
    if (DRY) continue;
    const planId = mapId(r.PlanVersionID);
    if (!(await q('SELECT 1 FROM plan_versions WHERE id = $1', [planId])).length) { warn(`${line}: PlanVersionID ${r.PlanVersionID} không tồn tại – bỏ qua`); n--; skip++; continue; }
    const uid = await userIdFor(email);
    const score = r.TotalScore === '' ? null : Number(String(r.TotalScore).replace(',', '.'));
    await q(`INSERT INTO result_versions (id, request_id, plan_version_id, period_id, user_id, revision, status, saved_at, results, total_score, mail_status, mail_sent_at, mail_last_error)
             VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [mapId(r.VersionID), r.RequestID || `legacy-${r.VersionID}`, planId, r['Kì KPI'], uid, r.Status, toDate(r.SavedAt) || new Date(),
      JSON.stringify(results), Number.isFinite(score) ? score : null, ...mail(r)]);
  }
  console.log(`✔ ManagerResultVersions: ${n} dòng${DRY ? ' (dry-run)' : ''}, bỏ qua ${skip}`);
}

try {
  if (!['--users', '--periods', '--plans', '--results'].some(arg)) {
    console.log('Cách dùng: node --env-file=.env scripts/import-sheets.mjs --users Users.csv --periods KPIPeriods.csv --plans ManagerPlanVersions.csv --results ManagerResultVersions.csv [--dry-run]');
  }
  // Thứ tự bắt buộc: kỳ → users → kế hoạch → báo cáo
  if (arg('--periods')) await importPeriods(arg('--periods'));
  if (arg('--users')) await importUsers(arg('--users'));
  if (arg('--plans')) await importPlans(arg('--plans'));
  if (arg('--results')) await importResults(arg('--results'));
  console.log(warns.length ? `\nHoàn tất với ${warns.length} cảnh báo – xem các dòng ⚠ ở trên.` : '\nHoàn tất, không có cảnh báo.');
} finally {
  if (pool) await pool.end();
}
