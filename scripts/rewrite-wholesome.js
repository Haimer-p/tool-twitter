#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ALIVE = ['acc1', 'acc22', 'acc3', 'accquangkhai'];
const DEX = 'https://dexscreener.com/solana/8k1pncvkkvxtfvdcng2g57fg1braxsycypd8w2yr786w';
const PAIR = '8k1pncvkkvxtfvdcng2g57fg1braxsycypd8w2yr786w';
const SYMBOL = 'WHOLESOME';
const OUT = path.join(process.cwd(), 'configs', 'wholesome.json');

const HIGH_COMBO = {
  like: 0.03,
  retweet: 0.03,
  reply: 0.05,
  follow: 0.03,
  like_retweet: 0.12,
  like_reply: 0.18,
  like_retweet_reply: 0.48,
  like_follow: 0.04,
  like_retweet_follow: 0.04,
};

const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const allKw = new Set();
for (const acc of old.accounts) {
  (acc.keywords || []).forEach((k) => allKw.add(k));
}

[
  'WHOLESOME',
  '$WHOLESOME',
  'Wholesome Coin',
  'wholesome coin',
  'wholesomebounty.fun',
  PAIR,
  'AE1Lo6LWoCAyMk9QStEBq7tVWXmTTKDK8WXk1Nxkpump',
  'WHOLESOME solana',
  'WHOLESOME pump fun',
  'WHOLESOME dexscreener',
  'WHOLESOME trending',
  'WHOLESOME chart',
  'WHOLESOME gem',
  'WHOLESOME moon',
  'WHOLESOME raid',
  'WHOLESOME alpha',
  'buy WHOLESOME',
  'WHOLESOME community',
  'WHOLESOME memecoin',
  'WHOLESOME send it',
  'WholesomeBounty',
  'wholesome solana gem',
  'WHOLESOME volume',
  'WHOLESOME breakout',
  'solana memecoin',
  'pump fun solana',
  'WHOLESOME CT',
  'WHOLESOME fresh launch',
].forEach((k) => allKw.add(k));

let solanaGeneric = [];
try {
  const cumrocket = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'configs', 'cumrocket.json'), 'utf8')
  );
  solanaGeneric = (cumrocket.defaults.keywords || []).filter(
    (k) => !/CUMROCKET|cumrocket|e41h7k/i.test(k)
  );
} catch {
  /* optional */
}

const defaultsKeywords = [...new Set([...allKw, ...solanaGeneric])];

const accountBlock = {
  enabled: true,
  delays: {
    betweenActions: { min: 30000, max: 60000 },
    betweenSearchRounds: { min: 180000, max: 300000 },
  },
  interactions: {
    maxPerDay: 9999,
    maxPerAccountPerRun: 9999,
    keywordsPerRun: 25,
    tweetsPerKeyword: 15,
    replyRequiredIncludes: [DEX, SYMBOL],
    comboRatios: HIGH_COMBO,
  },
};

const config = {
  parallel: { maxConcurrent: ALIVE.length },
  defaults: {
    keywords: defaultsKeywords,
    delays: {
      betweenActions: { min: 90000, max: 180000 },
      betweenSearchRounds: { min: 600000, max: 900000 },
    },
    interactions: {
      maxPerDay: 9999,
      maxPerAccountPerRun: 9999,
      keywordsPerRun: 25,
      tweetsPerKeyword: 15,
      followMinFollowers: 1000,
      followMaxFollowers: 10000000,
      replyMaxLength: 240,
      replyComposerTimeoutMs: 15000,
      replyPostTimeoutMs: 20000,
      replyRequiredIncludes: [DEX, SYMBOL],
      comboRatios: HIGH_COMBO,
    },
  },
  accounts: ALIVE.map((name) => ({
    name,
    ...JSON.parse(JSON.stringify(accountBlock)),
    keywords: [...defaultsKeywords],
  })),
};

fs.writeFileSync(OUT, `${JSON.stringify(config, null, 2)}\n`);

const sum = Object.values(HIGH_COMBO).reduce((a, b) => a + b, 0);
console.log(`Rewrote ${path.relative(process.cwd(), OUT)}`);
console.log(`Accounts (${ALIVE.length}): ${ALIVE.join(', ')}`);
console.log(`Keywords: ${defaultsKeywords.length}`);
console.log(`Combo sum: ${sum}`);
console.log('Ratios:', JSON.stringify(HIGH_COMBO, null, 2));
