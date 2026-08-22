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
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
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
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const accountId = url.searchParams.get('accountId') || undefined;
      return ok(await overview(db, accountId));
    }

    if (path === '/api/stats/series' && method === 'GET') {
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 14)));
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const startMs = end.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
      const { results } = await db.prepare(
        `SELECT date(posted_at) AS day, COUNT(*) AS n, SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published
         FROM posts WHERE posted_at >= ? GROUP BY date(posted_at) ORDER BY day`
      ).bind(new Date(startMs).toISOString()).all();
      const map = {};
      for (const r of (results || [])) map[r.day] = { total: r.n, published: r.published || 0 };
      const series = [];
      for (let i = 0; i < days; i++) {
        const key = new Date(startMs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        series.push({ day: key, total: (map[key] || {}).total || 0, published: (map[key] || {}).published || 0 });
      }
      return ok({ series });
    }

    // ---- Engagement time-series (views/reactions over time)
    if (path === '/api/stats/engagement-series' && method === 'GET') {
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
      const accountId = url.searchParams.get('accountId') || undefined;
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const startMs = end.getTime() - (days - 1) * 24 * 60 * 60 * 1000;

      let sql = `SELECT date(posted_at) AS day, 
                        SUM(COALESCE(views, 0)) AS total_views,
                        SUM(COALESCE(reactions, 0)) AS total_reactions,
                        COUNT(*) AS posts_count
                 FROM posts WHERE posted_at >= ?`;
      const params = [new Date(startMs).toISOString()];
      if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
      sql += ' GROUP BY date(posted_at) ORDER BY day';

      const { results } = await db.prepare(sql).bind(...params).all();
      const map = {};
      for (const r of (results || [])) {
        map[r.day] = { views: r.total_views || 0, reactions: r.total_reactions || 0, posts: r.posts_count || 0 };
      }
      const series = [];
      for (let i = 0; i < days; i++) {
        const key = new Date(startMs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        series.push({ day: key, ...(map[key] || { views: 0, reactions: 0, posts: 0 }) });
      }
      return ok({ series });
    }

    // ---- Per-account performance comparison
    if (path === '/api/stats/account-performance' && method === 'GET') {
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
      const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      start.setUTCHours(0, 0, 0, 0);

      const { results } = await db.prepare(
        `SELECT a.id, a.name, a.mode,
                COUNT(p.id) AS total_posts,
                SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published,
                SUM(COALESCE(p.views, 0)) AS total_views,
                SUM(COALESCE(p.reactions, 0)) AS total_reactions,
                AVG(COALESCE(p.views, 0)) AS avg_views,
                AVG(COALESCE(p.reactions, 0)) AS avg_reactions
         FROM accounts a
         LEFT JOIN posts p ON p.account_id = a.id AND p.posted_at >= ?
         GROUP BY a.id, a.name, a.mode
         ORDER BY total_views DESC`
      ).bind(start.toISOString()).all();

      const accounts = (results || []).map(r => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        totalPosts: r.total_posts || 0,
        published: r.published || 0,
        totalViews: r.total_views || 0,
        totalReactions: r.total_reactions || 0,
        avgViews: Math.round(r.avg_views || 0),
        avgReactions: Math.round(r.avg_reactions || 0),
        engagementRate: r.total_views > 0 ? Number(((r.total_reactions / r.total_views) * 100).toFixed(2)) : 0
      }));
      return ok({ accounts, days });
    }

    // ---- Top posts by engagement
    if (path === '/api/stats/top-posts' && method === 'GET') {
      if (!isAdmin && !isBot) return fail('Unauthorized', 401);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10)));
      const sortBy = url.searchParams.get('sortBy') || 'views';
      const accountId = url.searchParams.get('accountId') || undefined;
      const validSorts = ['views', 'reactions', 'engagementRate'];
      const sort = validSorts.includes(sortBy) ? sortBy : 'views';

      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const startMs = end.getTime() - (days - 1) * 24 * 60 * 60 * 1000;

      const orderBy = sort === 'engagementRate' 
        ? 'CASE WHEN views > 0 THEN (reactions * 1.0 / views) ELSE 0 END DESC'
        : `${sort} DESC`;

      let topSql = `SELECT p.*, a.name AS account_name
         FROM posts p
         JOIN accounts a ON a.id = p.account_id
         WHERE p.posted_at >= ? AND p.status = 'published'`;
      const topParams = [new Date(startMs).toISOString()];
      if (accountId) { topSql += ' AND p.account_id = ?'; topParams.push(accountId); }
      topSql += ` ORDER BY ${orderBy} LIMIT ?`;
      topParams.push(limit);
      const { results } = await db.prepare(topSql).bind(...topParams).all();

      const posts = (results || []).map(p => ({
        ...p,
        engagementRate: p.views > 0 ? Number(((p.reactions / p.views) * 100).toFixed(2)) : 0
      }));
      return ok({ posts });
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

    // ---- Cron webhook (for cron-job.org) - triggers GitHub Actions
    if (path === '/api/cron/trigger' && method === 'POST') {
      const cronSecret = request.headers.get('X-Cron-Secret');
      if (!cronSecret || cronSecret !== env.CRON_SECRET) {
        return fail('Unauthorized', 401);
      }
      // Trigger GitHub Actions workflow_dispatch
      const ghUrl = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/automate.yml/dispatches`;
      fetch(ghUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GH_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main' })
      }).catch(() => {});
      return ok({ ok: true, triggered: true });
    }

    return fail('Not found', 404);
  }
};