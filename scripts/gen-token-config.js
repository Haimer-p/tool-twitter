#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/gen-token-config.js <pairUrl> <symbol> <tokenName> <outFile>
 *   node scripts/gen-token-config.js --alive-from-health <pairUrl> <symbol> <tokenName> <outFile>
 *
 * Example:
 *   node scripts/gen-token-config.js --alive-from-health \
 *     https://dexscreener.com/solana/e41h7kungzy9hhsaykp1jurw8hlwyhken9jurquudfxy \
 *     CUMROCKET CUMROCKET cumrocket.json
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const aliveFromHealth = args[0] === '--alive-from-health';
const offset = aliveFromHealth ? 1 : 0;
const [dexUrl, symbol, tokenName, outFile] = args.slice(offset);

if (!dexUrl || !symbol || !tokenName || !outFile) {
  console.error(
    'Usage: node scripts/gen-token-config.js [--alive-from-health] <dexUrl> <SYMBOL> <Token Name> <outFile.json> [acc1 acc2 ...]'
  );
  process.exit(1);
}

const manualAccounts = args.slice(offset + 4);
const PAIR = dexUrl.replace(/.*\/solana\//i, '').replace(/\/$/, '');
const DEX_URL = dexUrl.startsWith('http') ? dexUrl : `https://dexscreener.com/solana/${PAIR}`;
const SYMBOL = symbol.toUpperCase();
const NAME = tokenName;
const OUT = path.join(process.cwd(), 'configs', outFile.replace(/\.json$/, '') + '.json');
const TEMPLATE = path.join(process.cwd(), 'configs', 'drunkey.json');

function loadAliveFromHealthReport() {
  const reportPath = path.join(process.cwd(), 'logs', 'health-check', 'latest.json');
  try {
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const alive = (data.results || [])
      .filter((r) => r.status === 'alive')
      .map((r) => r.accountName);
    if (alive.length) return alive;
  } catch {
    /* fall through */
  }
  return null;
}

let ALIVE = manualAccounts.length ? manualAccounts : loadAliveFromHealthReport();
if (!ALIVE?.length) {
  console.error('No alive accounts found. Run: npm run health-check');
  process.exit(1);
}

const prevSymbol = 'DRUNKEY';
const prevName = 'Drunk Monkey';
const prevPair = '7ao15yiqDJMQgokdjofU3KfYakQ5e243jQaj3YSrbkXE';
const prevDex =
  'https://dexscreener.com/solana/7ao15yiqDJMQgokdjofU3KfYakQ5e243jQaj3YSrbkXE';

function replaceStr(s) {
  return s
    .replace(new RegExp(prevDex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), DEX_URL)
    .replace(new RegExp(prevPair, 'gi'), PAIR)
    .replace(new RegExp(`\\$${prevSymbol}`, 'g'), `$${SYMBOL}`)
    .replace(new RegExp(`\\b${prevSymbol}\\b`, 'g'), SYMBOL)
    .replace(new RegExp(prevSymbol.toLowerCase(), 'g'), SYMBOL.toLowerCase())
    .replace(new RegExp(prevName, 'gi'), NAME)
    .replace(/drunk monkey/gi, NAME.toLowerCase());
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

const slug = SYMBOL.toLowerCase();
const extraKeywords = [
  SYMBOL,
  `$${SYMBOL}`,
  slug,
  NAME,
  NAME.toLowerCase(),
  `${slug} meme`,
  `${slug} solana`,
  `${slug} token`,
  `${slug} pump`,
  `${slug} chart`,
  `${slug} community`,
  `${slug} gem`,
  `${slug} alpha`,
  `${slug} raid`,
  `buy ${SYMBOL}`,
  `${SYMBOL} solana`,
  `${SYMBOL} pump fun`,
  `${SYMBOL} dexscreener`,
  `${SYMBOL} trending`,
  `${SYMBOL} send it`,
  PAIR,
  `${slug} crypto`,
  `${slug} memecoin`,
  `${slug} pump fun`,
  `${slug} fresh launch`,
  `${slug} still early`,
];

const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
const fallback = template.accounts.find((a) => a.name === 'acc22');

const accounts = ALIVE.map((name) => {
  const src = template.accounts.find((a) => a.name === name) || fallback;
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
  defaults: deepReplace(template.defaults),
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
