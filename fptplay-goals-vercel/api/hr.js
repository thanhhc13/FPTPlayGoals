import { router, getBody, getQuery, bad, forbidden, conflict, notFound } from '../lib/http.js';
import { requireHR } from '../lib/auth.js';
import { query, one, audit } from '../lib/db.js';
import {
  collect, detail, saveReview, reopenPlan, reopenResult, resendMail, decideEdit,
} from '../lib/goals.js';
import { buildManagerReportXlsx } from '../lib/excel.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const domain = () => String(process.env.ALLOWED_EMAIL_DOMAIN || 'fpt.com').toLowerCase();

// /api/hr?action=...   (chỉ tài khoản isHR)
export default router({
  // ---------------------------------------------------------- tổng hợp & chi tiết
  'GET overview': async (req) => { await requireHR(req); return collect(getQuery(req).period || ''); },
  'GET detail': async (req) => {
    await requireHR(req);
    const q = getQuery(req);
    return detail(String(q.period || ''), Number(q.user_id));
  },

  // ---------------------------------------------------------- BĐH duyệt
  'POST review-save': async (req) => saveReview(await requireHR(req), getBody(req)),

  // ---------------------------------------------------------- mở lại / gửi lại email
  'POST plan-reopen': async (req) => { const hr = await requireHR(req); const b = getBody(req); return reopenPlan(hr, String(b.periodId), Number(b.userId)); },
  'POST result-reopen': async (req) => { const hr = await requireHR(req); const b = getBody(req); return reopenResult(hr, String(b.periodId), Number(b.userId)); },
  'POST resend-mail': async (req) => { const hr = await requireHR(req); const b = getBody(req); return resendMail(hr, String(b.kind), String(b.periodId), Number(b.userId)); },

  // ---------------------------------------------------------- xuất Excel (exportManagerReportExcel)
  'GET export': async (req, res) => {
    const hr = await requireHR(req);
    const periodId = String(getQuery(req).period || '').trim();
    if (!periodId) throw bad('PERIOD', 'Vui lòng chọn kỳ KPI cần xuất.');
    const data = await collect(periodId);
    if (data.period.phase !== 'RESULT' && data.period.status !== 'CLOSED') {
      throw conflict('PHASE', 'Chỉ tải báo cáo khi kỳ ở giai đoạn RESULT hoặc kỳ đã đóng.');
    }
    const buf = await buildManagerReportXlsx(data);
    const safe = periodId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1_');
    await audit(hr.id, 'EXPORT_XLSX', 'kpi_period', periodId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="KPI_Manager_${safe}_${stamp}.xlsx"`);
    res.status(200).send(Buffer.from(buf));
  },

  // ---------------------------------------------------------- yêu cầu sửa kế hoạch
  'GET edit-requests': async (req) => {
    await requireHR(req);
    const status = String(getQuery(req).status || 'PENDING');
    return query(
      `SELECT e.id, e.period_id, e.reason, e.status, e.decision_note, e.created_at, e.decided_at,
              u.email, u.full_name, u.department, p.name AS period_name, d.email AS decided_by_email
         FROM plan_edit_requests e JOIN users u ON u.id = e.user_id JOIN kpi_periods p ON p.id = e.period_id
         LEFT JOIN users d ON d.id = e.decided_by
        WHERE ($1 = 'ALL' OR e.status = $1) ORDER BY e.created_at DESC LIMIT 300`, [status]);
  },
  'POST edit-decide': async (req) => { const hr = await requireHR(req); const b = getBody(req); return decideEdit(hr, Number(b.id), !!b.approve, b.note); },

  // ---------------------------------------------------------- người dùng (tab Users)
  'GET users': async (req) => {
    await requireHR(req);
    return query(`SELECT id, email, full_name, department, team, role, is_hr, is_admin, cc_emails, active, updated_at
                    FROM users ORDER BY active DESC, department, full_name`);
  },
  'POST user-save': async (req) => {
    const me = await requireHR(req);
    const b = getBody(req);
    const email = str(b.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email) || !email.endsWith('@' + domain())) throw bad('EMAIL', `Email phải có dạng ten@${domain()}.`);
    const cc = String(Array.isArray(b.cc_emails) ? b.cc_emails.join(',') : b.cc_emails || '')
      .split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const badCc = cc.find((e) => !EMAIL_RE.test(e));
    if (badCc) throw bad('CC', `Email CC không hợp lệ: ${badCc}`);
    const id = b.id ? Number(b.id) : null;
    const cur = id ? await one('SELECT * FROM users WHERE id = $1', [id]) : null;
    if (id && !cur) throw notFound('Không tìm thấy người dùng.');
    const isHr = !!b.is_hr, isAdmin = !!b.is_admin;
    if (!me.is_admin && (isHr !== !!cur?.is_hr || isAdmin !== !!cur?.is_admin)) {
      throw forbidden('Chỉ Admin được cấp hoặc thu hồi quyền HR/Admin.');
    }
    if (cur && cur.id === me.id && (b.active === false || !isHr || isAdmin !== !!me.is_admin)) {
      throw bad('SELF', 'Không thể tự khóa hoặc tự đổi quyền của chính mình.');
    }
    const vals = [email, str(b.full_name, 200), str(b.department, 200), str(b.team, 200), str(b.role, 50) || 'Manager',
      isHr, isAdmin, [...new Set(cc.filter((e) => e !== email))], b.active !== false];
    const row = id
      ? await one(`UPDATE users SET email=$1, full_name=$2, department=$3, team=$4, role=$5, is_hr=$6, is_admin=$7, cc_emails=$8, active=$9, updated_at=now()
                    WHERE id=$10 RETURNING *`, [...vals, id])
      : await one(`INSERT INTO users (email, full_name, department, team, role, is_hr, is_admin, cc_emails, active)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, vals);
    if (!row.active || (row.role !== 'Manager' && !row.is_hr)) await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.id]);
    await audit(me.id, id ? 'USER_UPDATE' : 'USER_CREATE', 'user', row.id, { email, role: row.role, is_hr: row.is_hr, active: row.active });
    return row;
  },

  // ---------------------------------------------------------- kỳ KPI (tab KPIPeriods)
  'GET periods': async (req) => { await requireHR(req); return query('SELECT * FROM kpi_periods ORDER BY created_at DESC, id DESC'); },
  'POST period-save': async (req) => {
    const me = await requireHR(req);
    const b = getBody(req);
    const id = str(b.id, 50);
    if (!/^[\w.-]{2,50}$/.test(id)) throw bad('ID', 'Mã kỳ chỉ gồm chữ, số, dấu gạch (vd: 2026-12).');
    const status = ['DRAFT', 'OPEN', 'CLOSED'].includes(b.status) ? b.status : 'DRAFT';
    const phase = ['PLAN', 'RESULT'].includes(b.phase) ? b.phase : 'PLAN';
    const dt = (v) => (v ? new Date(v) : null);
    const pd = dt(b.plan_deadline), rd = dt(b.result_deadline);
    if ((pd && Number.isNaN(+pd)) || (rd && Number.isNaN(+rd))) throw bad('DATE', 'Hạn nộp không hợp lệ.');
    if (status === 'OPEN') {
      const other = await one(`SELECT id, name FROM kpi_periods WHERE status = 'OPEN' AND id <> $1`, [id]);
      if (other) throw conflict('OPEN_EXISTS', `Kỳ "${other.name}" đang OPEN. Hãy đóng kỳ đó trước (chỉ được có 1 kỳ OPEN).`);
    }
    const row = await one(
      `INSERT INTO kpi_periods (id, name, status, phase, plan_deadline, result_deadline) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, phase=EXCLUDED.phase,
         plan_deadline=EXCLUDED.plan_deadline, result_deadline=EXCLUDED.result_deadline, updated_at=now() RETURNING *`,
      [id, str(b.name, 200) || id, status, phase, pd, rd]);
    await audit(me.id, 'PERIOD_SAVE', 'kpi_period', id, { status, phase });
    return row;
  },
});
