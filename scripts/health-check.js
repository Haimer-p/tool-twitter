#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const config = require('../config');
const Database = require('../src/database');
const { AccountHealthChecker, listCookieAccounts } = require('../src/accountHealthCheck');
const logger = require('../src/logger');

function printResult(r) {
  const c = r.checks || {};
  const mark = (check) => (check?.ok ? 'OK' : 'FAIL');
  console.log('');
  console.log(`--- ${r.accountName} [${r.status}] ---`);
  console.log(`  Profile: ${r.profile?.displayName || '?'} @${r.profile?.username || '?'}`);
  console.log(`  Login: ${mark(c.login)}  Search: ${mark(c.search)}  Like: ${mark(c.like)}  RT: ${mark(c.retweet)}  Reply: ${mark(c.reply)}`);
  if (c.search?.keyword) console.log(`  Search keyword: ${c.search.keyword} (${c.search.tweetCount || 0} tweets)`);
  if (c.login?.error) console.log(`  Login error: ${c.login.error}`);
  if (c.search?.error) console.log(`  Search error: ${c.search.error}`);
  if (c.like?.error) console.log(`  Like error: ${c.like.error}`);
  if (c.retweet?.error) console.log(`  Retweet error: ${c.retweet.error}`);
  if (c.reply?.error) console.log(`  Reply error: ${c.reply.error}`);
  if (r.screenshotUrl) console.log(`  Screenshot: logs/health-check/${r.accountName}.png`);
  console.log(`  Duration: ${Math.round((r.durationMs || 0) / 1000)}s`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const accountsDir = path.join(process.cwd(), 'accounts');

  let accountNames = args.length ? args : await listCookieAccounts(accountsDir);
  if (!accountNames.length) {
    console.error('No accounts found in accounts/');
    process.exit(1);
  }

  console.log(`Health check for ${accountNames.length} account(s): ${accountNames.join(', ')}`);
  console.log(`Keyword: ${config.healthCheck?.keyword || 'crypto'}`);

  const db = new Database(config.database.mongodbUri);
  await db.connect();

  const checker = new AccountHealthChecker(config, db, { accountsDir });
  const results = await checker.runAll(accountNames);

  let alive = 0;
  let partial = 0;
  let dead = 0;
  for (const r of results) {
    printResult(r);
    if (r.status === 'alive') alive++;
    else if (r.status === 'partial') partial++;
    else dead++;
  }

  console.log('\n=== Summary ===');
  console.log(`Alive: ${alive}  Partial: ${partial}  Dead: ${dead}`);

  await db.disconnect();
  process.exit(dead > 0 || partial > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
