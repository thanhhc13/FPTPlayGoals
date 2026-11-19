// Tạo/cập nhật bảng trên Neon.
//   node --env-file=.env scripts/migrate.mjs
//   node --env-file=.env scripts/migrate.mjs --admin ten@fpt.com "Họ tên"
import { readFile } from 'node:fs/promises';
import { getPool } from '../lib/db.js';

const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = getPool();
await pool.query(sql);
console.log('✔ Schema đã cập nhật');

const i = process.argv.indexOf('--admin');
if (i > -1) {
  const email = String(process.argv[i + 1] || '').trim().toLowerCase();
  const name = process.argv[i + 2] || '';
  if (!email.includes('@')) throw new Error('Thiếu email sau --admin');
  await pool.query(
    `INSERT INTO users (email, full_name, role, is_hr, is_admin) VALUES ($1, $2, 'HR', true, true)
     ON CONFLICT (email) DO UPDATE SET is_hr = true, is_admin = true, active = true, updated_at = now()`, [email, name]);
  console.log(`✔ Admin (isHR + Admin): ${email}`);
}
await pool.end();
