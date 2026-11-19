// Chạy thử toàn bộ app trên máy, KHÔNG cần Neon / SMTP / tài khoản Vercel.
//   npm run dev:local   → mở http://localhost:3000  (Manager)  và  /hr  (HR)
// Database: PGlite trong bộ nhớ (mất khi tắt). Email không gửi thật – mã OTP in ra console.
// Tài khoản mẫu: admin@fpt.com (isHR + Admin), mgr1@fpt.com, mgr2@fpt.com (Manager), mgrhr@fpt.com (Manager + isHR)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.AUTH_SECRET ||= 'local-dev-secret-0123456789abcdef-0123456789';
process.env.MAIL_DRY_RUN = '1';
process.env.CRON_SECRET ||= 'local-cron';
const PORT = Number(process.env.PORT || 3000);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const { setPool } = await import('../lib/db.js');
const { sentMails } = await import('../lib/mail.js');
const db = new PGlite({ parsers: { 1700: (v) => (v === null ? null : Number(v)) } }); // numeric → number giống lib/db.js
await db.exec(await readFile(join(ROOT, 'db/schema.sql'), 'utf8'));
setPool({ query: (t, p) => db.query(t, p), connect: async () => ({ query: (t, p) => db.query(t, p), release() {} }) });
await db.exec(`
  INSERT INTO users (email, full_name, department, team, role, is_hr, is_admin, cc_emails) VALUES
   ('admin@fpt.com','Quản trị HR','Nhân sự','','HR',true,true,'{}'),
   ('mgr1@fpt.com','Nguyễn Văn A','Kỹ thuật','Backend','Manager',false,false,'{truongkhoi@fpt.com}'),
   ('mgr2@fpt.com','Trần Thị B','Kinh doanh','','Manager',false,false,'{}'),
   ('mgrhr@fpt.com','Lê Văn C','Nhân sự','','Manager',true,false,'{}');
  INSERT INTO kpi_periods (id, name, status, phase, plan_deadline, result_deadline)
   VALUES ('2026-12','Tháng 12/2026','OPEN','PLAN', now() + interval '10 days', now() + interval '40 days');`);

// In mã OTP ra console
const origPush = sentMails.push.bind(sentMails);
sentMails.push = (m) => { console.log(`📧 ${m.to.join(',')}${m.cc.length ? ` (cc ${m.cc.join(',')})` : ''} – ${m.subject}${m.meta?.otp ? `  → MÃ OTP: ${m.meta.otp}` : ''}`); return origPush(m); };

const handlers = {};
for (const n of ['auth', 'manager', 'hr', 'cron']) handlers[n] = (await import(`../api/${n}.js`)).default;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Vercel-like helpers
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
  res.send = (s) => res.end(s);

  if (url.pathname === '/__dev/otp') { // chỉ có ở bản local – để test tự động
    const m = [...sentMails].reverse().find((x) => x.to.includes(url.searchParams.get('email')) && x.meta?.otp);
    return res.end(m ? m.meta.otp : '');
  }

  const api = url.pathname.match(/^\/api\/(\w+)$/);
  if (api && handlers[api[1]]) {
    let raw = '';
    for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    req.query = Object.fromEntries(url.searchParams);
    return handlers[api[1]](req, res);
  }

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!extname(p)) p += '.html'; // cleanUrls
  const file = normalize(join(ROOT, 'public', p));
  if (!file.startsWith(join(ROOT, 'public'))) return res.status(403).end();
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.status(404).end('Not found'); }
}).listen(PORT, () => console.log(`▶ http://localhost:${PORT}  (Manager)   http://localhost:${PORT}/hr  (HR)\n  Đăng nhập: admin@fpt.com / mgr1@fpt.com – mã OTP in ở dòng 📧 bên dưới`));
