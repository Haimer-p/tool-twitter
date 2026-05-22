require('dotenv').config();
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
const logger = require('./logger');

let bot = null;
let dashboard = null;
let database = null;
let botRunning = false;
let shutdownRequested = false;
let runtimeState = { accounts: [], keywords: config.keywords };

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
  if (!process.env.GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is required in .env');
    logger.info('Get key: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is required in .env (MongoDB Atlas)');
    process.exit(1);
  }
}

async function runBot(accounts, keywords) {
  if (!bot || botRunning) return;
  botRunning = true;
  bot.isRunning = true;
  if (dashboard?.app) dashboard.app.locals.botRunning = true;

  logger.info(`Bot started at ${new Date().toLocaleString()}`);
  try {
    await bot.runMultipleAccounts(accounts, keywords);
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
    const accounts =
      data?.accounts?.length > 0 ? data.accounts : runtimeState.accounts;
    const keywords =
      data?.keywords?.length > 0 ? data.keywords : runtimeState.keywords;
    if (accounts.length > 0) {
      runBot(accounts, keywords);
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
  ║   Web3 + Gemini AI + MongoDB Atlas          ║
  ╚═══════════════════════════════════════════╝
  `);

  database = new Database(config.database.mongodbUri);
  await database.connect();

  const browserManager = new BrowserManager(config);
  const authManager = new AuthManager(
    path.join(process.cwd(), 'accounts'),
    config.baseUrl
  );
  const aiService = new AIService(process.env.GEMINI_API_KEY, config);

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

  const accountsInput = await askQuestion(
    'Account names (comma-separated, e.g. account1,account2): '
  );
  const accounts = accountsInput
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (accounts.length === 0) {
    logger.error('At least one account is required');
    process.exit(1);
  }

  const keywordsInput = await askQuestion(
    `Keywords (default: ${config.keywords.join(', ')}): `
  );
  const keywords = keywordsInput.trim()
    ? keywordsInput.split(',').map((k) => k.trim())
    : config.keywords;

  console.log('\nSchedule:');
  console.log('1. Run now');
  console.log('2. Cron schedule');
  console.log('3. Run once and exit');

  const scheduleChoice = await askQuestion('Choice (1-3): ');

  const run = () => runBot(accounts, keywords);

  runtimeState = { accounts, keywords };
  if (dashboard) dashboard.botState = runtimeState;

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
