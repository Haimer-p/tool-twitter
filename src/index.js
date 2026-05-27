require('dotenv').config();
const dns = require('node:dns');

dns.setDefaultResultOrder('ipv4first');
const path = require('path');
const readline = require('readline');
const cron = require('node-cron');

const config = require('../config');
const BrowserManager = require('./browser');
const AuthManager = require('./auth');
const AIService = require('./ai');
const Database = require('./database');
const EngagementBot = require('./engage');
const Dashboard = require('./dashboard');
const {
  loadAccountConfig,
  filterAccountsByName,
  listConfigFiles,
  resolveConfigPath,
} = require('./accountConfig');
const logger = require('./logger');

let bot = null;
let dashboard = null;
let database = null;
let botRunning = false;
let shutdownRequested = false;
let runtimeState = {
  accounts: [],
  parallel: { maxConcurrent: 2 },
  configFile: 'accounts.config.json',
  runProfile: 'vua',
};
let loginInProgress = false;

const RUN_PROFILES = {
  yeu: {
    delays: {
      betweenActions: { min: 90000, max: 180000 },
      betweenSearchRounds: { min: 600000, max: 900000 },
    },
    interactions: {
      maxPerDay: 300,
      maxPerAccountPerRun: 300,
      keywordsPerRun: 8,
      tweetsPerKeyword: 8,
    },
  },
  vua: {
    delays: {
      betweenActions: { min: 40000, max: 90000 },
      betweenSearchRounds: { min: 240000, max: 480000 },
    },
    interactions: {
      maxPerDay: 1200,
      maxPerAccountPerRun: 1200,
      keywordsPerRun: 14,
      tweetsPerKeyword: 14,
    },
  },
  manh: {
    delays: {
      betweenActions: { min: 8000, max: 25000 },
      betweenSearchRounds: { min: 45000, max: 120000 },
    },
    interactions: {
      maxPerDay: 5000,
      maxPerAccountPerRun: 5000,
      keywordsPerRun: 25,
      tweetsPerKeyword: 25,
    },
  },
};

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

function validateEnv() {
  if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    logger.error('Need at least one: GEMINI_API_KEY or DEEPSEEK_API_KEY in .env');
    logger.info('Gemini: https://aistudio.google.com/app/apikey');
    logger.info('DeepSeek: https://platform.deepseek.com/api_keys');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is required in .env (MongoDB Atlas)');
    process.exit(1);
  }
}

async function loadProfilesFromCli() {
  const accountsInput = await askQuestion(
    'Account names (comma-separated, e.g. account1,account2): '
  );
  const names = accountsInput
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (names.length === 0) {
    logger.error('At least one account is required');
    process.exit(1);
  }

  return names.map((name) => ({
    name,
    enabled: true,
    keywords: config.keywords,
    delays: config.delays,
    interactions: config.interactions,
  }));
}

function applyRunProfile(accounts, runProfile) {
  const profile = RUN_PROFILES[runProfile] || RUN_PROFILES.vua;
  return accounts.map((acc) => ({
    ...acc,
    delays: {
      ...acc.delays,
      ...(profile.delays || {}),
    },
    interactions: {
      ...acc.interactions,
      ...(profile.interactions || {}),
    },
  }));
}

async function chooseConfigFileFromCli() {
  const files = listConfigFiles();
  if (!files.length) return null;

  console.log('\nConfig files:');
  files.forEach((absPath, idx) => {
    const rel = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
    console.log(`${idx + 1}. ${rel}`);
  });
  const choice = await askQuestion('Chọn config file (Enter = mặc định số 1): ');
  const parsed = parseInt(choice.trim(), 10);
  const picked = Number.isInteger(parsed) && parsed >= 1 && parsed <= files.length ? files[parsed - 1] : files[0];
  return path.relative(process.cwd(), picked).replace(/\\/g, '/');
}

async function chooseRunProfileFromCli() {
  console.log('\nRun profile:');
  console.log('1. yeu');
  console.log('2. vua');
  console.log('3. manh');
  const choice = await askQuestion('Chọn profile (1-3, Enter = 2): ');
  const key = (choice || '').trim();
  if (key === '1' || key.toLowerCase() === 'yeu') return 'yeu';
  if (key === '3' || key.toLowerCase() === 'manh') return 'manh';
  return 'vua';
}

async function resolveAccountProfiles(configFile) {
  const loaded = loadAccountConfig(config, { configFile });
  if (loaded) {
    logger.info(
      `Loaded ${loaded.accounts.length} account(s) from ${loaded.sourceName} (parallel: ${loaded.parallel.maxConcurrent})`
    );
    return loaded;
  }

  logger.warn('No config file found — using CLI input');
  const accounts = await loadProfilesFromCli();
  return {
    accounts,
    parallel: { maxConcurrent: config.parallel?.maxConcurrent || 1 },
    sourcePath: null,
    sourceName: 'cli',
  };
}

async function runBot(profiles, maxConcurrent) {
  if (!bot || botRunning) return;
  botRunning = true;
  bot.isRunning = true;
  if (dashboard?.app) dashboard.app.locals.botRunning = true;

  logger.info(`Bot started at ${new Date().toLocaleString()}`);
  try {
    await bot.runParallelAccounts(profiles, maxConcurrent);
  } catch (error) {
    logger.error(`Bot run error: ${error.message}`);
  } finally {
    botRunning = false;
    bot.isRunning = false;
    if (dashboard?.app) dashboard.app.locals.botRunning = false;
    logger.info(`Bot finished at ${new Date().toLocaleString()}`);
    if (dashboard) await dashboard.sendStatsUpdate();
  }
}

