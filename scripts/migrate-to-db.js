#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('../src/database');
const { fetchTokenFromDexUrl } = require('../src/dexscreener');
const { buildCoreKeywords } = require('../src/keywordUtils');
const config = require('../config');

const ACCOUNTS_DIR = path.join(process.cwd(), 'accounts');
const CONFIGS_DIR = path.join(process.cwd(), 'configs');

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'campaign';
}

async function migrateAccounts(db) {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    console.log('No accounts/ directory');
    return 0;
  }
  const files = fs.readdirSync(ACCOUNTS_DIR).filter((f) => f.endsWith('.json'));
  let n = 0;
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    const cookies = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf8'));
    await db.saveAccountCookies(name, cookies, { enabled: true });
    n += 1;
    console.log(`  account: ${name}`);
  }
  return n;
}

async function migrateConfigs(db) {
  if (!fs.existsSync(CONFIGS_DIR)) {
    console.log('No configs/ directory');
    return 0;
  }
  const files = fs.readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.json'));
  let n = 0;
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8'));
    const slug = file.replace(/\.json$/, '');
    const symbol =
      raw.defaults?.keywords?.find((k) => /^[A-Z0-9]{2,}$/.test(k)) ||
      slug.toUpperCase();
    const dexUrl =
      raw.defaults?.interactions?.replyRequiredIncludes?.find((s) =>
        String(s).includes('dexscreener.com')
      ) || '';

    let meta = { symbol, name: symbol, dexUrl };
    if (dexUrl) {
      try {
        meta = await fetchTokenFromDexUrl(dexUrl);
      } catch {
        /* use fallback */
      }
    }

    const existing = await db.getCampaignBySlug(slug);
    if (existing) {
      console.log(`  skip existing campaign: ${slug}`);
      continue;
    }

    await db.createCampaign({
      slug,
      dexUrl: meta.dexUrl || dexUrl || `https://dexscreener.com/solana/${slug}`,
      symbol: meta.symbol || symbol,
      name: meta.name || symbol,
      mintAddress: meta.mintAddress || '',
      pairAddress: meta.pairAddress || '',
      defaults: raw.defaults || {},
      accounts: (raw.accounts || []).map((a) => ({
        name: a.name,
        enabled: a.enabled !== false,
        keywords: a.keywords || [],
        delays: a.delays,
        interactions: a.interactions,
      })),
      parallel: raw.parallel || { maxConcurrent: 2 },
      status: 'active',
    });
    n += 1;
    console.log(`  campaign: ${slug}`);
  }
  return n;
}

async function main() {
  const db = new Database(config.database.mongodbUri);
  await db.connect();

  console.log('Migrating accounts...');
  const accCount = await migrateAccounts(db);
  console.log(`Migrated ${accCount} account(s)`);

  console.log('Migrating configs...');
  const cfgCount = await migrateConfigs(db);
  console.log(`Migrated ${cfgCount} campaign(s)`);

  await db.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
