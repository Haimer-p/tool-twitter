/**
 * Unit / integration tests (no Twitter browser required).
 * MongoDB: uses MONGODB_URI from .env, or skips DB block.
 */
const assert = require('assert');
const http = require('http');
const { parseTweetId, randomMs } = require('../src/utils');
const config = require('../config');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  OK ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

console.log('\n=== Utils ===');
test('parseTweetId x.com', () => {
  assert.strictEqual(
    parseTweetId('https://x.com/user/status/1234567890'),
    '1234567890'
  );
});
test('parseTweetId twitter.com', () => {
  assert.strictEqual(
    parseTweetId('https://twitter.com/user/status/99?s=20'),
    '99'
  );
});
test('parseTweetId invalid', () => {
  assert.strictEqual(parseTweetId('https://x.com/user'), null);
});
test('randomMs in range', () => {
  for (let i = 0; i < 50; i++) {
    const v = randomMs(10, 20);
    assert.ok(v >= 10 && v < 20);
  }
});

console.log('\n=== Config ===');
test('comboRatios sum to 1', () => {
  const ratios = config.interactions.comboRatios;
  const sum = Object.values(ratios).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001, `sum=${sum}`);
});

console.log('\n=== EngagementBot.decideActionCombo ===');
const EngagementBot = require('../src/engage');
const mockBot = new EngagementBot({}, {}, {}, {}, config);
const VALID_ACTIONS = new Set(['like', 'retweet', 'reply', 'follow']);
test('decideActionCombo returns valid action arrays', () => {
  for (let i = 0; i < 200; i++) {
    const combo = mockBot.decideActionCombo();
    assert.ok(Array.isArray(combo) && combo.length > 0);
    for (const action of combo) {
      assert.ok(VALID_ACTIONS.has(action), `invalid action: ${action}`);
    }
  }
});

console.log('\n=== Account config ===');
const { loadAccountConfig, resolveAccountProfile } = require('../src/accountConfig');
test('loadAccountConfig returns accounts', () => {
  const loaded = loadAccountConfig(config);
  if (loaded) {
    assert.ok(loaded.accounts.length > 0);
    assert.ok(loaded.parallel.maxConcurrent >= 1);
  }
});
test('resolveAccountProfile merges defaults', () => {
  const profile = resolveAccountProfile(
    { name: 'test', keywords: ['btc'] },
    { keywords: ['crypto'], interactions: { maxPerDay: 10 } },
    config
  );
  assert.deepStrictEqual(profile.keywords, ['btc']);
  assert.strictEqual(profile.interactions.maxPerDay, 10);
});

console.log('\n=== Cron ===');
const cron = require('node-cron');
test('cron validates expression', () => {
  assert.ok(cron.validate('0 */6 * * *'));
  assert.ok(!cron.validate('not a cron'));
});

console.log('\n=== Modules load ===');
test('all src modules require', () => {
  require('../src/logger');
  require('../src/database');
  require('../src/browser');
  require('../src/auth');
  require('../src/ai');
  require('../src/dashboard');
});

async function resolveMongoUri() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  if (process.env.MONGODB_URI) return { uri: process.env.MONGODB_URI, memory: false };

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  return { uri: mongod.getUri(), memory: true, mongod };
}

async function testDatabase() {
  const resolved = await resolveMongoUri();
  const uri = resolved.uri;
  console.log(
    `\n=== Database (${resolved.memory ? 'in-memory' : 'Atlas/local'}) ===`
  );
  const Database = require('../src/database');

  await testAsync('connect and CRUD flow', async () => {
    const db = new Database(uri);
    await db.connect();

    const account = '__test_account__';
    const tweetId = `test_${Date.now()}`;

    const before = await db.getTodayInteractionCount(account);
    assert.strictEqual(await db.hasInteractedWithTweet(tweetId, account), false);

    const saved = await db.saveInteractedTweet({
      tweetId,
      tweetUrl: `https://x.com/u/status/${tweetId}`,
      authorUsername: 'testuser',
      interactionType: 'like',
      accountName: account,
    });
    assert.ok(saved);

    assert.strictEqual(await db.hasInteractedWithTweet(tweetId, account), true);

    const dup = await db.saveInteractedTweet({
      tweetId,
      tweetUrl: `https://x.com/u/status/${tweetId}`,
      authorUsername: 'testuser',
      interactionType: 'like',
      accountName: account,
    });
    assert.strictEqual(dup, null);

    await db.updateDailyStats(account, 'like');
    const after = await db.getTodayInteractionCount(account);
    assert.strictEqual(after, before + 1);

    await db.logActivity({
      accountName: account,
      action: 'like',
      target: tweetId,
      success: true,
    });

    const activities = await db.getRecentActivities(5);
    assert.ok(activities.length > 0);

    const stats = await db.getStats();
    assert.ok(stats.totals);

    await db.disconnect();
    if (resolved.mongod) await resolved.mongod.stop();
  });
}

async function testDashboardApi() {
  const resolved = await resolveMongoUri();
  const uri = resolved.uri;
  console.log('\n=== Dashboard API ===');
  const Database = require('../src/database');
  const Dashboard = require('../src/dashboard');
  const mongoose = require('mongoose');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    await new Promise((r) => setTimeout(r, 500));
  }

  const db = new Database(uri);
  await db.connect();

  const testPort = 3099;
  const dash = new Dashboard(db, config, () => {});
  await dash.start(testPort);

  const auth = Buffer.from(
    `${config.dashboard.username}:${config.dashboard.password}`
  ).toString('base64');

  await testAsync('GET /api/stats with auth', async () => {
    const data = await httpGet(`http://127.0.0.1:${testPort}/api/stats`, auth);
    assert.ok(data.totals !== undefined);
    assert.ok(Array.isArray(data.stats));
  });

  await testAsync('GET /api/stats without auth returns 401', async () => {
    const status = await httpGetStatus(`http://127.0.0.1:${testPort}/api/stats`, null);
    assert.strictEqual(status, 401);
  });

  await testAsync('GET /api/accounts', async () => {
    const data = await httpGet(`http://127.0.0.1:${testPort}/api/accounts`, auth);
    assert.ok(Array.isArray(data.accounts));
  });

  await dash.close();
  await db.disconnect();
  if (resolved.mongod) await resolved.mongod.stop();
}

function httpGet(url, authHeader) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (authHeader) headers.Authorization = `Basic ${authHeader}`;
    http
      .get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(body || '{}'));
        });
      })
      .on('error', reject);
  });
}

function httpGetStatus(url, authHeader) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (authHeader) headers.Authorization = `Basic ${authHeader}`;
    http
      .get(url, { headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

async function main() {
  await testDatabase();
  await testDashboardApi();

  console.log(`\n=== Kết quả: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
