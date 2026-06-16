const { getDb } = require('../../../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../../../lib/api');

export async function POST(request, { params }) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const campaign = await db.archiveCampaign(params.id);
    if (!campaign) return error('Not found', 404);
    return json({ campaign });
  } catch (e) {
    return error(e.message, 500);
  }
}
