require('dotenv').config();

module.exports = {
  delays: {
    betweenActions: { min: 120000, max: 240000 },
    betweenAccounts: { min: 300000, max: 600000 },
    betweenSearchRounds: { min: 600000, max: 900000 },
    typing: { min: 80, max: 200 },
    scroll: { min: 1500, max: 3000 },
    pageLoad: { min: 3000, max: 6000 },
  },

  accounts: {
    maxParallel: parseInt(process.env.MAX_PARALLEL_ACCOUNTS || '3', 10),
  },

  follow: {
    /** Chỉ follow khi author có >= số follower này (0 = tắt lọc) */
    minFollowers: parseInt(process.env.MIN_FOLLOWERS_TO_FOLLOW || '1000', 10),
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
    navigationTimeout: parseInt(process.env.BROWSER_NAV_TIMEOUT || '30000', 10),
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    proxy: process.env.PROXY_SERVER || null,
  },

  gemini: {
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    temperature: 0.9,
  },

  deepseek: {
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    temperature: 0.9,
  },

  ai: {
    primary: process.env.AI_PRIMARY || 'gemini',
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

  airdrop: {
    searchKeywords: [
      'airdrop',
      'crypto airdrop',
      'free airdrop',
      'airdrop alert',
    ],
    evmKeywords: [
      'evm address',
      'env address',
      'eth address',
      'ethereum address',
      'metamask',
      'bnb address',
      'base address',
      'erc20',
      '0x address',
      'bsc address',
      'polygon address',
    ],
    solanaKeywords: [
      'solana wallet',
      'sol wallet',
      'phantom wallet',
      'phantom',
      'sol address',
      'solana address',
    ],
    genericKeywords: [
      'drop your wallet',
      'drop wallet',
      'drop ur wallet',
      'reply address',
      'drop address',
      'wallet address',
      'drop your address',
      'comment address',
      'send address',
      'leave address',
      'paste address',
      'share address',
      'submit wallet',
      'wallet below',
      'address below',
      'comment your wallet',
      'reply with wallet',
      'drop evm',
      'drop sol',
    ],
    /** Bài có 1 trong các từ này → comment (mặc định both: 2 comment EVM + Sol) */
    broadKeywords: [
      'airdrop',
      'air drop',
      'free airdrop',
      'airdrop live',
      'airdrop soon',
      'claim airdrop',
      'airdrop claim',
      'airdrop giveaway',
      'giveaway',
      'whitelist',
      'wl spot',
      'free mint',
      'freemint',
      'snapshot',
      'token distribution',
      'reward pool',
      'farm points',
      'points campaign',
      'testnet reward',
      'retroactive',
      'eligible wallet',
      'register wallet',
      'join airdrop',
      'airdrop campaign',
      'airdrop event',
      'airdrop hunter',
      'drop wallet',
      'wallet drop',
    ],
    maxCommentLength: 100,
    ruleTemplates: {
      evm: '{address}',
      solana: '{address}',
    },
    dualReplyDelay: true,
    /** Delay giữa 2 lần nhập ví (trước khi bắt đầu nhập lần 2) — ms */
    betweenComments: {
      min: parseInt(process.env.AIRDROP_COMMENT_DELAY_MIN || '3000', 10),
      max: parseInt(process.env.AIRDROP_COMMENT_DELAY_MAX || '8000', 10),
    },
    /** Gõ địa chỉ ví nhanh (ms/ký tự) */
    typing: {
      min: parseInt(process.env.AIRDROP_TYPING_DELAY_MIN || '5', 10),
      max: parseInt(process.env.AIRDROP_TYPING_DELAY_MAX || '20', 10),
    },
    engageOnReply: process.env.AIRDROP_ENGAGE_ON_REPLY !== 'false',
    followOnReply: process.env.AIRDROP_FOLLOW_ON_REPLY !== 'false',
    minFollowersToFollow: parseInt(
      process.env.AIRDROP_MIN_FOLLOWERS_TO_FOLLOW ||
        process.env.MIN_FOLLOWERS_TO_FOLLOW ||
        '1000',
      10
    ),
  },

  wallets: {
    evm: process.env.EVM_WALLET_ADDRESS || '',
    solana: process.env.SOLANA_WALLET_ADDRESS || '',
  },
};
