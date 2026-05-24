require('dotenv').config();
const dns = require('node:dns');

dns.setDefaultResultOrder('ipv4first');
const path = require('path');
const readline = require('readline');
const cron = require('node-cron');

const config = require('../config');
const AuthManager = require('./auth');
const AIService = require('./ai');
const Database = require('./database');
const Dashboard = require('./dashboard');
const logger = require('./logger');
const {
  loadProfilesConfig,
  buildAccountJobs,
  formatJobsSummary,
  CONFIG_FILENAME,
} = require('./accountProfiles');
const { runAccountsParallel, stopAllBots } = require('./accountRunner');

let dashboard = null;
let database = null;
let botRunning = false;
let shutdownRequested = false;
let stopRequested = false;
let botDeps = null;
const accountsDir = path.join(process.cwd(), 'accounts');

let runtimeState = {
  mode: 'engage',
  useAi: false,
  accounts: [],
  keywords: config.keywords,
  accountJobs: [],
  maxParallel: config.accounts.maxParallel,
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

function validateMongoUri() {
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is required in .env (MongoDB Atlas)');
    process.exit(1);
  }
}

function validateAiKeys() {
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
  const hasDeepseek = !!process.env.DEEPSEEK_API_KEY?.trim();
  if (!hasGemini && !hasDeepseek) {
    logger.error('Cần ít nhất một AI key: GEMINI_API_KEY hoặc DEEPSEEK_API_KEY');
    logger.info('Gemini: https://aistudio.google.com/app/apikey');
    logger.info('DeepSeek: https://platform.deepseek.com/api_keys');
    process.exit(1);
  }
}

function validateWallets() {
  if (!process.env.EVM_WALLET_ADDRESS?.trim()) {
    logger.error('EVM_WALLET_ADDRESS is required in .env for Airdrop mode');
    process.exit(1);
  }
  if (!process.env.SOLANA_WALLET_ADDRESS?.trim()) {
    logger.error('SOLANA_WALLET_ADDRESS is required in .env for Airdrop mode');
    process.exit(1);
  }
}

function createAiService() {
  return new AIService(
    {
      geminiKey: process.env.GEMINI_API_KEY || '',
      deepseekKey: process.env.DEEPSEEK_API_KEY || '',
    },
    config
  );
}

function validateJobs(accountJobs) {
  const needsAi = accountJobs.some(
    (j) => j.mode === 'engage' || (j.mode === 'airdrop' && j.useAi)
  );
  const needsWallets = accountJobs.some((j) => j.mode === 'airdrop');

  if (needsWallets) validateWallets();
  if (needsAi) validateAiKeys();
}

function applyRuntimeState(partial) {
  runtimeState = { ...runtimeState, ...partial };
  if (dashboard) {
    dashboard.botState = runtimeState;
    if (dashboard.app) {
      const modes = [...new Set(runtimeState.accountJobs?.map((j) => j.mode) || [])];
      dashboard.app.locals.botMode =
        modes.length === 1 ? modes[0] : modes.length > 1 ? 'multi' : runtimeState.mode;
      dashboard.app.locals.useAi = runtimeState.useAi;
      dashboard.app.locals.commentMode = runtimeState.useAi ? 'ai' : 'rule';
      dashboard.app.locals.accountJobs = runtimeState.accountJobs;
    }
  }
}

async function runAccountJobs(accountJobs, maxParallel) {
  if (botRunning) {
    logger.warn('Bot đang chạy, bỏ qua lệnh start mới');
    return;
  }

  if (!accountJobs.length) {
    logger.warn('Không có account nào để chạy');
    return;
  }

  validateJobs(accountJobs);
  botRunning = true;
  stopRequested = false;
  if (dashboard?.app) dashboard.app.locals.botRunning = true;

  logger.info(`Bot started — ${accountJobs.length} account(s) at ${new Date().toLocaleString()}`);
  console.log('\nCấu hình từng account:\n' + formatJobsSummary(accountJobs) + '\n');

  try {
    await runAccountsParallel(accountJobs, botDeps, config, {
      maxParallel,
      onActivity: () => dashboard?.sendStatsUpdate(),
      shouldStop: () => stopRequested || shutdownRequested,
    });
  } catch (error) {
    logger.error(`Bot run error: ${error.message}`);
  } finally {
    botRunning = false;
    if (dashboard?.app) dashboard.app.locals.botRunning = false;
    logger.info(`Bot finished at ${new Date().toLocaleString()}`);
    if (dashboard) await dashboard.sendStatsUpdate();
  }
}

