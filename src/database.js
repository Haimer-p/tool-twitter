const mongoose = require('mongoose');
const logger = require('./logger');

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
    enum: ['like', 'retweet', 'reply', 'follow', 'unfollow', 'login', 'error'],
    required: true,
  },
  target: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  errorMessage: { type: String },
});

activityLogSchema.index({ timestamp: -1 });

const InteractedTweet = mongoose.model('InteractedTweet', interactedTweetSchema);
const FollowedUser = mongoose.model('FollowedUser', followedUserSchema);
const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

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

  async getTodayInteractionCount(accountName) {
    const today = new Date().toISOString().split('T')[0];
    const stats = await DailyStats.findOne({ date: today });
    if (stats && stats.byAccount.has(accountName)) {
      return stats.byAccount.get(accountName).interactions;
    }
    return 0;
  }
}

module.exports = Database;
