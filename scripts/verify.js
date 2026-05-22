/**
 * Smoke test: load modules + optional MongoDB Atlas ping (if .env exists).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = require('../config');

async function main() {
  require('../src/utils');
  require('../src/logger');
  require('../src/database');
  require('../src/browser');
  require('../src/auth');
  require('../src/ai');
  require('../src/engage');
  require('../src/dashboard');
  console.log('[verify] All modules loaded');

  if (!process.env.MONGODB_URI) {
    console.log('[verify] Skip MongoDB (no MONGODB_URI in .env)');
    return;
  }

  const Database = require('../src/database');
  const db = new Database(process.env.MONGODB_URI);
  await db.connect();
  const count = await db.getTodayInteractionCount('__verify__');
  await db.disconnect();
  console.log(`[verify] MongoDB OK (today count probe: ${count})`);
}

main().catch((err) => {
  console.error('[verify] FAILED:', err.message);
  process.exit(1);
});