function parseAccountJobsFromPayload(data, fallbackState) {
  if (data?.accountJobs?.length) return data.accountJobs;

  const accounts = data?.accounts?.length ? data.accounts : fallbackState.accounts;
  const globalDefaults = {
    mode: data?.mode || fallbackState.mode || 'engage',
    useAi: data?.useAi ?? fallbackState.useAi ?? false,
    keywords: data?.keywords?.length ? data.keywords : fallbackState.keywords,
  };

  return buildAccountJobs(
    accounts,
    { accounts: accounts.map((name) => ({ name, ...globalDefaults })) },
    globalDefaults,
    config
  );
}

async function handleControl(action, data) {
  if (action === 'stop') {
    stopRequested = true;
    stopAllBots();
    logger.info('Stop signal received — dừng tất cả account');
    return;
  }

  if (action === 'start') {
    let profilesConfig = data?.profilesConfig || runtimeState.profilesConfig;
    if (!profilesConfig?.accounts?.length) {
      profilesConfig = await loadProfilesConfig(accountsDir, config);
    }

    let accountJobs;

    if (data?.accountJobs?.length) {
      accountJobs = data.accountJobs;
    } else if (profilesConfig?.accounts?.length) {
      const accountNames =
        data?.accounts?.length > 0
          ? data.accounts
          : profilesConfig.accounts.filter((a) => a.enabled !== false).map((a) => a.name);
      accountJobs = buildAccountJobs(
        accountNames,
        profilesConfig,
        {
          mode: data?.mode || runtimeState.mode,
          useAi: data?.useAi ?? runtimeState.useAi,
          keywords: data?.keywords || runtimeState.keywords,
        },
        config
      );
    } else {
      accountJobs = parseAccountJobsFromPayload(data, runtimeState);
    }

    const maxParallel =
      data?.maxParallel ?? profilesConfig?.maxParallel ?? runtimeState.maxParallel;

    applyRuntimeState({
      accountJobs,
      accounts: accountJobs.map((j) => j.accountName),
      maxParallel,
      profilesConfig,
    });

    runAccountJobs(accountJobs, maxParallel);
  }
}

async function shutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  stopRequested = true;
  logger.info('Shutting down...');
  stopAllBots();
  if (dashboard) await dashboard.close();
  if (database) await database.disconnect();
  process.exit(0);
}

async function resolveAccountNames(input, authManager) {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === 'all' || trimmed === '*') {
    const fromCookies = await authManager.listAccountNames();
    if (fromCookies.length) return fromCookies;
    logger.warn('Không tìm thấy file cookie trong accounts/');
    return [];
  }
  return input
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

async function promptGlobalDefaults(mode) {
  let useAi = false;
  if (mode === 'airdrop') {
    validateWallets();
    console.log('\nPhương án comment (mặc định cho account chưa có profile):');
    console.log('1. Rule-based (không cần AI)');
    console.log('2. AI-assisted (Gemini / DeepSeek fallback)');
    const commentChoice = await askQuestion('Choice (1-2): ');
    useAi = commentChoice.trim() === '2';
    if (useAi) validateAiKeys();
  } else {
    validateAiKeys();
  }

  const defaultKeywords =
    mode === 'airdrop' ? config.airdrop.searchKeywords : config.keywords;
  const keywordsInput = await askQuestion(
    `Keywords mặc định (default: ${defaultKeywords.join(', ')}): `
  );
  const keywords = keywordsInput.trim()
    ? keywordsInput.split(',').map((k) => k.trim())
    : defaultKeywords;

  return { mode, useAi, keywords };
}

