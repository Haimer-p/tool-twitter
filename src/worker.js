require('dotenv').config();
const dns = require('node:dns');

dns.setDefaultResultOrder('ipv4first');
const path = require('path');

const config = require('../config');
const BrowserManager = require('./browser');
const AuthManager = require('./auth');
const AIService = require('./ai');
const Database = require('./database');
const EngagementBot = require('./engage');
const ProxyPool = require('./proxyPool');
const {
  loadAccountConfig,
  loadCampaignFromDb,
  filterAccountsByName,
  resolveBatchProfiles,
} = require('./accountConfig');
const { AccountHealthChecker, listCookieAccounts } = require('./accountHealthCheck');
const { persistHealthCheckResults } = require('./healthCheckReport');
const { AccountAppealRunner } = require('./accountAppeal');
const logger = require('./logger');

const WORKER_ID = process.env.WORKER_ID || `worker-${require('os').hostname()}`;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '4000', 10);

const RUN_PROFILES = {
  yeu: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 240000, max: 420000 },
      betweenSearchRounds: { min: 1500000, max: 2400000 },
    },
  },
  vua: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 150000, max: 300000 },
      betweenSearchRounds: { min: 900000, max: 1500000 },
    },
  },
  manh: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 90000, max: 180000 },
      betweenSearchRounds: { min: 600000, max: 1080000 },
    },
  },
};

let database = null;
let proxyPool = null;
let bot = null;
let botRunning = false;
let stopRequested = false;
let heartbeatTimer = null;
let authManager = null;
let manualLoginSession = null;
let appealInProgress = false;
let appealCaptchaWaiter = null;
let appealCaptchaWaiters = [];

function applyRunProfile(accounts, runProfile) {
  const profile = RUN_PROFILES[runProfile] || RUN_PROFILES.vua;
  const skipLimitsFromProfile = profile.skipLimits === true;
  return accounts.map((acc) => {
    const skipProfileLimits =
      skipLimitsFromProfile || acc.interactions?.skipProfileLimits === true;
    return {
      ...acc,
      delays: { ...acc.delays, ...(profile.delays || {}) },
      interactions: skipProfileLimits
        ? acc.interactions
        : { ...acc.interactions, ...(profile.interactions || {}) },
    };
  });
}

function applyRunOptions(accounts, runOptions = {}) {
  const commentTyping = runOptions.typing?.comment;
  return accounts.map((account) => ({
    ...account,
    delays: {
      ...account.delays,
      typing: commentTyping?.min != null && commentTyping?.max != null
        ? { min: commentTyping.min, max: commentTyping.max }
        : account.delays?.typing,
    },
    publishing: {
      ...(runOptions.publishing || {}),
      typing: runOptions.typing?.post || { min: 70, max: 170 },
    },
  }));
}

function normalizeConcurrency(value, profileCount, fallback = 2) {
  const parsed = Number(value);
  const safe = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1, Math.min(10, Math.max(1, profileCount), safe));
}

