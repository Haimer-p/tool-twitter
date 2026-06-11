const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const logger = require('./logger');
const { sleep } = require('./utils');

class AuthManager {
  constructor(accountsDir = './accounts', baseUrl = 'https://x.com') {
    this.accountsDir = accountsDir;
    this.baseUrl = baseUrl;
  }

  async ensureAccountsDir() {
    try {
      await fs.access(this.accountsDir);
    } catch {
      await fs.mkdir(this.accountsDir, { recursive: true });
    }
  }

  getCookiePath(accountName) {
    return path.join(this.accountsDir, `${accountName}.json`);
  }

  async saveCookies(accountName, cookies) {
    await this.ensureAccountsDir();
    await fs.writeFile(this.getCookiePath(accountName), JSON.stringify(cookies, null, 2));
  }

  async loadCookies(accountName) {
    try {
      const data = await fs.readFile(this.getCookiePath(accountName), 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  askEnter(prompt) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(prompt, () => {
        rl.close();
        resolve();
      });
    });
  }

  async isLoggedInOnPage(page) {
    return page
      .evaluate(() => {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/i/flow/login')) return false;
        return !!(
          document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
          document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
          document.querySelector('a[aria-label="Home"]')
        );
      })
      .catch(() => false);
  }

  async waitForManualLogin(page, timeoutMs = 300000, checkEveryMs = 2500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isLoggedInOnPage(page)) return true;
      await sleep(checkEveryMs);
    }
    return false;
  }

  async gotoWithTimeout(page, url, timeoutMs = 90000) {
    const prev = page.getDefaultNavigationTimeout();
    page.setDefaultNavigationTimeout(timeoutMs);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } finally {
      page.setDefaultNavigationTimeout(prev);
    }
  }

  async login(page, accountName, options = {}) {
    const mode = options.mode || 'terminal'; // terminal | dashboard | health_check
    const manualTimeoutMs = options.manualTimeoutMs || 300000;
    const navTimeoutMs = options.navigationTimeoutMs || 90000;
    const cookies = await this.loadCookies(accountName);

    if (cookies && cookies.length > 0) {
      await page.setCookie(...cookies);
      await this.gotoWithTimeout(page, `${this.baseUrl}/home`, navTimeoutMs);
      await sleep(3000);

      const loggedIn = await this.isLoggedInOnPage(page);

      if (loggedIn) {
        logger.info(`${accountName}: logged in via cookies`);
        return true;
      }
      logger.warn(`${accountName}: cookies expired, manual login required`);
      if (mode === 'health_check') return false;
    } else if (mode === 'health_check') {
      logger.warn(`${accountName}: no cookie file`);
      return false;
    }

    logger.info(`${accountName}: please log in manually in the browser`);
    await this.gotoWithTimeout(page, `${this.baseUrl}/login`, navTimeoutMs);
    logger.info(
      `${accountName}: waiting for manual login (${Math.round(manualTimeoutMs / 1000)}s) — no need to press Enter`
    );
    const done = await this.waitForManualLogin(page, manualTimeoutMs);
    if (!done) {
      logger.warn(`${accountName}: manual login timeout (${mode})`);
      return false;
    }

    const newCookies = await page.cookies();
    await this.saveCookies(accountName, newCookies);
    logger.info(`${accountName}: cookies saved`);

    return true;
  }
}

module.exports = AuthManager;
