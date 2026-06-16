const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const latest = await db.getLatestHealthCheckRun();
    const history = await db.getHealthCheckHistory(10);
    return json({ latest, history });
  } catch (e) {
    return error(e.message, 500);
  }
}
