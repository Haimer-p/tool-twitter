/**
 * Unit / integration tests (no Twitter browser required).
 * MongoDB: uses MONGODB_URI from .env, or skips DB block.
 */
const assert = require('assert');
const http = require('http');
const { parseTweetId, randomMs, parseSocialCount } = require('../src/utils');
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
test('parseSocialCount formats', () => {
  assert.strictEqual(parseSocialCount('1,234'), 1234);
  assert.strictEqual(parseSocialCount('1.2K'), 1200);
  assert.strictEqual(parseSocialCount('10M'), 10000000);
  assert.strictEqual(parseSocialCount('999'), 999);
});
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
test('interaction ratios sum to 1', () => {
  const { likeRatio, retweetRatio, replyRatio, followRatio } = config.interactions;
  const sum = likeRatio + retweetRatio + replyRatio + followRatio;
  assert.ok(Math.abs(sum - 1) < 0.001, `sum=${sum}`);
});
test('default gemini model is current', () => {
  const model = config.gemini.model;
  assert.ok(!model.includes('1.5'), `deprecated model: ${model}`);
  assert.match(model, /^gemini-2\./, `unexpected model: ${model}`);
});
test('deepseek model configured', () => {
  assert.ok(config.deepseek.model);
  assert.ok(config.deepseek.baseUrl.includes('deepseek.com'));
});
test('ai primary provider valid', () => {
  assert.ok(['gemini', 'deepseek'].includes(config.ai.primary));
});

console.log('\n=== AIService providers ===');
const AIService = require('../src/ai');

test('getProviderOrder gemini primary', () => {
  const ai = new AIService({ geminiKey: 'g', deepseekKey: 'd' }, config);
  assert.deepStrictEqual(ai.getProviderOrder(), ['gemini', 'deepseek']);
});
test('getProviderOrder deepseek primary', () => {
  const cfg = { ...config, ai: { primary: 'deepseek' } };
  const ai = new AIService({ geminiKey: 'g', deepseekKey: 'd' }, cfg);
  assert.deepStrictEqual(ai.getProviderOrder(), ['deepseek', 'gemini']);
});
test('getProviderOrder only deepseek', () => {
  const ai = new AIService({ geminiKey: '', deepseekKey: 'd' }, config);
  assert.deepStrictEqual(ai.getProviderOrder(), ['deepseek']);
});
test('hasAnyProvider', () => {
  assert.strictEqual(new AIService({ geminiKey: '', deepseekKey: '' }, config).hasAnyProvider(), false);
  assert.strictEqual(new AIService({ geminiKey: 'x', deepseekKey: '' }, config).hasAnyProvider(), true);
});
test('airdrop config has wallet keywords', () => {
  assert.ok(config.airdrop.evmKeywords.length > 0);
  assert.ok(config.airdrop.solanaKeywords.length > 0);
  assert.ok(config.airdrop.genericKeywords.length > 0);
});

console.log('\n=== Wallet matcher ===');
const { classifyWalletRequest, buildRuleComments } = require('../src/walletMatcher');
const airdropCfg = config.airdrop;

test('classifyWalletRequest evm', () => {
  assert.strictEqual(
    classifyWalletRequest('Drop your EVM address below', airdropCfg),
    'evm'
  );
});
test('classifyWalletRequest solana', () => {
  assert.strictEqual(
    classifyWalletRequest('Reply with your phantom wallet', airdropCfg),
    'solana'
  );
});
test('classifyWalletRequest both generic', () => {
  assert.strictEqual(
    classifyWalletRequest('Drop your wallet address in comments', airdropCfg),
    'both'
  );
});
test('classifyWalletRequest none', () => {
  assert.strictEqual(
    classifyWalletRequest('Great project, when TGE?', airdropCfg),
    'none'
  );
});
test('classifyWalletRequest broad airdrop keyword', () => {
  assert.strictEqual(
    classifyWalletRequest('New airdrop coming soon for holders!', airdropCfg),
    'both'
  );
});
test('classifyWalletRequest drop wallet', () => {
  assert.strictEqual(
    classifyWalletRequest('Drop wallet in comments to join', airdropCfg),
    'both'
  );
});
test('buildRuleComments both returns 2', () => {
  const cfg = {
    airdrop: config.airdrop,
    wallets: { evm: '0xEVM', solana: 'SOL123' },
  };
  const comments = buildRuleComments('both', cfg);
  assert.strictEqual(comments.length, 2);
  assert.ok(comments[0].includes('0xEVM'));
  assert.ok(comments[1].includes('SOL123'));
});
test('buildRuleComments evm/solana single', () => {
  const cfg = {
    airdrop: config.airdrop,
    wallets: { evm: '0xABC', solana: 'SOLxyz' },
  };
  assert.strictEqual(buildRuleComments('evm', cfg).length, 1);
  assert.strictEqual(buildRuleComments('solana', cfg).length, 1);
  assert.strictEqual(buildRuleComments('none', cfg).length, 0);
});
test('classifyWalletRequest both when evm and solana keywords', () => {
  assert.strictEqual(
    classifyWalletRequest('Drop EVM address or solana wallet', airdropCfg),
    'both'
  );
});
test('classifyWalletRequest env address typo maps evm', () => {
  assert.strictEqual(
    classifyWalletRequest('Reply with your env address', airdropCfg),
    'evm'
  );
});