async function resolveProfiles(cmd) {
  const useBatch =
    (Array.isArray(cmd.campaignIds) && cmd.campaignIds.length > 0) ||
    (Array.isArray(cmd.configFiles) && cmd.configFiles.length > 0);

  if (useBatch) {
    const batch = await resolveBatchProfiles(database, config, {
      campaignIds: cmd.campaignIds || (cmd.campaignId ? [cmd.campaignId] : []),
      configFiles: cmd.configFiles || (cmd.configFile ? [cmd.configFile] : []),
      accountNames: cmd.accountNames,
    });
    let profiles = applyRunOptions(
      applyRunProfile(batch.profiles, cmd.runProfile || 'vua'),
      cmd.runOptions
    );
    const maxConcurrent = normalizeConcurrency(
      cmd.maxConcurrentOverride ??
        parseInt(process.env.MAX_PARALLEL_ACCOUNTS || '2', 10),
      profiles.length
    );
    return {
      profiles,
      maxConcurrent,
      source: batch.sources.map((s) => s.name).join(', '),
      batchMeta: batch,
    };
  }

  if (cmd.campaignId) {
    const loaded = await loadCampaignFromDb(database, cmd.campaignId, config);
    if (!loaded) throw new Error(`Campaign not found: ${cmd.campaignId}`);
    let profiles = applyRunOptions(
      applyRunProfile(loaded.accounts, cmd.runProfile || 'vua'),
      cmd.runOptions
    );
    if (cmd.accountNames?.length) {
      profiles = filterAccountsByName(profiles, cmd.accountNames);
    }
    return {
      profiles,
      maxConcurrent: normalizeConcurrency(
        cmd.maxConcurrentOverride ?? loaded.parallel?.maxConcurrent,
        profiles.length
      ),
      source: loaded.sourceName,
    };
  }

  if (cmd.configFile) {
    const loaded = loadAccountConfig(config, { configFile: cmd.configFile });
    if (!loaded) throw new Error(`Config not found: ${cmd.configFile}`);
    let profiles = applyRunOptions(
      applyRunProfile(loaded.accounts, cmd.runProfile || 'vua'),
      cmd.runOptions
    );
    if (cmd.accountNames?.length) {
      profiles = filterAccountsByName(profiles, cmd.accountNames);
    }
    return {
      profiles,
      maxConcurrent: normalizeConcurrency(
        cmd.maxConcurrentOverride ?? loaded.parallel?.maxConcurrent,
        profiles.length
      ),
      source: loaded.sourceName,
    };
  }

  throw new Error('Command missing campaignId or configFile');
}

async function runBot(profiles, maxConcurrent, meta = {}) {
  if (!bot || botRunning) return;
  botRunning = true;
  stopRequested = false;
  bot.isRunning = true;

  await database.upsertBotRuntime(WORKER_ID, {
    running: true,
    campaignId: meta.campaignId || null,
    campaignIds: meta.campaignIds || [],
    configFiles: meta.configFiles || [],
    activeSources: meta.activeSources || [],
    maxConcurrentOverride: maxConcurrent,
    runProfile: meta.runProfile || 'vua',
    runOptions: meta.runOptions || {},
    startedAt: new Date(),
    activeAccounts: profiles.map((p) => p.name),
    stopping: false,
  });

  const sourceLabel = meta.activeSources?.length
    ? meta.activeSources.map((s) => `[${s.name}]`).join(' ')
    : meta.source || 'batch';
  logger.info(`Worker bot started (${profiles.length} accounts) sources: ${sourceLabel}`);
  try {
    await bot.runParallelAccounts(profiles, maxConcurrent, proxyPool);
  } catch (error) {
    logger.error(`Worker bot error: ${error.message}`);
    throw error;
  } finally {
    botRunning = false;
    bot.isRunning = false;
    await database.upsertBotRuntime(WORKER_ID, {
      running: false,
      stopping: false,
      activeAccounts: [],
      campaignIds: [],
      configFiles: [],
      activeSources: [],
      runOptions: {},
    });
    logger.info('Worker bot finished');
  }
}

async function handleStart(cmd) {
  const resolved = await resolveProfiles(cmd);
  const { profiles, maxConcurrent, source, batchMeta } = resolved;
  if (!profiles.length) throw new Error('No accounts to run');

  // Load credentials for each account from DB
  const profilesWithCreds = await Promise.all(
    profiles.map(async (p) => {
      try {
        const creds = await database.getAccountCredentials(p.name);
        if (creds?.username && creds?.password) {
          return { ...p, credentials: { username: creds.username, password: creds.password } };
        }
      } catch { /* ignore */ }
      return p;
    })
  );

  logger.info(`Start batch: ${source}, profile: ${cmd.runProfile || 'vua'}, concurrent: ${maxConcurrent}`);
  await runBot(profilesWithCreds, maxConcurrent, {
    campaignId: cmd.campaignId || null,
    campaignIds: batchMeta?.sources?.filter((s) => s.type === 'campaign').map((s) => s.campaignId) || (cmd.campaignId ? [cmd.campaignId] : []),
    configFiles: batchMeta?.sources?.filter((s) => s.type === 'file').map((s) => s.path) || cmd.configFiles || [],
    activeSources: batchMeta?.sources || [],
    runProfile: cmd.runProfile,
    runOptions: cmd.runOptions || {},
    source,
  });
}

