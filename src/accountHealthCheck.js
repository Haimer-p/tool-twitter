const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const BrowserManager = require('./browser');
const AuthManager = require('./auth');
const EngagementBot = require('./engage');
const AIService = require('./ai');
const { parseTweetId, randomMs, sleep } = require('./utils');

const SCREENSHOT_DIR = path.join(process.cwd(), 'logs', 'health-check');

function makeCheckResult(ok, extra = {}) {
  return { ok, ...extra };
}

function computeStatus(checks) {
  if (checks.suspended?.ok) return 'suspended';
  if (!checks.login?.ok) return 'dead';
  const rest = [checks.search, checks.like, checks.retweet, checks.reply];
  if (rest.every((c) => c?.ok)) return 'alive';
  return 'partial';
}

class AccountHealthChecker {
  constructor(config, database, options = {}) {
    this.config = config;
    this.db = database;
    this.onProgress = options.onProgress || (() => {});
    this.shouldStop = options.shouldStop || (() => false);
    this.onBrowserCreated = options.onBrowserCreated || (() => {});
    this.accountsDir = options.accountsDir || path.join(process.cwd(), 'accounts');
  }

  buildCtx(accountName) {
    const hc = this.config.healthCheck || {};
    return {
      accountName,
      healthCheck: true,
      delays: {
        scroll: hc.delays?.scroll || { min: 1000, max: 2000 },
        pageLoad: hc.delays?.pageLoad || { min: 2000, max: 4000 },
        typing: this.config.delays?.typing || { min: 50, max: 120 },
        betweenActions: hc.delays?.betweenSteps || { min: 2000, max: 4000 },
      },
      interactions: {
        skipProfileLimits: true,
        replyComposerTimeoutMs: this.config.interactions?.replyComposerTimeoutMs || 15000,
        replyPostTimeoutMs: this.config.interactions?.replyPostTimeoutMs || 20000,
        replyMaxLength: this.config.interactions?.replyMaxLength || 280,
      },
    };
  }