console.log('\n=== Account profiles ===');
const { buildAccountJobs } = require('../src/accountProfiles');

test('buildAccountJobs per-account mode and keywords', () => {
  const profiles = {
    accounts: [
      { name: 'a1', mode: 'airdrop', useAi: false, keywords: ['airdrop'] },
      { name: 'a2', mode: 'engage', useAi: true, keywords: ['web3'] },
      { name: 'a3', enabled: false, mode: 'engage', keywords: ['x'] },
    ],
  };
  const jobs = buildAccountJobs(['a1', 'a2', 'a3'], profiles, { mode: 'engage', useAi: false, keywords: [] }, config);
  assert.strictEqual(jobs.length, 2);
  assert.strictEqual(jobs[0].accountName, 'a1');
  assert.strictEqual(jobs[0].mode, 'airdrop');
  assert.deepStrictEqual(jobs[0].keywords, ['airdrop']);
  assert.strictEqual(jobs[1].mode, 'engage');
});

test('buildAccountJobs fallback to global defaults', () => {
  const jobs = buildAccountJobs(
    ['unknown'],
    { accounts: [] },
    { mode: 'engage', useAi: false, keywords: ['btc'] },
    config
  );
  assert.strictEqual(jobs[0].keywords[0], 'btc');
});

console.log('\n=== AirdropBot ===');
const AirdropBot = require('../src/airdropBot');
const ruleBot = new AirdropBot({}, {}, {}, {}, config, { useAi: false });
const aiBot = new AirdropBot({}, {}, {}, {}, config, { useAi: true });

test('getReplyPlan rule both → 2 steps', () => {
  const plan = ruleBot.getReplyPlan('both');
  assert.strictEqual(plan.length, 2);
  assert.strictEqual(plan[0].walletType, 'evm');
  assert.strictEqual(plan[1].walletType, 'solana');
});
test('getReplyPlan rule evm → 1 step', () => {
  assert.strictEqual(ruleBot.getReplyPlan('evm').length, 1);
});
test('getReplyPlan ai both → 2 comment riêng', () => {
  const plan = aiBot.getReplyPlan('both');
  assert.strictEqual(plan.length, 2);
  assert.strictEqual(plan[0].walletType, 'evm');
  assert.strictEqual(plan[1].walletType, 'solana');
  assert.strictEqual(plan[0].useAi, true);
});
test('airdrop engageOnReply default true', () => {
  assert.strictEqual(ruleBot.engageOnReply, true);
  assert.strictEqual(ruleBot.followOnReply, true);
});
test('engageBeforeComment exists on EngagementBot', () => {
  const EngagementBot = require('../src/engage');
  assert.strictEqual(typeof EngagementBot.prototype.engageBeforeComment, 'function');
});
test('buildAccountJobs includes engageOnReply', () => {
  const jobs = buildAccountJobs(
    ['a1'],
    { accounts: [{ name: 'a1', mode: 'airdrop', engageOnReply: false }] },
    { mode: 'airdrop', engageOnReply: true },
    config
  );
  assert.strictEqual(jobs[0].engageOnReply, false);
});

console.log('\n=== EngagementBot.decideAction ===');
const EngagementBot = require('../src/engage');
const mockBot = new EngagementBot({}, {}, {}, {}, config);
test('decideAction returns valid actions', () => {
  const valid = new Set(['like', 'retweet', 'reply', 'follow']);
  for (let i = 0; i < 200; i++) {
    assert.ok(valid.has(mockBot.decideAction()));
  }
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
  require('../src/walletMatcher');
  require('../src/airdropBot');
  require('../src/accountProfiles');
  require('../src/accountRunner');
});

function isUsableMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  if (uri.includes('<user>') || uri.includes('<cluster>') || uri.includes('<password>')) {
    return false;
  }
  return uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');
}

async function createMemoryMongo() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  return { uri: mongod.getUri(), memory: true, mongod };
}

async function resolveMongoUri() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  if (isUsableMongoUri(process.env.MONGODB_URI)) {
    return { uri: process.env.MONGODB_URI, memory: false };
  }
  return createMemoryMongo();
}

