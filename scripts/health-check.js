#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const config = require('../config');
const Database = require('../src/database');
const { AccountHealthChecker, listCookieAccounts } = require('../src/accountHealthCheck');
const { buildSummary, persistHealthCheckResults } = require('../src/healthCheckReport');
const logger = require('../src/logger');

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

  const startedAt = new Date().toISOString();
  const checker = new AccountHealthChecker(config, db, { accountsDir });
  const results = await checker.runAll(accountNames);
  const completedAt = new Date().toISOString();

  const { state, txtPath } = await persistHealthCheckResults(db, config, results, {
    startedAt,
    completedAt,
  });

  console.log(state.reportText || buildSummary(results, { startedAt, completedAt, keyword: config.healthCheck?.keyword }));
  console.log(`\nReport saved: ${txtPath}`);

  const { alive, partial, suspended, dead } = state.summary;

  await db.disconnect();
  process.exit(dead > 0 || partial > 0 || suspended > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
