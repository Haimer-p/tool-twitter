const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const logger = require('./logger');
const { sleep } = require('./utils');

class AuthManager {
  constructor(accountsDir = './accounts', baseUrl = 'https://x.com', database = null) {
    this.accountsDir = accountsDir;
    this.baseUrl = baseUrl;
    this.database = database;
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
    if (this.database?.connected) {
      try {
        await this.database.saveAccountCookies(accountName, cookies);
      } catch (err) {
        logger.warn(`${accountName}: failed to save cookies to DB: ${err.message}`);
      }
    }
  }

  async loadCookies(accountName) {
    if (this.database?.connected) {
      try {
        const fromDb = await this.database.getAccountCookies(accountName);
        if (fromDb?.length) return fromDb;
      } catch (err) {
        logger.warn(`${accountName}: DB cookie load failed: ${err.message}`);
      }
    }
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
    if (await this.isHumanVerificationPage(page)) return false;

    return page
      .evaluate(() => {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/i/flow/login')) return false;
        if (url.includes('/account/access')) return false;
        return !!(
          document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
          document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
          document.querySelector('a[aria-label="Home"]')
        );
      })
      .catch(() => false);
  }

  async isHumanVerificationPage(page) {
    return page
      .evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        const title = (document.title || '').toLowerCase();

        if (
          text.includes('verifying you are human') ||
          text.includes('verify you are human') ||
          text.includes('checking your browser') ||
          text.includes('security service to protect against malicious bots') ||
          title.includes('just a moment')
        ) {
          return true;
        }

        return !!document.querySelector(
          '#challenge-form, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], [id*="turnstile"]'
        );
      })
      .catch(() => false);
  }

  async isSuspendedOnPage(page) {
    if (await this.isHumanVerificationPage(page)) return false;

    return page
      .evaluate(() => {
        const url = window.location.href.toLowerCase();
        const urlHints =
          url.includes('/account/suspended') ||
          url.includes('/account/locked') ||
          (url.includes('/i/flow/') &&
            (url.includes('suspended') || url.includes('locked')));

        const bodyText = (document.body?.innerText || '').toLowerCase();
        const textHints =
          bodyText.includes('account suspended') ||
          bodyText.includes('your account is suspended') ||
          bodyText.includes('account has been suspended') ||
          bodyText.includes('account is locked') ||
          bodyText.includes('submit an appeal') ||
          bodyText.includes('file an appeal') ||
          (bodyText.includes('suspended') && bodyText.includes('appeal')) ||
          (bodyText.includes('violat') && bodyText.includes('rules'));

        const accessPageSuspended =
          url.includes('/account/access') &&
          (bodyText.includes('suspended') ||
            bodyText.includes('locked') ||
            bodyText.includes('submit an appeal') ||
            bodyText.includes('file an appeal'));

        return urlHints || textHints || accessPageSuspended;
      })
      .catch(() => false);
  }

  async waitForManualLogin(page, timeoutMs = 300000, checkEveryMs = 2500) {
    const startedAt = Date.now();
    let lastHumanLog = 0;
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isLoggedInOnPage(page)) return true;

      const loginIssue = await this.getLoginIssue(page);
      if (loginIssue) throw this.createLoginIssueError(loginIssue);

      if (await this.isHumanVerificationPage(page)) {
        if (Date.now() - lastHumanLog > 20000) {
          logger.info(
            'Đang chờ xác minh human (Cloudflare) — hoàn thành challenge trong browser, script sẽ tự tiếp tục...'
          );
          lastHumanLog = Date.now();
        }
      } else if (await this.isSuspendedOnPage(page)) {
        return true;
      }

      await sleep(checkEveryMs);
    }
    return false;
  }

  /**
   * Login for appeal flow. Returns { ok, suspended, alive }.
   * - suspended: session valid, account is suspended
   * - alive: logged in normally (no appeal needed)
   * - ok false: login failed
   */
  async loginForAppeal(page, accountName, options = {}) {
    const manualTimeoutMs = options.manualTimeoutMs || 300000;
    const navTimeoutMs = options.navigationTimeoutMs || 90000;
    const cookies = await this.loadCookies(accountName);

    const checkState = async () => {
      if (await this.isLoggedInOnPage(page)) {
        return { ok: true, suspended: false, alive: true };
      }
      if (await this.isSuspendedOnPage(page)) {
        return { ok: true, suspended: true, alive: false };
      }
      return null;
    };

    if (cookies && cookies.length > 0) {
      await page.setCookie(...cookies);
      await this.gotoWithTimeout(page, `${this.baseUrl}/home`, navTimeoutMs);
      await sleep(3000);

      const state = await checkState();
      if (state) {
        if (state.suspended) {
          logger.info(`${accountName}: suspended session via cookies`);
        } else {
          logger.info(`${accountName}: logged in via cookies (not suspended)`);
        }
        return state;
      }
      logger.warn(`${accountName}: cookies expired or invalid, manual login required`);
    } else {
      logger.warn(`${accountName}: no cookie file, manual login required`);
    }

    logger.info(`${accountName}: please log in manually in the browser for appeal`);
    await this.gotoWithTimeout(page, `${this.baseUrl}/login`, navTimeoutMs);
    const done = await this.waitForManualLogin(page, manualTimeoutMs);
    if (!done) {
      logger.warn(`${accountName}: manual login timeout (appeal)`);
      return { ok: false, suspended: false, alive: false };
    }

    if (await this.isHumanVerificationPage(page)) {
      logger.warn(`${accountName}: vẫn ở trang xác minh human — chưa lưu cookies`);
      return { ok: false, suspended: false, alive: false };
    }

    const newCookies = await page.cookies();
    await this.saveCookies(accountName, newCookies);
    logger.info(`${accountName}: cookies saved`);

    const state = await checkState();
    if (state) return state;

    return { ok: false, suspended: false, alive: false };
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

  async getLoginCredentials(accountName, suppliedCredentials) {
    if (suppliedCredentials?.username && suppliedCredentials?.password) {
      return suppliedCredentials;
    }
    if (!this.database?.connected || !this.database.getAccountCredentials) return null;
    try {
      const stored = await this.database.getAccountCredentials(accountName);
      return stored?.username && stored?.password
        ? { username: stored.username, password: stored.password }
        : null;
    } catch (error) {
      logger.warn(`${accountName}: could not load stored credentials: ${error.message}`);
      return null;
    }
  }

  async clickFlowButton(page, labels) {
    return page.evaluate((wantedLabels) => {
      const normalized = wantedLabels.map((label) => label.toLowerCase());
      const candidates = Array.from(
        document.querySelectorAll('button, [role="button"], input[type="submit"]')
      );
      const button = candidates.find((node) => {
        const text = (node.innerText || node.value || node.getAttribute('aria-label') || '')
          .trim()
          .toLowerCase();
        return normalized.includes(text);
      });
      if (!button) return false;
      button.click();
      return true;
    }, labels);
  }

  classifyLoginIssueText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').toLowerCase();
    if (text.includes("we've temporarily limited your login") || text.includes('temporarily limited your login')) {
      return {
        code: 'X_LOGIN_RATE_LIMITED',
        message: 'X temporarily limited this login. Stop retrying and wait before trying again from a stable connection.',
      };
    }
    if (text.includes('could not find your account') || text.includes('enter a valid phone number')) {
      return { code: 'X_LOGIN_IDENTIFIER_REJECTED', message: 'X rejected the username/email identifier.' };
    }
    if (text.includes('wrong password') || text.includes('incorrect password')) {
      return { code: 'X_LOGIN_PASSWORD_REJECTED', message: 'X rejected the password.' };
    }
    return null;
  }

  async getLoginIssue(page) {
    const state = await page
      .evaluate(() => ({
        text: document.body?.innerText || '',
        url: window.location.href,
      }))
      .catch(() => ({ text: '', url: page.url() }));
    if (
      /[?&]failedScript=/i.test(state.url) ||
      /privacy related extensions may cause issues/i.test(state.text)
    ) {
      return {
        code: 'X_LOGIN_SCRIPT_LOAD_FAILED',
        message: `X login vendor script failed to load through the current proxy/CDN (${state.url})`,
      };
    }
    return this.classifyLoginIssueText(state.text);
  }

  createLoginIssueError(issue) {
    const error = new Error(issue.message);
    error.code = issue.code;
    return error;
  }

  /**
   * Submit the normal X username/password flow. Any unusual identifier check,
   * CAPTCHA, 2FA or security challenge remains visible for the user to finish.
   */
  async submitCredentials(page, accountName, credentials) {
    if (!credentials?.username || !credentials?.password) return false;
    try {
      const usernameInput = await page.waitForSelector(
        'input[autocomplete="username"], input[name="text"]',
        { visible: true, timeout: 20000 }
      );
      await usernameInput.click({ clickCount: 3 });
      await usernameInput.type(credentials.username, { delay: 70 });

      const clickedNext = await this.clickFlowButton(page, ['Next', 'Tiếp theo']);
      if (!clickedNext) {
        logger.warn(`${accountName}: X login Next button was not found; waiting for manual input`);
        return false;
      }

      let passwordInput = null;
      const passwordDeadline = Date.now() + 20000;
      while (!passwordInput && Date.now() < passwordDeadline) {
        const issue = await this.getLoginIssue(page);
        if (issue) throw this.createLoginIssueError(issue);
        passwordInput = await page.$(
          'input[name="password"], input[autocomplete="current-password"]'
        );
        if (!passwordInput) await sleep(500);
      }
      if (!passwordInput) {
        logger.warn(
          `${accountName}: X requested an extra identifier/security step; finish it manually`
        );
        return false;
      }

      await passwordInput.click({ clickCount: 3 });
      await passwordInput.type(credentials.password, { delay: 70 });
      const clickedLogin = await this.clickFlowButton(page, [
        'Log in',
        'Login',
        'Đăng nhập',
      ]);
      if (!clickedLogin) {
        logger.warn(`${accountName}: X login submit button was not found; waiting manually`);
        return false;
      }
      logger.info(`${accountName}: username/password submitted; waiting for X verification`);
      return true;
    } catch (error) {
      if (String(error.code || '').startsWith('X_LOGIN_')) throw error;
      logger.warn(`${accountName}: automatic credential entry unavailable: ${error.message}`);
      return false;
    }
  }

  async login(page, accountName, options = {}) {
    const mode = options.mode || 'terminal'; // terminal | dashboard | health_check
    const manualTimeoutMs = options.manualTimeoutMs || 300000;
    const navTimeoutMs = options.navigationTimeoutMs || 90000;
    const cookies = await this.loadCookies(accountName);
    const credentials = options.useStoredCredentials === false
      ? null
      : await this.getLoginCredentials(accountName, options.credentials);

    // 1) Try cookies first
    if (cookies && cookies.length > 0) {
      await page.setCookie(...cookies);
      await this.gotoWithTimeout(page, `${this.baseUrl}/home`, navTimeoutMs);
      await sleep(3000);

      const loggedIn = await this.isLoggedInOnPage(page);

      if (loggedIn) {
        logger.info(`${accountName}: logged in via cookies`);
        return true;
      }
      logger.warn(`${accountName}: cookies expired or invalid, opening browser for login...`);
      if (mode === 'health_check' && !credentials) return false;
    } else if (mode === 'health_check' && !credentials) {
      logger.warn(`${accountName}: no cookie file`);
      return false;
    }

    // 2) Manual login in browser
    logger.info(`${accountName}: Opening login page in browser...`);
    try {
      await this.gotoWithTimeout(page, `${this.baseUrl}/i/flow/login`, navTimeoutMs);
    } catch {
      await this.gotoWithTimeout(page, `${this.baseUrl}/login`, navTimeoutMs);
    }

    await sleep(1500);
    const pageIssue = await this.getLoginIssue(page);
    if (pageIssue) throw this.createLoginIssueError(pageIssue);

    if (credentials) {
      await this.submitCredentials(page, accountName, credentials);
    } else {
      logger.info(`${accountName}: no stored credentials; waiting for manual login`);
    }

    logger.info(
      `${accountName}: waiting for manual login (${Math.round(manualTimeoutMs / 1000)}s) — please enter credentials in the opened browser window`
    );
    const done = await this.waitForManualLogin(page, manualTimeoutMs);
    if (!done) {
      logger.warn(`${accountName}: manual login timeout (${mode})`);
      return false;
    }

    if (await this.isHumanVerificationPage(page)) {
      logger.warn(`${accountName}: vẫn ở trang xác minh human — chưa lưu cookies`);
      return false;
    }

    const loggedIn = await this.isLoggedInOnPage(page);
    const suspended = await this.isSuspendedOnPage(page);

    if (!loggedIn && !suspended) {
      logger.warn(`${accountName}: chưa đăng nhập thành công — không lưu cookies`);
      return false;
    }

    const newCookies = await page.cookies();
    await this.saveCookies(accountName, newCookies);
    if (loggedIn) {
      logger.info(`${accountName}: login success, cookies saved!`);
    } else {
      logger.warn(`${accountName}: cookies saved (account suspended — dùng cho appeal)`);
    }

    return true;
  }
}

module.exports = AuthManager;
