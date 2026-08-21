/**
 * Unit / integration tests (no Twitter browser required).
 * MongoDB: uses MONGODB_URI from .env, or skips DB block.
 */
const assert = require('assert');
const http = require('http');
const { parseTweetId, randomMs, parseFollowerCount } = require('../src/utils');
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
test('parseFollowerCount', () => {
  assert.strictEqual(parseFollowerCount('1,234'), 1234);
  assert.strictEqual(parseFollowerCount('1.2K'), 1200);
  assert.strictEqual(parseFollowerCount('10M'), 10000000);
  assert.strictEqual(parseFollowerCount('5.5K Followers'), 5500);
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

console.log('\n=== Gemini key pool ===');
const { parseGeminiKeysFromEnv, GeminiKeyPool } = require('../src/geminiKeyPool');
test('parseGeminiKeysFromEnv splits comma in GEMINI_API_KEY', () => {
  const prev = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEYS: process.env.GEMINI_API_KEYS,
  };
  process.env.GEMINI_API_KEY = 'key-a,key-b,key-c';
  delete process.env.GEMINI_API_KEYS;
  try {
    const keys = parseGeminiKeysFromEnv();
    assert.strictEqual(keys.length, 3);
  } finally {
    process.env.GEMINI_API_KEY = prev.GEMINI_API_KEY;
    process.env.GEMINI_API_KEYS = prev.GEMINI_API_KEYS;
  }
});
test('parseGeminiKeysFromEnv dedupes', () => {
  const prev = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEYS: process.env.GEMINI_API_KEYS,
  };
  process.env.GEMINI_API_KEY = 'key-a';
  process.env.GEMINI_API_KEYS = 'key-b,key-a';
  try {
    const keys = parseGeminiKeysFromEnv();
    assert.strictEqual(keys.length, 2);
    assert.ok(keys.includes('key-a'));
    assert.ok(keys.includes('key-b'));
  } finally {
    process.env.GEMINI_API_KEY = prev.GEMINI_API_KEY;
    process.env.GEMINI_API_KEYS = prev.GEMINI_API_KEYS;
  }
});
test('GeminiKeyPool daily reset clears failed', () => {
  const statePath = require('path').join(__dirname, '..', 'logs', 'test-gemini-pool.json');
  const prevKeys = process.env.GEMINI_API_KEYS;
  process.env.GEMINI_API_KEYS = 'k1,k2';
  delete process.env.GEMINI_API_KEY;
  try {
    require('fs').mkdirSync(require('path').dirname(statePath), { recursive: true });
    require('fs').writeFileSync(
      statePath,
      JSON.stringify({ resetDate: '2000-01-01', failed: { '0': { failedAt: 'x', reason: 'quota' } } })
    );
    const pool = new GeminiKeyPool({ statePath });
    const status = pool.getStatus();
    assert.strictEqual(status.available, 2);
    assert.strictEqual(status.failed, 0);
  } finally {
    process.env.GEMINI_API_KEYS = prevKeys;
    try {
      require('fs').unlinkSync(statePath);
    } catch {
      /* ignore */
    }
  }
});

console.log('\n=== AIService reply required includes ===');
const AIService = require('../src/ai');
const aiTest = new AIService(config);
test('finalizeReply appends missing link', () => {
  const out = aiTest.finalizeReply('Nice chart', {
    requiredIncludes: ['https://dexscreener.com/solana/test'],
    maxLength: 275,
  });
  assert.ok(out.includes('dexscreener.com'));
  assert.ok(out.includes('Nice chart'));
});
test('finalizeReply appends missing wallet address', () => {
  const wallet = 'BbCqBPtnvv3BYsGQRjuiNEDFbRXSMxkrCYmuPQcT5nUq';
  const out = aiTest.finalizeReply('LFG airdrop!', {
    requiredIncludes: [wallet],
    maxLength: 280,
  });
  assert.ok(out.includes(wallet));
  assert.ok(out.includes('LFG airdrop!'));
});
test('finalizeReply dedupes duplicate dex URLs', () => {
  const link = 'https://dexscreener.com/solana/9gs19u3zuy8m4ujqoztv1xa6fnu6j9zguze8jypey9dp';
  const dup = `Chart looks good ${link} ${link} Boomerang`;
  const out = aiTest.finalizeReply(dup, {
    requiredIncludes: [link, 'Boomerang'],
    maxLength: 275,
  });
  const count = (out.match(/dexscreener\.com/gi) || []).length;
  assert.strictEqual(count, 1, `expected 1 dex link, got ${count}`);
});
test('finalizeReply does not re-append link when slug already present', () => {
  const link = 'https://dexscreener.com/solana/9gs19u3zuy8m4ujqoztv1xa6fnu6j9zguze8jypey9dp';
  const out = aiTest.finalizeReply(`solid pump ${link}`, {
    requiredIncludes: [link, 'Boomerang'],
    maxLength: 275,
  });
  const count = (out.match(/9gs19u3zuy8m4ujqoztv1xa6fnu6j9zguze8jypey9dp/gi) || []).length;
  assert.ok(count <= 1);
});

console.log('\n=== Proxy fetcher ===');
const ProxyFetcher = require('../src/proxyFetcher');
test('proxy sources are unique and include diversified providers', () => {
  const sources = ProxyFetcher.getSources();
  assert.ok(sources.length >= 11);
  assert.strictEqual(new Set(sources.map((source) => source.url)).size, sources.length);
  assert.ok(sources.some((source) => source.name.includes('Proxifly')));
  assert.ok(sources.some((source) => source.name.includes('Monosans')));
});
test('proxy parser rejects invalid hosts and ports', () => {
  const proxies = ProxyFetcher.extractProxiesFromText(
    '1.2.3.4:8080 999.2.3.4:80 1.2.3.4:70000 https://5.6.7.8:443',
    'http'
  );
  assert.deepStrictEqual(proxies, ['http://1.2.3.4:8080', 'https://5.6.7.8:443']);
});

async function testProxyFetcherDetails() {
  await testAsync('fetchAllDetailed reports each source and deduplicates', async () => {
    const originalFetchUrl = ProxyFetcher.fetchUrl;
    const originalGeonode = ProxyFetcher.fetchFromGeonode;
    ProxyFetcher.fetchUrl = async () => ({ ok: true, data: '1.2.3.4:80\n5.6.7.8:8080' });
    ProxyFetcher.fetchFromGeonode = async () => ['http://1.2.3.4:80'];
    try {
      const result = await ProxyFetcher.fetchAllDetailed(20);
      assert.strictEqual(result.proxies.length, 2);
      assert.strictEqual(result.sources.length, ProxyFetcher.getSources().length + 1);
      assert.ok(result.sources.every((source) => source.ok));
    } finally {
      ProxyFetcher.fetchUrl = originalFetchUrl;
      ProxyFetcher.fetchFromGeonode = originalGeonode;
    }
  });
}
test('splitThreadText parses JSON and preserves numbered content', () => {
  const parts = aiTest.splitThreadText(
    JSON.stringify(['2026 could be an important year for builders.', 'Execution still matters most.']),
    260,
    4
  );
  assert.deepStrictEqual(parts, [
    '2026 could be an important year for builders.',
    'Execution still matters most.',
  ]);
});
test('splitThreadText enforces per-part and total limits', () => {
  const parts = aiTest.splitThreadText('word '.repeat(300), 80, 3);
  assert.ok(parts.length > 1 && parts.length <= 3);
  assert.ok(parts.every((part) => part.length <= 80));
});
test('splitThreadTextDetailed detects truncation instead of silently dropping content', () => {
  const parsed = aiTest.splitThreadTextDetailed('word '.repeat(300), 80, 2);
  assert.strictEqual(parsed.truncated, true);
  assert.strictEqual(parsed.parts.length, 2);
});
test('splitThreadTextDetailed rejects non-string JSON parts', () => {
  const parsed = aiTest.splitThreadTextDetailed(JSON.stringify(['valid', { text: 'bad' }]), 80, 4);
  assert.strictEqual(parsed.truncated, true);
  assert.deepStrictEqual(parsed.parts, ['valid']);
});

