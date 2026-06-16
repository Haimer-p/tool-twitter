const { buildCoreKeywords, distributeKeywords } = require('./keywordUtils');

const DEFAULT_INTERACTIONS = {
  maxPerDay: 9999,
  maxPerAccountPerRun: 9999,
  keywordsPerRun: 25,
  tweetsPerKeyword: 15,
  followMinFollowers: 1000,
  followMaxFollowers: 10000000,
  replyMaxLength: 240,
  comboRatios: {
    like: 0.03,
    retweet: 0.03,
    reply: 0.28,
    follow: 0.02,
    like_retweet: 0.03,
    like_reply: 0.32,
    like_retweet_reply: 0.25,
    like_follow: 0.02,
    like_retweet_follow: 0.02,
  },
};

const DEFAULT_DELAYS = {
  betweenActions: { min: 90000, max: 180000 },
  betweenSearchRounds: { min: 600000, max: 900000 },
};

function buildKeywordPrompt(meta, count = 60) {
  const sym = meta.symbol || 'TOKEN';
  const name = meta.name || sym;
  return `Generate ${count} unique Twitter/X search keywords for Solana memecoin ${name} ($${sym}).
Dex: ${meta.dexUrl || ''}
Mint: ${meta.mintAddress || ''}
One keyword per line. No numbering. Return ONLY keywords.`;
}

function parseKeywordList(raw) {
  return String(raw || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((k) => k.length > 1 && k.length < 80);
}

async function callDeepSeek(prompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 800,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || null;
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function generateKeywords(meta, options = {}) {
  const count = options.count || 60;
  const accountNames = options.accountNames || [];
  const core = buildCoreKeywords(meta);
  const prompt = buildKeywordPrompt(meta, count);
  const strategy = process.env.AI_STRATEGY || 'deepseek';
  const order =
    strategy === 'gemini' ? ['gemini', 'deepseek'] : strategy === 'alternate' ? ['deepseek', 'gemini'] : ['deepseek', 'gemini'];

  let aiKeywords = [];
  for (const provider of order) {
    try {
      const raw = provider === 'gemini' ? await callGemini(prompt) : await callDeepSeek(prompt);
      if (raw) {
        aiKeywords = parseKeywordList(raw);
        if (aiKeywords.length >= 10) break;
      }
    } catch {
      /* try next */
    }
  }

  const allKeywords = [...new Set([...core, ...aiKeywords])];
  const perAccount = distributeKeywords(allKeywords, accountNames);

  return {
    allKeywords,
    perAccount,
    defaults: {
      keywords: allKeywords,
      delays: DEFAULT_DELAYS,
      interactions: {
        ...DEFAULT_INTERACTIONS,
        replyRequiredIncludes: [meta.dexUrl, meta.symbol].filter(Boolean),
      },
    },
  };
}

module.exports = {
  DEFAULT_DELAYS,
  DEFAULT_INTERACTIONS,
  generateKeywords,
};
