import fs from 'fs';
import path from 'path';
import { fetchAccounts, fetchDecryptedKey, reportPost } from './lib/api.mjs';
import { getTimeOfDay, fetchCoinGeckoTrending, fetchPriceData, fetchCoinGeckoChart, fetchUnsplashImage } from './lib/coingecko.mjs';
import { selectTopic, generatePost } from './lib/llm.mjs';
import { drawPriceChart } from './lib/charts.mjs';
import { uploadImage, publishPost } from './lib/binance.mjs';

const RUN_ID = Date.now();
const USED_FILE = 'used-coins.json';
const IMAGES_DIR = 'images';
const TIME = getTimeOfDay();
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY || '';

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function loadUsed() {
  try {
    const data = JSON.parse(fs.readFileSync(USED_FILE, 'utf-8'));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (data.coins || []).filter((c) => new Date(c.timestamp).getTime() > cutoff).map((c) => c.coin);
  } catch {
    return [];
  }
}

function saveUsed(symbol) {
  const data = { coins: loadUsed().map((c) => ({ coin: c, timestamp: new Date().toISOString() })) };
  data.coins.push({ coin: symbol, timestamp: new Date().toISOString() });
  fs.writeFileSync(USED_FILE, JSON.stringify(data, null, 2));
}

async function downloadImage(url, filename) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const filePath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(buf));
    return filePath;
  } catch (err) {
    log('[downloadImage] error:', err.message);
    return null;
  }
}

function isDue(account) {
  if (!account.enabled) return { due: false, reason: 'disabled' };
  const cap = account.dailyCap || 0;
  if (cap > 0 && (account.posts24h || 0) >= cap) return { due: false, reason: `capped (${account.posts24h}/${cap})` };
  const interval = account.intervalMin || 60;
  if (!account.lastPostAt) return { due: true, reason: 'never posted' };
  const elapsed = (Date.now() - new Date(account.lastPostAt).getTime()) / 60000;
  if (elapsed >= interval) return { due: true, reason: `interval elapsed (${Math.round(elapsed)}m >= ${interval}m)` };
  return { due: false, reason: `interval not elapsed (${Math.round(elapsed)}m < ${interval}m)` };
}

async function researchTopic() {
  const trending = await fetchCoinGeckoTrending();
  if (trending.length === 0) throw new Error('No trending data.');
  const used = loadUsed();
  let topic = await selectTopic(trending, used, TIME);
  if (!topic || !topic.symbol) {
    const unused = trending.filter((c) => !used.includes(c.symbol.toUpperCase()));
    topic = { symbol: (unused[0] || trending[0]).symbol, angle: 'momentum with volume', format: 'technical_analysis', hook: 'urgency' };
  }
  return topic;
}

async function makePost(topic) {
  saveUsed(topic.symbol);
  const price = await fetchPriceData(topic.symbol);
  const content = await generatePost(topic, price);
  if (!content) throw new Error('Content generation failed.');
  let imagePath = null;
  let imageLog = [];
  // Try price chart first
  try {
    const prices = await fetchCoinGeckoChart(topic.symbol);
    if (prices && prices.length >= 2) {
      imagePath = drawPriceChart(topic.symbol, prices, IMAGES_DIR);
      log(`  [chart] Generated: ${imagePath}`);
      imageLog.push('chart');
    } else {
      imageLog.push('no price data');
      log('  [chart] No price data for chart');
    }
  } catch (err) {
    imageLog.push(`chart: ${err.message}`);
    log(`  [chart] Failed: ${err.message}`);
  }
  // Fallback: Unsplash image
  if (!imagePath && UNSPLASH_KEY) {
    try {
      const unsplashUrl = await fetchUnsplashImage(`${topic.symbol} crypto trading chart`, UNSPLASH_KEY);
      if (unsplashUrl) {
        imagePath = await downloadImage(unsplashUrl, `${topic.symbol}_unsplash.jpg`);
        log(`  [unsplash] Downloaded: ${imagePath}`);
        imageLog.push('unsplash');
      } else {
        imageLog.push('unsplash: no image');
      }
    } catch (err) {
      imageLog.push(`unsplash: ${err.message}`);
      log(`  [unsplash] Failed: ${err.message}`);
    }
  } else if (!imagePath) {
    imageLog.push('no UNSPLASH_ACCESS_KEY');
    log('  [img] UNSPLASH_ACCESS_KEY not set - no fallback image');
  }
  if (!imagePath) log(`  [img] No image generated for ${topic.symbol}`);
  return {
    coin: topic.symbol,
    content,
    format: topic.format || 'technical_analysis',
    hook: topic.hook || 'narrative',
    cashtag: '$' + topic.symbol.toUpperCase(),
    imagePath,
    imageLog: imageLog.join('; ') || null
  };
}

