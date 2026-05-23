require('dotenv').config();

module.exports = {
  delays: {
    betweenActions: { min: 90000, max: 180000 },
    betweenAccounts: { min: 300000, max: 600000 },
    betweenSearchRounds: { min: 600000, max: 900000 },
    typing: { min: 80, max: 200 },
    scroll: { min: 1500, max: 3000 },
    pageLoad: { min: 3000, max: 6000 },
  },

  interactions: {
    maxPerDay: 50,
    maxPerAccountPerRun: 15,
    keywordsPerRun: 6,
    tweetsPerKeyword: 8,
    followBackWaitDays: 3,
    // Chỉ follow khi profile có từ X followers trở lên (0 = tắt lọc)
    followMinFollowers: parseInt(process.env.FOLLOW_MIN_FOLLOWERS || '0', 10),
    // Tùy chọn: bỏ qua nếu quá nhiều follower (0 = không giới hạn trên)
    followMaxFollowers: parseInt(process.env.FOLLOW_MAX_FOLLOWERS || '0', 10) || null,
    comboRatios: {
      like: 0.08,
      retweet: 0.12,
      reply: 0.12,
      follow: 0.08,
      like_retweet: 0.18,
      like_reply: 0.18,
      like_retweet_reply: 0.08,
      like_follow: 0.1,
      like_retweet_follow: 0.06,
    },
  },

  parallel: {
    maxConcurrent: parseInt(process.env.MAX_PARALLEL_ACCOUNTS || '2', 10),
  },

  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    proxy: process.env.PROXY_SERVER || null,
  },

  gemini: {
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    fallbackModels: ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'],
    temperature: 0.9,
  },

  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: 0.9,
    maxTokens: 150,
  },

  // alternate | gemini | deepseek
  ai: {
    strategy: process.env.AI_STRATEGY || 'alternate',
  },

  database: {
    mongodbUri: process.env.MONGODB_URI,
  },

  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
    username: process.env.DASHBOARD_USER || 'admin',
    password: process.env.DASHBOARD_PASSWORD || 'admin123',
  },

  keywords: [
    'crypto',
    'bitcoin',
    'ethereum',
    'btc',
    'eth',
    'altcoin',
    'cryptocurrency',
    'web3',
    'blockchain',
    'defi',
    'nft',
    'solana',
    'sol',
    'binance',
    'airdrop',
    'memecoin',
    'trading crypto',
    'bull run',
    'bear market',
    'staking',
    'yield farming',
    'layer2',
    'arbitrum',
    'optimism',
    'base chain',
    'smart contract',
    'dapp',
    'dao',
    'token launch',
    'crypto news',
    'onchain',
    'zero knowledge',
    'zk rollup',
  ],

  baseUrl: 'https://x.com',
};
