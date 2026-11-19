// Kiểm thử toàn luồng FPT Play Goals trên Postgres giả lập (PGlite) – không cần Neon/SMTP.
//   npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import ExcelJS from 'exceljs';

process.env.AUTH_SECRET = 'test-secret-0123456789abcdef0123456789';
process.env.CRON_SECRET = 'cron-secret';
process.env.MAIL_DRY_RUN = '1';

const { setPool } = await import('../lib/db.js');
const { sentMails } = await import('../lib/mail.js');
const db = new PGlite({ parsers: { 1700: (v) => (v === null ? null : Number(v)) } });
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await db.exec(schema); await db.exec(schema); // chạy lại phải an toàn
setPool({ query: (t, p) => db.query(t, p), connect: async () => ({ query: (t, p) => db.query(t, p), release() {} }) });

const auth = (await import('../api/auth.js')).default;
const manager = (await import('../api/manager.js')).default;
const hr = (await import('../api/hr.js')).default;
const cron = (await import('../api/cron.js')).default;

function call(handler, method, action, { body, query = {}, cookie, headers = {} } = {}) {
  return new Promise((resolve) => {
    const out = { status: 200, headers: {}, body: null };
    const res = {
      writableEnded: false,
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      status(s) { out.status = s; return res; },
      json(o) { out.body = o; res.writableEnded = true; resolve(out); },
      send(s) { out.body = s; res.writableEnded = true; resolve(out); },
      end() { res.writableEnded = true; resolve(out); },
    };
    handler({ method, url: `/x?action=${action}`, query: { action, ...query }, body,
      headers: { host: 't', 'user-agent': 'test', ...(cookie ? { cookie } : {}), ...headers } }, res);
  });
}
const cookieOf = (r) => String(r.headers['set-cookie']).split(';')[0];
const lastOtp = (email) => [...sentMails].reverse().find((m) => m.to.includes(email) && m.meta?.otp).meta.otp;
let step = 0;
const ok = (m) => console.log(`  ✔ ${++step}. ${m}`);
const rid = () => crypto.randomUUID();
const expectErr = (r, status, re) => { assert.equal(r.status, status, JSON.stringify(r.body)); if (re) assert.match(r.body.message, re); };
async function login(email) {
  const r1 = await call(auth, 'POST', 'request-otp', { body: { email } });
  const r2 = await call(auth, 'POST', 'verify-otp', { body: { challengeId: r1.body.data.challengeId, code: lastOtp(email) } });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  return cookieOf(r2);
}

// ---------------------------------------------------------------- seed
await db.query(`INSERT INTO users (email, full_name, department, team, role, is_hr, is_admin, cc_emails) VALUES
  ('admin@fpt.com','Admin HR','Nhân sự','','HR',true,true,'{}'),
  ('hr@fpt.com','HR thường','Nhân sự','','HR',true,false,'{}'),
  ('mgr1@fpt.com','Nguyễn Văn A','Kỹ thuật','Backend','Manager',false,false,'{boss@fpt.com,mgr1@fpt.com}'),
  ('mgr2@fpt.com','Trần Thị B','Kinh doanh','','Manager',false,false,'{}'),
  ('staff@fpt.com','Nhân viên','Kỹ thuật','','Staff',false,false,'{}')`);
console.log('FPT Play Goals – e2e test');

