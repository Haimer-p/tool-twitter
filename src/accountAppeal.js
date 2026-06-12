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

  getAppealFormUrl() {
    return this.config.appeal?.formUrl || 'https://help.x.com/en/forms/account-access/appeals';
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

  async scrapeHelpAppealFormInfo(page) {
    return page
      .evaluate(() => {
        let username = null;
        let email = null;

        for (const label of document.querySelectorAll('label')) {
          const labelText = (label.textContent || '').toLowerCase();
          const id = label.getAttribute('for');
          const field = id ? document.getElementById(id) : null;
          const value = field?.value?.trim() || '';

          if (labelText.includes('x username') || labelText.includes('username')) {
            if (value.startsWith('@')) username = value.slice(1);
            else if (value) username = value;
          }
          if (labelText.includes('email')) {
            email = value || null;
          }
        }

        if (!username) {
          for (const input of document.querySelectorAll('input')) {
            const val = (input.value || '').trim();
            if (val.startsWith('@')) {
              username = val.slice(1);
              break;
            }
          }
        }

        return { username, email };
      })
      .catch(() => ({ username: null, email: null }));
  }

  async humanTypeInElement(page, elementHandle, text) {
    const delays = this.getDelays();
    const typing = delays.typing;
    const pauseEvery = delays.typingPauseEvery || { min: 25, max: 45 };
    const pauseDuration = delays.typingPauseDuration || { min: 400, max: 1200 };

    await elementHandle.click();
    await sleep(randomMs(400, 900));

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await sleep(randomMs(250, 600));

    let charsSincePause = 0;
    let nextPauseAt = randomMs(pauseEvery.min, pauseEvery.max);

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      await page.keyboard.sendCharacter(ch);

      let delay = randomMs(typing.min, typing.max);
      if (ch === ' ' || ch === '.' || ch === ',' || ch === '\n') {
        delay += randomMs(120, 350);
      }

      await sleep(delay);

      charsSincePause += 1;
      if (charsSincePause >= nextPauseAt) {
        await sleep(randomMs(pauseDuration.min, pauseDuration.max));
        charsSincePause = 0;
        nextPauseAt = randomMs(pauseEvery.min, pauseEvery.max);
      }
    }

    await sleep(randomMs(300, 700));
  }

  async findDescriptionTextarea(page) {
    const handle = await page.evaluateHandle(() => {
      const hasDescriptionLabel = (el) =>
        (el.textContent || '').toLowerCase().includes('description of the problem');

      for (const label of document.querySelectorAll('label')) {
        if (!hasDescriptionLabel(label)) continue;
        const id = label.getAttribute('for');
        if (id) {
          const target = document.getElementById(id);
          if (target?.tagName === 'TEXTAREA') return target;
        }
        const parent = label.closest('div, fieldset, section, form');
        const ta = parent?.querySelector('textarea');
        if (ta) return ta;
      }

      for (const el of document.querySelectorAll('*')) {
        if (!hasDescriptionLabel(el)) continue;
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
          const ta = node.querySelector?.('textarea');
          if (ta) return ta;
          node = node.parentElement;
        }
      }

      const textareas = [...document.querySelectorAll('textarea')];
      if (!textareas.length) return null;
      const empty = textareas.find((ta) => !(ta.value || '').trim());
      return empty || textareas[textareas.length - 1];
    });

    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      return null;
    }
    return element;
  }

  async waitForHelpAppealForm(page, accountName) {
    const ready = await page
      .waitForFunction(
        () => {
          const body = (document.body?.innerText || '').toLowerCase();
          return (
            body.includes('description of the problem') ||
            body.includes('appeal a locked or suspended account')
          );
        },
        { timeout: 45000 }
      )
      .catch(() => null);

    if (!ready) {
      logger.warn(`[${accountName}] Help appeal form text not detected`);
      return false;
    }

    const textarea = await this.findDescriptionTextarea(page);
    return !!textarea;
  }

  async openHelpAppealForm(browser, page, accountName) {
    const formUrl = this.getAppealFormUrl();
    logger.info(`[${accountName}] Opening Help Center appeal form: ${formUrl}`);

    const pagesBefore = (await browser.pages()).length;

    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(3000);

    if (await this.waitForHelpAppealForm(page, accountName)) {
      return page;
    }

    const authManager = new AuthManager(this.accountsDir, this.config.baseUrl);
    if (await authManager.isSuspendedOnPage(page)) {
      logger.info(`[${accountName}] On x.com suspend page — clicking appeal link`);
      const clicked = await this.clickByTexts(page, APPEAL_BUTTON_TEXTS, {
        tags: ['a', 'button', 'span', 'div[role="button"]'],
      });
      if (clicked) {
        await sleep(randomMs(3000, 5000));
        const pages = await browser.pages();
        if (pages.length > pagesBefore) {
          const helpPage = pages[pages.length - 1];
          await helpPage.bringToFront();
          await sleep(2000);
          if (await this.waitForHelpAppealForm(helpPage, accountName)) {
            return helpPage;
          }
        }
      }
    }

    await page.goto(formUrl, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => null);
    await sleep(3000);
    if (await this.waitForHelpAppealForm(page, accountName)) {
      return page;
    }

    return null;
  }

  async fillAppealForm(page, text, accountName) {
    const textarea = await this.findDescriptionTextarea(page);
    if (!textarea) {
      logger.error(`[${accountName}] "Description of the problem" textarea not found`);
      return false;
    }

    await this.humanTypeInElement(page, textarea, text);
    await sleep(randomMs(1000, 2000));

    const filled = await textarea.evaluate((el) => (el.value || '').trim().length > 20);
    await textarea.dispose();
    if (!filled) {
      logger.error(`[${accountName}] Description field still empty after fill`);
      return false;
    }

    logger.info(`[${accountName}] Filled "Description of the problem" (${text.length} chars)`);
    return true;
  }

  async submitAppealForm(page, accountName) {
    const clicked = await page
      .evaluate(() => {
        const candidates = [
          ...document.querySelectorAll('button'),
          ...document.querySelectorAll('input[type="submit"]'),
        ];
        for (const btn of candidates) {
          const label = (btn.textContent || btn.value || '').trim().toLowerCase();
          if (label === 'submit') {
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false);

    if (!clicked) {
      logger.error(`[${accountName}] Submit button not found on help.x.com form`);
      return false;
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
      await browserManager.launch({ headless: false, captchaFriendly: true });
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

      const suspendInfo = await this.scrapeSuspendInfo(page);
      result.username = suspendInfo.username;
      result.suspendReason = suspendInfo.suspendReason;

      const appealPage = await this.openHelpAppealForm(
        browserManager.browser,
        page,
        accountName
      );
      if (!appealPage) {
        result.status = 'appeal_form_not_found';
        result.error = 'Could not open help.x.com appeal form';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      await sleep(randomMs(delays.betweenSteps.min, delays.betweenSteps.max));

      const formInfo = await this.scrapeHelpAppealFormInfo(appealPage);
      if (formInfo.username) result.username = formInfo.username;

      const appealText = await ai.generateAppealText({
        username: result.username || formInfo.username,
        suspendReason: result.suspendReason,
        accountName,
      });
      result.appealText = appealText;

      const filled = await this.fillAppealForm(appealPage, appealText, accountName);
      if (!filled) {
        result.status = 'form_fill_failed';
        result.error = 'Could not fill "Description of the problem" on help.x.com';
        result.screenshotUrl = await this.captureScreenshot(appealPage, accountName).catch(
          () => null
        );
        return result;
      }

      await sleep(randomMs(delays.betweenSteps.min, delays.betweenSteps.max));

      const submitted = await this.submitAppealForm(appealPage, accountName);
      if (!submitted) {
        result.status = 'submit_failed';
        result.error = 'Could not click Submit on help.x.com form';
        result.screenshotUrl = await this.captureScreenshot(appealPage, accountName).catch(
          () => null
        );
        return result;
      }

      result.screenshotUrl = await this.captureScreenshot(appealPage, accountName).catch(
        () => null
      );

      const captchaResult = await this.waitForManualCaptcha(appealPage, accountName);
      if (captchaResult.ok) {
        result.status = 'submitted';
        result.screenshotUrl = await this.captureScreenshot(appealPage, accountName).catch(
          () => null
        );
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
