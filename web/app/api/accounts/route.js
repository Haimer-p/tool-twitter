const { getDb } = require('../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../lib/api');

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const db = await getDb();
    const accounts = await db.listAccounts();
    const safe = accounts.map((a) => ({
      ...a,
      cookiesEncrypted: undefined,
      hasCookies: db.accountHasCookies(a),
    }));
    return json({ accounts: safe });
  } catch (e) {
    return error(e.message, 500);
  }
}

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const body = await request.json();
    const { name, cookies, enabled, notes } = body;
    if (!name?.trim()) return error('name required');
    if (!cookies?.length) return error('cookies array required');
    const db = await getDb();
    const acc = await db.saveAccountCookies(name.trim(), cookies, { enabled, notes });
    return json({ account: { ...acc, cookiesEncrypted: undefined, hasCookies: true } }, 201);
  } catch (e) {
    return error(e.message, 500);
  }
}