  async getProfileInfo(page) {
    await page
      .waitForSelector(
        '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Profile_Link"]',
        { timeout: 8000 }
      )
      .catch(() => null);

    const fromSidebar = await page
      .evaluate(() => {
        const reserved = new Set([
          'home',
          'explore',
          'search',
          'notifications',
          'messages',
          'i',
          'settings',
        ]);

        const handleFromHref = (href) => {
          if (!href || href === '/') return null;
          const handle = href.replace(/^\//, '').split('/')[0];
          return handle && !reserved.has(handle) ? handle : null;
        };

        let displayName = null;
        let username = null;
        let avatarUrl = null;

        const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        if (profileLink) {
          username = handleFromHref(profileLink.getAttribute('href'));
          const img = profileLink.querySelector('img');
          avatarUrl = img?.src || avatarUrl;
        }

        const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (btn) {
          const img = btn.querySelector('img');
          avatarUrl = img?.src || avatarUrl;

          const texts = [...btn.querySelectorAll('span')]
            .map((s) => (s.textContent || '').trim())
            .filter((t) => t.length > 0);

          for (const t of texts) {
            if (t.startsWith('@')) {
              username = t.slice(1);
            } else if (!displayName && !t.startsWith('@')) {
              displayName = t;
            }
          }
        }

        return { displayName, username, avatarUrl };
      })
      .catch(() => null);

    if (fromSidebar?.username) return fromSidebar;

    const profileHref = await page
      .$eval('a[data-testid="AppTabBar_Profile_Link"]', (el) => el.getAttribute('href'))
      .catch(() => null);

    if (!profileHref) return fromSidebar;

    try {
      await page.goto(`${this.config.baseUrl || 'https://x.com'}${profileHref}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(2000);

      const fromProfile = await page.evaluate(() => {
        const userName = document.querySelector('[data-testid="UserName"]');
        if (!userName) return null;

        const texts = [...userName.querySelectorAll('span')]
          .map((s) => (s.textContent || '').trim())
          .filter(Boolean);

        let displayName = null;
        let username = null;
        for (const t of texts) {
          if (t.startsWith('@')) username = t.slice(1);
          else if (!displayName) displayName = t;
        }

        const avatar = document.querySelector('a[href$="/photo"] img, img[src*="profile_images"]');
        return { displayName, username, avatarUrl: avatar?.src || null };
      });

      if (fromProfile?.username) {
        return {
          displayName: fromProfile.displayName || fromSidebar?.displayName,
          username: fromProfile.username,
          avatarUrl: fromProfile.avatarUrl || fromSidebar?.avatarUrl,
        };
      }
    } catch {
      // fall through
    }

    return fromSidebar;
  }

  async captureScreenshot(page, accountName) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const filePath = path.join(SCREENSHOT_DIR, `${accountName}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    return `/api/health/screenshots/${accountName}`;
  }

  async testLike(bot, page, meta, ctx) {
    const unlike = await page.$('[data-testid="unlike"]');
    if (unlike) {
      return makeCheckResult(true, { note: 'already_liked' });
    }
    const ok = await bot.likeOnPage(page, meta, ctx);
    return makeCheckResult(ok, ok ? {} : { error: 'Like button not found or click failed' });
  }

  async testRetweet(bot, page, meta, ctx) {
    const unretweet = await page.$('[data-testid="unretweet"]');
    if (unretweet) {
      return makeCheckResult(true, { note: 'already_retweeted' });
    }
    const ok = await bot.retweetOnPage(page, meta, ctx);
    return makeCheckResult(ok, ok ? {} : { error: 'Retweet failed' });
  }

  async runOneAccount(accountName) {
    const startedAt = Date.now();
    const keyword = this.config.healthCheck?.keyword || 'crypto';
    const replyText = this.config.healthCheck?.replyText || 'Health check test';
    const ctx = this.buildCtx(accountName);

    const result = {
      accountName,
      status: 'dead',
      profile: { displayName: null, username: null, avatarUrl: null },
      screenshotUrl: null,
      checks: {
        login: makeCheckResult(false),
        suspended: makeCheckResult(false),
        search: makeCheckResult(false),
        like: makeCheckResult(false),
        retweet: makeCheckResult(false),
        reply: makeCheckResult(false),
      },
      testedAt: new Date().toISOString(),
      durationMs: 0,
    };

    const browserManager = new BrowserManager(this.config);
    this.onBrowserCreated(browserManager);
    const authManager = new AuthManager(this.accountsDir, this.config.baseUrl);
    const ai = new AIService(this.config);
    const bot = new EngagementBot(browserManager, authManager, ai, this.db, this.config);

    try {
      if (this.shouldStop()) {
        result.status = 'stopped';
        result.error = 'Stopped by user';
        return result;
      }

      await browserManager.launch();
      const page = await browserManager.newPage();

      const cookies = await authManager.loadCookies(accountName);
      if (!cookies || !cookies.length) {
        result.checks.login = makeCheckResult(false, { error: 'No cookie file' });
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      await page.setCookie(...cookies);
      await authManager.gotoWithTimeout(
        page,
        `${this.config.baseUrl || 'https://x.com'}/home`,
        90000
      );
      await sleep(3000);

      const suspended = await authManager.isSuspendedOnPage(page);
      if (suspended) {
        result.checks.login = makeCheckResult(true, { note: 'session_ok' });
        result.checks.suspended = makeCheckResult(true);
        result.status = 'suspended';
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      const loginOk = await authManager.isLoggedInOnPage(page);
      if (!loginOk) {
        result.checks.login = makeCheckResult(false, { error: 'Cookie expired or login failed' });
        result.screenshotUrl = await this.captureScreenshot(page, accountName).catch(() => null);
        return result;
      }

      result.checks.login = makeCheckResult(true);
      result.checks.suspended = makeCheckResult(false);

      const profile = await this.getProfileInfo(page);
      if (profile) {
        result.profile = {
          displayName: profile.displayName,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
        };
      }

      result.screenshotUrl = await this.captureScreenshot(page, accountName);

      const urls = await bot.searchTweets(page, keyword, ctx);
      if (!urls.length) {
        result.checks.search = makeCheckResult(false, {
          error: `No tweets for keyword "${keyword}"`,
          keyword,
          tweetCount: 0,
        });
        result.status = computeStatus(result.checks);
        return result;
      }

      result.checks.search = makeCheckResult(true, {
        keyword,
        tweetCount: urls.length,
      });

      const tweetUrl = urls[0];
      const content = await bot.getTweetContent(page, tweetUrl, ctx);
      if (!content) {
        result.checks.search = makeCheckResult(false, { error: 'Could not load tweet page' });
        result.status = computeStatus(result.checks);
        return result;
      }

      const tweetId = parseTweetId(tweetUrl);
      const meta = {
        tweetId,
        tweetUrl,
        author: content.author,
        content: content.text,
        keyword,
      };

      const stepDelay = ctx.delays.betweenActions;
      await sleep(randomMs(stepDelay.min, stepDelay.max));

      result.checks.like = await this.testLike(bot, page, meta, ctx);
      await sleep(randomMs(stepDelay.min, stepDelay.max));

      result.checks.retweet = await this.testRetweet(bot, page, meta, ctx);
      await sleep(randomMs(stepDelay.min, stepDelay.max));

      const replyOk = await bot.replyOnPage(page, replyText, meta, ctx, replyText);
      result.checks.reply = makeCheckResult(replyOk, replyOk ? {} : { error: 'Reply failed' });

      if (meta.tweetUrl) {
        result.checks.like.tweetUrl = meta.tweetUrl;
        result.checks.retweet.tweetUrl = meta.tweetUrl;
        result.checks.reply.tweetUrl = meta.tweetUrl;
      }

      result.status = computeStatus(result.checks);

      if (this.db) {
        await this.db.logActivity({
          accountName,
          action: 'health_check',
          target: meta.tweetUrl || accountName,
          success: result.status === 'alive',
          details: { status: result.status, checks: result.checks },
        }).catch(() => null);
      }

      return result;
    } catch (error) {
      logger.error(`[${accountName}] Health check error: ${error.message}`);
      const failedStep = !result.checks.login.ok
        ? 'login'
        : !result.checks.search.ok
          ? 'search'
          : 'unknown';
      if (failedStep === 'login') {
        result.checks.login = makeCheckResult(false, { error: error.message });
      } else if (failedStep === 'search' && result.checks.search.ok === false && !result.checks.search.error) {
        result.checks.search = makeCheckResult(false, { error: error.message });
      }
      result.status = computeStatus(result.checks);
      return result;
    } finally {
      result.durationMs = Date.now() - startedAt;
      await browserManager.close().catch(() => null);
    }
  }

  async runAll(accountNames) {
    const results = [];
    for (const name of accountNames) {
      if (this.shouldStop()) {
        logger.info('Health check stopped before next account');
        break;
      }
      logger.info(`Health check starting: ${name}`);
      const one = await this.runOneAccount(name);
      results.push(one);
      this.onProgress({ type: 'account', result: one, results: [...results] });
      if (this.shouldStop()) {
        logger.info('Health check stopped after current account');
        break;
      }
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

module.exports = { AccountHealthChecker, listCookieAccounts, SCREENSHOT_DIR };
