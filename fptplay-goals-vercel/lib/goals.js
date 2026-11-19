// =====================================================================
// Nghiệp vụ FPT Play Goals – port từ Code.gs + phần mở rộng
// (BĐH duyệt, xin sửa kế hoạch, HR mở lại / gửi lại email)
// =====================================================================
import crypto from 'node:crypto';
import { query, one, tx, audit } from './db.js';
import { bad, conflict, notFound } from './http.js';
import {
  MSC_VERSION, normalizeMscPlan, normalizeMscResults, normalizeBdhDecisions, validateSubmittedMscPlan,
  mscTaskMax, mscCounts, mscMaxScore, mscAvailableScore, mscRankFromScore, withMaxPoints,
} from './msc.js';
import {
  sendMail, buildMscPlanEmail, buildMscResultEmail, buildBdhApprovedEmail, buildEditRequestEmail, buildEditDecisionEmail,
} from './mail.js';

const ID_RE = /^[a-zA-Z0-9_-]{10,100}$/;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (d) => (d ? new Date(d).toISOString() : '');

// ================================================================ đọc dữ liệu
export async function openPeriod(t = { one }) {
  const rows = await (t.query ? t.query : query)(`SELECT * FROM kpi_periods WHERE status = 'OPEN'`);
  if (rows.length !== 1) throw conflict('NO_OPEN_PERIOD', 'Cần có đúng một kỳ KPI ở trạng thái OPEN.');
  return rows[0];
}
async function getPeriod(id) {
  const p = await one('SELECT * FROM kpi_periods WHERE id = $1', [id]);
  if (!p) throw notFound('Kỳ KPI không tồn tại.');
  return p;
}

/** Trạng thái kế hoạch / báo cáo của 1 người trong 1 kỳ. */
async function versionState(q, table, periodId, userId) {
  const rows = await q(`SELECT * FROM ${table} WHERE period_id = $1 AND user_id = $2 ORDER BY saved_at, id`, [periodId, userId]);
  const submitted = rows.find((r) => r.status === 'SUBMITTED') || null;
  const latest = rows.length ? rows[rows.length - 1] : null;
  // Được HR mở lại: có bản nháp mới hơn, revision lớn hơn bản đã nộp
  const reopened = !!(submitted && latest && latest.status === 'DRAFT' && latest.revision > submitted.revision);
  return { rows, submitted, latest, reopened };
}
const planState = (q, p, u) => versionState(q, 'plan_versions', p, u);
const resultState = (q, p, u) => versionState(q, 'result_versions', p, u);

const lockUser = (t, userId) => t.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

// ================================================================ email (claim PENDING → PROCESSING → SENT/FAILED)
async function deliver(table, id, statusCond, build) {
  const row = await one(
    `UPDATE ${table} SET mail_status = 'PROCESSING' WHERE id = $1 AND ${statusCond} AND mail_status = 'PENDING' RETURNING *`, [id]);
  if (!row) {
    const cur = await one(`SELECT mail_status FROM ${table} WHERE id = $1`, [id]);
    return { sent: cur?.mail_status === 'SENT' };
  }
  let sent = false, lastError = '';
  try {
    await sendMail(await build(row));
    sent = true;
  } catch (e) {
    lastError = String(e?.message || e).slice(0, 300);
    console.error('Không gửi được email:', table, id, e);
  }
  await query(
    `UPDATE ${table} SET mail_status = $2, mail_sent_at = $3, mail_last_error = $4 WHERE id = $1 AND mail_status = 'PROCESSING'`,
    [id, sent ? 'SENT' : 'FAILED', sent ? new Date() : null, lastError]);
  return { sent };
}

export function sendPlanMail(versionId) {
  return deliver('plan_versions', versionId, `status = 'SUBMITTED'`, async (row) => {
    const [user, period] = await Promise.all([one('SELECT * FROM users WHERE id = $1', [row.user_id]), getPeriod(row.period_id)]);
    validateSubmittedMscPlan(row.tasks);
    const m = buildMscPlanEmail({ email: user.email, name: row.full_name || user.full_name, periodName: period.name, details: withMaxPoints(row.tasks) });
    return { to: user.email, cc: user.cc_emails, ...m };
  });
}

