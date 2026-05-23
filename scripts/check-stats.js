require('dotenv').config();
const Database = require('../src/database');

async function main() {
  const db = new Database(process.env.MONGODB_URI);
  await db.connect();

  const today = new Date().toISOString().split('T')[0];
  const stats = await db.getStats();
  const activities = await db.getRecentActivities(10);

  console.log('Today (UTC):', today);
  console.log('Totals:', JSON.stringify(stats.totals, null, 2));
  console.log('DailyStats rows:', stats.stats.length);
  stats.stats.slice(0, 3).forEach((s) => {
    const o = s.toObject ? s.toObject() : s;
    console.log(' -', o.date, o);
  });
  console.log('Recent activities:', activities.length);
  activities.forEach((a) => {
    const o = a.toObject ? a.toObject() : a;
    console.log(' -', o.action, o.accountName, o.target?.substring(0, 50));
  });

  await db.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
