const BrowserManager = require('./browser');
const EngagementBot = require('./engage');
const AirdropBot = require('./airdropBot');
const logger = require('./logger');

const activeBots = [];

function createBotForJob(job, deps, config, onActivity) {
  const browserManager = new BrowserManager(config);

  if (job.mode === 'airdrop') {
    return new AirdropBot(
      browserManager,
      deps.authManager,
      deps.aiService,
      deps.database,
      config,
      {
        useAi: job.useAi,
        engageOnReply: job.engageOnReply,
        followOnReply: job.followOnReply,
        minFollowersToFollow: job.minFollowersToFollow,
      },
      onActivity
    );
  }

  return new EngagementBot(
    browserManager,
    deps.authManager,
    deps.aiService,
    deps.database,
    config,
    onActivity
  );
}

async function runWithConcurrency(taskFns, limit) {
  const results = [];
  const executing = new Set();

  for (const taskFn of taskFns) {
    const promise = Promise.resolve()
      .then(taskFn)
      .finally(() => executing.delete(promise));
    results.push(promise);
    executing.add(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

function stopAllBots() {
  for (const bot of activeBots) {
    bot.isRunning = false;
  }
}

function isAnyBotRunning() {
  return activeBots.some((b) => b.isRunning);
}

async function runAccountsParallel(accountJobs, deps, config, options = {}) {
  const maxParallel = options.maxParallel ?? config.accounts?.maxParallel ?? 3;
  const shouldStop = options.shouldStop || (() => false);

  activeBots.length = 0;
  logger.info(`Chạy ${accountJobs.length} account song song (tối đa ${maxParallel} cùng lúc)`);

  const taskFns = accountJobs.map((job) => async () => {
    if (shouldStop()) return;

    const bot = createBotForJob(job, deps, config, options.onActivity);
    activeBots.push(bot);
    bot.isRunning = true;

    logger.info(
      `[${job.accountName}] Bắt đầu — ${job.mode}${job.mode === 'airdrop' ? ` (${job.useAi ? 'AI' : 'Rule'})` : ''} | keywords: ${job.keywords.join(', ')}`
    );

    try {
      await bot.processAccount(job.accountName, job.keywords);
      logger.info(`[${job.accountName}] Hoàn thành`);
    } catch (error) {
      logger.error(`[${job.accountName}] Lỗi: ${error.message}`);
    } finally {
      bot.isRunning = false;
    }
  });

  return runWithConcurrency(taskFns, maxParallel);
}

module.exports = {
  activeBots,
  runAccountsParallel,
  stopAllBots,
  isAnyBotRunning,
  createBotForJob,
};
