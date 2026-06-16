const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Next.js chạy từ web/ — load .env từ thư mục gốc repo (tool-farm-twitter/.env)
const rootEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config({ path: path.join(__dirname, '.env.local') });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['mongoose'],
  },
};

module.exports = nextConfig;
