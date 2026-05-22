require('dotenv').config();

module.exports = {
  delays: {
    betweenActions: { min: 30000, max: 90000 },
    betweenAccounts: { min: 120000, max: 300000 },
    betweenSearchRounds: { min: 300000, max: 600000 },
    typing: { min: 50, max: 150 },
    scroll: { min: 500, max: 1500 },
  },

  interactions: {
    maxPerDay: 80,
    maxPerAccountPerRun: 20,
    likeRatio: 0.5,
    retweetRatio: 0.15,
    replyRatio: 0.2,
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
    'web3',
    'crypto',
    'blockchain',
    'defi',
    'nft',
    'ethereum',
    'solana',
    'bitcoin',
    'smart contract',
    'dapp',
    'dao',
    'layer2',
    'zero knowledge',
  ],

  baseUrl: 'https://x.com',
};
