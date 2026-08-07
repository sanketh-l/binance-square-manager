import fs from 'fs';

const API_URL = process.env.API_URL || 'http://localhost:8787';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const POSTS_PER_ACCOUNT = Number(process.env.SCRAPE_LIMIT || 50);

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Bot-Token': BOT_TOKEN, ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) throw new Error(`API ${path} => ${res.status}: ${json.error || text}`);
  return json;
}

async function scrapePostStats(contentId) {
  const urls = [
    `https://www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail/${contentId}`,
    `https://www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail?id=${contentId}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) continue;
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        const payload = data?.data?.content || data?.data || data;
        const views = extractNumber(payload, ['viewNum', 'views', 'viewCount', 'readCount', 'readNum', 'insNum']);
        const reactions = extractNumber(payload, ['likeNum', 'likes', 'reactionCount', 'favoriteNum', 'collectNum']);
        if (views !== null || reactions !== null) {
          return { views, reactions, scraped: true, url };
        }
      } catch {}
      const m = text.match(/"view(?:Count|Num)"\s*:\s*(\d+)/);
      if (m) return { views: Number(m[1]), reactions: null, scraped: true, url };
    } catch {}
  }
  return { views: null, reactions: null, scraped: false };
}

function extractNumber(payload, keys) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && !isNaN(Number(payload[key]))) {
      return Number(payload[key]);
    }
  }
  return null;
}

async function main() {
  console.log('=== Engagement Scrape (best-effort) ===');
  if (!BOT_TOKEN) { console.log('BOT_TOKEN not set. Skipping.'); return; }

  const { accounts } = await request('/api/accounts');
  let scraped = 0, failed = 0;
  for (const account of (accounts || [])) {
    try {
      const page = await request(`/api/posts?accountId=${account.id}&limit=${POSTS_PER_ACCOUNT}`);
      const targets = (page.posts || []).filter((p) => p.status === 'published' && p.content_id);
      if (targets.length === 0) continue;
      console.log(`\n[${account.name}] checking ${targets.length} posts`);
      for (const post of targets) {
        const stat = await scrapePostStats(post.content_id);
        if (stat.scraped) {
          await request('/api/posts/status', {
            method: 'POST',
            body: { id: post.id, views: stat.views, reactions: stat.reactions, scrapedAt: new Date().toISOString() }
          });
          scraped++;
          console.log(`  #${post.id} ${post.coin}: views=${stat.views ?? 'n/a'} reactions=${stat.reactions ?? 'n/a'}`);
        } else {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      console.log(`[${account.name}] scrape error: ${err.message}`);
    }
  }
  console.log(`\nDone: ${scraped} posts updated, ${failed} unreachable (fine - telemetry still works)`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });