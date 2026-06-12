const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const BrowserManager = require('./browser');
const AuthManager = require('./auth');
const AIService = require('./ai');
const { randomMs, sleep } = require('./utils');

const SCREENSHOT_DIR = path.join(process.cwd(), 'logs', 'appeal');

const APPEAL_BUTTON_TEXTS = [
  'submit an appeal',
  'file an appeal',
  'start appeal',
  'appeal suspension',
  'appeal',
];

const SUBMIT_BUTTON_TEXTS = ['submit', 'send', 'continue'];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

class AccountAppealRunner {
  constructor(config, options = {}) {
    this.config = config;
    this.accountsDir = options.accountsDir || path.join(process.cwd(), 'accounts');
    this.onProgress = options.onProgress || (() => {});
    this.onWaitingCaptcha = options.onWaitingCaptcha || (() => {});
    this.waitCaptchaSignal = options.waitCaptchaSignal || null;
    this.askEnterFn = options.askEnterFn || null;
    this.mode = options.mode || 'dashboard'; // dashboard | terminal
    this.force = !!options.force;
  }

  getDelays() {
    const appeal = this.config.appeal || {};
    return {
      betweenSteps: appeal.delays?.betweenSteps || { min: 2000, max: 4000 },
      typing: appeal.delays?.typing || this.config.delays?.typing || { min: 40, max: 100 },
    };
  }