function handleControl(action, data) {
  if (!bot) return;

  if (action === 'stop') {
    bot.isRunning = false;
    logger.info('Stop signal received');
    return;
  }

  if (action === 'start') {
    const nextConfigFile = data?.configFile || runtimeState.configFile;
    const nextProfile = data?.runProfile || runtimeState.runProfile || 'vua';

    const loaded = loadAccountConfig(config, { configFile: nextConfigFile });
    if (!loaded) {
      logger.warn(`Start ignored: config not found (${nextConfigFile})`);
      return;
    }

    runtimeState = {
      ...runtimeState,
      configFile: path.relative(process.cwd(), loaded.sourcePath).replace(/\\/g, '/'),
      runProfile: nextProfile,
      accounts: loaded.accounts,
      parallel: loaded.parallel,
    };
    if (dashboard) dashboard.botState = runtimeState;

    let profiles = applyRunProfile(runtimeState.accounts, runtimeState.runProfile);
    if (data?.accountNames?.length > 0) {
      profiles = filterAccountsByName(profiles, data.accountNames);
    }
    if (profiles.length > 0) {
      logger.info(
        `Start with config ${runtimeState.configFile}, profile ${runtimeState.runProfile}, ${profiles.length} account(s)`
      );
      runBot(profiles, runtimeState.parallel?.maxConcurrent || 2);
    } else {
      logger.warn('Start ignored: no accounts configured');
    }
  }

  if (action === 'login_account') {
    const accountName = String(data?.accountName || '').trim();
    if (!accountName) {
      logger.warn('Login ignored: account name is empty');
      return;
    }
    if (loginInProgress) {
      logger.warn('Login ignored: another login is in progress');
      return;
    }

    loginInProgress = true;
    logger.info(`Dashboard login started for ${accountName}`);
    (async () => {
      const browserManager = new BrowserManager(config);
      const authManager = new AuthManager(
        path.join(process.cwd(), 'accounts'),
        config.baseUrl
      );
      try {
        await browserManager.launch();
        const page = await browserManager.newPage();
        const ok = await authManager.login(page, accountName, {
          mode: 'dashboard',
          manualTimeoutMs: 300000,
        });
        if (ok) {
          logger.info(`Dashboard login success: ${accountName}`);
          if (dashboard) await dashboard.sendStatsUpdate();
        } else {
          logger.warn(`Dashboard login failed/timeout: ${accountName}`);
        }
      } catch (error) {
        logger.error(`Dashboard login error for ${accountName}: ${error.message}`);
      } finally {
        await browserManager.close().catch(() => null);
        loginInProgress = false;
      }
    })();
  }
}

async function shutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  logger.info('Shutting down...');

  if (bot) bot.isRunning = false;
  if (dashboard) await dashboard.close();
  if (database) await database.disconnect();
  process.exit(0);
}

async function main() {
  validateEnv();

  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   Twitter/X Auto Engagement Tool          ║
  ║   Multi-account + Combo + Gemini/DeepSeek   ║
  ╚═══════════════════════════════════════════╝
  `);

  database = new Database(config.database.mongodbUri);
  await database.connect();

  const browserManager = new BrowserManager(config);
  const authManager = new AuthManager(
    path.join(process.cwd(), 'accounts'),
    config.baseUrl
  );
  const aiService = new AIService(config);

  bot = new EngagementBot(
    browserManager,
    authManager,
    aiService,
    database,
    config,
    () => dashboard?.sendStatsUpdate()
  );

  dashboard = new Dashboard(database, config, handleControl);
  dashboard.app.locals.botRunning = false;
  await dashboard.start(config.dashboard.port);

  const selectedConfigFile = await chooseConfigFileFromCli();
  const selectedRunProfile = await chooseRunProfileFromCli();
  const { accounts, parallel, sourcePath } = await resolveAccountProfiles(selectedConfigFile);
  const normalizedConfigFile = sourcePath
    ? path.relative(process.cwd(), resolveConfigPath(sourcePath)).replace(/\\/g, '/')
    : selectedConfigFile || 'accounts.config.json';

  runtimeState = {
    accounts,
    parallel,
    configFile: normalizedConfigFile,
    runProfile: selectedRunProfile,
  };
  if (dashboard) dashboard.botState = runtimeState;

  console.log('\nSchedule:');
  console.log('1. Run now');
  console.log('2. Cron schedule');
  console.log('3. Run once and exit');

  const scheduleChoice = await askQuestion('Choice (1-3): ');

  const run = () => {
    const profiles = applyRunProfile(runtimeState.accounts, runtimeState.runProfile);
    logger.info(`Run profile: ${runtimeState.runProfile} | config: ${runtimeState.configFile}`);
    return runBot(profiles, runtimeState.parallel.maxConcurrent);
  };

  switch (scheduleChoice.trim()) {
    case '2': {
      const cronExp = await askQuestion('Cron expression (e.g. 0 */6 * * *): ');
      if (!cron.validate(cronExp)) {
        logger.error('Invalid cron expression');
        process.exit(1);
      }
      logger.info(`Scheduled: ${cronExp}`);
      cron.schedule(cronExp, run);
      await run();
      logger.info('Cron active. Dashboard running. Ctrl+C to exit.');
      break;
    }
    case '3':
      await run();
      logger.info('Done. Dashboard still running. Ctrl+C to exit.');
      break;
    case '1':
    default:
      await run();
      logger.info('Run complete. Dashboard still running. Ctrl+C to exit.');
      break;
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  logger.error(err.message, { stack: err.stack });
  process.exit(1);
});