console.log('\n=== EngagementBot.decideActionCombo ===');
const EngagementBot = require('../src/engage');
const mockBot = new EngagementBot({}, {}, {}, {}, config);
const VALID_ACTIONS = new Set(['like', 'retweet', 'reply', 'follow']);
test('decideActionCombo returns valid action arrays', () => {
  const ratios = config.interactions.comboRatios;
  for (let i = 0; i < 200; i++) {
    const combo = mockBot.decideActionCombo(ratios);
    assert.ok(Array.isArray(combo) && combo.length > 0);
    for (const action of combo) {
      assert.ok(VALID_ACTIONS.has(action), `invalid action: ${action}`);
    }
  }
});
test('like_reply runs reply before like', () => {
  const combo = mockBot.decideActionCombo({ like_reply: 1 });
  assert.deepStrictEqual(combo, ['reply', 'like']);
  const combo3 = mockBot.decideActionCombo({ like_retweet_reply: 1 });
  assert.deepStrictEqual(combo3, ['reply', 'retweet', 'like']);
  const combo4 = mockBot.decideActionCombo({ like_retweet_reply_follow: 1 });
  assert.deepStrictEqual(combo4, ['reply', 'retweet', 'like', 'follow']);
});
test('getReplyTimeouts uses config defaults', () => {
  const ctx = {
    interactions: {},
  };
  const t = mockBot.getReplyTimeouts(ctx);
  assert.strictEqual(t.composer, config.interactions.replyComposerTimeoutMs);
  assert.strictEqual(t.post, config.interactions.replyPostTimeoutMs);
});
test('getReplyTimeouts merges per-account overrides', () => {
  const ctx = {
    interactions: { replyPostTimeoutMs: 25000, replyComposerTimeoutMs: 12000 },
  };
  const t = mockBot.getReplyTimeouts(ctx);
  assert.strictEqual(t.post, 25000);
  assert.strictEqual(t.composer, 12000);
});
test('classifyLoginIssueText detects the X temporary login limit', () => {
  const AuthManager = require('../src/auth');
  const auth = new AuthManager();
  const detected = auth.classifyLoginIssueText(
    "We've temporarily limited your login. Please try again later."
  );
  assert.strictEqual(detected?.code, 'X_LOGIN_RATE_LIMITED');
});

