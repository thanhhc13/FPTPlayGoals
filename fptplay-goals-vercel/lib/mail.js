import nodemailer from 'nodemailer';
import { mscRankFromScore, GROUPS } from './msc.js';

// ============================================================ CẤU HÌNH LIÊN HỆ FHR
// Sửa lời văn / người liên hệ tại đây (giữ đúng như email Apps Script cũ).
const SENDER_NAME = 'Phòng Nhân sự FPT Play';
const SUPPORT_PLAN = ['ThanhHC14@fpt.com', 'ThanhHC14@fpt.com'];   // email OTP, kế hoạch, BĐH, sửa KH
const SUPPORT_RESULT = ['ThanhHC14@fpt.com', 'ThanhHC14@fpt.com'];   // email báo cáo kết quả

// ============================================================ gửi mail
let transporter = null;
export const sentMails = []; // chỉ dùng khi MAIL_DRY_RUN=1 (test / chạy local)

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  return transporter;
}

const norm = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gửi 1 email. cc tự lọc trùng / trùng người nhận / sai định dạng (giống getManagerCcEmails_). */
export async function sendMail({ to, cc, subject, text, html, meta }) {
  const toList = [...new Set([].concat(to).map(norm).filter(Boolean))];
  const seen = new Set(toList);
  const ccList = [];
  for (const a of (cc || []).map(norm)) if (a && EMAIL_RE.test(a) && !seen.has(a)) { seen.add(a); ccList.push(a); }
  const fromAddr = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@fpt.com';
  const from = /</.test(fromAddr) ? fromAddr : `"${SENDER_NAME}" <${fromAddr}>`;
  const msg = { from, to: toList, cc: ccList, subject, text, html };
  if (process.env.MAIL_DRY_RUN === '1') { sentMails.push({ ...msg, meta }); return { messageId: 'dry-run' }; }
  
  return getTransporter().sendMail(msg);
}

// ============================================================ helpers
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (v) => esc(v).replace(/\r?\n/g, '<br>');
const f2 = (n) => Number(n).toFixed(2);
const APP = () => process.env.APP_URL || '';

