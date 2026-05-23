/**
 * Đăng nhập thủ công 1 account Twitter → lưu cookies vào accounts/{name}.json
 * Không chạy bot engagement.
 *
 * Usage:
 *   npm run login -- ten_account
 *   npm run login                    (hỏi tên account)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const config = require('../config');
const BrowserManager = require('../src/browser');
const AuthManager = require('../src/auth');
const logger = require('../src/logger');

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  let accountName = process.argv[2];

  if (!accountName) {
    accountName = await ask('Tên account mới (vd: acc2, my_twitter): ');
  }

  if (!accountName) {
    console.error('Cần tên account. Ví dụ: npm run login -- acc2');
    process.exit(1);
  }

  console.log(`
╔═══════════════════════════════════════════╗
║   Đăng nhập Twitter / X                 ║
╚═══════════════════════════════════════════╝

Account: ${accountName}
Cookies sẽ lưu tại: accounts/${accountName}.json

Sau khi đăng nhập xong, thêm vào accounts.config.json:

  {
    "name": "${accountName}",
    "enabled": true,
    "keywords": ["crypto", "web3"]
  }
`);

  const browserManager = new BrowserManager(config);
  const authManager = new AuthManager(
    require('path').join(process.cwd(), 'accounts'),
    config.baseUrl
  );

  await browserManager.launch();
  const page = await browserManager.newPage();

  try {
    const ok = await authManager.login(page, accountName);
    if (ok) {
      logger.info(`Hoàn tất! File cookies: accounts/${accountName}.json`);
      console.log('\nBước tiếp theo: mở accounts.config.json và thêm block account ở trên.\n');
    } else {
      logger.error('Đăng nhập thất bại');
      process.exit(1);
    }
  } finally {
    await browserManager.close();
  }
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