// ================================================================ AUTH
let r = await call(auth, 'POST', 'request-otp', { body: { email: 'someone@gmail.com' } });
assert.equal(r.status, 200); assert.equal(r.body.data.challengeId, undefined); ok('Email ngoài @fpt.com: thông báo chung, không gửi mã');
r = await call(auth, 'POST', 'request-otp', { body: { email: 'staff@fpt.com' } });
assert.equal(r.body.data.challengeId, undefined); ok('Role không phải Manager/isHR: không gửi mã, không lộ thông tin');
r = await call(auth, 'POST', 'request-otp', { body: { email: ' MGR1@fpt.com ' } });
const ch1 = r.body.data.challengeId; assert.ok(ch1);
assert.match(sentMails.at(-1).subject, /\[FPT Play Goals\] Mã xác nhận đăng nhập/); ok('Gửi OTP, tiêu đề đúng mẫu Goals');
r = await call(auth, 'POST', 'request-otp', { body: { email: 'mgr1@fpt.com' } });
assert.equal(r.body.data.challengeId, ch1); assert.match(r.body.data.message, /còn hiệu lực/); ok('Gửi lại trong 60 giây → dùng lại mã cũ');
r = await call(auth, 'POST', 'verify-otp', { body: { challengeId: ch1, code: lastOtp('mgr1@fpt.com') === '000000' ? '111111' : '000000' } });
expectErr(r, 400, /không hợp lệ hoặc đã hết hạn/); ok('Sai mã → thông báo chung');
r = await call(auth, 'POST', 'verify-otp', { body: { challengeId: ch1, code: lastOtp('mgr1@fpt.com') } });
assert.equal(r.status, 200); assert.match(r.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax; Max-Age=28800/);
const m1 = cookieOf(r); ok('Đúng mã → phiên 8 giờ, cookie HttpOnly');
r = await call(auth, 'POST', 'verify-otp', { body: { challengeId: ch1, code: lastOtp('mgr1@fpt.com') } });
expectErr(r, 400); ok('Mã không dùng lại được');
const a = await login('admin@fpt.com'), h = await login('hr@fpt.com'), m2 = await login('mgr2@fpt.com');
r = await call(manager, 'GET', 'workspace', { cookie: a });
expectErr(r, 403, /quyền Manager/); ok('Tài khoản HR (không phải Manager) không vào cổng Manager');
r = await call(hr, 'GET', 'overview', { cookie: m1 });
expectErr(r, 403); ok('Manager không vào trang HR');
r = await call(manager, 'POST', 'plan-save', { cookie: m1, headers: { origin: 'https://evil.com' }, body: {} });
expectErr(r, 403); ok('Chặn POST khác origin');

// ================================================================ KỲ KPI
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
expectErr(r, 409, /đúng một kỳ KPI ở trạng thái OPEN/); ok('Chưa có kỳ OPEN → báo lỗi như bản cũ');
r = await call(hr, 'POST', 'period-save', { cookie: a, body: { id: '2026-11', name: 'Tháng 11/2026', status: 'CLOSED', phase: 'RESULT' } });
r = await call(hr, 'POST', 'period-save', { cookie: a, body: { id: '2026-12', name: 'Tháng 12/2026', status: 'OPEN', phase: 'PLAN' } });
assert.equal(r.status, 200);
r = await call(hr, 'POST', 'period-save', { cookie: a, body: { id: '2027-01', name: 'Tháng 1/2027', status: 'OPEN', phase: 'PLAN' } });
expectErr(r, 409, /chỉ được có 1 kỳ OPEN/); ok('Chỉ cho phép 1 kỳ OPEN');

// ================================================================ KẾ HOẠCH
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
let ws = r.body.data;
assert.equal(ws.phase, 'PLAN'); assert.equal(ws.status, 'NEW'); assert.equal(ws.editable, true); ok('Workspace PLAN: NEW, được sửa');
const T = (msc, title, target = 'Kết quả cam kết ' + title) => ({ id: 'task_' + crypto.randomUUID(), msc, title, target });
const tasks = [T('Must', 'Go-live Xem lại'), T('Must', 'Giảm sự cố P1'), T('Must', 'Tuyển Backend'), T('Should', 'Tối ưu CDN')];
const savePlan = (cookie, body) => call(manager, 'POST', 'plan-save', { cookie, body: { periodId: '2026-12', baseVersionId: '', ...body } });