export function sendResultMail(versionId) {
  return deliver('result_versions', versionId, `status = 'SUBMITTED'`, async (row) => {
    const [user, period, plan] = await Promise.all([
      one('SELECT * FROM users WHERE id = $1', [row.user_id]), getPeriod(row.period_id),
      one('SELECT * FROM plan_versions WHERE id = $1', [row.plan_version_id])]);
    const norm = normalizeMscResults(row.results, plan.tasks, 'SUBMITTED');
    if (Math.abs(norm.totalScore - Number(row.total_score)) > 0.0001) throw new Error('Tổng điểm báo cáo không khớp.');
    const byId = new Map(norm.results.map((r) => [r.taskId, r]));
    const details = plan.tasks.map((t) => ({ ...t, ...byId.get(String(t.id)) }));
    const m = buildMscResultEmail({ email: user.email, name: plan.full_name || user.full_name, periodName: period.name, totalScore: Number(row.total_score), details });
    return { to: user.email, cc: user.cc_emails, ...m };
  });
}

export function sendBdhMail(reviewId) {
  return deliver('bdh_reviews', reviewId, `status = 'APPROVED'`, async (rv) => {
    const [user, period, result] = await Promise.all([
      one('SELECT * FROM users WHERE id = $1', [rv.user_id]), getPeriod(rv.period_id),
      one('SELECT * FROM result_versions WHERE id = $1', [rv.result_version_id])]);
    const plan = await one('SELECT * FROM plan_versions WHERE id = $1', [result.plan_version_id]);
    const self = new Map(result.results.map((r) => [String(r.taskId), r]));
    const dec = new Map(rv.decisions.map((d) => [String(d.taskId), d]));
    const details = withMaxPoints(plan.tasks).map((t) => {
      const s = self.get(String(t.id)) || {}, d = dec.get(String(t.id)) || {};
      return { ...t, ...s, bdhCompletion: d.completion, bdhNote: d.note, bdhEarned: d.completion === 'COMPLETED' ? t.maxPoints : 0 };
    });
    const m = buildBdhApprovedEmail({ email: user.email, name: user.full_name, periodName: period.name,
      selfScore: Number(result.total_score), bdhScore: Number(rv.score), comment: rv.comment, details });
    return { to: user.email, cc: user.cc_emails, ...m };
  });
}

const mailNote = (r) => (r.sent ? ' Email xác nhận đã gửi.' : ' Email chưa gửi; HR cần kiểm tra.');

