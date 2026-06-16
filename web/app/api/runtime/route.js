const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const runtime = await db.getBotRuntime();
    const online = await db.isWorkerOnline();
    const commands = await db.listRecentCommands(10);
    return json({ runtime, online, commands });
  } catch (e) {
    return error(e.message, 500);
  }
}