r = await savePlan(m1, { requestId: rid(), status: 'SUBMITTED', tasks: [tasks[0], tasks[3]] });
expectErr(r, 400, /ít nhất 2 mục tiêu Must/); ok('Thiếu 2 Must → lỗi');
r = await savePlan(m1, { requestId: rid(), status: 'SUBMITTED', tasks: [tasks[0], { ...tasks[1], target: '' }] });
expectErr(r, 400, /cần có tên và kết quả cam kết/); ok('Nộp thiếu kết quả cam kết → lỗi');
r = await savePlan(m1, { requestId: rid(), status: 'DRAFT', tasks: [{ ...tasks[0], title: '' }, tasks[1]] });
assert.equal(r.status, 200); const draft1 = r.body.data.versionId; ok('Lưu nháp cho phép trống nội dung');
const reqId = rid();
r = await savePlan(m1, { requestId: reqId, status: 'DRAFT', tasks });
expectErr(r, 409, /cập nhật ở nơi khác/); ok('baseVersionId cũ → chặn ghi đè (2 tab cùng sửa)');
r = await savePlan(m1, { requestId: reqId, baseVersionId: draft1, status: 'SUBMITTED', tasks });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.data.message, /Đã nộp kế hoạch.*Email xác nhận đã gửi/);
const plan1 = r.body.data.versionId;
const pm = sentMails.at(-1);
assert.match(pm.subject, /Xác nhận đăng ký mục tiêu công việc - Tháng 12\/2026/);
assert.deepEqual(pm.cc, ['boss@fpt.com']); assert.match(pm.text, /Điểm khi hoàn thành: 2\.67/); assert.match(pm.text, /9\.50\/10/);
ok('Nộp kế hoạch: email nhóm MSC, 2,67 điểm/Must, tối đa 9,50/10, CC cột N (bỏ trùng người nhận)');
const before = sentMails.length;
r = await savePlan(m1, { requestId: reqId, baseVersionId: draft1, status: 'SUBMITTED', tasks });
assert.equal(r.body.data.versionId, plan1); assert.equal(sentMails.length, before); ok('Gửi lại cùng RequestID → không tạo bản thứ 2, không gửi mail lại');
r = await savePlan(m1, { requestId: rid(), baseVersionId: plan1, status: 'DRAFT', tasks });
expectErr(r, 409, /đã khóa hoặc hồ sơ đã nộp/); ok('Sau khi nộp: khóa');

// ---------------------------------------------------------------- xin sửa → HR duyệt → nộp lại
r = await call(manager, 'POST', 'plan-request-edit', { cookie: m1, body: { reason: 'Bổ sung mục tiêu Could' } });
assert.equal(r.status, 200); assert.ok(sentMails.at(-1).to.includes('admin@fpt.com')); ok('Xin sửa KH → email tới các tài khoản isHR');
r = await call(manager, 'POST', 'plan-request-edit', { cookie: m1, body: { reason: 'Gửi lần 2 trùng' } });
expectErr(r, 409); ok('Không gửi trùng yêu cầu đang chờ');
r = await call(hr, 'GET', 'edit-requests', { cookie: h });
const er = r.body.data[0];
r = await call(hr, 'POST', 'edit-decide', { cookie: h, body: { id: er.id, approve: false } });
expectErr(r, 400, /lý do từ chối/); ok('Từ chối bắt buộc ghi lý do');
r = await call(hr, 'POST', 'edit-decide', { cookie: h, body: { id: er.id, approve: true, note: 'Đồng ý' } });
assert.equal(r.status, 200); assert.match(sentMails.at(-1).subject, /đã được chấp thuận/); ok('HR duyệt → email Manager');
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
ws = r.body.data;
assert.equal(ws.editable, true); assert.equal(ws.status, 'DRAFT'); assert.equal(ws.plan.reopened, true); assert.equal(ws.tasks.length, 4);
ok('Workspace: bản nháp lần 2 copy từ bản đã nộp, được sửa');
const tasks2 = [...tasks, T('Could', 'Sáng kiến AI phụ đề')];
r = await savePlan(m1, { requestId: rid(), baseVersionId: ws.latestVersionId, status: 'SUBMITTED', tasks: tasks2 });
assert.equal(r.status, 200, JSON.stringify(r.body));
const plan2 = r.body.data.versionId;
const pv = (await db.query(`SELECT status, revision, superseded_at FROM plan_versions WHERE user_id = (SELECT id FROM users WHERE email='mgr1@fpt.com') ORDER BY saved_at`)).rows;
assert.deepEqual(pv.map((x) => x.status), ['DRAFT', 'SUPERSEDED', 'DRAFT', 'SUBMITTED']);
assert.deepEqual(pv.map((x) => x.revision), [1, 1, 2, 2]); assert.ok(pv[1].superseded_at);
ok('Nộp lại: bản 1 → SUPERSEDED (có SupersededAt), bản 2 SUBMITTED; lịch sử giữ đủ');

