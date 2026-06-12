#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ALIVE = ['accquangkhai', 'acckingchiton', 'acc1', 'acc22', 'acc3'];
const DEX_URL =
  'https://dexscreener.com/solana/7ao15yiqDJMQgokdjofU3KfYakQ5e243jQaj3YSrbkXE';
const PAIR = '7ao15yiqDJMQgokdjofU3KfYakQ5e243jQaj3YSrbkXE';
const SYMBOL = 'DRUNKEY';
const NAME = 'Drunk Monkey';
const OUT = path.join(process.cwd(), 'configs', 'drunkey.json');
const TEMPLATE = path.join(process.cwd(), 'configs', 'gus.json');

function replaceStr(s) {
  return s
    .replace(
      /https:\/\/dexscreener\.com\/solana\/84w3sryuvm9hb6nbpvveotexcknv67jlmet4d87lboki/gi,
      DEX_URL
    )
    .replace(/84w3sryuvm9hb6nbpvveotexcknv67jlmet4d87lboki/gi, PAIR)
    .replace(/\$GUS/g, `$${SYMBOL}`)
    .replace(/\bGUS\b/g, SYMBOL)
    .replace(/\bgus\b/g, SYMBOL.toLowerCase())
    .replace(/The Coconut Frog/gi, NAME)
    .replace(/coconut frog/gi, NAME.toLowerCase());
}

function deepReplace(obj) {
  if (typeof obj === 'string') return replaceStr(obj);
  if (Array.isArray(obj)) return obj.map(deepReplace);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepReplace(v);
    return out;
  }
  return obj;
}

const extraKeywords = [
  SYMBOL,
  `$${SYMBOL}`,
  SYMBOL.toLowerCase(),
  NAME,
  NAME.toLowerCase(),
  'drunk monkey meme',
  'drunk monkey solana',
  'drunk monkey token',
  'drunk monkey pump',
  'drunk monkey chart',
  'drunk monkey community',
  'drunk monkey gem',
  'drunk monkey alpha',
  'drunk monkey raid',
  `buy ${SYMBOL}`,
  `${SYMBOL} solana`,
  `${SYMBOL} pump fun`,
  `${SYMBOL} dexscreener`,
  `${SYMBOL} trending`,
  `${SYMBOL} send it`,
  PAIR,
  'monkey meme solana',
  'drunk meme coin',
  'drunk monkey crypto',
];

const gus = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
const fallback = gus.accounts.find((a) => a.name === 'acc22');

const accounts = ALIVE.map((name) => {
  const src = gus.accounts.find((a) => a.name === name) || fallback;
  const acc = deepReplace(JSON.parse(JSON.stringify(src)));
  acc.name = name;
  acc.enabled = true;
  acc.keywords = [...new Set([...(acc.keywords || []), ...extraKeywords])];
  if (acc.interactions) {
    acc.interactions.replyRequiredIncludes = [DEX_URL, SYMBOL];
  }
  return acc;
});

const config = {
  parallel: { maxConcurrent: ALIVE.length },
  defaults: deepReplace(gus.defaults),
  accounts,
};

config.defaults.keywords = [
  ...new Set([...(config.defaults.keywords || []), ...extraKeywords]),
];
config.defaults.interactions.replyRequiredIncludes = [DEX_URL, SYMBOL];

fs.writeFileSync(OUT, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Created ${path.relative(process.cwd(), OUT)}`);
console.log(`Token: ${NAME} ($${SYMBOL})`);
console.log(`Dex: ${DEX_URL}`);
console.log(`Accounts (${ALIVE.length}): ${ALIVE.join(', ')}`);
