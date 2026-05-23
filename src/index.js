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
const { loadAccountConfig, filterAccountsByName } = require('./accountConfig');
const logger = require('./logger');

let bot = null;
let dashboard = null;
let database = null;
let botRunning = false;
let shutdownRequested = false;
let runtimeState = { accounts: [], parallel: { maxConcurrent: 2 } };

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

async function resolveAccountProfiles() {
  const loaded = loadAccountConfig(config);
  if (loaded) {
    logger.info(
      `Loaded ${loaded.accounts.length} account(s) from accounts.config.json (parallel: ${loaded.parallel.maxConcurrent})`
    );
    return loaded;
  }

  logger.warn('accounts.config.json not found — using CLI input');
  const accounts = await loadProfilesFromCli();
  return {
    accounts,
    parallel: { maxConcurrent: config.parallel?.maxConcurrent || 1 },
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
    let profiles = runtimeState.accounts;
    if (data?.accountNames?.length > 0) {
      profiles = filterAccountsByName(profiles, data.accountNames);
    }
    if (profiles.length > 0) {
      runBot(profiles, runtimeState.parallel?.maxConcurrent || 2);
    } else {
      logger.warn('Start ignored: no accounts configured');
    }
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

  const { accounts, parallel } = await resolveAccountProfiles();

  console.log('\nSchedule:');
  console.log('1. Run now');
  console.log('2. Cron schedule');
  console.log('3. Run once and exit');

  const scheduleChoice = await askQuestion('Choice (1-3): ');

  runtimeState = { accounts, parallel };
  if (dashboard) dashboard.botState = runtimeState;

  const run = () => runBot(accounts, parallel.maxConcurrent);

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