async function publishForAccount(account, post) {
  const key = await fetchDecryptedKey(account.id);
  if (!key) throw new Error('No decryptable key.');
  let imageUrl = null;
  let imageError = null;
  if (post.imagePath) {
    try { imageUrl = await uploadImage(key, post.imagePath); } 
    catch (err) { 
      imageError = err.message;
      log(`  [img] ${account.name}: ${err.message}`); 
    }
  }
  const result = await publishPost(key, post.content, imageUrl);
  await new Promise((r) => setTimeout(r, 2000));
  return { ...result, imageUrl, imageError };
}

async function main() {
  log('=== Binance Square Multi-Account Runner ===');
  log(`Run ${RUN_ID} | ${TIME.period} | UTC ${TIME.utcHour}`);
  log(`Env check: API_URL=${process.env.API_URL ? 'SET' : 'MISSING'}, BOT_TOKEN=${process.env.BOT_TOKEN ? 'SET' : 'MISSING'}, GROQ=${process.env.GROQ_API_KEY ? 'SET' : 'MISSING'}, UNSPLASH=${UNSPLASH_KEY ? 'SET' : 'MISSING'}`);

  let accounts;
  try {
    accounts = await fetchAccounts();
    log(`Fetched ${accounts?.length || 0} accounts from API`);
  } catch (err) {
    log('FATAL: Failed to fetch accounts:', err.message);
    process.exit(1);
  }

  if (!accounts || accounts.length === 0) {
    log('No accounts configured. Nothing to do.');
    return;
  }

  // Log each account's due status
  accounts.forEach((a) => {
    const dueCheck = isDue(a);
    log(`  Account: ${a.name} | mode: ${a.mode} | enabled: ${a.enabled} | posts24h: ${a.posts24h}/${a.dailyCap} | lastPost: ${a.lastPostAt || 'never'} | due: ${dueCheck.due} (${dueCheck.reason})`);
  });

  const due = accounts.filter((a) => isDue(a).due);
  log(`Accounts due now: ${due.length}/${accounts.length}`);
  if (due.length === 0) {
    log('No accounts due yet. Exiting.');
    return;
  }

  const uniqueActs = due.filter((a) => a.mode === 'unique');
  const broadcastActs = due.filter((a) => a.mode === 'broadcast');
  const results = [];

  for (const [i, account] of uniqueActs.entries()) {
    if (i > 0) {
      console.log(`  (waiting 15s before next account to respect rate limits)`);
      await new Promise((r) => setTimeout(r, 15000));
    }
    try {
      const topic = await researchTopic();
      const post = await makePost(topic);
      const result = await publishForAccount(account, post);
      results.push({ account, ok: true, coin: post.coin, text: post.content, result });
      console.log(`[${account.name}] unique => ${result.postUrl}`);
    } catch (err) {
      console.log(`[${account.name}] unique failed: ${err.message}`);
      results.push({ account, ok: false, error: err.message });
    }
  }
  }

  if (broadcastActs.length > 0) {
    log('\n=== Generating broadcast post ===');
    try {
      const topic = await researchTopic();
      const post = await makePost(topic);
      for (const [i, account] of broadcastActs.entries()) {
        try {
          const result = await publishForAccount(account, post);
          results.push({ account, ok: true, coin: post.coin, text: post.content, result });
          log(`[${account.name}] Broadcast => ${result.postUrl} | img: ${result.imageUrl ? 'OK' : 'none'}`);
        } catch (err) {
          log(`[${account.name}] Broadcast failed: ${err.message}`);
          results.push({ account, ok: false, coin: post.coin, error: err.message });
        }
        if (i < broadcastActs.length - 1) await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      log(`Broadcast generation failed: ${err.message}`);
    }
  }

  log('\n=== Reporting results ===');
  for (const r of results) {
    try {
      await reportPost({
        accountId: r.account.id,
        coin: r.coin || null,
        text: r.text || null,
        imageUrl: r.ok ? (r.result.imageUrl || null) : null,
        postUrl: r.ok ? r.result.postUrl : null,
        contentId: r.ok ? r.result.contentId : null,
        status: r.ok ? 'published' : 'failed',
        error: r.ok ? (r.result.imageError ? 'image: ' + r.result.imageError : null) : (r.error || null),
        format: null,
        hook: null,
        qualityScore: null
      });
    } catch (err) {
      log(`  Report failed for ${r.account.name}: ${err.message}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  log(`\nDone: ${okCount}/${results.length} published`);
}

main().catch((err) => { log('Fatal:', err); process.exit(1); });