async function testDatabase() {
  const resolved = await resolveMongoUri();
  const uri = resolved.uri;
  console.log(
    `\n=== Database (${resolved.memory ? 'in-memory' : 'Atlas/local'}) ===`
  );
  const Database = require('../src/database');

  await testAsync('connect and CRUD flow', async () => {
    let active = resolved;
    let db = new Database(active.uri);
    try {
      await db.connect();
    } catch (connectErr) {
      if (active.memory) throw connectErr;
      if (active.mongod) await active.mongod.stop().catch(() => {});
      active = await createMemoryMongo();
      db = new Database(active.uri);
      await db.connect();
    }

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
      walletType: 'engage',
    });
    assert.ok(saved);

    assert.strictEqual(await db.hasInteractedWithTweet(tweetId, account), true);

    const dup = await db.saveInteractedTweet({
      tweetId,
      tweetUrl: `https://x.com/u/status/${tweetId}`,
      authorUsername: 'testuser',
      interactionType: 'like',
      accountName: account,
      walletType: 'engage',
    });
    assert.strictEqual(dup, null);

    const savedEvm = await db.saveInteractedTweet({
      tweetId,
      tweetUrl: `https://x.com/u/status/${tweetId}`,
      authorUsername: 'testuser',
      interactionType: 'reply',
      accountName: account,
      walletType: 'evm',
      botMode: 'airdrop',
    });
    assert.ok(savedEvm);

    const savedSol = await db.saveInteractedTweet({
      tweetId,
      tweetUrl: `https://x.com/u/status/${tweetId}`,
      authorUsername: 'testuser',
      interactionType: 'reply',
      accountName: account,
      walletType: 'solana',
      botMode: 'airdrop',
    });
    assert.ok(savedSol);

    assert.strictEqual(await db.hasInteractedWithTweet(tweetId, account, 'evm'), true);
    assert.strictEqual(await db.hasInteractedWithTweet(tweetId, account, 'solana'), true);

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
    if (active.mongod) await active.mongod.stop();
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

  let db = new Database(uri);
  try {
    await db.connect();
  } catch {
    if (resolved.memory) throw new Error('MongoDB connect failed');
    if (resolved.mongod) await resolved.mongod.stop().catch(() => {});
    const mem = await createMemoryMongo();
    db = new Database(mem.uri);
    await db.connect();
    resolved.mongod = mem.mongod;
  }

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

  await testAsync('GET /api/account-profiles', async () => {
    const data = await httpGet(`http://127.0.0.1:${testPort}/api/account-profiles`, auth);
    assert.ok(Array.isArray(data.accounts));
  });

  await testAsync('GET /api/status returns mode fields', async () => {
    dash.app.locals.botMode = 'airdrop';
    dash.app.locals.useAi = true;
    dash.app.locals.commentMode = 'ai';
    dash.app.locals.botRunning = false;
    const data = await httpGet(`http://127.0.0.1:${testPort}/api/status`, auth);
    assert.strictEqual(data.mode, 'airdrop');
    assert.strictEqual(data.useAi, true);
    assert.strictEqual(data.commentMode, 'ai');
    assert.strictEqual(data.running, false);
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

async function testGeminiApi() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!geminiKey && !deepseekKey) {
    console.log('\n=== AI API live (skipped — no GEMINI/DEEPSEEK key) ===');
    return;
  }

  console.log('\n=== AI API live ===');
  const ai = new AIService({ geminiKey: geminiKey || '', deepseekKey: deepseekKey || '' }, config);

  await testAsync('generateReply live call', async () => {
    const reply = await ai.generateReply('Bitcoin hits new ATH!', 'cryptouser');
    assert.ok(typeof reply === 'string');
    assert.ok(reply.length > 0);
    assert.ok(reply.length <= 280);
  });

  await testAsync('generateAirdropReply live call', async () => {
    const wallets = { evm: '0xTestEvm123', solana: 'SolTest456' };
    const reply = await ai.generateAirdropReply(
      'Drop your wallet address for airdrop!',
      'airdropking',
      'both',
      wallets
    );
    assert.ok(typeof reply === 'string');
    assert.ok(reply.length > 0);
    assert.ok(reply.length <= 100);
    assert.ok(reply.includes('0xTestEvm123') || reply.includes('SolTest456'));
  });
}

async function testAiFallback() {
  console.log('\n=== AI fallback (mock) ===');
  const ai = new AIService({ geminiKey: 'invalid-gemini', deepseekKey: 'invalid-deepseek' }, config);

  await testAsync('generateAirdropReply falls back to rule comments when all AI fail', async () => {
    const wallets = { evm: '0xFallback', solana: 'SolFallback' };
    const reply = await ai.generateAirdropReply(
      'Drop wallet',
      'user',
      'evm',
      wallets
    );
    assert.strictEqual(reply, '0xFallback');
  });
}

async function main() {
  await testDatabase();
  await testDashboardApi();
  await testAiFallback();
  await testGeminiApi();

  console.log(`\n=== Kết quả: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
