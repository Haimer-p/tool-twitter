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
const { AccountHealthChecker, listCookieAccounts } = require('./accountHealthCheck');
const { AccountAppealRunner } = require('./accountAppeal');
const {
  loadAccountConfig,
  loadCampaignFromDb,
  filterAccountsByName,
  listConfigFiles,
  resolveConfigPath,
} = require('./accountConfig');
const logger = require('./logger');
const { persistHealthCheckResults, loadHealthCheckReport } = require('./healthCheckReport');

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
let healthCheckInProgress = false;
let healthCheckStopRequested = false;
let healthCheckCurrentBrowser = null;
let appealInProgress = false;
let appealCaptchaWaiter = null;

const RUN_PROFILES = {
  // Chỉ override delay — giữ nguyên keywords/tweets từ config file (skipLimits).
  yeu: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 240000, max: 420000 }, // 4–7 phút
      betweenSearchRounds: { min: 1500000, max: 2400000 }, // 25–40 phút
    },
  },
  vua: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 150000, max: 300000 }, // 2.5–5 phút
      betweenSearchRounds: { min: 900000, max: 1500000 }, // 15–25 phút
    },
  },
  manh: {
    skipLimits: true,
    delays: {
      betweenActions: { min: 90000, max: 180000 }, // 1.5–3 phút
      betweenSearchRounds: { min: 600000, max: 1080000 }, // 10–18 phút
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
  const skipLimitsFromProfile = profile.skipLimits === true;
  return accounts.map((acc) => {
    const skipProfileLimits =
      skipLimitsFromProfile || acc.interactions?.skipProfileLimits === true;
    return {
      ...acc,
      delays: {
        ...acc.delays,
        ...(profile.delays || {}),
      },
      interactions: skipProfileLimits
        ? acc.interactions
        : {
            ...acc.interactions,
            ...(profile.interactions || {}),
          },
    };
  });
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
  if (dashboard?.app) {
    dashboard.app.locals.botRunning = true;
    dashboard.app.locals.botStopping = false;
    dashboard.emitBotStatus();
  }

  logger.info(`Bot started at ${new Date().toLocaleString()}`);
  try {
    await bot.runParallelAccounts(profiles, maxConcurrent);
  } catch (error) {
    logger.error(`Bot run error: ${error.message}`);
  } finally {
    botRunning = false;
    bot.isRunning = false;
    if (dashboard?.app) {
      dashboard.app.locals.botRunning = false;
      dashboard.app.locals.botStopping = false;
    }
    logger.info(`Bot finished at ${new Date().toLocaleString()}`);
    if (dashboard) {
      dashboard.emitBotStatus();
      await dashboard.sendStatsUpdate();
    }
  }
}

async function handleControl(action, data) {
  if (!bot) return;

  if (action === 'stop') {
    if (!botRunning) {
      logger.warn('Stop ignored: bot is not running');
      return;
    }
    bot.isRunning = false;
    if (dashboard?.app) {
      dashboard.app.locals.botStopping = true;
      dashboard.emitBotStatus();
    }
    logger.info('Stop signal received — finishing current actions...');
    return;
  }

  if (action === 'start') {
    const nextConfigFile = data?.configFile || runtimeState.configFile;
    const nextProfile = data?.runProfile || runtimeState.runProfile || 'vua';
    const campaignId = data?.campaignId;

    let loaded = null;
    if (campaignId && database?.connected) {
      loaded = await loadCampaignFromDb(database, campaignId, config);
    }
    if (!loaded) {
      loaded = loadAccountConfig(config, { configFile: nextConfigFile });
    }
    if (!loaded) {
      logger.warn(`Start ignored: config/campaign not found`);
      return;
    }

    runtimeState = {
      ...runtimeState,
      configFile: loaded.sourcePath
        ? path.relative(process.cwd(), loaded.sourcePath).replace(/\\/g, '/')
        : nextConfigFile,
      campaignId: loaded.campaignId || campaignId || null,
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

  if (action === 'health_check_stop') {
    if (!healthCheckInProgress) {
      logger.warn('Health check stop ignored: not running');
      return;
    }
    healthCheckStopRequested = true;
    if (dashboard) {
      dashboard.healthCheckState.stopping = true;
      dashboard.emitHealthCheckUpdate({ type: 'stopping' });
    }
    if (healthCheckCurrentBrowser) {
      healthCheckCurrentBrowser.close().catch(() => null);
      healthCheckCurrentBrowser = null;
    }
    logger.info('Health check stop signal received — finishing current account...');
    return;
  }

  if (action === 'health_check') {
    if (healthCheckInProgress) {
      logger.warn('Health check ignored: already in progress');
      return;
    }
    if (loginInProgress) {
      logger.warn('Health check ignored: login in progress');
      return;
    }
    if (botRunning) {
      logger.warn('Health check ignored: bot is running');
      return;
    }

    healthCheckInProgress = true;
    healthCheckStopRequested = false;
    healthCheckCurrentBrowser = null;
    const accountsDir = path.join(process.cwd(), 'accounts');

    (async () => {
      try {
        let accountNames = Array.isArray(data?.accountNames)
          ? data.accountNames.map((n) => String(n).trim()).filter(Boolean)
          : [];
        if (!accountNames.length) {
          accountNames = await listCookieAccounts(accountsDir);
        }
        if (!accountNames.length) {
          logger.warn('Health check ignored: no accounts found');
          return;
        }

        if (dashboard) {
          dashboard.healthCheckState = {
            running: true,
            stopping: false,
            results: [],
            startedAt: new Date().toISOString(),
            completedAt: null,
          };
          dashboard.emitHealthCheckUpdate({ type: 'start', accountNames });
        }

        logger.info(`Health check started for ${accountNames.length} account(s)`);

        const checker = new AccountHealthChecker(config, database, {
          accountsDir,
          shouldStop: () => healthCheckStopRequested,
          onBrowserCreated: (bm) => {
            healthCheckCurrentBrowser = bm;
          },
          onProgress: (payload) => {
            if (!dashboard) return;
            if (payload.results) {
              dashboard.healthCheckState.results = payload.results;
            }
            dashboard.emitHealthCheckUpdate(payload);
          },
        });

        const results = await checker.runAll(accountNames);
        const stoppedEarly = healthCheckStopRequested;
        const completedAt = new Date().toISOString();
        const startedAt = dashboard?.healthCheckState?.startedAt;

        const persisted = await persistHealthCheckResults(database, config, results, {
          startedAt,
          completedAt,
          stoppedEarly,
        });

        if (dashboard) {
          dashboard.healthCheckState = {
            ...persisted.state,
            running: false,
            stopping: false,
            stoppedEarly,
            results,
            startedAt,
            completedAt,
          };
          dashboard.emitHealthCheckComplete();
        }

        logger.info(`Health check report: logs/health-check/latest-report.txt`);

        const alive = results.filter((r) => r.status === 'alive').length;
        const dead = results.filter((r) => r.status === 'dead').length;
        const partial = results.filter((r) => r.status === 'partial').length;
        const suspended = results.filter((r) => r.status === 'suspended').length;
        logger.info(
          stoppedEarly
            ? `Health check stopped early: ${results.length} account(s) checked`
            : `Health check done: alive=${alive}, partial=${partial}, suspended=${suspended}, dead=${dead}`
        );
      } catch (error) {
        logger.error(`Health check error: ${error.message}`);
        if (dashboard) {
          dashboard.healthCheckState.running = false;
          dashboard.healthCheckState.stopping = false;
          dashboard.healthCheckState.completedAt = new Date().toISOString();
          dashboard.emitHealthCheckComplete();
        }
      } finally {
        healthCheckInProgress = false;
        healthCheckStopRequested = false;
        healthCheckCurrentBrowser = null;
      }
    })();
  }

  if (action === 'appeal_captcha_done') {
    if (appealCaptchaWaiter) {
      appealCaptchaWaiter(true);
      appealCaptchaWaiter = null;
      logger.info('Appeal captcha done signal received');
    } else {
      logger.warn('Appeal captcha done ignored: not waiting');
    }
    return;
  }

  if (action === 'account_appeal') {
    if (appealInProgress) {
      logger.warn('Appeal ignored: already in progress');
      return;
    }
    if (healthCheckInProgress) {
      logger.warn('Appeal ignored: health check in progress');
      return;
    }
    if (loginInProgress) {
      logger.warn('Appeal ignored: login in progress');
      return;
    }
    if (botRunning) {
      logger.warn('Appeal ignored: bot is running');
      return;
    }

    appealInProgress = true;
    const accountsDir = path.join(process.cwd(), 'accounts');

    (async () => {
      try {
        let accountNames = Array.isArray(data?.accountNames)
          ? data.accountNames.map((n) => String(n).trim()).filter(Boolean)
          : [];

        if (!accountNames.length && dashboard?.healthCheckState?.results?.length) {
          accountNames = dashboard.healthCheckState.results
            .filter((r) => r.status === 'suspended')
            .map((r) => r.accountName);
        }

        if (!accountNames.length) {
          logger.warn('Appeal ignored: no suspended accounts found — run health check or select accounts');
          return;
        }

        const force = !!data?.force || (Array.isArray(data?.accountNames) && data.accountNames.length > 0);

        if (dashboard) {
          dashboard.appealState = {
            running: true,
            waitingCaptcha: false,
            currentAccount: null,
            results: [],
            startedAt: new Date().toISOString(),
            completedAt: null,
          };
          dashboard.emitAppealUpdate({ type: 'start', accountNames });
        }

        logger.info(`Appeal started for ${accountNames.length} account(s): ${accountNames.join(', ')}`);

        const runner = new AccountAppealRunner(config, {
          accountsDir,
          mode: 'dashboard',
          force,
          onProgress: (payload) => {
            if (!dashboard) return;
            if (payload.results) {
              dashboard.appealState.results = payload.results;
            }
            if (payload.accountName && payload.type === 'account_start') {
              dashboard.appealState.currentAccount = payload.accountName;
            }
            dashboard.emitAppealUpdate(payload);
          },
          onWaitingCaptcha: (payload) => {
            if (!dashboard) return;
            dashboard.emitAppealWaitingCaptcha(payload);
          },
          waitCaptchaSignal: () =>
            new Promise((resolve) => {
              appealCaptchaWaiter = resolve;
            }),
        });

        const results = await runner.runAll(accountNames);

        if (dashboard) {
          dashboard.appealState = {
            running: false,
            waitingCaptcha: false,
            currentAccount: null,
            results,
            startedAt: dashboard.appealState.startedAt,
            completedAt: new Date().toISOString(),
          };
          dashboard.emitAppealComplete();
        }

        const submitted = results.filter((r) => r.status === 'submitted').length;
        const skipped = results.filter((r) => r.status === 'skipped').length;
        const failed = results.length - submitted - skipped;
        logger.info(`Appeal done: submitted=${submitted}, skipped=${skipped}, failed=${failed}`);
      } catch (error) {
        logger.error(`Appeal error: ${error.message}`);
        if (dashboard) {
          dashboard.appealState.running = false;
          dashboard.appealState.waitingCaptcha = false;
          dashboard.appealState.completedAt = new Date().toISOString();
          dashboard.emitAppealComplete();
        }
      } finally {
        appealInProgress = false;
        appealCaptchaWaiter = null;
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
    config.baseUrl,
    database
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
  dashboard.app.locals.botStopping = false;
  await dashboard.loadPersistedHealthCheck();
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
