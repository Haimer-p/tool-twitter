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
const {
  loadAccountConfig,
  loadCampaignFromDb,
  filterAccountsByName,
} = require('./accountConfig');
const { AccountHealthChecker, listCookieAccounts } = require('./accountHealthCheck');
const { persistHealthCheckResults } = require('./healthCheckReport');
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
let bot = null;
let botRunning = false;
let stopRequested = false;
let heartbeatTimer = null;
let authManager = null;
let manualLoginSession = null;

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

async function resolveProfiles(cmd) {
  if (cmd.campaignId) {
    const loaded = await loadCampaignFromDb(database, cmd.campaignId, config);
    if (!loaded) throw new Error(`Campaign not found: ${cmd.campaignId}`);
    let profiles = applyRunProfile(loaded.accounts, cmd.runProfile || 'vua');
    if (cmd.accountNames?.length) {
      profiles = filterAccountsByName(profiles, cmd.accountNames);
    }
    return { profiles, maxConcurrent: loaded.parallel?.maxConcurrent || 2, source: loaded.sourceName };
  }

  if (cmd.configFile) {
    const loaded = loadAccountConfig(config, { configFile: cmd.configFile });
    if (!loaded) throw new Error(`Config not found: ${cmd.configFile}`);
    let profiles = applyRunProfile(loaded.accounts, cmd.runProfile || 'vua');
    if (cmd.accountNames?.length) {
      profiles = filterAccountsByName(profiles, cmd.accountNames);
    }
    return { profiles, maxConcurrent: loaded.parallel?.maxConcurrent || 2, source: loaded.sourceName };
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
    runProfile: meta.runProfile || 'vua',
    startedAt: new Date(),
    activeAccounts: profiles.map((p) => p.name),
    stopping: false,
  });

  logger.info(`Worker bot started (${profiles.length} accounts)`);
  try {
    await bot.runParallelAccounts(profiles, maxConcurrent);
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
    });
    logger.info('Worker bot finished');
  }
}

async function handleStart(cmd) {
  const { profiles, maxConcurrent, source } = await resolveProfiles(cmd);
  if (!profiles.length) throw new Error('No accounts to run');
  logger.info(`Start campaign/config: ${source}, profile: ${cmd.runProfile || 'vua'}`);
  await runBot(profiles, maxConcurrent, {
    campaignId: cmd.campaignId,
    runProfile: cmd.runProfile,
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
  try {
    await browserManager.close();
    logger.info(`Manual login browser closed (${accountName}, reason=${reason})`);
  } catch (error) {
    logger.warn(`Close manual login browser failed: ${error.message}`);
  }
}

async function handleLoginAccount(cmd) {
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

  const browserManager = new BrowserManager(config);
  await browserManager.launch({ headless: false, captchaFriendly: true });
  const page = await browserManager.newPage();

  let disconnected = false;
  browserManager.browser?.once('disconnected', () => {
    disconnected = true;
    if (manualLoginSession?.browserManager === browserManager) {
      manualLoginSession = null;
      logger.info(`Manual login browser disconnected (${accountName})`);
    }
  });

  const loggedIn = await authManager.login(page, accountName, {
    mode: 'dashboard',
    manualTimeoutMs: 15 * 60 * 1000,
  });

  if (!loggedIn || disconnected) {
    await browserManager.close().catch(() => {});
    throw new Error(`Login failed or timed out for ${accountName}`);
  }

  manualLoginSession = { browserManager, page, accountName };
  return { ok: true, accountName, keptOpen: true };
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
      const result = await handleLoginAccount(cmd);
      await database.finishCommand(cmd._id, result);
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

    await processCommand(cmd);
  } catch (error) {
    logger.error(`Poll loop error: ${error.message}`);
  }
}

async function heartbeat() {
  await database.upsertBotRuntime(WORKER_ID, {
    running: botRunning,
    lastHeartbeat: new Date(),
  });
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

  const browserManager = new BrowserManager(config);
  authManager = new AuthManager(
    path.join(process.cwd(), 'accounts'),
    config.baseUrl,
    database
  );
  const aiService = new AIService(config);
  bot = new EngagementBot(browserManager, authManager, aiService, database, config);

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
