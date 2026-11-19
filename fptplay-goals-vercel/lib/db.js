import pg from 'pg';

// numeric -> number (mặc định pg trả về string)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> giữ nguyên chuỗi YYYY-MM-DD, tránh lệch múi giờ
pg.types.setTypeParser(1082, (v) => v);

let pool = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('Thiếu biến môi trường DATABASE_URL');
    pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
  }
  return pool;
}

/** Dùng cho test: thay pool bằng adapter khác (vd PGlite). */
export function setPool(p) { pool = p; }

function wrap(runner) {
  const q = async (text, params = []) => (await runner.query(text, params)).rows;
  return { query: q, one: async (text, params) => (await q(text, params))[0] || null };
}

export const query = (text, params) => wrap(getPool()).query(text, params);
export const one = (text, params) => wrap(getPool()).one(text, params);

/** Chạy fn trong 1 transaction. fn nhận { query, one }. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(userId, action, entity, entityId, data = {}) {
  try {
    await query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
      [userId ?? null, action, entity ?? null, entityId == null ? null : String(entityId), JSON.stringify(data)]
    );
  } catch (e) {
    console.error('audit failed', e);
  }
}