// mgr2 nộp kế hoạch tối thiểu
r = await savePlan(m2, { requestId: rid(), status: 'SUBMITTED', tasks: [T('Must', 'Doanh số Q4'), T('Must', 'Khách hàng mới')] });
assert.equal(r.status, 200);

// ================================================================ BÁO CÁO
await call(hr, 'POST', 'period-save', { cookie: a, body: { id: '2026-12', name: 'Tháng 12/2026', status: 'OPEN', phase: 'RESULT' } });
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
ws = r.body.data;
assert.equal(ws.phase, 'RESULT'); assert.equal(ws.planVersionId, plan2); assert.equal(ws.tasks.length, 5);
assert.ok(Math.abs(ws.tasks[0].maxPoints - 8 / 3) < 1e-9); assert.equal(ws.availableScore, 10); ok('Workspace RESULT: 5 mục tiêu, Must 2,6667 điểm');
const res = (completion, reason = '') => ws.tasks.map((t) => ({ taskId: t.id, actual: 'Đạt ' + t.title, evidence: 'https://drive/x', completion: completion(t), reason: reason }));
const saveRes = (body) => call(manager, 'POST', 'result-save', { cookie: m1, body: { periodId: '2026-12', planVersionId: plan2, baseVersionId: '', ...body } });
r = await saveRes({ requestId: rid(), status: 'SUBMITTED', results: res((t) => (t.msc === 'Should' ? 'NOT_COMPLETED' : 'COMPLETED')) });
expectErr(r, 400, /không hoàn thành cần nêu rõ nguyên nhân/); ok('Không hoàn thành mà thiếu nguyên nhân → lỗi');
r = await saveRes({ requestId: rid(), status: 'SUBMITTED', results: res(() => '').slice(0, 4) });
expectErr(r, 400, /không khớp kế hoạch/); ok('Thiếu mục tiêu → lỗi');
r = await saveRes({ requestId: rid(), status: 'DRAFT', results: res(() => '') });
assert.equal(r.status, 200); const rdraft = r.body.data.versionId; ok('Lưu nháp báo cáo');
const final = ws.tasks.map((t) => ({ taskId: t.id, actual: 'Kết quả ' + t.title, evidence: '', completion: t.msc === 'Should' ? 'NOT_COMPLETED' : 'COMPLETED', reason: t.msc === 'Should' ? 'NCC dời lịch' : 'bỏ' }));
r = await saveRes({ requestId: rid(), baseVersionId: rdraft, status: 'SUBMITTED', results: final });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.data.totalScore, 8.5);
const rm = sentMails.at(-1);
assert.match(rm.subject, /Xác nhận hoàn tất tự đánh giá công việc - Tháng 12\/2026/);
assert.match(rm.text, /Điểm đánh giá: 8\.50\/10/); assert.match(rm.text, /Xếp hạng: C/); assert.match(rm.text, /Hệ số KPI: 1\.0/);
assert.match(rm.text, /BichDT3@fpt\.com/); assert.deepEqual(rm.cc, ['boss@fpt.com']);
ok('Nộp báo cáo: 8 (Must) + 0 (Should) + 0,5 (Could) = 8,5 → C, hệ số 1,0; email đúng mẫu');
const stored = (await db.query(`SELECT results FROM result_versions WHERE status='SUBMITTED'`)).rows[0].results;
assert.equal(stored.find((x) => x.completion === 'COMPLETED').reason, ''); ok('Nguyên nhân chỉ lưu khi Không hoàn thành');

