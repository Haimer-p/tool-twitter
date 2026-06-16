const mongoose = require('mongoose');
const { encryptJson, decryptJson } = require('./crypto');

const logger = {
  info: (...args) => console.log('[db]', ...args),
  warn: (...args) => console.warn('[db]', ...args),
  error: (...args) => console.error('[db]', ...args),
};

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
    enum: ['like', 'retweet', 'reply', 'follow', 'unfollow', 'login', 'error', 'reply_failed', 'health_check'],
    required: true,
  },
  target: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  errorMessage: { type: String },
});

activityLogSchema.index({ timestamp: -1 });

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
  cookiesEncrypted: { type: String },
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
  lastHealthAt: { type: Date },
}, { timestamps: true });

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
    enum: ['start', 'stop', 'health_check', 'login_account', 'appeal', 'generate_keywords'],
    required: true,
  },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenCampaign' },
  runProfile: { type: String, default: 'vua' },
  accountNames: { type: [String], default: [] },
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
  runProfile: { type: String },
  startedAt: { type: Date },
  lastHeartbeat: { type: Date, default: Date.now },
  activeAccounts: { type: [String], default: [] },
  stopping: { type: Boolean, default: false },
}, { timestamps: true });

function getModel(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

const InteractedTweet = getModel('InteractedTweet', interactedTweetSchema);
const FollowedUser = getModel('FollowedUser', followedUserSchema);
const DailyStats = getModel('DailyStats', dailyStatsSchema);
const ActivityLog = getModel('ActivityLog', activityLogSchema);
const HealthCheckRun = getModel('HealthCheckRun', healthCheckRunSchema);
const Account = getModel('Account', accountSchema);
const TokenCampaign = getModel('TokenCampaign', tokenCampaignSchema);
const BotCommand = getModel('BotCommand', botCommandSchema);
const BotRuntime = getModel('BotRuntime', botRuntimeSchema);

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
    if (mongoose.connection.readyState === 1) {
      this.connected = true;
      return;
    }

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

  async hasInteractedWithTweet(tweetId, accountName) {
    const exists = await InteractedTweet.findOne({ tweetId, accountName });
    return !!exists;
  }

  async saveInteractedTweet(data) {
    try {
      const tweet = new InteractedTweet(data);
      await tweet.save();
      return tweet;
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
  }

  async hasFollowedUser(userId, accountName) {
    const exists = await FollowedUser.findOne({ userId, accountName, unfollowed: false });
    return !!exists;
  }

  async saveFollowedUser(data) {
    try {
      const user = new FollowedUser(data);
      await user.save();
      return user;
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
  }

  async getUsersToCheckFollowBack(accountName, olderThanDays = 3) {
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
    await FollowedUser.updateOne(
      { userId, accountName },
      { followedBack, checkedFollowBackAt: new Date() }
    );
  }

  async markUnfollowed(userId, accountName) {
    await FollowedUser.updateOne({ userId, accountName }, { unfollowed: true });
  }

  async updateDailyStats(accountName, interactionType) {
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
    const log = new ActivityLog(data);
    await log.save();
    return log;
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
    return Account.findOne({ name }).lean();
  }

  async getAccountCookies(name) {
    const acc = await Account.findOne({ name }).lean();
    if (!acc?.cookiesEncrypted) return null;
    try {
      const parsed = JSON.parse(acc.cookiesEncrypted);
      return decryptJson(parsed);
    } catch {
      return decryptJson(acc.cookiesEncrypted);
    }
  }

  async saveAccountCookies(name, cookies, extra = {}) {
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
    const allowed = ['enabled', 'notes', 'lastHealthStatus', 'profile', 'lastHealthAt'];
    const update = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) update[k] = patch[k];
    }
    if (patch.cookies) {
      const encrypted = encryptJson(patch.cookies);
      update.cookiesEncrypted =
        typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted);
    }
    return Account.findOneAndUpdate({ name }, update, { new: true }).lean();
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
      await Account.findOneAndUpdate(
        { name: r.accountName },
        {
          lastHealthStatus: r.status,
          lastHealthAt: r.testedAt ? new Date(r.testedAt) : new Date(),
          profile: r.profile || undefined,
        },
        { upsert: false }
      );
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
  HealthCheckRun,
};

module.exports = Database;
