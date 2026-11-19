import { query } from '../lib/db.js';

// Vercel Cron: GET /api/cron?action=cleanup (header Authorization: Bearer <CRON_SECRET>)
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  try {
    const otp = await query(`DELETE FROM otp_challenges WHERE created_at < now() - interval '7 days' RETURNING id`);
    const ses = await query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' RETURNING token_hash`);
    // Email kẹt PROCESSING > 15 phút (function bị dừng giữa chừng) → FAILED để HR gửi lại
    const stuck = [];
    for (const t of ['plan_versions', 'result_versions', 'bdh_reviews']) {
      stuck.push(...await query(`UPDATE ${t} SET mail_status = 'FAILED', mail_last_error = 'Quá thời gian xử lý'
        WHERE mail_status = 'PROCESSING' AND coalesce(${t === 'bdh_reviews' ? 'updated_at' : 'saved_at'}, now()) < now() - interval '15 minutes' RETURNING 1`));
    }
    return res.status(200).json({ ok: true, deleted: { otp: otp.length, sessions: ses.length }, mailStuck: stuck.length });
  } catch (e) {
    console.error('cron cleanup failed', e);
    return res.status(500).json({ ok: false });
  }
}
