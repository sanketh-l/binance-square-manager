const oneDayMs = 24 * 60 * 60 * 1000;

export async function listPosts(db, opts = {}) {
  const { accountId, from, to, page = 1, limit = 20 } = opts;
  let sql = 'SELECT p.*, a.name AS account_name, a.key_mask FROM posts p JOIN accounts a ON a.id = p.account_id';
  const where = [];
  const values = [];
  if (accountId) { where.push('p.account_id = ?'); values.push(accountId); }
  if (from) { where.push('p.posted_at >= ?'); values.push(from); }
  if (to) { where.push('p.posted_at <= ?'); values.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.posted_at DESC LIMIT ? OFFSET ?';
  const p = Math.max(1, page), l = Math.min(100, Math.max(1, limit));
  values.push(l, (p - 1) * l);
  const { results } = await db.prepare(sql).bind(...values).all();
  const total = await db.prepare('SELECT COUNT(*) AS n FROM posts').first();
  return { posts: results, total: total ? total.n : 0, page: p, limit: l };
}

export async function recordPost(db, body) {
  const { accountId, coin, text, imageUrl, postUrl, contentId, status, error, format, hook, qualityScore, postedAt } = body;
  if (!accountId) return { error: 'accountId required', status: 400 };
  const finalStatus = status || 'published';
  const result = await db.prepare(
    `INSERT INTO posts (account_id, coin, text, image, post_url, content_id, status, error, format, hook, quality_score, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    accountId, coin || null, text || null, imageUrl || null, postUrl || null, contentId || null,
    finalStatus, error || null, format || null, hook || null, qualityScore || null,
    postedAt || new Date().toISOString()
  ).run();
  const newId = result.meta.last_row_id;
  if (finalStatus === 'published') {
    await db.prepare(
      `UPDATE accounts SET last_post_at = ?, posts24h = posts24h + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(postedAt || new Date().toISOString(), accountId).run();
  }
  return { id: newId };
}

export async function overview(db, accountId) {
  const dayAgo = new Date(Date.now() - oneDayMs).toISOString();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);

  const totalRes = await db.prepare('SELECT COUNT(*) AS c FROM posts').first();
  const todayRes = await db.prepare('SELECT COUNT(*) AS c FROM posts WHERE posted_at >= ?').bind(today.toISOString()).first();
  const publishedRes = await db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status = 'published'`).first();
  const failedRes = await db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status = 'failed'`).first();

  const lastRes = await db.prepare(
    'SELECT p.*, a.name AS account_name FROM posts p JOIN accounts a ON a.id = p.account_id ORDER BY p.posted_at DESC LIMIT 5'
  ).all();

  const accountsRes = await db.prepare(
    `SELECT a.id, a.name, a.enabled, a.mode, a.interval_min, a.daily_cap, a.key_mask, a.last_post_at,
       (SELECT COUNT(*) FROM posts p WHERE p.account_id = a.id) AS total_posts,
       (SELECT COUNT(*) FROM posts p WHERE p.account_id = a.id AND p.posted_at >= ?) AS posts_today
     FROM accounts a ORDER BY a.name`
  ).bind(today.toISOString()).all();

  const acts = (accountsRes.results || []).map((a) => {
    const capped = a.daily_cap > 0 && a.posts_today >= a.daily_cap;
    return {
      id: a.id, name: a.name, enabled: a.enabled ? true : false, mode: a.mode,
      keyMask: a.key_mask, lastPostAt: a.last_post_at,
      totalPosts: a.total_posts || 0, postsToday: a.posts_today || 0,
      intervalMin: a.interval_min, dailyCap: a.daily_cap,
      cappedToday: capped
    };
  });

  return {
    totals: {
      total: totalRes ? totalRes.c : 0,
      today: todayRes ? todayRes.c : 0,
      published: publishedRes ? publishedRes.c : 0,
      failed: failedRes ? failedRes.c : 0
    },
    lastPosts: lastRes.results || [],
    accounts: acts
  };
}