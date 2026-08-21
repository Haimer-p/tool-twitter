const mongoose = require('mongoose');
const logger = require('./logger');
const { encryptJson, decryptJson } = require('./crypto');

const interactedTweetSchema = new mongoose.Schema({
  tweetId: { type: String, required: true },
  tweetUrl: { type: String, required: true },
  authorUsername: { type: String, required: true },
  authorId: { type: String },
  content: { type: String },
  interactedAt: { type: Date, default: Date.now },
  interactionType: {
    type: String,
    enum: ['like', 'retweet', 'reply', 'follow'],
    required: true,
  },
  accountName: { type: String, required: true },
  keywordUsed: { type: String },
  aiGeneratedReply: { type: String },
});

interactedTweetSchema.index(
  { tweetId: 1, accountName: 1, interactionType: 1 },
  { unique: true }
);

const followedUserSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  followedAt: { type: Date, default: Date.now },
  accountName: { type: String, required: true },
  followedBack: { type: Boolean, default: false },
  checkedFollowBackAt: { type: Date },
  unfollowed: { type: Boolean, default: false },
});

followedUserSchema.index({ userId: 1, accountName: 1 }, { unique: true });

const dailyStatsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  totalInteractions: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  retweets: { type: Number, default: 0 },
  replies: { type: Number, default: 0 },
  follows: { type: Number, default: 0 },
  byAccount: {
    type: Map,
    of: {
      interactions: Number,
      likes: Number,
      retweets: Number,
      replies: Number,
      follows: Number,
    },
    default: {},
  },
});

const activityLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  accountName: { type: String, required: true },
  action: {
    type: String,
    enum: ['like', 'retweet', 'reply', 'follow', 'unfollow', 'login', 'post_attempt', 'post', 'thread_reply', 'thread_incomplete', 'post_failed', 'error', 'reply_failed', 'health_check'],
    required: true,
  },
  target: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  errorMessage: { type: String },
});

activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ accountName: 1, action: 1, success: 1, timestamp: -1 });

const publicationStateSchema = new mongoose.Schema({
  accountName: { type: String, required: true, unique: true, trim: true },
  lastAttemptAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  lockedUntil: { type: Date, default: null },
}, { timestamps: true });

const healthCheckRunSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: Date.now },
  stoppedEarly: { type: Boolean, default: false },
  keyword: { type: String },
  summary: {
    alive: { type: Number, default: 0 },
    partial: { type: Number, default: 0 },
    suspended: { type: Number, default: 0 },
    dead: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  results: { type: mongoose.Schema.Types.Mixed, default: [] },
  reportText: { type: String },
});

healthCheckRunSchema.index({ completedAt: -1 });

const accountSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  aliases: { type: [String], default: [] },
  cookiesEncrypted: { type: String },
  // Credentials for auto-login
  twitterUsername: { type: String, default: '' },
  passwordEncrypted: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  notes: { type: String, default: '' },
  lastHealthStatus: {
    type: String,
    enum: ['alive', 'partial', 'suspended', 'dead', null],
    default: null,
  },
  profile: {
    displayName: String,
    username: String,
    avatarUrl: String,
  },
  proxyUsage: {
    proxyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proxy', default: null },
    url: { type: String, default: '' },
    inUse: { type: Boolean, default: false },
    assignedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  proxyAssignment: {
    proxyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proxy', default: null },
    url: { type: String, default: '' },
    assignedAt: { type: Date, default: null },
  },
  lastHealthAt: { type: Date },
}, { timestamps: true });

const proxySchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true, trim: true },
  label: { type: String, default: '' },
  // For proxies with auth embedded in url OR stored separately
  username: { type: String, default: '' },
  passwordEncrypted: { type: String, default: '' },
  status: {
    type: String,
    enum: ['untested', 'active', 'dead'],
    default: 'untested',
  },
  lastTestedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  failCount: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  assignedAccountName: { type: String, trim: true },
}, { timestamps: true });

proxySchema.index({ status: 1, lastUsedAt: 1 });
proxySchema.index({ assignedAccountName: 1 }, { unique: true, sparse: true });

const tokenCampaignSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true },
  dexUrl: { type: String, required: true },
  symbol: { type: String, required: true },
  name: { type: String, required: true },
  mintAddress: { type: String, default: '' },
  pairAddress: { type: String, default: '' },
  defaults: { type: mongoose.Schema.Types.Mixed, default: {} },
  accounts: {
    type: [{
      name: { type: String, required: true },
      enabled: { type: Boolean, default: true },
      keywords: { type: [String], default: [] },
      delays: { type: mongoose.Schema.Types.Mixed },
      interactions: { type: mongoose.Schema.Types.Mixed },
    }],
    default: [],
  },
  parallel: {
    maxConcurrent: { type: Number, default: 2 },
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'draft',
  },
}, { timestamps: true });

tokenCampaignSchema.index({ status: 1, updatedAt: -1 });

const botCommandSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['start', 'stop', 'health_check', 'login_account', 'appeal', 'appeal_captcha_done', 'generate_keywords', 'test_proxies', 'test_new_proxies'],
    required: true,
  },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenCampaign' },
  campaignIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  configFiles: { type: [String], default: [] },
  maxConcurrentOverride: { type: Number },
  runProfile: { type: String, default: 'vua' },
  runOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
  accountNames: { type: [String], default: [] },
  configFile: { type: String },
  status: {
    type: String,
    enum: ['pending', 'processing', 'done', 'failed', 'cancelled'],
    default: 'pending',
  },
  workerId: { type: String, default: null },
  error: { type: String },
  result: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date },
}, { timestamps: true });

botCommandSchema.index({ status: 1, createdAt: 1 });

const botRuntimeSchema = new mongoose.Schema({
  workerId: { type: String, required: true, unique: true },
  running: { type: Boolean, default: false },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenCampaign' },
  campaignIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  configFiles: { type: [String], default: [] },
  activeSources: { type: mongoose.Schema.Types.Mixed, default: [] },
  maxConcurrentOverride: { type: Number },
  runProfile: { type: String },
  runOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
  startedAt: { type: Date },
  lastHeartbeat: { type: Date, default: Date.now },
  activeAccounts: { type: [String], default: [] },
  stopping: { type: Boolean, default: false },
  appealRunning: { type: Boolean, default: false },
  appealWaitingCaptcha: { type: Boolean, default: false },
  appealCurrentAccount: { type: String, default: null },
}, { timestamps: true });

