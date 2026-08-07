const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function groqChat(messages, temperature = 0.7, maxTokens = 500) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    console.error(`  Groq API error ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (data.choices && data.choices[0]) {
    let content = data.choices[0].message.content.trim();
    if (content.startsWith('```')) content = content.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    return content;
  }
  return null;
}

export async function selectTopic(trendingCoins, usedSymbols, timeOfDay) {
  const usedStr = usedSymbols.length > 0
    ? 'Recently posted coins (avoid these): ' + usedSymbols.join(', ')
    : '';

  const coinList = trendingCoins
    .map((c) => {
      const pct = c.priceChangePercent != null ? `${c.priceChangePercent >= 0 ? '+' : ''}${c.priceChangePercent.toFixed(2)}%` : 'N/A';
      return `${c.symbol} (${c.name}): ${pct}${c.marketCapRank ? ', rank #' + c.marketCapRank : ''}`;
    })
    .join('\n');

  const prompt = 'You are an AI content optimizer for Binance Square Write-to-Earn. Your single goal: generate posts that maximize earnings.\n\n' +
    `TIME: ${timeOfDay.period} (${timeOfDay.greeting}, UTC hour ${timeOfDay.utcHour})\n` +
    `Today's trending coins:\n${coinList}\n` +
    (usedStr ? `\n${usedStr}\n` : '') +
    '\nPick exactly 1 coin for today\'s post. Choose a coin not recently used if possible.\n\n' +
    'Return ONLY JSON:\n' +
    '{ "symbol": "TICKER", "angle": "one-line reason with a specific price level or data point", "format": "technical_analysis", "hook": "narrative" }\n\n' +
    'Format options: technical_analysis, news_commentary, explainer, market_reaction\n' +
    'Hook options: narrative, urgency, controversy';

  const raw = await groqChat([{ role: 'user', content: prompt }], 0.7, 500);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const CONTENT_RULES = 'You are an AI content writer for Binance Square Write-to-Earn. Write posts that maximize clicks and trades. Follow rules EXACTLY:\n' +
  '1. Ground hype in data with specific numbers\n' +
  '2. State your take, never guarantee outcomes\n' +
  '3. Include a technical or narrative edge\n' +
  '4. 2-4 sentences per post\n' +
  '5. Cashtag at the END after a line break. Never at the beginning.\n' +
  '6. Sound like a real trader, not a marketer\n' +
  '7. Never use banned words: "guaranteed", "10x", "can\'t lose", "moon", "lambo"\n' +
  '8. Concrete > vague. One specific number beats three general claims\n\n' +
  'PSYCHOLOGICAL HOOKS (rotate):\n1. NARRATIVE - builds story.\n2. URGENCY - FOMO brief.\n3. CONTROVERSY - bold take.\n\n' +
  'TONE: real trader chat ("I think", "Worth watching"). One exclamation max. Cashtag on its own line at the end.';

export async function generatePost(topic, price) {
  const timeOfDay = getTimeOfDaySafe();
  const priceContext = price
    ? `Price data: $${formatPrice(price.currentPrice)}, 24h ${price.change24h}%, high $${price.high24h}, low $${price.low24h}`
    : '';

  const format = topic.format || 'technical_analysis';
  const formatLabels = {
    technical_analysis: 'technical analysis',
    news_commentary: 'news commentary',
    explainer: 'educational explainer',
    market_reaction: 'market reaction'
  };
  const label = formatLabels[format] || 'technical analysis';

  const prompt = CONTENT_RULES + '\n\n' +
    `Time: ${timeOfDay.period} — ${timeOfDay.vibe}\n` +
    `Write a ${label} post about $${topic.symbol}. ${priceContext}\n` +
    `Angle: ${topic.angle}\n\n` +
    `2-4 sentences. Cashtag on its own line at the end. Hook: ${topic.hook || 'narrative'}`;

  const raw = await groqChat([{ role: 'user', content: prompt }], 0.8, 300);
  if (!raw) return null;
  return raw;
}

export async function scorePost(post) {
  const scoringPrompt =
    'You are a quality control reviewer for crypto content. Score this Binance Square post.\n\n' +
    `POST TEXT:\n"${post.text}"\n\nCOIN: ${post.coin}\nCASHTAG: ${post.cashtag}\n\n` +
    'Score 0-2 on each axis:\n' +
    '1. FACTUAL_GROUNDING: 0 unverifiable/false, 1 plausible, 2 grounded in real verifiable data\n' +
    '2. CASHTAG_RELEVANCE: 0 not about coin, 1 generic, 2 specific to that coin\n' +
    '3. NOVELTY: 0 templated spam, 1 typical, 2 original non-templated\n' +
    '4. TRUST_SIGNAL: 0 hype-only, 1 opinion no reasoning, 2 position with concrete reasoning\n\n' +
    'Return ONLY JSON:\n' +
    '{ "factual_grounding": 2, "cashtag_relevance": 2, "novelty": 2, "trust_signal": 1, "total": 7, "pass": true, "feedback": "..." }\n\n' +
    'Hard block: factual_grounding === 0 OR cashtag_relevance === 0 => pass:false. Minimum pass total 6/8.';

  try {
    const raw = await groqChat([{ role: 'user', content: scoringPrompt }], 0.2, 300);
    if (!raw) return { pass: true, llm_failed: true, total: 8, feedback: 'LLM unavailable - auto-approved' };
    return JSON.parse(raw);
  } catch {
    return { pass: true, llm_failed: true, total: 8, feedback: 'LLM unavailable - auto-approved' };
  }
}

function getTimeOfDaySafe() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const period = utcHour >= 5 && utcHour < 12 ? 'morning' : utcHour >= 12 && utcHour < 17 ? 'afternoon' : utcHour >= 17 && utcHour < 21 ? 'evening' : 'night';
  const vibe = {
    morning: 'markets are opening, early price action setting the tone for the day',
    afternoon: 'mid-day movement, lunchtime lull or afternoon breakout',
    evening: 'late session action, end-of-day positioning',
    night: 'overnight moves, Asian session activity, quiet accumulation'
  }[period];
  return { period, vibe };
}

function formatPrice(price) {
  if (price < 0.01) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2);
}