import { encryptPlaintext, decryptCipher } from './crypto.js';

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

export async function createAccount(db, env, body) {
  const name = String(body.name || '').trim();
  const binanceKey = String(body.binanceKey || '').trim();
  if (!name) return { error: 'Account name required', status: 400 };
  if (!binanceKey) return { error: 'Binance Square API key required', status: 400 };

  const mode = ['broadcast', 'unique'].includes(body.mode) ? body.mode : 'broadcast';
  const intervalMin = Number(body.intervalMin) >= 1 ? Number(body.intervalMin) : 60;
  const dailyCap = Number(body.dailyCap) >= 1 ? Number(body.dailyCap) : 50;
  const enabled = body.enabled !== false ? 1 : 0;

  const cipher = await encryptPlaintext(env.KEY_ENCRYPTION_SECRET, binanceKey);

  const info = await db.prepare(
    `INSERT INTO accounts (name, key_cipher, key_mask, mode, interval_min, daily_cap, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(name, cipher, maskKey(binanceKey), mode, intervalMin, dailyCap, enabled).run();

  return { id: info.meta.last_row_id, name, key_mask: maskKey(binanceKey), mode, intervalMin, dailyCap, enabled };
}

export async function updateAccount(db, env, id, body) {
  const current = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first();
  if (!current) return { error: 'Account not found', status: 404 };

  const updates = [];
  const values = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(String(body.name)); }
  if (body.mode !== undefined) { updates.push('mode = ?'); values.push(['broadcast', 'unique'].includes(body.mode) ? body.mode : 'broadcast'); }
  if (body.intervalMin !== undefined) { updates.push('interval_min = ?'); values.push(Math.max(1, Number(body.intervalMin))); }
  if (body.dailyCap !== undefined) { updates.push('daily_cap = ?'); values.push(Math.max(1, Number(body.dailyCap))); }
  if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
if (body.binanceKey) {
    const cipher = await encryptPlaintext(env.KEY_ENCRYPTION_SECRET, String(body.binanceKey));
    updates.push('key_cipher = ?'); values.push(cipher);
    updates.push('key_mask = ?'); values.push(maskKey(String(body.binanceKey)));
  }

  if (updates.length === 0) return current;
  updates.push('updated_at = datetime(\'now\')');
  values.push(id);
  await db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first();
}

export async function deleteAccount(db, id) {
  await db.prepare(`DELETE FROM posts WHERE account_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM accounts WHERE id = ?`).bind(id).run();
  return { ok: true };
}

export async function getDecryptedKey(db, env, id) {
  const row = await db.prepare(`SELECT id, key_cipher FROM accounts WHERE id = ?`).bind(id).first();
  if (!row || !row.key_cipher) return null;
  try {
    return await decryptCipher(env.KEY_ENCRYPTION_SECRET, row.key_cipher);
  } catch {
    return null;
  }
}

export function serializeAccount(row, includeRaw = false) {
  const a = {
    id: row.id,
    name: row.name,
    key_mask: row.key_mask,
    mode: row.mode,
    intervalMin: row.interval_min,
    dailyCap: row.daily_cap,
    enabled: row.enabled ? true : false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPostAt: row.last_post_at,
    posts24h: row.posts24h || 0
  };
  return a;
}