async function handleStop() {
  if (!botRunning && !manualLoginSession) {
    logger.warn('Stop ignored: bot is not running');
    return;
  }
  if (botRunning) {
    stopRequested = true;
    bot.isRunning = false;
    await database.upsertBotRuntime(WORKER_ID, { stopping: true });
    logger.info('Stop signal received — finishing current actions...');
  }
  await closeManualLoginSession('stop');
}

async function handleHealthCheck(cmd) {
  const accountsDir = path.join(process.cwd(), 'accounts');
  let accountNames = cmd.accountNames?.length
    ? cmd.accountNames
    : await listCookieAccounts(accountsDir);

  const checker = new AccountHealthChecker(config, database, { accountsDir });
  const results = await checker.runAll(accountNames);
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();

  await persistHealthCheckResults(database, config, results, { startedAt, completedAt });
  await database.syncHealthStatusToAccounts(results);
  return { results, summary: results.reduce((s, r) => {
    s[r.status] = (s[r.status] || 0) + 1;
    return s;
  }, {}) };
}

async function closeManualLoginSession(reason = 'manual') {
  if (!manualLoginSession) return;
  const { browserManager, accountName } = manualLoginSession;
  manualLoginSession = null;
  await database?.setAccountProxyUsage?.(accountName, null, false).catch(() => {});
  try {
    await browserManager.close();
    logger.info(`Manual login browser closed (${accountName}, reason=${reason})`);
  } catch (error) {
    logger.warn(`Close manual login browser failed: ${error.message}`);
  }
}

function isProxyRelatedLoginError(error) {
  return error?.code === 'X_LOGIN_SCRIPT_LOAD_FAILED' ||
    /proxy|connect|ECONNRESET|tunnel|ERR_TIMED_OUT|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(
      error?.message || ''
    );
}

async function handleLoginAccount(cmd, proxyRetry = 0) {
  const accountName = cmd.accountNames?.[0];
  if (!accountName) throw new Error('accountNames[0] required for login_account');
  if (!authManager) throw new Error('Auth manager not initialized');

  if (manualLoginSession?.accountName === accountName && manualLoginSession.page?.isClosed?.() === false) {
    try {
      await manualLoginSession.page.bringToFront();
    } catch {
      /* no-op */
    }
    return { ok: true, alreadyOpen: true, accountName };
  }

  await closeManualLoginSession('replace');

  const assignedProxy = proxyPool?.enabled
    ? await proxyPool.getForAccount(accountName)
    : null;
  const browserConfig = assignedProxy
    ? { ...config, browser: { ...config.browser, proxy: assignedProxy.url } }
    : config;
  const browserManager = new BrowserManager(browserConfig);
  const safeProfileName = accountName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const userDataDir = path.join(process.cwd(), 'accounts', 'browser-profiles', safeProfileName);
  try {
    await browserManager.launch({
      headless: false,
      captchaFriendly: true,
      launchOptions: { userDataDir },
    });
  } catch (error) {
    if (assignedProxy && isProxyRelatedLoginError(error)) {
      await proxyPool.markDeadAndGetNext(accountName, assignedProxy._id, error.message);
      if (proxyRetry < 1) {
        logger.warn(`[${accountName}] Retrying login browser once with a replacement proxy`);
        return handleLoginAccount(cmd, proxyRetry + 1);
      }
    }
    throw error;
  }
  const page = await browserManager.newPage();
  await database.setAccountProxyUsage(accountName, assignedProxy, true);

  let disconnected = false;
  browserManager.browser?.once('disconnected', () => {
    disconnected = true;
    if (manualLoginSession?.browserManager === browserManager) {
      manualLoginSession = null;
      database.setAccountProxyUsage(accountName, null, false).catch(() => {});
      logger.info(`Manual login browser disconnected (${accountName})`);
    }
  });

  const credentials = await database.getAccountCredentials(accountName);
  let loggedIn = false;
  try {
    loggedIn = await authManager.login(page, accountName, {
      mode: 'dashboard',
      manualTimeoutMs: 15 * 60 * 1000,
      credentials,
    });
  } catch (error) {
    await database.setAccountProxyUsage(accountName, null, false).catch(() => {});
    await browserManager.close().catch(() => {});
    if (assignedProxy && isProxyRelatedLoginError(error)) {
      await proxyPool.markDeadAndGetNext(accountName, assignedProxy._id, error.message);
      if (proxyRetry < 1) {
        logger.warn(`[${accountName}] Retrying login once with a replacement proxy`);
        return handleLoginAccount(cmd, proxyRetry + 1);
      }
    }
    throw error;
  }

  if (!loggedIn || disconnected) {
    await database.setAccountProxyUsage(accountName, null, false).catch(() => {});
    await browserManager.close().catch(() => {});
    throw new Error(`Login failed or timed out for ${accountName}`);
  }

  manualLoginSession = { browserManager, page, accountName, assignedProxy };
  return { ok: true, accountName, keptOpen: true };
}