function footerText(contacts) {
  return ['', 'Trân trọng,', `${SENDER_NAME}.`, '', '------------------------------------------------------------',
    'Đây là email tự động từ hệ thống. Anh/Chị vui lòng không trả lời email này.',
    `Để được hỗ trợ, vui lòng liên hệ FHR: ${contacts.join(' hoặc ')}`];
}
function frame(titleHtml, inner, contacts) {
  const links = contacts.map((c) => `<a href="mailto:${esc(c)}">${esc(c)}</a>`).join(' hoặc ');
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:18px;background:#f3f6fb;font-family:Arial,sans-serif;color:#17324d;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;margin:0 auto;border:2px solid #0876e8;border-collapse:collapse;background:#ffffff;">
<tr><td style="padding:24px;background:#0876e8;color:#ffffff;text-align:center;font-size:20px;font-weight:bold;line-height:1.4;">${titleHtml}</td></tr>
${inner}
<tr><td style="padding:24px 22px;line-height:1.7;">Trân trọng,<br><strong>${SENDER_NAME}.</strong>
<hr style="margin:24px 0 14px;border:0;border-top:1px solid #cbd5e1;">
<p style="margin:0 0 8px;color:#62758a;font-size:12px;font-style:italic;">Đây là email tự động từ hệ thống. Anh/Chị vui lòng không trả lời email này.</p>
<p style="margin:0;color:#62758a;font-size:12px;">Để được hỗ trợ, vui lòng liên hệ FHR – ${links}.</p>
</td></tr></table></body></html>`;
}
const groupsOf = (details) => GROUPS.map((group) => ({ group, tasks: details.filter((t) => t.msc === group) })).filter((g) => g.tasks.length);
const groupHead = (group, color = '#0876e8', border = '#dce9f7') =>
  `<tr><td style="padding:12px 22px;background:#eef6ff;border-bottom:1px solid ${border};color:${color};font-size:16px;font-weight:bold;">Nhóm ${esc(group)}</td></tr>`;
const p = (html, m = '0 0 8px') => `<p style="margin:${m};">${html}</p>`;

// ============================================================ OTP
export function buildOtpEmail(otp) {
  const code = String(otp || '').trim();
  const subject = '[FPT Play Goals] Mã xác nhận đăng nhập';
  const text = ['Kính gửi Anh/Chị,', '', 'Mã xác nhận đăng nhập FPT Play Goals:', code, '',
    'Mã có hiệu lực trong 5 phút.', 'Nếu Anh/Chị không yêu cầu mã, vui lòng bỏ qua email.', ...footerText(SUPPORT_PLAN)].join('\n');
  const html = frame('MÃ XÁC NHẬN ĐĂNG NHẬP<br>FPT Play Goals', `
<tr><td style="padding:24px 22px;line-height:1.7;">${p('Kính gửi Anh/Chị,', '0 0 16px')}${p('Mã xác nhận đăng nhập FPT Play Goals của Anh/Chị là:', '0')}</td></tr>
<tr><td style="padding:22px;background:#eef6ff;text-align:center;"><span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;color:#0876e8;">${esc(code)}</span></td></tr>
<tr><td style="padding:24px 22px 0;line-height:1.7;">${p('Mã có hiệu lực trong <strong>5 phút</strong>. Nếu Anh/Chị không yêu cầu mã, vui lòng bỏ qua email này.', '0')}</td></tr>`, SUPPORT_PLAN);
  return { subject, text, html };
}

// ============================================================ Xác nhận KẾ HOẠCH (buildMscPlanEmail_)
export function buildMscPlanEmail(job) {
  const name = job.name || job.email;
  const available = job.details.reduce((s, t) => s + Number(t.maxPoints), 0);
  const groups = groupsOf(job.details);
  const subject = `[FPT Play Goals] Xác nhận đăng ký mục tiêu công việc - ${job.periodName}`;
  const plain = groups.map(({ group, tasks }) => `Nhóm ${group}\n\n` + tasks.map((t, i) => [
    `Mục tiêu ${i + 1}: ${t.title}`, `Kết quả cam kết: ${t.target}`, `Điểm khi hoàn thành: ${f2(t.maxPoints)}`].join('\n')).join('\n\n')).join('\n\n');
  const note = 'Điểm đánh giá cuối tháng được xác định theo kết quả thực hiện mục tiêu và phê duyệt của cấp quản lý có thẩm quyền, làm căn cứ xác định hệ số lương KPI (nếu áp dụng).';
  const text = [`Kính gửi Anh/Chị ${name},`, '', 'Hệ thống đã ghi nhận Anh/Chị đăng ký thành công mục tiêu công việc tháng, với nội dung như sau:',
    '', plain, '', `Tổng điểm tối đa theo các mục tiêu đã đăng ký: ${available.toFixed(2)}/10.`, '', note, ...footerText(SUPPORT_PLAN)].join('\n');
  const rows = groups.map(({ group, tasks }) => groupHead(group) + tasks.map((t, i) => `
<tr><td style="padding:16px 22px;border-bottom:1px solid #dce9f7;line-height:1.7;">
<strong style="color:#17324d;">Mục tiêu ${i + 1}: ${esc(t.title)}</strong><br>
<strong>Kết quả cam kết:</strong> ${lines(t.target)}<br>
<strong>Điểm khi hoàn thành:</strong> ${f2(t.maxPoints)}</td></tr>`).join('')).join('');
  const html = frame(`XÁC NHẬN ĐĂNG KÝ MỤC TIÊU CÔNG VIỆC<br>${esc(job.periodName)}`, `
<tr><td style="padding:20px 22px;line-height:1.7;">${p(`Kính gửi Anh/Chị <strong>${esc(name)},</strong>`)}${p('Hệ thống đã ghi nhận Anh/Chị đăng ký thành công mục tiêu công việc tháng, với nội dung như sau:', '0')}</td></tr>
${rows}
<tr><td style="padding:18px 22px;background:#fff3e6;line-height:1.7;"><strong>Tổng điểm tối đa theo các mục tiêu đã đăng ký: ${available.toFixed(2)}/10</strong>${p(note, '0')}</td></tr>`, SUPPORT_PLAN);
  return { subject, text, html };
}

// ============================================================ Xác nhận BÁO CÁO (buildMscResultEmail_)
function resultBlocks(groups, { bdh = false } = {}) {
  const plain = groups.map(({ group, tasks }) => `Nhóm ${group}\n\n` + tasks.map((t, i) => {
    const l = [`Mục tiêu ${i + 1}: ${t.title}`, `Kết quả cam kết: ${t.target}`, `Kết quả thực tế: ${t.actual}`];
    if (t.evidence) l.push(`Số liệu / minh chứng: ${t.evidence}`);
    l.push(`${bdh ? 'Tự đánh giá' : 'Trạng thái'}: ${t.completion === 'COMPLETED' ? 'Hoàn thành' : 'Không hoàn thành'}`);
    if (t.completion === 'NOT_COMPLETED' && t.reason) l.push(`Nguyên nhân không hoàn thành: ${t.reason}`);
    if (bdh) {
      l.push(`BĐH duyệt: ${t.bdhCompletion === 'COMPLETED' ? 'Hoàn thành' : 'Không hoàn thành'}`);
      if (t.bdhNote) l.push(`Ghi chú BĐH: ${t.bdhNote}`);
      l.push(`Điểm BĐH duyệt: ${f2(t.bdhEarned)}`);
    } else l.push(`Điểm đạt: ${f2(t.earnedPoints)}`);
    return l.join('\n');
  }).join('\n\n')).join('\n\n');
  const html = groups.map(({ group, tasks }) => groupHead(group, '#a54800', '#f3ddc6') + tasks.map((t, i) => `
<tr><td style="padding:16px 22px;border-bottom:1px solid #dce9f7;line-height:1.7;">
<strong style="color:#17324d;">Mục tiêu ${i + 1}: ${esc(t.title)}</strong><br>
<strong>Kết quả cam kết:</strong> ${lines(t.target)}<br>
<strong>Kết quả thực tế:</strong> ${lines(t.actual)}
${t.evidence ? `<br><strong>Số liệu / minh chứng:</strong> ${lines(t.evidence)}` : ''}<br>
<strong>${bdh ? 'Tự đánh giá' : 'Trạng thái'}:</strong> ${t.completion === 'COMPLETED' ? 'Hoàn thành' : 'Không hoàn thành'}
${t.completion === 'NOT_COMPLETED' && t.reason ? `<br><strong>Nguyên nhân không hoàn thành:</strong> ${lines(t.reason)}` : ''}
${bdh ? `<br><strong>BĐH duyệt:</strong> <span style="color:${t.bdhCompletion === 'COMPLETED' ? '#166534' : '#991b1b'};font-weight:bold;">${t.bdhCompletion === 'COMPLETED' ? 'Hoàn thành' : 'Không hoàn thành'}</span>
${t.bdhNote ? `<br><strong>Ghi chú BĐH:</strong> ${lines(t.bdhNote)}` : ''}<br><strong>Điểm BĐH duyệt:</strong> ${f2(t.bdhEarned)}`
    : `<br><strong>Điểm đạt:</strong> ${f2(t.earnedPoints)}`}
</td></tr>`).join('')).join('');
  return { plain, html };
}
const scoreBox = (title, score, rank, extra) => `
<tr><td style="padding:20px 22px;background:#eef6ff;line-height:1.9;"><strong>${title}</strong>
<ul style="margin:8px 0 0;padding-left:22px;">
<li>Điểm đánh giá: <span style="color:#0876e8;font-weight:bold;">${f2(score)}/10</span></li>
<li>Xếp hạng: <span style="color:#0876e8;font-weight:bold;">${esc(rank.rank)}</span></li>
<li>Hệ số KPI: <span style="color:#0876e8;font-weight:bold;">${esc(rank.coefficient)}</span></li></ul>
${extra}</td></tr>`;

export function buildMscResultEmail(job) {
  const name = job.name || job.email;
  const rank = mscRankFromScore(job.totalScore);
  const groups = groupsOf(job.details);
  const subject = `[FPT Play Goals] Xác nhận hoàn tất tự đánh giá công việc - ${job.periodName}`;
  const b = resultBlocks(groups);
  const final = 'Điểm ghi nhận cuối cùng làm căn cứ tính KPI (nếu có) là điểm được Ban Điều hành phê duyệt.';
  const text = [`Kính gửi Anh/Chị ${name},`, '',
    `Anh/Chị đã hoàn tất tự đánh giá kết quả thực hiện công việc ${job.periodName}. Phòng Nhân sự sẽ tổng hợp và trình Ban Điều hành xem xét, phê duyệt.`,
    '', 'Nội dung đã nộp:', '', b.plain, '', 'Kết quả tự đánh giá:', `   • Điểm đánh giá: ${f2(job.totalScore)}/10`,
    `   • Xếp hạng: ${rank.rank}`, `   • Hệ số KPI: ${rank.coefficient}`, final, ...footerText(SUPPORT_RESULT)].join('\n');
  const html = frame(`BÁO CÁO TỰ ĐÁNH GIÁ CÔNG VIỆC<br>${esc(job.periodName)}`, `
<tr><td style="padding:18px 22px;line-height:1.7;">${p(`Kính gửi Anh/Chị <strong>${esc(name)},</strong>`)}
${p(`Anh/Chị đã hoàn tất tự đánh giá kết quả thực hiện công việc <strong>${esc(job.periodName)}</strong>. Phòng Nhân sự sẽ tổng hợp và trình Ban Điều hành xem xét, phê duyệt.`)}
${p('<strong>Nội dung đã nộp:</strong>', '0')}</td></tr>${b.html}
${scoreBox('Kết quả tự đánh giá:', job.totalScore, rank, p(final, '12px 0 0'))}`, SUPPORT_RESULT);
  return { subject, text, html };
}

// ============================================================ BĐH đã duyệt (mới)
export function buildBdhApprovedEmail(job) {
  const name = job.name || job.email;
  const rank = mscRankFromScore(job.bdhScore);
  const selfRank = mscRankFromScore(job.selfScore);
  const groups = groupsOf(job.details);
  const subject = `[FPT Play Goals] Kết quả đánh giá KPI được Ban Điều hành phê duyệt - ${job.periodName}`;
  const b = resultBlocks(groups, { bdh: true });
  const text = [`Kính gửi Anh/Chị ${name},`, '', `Kết quả đánh giá công việc ${job.periodName} của Anh/Chị đã được Ban Điều hành phê duyệt.`,
    '', b.plain, '', `Điểm tự đánh giá: ${f2(job.selfScore)}/10 (${selfRank.rank})`, 'Điểm BĐH phê duyệt:',
    `   • Điểm đánh giá: ${f2(job.bdhScore)}/10`, `   • Xếp hạng: ${rank.rank}`, `   • Hệ số KPI: ${rank.coefficient}`,
    job.comment ? `\nNhận xét của Ban Điều hành:\n${job.comment}` : '', ...footerText(SUPPORT_PLAN)].join('\n');
  const html = frame(`KẾT QUẢ ĐÁNH GIÁ KPI ĐƯỢC PHÊ DUYỆT<br>${esc(job.periodName)}`, `
<tr><td style="padding:18px 22px;line-height:1.7;">${p(`Kính gửi Anh/Chị <strong>${esc(name)},</strong>`)}
${p(`Kết quả đánh giá công việc <strong>${esc(job.periodName)}</strong> của Anh/Chị đã được Ban Điều hành phê duyệt.`, '0')}</td></tr>${b.html}
${scoreBox('Điểm Ban Điều hành phê duyệt:', job.bdhScore, rank,
    p(`Điểm tự đánh giá: ${f2(job.selfScore)}/10 (${esc(selfRank.rank)})`, '12px 0 0')
    + (job.comment ? p(`<strong>Nhận xét của Ban Điều hành:</strong><br>${lines(job.comment)}`, '12px 0 0') : ''))}`, SUPPORT_PLAN);
  return { subject, text, html };
}

// ============================================================ Xin sửa kế hoạch (mới)
export function buildEditRequestEmail({ user, period, reason }) {
  const subject = `[FPT Play Goals] Yêu cầu sửa kế hoạch – ${user.full_name || user.email} (${period.name})`;
  const text = [`${user.full_name || user.email} (${user.department}) xin sửa kế hoạch đã nộp kỳ ${period.name}.`, '', `Lý do: ${reason}`, '',
    `Duyệt / từ chối tại trang HR: ${APP()}/hr`].join('\n');
  const html = frame('YÊU CẦU SỬA KẾ HOẠCH ĐÃ NỘP', `<tr><td style="padding:20px 22px;line-height:1.7;">
${p(`<strong>${esc(user.full_name || user.email)}</strong> (${esc(user.department)}) xin sửa kế hoạch đã nộp kỳ <strong>${esc(period.name)}</strong>.`)}
${p(`<strong>Lý do:</strong><br>${lines(reason)}`)}${APP() ? p(`Duyệt / từ chối tại <a href="${esc(APP())}/hr">trang HR</a>.`, '0') : ''}</td></tr>`, SUPPORT_PLAN);
  return { subject, text, html };
}

export function buildEditDecisionEmail({ user, period, approved, note }) {
  const name = user.full_name || user.email;
  const subject = `[FPT Play Goals] Yêu cầu sửa kế hoạch ${approved ? 'đã được chấp thuận' : 'không được chấp thuận'} - ${period.name}`;
  const body = approved
    ? 'Yêu cầu sửa kế hoạch của Anh/Chị đã được chấp thuận. Anh/Chị vui lòng truy cập FPT Play Goals để chỉnh sửa và nộp lại kế hoạch. Kế hoạch đã nộp trước đó vẫn có hiệu lực cho đến khi Anh/Chị nộp lại.'
    : 'Yêu cầu sửa kế hoạch của Anh/Chị không được chấp thuận. Kế hoạch đã nộp tiếp tục được áp dụng.';
  const text = [`Kính gửi Anh/Chị ${name},`, '', body, note ? `\nGhi chú của HR: ${note}` : '', ...footerText(SUPPORT_PLAN)].join('\n');
  const html = frame(`KẾT QUẢ YÊU CẦU SỬA KẾ HOẠCH<br>${esc(period.name)}`, `<tr><td style="padding:20px 22px;line-height:1.7;">
${p(`Kính gửi Anh/Chị <strong>${esc(name)},</strong>`)}${p(body)}${note ? p(`<strong>Ghi chú của HR:</strong><br>${lines(note)}`, '0') : ''}
${approved && APP() ? p(`<a href="${esc(APP())}">Mở FPT Play Goals</a>`, '8px 0 0') : ''}</td></tr>`, SUPPORT_PLAN);
  return { subject, text, html };
}
