const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const body = await request.json();
    const { action, campaignId, runProfile, accountNames, configFile } = body;
    if (!action) return error('action required');

    const db = await getDb();

    if (action === 'start' && campaignId) {
      const runtime = await db.getBotRuntime();
      if (runtime?.running) return error('Bot already running', 409);
    }

    const cmd = await db.createCommand({
      action,
      campaignId: campaignId || undefined,
      runProfile: runProfile || 'vua',
      accountNames: accountNames || [],
      configFile,
    });

    return json({ command: cmd }, 201);
  } catch (e) {
    return error(e.message, 500);
  }
}

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const commands = await db.listRecentCommands(20);
    return json({ commands });
  } catch (e) {
    return error(e.message, 500);
  }
}
