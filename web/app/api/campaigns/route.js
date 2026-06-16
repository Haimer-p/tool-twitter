const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const db = await getDb();
    const campaigns = await db.listCampaigns(status);
    return json({ campaigns });
  } catch (e) {
    return error(e.message, 500);
  }
}

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const body = await request.json();
    const db = await getDb();
    if (!body.slug || !body.dexUrl || !body.symbol) {
      return error('slug, dexUrl, symbol required');
    }
    const existing = await db.getCampaignBySlug(body.slug);
    if (existing) return error('slug already exists', 409);
    const campaign = await db.createCampaign({
      ...body,
      status: body.status || 'draft',
    });
    return json({ campaign }, 201);
  } catch (e) {
    return error(e.message, 500);
  }
}
