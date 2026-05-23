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
    likeRatio: 0.2,
    retweetRatio: 0.3,
    replyRatio: 0.35,
    followRatio: 0.15,
    followBackWaitDays: 3,
  },

  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    proxy: process.env.PROXY_SERVER || null,
  },

  gemini: {
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    temperature: 0.9,
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
