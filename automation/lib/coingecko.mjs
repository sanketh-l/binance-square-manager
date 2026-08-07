import fs from 'fs';

export function getTimeOfDay() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  let period, vibe, greeting;
  if (utcHour >= 5 && utcHour < 12) {
    period = 'morning';
    greeting = 'Good morning';
    vibe = 'markets are opening, early price action setting the tone for the day';
  } else if (utcHour >= 12 && utcHour < 17) {
    period = 'afternoon';
    greeting = 'Good afternoon';
    vibe = 'mid-day movement, lunchtime lull or afternoon breakout';
  } else if (utcHour >= 17 && utcHour < 21) {
    period = 'evening';
    greeting = 'Good evening';
    vibe = 'late session action, end-of-day positioning';
  } else {
    period = 'night';
    greeting = 'Night update';
    vibe = 'overnight moves, Asian session activity, quiet accumulation';
  }
  return { period, greeting, vibe, utcHour, now: now.toISOString() };
}

export async function fetchCoinGeckoTrending() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.coins || []).slice(0, 15).map((c) => ({
      symbol: (c.item.symbol || '').toUpperCase(),
      name: c.item.name,
      priceChangePercent: c.item.data?.price_change_percentage_24h?.usd ?? null,
      marketCapRank: c.item.market_cap_rank,
      score: c.item.score ?? 0
    }));
  } catch {
    return [];
  }
}

export async function fetchPriceData(coinSymbol) {
  try {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${coinSymbol}`, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    if (!searchData.coins || searchData.coins.length === 0) return null;
    const id = searchData.coins[0].id;
    const chartRes = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`, { signal: AbortSignal.timeout(8000) });
    if (!chartRes.ok) return null;
    const chartData = await chartRes.json();
    const prices = (chartData.prices || []).sort((a, b) => a[0] - b[0]);
    if (prices.length < 2) return null;
    const first = prices[0][1];
    const last = prices[prices.length - 1][1];
    return {
      currentPrice: last,
      change24h: (((last - first) / first) * 100).toFixed(2),
      high24h: Math.max(...prices.map((p) => p[1])).toFixed(2),
      low24h: Math.min(...prices.map((p) => p[1])).toFixed(2),
      coinSymbol
    };
  } catch {
    return null;
  }
}

export async function fetchCoinGeckoChart(symbol) {
  try {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${symbol}`, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    if (!searchData.coins || searchData.coins.length === 0) return null;
    const match = searchData.coins.find((c) => (c.symbol || '').toUpperCase() === symbol.toUpperCase());
    const coinId = match ? match.id : searchData.coins[0].id;
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=2`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.prices || data.prices.length < 2) return null;
    return data.prices;
  } catch {
    return null;
  }
}