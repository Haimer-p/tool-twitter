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

interactedTweetSchema.index({ tweetId: 1, accountName: 1 }, { unique: true });

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

class Database {
  constructor(uri) {
    this.uri = uri;
    this.connected = false;
  }

  async connect() {
    await mongoose.connect(this.uri);
    this.connected = true;
    logger.info('MongoDB connected successfully');
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
    let stats = await DailyStats.findOne({ date: today });
    if (!stats) {
      stats = new DailyStats({ date: today });
    }

    stats.totalInteractions += 1;
    stats[interactionType] = (stats[interactionType] || 0) + 1;

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
    accountStats[interactionType] = (accountStats[interactionType] || 0) + 1;
    stats.byAccount.set(accountName, accountStats);

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

    const stats = await DailyStats.find(query).sort({ date: -1 }).limit(30);

    const totals = await DailyStats.aggregate([
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

    return {
      stats,
      totals: totals[0] || {
        totalInteractions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        follows: 0,
      },
    };
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