// ================================================================ MANAGER: workspace (getManagerWorkspace)
export async function getWorkspace(user) {
  const period = await openPeriod();
  const phase = period.phase;
  const common = {
    phase,
    account: { email: user.email, name: user.full_name, department: user.department },
    period: { id: period.id, name: period.name || period.id, planDeadline: iso(period.plan_deadline), resultDeadline: iso(period.result_deadline) },
  };
  const ps = await planState(query, period.id, user.id);
  const planInfo = ps.submitted ? {
    submittedVersionId: ps.submitted.id, submittedAt: iso(ps.submitted.saved_at), revision: ps.submitted.revision,
    mailStatus: ps.submitted.mail_status, reopened: ps.reopened,
  } : null;

  if (phase === 'PLAN') {
    const record = ps.reopened ? ps.latest : (ps.submitted || ps.latest);
    const tasks = record ? record.tasks : [];
    if (record && (!Array.isArray(tasks) || tasks.some((t) => t.formulaVersion !== MSC_VERSION))) {
      throw conflict('FORMULA', 'Kỳ này có dữ liệu không thuộc công thức MSC. Liên hệ HR để kiểm tra.');
    }
    const editRequest = await one(
      'SELECT id, status, reason, decision_note, created_at, decided_at FROM plan_edit_requests WHERE period_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [period.id, user.id]);
    return {
      ...common,
      editable: !ps.submitted || ps.reopened,
      status: record ? record.status : 'NEW',
      latestVersionId: ps.latest ? ps.latest.id : '',
      tasks, plan: planInfo, editRequest,
    };
  }

  // RESULT
  if (!ps.submitted) throw conflict('NO_PLAN', 'Chưa có kế hoạch đã nộp trong kỳ. Liên hệ HR.');
  const planTasks = ps.submitted.tasks;
  const counts = validateSubmittedMscPlan(planTasks);
  const rs = await resultState(query, period.id, user.id);
  if (rs.rows.some((r) => r.plan_version_id !== ps.submitted.id)) throw conflict('PLAN_REF', 'Báo cáo tham chiếu kế hoạch khác; liên hệ HR.');
  const record = rs.reopened ? rs.latest : (rs.submitted || rs.latest);
  const previous = record ? record.results : [];
  const prevById = new Map(previous.map((r) => [String(r.taskId), r]));
  const review = await one(`SELECT * FROM bdh_reviews WHERE period_id = $1 AND user_id = $2 AND status = 'APPROVED'`, [period.id, user.id]);
  const decById = new Map((review?.decisions || []).map((d) => [String(d.taskId), d]));
  return {
    ...common,
    editable: !rs.submitted || rs.reopened,
    status: record ? record.status : 'NEW',
    latestVersionId: rs.latest ? rs.latest.id : '',
    planVersionId: ps.submitted.id,
    maxScore: mscMaxScore(counts),
    availableScore: mscAvailableScore(counts),
    plan: planInfo,
    result: rs.submitted ? { submittedAt: iso(rs.submitted.saved_at), totalScore: num(rs.submitted.total_score), mailStatus: rs.submitted.mail_status, reopened: rs.reopened } : null,
    review: review ? { score: num(review.score), ...mscRankFromScore(review.score), comment: review.comment, approvedAt: iso(review.approved_at) } : null,
    tasks: planTasks.map((task) => {
      const prior = prevById.get(String(task.id));
      const d = decById.get(String(task.id));
      const maxPoints = mscTaskMax(task, counts);
      return {
        id: String(task.id), title: String(task.title), target: String(task.target), msc: task.msc, maxPoints,
        actual: prior ? String(prior.actual || '') : '', evidence: prior ? String(prior.evidence || '') : '',
        completion: prior ? String(prior.completion || '') : '', reason: prior ? String(prior.reason || '') : '',
        bdh: d ? { completion: d.completion, note: d.note || '', earnedPoints: d.completion === 'COMPLETED' ? maxPoints : 0 } : null,
      };
    }),
  };
}

// ================================================================ MANAGER: lưu kế hoạch (saveManagerPlan)
function checkPayload(payload) {
  if (!payload || !ID_RE.test(String(payload.requestId || ''))) throw bad('REQUEST_ID', 'RequestID không hợp lệ.');
  if (!['DRAFT', 'SUBMITTED'].includes(payload.status)) throw bad('STATUS', 'Trạng thái không hợp lệ.');
}

export async function savePlan(user, payload) {
  checkPayload(payload);
  const out = await tx(async (t) => {
    await lockUser(t, user.id);
    const period = await openPeriod(t);
    if (String(payload.periodId || '') !== period.id) throw conflict('PERIOD_CHANGED', 'Kỳ KPI đã thay đổi. Hãy tải lại.');
    const existing = await t.one('SELECT * FROM plan_versions WHERE request_id = $1', [payload.requestId]);
    if (existing) {
      if (existing.user_id !== user.id) throw bad('REQUEST_ID', 'RequestID không hợp lệ.');
      return { row: existing, replay: true };
    }
    const ps = await planState(t.query, period.id, user.id);
    if (period.phase !== 'PLAN' || (ps.submitted && !ps.reopened)) {
      throw conflict('LOCKED', 'Giai đoạn kế hoạch đã khóa hoặc hồ sơ đã nộp.');
    }
    if (String(payload.baseVersionId || '') !== (ps.latest ? ps.latest.id : '')) {
      throw conflict('STALE', 'Kế hoạch đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi lưu.');
    }
    const tasks = normalizeMscPlan(payload.tasks, payload.status);
    const revision = ps.latest ? ps.latest.revision : 1;
    if (payload.status === 'SUBMITTED' && ps.submitted) {
      await t.query(`UPDATE plan_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1`, [ps.submitted.id]);
    }
    const row = await t.one(
      `INSERT INTO plan_versions (request_id, period_id, user_id, full_name, department, revision, status, tasks, mail_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [payload.requestId, period.id, user.id, user.full_name, user.department, revision, payload.status,
        JSON.stringify(tasks), payload.status === 'SUBMITTED' ? 'PENDING' : '']);
    return { row, replay: false };
  });
  const { row } = out;
  if (!out.replay) await audit(user.id, row.status === 'SUBMITTED' ? 'PLAN_SUBMIT' : 'PLAN_DRAFT', 'plan_version', row.id, { revision: row.revision });
  let message = row.status === 'SUBMITTED'
    ? (out.replay ? 'Kế hoạch đã được nộp.' : 'Đã nộp kế hoạch. Nội dung đã khóa.')
    : (out.replay ? 'Bản nháp đã được lưu.' : 'Đã lưu bản nháp.');
  if (row.status === 'SUBMITTED') message += mailNote(await sendPlanMail(row.id));
  return { versionId: row.id, status: row.status, message };
}

// ================================================================ MANAGER: lưu báo cáo (saveManagerResults)
export async function saveResults(user, payload) {
  checkPayload(payload);
  const out = await tx(async (t) => {
    await lockUser(t, user.id);
    const period = await openPeriod(t);
    const ps = await planState(t.query, period.id, user.id);
    if (!ps.submitted) throw bad('NO_PLAN', 'Chưa có kế hoạch đã nộp.');
    if (String(payload.periodId || '') !== period.id || String(payload.planVersionId || '') !== ps.submitted.id) {
      throw conflict('PERIOD_CHANGED', 'Kỳ hoặc kế hoạch đã thay đổi. Hãy tải lại.');
    }
    const existing = await t.one('SELECT * FROM result_versions WHERE request_id = $1', [payload.requestId]);
    if (existing) {
      if (existing.user_id !== user.id) throw bad('REQUEST_ID', 'RequestID không hợp lệ.');
      return { row: existing, replay: true };
    }
    const rs = await resultState(t.query, period.id, user.id);
    if (rs.rows.some((r) => r.plan_version_id !== ps.submitted.id)) throw conflict('PLAN_REF', 'Báo cáo tham chiếu kế hoạch khác; liên hệ HR.');
    if (period.phase !== 'RESULT' || (rs.submitted && !rs.reopened)) {
      throw conflict('LOCKED', 'Giai đoạn báo cáo đã khóa hoặc báo cáo đã nộp.');
    }
    if (String(payload.baseVersionId || '') !== (rs.latest ? rs.latest.id : '')) {
      throw conflict('STALE', 'Báo cáo đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi lưu.');
    }
    const normalized = normalizeMscResults(payload.results, ps.submitted.tasks, payload.status);
    const revision = rs.latest ? rs.latest.revision : 1;
    if (payload.status === 'SUBMITTED' && rs.submitted) {
      await t.query(`UPDATE result_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1`, [rs.submitted.id]);
    }
    const row = await t.one(
      `INSERT INTO result_versions (request_id, plan_version_id, period_id, user_id, revision, status, results, total_score, mail_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [payload.requestId, ps.submitted.id, period.id, user.id, revision, payload.status,
        JSON.stringify(normalized.results), normalized.totalScore, payload.status === 'SUBMITTED' ? 'PENDING' : '']);
    return { row, replay: false };
  });
  const { row } = out;
  if (!out.replay) await audit(user.id, row.status === 'SUBMITTED' ? 'RESULT_SUBMIT' : 'RESULT_DRAFT', 'result_version', row.id, { revision: row.revision });
  let message = row.status === 'SUBMITTED'
    ? (out.replay ? 'Báo cáo đã được nộp.' : 'Đã nộp báo cáo. Nội dung đã khóa.')
    : (out.replay ? 'Bản nháp đã được lưu.' : 'Đã lưu bản nháp.');
  if (row.status === 'SUBMITTED') message += mailNote(await sendResultMail(row.id));
  return { versionId: row.id, status: row.status, totalScore: num(row.total_score), maxScore: 10, message };
}

// ================================================================ Xin sửa kế hoạch
async function hrRecipients() {
  const env = String(process.env.HR_NOTIFY_EMAILS || '').split(/[,;\s]+/).filter(Boolean);
  if (env.length) return env;
  return (await query('SELECT email FROM users WHERE is_hr AND active')).map((r) => r.email);
}

export async function requestPlanEdit(user, reasonInput) {
  const reason = String(reasonInput || '').trim().slice(0, 2000);
  if (reason.length < 5) throw bad('REASON', 'Vui lòng nêu rõ lý do cần sửa kế hoạch.');
  const period = await openPeriod();
  if (period.phase !== 'PLAN') throw conflict('PHASE', 'Chỉ xin sửa kế hoạch trong giai đoạn PLAN.');
  const ps = await planState(query, period.id, user.id);
  if (!ps.submitted) throw bad('NO_PLAN', 'Kế hoạch chưa nộp, Anh/Chị có thể sửa trực tiếp.');
  if (ps.reopened) throw conflict('REOPENED', 'Kế hoạch đã được mở lại, Anh/Chị có thể sửa và nộp lại.');
  const row = await one(
    `INSERT INTO plan_edit_requests (period_id, user_id, plan_version_id, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
    [period.id, user.id, ps.submitted.id, reason]);
  await audit(user.id, 'PLAN_EDIT_REQUEST', 'plan_edit_request', row.id);
  const to = await hrRecipients();
  if (to.length) {
    try { await sendMail({ to, ...buildEditRequestEmail({ user, period, reason }) }); } catch (e) { console.error('Email xin sửa KH lỗi', e); }
  }
  return { id: row.id, message: 'Đã gửi yêu cầu sửa kế hoạch tới HR.' };
}

/** Tạo bản nháp revision+1 copy từ bản đã nộp (dùng khi duyệt sửa / HR mở lại). */
async function openDraftCopy(t, table, periodId, userId, extraCols = '') {
  const st = await versionState(t.query, table, periodId, userId);
  if (!st.submitted) throw bad('NOT_SUBMITTED', table === 'plan_versions' ? 'Manager chưa nộp kế hoạch.' : 'Manager chưa nộp báo cáo.');
  if (st.reopened) return st.latest.id;
  const rid = 'reopen-' + crypto.randomUUID();
  const r = table === 'plan_versions'
    ? await t.one(`INSERT INTO plan_versions (request_id, period_id, user_id, full_name, department, revision, status, tasks)
                   VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7) RETURNING id`,
      [rid, periodId, userId, st.submitted.full_name, st.submitted.department, st.submitted.revision + 1, JSON.stringify(st.submitted.tasks)])
    : await t.one(`INSERT INTO result_versions (request_id, plan_version_id, period_id, user_id, revision, status, results, total_score)
                   VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7) RETURNING id`,
      [rid, st.submitted.plan_version_id, periodId, userId, st.submitted.revision + 1, JSON.stringify(st.submitted.results), st.submitted.total_score]);
  void extraCols;
  return r.id;
}

export async function decideEdit(hr, id, approve, noteInput) {
  const note = String(noteInput || '').trim().slice(0, 2000);
  if (!approve && !note) throw bad('NOTE', 'Vui lòng ghi lý do từ chối.');
  const r = await tx(async (t) => {
    const row = await t.one('SELECT * FROM plan_edit_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw notFound('Không tìm thấy yêu cầu.');
    if (row.status !== 'PENDING') throw conflict('DONE', 'Yêu cầu này đã được xử lý.');
    if (approve) {
      const period = await openPeriod(t);
      if (period.id !== row.period_id || period.phase !== 'PLAN') throw conflict('PHASE', 'Kỳ của yêu cầu không còn ở giai đoạn PLAN.');
      await lockUser(t, row.user_id);
      await openDraftCopy(t, 'plan_versions', row.period_id, row.user_id);
    }
    return t.one(`UPDATE plan_edit_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1 RETURNING *`,
      [id, approve ? 'APPROVED' : 'REJECTED', hr.id, note]);
  });
  await audit(hr.id, approve ? 'PLAN_EDIT_APPROVE' : 'PLAN_EDIT_REJECT', 'plan_edit_request', id);
  const [user, period] = await Promise.all([one('SELECT * FROM users WHERE id = $1', [r.user_id]), getPeriod(r.period_id)]);
  try { await sendMail({ to: user.email, cc: user.cc_emails, ...buildEditDecisionEmail({ user, period, approved: approve, note }) }); }
  catch (e) { console.error('Email kết quả xin sửa lỗi', e); }
  return { ok: true };
}

export async function reopenPlan(hr, periodId, userId) {
  const id = await tx(async (t) => {
    const period = await openPeriod(t);
    if (period.id !== periodId || period.phase !== 'PLAN') throw conflict('PHASE', 'Chỉ mở lại kế hoạch của kỳ OPEN đang ở giai đoạn PLAN.');
    await lockUser(t, userId);
    return openDraftCopy(t, 'plan_versions', periodId, userId);
  });
  await audit(hr.id, 'PLAN_REOPEN', 'plan_version', id, { userId });
  return { ok: true, message: 'Đã mở lại kế hoạch. Bản đã nộp vẫn hiệu lực đến khi Manager nộp lại.' };
}

export async function reopenResult(hr, periodId, userId) {
  const id = await tx(async (t) => {
    const period = await openPeriod(t);
    if (period.id !== periodId || period.phase !== 'RESULT') throw conflict('PHASE', 'Chỉ mở lại báo cáo của kỳ OPEN đang ở giai đoạn RESULT.');
    await lockUser(t, userId);
    const rid = await openDraftCopy(t, 'result_versions', periodId, userId);
    // Báo cáo sẽ thay đổi → kết quả BĐH duyệt cũ không còn giá trị
    await t.query(`UPDATE bdh_reviews SET status = 'DRAFT', approved_at = NULL, updated_at = now() WHERE period_id = $1 AND user_id = $2`, [periodId, userId]);
    return rid;
  });
  await audit(hr.id, 'RESULT_REOPEN', 'result_version', id, { userId });
  return { ok: true, message: 'Đã mở lại báo cáo. Kết quả BĐH duyệt (nếu có) đã chuyển về nháp.' };
}

export async function resendMail(hr, kind, periodId, userId) {
  if (kind === 'PLAN' || kind === 'RESULT') {
    const table = kind === 'PLAN' ? 'plan_versions' : 'result_versions';
    const v = await one(`UPDATE ${table} SET mail_status = 'PENDING' WHERE period_id = $1 AND user_id = $2 AND status = 'SUBMITTED' RETURNING id`, [periodId, userId]);
    if (!v) throw notFound(kind === 'PLAN' ? 'Manager chưa nộp kế hoạch.' : 'Manager chưa nộp báo cáo.');
    const r = await (kind === 'PLAN' ? sendPlanMail(v.id) : sendResultMail(v.id));
    await audit(hr.id, 'MAIL_RESEND', table, v.id, { sent: r.sent });
    return { sent: r.sent, message: r.sent ? 'Đã gửi lại email xác nhận.' : 'Gửi lại email thất bại. Kiểm tra cấu hình SMTP.' };
  }
  if (kind === 'BDH') {
    const v = await one(`UPDATE bdh_reviews SET mail_status = 'PENDING' WHERE period_id = $1 AND user_id = $2 AND status = 'APPROVED' RETURNING id`, [periodId, userId]);
    if (!v) throw notFound('Chưa có kết quả BĐH đã duyệt.');
    const r = await sendBdhMail(v.id);
    return { sent: r.sent, message: r.sent ? 'Đã gửi lại email kết quả BĐH.' : 'Gửi lại email thất bại.' };
  }
  throw bad('KIND', 'Loại email không hợp lệ.');
}

// ================================================================ BĐH duyệt
export async function saveReview(hr, body) {
  const periodId = String(body.periodId || '');
  const userId = Number(body.userId);
  const approve = !!body.approve;
  const period = await getPeriod(periodId);
  if (period.phase !== 'RESULT' && period.status !== 'CLOSED') throw conflict('PHASE', 'Chỉ duyệt khi kỳ ở giai đoạn RESULT hoặc đã đóng.');
  const review = await tx(async (t) => {
    await lockUser(t, userId);
    const rs = await resultState(t.query, periodId, userId);
    if (!rs.submitted) throw bad('NO_RESULT', 'Manager chưa nộp báo cáo.');
    if (String(body.resultVersionId || '') !== rs.submitted.id) throw conflict('STALE', 'Báo cáo của Manager đã thay đổi. Vui lòng tải lại.');
    const plan = await t.one('SELECT * FROM plan_versions WHERE id = $1', [rs.submitted.plan_version_id]);
    const norm = normalizeBdhDecisions(body.decisions, plan.tasks, approve);
    const comment = String(body.comment || '').trim().slice(0, 4000);
    return t.one(
      `INSERT INTO bdh_reviews (period_id, user_id, result_version_id, status, decisions, score, comment, reviewer_id, approved_at, mail_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $4 = 'APPROVED' THEN now() END, CASE WHEN $4 = 'APPROVED' THEN 'PENDING' ELSE '' END)
       ON CONFLICT (period_id, user_id) DO UPDATE SET result_version_id = EXCLUDED.result_version_id, status = EXCLUDED.status,
         decisions = EXCLUDED.decisions, score = EXCLUDED.score, comment = EXCLUDED.comment, reviewer_id = EXCLUDED.reviewer_id,
         approved_at = EXCLUDED.approved_at, mail_status = EXCLUDED.mail_status, updated_at = now()
       RETURNING *`,
      [periodId, userId, rs.submitted.id, approve ? 'APPROVED' : 'DRAFT', JSON.stringify(norm.decisions), norm.score, comment, hr.id]);
  });
  await audit(hr.id, approve ? 'BDH_APPROVE' : 'BDH_DRAFT', 'bdh_review', review.id, { score: review.score });
  let message = approve ? `Đã duyệt: ${Number(review.score).toFixed(4).replace(/\.?0+$/, '')}/10.` : 'Đã lưu nháp duyệt.';
  if (approve) message += (await sendBdhMail(review.id)).sent ? ' Email kết quả đã gửi Manager.' : ' Email chưa gửi; kiểm tra SMTP.';
  return { status: review.status, score: num(review.score), message };
}

// ================================================================ HR: tổng hợp (getHRManagerOverview)
export async function collect(periodIdInput, onlyUserId = null) {
  const periods = (await query('SELECT * FROM kpi_periods ORDER BY created_at, id')).map((p) => ({
    id: p.id, name: p.name || p.id, status: p.status, phase: p.phase, planDeadline: iso(p.plan_deadline), resultDeadline: iso(p.result_deadline),
  }));
  if (!periods.length) {
    return { periods: [], selectedPeriodId: '', period: null, summary: { total: 0, plansSubmitted: 0, resultsSubmitted: 0, bdhApproved: 0, needsAttention: 0 }, managers: [] };
  }
  const open = periods.find((p) => p.status === 'OPEN');
  const periodId = String(periodIdInput || '').trim() || (open || periods[periods.length - 1]).id;
  const period = periods.find((p) => p.id === periodId);
  if (!period) throw notFound('Kỳ KPI không tồn tại.');

  const uFilter = onlyUserId ? ' AND user_id = $2' : '';
  const params = onlyUserId ? [periodId, onlyUserId] : [periodId];
  const [users, plans, results, reviews, edits] = await Promise.all([
    query(`SELECT * FROM users WHERE ${onlyUserId ? 'id = $1' : `(role = 'Manager' AND active) OR id IN (SELECT user_id FROM plan_versions WHERE period_id = $1 UNION SELECT user_id FROM result_versions WHERE period_id = $1)`}`, [onlyUserId || periodId]),
    query(`SELECT * FROM plan_versions WHERE period_id = $1${uFilter} ORDER BY saved_at, id`, params),
    query(`SELECT * FROM result_versions WHERE period_id = $1${uFilter} ORDER BY saved_at, id`, params),
    query(`SELECT r.*, u.email AS reviewer_email FROM bdh_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.period_id = $1${uFilter.replace('user_id', 'r.user_id')}`, params),
    query(`SELECT * FROM plan_edit_requests WHERE period_id = $1 AND status = 'PENDING'${uFilter}`, params),
  ]);
  const group = (rows) => rows.reduce((m, r) => (m.get(r.user_id)?.push(r) || m.set(r.user_id, [r]), m), new Map());
  const plansBy = group(plans), resultsBy = group(results);
  const reviewBy = new Map(reviews.map((r) => [r.user_id, r]));
  const editBy = new Set(edits.map((e) => e.user_id));

  const managers = users.map((u) => {
    const planRows = plansBy.get(u.id) || [], resultRows = resultsBy.get(u.id) || [];
    const plan = planRows.find((r) => r.status === 'SUBMITTED') || null;
    const report = resultRows.find((r) => r.status === 'SUBMITTED') || null;
    const planLatest = planRows[planRows.length - 1], resultLatest = resultRows[resultRows.length - 1];
    const planReopened = !!(plan && planLatest.status === 'DRAFT' && planLatest.revision > plan.revision);
    const resultReopened = !!(report && resultLatest.status === 'DRAFT' && resultLatest.revision > report.revision);
    const planStatus = plan ? 'Đã nộp' : planRows.length ? 'Bản nháp' : 'Chưa có kế hoạch';
    const resultStatus = report ? 'Đã nộp' : resultRows.length ? 'Bản nháp' : 'Chưa báo cáo';
    const review = reviewBy.get(u.id) || null;
    const warnings = [];
    let tasks = [], selfScore = null, maxScore = null, availableScore = null;
    if (report && !plan) warnings.push('Có báo cáo nhưng thiếu kế hoạch.');
    if (report && plan && report.plan_version_id !== plan.id) warnings.push('Báo cáo tham chiếu kế hoạch khác.');
    try {
      if (plan && !warnings.length) {
        const planTasks = plan.tasks;
        const counts = validateSubmittedMscPlan(planTasks);
        maxScore = mscMaxScore(counts);
        availableScore = mscAvailableScore(counts);
        const byId = new Map((report ? report.results : []).map((r) => [String(r.taskId), r]));
        const dec = new Map((review?.decisions || []).map((d) => [String(d.taskId), d]));
        tasks = planTasks.map((task) => {
          const item = byId.get(String(task.id)), d = dec.get(String(task.id));
          const maxPoints = mscTaskMax(task, counts);
          return {
            id: String(task.id), title: task.title, target: task.target, msc: task.msc, maxPoints,
            actual: item ? String(item.actual || '') : '', evidence: item ? String(item.evidence || '') : '',
            completion: item ? String(item.completion || '') : '', reason: item ? String(item.reason || '') : '',
            earnedPoints: item ? (item.completion === 'COMPLETED' ? maxPoints : 0) : null,
            bdhCompletion: d ? d.completion : '', bdhNote: d ? d.note || '' : '',
            bdhEarned: d && d.completion ? (d.completion === 'COMPLETED' ? maxPoints : 0) : null,
          };
        });
        if (report) {
          if (report.results.length !== planTasks.length || tasks.some((t) => !t.actual || !['COMPLETED', 'NOT_COMPLETED'].includes(t.completion))) {
            warnings.push('Báo cáo thiếu kết quả hoặc trạng thái.');
          } else {
            const calculated = Number(tasks.reduce((s, t) => s + t.earnedPoints, 0).toFixed(6));
            if (Math.abs(Number(report.total_score) - calculated) > 0.0001) warnings.push('Điểm lưu không khớp điểm tính lại.');
            else selfScore = calculated;
          }
        }
      }
    } catch (e) {
      console.error('Lỗi dữ liệu HR:', periodId, u.email, e);
      warnings.push('Không đọc được chi tiết; cần đối soát.');
      tasks = []; selfScore = null;
    }
    if (plan?.mail_status === 'FAILED') warnings.push('Email xác nhận kế hoạch lỗi.');
    if (report?.mail_status === 'FAILED') warnings.push('Email xác nhận báo cáo lỗi.');
    if (review?.status === 'APPROVED' && report && review.result_version_id !== report.id) warnings.push('BĐH duyệt trên báo cáo cũ.');
    const approved = review?.status === 'APPROVED';
    const bdhStatus = approved ? 'Đã duyệt' : report ? (review ? 'Đang duyệt (nháp)' : 'Chờ duyệt') : 'Chưa đến bước';
    const selfRank = mscRankFromScore(selfScore), bdhRank = mscRankFromScore(approved ? review.score : null);
    return {
      userId: u.id, email: u.email, name: plan?.full_name || u.full_name || u.email, department: plan?.department || u.department,
      team: u.team, ccEmails: u.cc_emails,
      planStatus, resultStatus, planReopened, resultReopened, pendingEdit: editBy.has(u.id),
      planVersionId: plan?.id || '', planRevision: plan?.revision || null, planSubmittedAt: iso(plan?.saved_at), planMailStatus: plan?.mail_status || '',
      resultVersionId: report?.id || '', resultSubmittedAt: iso(report?.saved_at), resultMailStatus: report?.mail_status || '',
      selfScore, selfRank: selfScore === null ? '' : selfRank.rank, selfCoefficient: selfScore === null ? '' : selfRank.coefficient,
      maxScore, availableScore,
      bdhStatus, bdhScore: approved ? num(review.score) : null, bdhRank: approved ? bdhRank.rank : '', bdhCoefficient: approved ? bdhRank.coefficient : '',
      reviewerEmail: approved ? review.reviewer_email || '' : '', approvedAt: approved ? iso(review.approved_at) : '',
      bdhMailStatus: review?.mail_status || '', review: review ? { status: review.status, comment: review.comment, score: num(review.score), resultVersionId: review.result_version_id } : null,
      warning: warnings.join(' '), tasks,
    };
  });
  managers.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return {
    periods, selectedPeriodId: periodId, period,
    summary: {
      total: managers.length,
      plansSubmitted: managers.filter((m) => m.planStatus === 'Đã nộp').length,
      resultsSubmitted: managers.filter((m) => m.resultStatus === 'Đã nộp').length,
      bdhApproved: managers.filter((m) => m.bdhStatus === 'Đã duyệt').length,
      needsAttention: managers.filter((m) => m.warning || m.planStatus !== 'Đã nộp' || m.resultStatus !== 'Đã nộp').length,
    },
    managers,
  };
}

export async function detail(periodId, userId) {
  const data = await collect(periodId, userId);
  const manager = data.managers[0];
  if (!manager) throw notFound('Không tìm thấy Manager.');
  const [edits, history] = await Promise.all([
    query(`SELECT e.*, u.email AS decided_by_email FROM plan_edit_requests e LEFT JOIN users u ON u.id = e.decided_by
            WHERE e.period_id = $1 AND e.user_id = $2 ORDER BY e.created_at DESC`, [data.selectedPeriodId, userId]),
    query(`SELECT 'PLAN' AS kind, status, revision, saved_at FROM plan_versions WHERE period_id = $1 AND user_id = $2
           UNION ALL SELECT 'RESULT', status, revision, saved_at FROM result_versions WHERE period_id = $1 AND user_id = $2
           ORDER BY saved_at DESC LIMIT 50`, [data.selectedPeriodId, userId]),
  ]);
  return { period: data.period, manager, edits, history };
}

export { mscCounts };