  async captureScreenshot(page, accountName) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const filePath = path.join(SCREENSHOT_DIR, `${accountName}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    return `/api/appeal/screenshots/${accountName}`;
  }

  async clickByTexts(page, texts, { tags = ['button', 'a', 'span', 'div[role="button"]'] } = {}) {
    const normalized = texts.map(normalizeText);
    for (const tag of tags) {
      const clicked = await page
        .evaluate(
          (selector, labels) => {
            const nodes = [...document.querySelectorAll(selector)];
            for (const node of nodes) {
              const text = (node.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
              const rect = node.getBoundingClientRect();
              if (rect.width < 2 || rect.height < 2) continue;
              if (labels.some((l) => text === l || text.includes(l))) {
                node.click();
                return true;
              }
            }
            return false;
          },
          tag,
          normalized
        )
        .catch(() => false);
      if (clicked) return true;
    }
    return false;
  }

  async scrapeSuspendInfo(page) {
    return page
      .evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const lines = bodyText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 10 && l.length < 400);

        let suspendReason = null;
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (
            lower.includes('violat') ||
            lower.includes('suspended') ||
            lower.includes('locked') ||
            lower.includes('spam') ||
            lower.includes('automat')
          ) {
            suspendReason = line;
            break;
          }
        }

        let username = null;
        const atMatch = bodyText.match(/@[A-Za-z0-9_]{1,15}/);
        if (atMatch) username = atMatch[0].slice(1);

        return { suspendReason, username, pageSnippet: bodyText.slice(0, 500) };
      })
      .catch(() => ({ suspendReason: null, username: null, pageSnippet: '' }));
  }

  async findTextInput(page) {
    const selectors = [
      'textarea',
      '[data-testid="ocfEnterTextTextInput"]',
      '[contenteditable="true"][role="textbox"]',
      'div[role="textbox"]',
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return sel;
    }
    return null;
  }

  async humanTypeIn(page, selector, text) {
    const typing = this.getDelays().typing;
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, { delay: randomMs(typing.min, typing.max) });
  }

  async navigateToAppealForm(page, accountName) {
    const authManager = new AuthManager(this.accountsDir, this.config.baseUrl);

    if (!(await authManager.isSuspendedOnPage(page))) {
      await page.goto(`${this.config.baseUrl}/account/access`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await sleep(2000);
    }

    if (await authManager.isSuspendedOnPage(page)) {
      const clicked = await this.clickByTexts(page, APPEAL_BUTTON_TEXTS);
      if (clicked) {
        await sleep(randomMs(2000, 4000));
        return true;
      }
    }

    const clicked = await this.clickByTexts(page, APPEAL_BUTTON_TEXTS);
    if (clicked) {
      await sleep(randomMs(2000, 4000));
      return true;
    }

    logger.warn(`[${accountName}] Appeal button not found — trying account/access again`);
    await page.goto(`${this.config.baseUrl}/account/access`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await sleep(2000);
    const retry = await this.clickByTexts(page, APPEAL_BUTTON_TEXTS);
    return retry;
  }

  async fillAppealForm(page, text, accountName) {
    const inputSel = await this.findTextInput(page);
    if (!inputSel) {
      logger.error(`[${accountName}] Appeal textarea not found`);
      return false;
    }
    await this.humanTypeIn(page, inputSel, text);
    await sleep(randomMs(1000, 2000));
    return true;
  }

  async submitAppealForm(page, accountName) {
    const clicked = await this.clickByTexts(page, SUBMIT_BUTTON_TEXTS);
    if (!clicked) {
      const submitted = await page
        .evaluate(() => {
          const btn = document.querySelector('[data-testid="ocfEnterTextNextButton"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })
        .catch(() => false);
      if (!submitted) {
        logger.error(`[${accountName}] Submit button not found`);
        return false;
      }
    }
    await sleep(randomMs(2000, 4000));
    return true;
  }

  async isAppealSuccess(page) {
    return page
      .evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return (
          text.includes('thank you') ||
          text.includes('received your appeal') ||
          text.includes('appeal has been submitted') ||
          text.includes('we received') ||
          text.includes('submitted successfully')
        );
      })
      .catch(() => false);
  }

  async waitForManualCaptcha(page, accountName) {
    const timeoutMs = this.config.appeal?.manualCaptchaTimeoutMs || 600000;
    const checkEveryMs = 2000;
    const startedAt = Date.now();

    logger.info(
      `[${accountName}] Vui lòng giải captcha trong cửa sổ browser` +
        (this.mode === 'dashboard' ? ' — bấm "Đã xong captcha" trên dashboard khi xong' : '')
    );

    this.onWaitingCaptcha({ accountName, waiting: true });

    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isAppealSuccess(page)) {
        this.onWaitingCaptcha({ accountName, waiting: false });
        return { ok: true, reason: 'success_detected' };
      }

      if (this.waitCaptchaSignal) {
        const signaled = await Promise.race([
          this.waitCaptchaSignal(),
          sleep(checkEveryMs).then(() => null),
        ]);
        if (signaled) {
          await sleep(1500);
          if (await this.isAppealSuccess(page)) {
            this.onWaitingCaptcha({ accountName, waiting: false });
            return { ok: true, reason: 'user_confirmed' };
          }
          this.onWaitingCaptcha({ accountName, waiting: false });
          return { ok: true, reason: 'user_confirmed' };
        }
      } else if (this.mode === 'terminal') {
        if (this.askEnterFn) {
          await this.askEnterFn(
            `[${accountName}] Nhấn Enter sau khi giải captcha xong... `
          );
        }
        this.onWaitingCaptcha({ accountName, waiting: false });
        if (await this.isAppealSuccess(page)) {
          return { ok: true, reason: 'user_confirmed' };
        }
        return { ok: true, reason: 'user_confirmed' };
      }

      await sleep(checkEveryMs);
    }

    this.onWaitingCaptcha({ accountName, waiting: false });

    if (await this.isAppealSuccess(page)) {
      return { ok: true, reason: 'success_detected' };
    }

    return { ok: false, reason: 'timeout' };
  }

  async runOneAccount(accountName) {
    const startedAt = Date.now();
    const delays = this.getDelays();
    const result = {
      accountName,
      status: 'failed',
      appealText: null,
      username: null,
      suspendReason: null,
      screenshotUrl: null,
      error: null,
      testedAt: new Date().toISOString(),
      durationMs: 0,
    };

    const browserManager = new BrowserManager(this.config);
    const authManager = new AuthManager(this.accountsDir, this.config.baseUrl);
    const ai = new AIService(this.config);

    try {
      await browserManager.launch({ headless: false });
      const page = await browserManager.newPage();
      page.setDefaultNavigationTimeout(90000);

      const loginState = await authManager.loginForAppeal(page, accountName, {
        manualTimeoutMs: 300000,
      });

      if (!loginState.ok) {
        result.status = 'login_failed';
        result.error = 'Cookie expired or manual login failed';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      if (!this.force && loginState.alive && !loginState.suspended) {
        const stillSuspended = await authManager.isSuspendedOnPage(page);
        if (!stillSuspended) {
          result.status = 'skipped';
          result.error = 'Account is not suspended';
          result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
          return result;
        }
      }

      await sleep(randomMs(delays.betweenSteps.min, delays.betweenSteps.max));

      const info = await this.scrapeSuspendInfo(page);
      result.username = info.username;
      result.suspendReason = info.suspendReason;

      const formOpened = await this.navigateToAppealForm(page, accountName);
      if (!formOpened) {
        result.status = 'appeal_button_not_found';
        result.error = 'Could not find or click appeal button';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      await sleep(randomMs(delays.betweenSteps.min, delays.betweenSteps.max));

      const appealText = await ai.generateAppealText({
        username: info.username,
        suspendReason: info.suspendReason,
        accountName,
      });
      result.appealText = appealText;

      const filled = await this.fillAppealForm(page, appealText, accountName);
      if (!filled) {
        result.status = 'form_fill_failed';
        result.error = 'Could not fill appeal textarea';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      await sleep(randomMs(delays.betweenSteps.min, delays.betweenSteps.max));

      const submitted = await this.submitAppealForm(page, accountName);
      if (!submitted) {
        result.status = 'submit_failed';
        result.error = 'Could not click submit';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);

      const captchaResult = await this.waitForManualCaptcha(page, accountName);
      if (captchaResult.ok) {
        result.status = 'submitted';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
      } else {
        result.status = 'captcha_timeout';
        result.error = 'Captcha not completed within timeout';
      }

      return result;
    } catch (error) {
      logger.error(`[${accountName}] Appeal error: ${error.message}`);
      result.status = 'failed';
      result.error = error.message;
      return result;
    } finally {
      result.durationMs = Date.now() - startedAt;
      await browserManager.close().catch(() => null);
    }
  }

  async runAll(accountNames) {
    const results = [];
    for (const name of accountNames) {
      logger.info(`Appeal starting: ${name}`);
      this.onProgress({ type: 'account_start', accountName: name });
      const one = await this.runOneAccount(name);
      results.push(one);
      this.onProgress({ type: 'account', result: one, results: [...results] });
    }
    return results;
  }
}

async function listCookieAccounts(accountsDir) {
  try {
    const files = await fsp.readdir(accountsDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

module.exports = { AccountAppealRunner, listCookieAccounts, SCREENSHOT_DIR };