// ================================================================ HR tổng hợp + BĐH duyệt
r = await call(hr, 'GET', 'overview', { cookie: h });
let ov = r.body.data;
assert.equal(ov.selectedPeriodId, '2026-12'); assert.equal(ov.summary.total, 2);
let row = ov.managers.find((x) => x.email === 'mgr1@fpt.com');
assert.equal(row.planStatus, 'Đã nộp'); assert.equal(row.resultStatus, 'Đã nộp'); assert.equal(row.selfScore, 8.5);
assert.equal(row.selfRank, 'C'); assert.equal(row.bdhStatus, 'Chờ duyệt'); assert.equal(row.warning, '');
assert.equal(ov.managers.find((x) => x.email === 'mgr2@fpt.com').resultStatus, 'Chưa báo cáo');
assert.equal(ov.summary.needsAttention, 1); ok('Tổng quan HR: trạng thái, điểm, xếp hạng, cần theo dõi');

r = await call(hr, 'GET', 'export', { cookie: h, query: { period: '2026-12' } });
assert.equal(r.status, 200); assert.match(r.headers['content-type'], /spreadsheetml/);
let wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.body);
assert.deepEqual(wb.worksheets.map((w) => w.name), ['TongHop', 'ChiTietMucTieu']);
assert.equal(wb.getWorksheet('ChiTietMucTieu').rowCount, 1 + 5 + 2); ok('Xuất Excel 2 sheet TongHop + ChiTietMucTieu');

r = await call(hr, 'GET', 'detail', { cookie: h, query: { period: '2026-12', user_id: String(row.userId) } });
const d = r.body.data.manager;
const decisions = d.tasks.map((t) => ({ taskId: t.id, completion: t.title === 'Tuyển Backend' ? 'NOT_COMPLETED' : t.completion, note: t.title === 'Tuyển Backend' ? '1 ứng viên chưa đạt Senior' : '' }));
r = await call(hr, 'POST', 'review-save', { cookie: h, body: { periodId: '2026-12', userId: row.userId, resultVersionId: d.resultVersionId, approve: true, decisions: decisions.slice(0, 2), comment: 'x' } });
expectErr(r, 400, /Chưa chọn kết quả BĐH/); ok('Duyệt khi chưa chọn đủ mục tiêu → lỗi');
r = await call(hr, 'POST', 'review-save', { cookie: h, body: { periodId: '2026-12', userId: row.userId, resultVersionId: d.resultVersionId, approve: false, decisions: decisions.slice(0, 2) } });
assert.equal(r.status, 200); assert.equal(r.body.data.status, 'DRAFT'); ok('Lưu nháp duyệt (chưa đủ mục tiêu) được');
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
assert.equal(r.body.data.review, null); ok('Nháp duyệt: Manager chưa thấy');
r = await call(hr, 'POST', 'review-save', { cookie: h, body: { periodId: '2026-12', userId: row.userId, resultVersionId: d.resultVersionId, approve: true, decisions, comment: 'Mục tiêu tuyển dụng cần bám tiêu chí.' } });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(Math.abs(r.body.data.score - 35 / 6) < 1e-5);
const bm = sentMails.at(-1);
assert.match(bm.subject, /được Ban Điều hành phê duyệt/); assert.match(bm.text, /Xếp hạng: E/); assert.match(bm.text, /Ghi chú BĐH: 1 ứng viên/);
ok('BĐH duyệt: hạ 1 Must → 5,8333 (E); email kết quả gửi Manager');
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
ws = r.body.data;
assert.equal(ws.review.rank, 'E'); assert.equal(ws.tasks.find((t) => t.title === 'Tuyển Backend').bdh.completion, 'NOT_COMPLETED'); ok('Manager thấy điểm BĐH + ghi chú từng mục tiêu');