function getModel(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

const InteractedTweet = getModel('InteractedTweet', interactedTweetSchema);
const FollowedUser = getModel('FollowedUser', followedUserSchema);
const DailyStats = getModel('DailyStats', dailyStatsSchema);
const ActivityLog = getModel('ActivityLog', activityLogSchema);
const PublicationState = getModel('PublicationState', publicationStateSchema);
const HealthCheckRun = getModel('HealthCheckRun', healthCheckRunSchema);
const Account = getModel('Account', accountSchema);
const TokenCampaign = getModel('TokenCampaign', tokenCampaignSchema);
const BotCommand = getModel('BotCommand', botCommandSchema);
const BotRuntime = getModel('BotRuntime', botRuntimeSchema);
const Proxy = getModel('Proxy', proxySchema);

const STAT_FIELD = {
  like: 'likes',
  retweet: 'retweets',
  reply: 'replies',
  follow: 'follows',
};

class Database {
  constructor(uri) {
    this.uri = uri;
    this.connected = false;
  }

  async connect() {
    const options = {
      autoSelectFamily: false,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    };

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await mongoose.connect(this.uri, options);
        this.connected = true;
        await this.migrateInteractedTweetIndexes();
        logger.info('MongoDB connected successfully');
        return;
      } catch (error) {
        lastError = error;
        logger.warn(`MongoDB connect attempt ${attempt}/3 failed: ${error.message}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }

    const hint =
      'Kiem tra: (1) IP da whitelist tren Atlas Network Access, (2) MONGODB_URI dung user/password, (3) cluster dang chay.';
    logger.error(`${hint} Chi tiet: ${lastError.message}`);
    throw lastError;
  }

  async migrateInteractedTweetIndexes() {
    try {
      const coll = mongoose.connection.collection('interactedtweets');
      const indexes = await coll.indexes();
      for (const idx of indexes) {
        if (
          idx.unique &&
          idx.key?.tweetId === 1 &&
          idx.key?.accountName === 1 &&
          idx.key?.interactionType === undefined
        ) {
          await coll.dropIndex(idx.name);
          logger.info(`Dropped legacy index: ${idx.name}`);
        }
      }
      await InteractedTweet.syncIndexes();
    } catch (error) {
      logger.warn(`Index migration skipped: ${error.message}`);
    }
  }

  async disconnect() {
    await mongoose.disconnect();
    this.connected = false;
    logger.info('MongoDB disconnected');
  }

  async resolveAccountName(name) {
    if (!name) return name;
    const account = await Account.findOne({
      $or: [{ name }, { aliases: name }],
    }).select('name').lean();
    return account?.name || name;
  }

  async hasInteractedWithTweet(tweetId, accountName) {
    accountName = await this.resolveAccountName(accountName);
    const exists = await InteractedTweet.findOne({ tweetId, accountName });
    return !!exists;
  }

  async saveInteractedTweet(data) {
    try {
      data = { ...data, accountName: await this.resolveAccountName(data.accountName) };
      const tweet = new InteractedTweet(data);
      await tweet.save();
      return tweet;
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
  }

  async hasFollowedUser(userId, accountName) {
    accountName = await this.resolveAccountName(accountName);
    const exists = await FollowedUser.findOne({ userId, accountName, unfollowed: false });
    return !!exists;
  }

  async saveFollowedUser(data) {
    try {
      data = { ...data, accountName: await this.resolveAccountName(data.accountName) };
      const user = new FollowedUser(data);
      await user.save();
      return user;
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
  }

  async getUsersToCheckFollowBack(accountName, olderThanDays = 3) {
    accountName = await this.resolveAccountName(accountName);
    const date = new Date();
    date.setDate(date.getDate() - olderThanDays);
    return FollowedUser.find({
      accountName,
      followedBack: false,
      unfollowed: false,
      followedAt: { $lte: date },
    });
  }

  async updateFollowBackStatus(userId, accountName, followedBack) {
    accountName = await this.resolveAccountName(accountName);
    await FollowedUser.updateOne(
      { userId, accountName },
      { followedBack, checkedFollowBackAt: new Date() }
    );
  }

  async markUnfollowed(userId, accountName) {
    accountName = await this.resolveAccountName(accountName);
    await FollowedUser.updateOne({ userId, accountName }, { unfollowed: true });
  }

  async updateDailyStats(accountName, interactionType) {
    accountName = await this.resolveAccountName(accountName);
    const today = new Date().toISOString().split('T')[0];
    const field = STAT_FIELD[interactionType];
    if (!field) return null;

    let stats = await DailyStats.findOne({ date: today });
    if (!stats) {
      stats = new DailyStats({ date: today });
    }

    stats.totalInteractions += 1;
    stats[field] = (stats[field] || 0) + 1;

    if (!stats.byAccount.has(accountName)) {
      stats.byAccount.set(accountName, {
        interactions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        follows: 0,
      });
    }

    const accountStats = stats.byAccount.get(accountName);
    accountStats.interactions += 1;
    accountStats[field] = (accountStats[field] || 0) + 1;
    stats.byAccount.set(accountName, accountStats);

    stats.markModified('byAccount');
    await stats.save();
    return stats;
  }

  async getStats(startDate, endDate) {
    const query = {};
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const stats = await DailyStats.find(query).sort({ date: -1 }).limit(30).lean();

    let totals = await DailyStats.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalInteractions: { $sum: '$totalInteractions' },
          likes: { $sum: '$likes' },
          retweets: { $sum: '$retweets' },
          replies: { $sum: '$replies' },
          follows: { $sum: '$follows' },
        },
      },
    ]);

    totals = totals[0] || {
      totalInteractions: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      follows: 0,
    };

    if (
      totals.totalInteractions > 0 &&
      totals.likes + totals.retweets + totals.replies + totals.follows === 0
    ) {
      const fromLogs = await this.getTotalsFromActivityLogs();
      if (fromLogs.totalInteractions > 0) totals = fromLogs;
    } else if (totals.totalInteractions === 0) {
      const fromLogs = await this.getTotalsFromActivityLogs();
      if (fromLogs.totalInteractions > 0) totals = fromLogs;
    }

    return { stats, totals };
  }

  async getTotalsFromActivityLogs() {
    const rows = await ActivityLog.aggregate([
      {
        $match: {
          success: true,
          action: { $in: ['like', 'retweet', 'reply', 'follow'] },
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]);

    const totals = {
      totalInteractions: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      follows: 0,
    };
    for (const row of rows) {
      const field = STAT_FIELD[row._id];
      if (field) {
        totals[field] = row.count;
        totals.totalInteractions += row.count;
      }
    }
    return totals;
  }

  async logActivity(data) {
    data = { ...data, accountName: await this.resolveAccountName(data.accountName) };
    const log = new ActivityLog(data);
    await log.save();
    return log;
  }

  async getLastSuccessfulActivity(accountName, actions) {
    accountName = await this.resolveAccountName(accountName);
    const actionList = Array.isArray(actions) ? actions : [actions];
    return ActivityLog.findOne({
      accountName,
      action: { $in: actionList.filter(Boolean) },
      success: true,
    })
      .sort({ timestamp: -1 })
      .lean();
  }

  async reservePublication(accountName, cooldownHours = 12, lockMinutes = 30) {
    accountName = await this.resolveAccountName(accountName);
    const now = new Date();
    const cooldownSince = new Date(now.getTime() - cooldownHours * 60 * 60 * 1000);
    const lockedUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);
    try {
      return await PublicationState.findOneAndUpdate(
        {
          accountName,
          $and: [
            { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
            { $or: [{ lastAttemptAt: null }, { lastAttemptAt: { $lte: cooldownSince } }] },
          ],
        },
        {
          $setOnInsert: { accountName },
          $set: { lastAttemptAt: now, lockedUntil },
        },
        { upsert: true, new: true }
      ).lean();
    } catch (error) {
      if (error?.code === 11000) return null;
      throw error;
    }
  }

  async finishPublication(accountName, { success = false, preSubmitFailure = false } = {}) {
    accountName = await this.resolveAccountName(accountName);
    const update = { $set: { lockedUntil: new Date() } };
    if (success) update.$set.lastSuccessAt = new Date();
    if (preSubmitFailure) update.$unset = { lastAttemptAt: 1 };
    return PublicationState.findOneAndUpdate({ accountName }, update, { new: true }).lean();
  }

  async getRecentActivities(limit = 50) {
    return ActivityLog.find().sort({ timestamp: -1 }).limit(limit);
  }

  async saveHealthCheckRun(payload) {
    const doc = new HealthCheckRun({
      startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
      completedAt: payload.completedAt ? new Date(payload.completedAt) : new Date(),
      stoppedEarly: !!payload.stoppedEarly,
      keyword: payload.keyword || null,
      summary: payload.summary || {},
      results: payload.results || [],
      reportText: payload.reportText || '',
    });
    await doc.save();
    return doc;
  }

  async getLatestHealthCheckRun() {
    return HealthCheckRun.findOne().sort({ completedAt: -1 }).lean();
  }

  async getHealthCheckHistory(limit = 10) {
    return HealthCheckRun.find()
      .sort({ completedAt: -1 })
      .limit(limit)
      .select('startedAt completedAt stoppedEarly keyword summary reportText')
      .lean();
  }

  async getTodayInteractionCount(accountName) {
    accountName = await this.resolveAccountName(accountName);
    const today = new Date().toISOString().split('T')[0];
    const stats = await DailyStats.findOne({ date: today });
    if (stats && stats.byAccount.has(accountName)) {
      return stats.byAccount.get(accountName).interactions;
    }
    return 0;
  }

  // --- Account CRUD ---

  async listAccounts() {
    return Account.find().sort({ name: 1 }).lean();
  }

  async getAccount(name) {
    return Account.findOne({ $or: [{ name }, { aliases: name }] }).lean();
  }

  async getAccountCookies(name) {
    const acc = await Account.findOne({ $or: [{ name }, { aliases: name }] }).lean();
    if (!acc?.cookiesEncrypted) return null;
    try {
      const parsed = JSON.parse(acc.cookiesEncrypted);
      return decryptJson(parsed);
    } catch {
      return decryptJson(acc.cookiesEncrypted);
    }
  }

  async saveAccountCookies(name, cookies, extra = {}) {
    name = await this.resolveAccountName(name);
    const encrypted = encryptJson(cookies);
    const payload = {
      name,
      cookiesEncrypted: typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted),
      enabled: extra.enabled !== false,
      notes: extra.notes || '',
      profile: extra.profile,
      lastHealthStatus: extra.lastHealthStatus,
      lastHealthAt: extra.lastHealthAt,
    };
    return Account.findOneAndUpdate({ name }, payload, { upsert: true, new: true }).lean();
  }

  async updateAccount(name, patch) {
    name = await this.resolveAccountName(name);
    const allowed = ['enabled', 'notes', 'lastHealthStatus', 'profile', 'lastHealthAt', 'twitterUsername'];
    const update = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) update[k] = patch[k];
    }
    if (patch.cookies) {
      const encrypted = encryptJson(patch.cookies);
      update.cookiesEncrypted =
        typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted);
    }
    if (patch.password !== undefined) {
      if (patch.password) {
        const enc = encryptJson({ p: patch.password });
        update.passwordEncrypted = typeof enc === 'string' ? enc : JSON.stringify(enc);
      } else {
        update.passwordEncrypted = '';
      }
    }
    return Account.findOneAndUpdate({ name }, update, { new: true }).lean();
  }

  async renameAccount(oldName, requestedName) {
    const newName = String(requestedName || '').trim();
    if (!newName) throw new Error('New account name is required');
    if (newName === oldName) return this.getAccount(oldName);
    if (newName.length > 100 || /[\x00-\x1f]/.test(newName)) throw new Error('Account name is invalid');
    const source = await Account.findOne({ name: oldName }).lean();
    if (!source) throw new Error('Account not found');
    if (await Account.exists({
      _id: { $ne: source._id },
      $or: [{ name: newName }, { aliases: newName }],
    })) {
      const error = new Error('Account name already exists');
      error.code = 'ACCOUNT_EXISTS';
      throw error;
    }

    const aliases = [...new Set([...(source.aliases || []), oldName])]
      .filter((alias) => alias && alias !== newName);
    const renamedAccount = await Account.findOneAndUpdate(
      { name: oldName },
      { $set: { name: newName, aliases } },
      { new: true }
    ).lean();

    await Promise.all([
      InteractedTweet.updateMany({ accountName: oldName }, { $set: { accountName: newName } }),
      FollowedUser.updateMany({ accountName: oldName }, { $set: { accountName: newName } }),
      ActivityLog.updateMany({ accountName: oldName }, { $set: { accountName: newName } }),
      Proxy.updateMany({ assignedAccountName: oldName }, { $set: { assignedAccountName: newName } }),
    ]);
    const oldPublication = await PublicationState.findOne({ accountName: oldName }).lean();
    if (oldPublication) {
      const targetPublication = await PublicationState.findOne({ accountName: newName });
      if (targetPublication) {
        for (const key of ['lastAttemptAt', 'lastSuccessAt', 'lockedUntil']) {
          const values = [targetPublication[key], oldPublication[key]]
            .filter(Boolean)
            .map((value) => new Date(value).getTime());
          if (values.length) targetPublication[key] = new Date(Math.max(...values));
        }
        await targetPublication.save();
        await PublicationState.deleteOne({ accountName: oldName });
      } else {
        await PublicationState.updateOne({ accountName: oldName }, { $set: { accountName: newName } });
      }
    }
    for (const campaign of await TokenCampaign.find({ 'accounts.name': oldName })) {
      campaign.accounts.forEach((account) => {
        if (account.name === oldName) account.name = newName;
      });
      campaign.markModified('accounts');
      await campaign.save();
    }
    for (const command of await BotCommand.find({ accountNames: oldName })) {
      command.accountNames = command.accountNames.map((name) => name === oldName ? newName : name);
      await command.save();
    }
    for (const botRuntime of await BotRuntime.find({
      $or: [{ activeAccounts: oldName }, { appealCurrentAccount: oldName }],
    })) {
      botRuntime.activeAccounts = botRuntime.activeAccounts.map((name) => name === oldName ? newName : name);
      if (botRuntime.appealCurrentAccount === oldName) botRuntime.appealCurrentAccount = newName;
      await botRuntime.save();
    }
    for (const stats of await DailyStats.find()) {
      if (!stats.byAccount?.has(oldName)) continue;
      const value = stats.byAccount.get(oldName);
      stats.byAccount.delete(oldName);
      stats.byAccount.set(newName, value);
      stats.markModified('byAccount');
      await stats.save();
    }
    return renamedAccount;
  }

  async getAccountCredentials(name) {
    const acc = await Account.findOne({ $or: [{ name }, { aliases: name }] }).lean();
    if (!acc) return null;
    const result = { username: acc.twitterUsername || '', hasPassword: !!acc.passwordEncrypted };
    if (acc.passwordEncrypted) {
      try {
        const decrypted = decryptJson(acc.passwordEncrypted);
        result.password = decrypted?.p || null;
      } catch {
        result.password = null;
      }
    }
    return result;
  }

  accountHasCredentials(acc) {
    return !!(acc?.twitterUsername && acc?.passwordEncrypted);
  }

  async deleteAccount(name) {
    const runtime = await this.getBotRuntime();
    if (runtime?.running && runtime.activeAccounts?.includes(name)) {
      throw new Error('Cannot delete account while bot is running with it');
    }
    return Account.findOneAndDelete({ name });
  }

  accountHasCookies(acc) {
    return !!acc?.cookiesEncrypted;
  }

  // --- TokenCampaign CRUD ---

  async listCampaigns(status) {
    const q = status ? { status } : {};
    return TokenCampaign.find(q).sort({ updatedAt: -1 }).lean();
  }

  async getCampaign(id) {
    return TokenCampaign.findById(id).lean();
  }

  async getCampaignBySlug(slug) {
    return TokenCampaign.findOne({ slug }).lean();
  }

  async createCampaign(data) {
    const doc = new TokenCampaign(data);
    await doc.save();
    return doc.toObject();
  }

  async updateCampaign(id, patch) {
    return TokenCampaign.findByIdAndUpdate(id, patch, { new: true }).lean();
  }

  async deleteCampaign(id) {
    const runtime = await this.getBotRuntime();
    if (runtime?.running && String(runtime.campaignId) === String(id)) {
      throw new Error('Cannot delete campaign while bot is running it');
    }
    return TokenCampaign.findByIdAndDelete(id);
  }

  async archiveCampaign(id) {
    return this.updateCampaign(id, { status: 'archived' });
  }

  async duplicateCampaign(id) {
    const src = await TokenCampaign.findById(id).lean();
    if (!src) throw new Error('Campaign not found');
    const baseSlug = `${src.slug}-copy`;
    let slug = baseSlug;
    let n = 1;
    while (await TokenCampaign.findOne({ slug })) {
      slug = `${baseSlug}-${n++}`;
    }
    const { _id, createdAt, updatedAt, ...rest } = src;
    return this.createCampaign({ ...rest, slug, status: 'draft' });
  }

  // --- BotCommand queue ---

  async createCommand(payload) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const doc = new BotCommand({ ...payload, expiresAt });
    await doc.save();
    return doc.toObject();
  }

  async claimNextCommand(workerId) {
    const now = new Date();
    await BotCommand.updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { status: 'cancelled', error: 'expired' }
    );
    const cmd = await BotCommand.findOneAndUpdate(
      { status: 'pending' },
      { status: 'processing', workerId },
      { sort: { createdAt: 1 }, new: true }
    ).lean();
    return cmd;
  }

  async finishCommand(id, result, error) {
    return BotCommand.findByIdAndUpdate(
      id,
      {
        status: error ? 'failed' : 'done',
        result: result || null,
        error: error || null,
      },
      { new: true }
    ).lean();
  }

  async releaseStaleProcessingCommands(workerId) {
    return BotCommand.updateMany(
      { status: 'processing', workerId },
      { status: 'failed', error: 'Interrupted — worker restarted or stale command' }
    );
  }

  async listRecentCommands(limit = 20) {
    return BotCommand.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  // --- BotRuntime ---

  async upsertBotRuntime(workerId, patch) {
    return BotRuntime.findOneAndUpdate(
      { workerId },
      { ...patch, lastHeartbeat: new Date() },
      { upsert: true, new: true }
    ).lean();
  }

  async getBotRuntime(workerId) {
    if (workerId) return BotRuntime.findOne({ workerId }).lean();
    return BotRuntime.findOne().sort({ lastHeartbeat: -1 }).lean();
  }

  async isWorkerOnline(maxAgeMs = 60000) {
    const rt = await this.getBotRuntime();
    if (!rt?.lastHeartbeat) return false;
    return Date.now() - new Date(rt.lastHeartbeat).getTime() < maxAgeMs;
  }

  async syncHealthStatusToAccounts(results = []) {
    for (const r of results) {
      if (!r.accountName) continue;
      const accountName = await this.resolveAccountName(r.accountName);
      await Account.findOneAndUpdate(
        { name: accountName },
        {
          lastHealthStatus: r.status,
          lastHealthAt: r.testedAt ? new Date(r.testedAt) : new Date(),
          profile: r.profile || undefined,
        },
        { upsert: false }
      );
    }
  }

  // --- Proxy Pool ---

  async listProxies() {
    return Proxy.find().sort({ status: 1, lastUsedAt: 1 }).lean();
  }

  async addProxies(urls) {
    const normalized = [];
    const seen = new Set();
    for (const rawUrl of urls) {
      let url = String(rawUrl).trim();
      if (!url) continue;

      const parts = url.split(':');
      if (parts.length === 4 && !url.includes('@') && !url.includes('//')) {
        url = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
      } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('socks5://') && !url.startsWith('socks4://')) {
        url = `http://${url}`;
      }

      if (!seen.has(url)) {
        seen.add(url);
        normalized.push(url);
      }
    }
    if (!normalized.length) return [];

    const result = await Proxy.bulkWrite(
      normalized.map((url) => ({
        updateOne: {
          filter: { url },
          update: { $setOnInsert: { url, status: 'untested', lastError: '' } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    const insertedIds = Object.values(result.upsertedIds || {});
    return insertedIds.length ? Proxy.find({ _id: { $in: insertedIds } }).lean() : [];
  }

  async setAccountProxyUsage(name, proxy = null, inUse = false) {
    name = await this.resolveAccountName(name);
    const now = new Date();
    const update = {
      'proxyUsage.inUse': !!inUse,
      'proxyUsage.releasedAt': inUse ? null : now,
    };
    if (inUse) {
      update['proxyUsage.proxyId'] = proxy?._id || null;
      update['proxyUsage.url'] = proxy?.url || '';
      update['proxyUsage.assignedAt'] = now;
    }
    return Account.findOneAndUpdate({ name }, { $set: update }, { new: true }).lean();
  }

  async getOrAssignProxy(accountName) {
    accountName = await this.resolveAccountName(accountName);
    const now = new Date();
    let proxy = await Proxy.findOne({ assignedAccountName: accountName, status: 'active' }).lean();
    if (!proxy) {
      await Proxy.updateMany(
        { assignedAccountName: accountName, status: { $ne: 'active' } },
        { $unset: { assignedAccountName: 1 } }
      );
      try {
        proxy = await Proxy.findOneAndUpdate(
          {
            status: 'active',
            $or: [
              { assignedAccountName: { $exists: false } },
              { assignedAccountName: null },
              { assignedAccountName: '' },
            ],
          },
          { $set: { assignedAccountName: accountName, lastUsedAt: now } },
          { new: true, sort: { lastUsedAt: 1, successCount: -1 } }
        ).lean();
      } catch (error) {
        if (error?.code !== 11000) throw error;
        proxy = await Proxy.findOne({ assignedAccountName: accountName, status: 'active' }).lean();
      }
    } else {
      await Proxy.findByIdAndUpdate(proxy._id, { lastUsedAt: now });
    }

    if (!proxy) {
      await Account.findOneAndUpdate(
        { name: accountName },
        { $unset: { proxyAssignment: 1 } }
      );
      return null;
    }
    await Account.findOneAndUpdate(
      { name: accountName },
      {
        $set: {
          'proxyAssignment.proxyId': proxy._id,
          'proxyAssignment.url': proxy.url,
          'proxyAssignment.assignedAt': now,
        },
      }
    );
    return proxy;
  }

  async rotateAccountProxy(accountName) {
    accountName = await this.resolveAccountName(accountName);
    const account = await Account.findOne({ name: accountName }).lean();
    if (!account) throw new Error('Account not found');
    if (account.proxyUsage?.inUse) {
      const error = new Error('Account is using a proxy. Close its browser before changing proxy.');
      error.code = 'ACCOUNT_PROXY_IN_USE';
      throw error;
    }

    const current = await Proxy.findOne({ assignedAccountName: accountName }).lean();
    if (current) {
      await Proxy.updateOne(
        { _id: current._id, assignedAccountName: accountName },
        { $unset: { assignedAccountName: 1 } }
      );
    }

    const now = new Date();
    const next = await Proxy.findOneAndUpdate(
      {
        status: 'active',
        ...(current?._id ? { _id: { $ne: current._id } } : {}),
        $or: [
          { assignedAccountName: { $exists: false } },
          { assignedAccountName: null },
          { assignedAccountName: '' },
        ],
      },
      { $set: { assignedAccountName: accountName, lastUsedAt: now } },
      { new: true, sort: { lastUsedAt: 1, successCount: -1 } }
    ).lean();

    if (!next) {
      if (current?.status === 'active') {
        await Proxy.updateOne(
          { _id: current._id },
          { $set: { assignedAccountName: accountName } }
        );
      }
      const error = new Error('No other unused active proxy is available');
      error.code = 'NO_AVAILABLE_PROXY';
      throw error;
    }

    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          'proxyAssignment.proxyId': next._id,
          'proxyAssignment.url': next.url,
          'proxyAssignment.assignedAt': now,
        },
      }
    );
    return next;
  }

  async releaseProxyForAccount(accountName, proxyId = null) {
    accountName = await this.resolveAccountName(accountName);
    const query = { assignedAccountName: accountName };
    if (proxyId) query._id = proxyId;
    await Proxy.updateMany(query, { $unset: { assignedAccountName: 1 } });
    await Account.findOneAndUpdate(
      { name: accountName },
      { $unset: { proxyAssignment: 1 } }
    );
  }

  async deleteProxy(id) {
    const proxy = await Proxy.findByIdAndDelete(id).lean();
    if (proxy) {
      await Account.updateMany(
        { 'proxyAssignment.proxyId': proxy._id },
        { $unset: { proxyAssignment: 1 } }
      );
    }
    return proxy;
  }

  async deleteDeadProxies() {
    const dead = await Proxy.find({ status: 'dead' }).select('_id').lean();
    const ids = dead.map((proxy) => proxy._id);
    if (ids.length) {
      await Account.updateMany(
        { 'proxyAssignment.proxyId': { $in: ids } },
        { $unset: { proxyAssignment: 1 } }
      );
    }
    return Proxy.deleteMany({ _id: { $in: ids } });
  }

  async updateProxyStatus(id, status, extra = {}) {
    const update = { status, lastTestedAt: new Date(), ...extra };
    if (status === 'dead') {
      update.$inc = { failCount: 1 };
    } else if (status === 'active') {
      update.$inc = { successCount: 1 };
      update.lastError = '';
    }
    // $inc can't be used with top-level update in findByIdAndUpdate without careful handling
    const { $inc, ...rest } = update;
    const patch = { ...rest };
    const doc = await Proxy.findByIdAndUpdate(id, patch, { new: true }).lean();
    if ($inc && doc) {
      await Proxy.findByIdAndUpdate(id, { $inc });
    }
    return doc;
  }

  async getNextAvailableProxy() {
    // Get active proxy least recently used, or untested if no active
    let proxy = await Proxy.findOne({ status: 'active' }).sort({ lastUsedAt: 1 }).lean();
    if (!proxy) proxy = await Proxy.findOne({ status: 'untested' }).sort({ createdAt: 1 }).lean();
    if (proxy) {
      await Proxy.findByIdAndUpdate(proxy._id, { lastUsedAt: new Date() });
    }
    return proxy;
  }

  async bulkUpdateProxyStatus(updates) {
    for (const { id, status, lastError } of updates) {
      await this.updateProxyStatus(id, status, lastError ? { lastError } : {});
    }
  }
}

Database.models = {
  Account,
  TokenCampaign,
  BotCommand,
  BotRuntime,
  InteractedTweet,
  FollowedUser,
  DailyStats,
  ActivityLog,
  PublicationState,
  HealthCheckRun,
  Proxy,
};

module.exports = Database;