async function handleAppeal(cmd) {
  const accountNames = (cmd.accountNames || []).map((n) => String(n).trim()).filter(Boolean);
  if (!accountNames.length) throw new Error('accountNames required for appeal');

  const accountsDir = path.join(process.cwd(), 'accounts');
  appealInProgress = true;

  await database.upsertBotRuntime(WORKER_ID, {
    appealRunning: true,
    appealWaitingCaptcha: false,
    appealCurrentAccount: null,
  });

  try {
    const runner = new AccountAppealRunner(config, {
      accountsDir,
      mode: 'dashboard',
      force: true,
      onProgress: (payload) => {
        if (payload.type === 'account_start' && payload.accountName) {
          database
            .upsertBotRuntime(WORKER_ID, { appealCurrentAccount: payload.accountName })
            .catch(() => {});
        }
      },
      onWaitingCaptcha: (payload) => {
        database
          .upsertBotRuntime(WORKER_ID, {
            appealWaitingCaptcha: !!payload.waiting,
            appealCurrentAccount: payload.accountName || undefined,
          })
          .catch(() => {});
      },
      waitCaptchaSignal: () =>
        new Promise((resolve) => {
          appealCaptchaWaiters.push(resolve);
          appealCaptchaWaiter = resolve;
        }),
    });

    const results = await runner.runAll(accountNames);
    const summary = results.reduce(
      (s, r) => {
        s[r.status] = (s[r.status] || 0) + 1;
        return s;
      },
      { total: results.length }
    );

    logger.info(
      `Appeal done: ${results.filter((r) => r.status === 'submitted').length} submitted, ` +
        `${results.filter((r) => r.status === 'skipped').length} skipped`
    );

    return { results, summary };
  } finally {
    appealInProgress = false;
    appealCaptchaWaiter = null;
    appealCaptchaWaiters = [];
    await database.upsertBotRuntime(WORKER_ID, {
      appealRunning: false,
      appealWaitingCaptcha: false,
      appealCurrentAccount: null,
    });
  }
}

function handleAppealCaptchaDone() {
  const waiters = [...appealCaptchaWaiters];
  appealCaptchaWaiters = [];
  appealCaptchaWaiter = null;
  if (waiters.length) {
    waiters.forEach((resolve) => resolve(true));
    logger.info(`Appeal captcha done signal received (${waiters.length} waiter(s))`);
    return { ok: true };
  }
  logger.warn('Appeal captcha done ignored: not waiting');
  return { ok: false, reason: 'not_waiting' };
}

