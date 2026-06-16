const path = require('path');
const { getDb } = require('../../../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../../../lib/api');

export async function POST(request, { params }) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const campaign = await db.duplicateCampaign(params.id);
    return json({ campaign }, 201);
  } catch (e) {
    return error(e.message, 500);
  }
}
