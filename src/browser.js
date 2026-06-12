const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
  }

  buildLaunchArgs(overrides = {}) {
    const viewport = this.config.browser.viewport;
    const captchaFriendly = !!overrides.captchaFriendly;

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
      '--disable-blink-features=AutomationControlled',
    ];

    if (!captchaFriendly) {
      args.push(
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      );
    }

    if (this.config.browser.proxy) {
      args.push(`--proxy-server=${this.config.browser.proxy}`);
    }

    if (Array.isArray(overrides.extraArgs)) {
      args.push(...overrides.extraArgs);
    }

    return args;
  }

  async launch(overrides = {}) {
    const args = this.buildLaunchArgs(overrides);

    const headless =
      overrides.headless !== undefined ? overrides.headless : this.config.browser.headless;

    const launchOptions = {
      headless,
      args,
      ...overrides.launchOptions,
    };

    if (overrides.captchaFriendly) {
      launchOptions.ignoreDefaultArgs = [
        ...(Array.isArray(launchOptions.ignoreDefaultArgs)
          ? launchOptions.ignoreDefaultArgs
          : launchOptions.ignoreDefaultArgs
            ? [launchOptions.ignoreDefaultArgs]
            : []),
        '--enable-automation',
      ];
    }

    this.browser = await puppeteer.launch(launchOptions);

    logger.info(`Browser launched (headless=${headless})`);
    return this.browser;
  }

  async newPage(launchOverrides) {
    if (!this.browser) {
      await this.launch(launchOverrides);
    }
    const page = await this.browser.newPage();
    await page.setViewport(this.config.browser.viewport);
    await page.setUserAgent(this.config.browser.userAgent);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    return page;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }
}

module.exports = BrowserManager;
