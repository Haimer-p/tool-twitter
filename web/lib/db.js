const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const globalForDb = global;

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
  }
}

loadEnv();

const Database = require('./database');

if (!globalForDb.__dashboardDbCache) {
  globalForDb.__dashboardDbCache = { instance: null, promise: null };
}

async function getDb() {
  const cache = globalForDb.__dashboardDbCache;

  if (cache.instance?.connected) return cache.instance;

  if (!process.env.MONGODB_URI) loadEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set — thêm vào web/.env.local hoặc .env ở thư mục gốc');
  }

  if (!cache.promise) {
    cache.promise = (async () => {
      const db = new Database(uri);
      await db.connect();
      cache.instance = db;
      return db;
    })();
  }

  return cache.promise;
}

module.exports = { getDb };