async function processCommand(cmd) {
  try {
    if (cmd.action === 'start') {
      if (botRunning) throw new Error('Bot already running');
      await handleStart(cmd);
      await database.finishCommand(cmd._id, { ok: true });
    } else if (cmd.action === 'stop') {
      await handleStop();
      await database.finishCommand(cmd._id, { ok: true });
    } else if (cmd.action === 'health_check') {
      if (botRunning) throw new Error('Bot is running — stop it before health check');
      const result = await handleHealthCheck(cmd);
      await database.finishCommand(cmd._id, result);
    } else if (cmd.action === 'login_account') {
      if (botRunning) throw new Error('Bot is running — stop it before login_account');
      if (appealInProgress) throw new Error('Appeal in progress');
      const result = await handleLoginAccount(cmd);
      await database.finishCommand(cmd._id, result);
    } else if (cmd.action === 'appeal') {
      if (botRunning) throw new Error('Bot is running — stop it before appeal');
      if (appealInProgress) throw new Error('Appeal already in progress');
      const result = await handleAppeal(cmd);
      await database.finishCommand(cmd._id, result);
    } else if (cmd.action === 'appeal_captcha_done') {
      const result = handleAppealCaptchaDone();
      await database.finishCommand(cmd._id, result);
    } else if (cmd.action === 'test_proxies') {
      if (botRunning) throw new Error('Bot is running — stop it before testing proxies');
      if (!proxyPool) throw new Error('ProxyPool not initialized');
      const results = await proxyPool.testAll();
      await database.finishCommand(cmd._id, { results, count: results?.length || 0 });
    } else if (cmd.action === 'test_new_proxies') {
      if (botRunning) throw new Error('Bot is running - stop it before testing proxies');
      if (!proxyPool) throw new Error('ProxyPool not initialized');
      const results = await proxyPool.testAll({ statuses: ['untested'] });
      await database.finishCommand(cmd._id, { results, count: results?.length || 0 });
    } else {
      await database.finishCommand(cmd._id, null, `Unknown action: ${cmd.action}`);
    }
  } catch (error) {
    logger.error(`Command failed: ${error.message}`);
    await database.finishCommand(cmd._id, null, error.message);
  }
}

async function pollLoop() {
  try {
    const cmd = await database.claimNextCommand(WORKER_ID);
    if (!cmd) return;

    // Stop must be processed even while the bot is running
    if (botRunning && cmd.action !== 'stop') {
      await database.finishCommand(cmd._id, null, 'Bot is busy');
      logger.warn(`Ignored ${cmd.action} while bot running`);
      return;
    }

    if (
      appealInProgress &&
      cmd.action !== 'stop' &&
      cmd.action !== 'appeal_captcha_done'
    ) {
      await database.finishCommand(cmd._id, null, 'Appeal in progress');
      logger.warn(`Ignored ${cmd.action} while appeal running`);
      return;
    }

    await processCommand(cmd);
  } catch (error) {
    logger.error(`Poll loop error: ${error.message}`);
  }
}

async function heartbeat() {
  const patch = {
    running: botRunning,
    lastHeartbeat: new Date(),
  };
  if (!appealInProgress) {
    patch.appealRunning = false;
    patch.appealWaitingCaptcha = false;
    patch.appealCurrentAccount = null;
  }
  await database.upsertBotRuntime(WORKER_ID, patch);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI required');
    process.exit(1);
  }

  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   Twitter Bot Worker (remote control)    ║
  ║   Worker ID: ${WORKER_ID.padEnd(27)}║
  ╚═══════════════════════════════════════════╝
  `);

  database = new Database(config.database.mongodbUri);
  await database.connect();

  const released = await database.releaseStaleProcessingCommands(WORKER_ID);
  if (released?.modifiedCount > 0) {
    logger.warn(`Released ${released.modifiedCount} stale command(s) from previous worker session`);
  }

  await database.upsertBotRuntime(WORKER_ID, {
    running: false,
    appealRunning: false,
    appealWaitingCaptcha: false,
    appealCurrentAccount: null,
    lastHeartbeat: new Date(),
  });

  const browserManager = new BrowserManager(config);
  authManager = new AuthManager(
    path.join(process.cwd(), 'accounts'),
    config.baseUrl,
    database
  );
  const aiService = new AIService(config);
  bot = new EngagementBot(browserManager, authManager, aiService, database, config);

  // Initialize proxy pool
  proxyPool = new ProxyPool(database);
  await proxyPool.init();

  await database.upsertBotRuntime(WORKER_ID, { running: false, lastHeartbeat: new Date() });
  heartbeatTimer = setInterval(heartbeat, 30000);

  logger.info(`Polling commands every ${POLL_MS}ms...`);
  setInterval(pollLoop, POLL_MS);

  process.on('SIGINT', async () => {
    clearInterval(heartbeatTimer);
    await closeManualLoginSession('sigint');
    if (database) await database.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
