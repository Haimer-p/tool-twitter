#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const readline = require('readline');
const config = require('../config');
const Database = require('../src/database');
const {
  AccountAppealRunner,
  listCookieAccounts,
} = require('../src/accountAppeal');
const { AccountHealthChecker } = require('../src/accountHealthCheck');
const logger = require('../src/logger');

function askEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

function printResult(r) {
  console.log('');
  console.log(`--- ${r.accountName} [${r.status}] ---`);
  if (r.username) console.log(`  @${r.username}`);
  if (r.suspendReason) console.log(`  Reason: ${r.suspendReason}`);
  if (r.appealText) console.log(`  Appeal: ${r.appealText.slice(0, 120)}${r.appealText.length > 120 ? '...' : ''}`);
  if (r.error) console.log(`  Error: ${r.error}`);
  if (r.screenshotUrl) console.log(`  Screenshot: logs/appeal/${r.accountName}.png`);
  console.log(`  Duration: ${Math.round((r.durationMs || 0) / 1000)}s`);
}

async function detectSuspendedAccounts(accountsDir, accountNames) {
  const db = new Database(config.database.mongodbUri);
  await db.connect();
  const checker = new AccountHealthChecker(config, db, { accountsDir });
  const results = await checker.runAll(accountNames);
  await db.disconnect();
  return results.filter((r) => r.status === 'suspended').map((r) => r.accountName);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const autoOnly = process.argv.includes('--auto');
  const force = process.argv.includes('--force') || args.length > 0;
  const accountsDir = path.join(process.cwd(), 'accounts');

  let accountNames = args.length ? args : await listCookieAccounts(accountsDir);
  if (!accountNames.length) {
    console.error('No accounts found in accounts/');
    process.exit(1);
  }

  if (autoOnly || (!args.length && !force)) {
    console.log('Detecting suspended accounts via health check...');
    const suspended = await detectSuspendedAccounts(accountsDir, accountNames);
    if (!suspended.length) {
      console.log('No suspended accounts detected. Use: npm run appeal -- acc1 acc2');
      process.exit(0);
    }
    accountNames = suspended;
    console.log(`Suspended: ${accountNames.join(', ')}`);
  } else {
    console.log(`Appeal for: ${accountNames.join(', ')}${force ? ' (force)' : ''}`);
  }

  const db = new Database(config.database.mongodbUri);
  await db.connect();

  const runner = new AccountAppealRunner(config, {
    accountsDir,
    mode: 'terminal',
    force: force || args.length > 0,
    askEnterFn: (prompt) => askEnter(prompt),
  });

  const results = await runner.runAll(accountNames);

  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    printResult(r);
    if (r.status === 'submitted') submitted++;
    else if (r.status === 'skipped') skipped++;
    else failed++;
  }

  console.log('\n=== Summary ===');
  console.log(`Submitted: ${submitted}  Skipped: ${skipped}  Failed: ${failed}`);

  await db.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
