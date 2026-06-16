const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const { searchParams } = new URL(request.url);
    const db = await getDb();
    const data = await db.getStats(
      searchParams.get('startDate') || undefined,
      searchParams.get('endDate') || undefined
    );
    return json(data);
  } catch (e) {
    return error(e.message, 500);
  }
}
