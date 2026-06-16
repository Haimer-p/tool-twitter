const { getDb } = require('../../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../../lib/api');

export async function GET(request, { params }) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const campaign = await db.getCampaign(params.id);
    if (!campaign) return error('Not found', 404);
    return json({ campaign });
  } catch (e) {
    return error(e.message, 500);
  }
}

export async function PATCH(request, { params }) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const body = await request.json();
    const db = await getDb();
    const campaign = await db.updateCampaign(params.id, body);
    if (!campaign) return error('Not found', 404);
    return json({ campaign });
  } catch (e) {
    return error(e.message, 500);
  }
}

export async function DELETE(request, { params }) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    await db.deleteCampaign(params.id);
    return json({ ok: true });
  } catch (e) {
    return error(e.message, 409);
  }
}
