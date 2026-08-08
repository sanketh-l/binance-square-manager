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
  } catch {
    return null;
  }
}

function isDue(account) {
  if (!account.enabled) return false;
  const cap = account.dailyCap || 0;
  if (cap > 0 && (account.posts24h || 0) >= cap) return false;
  const interval = account.intervalMin || 60;
  if (!account.lastPostAt) return true;
  const elapsed = (Date.now() - new Date(account.lastPostAt).getTime()) / 60000;
  return elapsed >= interval;
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
  // Try price chart first
  try {
    const prices = await fetchCoinGeckoChart(topic.symbol);
    if (prices && prices.length >= 2) {
      imagePath = drawPriceChart(topic.symbol, prices, IMAGES_DIR);
      console.log(`  [chart] Generated: ${imagePath}`);
    }
  } catch (err) {
    console.log(`  [chart] Failed: ${err.message}`);
  }
  // Fallback: Unsplash image
  if (!imagePath && UNSPLASH_KEY) {
    try {
      const unsplashUrl = await fetchUnsplashImage(`${topic.symbol} crypto trading chart`, UNSPLASH_KEY);
      if (unsplashUrl) {
        imagePath = await downloadImage(unsplashUrl, `${topic.symbol}_unsplash.jpg`);
        console.log(`  [unsplash] Downloaded: ${imagePath}`);
      }
    } catch (err) {
      console.log(`  [unsplash] Failed: ${err.message}`);
    }
  }
  if (!imagePath) console.log(`  [img] No image generated for ${topic.symbol}`);
  return {
    coin: topic.symbol,
    content,
    format: topic.format || 'technical_analysis',
    hook: topic.hook || 'narrative',
    cashtag: '$' + topic.symbol.toUpperCase(),
    imagePath
  };
}

async function publishForAccount(account, post) {
  const key = await fetchDecryptedKey(account.id);
  if (!key) throw new Error('No decryptable key.');
  let imageUrl = null;
  if (post.imagePath) {
    try { imageUrl = await uploadImage(key, post.imagePath); } catch (err) { console.log(`  [img] ${account.name}: ${err.message}`); }
  }
  const result = await publishPost(key, post.content, imageUrl);
  await new Promise((r) => setTimeout(r, 2000));
  return { ...result, imageUrl };
}

async function main() {
  console.log('=== Binance Square Multi-Account Runner ===');
  console.log(`Run ${RUN_ID} | ${TIME.period} | UTC ${TIME.utcHour}\n`);

  const accounts = await fetchAccounts();
  if (!accounts || accounts.length === 0) {
    console.log('No accounts configured. Nothing to do.');
    return;
  }

  const due = accounts.filter(isDue);
  console.log(`Accounts: ${accounts.length}, due now: ${due.length}`);
  if (due.length === 0) {
    console.log('No accounts due yet. Exiting.');
    return;
  }

  const uniqueActs = due.filter((a) => a.mode === 'unique');
  const broadcastActs = due.filter((a) => a.mode === 'broadcast');
  const results = [];

  for (const account of uniqueActs) {
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

  if (broadcastActs.length > 0) {
    console.log('\n=== Generating broadcast post ===');
    try {
      const topic = await researchTopic();
      const post = await makePost(topic);
      for (const [i, account] of broadcastActs.entries()) {
        try {
          const result = await publishForAccount(account, post);
          results.push({ account, ok: true, coin: post.coin, text: post.content, result });
          console.log(`[${account.name}] Broadcast => ${result.postUrl}`);
        } catch (err) {
          console.log(`[${account.name}] Broadcast failed: ${err.message}`);
          results.push({ account, ok: false, coin: post.coin, error: err.message });
        }
        if (i < broadcastActs.length - 1) await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.log(`Broadcast generation failed: ${err.message}`);
    }
  }

  console.log('\n=== Reporting results ===');
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
        error: r.ok ? null : (r.error || null),
        format: null,
        hook: null,
        qualityScore: null
      });
    } catch (err) {
      console.log(`  Report failed for ${r.account.name}: ${err.message}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nDone: ${okCount}/${results.length} published`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });