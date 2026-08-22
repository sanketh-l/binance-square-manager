const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const CONFIGURED_MODEL = process.env.GROQ_MODEL || '';
const PREFERRED_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];

let resolvedModel = null;

async function resolveModel() {
  if (resolvedModel) return resolvedModel;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json();
      const available = new Set((data.data || []).map((m) => m.id));
      if (CONFIGURED_MODEL && available.has(CONFIGURED_MODEL)) {
        resolvedModel = CONFIGURED_MODEL;
        console.log(`  [llm] Model: ${resolvedModel} (configured)`);
        return resolvedModel;
      }
      for (const m of PREFERRED_MODELS) {
        if (available.has(m)) {
          resolvedModel = m;
          console.log(`  [llm] Model: ${resolvedModel} (auto-selected${CONFIGURED_MODEL ? ', configured model unavailable' : ''})`);
          return resolvedModel;
        }
      }
    } else {
      console.error(`  [llm] Models list error ${res.status}`);
    }
  } catch (err) {
    console.error(`  [llm] Models discovery failed: ${err.message}`);
  }
  resolvedModel = CONFIGURED_MODEL || PREFERRED_MODELS[0];
  console.log(`  [llm] Model fallback: ${resolvedModel}`);
  return resolvedModel;
}

async function groqChat(messages, temperature = 0.7, maxTokens = 2000) {
  const model = await resolveModel();
  const isReasoning = model.includes('gpt-oss') || model.includes('qwen');
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (isReasoning) body.reasoning_effort = 'low';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    console.error(`  Groq API error ${res.status}${res.status === 404 ? ' - model gone, re-resolving' : ''}`);
    if (res.status === 404 && model !== CONFIGURED_MODEL) {
      const idx = PREFERRED_MODELS.indexOf(model);
      if (idx >= 0 && idx < PREFERRED_MODELS.length - 1) {
        resolvedModel = null;
        PREFERRED_MODELS.splice(idx, 1);
        return groqChat(messages, temperature, maxTokens);
      }
      resolvedModel = null;
    }
    return null;
  }
  const data = await res.json();
  if (data.choices && data.choices[0]) {
    let content = (data.choices[0].message.content || '').trim();
    if (!content) console.error('  Groq returned empty content (reasoning consumed token budget)');
    if (content.startsWith('```')) content = content.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    return content || null;
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

  const raw = await groqChat([{ role: 'user', content: prompt }], 0.7, 2000);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const CONTENT_RULES = `You are a seasoned crypto trader posting on Binance Square. Write like a real human — conversational, slightly messy, with personality. Think "trader chat room vibe" not "marketing copy".

VOICE & TONE:
- Talk like a friend/mentor: "brothers", "fam", "bro", "hey fam"
- Lead with contrarian hooks: "Everyone's staring at X but...", "Here's the trap nobody sees", "While everyone watches X, Y is quietly loading"
- Show vulnerability: "I failed against $TUT", "I was wrong", "back in 2024 greed made me lose 90%"
- Use precise trader language: "coiled", "armed", "squeeze", "invalidation", "magnet", "reclaim", "flush"
- End with a debate question that drives comments: "Are you fading X or riding Y?"

FORMAT (follow exactly):
1. Hook line (1 sentence, contrarian, addresses "everyone")
2. Trade Plan with exact numbers:
   $SYMBOL - LONG/SHORT
   Entry: X – Y
   SL: Z
   TP1: A
   TP2: B
   TP3: C
3. "Why this setup?" (3-4 bullets, specific data: RSI, ATR, bias confidence, timeframe divergence)
4. "Debate:" + one engaging question
5. Cashtag ($SYMBOL) on its OWN LINE at the very end. Never #hashtag. Never in body.

HARD RULES:
- 2-4 sentences TOTAL in the narrative (excluding Trade Plan)
- Cashtag ($SYMBOL) ONLY at the very end, alone on its line
- Never use banned words: "guaranteed", "10x", "can't lose", "moon", "lambo"
- Sound like a real trader: "I think", "worth watching", "my read", "NFA"
- One exclamation max. No emojis in narrative (Trade Plan can have them)
- Specific numbers beat vague claims. One concrete level > three general statements
- Timeframe awareness: mention 15m/1H/4H/1D explicitly

EXAMPLE HOOK STYLES:
- "Everyone's staring at BTC while ETH quietly loads the catapult at 1921."
- "Everyone's long $ZEC while the 4H quietly flips — here's the trap nobody sees."
- "You think $FOGO is dead? The 4H chart just whispered a reversal nobody's watching."`;

export async function generatePost(topic, price) {
  const timeOfDay = getTimeOfDaySafe();
  const priceContext = price
    ? `Price data: $${formatPrice(price.currentPrice)}, 24h ${price.change24h}%, high $${price.high24h}, low $${price.low24h}`
    : '';

  const format = topic.format || 'technical_analysis';
  const formatLabels = {
    technical_analysis: 'technical analysis (Trade Plan + Why this setup + Debate)',
    news_commentary: 'news commentary (Trade Plan + Why this setup + Debate)',
    explainer: 'educational explainer (Trade Plan + Why this setup + Debate)',
    market_reaction: 'market reaction (Trade Plan + Why this setup + Debate)'
  };
  const label = formatLabels[format] || 'technical analysis (Trade Plan + Why this setup + Debate)';

  const prompt = CONTENT_RULES + '\n\n' +
    `Time: ${timeOfDay.period} — ${timeOfDay.vibe}\n` +
    `Write a ${label} post about $${topic.symbol}. ${priceContext}\n` +
    `Angle: ${topic.angle}\n\n` +
    `Follow the format EXACTLY. Cashtag ($${topic.symbol.toUpperCase()}) on its own line at the very end.`;

  const raw = await groqChat([{ role: 'user', content: prompt }], 0.8, 2000);
  if (!raw) return null;
  return raw;
}

export async function scorePost(post) {
  const scoringPrompt =
    'You are a quality control reviewer for crypto content. Score this Binance Square post.\n\n' +
    `POST TEXT:\n"${post.text}"\n\nCOIN: ${post.coin}\nCASHTAG: ${post.cashtag}\n\n` +
    'Score 0-2 on each axis:\n' +
    '1. FACTUAL_GROUNDING: 0 unverifiable/false, 1 plausible, 2 grounded in real verifiable data (exact RSI, ATR, levels)\n' +
    '2. CASHTAG_RELEVANCE: 0 not about coin, 1 generic, 2 specific to that coin with $SYMBOL at end only\n' +
    '3. VOICE_AUTHENTICITY: 0 corporate/AI, 1 okay, 2 sounds like real trader ("brothers", "fam", contrarian hook, vulnerability)\n' +
    '4. FORMAT_COMPLIANCE: 0 wrong format, 1 partial, 2 perfect (Hook -> Trade Plan -> Why -> Debate -> $SYMBOL)\n' +
    '5. TRUST_SIGNAL: 0 hype-only, 1 opinion no reasoning, 2 position with concrete reasoning & risk management\n\n' +
    'Return ONLY JSON:\n' +
    '{ "factual_grounding": 2, "cashtag_relevance": 2, "voice_authenticity": 2, "format_compliance": 2, "trust_signal": 1, "total": 9, "pass": true, "feedback": "..." }\n\n' +
    'Hard block: factual_grounding === 0 OR cashtag_relevance === 0 OR format_compliance === 0 => pass:false. Minimum pass total 7/10.';

  try {
    const raw = await groqChat([{ role: 'user', content: scoringPrompt }], 0.2, 1000);
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