async function main() {
  validateMongoUri();

  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   Twitter/X Auto Engagement Tool          ║
  ║   Multi-account parallel + per-profile    ║
  ╚═══════════════════════════════════════════╝
  `);

  database = new Database(config.database.mongodbUri);
  await database.connect();

  const authManager = new AuthManager(accountsDir, config.baseUrl);
  botDeps = {
    authManager,
    aiService: null,
    database,
  };

  dashboard = new Dashboard(database, config, handleControl, accountsDir);
  dashboard.app.locals.botRunning = false;
  dashboard.app.locals.botMode = 'engage';
  dashboard.app.locals.useAi = false;
  dashboard.app.locals.commentMode = 'rule';
  dashboard.app.locals.accountJobs = [];
  await dashboard.start(config.dashboard.port);

  const profilesConfig = await loadProfilesConfig(accountsDir, config);
  const hasProfiles = profilesConfig.accounts.length > 0;

  if (hasProfiles) {
    console.log(`\nĐã tìm thấy ${CONFIG_FILENAME} với ${profilesConfig.accounts.length} account.`);
    console.log('Nhập tên account (phân cách bằng dấu phẩy), hoặc "all" để chạy tất cả enabled:');
  } else {
    console.log(`\nGợi ý: tạo file accounts/${CONFIG_FILENAME} để mỗi account có mode/keywords riêng.`);
    console.log(`Xem mẫu: accounts/accounts.config.example.json`);
    console.log('\nNhập tên account (phân cách bằng dấu phẩy), hoặc "all":');
  }

  const accountsInput = await askQuestion('Accounts: ');
  const accountNames = await resolveAccountNames(accountsInput, authManager);

  if (accountNames.length === 0) {
    logger.error('Cần ít nhất một account');
    process.exit(1);
  }

  let globalDefaults = { mode: 'engage', useAi: false, keywords: config.keywords };

  if (hasProfiles) {
    const useFile = await askQuestion('Dùng mode/keywords từ accounts.config.json? (Y/n): ');
    if (useFile.trim().toLowerCase() !== 'n') {
      globalDefaults = {
        mode: 'engage',
        useAi: false,
        keywords: config.keywords,
      };
    } else {
      console.log('\nChọn chế độ mặc định (cho account không có trong file config):');
      console.log('1. Engage');
      console.log('2. Airdrop Hunter');
      const modeChoice = await askQuestion('Choice (1-2): ');
      const mode = modeChoice.trim() === '2' ? 'airdrop' : 'engage';
      globalDefaults = await promptGlobalDefaults(mode);
    }
  } else {
    console.log('\nChọn chế độ mặc định (áp dụng cho tất cả account):');
    console.log('1. Engage');
    console.log('2. Airdrop Hunter');
    const modeChoice = await askQuestion('Choice (1-2): ');
    const mode = modeChoice.trim() === '2' ? 'airdrop' : 'engage';
    globalDefaults = await promptGlobalDefaults(mode);
  }

  botDeps.aiService = createAiService();

  const accountJobs = buildAccountJobs(accountNames, profilesConfig, globalDefaults, config);
  if (!accountJobs.length) {
    logger.error('Không có account enabled để chạy');
    process.exit(1);
  }

  const maxParallelInput = await askQuestion(
    `Số account chạy song song (default ${profilesConfig.maxParallel || config.accounts.maxParallel}): `
  );
  const maxParallel = maxParallelInput.trim()
    ? parseInt(maxParallelInput, 10)
    : profilesConfig.maxParallel || config.accounts.maxParallel;

  console.log('\nSchedule:');
  console.log('1. Run now');
  console.log('2. Cron schedule');
  console.log('3. Run once and exit');

  const scheduleChoice = await askQuestion('Choice (1-3): ');

  applyRuntimeState({
    accounts: accountNames,
    accountJobs,
    profilesConfig,
    maxParallel,
    ...globalDefaults,
  });

  const run = () => runAccountJobs(accountJobs, maxParallel);

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
