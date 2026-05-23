require('dotenv').config();
const mongoose = require('mongoose');

const STAT_FIELD = { like: 'likes', retweet: 'retweets', reply: 'replies', follow: 'follows' };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const ActivityLog = mongoose.model(
    'ActivityLog',
    new mongoose.Schema({}, { strict: false }),
    'activitylogs'
  );
  const DailyStats = mongoose.model(
    'DailyStats',
    new mongoose.Schema({}, { strict: false }),
    'dailystats'
  );

  const today = new Date().toISOString().split('T')[0];
  const start = new Date(today + 'T00:00:00.000Z');
  const logs = await ActivityLog.find({
    success: true,
    action: { $in: Object.keys(STAT_FIELD) },
    timestamp: { $gte: start },
  });

  const counts = { likes: 0, retweets: 0, replies: 0, follows: 0, totalInteractions: 0 };
  const byAccount = {};

  for (const log of logs) {
    const field = STAT_FIELD[log.action];
    if (!field) continue;
    counts[field]++;
    counts.totalInteractions++;

    if (!byAccount[log.accountName]) {
      byAccount[log.accountName] = {
        interactions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        follows: 0,
      };
    }
    byAccount[log.accountName].interactions++;
    byAccount[log.accountName][field]++;
  }

  await DailyStats.findOneAndUpdate(
    { date: today },
    {
      $set: {
        date: today,
        totalInteractions: counts.totalInteractions,
        likes: counts.likes,
        retweets: counts.retweets,
        replies: counts.replies,
        follows: counts.follows,
        byAccount,
      },
    },
    { upsert: true }
  );

  console.log('Repaired stats for', today, counts);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