async function testTypingPacing() {
  await testAsync('humanType preserves emoji/newline and completes', async () => {
    const sent = [];
    const pressed = [];
    const page = {
      click: async () => {},
      keyboard: {
        down: async () => {},
        up: async () => {},
        press: async (key) => pressed.push(key),
        sendCharacter: async (char) => sent.push(char),
      },
    };
    const ok = await mockBot.humanType(page, '#composer', 'A😀\nB', {
      delays: { typing: { min: 0, max: 0 } },
    });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(sent.slice(-3), ['A', '😀', 'B']);
    assert.ok(pressed.includes('Enter'));
  });
  await testAsync('postReply never submits twice after an ambiguous confirmation', async () => {
    let clicks = 0;
    const originalWait = mockBot.waitForEnabledPostButton;
    const originalConfirm = mockBot.confirmReplyPosted;
    const originalLength = mockBot.getComposerTextLength;
    mockBot.waitForEnabledPostButton = async () => ({ click: async () => { clicks += 1; } });
    mockBot.confirmReplyPosted = async () => false;
    mockBot.getComposerTextLength = async () => 12;
    try {
      const posted = await mockBot.postReply({}, { accountName: 'test', interactions: {} });
      assert.strictEqual(posted, false);
      assert.strictEqual(clicks, 1);
    } finally {
      mockBot.waitForEnabledPostButton = originalWait;
      mockBot.confirmReplyPosted = originalConfirm;
      mockBot.getComposerTextLength = originalLength;
    }
  });
}

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
  if (process.env.FORCE_MEMORY_DB !== 'true' && process.env.MONGODB_URI) {
    return { uri: process.env.MONGODB_URI, memory: false };
  }

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

    await db.logActivity({
      accountName: account,
      action: 'post',
      target: `https://x.com/${account}/status/1`,
      success: true,
    });
    const lastPost = await db.getLastSuccessfulActivity(account, ['post']);
    assert.strictEqual(lastPost?.action, 'post');

    const publicationAccount = `${account}_${Date.now()}`;
    assert.ok(await db.reservePublication(publicationAccount, 12, 30));
    assert.strictEqual(await db.reservePublication(publicationAccount, 12, 30), null);
    await db.finishPublication(publicationAccount, { success: false, preSubmitFailure: true });
    assert.ok(await db.reservePublication(publicationAccount, 12, 30));
    await db.finishPublication(publicationAccount, { success: true });
    assert.strictEqual(await db.reservePublication(publicationAccount, 12, 30), null);

    const activities = await db.getRecentActivities(5);
    assert.ok(activities.length > 0);

    const stats = await db.getStats();
    assert.ok(stats.totals);

    const proxyUrl = `http://127.0.0.1:${10000 + Math.floor(Math.random() * 50000)}`;
    const firstProxyInsert = await db.addProxies([proxyUrl, proxyUrl]);
    assert.strictEqual(firstProxyInsert.length, 1);
    await db.updateProxyStatus(firstProxyInsert[0]._id.toString(), 'active');
    const duplicateProxyInsert = await db.addProxies([proxyUrl]);
    assert.strictEqual(duplicateProxyInsert.length, 0);
    const storedProxy = (await db.listProxies()).find((proxy) => proxy.url === proxyUrl);
    assert.strictEqual(storedProxy?.status, 'active');

    const proxyAccount = `__proxy_usage_${Date.now()}__`;
    await db.saveAccountCookies(proxyAccount, []);
    await db.setAccountProxyUsage(proxyAccount, storedProxy, true);
    let proxyAccountDoc = await db.getAccount(proxyAccount);
    assert.strictEqual(proxyAccountDoc?.proxyUsage?.url, proxyUrl);
    assert.strictEqual(proxyAccountDoc?.proxyUsage?.inUse, true);
    await db.setAccountProxyUsage(proxyAccount, storedProxy, false);
    proxyAccountDoc = await db.getAccount(proxyAccount);
    assert.strictEqual(proxyAccountDoc?.proxyUsage?.inUse, false);

    const stickyBase = 20000 + Math.floor(Math.random() * 30000);
    const stickyUrls = [0, 1, 2].map((offset) => `http://127.0.0.1:${stickyBase + offset}`);
    const stickyProxies = await db.addProxies(stickyUrls);
    for (const proxy of stickyProxies) {
      await db.updateProxyStatus(proxy._id.toString(), 'active');
    }
    const stickyAccountA = `__sticky_a_${Date.now()}__`;
    const stickyAccountB = `__sticky_b_${Date.now()}__`;
    await db.saveAccountCookies(stickyAccountA, []);
    await db.saveAccountCookies(stickyAccountB, []);
    const stickyA1 = await db.getOrAssignProxy(stickyAccountA);
    const stickyA2 = await db.getOrAssignProxy(stickyAccountA);
    const stickyB = await db.getOrAssignProxy(stickyAccountB);
    assert.strictEqual(String(stickyA1?._id), String(stickyA2?._id));
    assert.notStrictEqual(String(stickyA1?._id), String(stickyB?._id));
    await db.deleteProxy(stickyA1._id.toString());
    const stickyAReplacement = await db.getOrAssignProxy(stickyAccountA);
    assert.ok(stickyAReplacement);
    assert.notStrictEqual(String(stickyAReplacement._id), String(stickyA1._id));
    const rotatedStickyA = await db.rotateAccountProxy(stickyAccountA);
    assert.ok(rotatedStickyA);
    assert.notStrictEqual(String(rotatedStickyA._id), String(stickyAReplacement._id));
    await db.setAccountProxyUsage(stickyAccountA, rotatedStickyA, true);
    await assert.rejects(
      () => db.rotateAccountProxy(stickyAccountA),
      (error) => error.code === 'ACCOUNT_PROXY_IN_USE'
    );
    await db.setAccountProxyUsage(stickyAccountA, rotatedStickyA, false);

    await db.updateAccount(stickyAccountB, {
      twitterUsername: 'renamed_login',
      password: 'test-password',
    });
    await db.updateDailyStats(stickyAccountB, 'like');
    const renamedStickyAccount = `${stickyAccountB}_renamed`;
    await db.upsertBotRuntime('rename-test-worker', {
      running: true,
      activeAccounts: [stickyAccountB],
    });
    const renamedAccount = await db.renameAccount(stickyAccountB, renamedStickyAccount);
    assert.strictEqual(renamedAccount?.name, renamedStickyAccount);
    assert.strictEqual((await db.getAccount(stickyAccountB))?.name, renamedStickyAccount);
    assert.ok((await db.getBotRuntime('rename-test-worker'))?.activeAccounts.includes(renamedStickyAccount));
    const renamedCredentials = await db.getAccountCredentials(renamedStickyAccount);
    assert.strictEqual(renamedCredentials?.username, 'renamed_login');
    assert.strictEqual(renamedCredentials?.password, 'test-password');
    const renamedProxy = await db.getOrAssignProxy(renamedStickyAccount);
    assert.strictEqual(String(renamedProxy?._id), String(stickyB?._id));
    await db.updateDailyStats(stickyAccountB, 'like');
    assert.ok((await db.getTodayInteractionCount(renamedStickyAccount)) >= 1);

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
  await testProxyFetcherDetails();
  await testTypingPacing();
  if (process.env.SKIP_DB_TESTS === 'true') {
    console.log('\n=== Database/Dashboard skipped (SKIP_DB_TESTS=true) ===');
  } else {
    await testDatabase();
    await testDashboardApi();
  }

  console.log(`\n=== Kết quả: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