await call(hr, 'POST', 'period-save', { cookie: a, body: { id: '2026-12', name: 'Tháng 12/2026', status: 'OPEN', phase: 'RESULT' } });
r = await call(hr, 'GET', 'export', { cookie: h, query: { period: '2026-12' } });
wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.body);
const sum = wb.getWorksheet('TongHop').getRow(2).values;
const hdr = wb.getWorksheet('TongHop').getRow(1).values;
assert.equal(sum[hdr.indexOf('Trạng thái BĐH')], 'Đã duyệt'); assert.equal(sum[hdr.indexOf('Người duyệt BĐH')], 'hr@fpt.com');
assert.equal(sum[hdr.indexOf('Xếp hạng BĐH')], 'E'); ok('Excel: cột BĐH được điền (trạng thái, điểm, người duyệt, xếp hạng)');

// ---------------------------------------------------------------- mở lại / gửi lại
r = await call(hr, 'POST', 'resend-mail', { cookie: h, body: { kind: 'RESULT', periodId: '2026-12', userId: row.userId } });
assert.equal(r.body.data.sent, true); ok('HR gửi lại email xác nhận báo cáo');
r = await call(hr, 'POST', 'result-reopen', { cookie: h, body: { periodId: '2026-12', userId: row.userId } });
assert.equal(r.status, 200);
r = await call(hr, 'GET', 'overview', { cookie: h });
row = r.body.data.managers.find((x) => x.email === 'mgr1@fpt.com');
assert.equal(row.resultReopened, true); assert.equal(row.bdhStatus, 'Đang duyệt (nháp)'); ok('Mở lại báo cáo → BĐH duyệt về nháp');
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
ws = r.body.data; assert.equal(ws.editable, true);
r = await saveRes({ requestId: rid(), baseVersionId: ws.latestVersionId, status: 'SUBMITTED', results: final.map((x) => ({ ...x, completion: 'COMPLETED', reason: '' })) });
assert.equal(r.body.data.totalScore, 10); ok('Manager sửa & nộp lại báo cáo: 10/10');
r = await call(hr, 'POST', 'review-save', { cookie: h, body: { periodId: '2026-12', userId: row.userId, resultVersionId: d.resultVersionId, approve: true, decisions } });
expectErr(r, 409, /đã thay đổi/); ok('Duyệt trên báo cáo cũ → chặn');

// ================================================================ Users admin
r = await call(hr, 'POST', 'user-save', { cookie: h, body: { email: 'x@fpt.com', full_name: 'X', role: 'Manager', is_hr: true } });
expectErr(r, 403, /Chỉ Admin/); ok('HR thường không cấp được quyền isHR');
r = await call(hr, 'POST', 'user-save', { cookie: h, body: { email: 'new@gmail.com', role: 'Manager' } });
expectErr(r, 400, /@fpt\.com/); ok('Chỉ nhận email @fpt.com');
r = await call(hr, 'POST', 'user-save', { cookie: h, body: { email: 'new@fpt.com', full_name: 'Mới', department: 'BU', role: 'Manager', cc_emails: 'a@fpt.com; b@fpt.com' } });
assert.deepEqual(r.body.data.cc_emails, ['a@fpt.com', 'b@fpt.com']); ok('Thêm Manager, tách CC');
const m2Id = (await db.query(`SELECT id FROM users WHERE email='mgr2@fpt.com'`)).rows[0].id;
r = await call(hr, 'POST', 'user-save', { cookie: a, body: { id: m2Id, email: 'mgr2@fpt.com', full_name: 'Trần Thị B', role: 'Manager', active: false } });
r = await call(manager, 'GET', 'workspace', { cookie: m2 });
expectErr(r, 401); ok('Khóa user → phiên bị thu hồi ngay');
r = await call(auth, 'POST', 'logout', { cookie: m1 });
r = await call(manager, 'GET', 'workspace', { cookie: m1 });
expectErr(r, 401); ok('Đăng xuất → phiên bị thu hồi');

r = await call(cron, 'GET', 'cleanup');
assert.equal(r.status, 401);
r = await call(cron, 'GET', 'cleanup', { headers: { authorization: 'Bearer cron-secret' } });
assert.equal(r.status, 200); ok('Cron dọn dẹp cần CRON_SECRET');

console.log(`\nTất cả ${step} bước PASS ✅`);
