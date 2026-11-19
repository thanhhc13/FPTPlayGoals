export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const bad = (code, msg) => new HttpError(400, code, msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') => new HttpError(403, 'FORBIDDEN', msg);
export const conflict = (code, msg) => new HttpError(409, code, msg);
export const notFound = (msg = 'Không tìm thấy dữ liệu.') => new HttpError(404, 'NOT_FOUND', msg);

export function getQuery(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

export function getBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

export function getIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}

/**
 * Router theo ?action=. routes = { 'GET state': fn, 'POST plan-save': fn }
 * fn(req, res) trả về data → { ok: true, data }. Nếu fn tự ghi res thì router bỏ qua.
 */
export function router(routes) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const action = String(getQuery(req).action || '');
    const fn = routes[`${req.method} ${action}`];
    if (!fn) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'API không tồn tại.' });

    // Chặn POST từ origin khác (chống CSRF, cookie đã SameSite=Lax)
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try { host = new URL(origin).host; } catch { /* ignore */ }
        if (host !== req.headers.host) {
          return res.status(403).json({ ok: false, error: 'BAD_ORIGIN', message: 'Yêu cầu không hợp lệ.' });
        }
      }
    }

    try {
      const data = await fn(req, res);
      if (!res.writableEnded) res.status(200).json({ ok: true, data: data ?? null });
    } catch (err) {
      let status = err.status || 500;
      let code = err.code || 'ERROR';
      let message = err.status ? err.message : 'Lỗi hệ thống, vui lòng thử lại.';
      if (err.code === '23505') { // unique_violation từ Postgres
        status = 409; code = 'CONFLICT';
        message = 'Dữ liệu vừa được cập nhật ở nơi khác. Vui lòng tải lại trang.';
      }
      if (status >= 500) console.error(`[${req.method} ${action}]`, err);
      if (!res.writableEnded) res.status(status).json({ ok: false, error: code, message });
    }
  };
}
