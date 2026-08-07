import { createAccount, updateAccount, deleteAccount, getDecryptedKey, serializeAccount } from './accounts.js';
import { listPosts, recordPost, overview } from './posts.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Token, X-Bot-Token'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const json = () => request.json().catch(() => ({}));
    const ok = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
    const fail = (msg, status = 400) => ok({ error: msg }, status);

    // ---- Health check
    if (path === '/health' && method === 'GET') {
      return ok({ ok: true, service: 'binance-manager-api', time: new Date().toISOString() });
    }

    // ---- Auth
    const adminToken = request.headers.get('X-API-Token');
    const botToken = request.headers.get('X-Bot-Token');
    const isAdmin = adminToken && adminToken === env.ADMIN_TOKEN;
    const isBot = botToken && botToken === env.BOT_TOKEN;

    // ---- Accounts (admin only except bot listing)
    if (path === '/api/accounts' && method === 'GET') {
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const accs = await db.prepare(
        `SELECT a.*, 
           (SELECT COUNT(*) FROM posts p WHERE p.account_id = a.id AND p.posted_at >= datetime('now','-24 hours')) AS posts24h
         FROM accounts a ORDER BY a.name`
      ).all();
      const list = (accs.results || []).map((r) => {
        const a = serializeAccount(r);
        if (isBot) delete a.key_mask;
        return a;
      });
      return ok({ accounts: list });
    }

    if (path === '/api/accounts' && method === 'POST') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const body = await json();
      const created = await createAccount(db, env, body);
      if (created.error) return fail(created.error, created.status);
      return ok(created, 201);
    }

    if (path.startsWith('/api/accounts/') && method === 'PATCH') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const id = path.split('/')[3];
      const body = await json();
      const updated = await updateAccount(db, env, id, { ...body, id });
      if (updated.error) return fail(updated.error, updated.status);
      return ok(updated);
    }

    if (path.startsWith('/api/accounts/') && method === 'DELETE') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const id = path.split('/')[3];
      await deleteAccount(db, id);
      return ok({ ok: true });
    }

    if (path === '/api/accounts/key' && method === 'POST') {
      if (!isBot) return fail('Unauthorized', 401);
      const { id } = await json();
      if (!id) return fail('id required');
      const key = await getDecryptedKey(db, env, id);
      if (!key) return fail('Key not found or cannot decrypt', 404);
      return ok({ id, key });
    }

    // ---- Posts
    if (path === '/api/posts' && method === 'GET') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const params = Object.fromEntries(url.searchParams);
      return ok(await listPosts(db, params));
    }

    if (path === '/api/posts' && method === 'POST') {
      if (!isBot) return fail('Unauthorized', 401);
      const body = await json();
      const rec = await recordPost(db, body);
      if (rec.error) return fail(rec.error, rec.status);
      return ok({ ok: true, id: rec.id }, 201);
    }

    if (path === '/api/posts/status' && method === 'POST') {
      if (!isBot) return fail('Unauthorized', 401);
      const body = await json();
      if (!body.id) return fail('id required');
      await db.prepare(
        `UPDATE posts SET views = ?, reactions = ?, scraped_at = ? WHERE id = ?`
      ).bind(
        body.views !== undefined && body.views !== null ? body.views : null,
        body.reactions !== undefined && body.reactions !== null ? body.reactions : null,
        body.scrapedAt || new Date().toISOString(),
        body.id
      ).run();
      return ok({ ok: true });
    }

    // ---- Overview
    if (path === '/api/stats/overview' && method === 'GET') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const accountId = url.searchParams.get('accountId') || undefined;
      return ok(await overview(db, accountId));
    }

    if (path === '/api/stats/series' && method === 'GET') {
      if (!isAdmin) return fail('Unauthorized', 401);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 14)));
      const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      start.setUTCHours(0, 0, 0, 0);
      const { results } = await db.prepare(
        `SELECT date(posted_at) AS day, COUNT(*) AS n, SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published
         FROM posts WHERE posted_at >= ? GROUP BY date(posted_at) ORDER BY day`
      ).bind(start.toISOString()).all();
      const map = {};
      for (const r of (results || [])) map[r.day] = { total: r.n, published: r.published || 0 };
      const series = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        series.push({ day: key, total: (map[key] || {}).total || 0, published: (map[key] || {}).published || 0 });
      }
      return ok({ series });
    }

    // ---- Health of environment config
    if (path === '/api/health/env' && method === 'GET') {
      return ok({
        adminConfigured: !!env.ADMIN_TOKEN,
        botConfigured: !!env.BOT_TOKEN,
        encryptionConfigured: !!env.KEY_ENCRYPTION_SECRET,
        dbBound: !!db
      });
    }

    return fail('Not found', 404);
  }
};