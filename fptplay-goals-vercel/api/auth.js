import { router, getBody, getIp } from '../lib/http.js';
import { requestOtp, verifyOtp, requireUser, logout, publicUser } from '../lib/auth.js';

// /api/auth?action=request-otp | verify-otp | me | logout
export default router({
  'POST request-otp': async (req) => requestOtp(getBody(req).email, getIp(req)),
  'POST verify-otp': async (req, res) => { const b = getBody(req); return verifyOtp(b.challengeId, b.code, req, res); },
  'GET me': async (req) => publicUser(await requireUser(req)),
  'POST logout': async (req, res) => { await logout(req, res); return { ok: true }; },
});
