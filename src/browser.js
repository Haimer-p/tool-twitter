const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
  }

  async launch(overrides = {}) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      `--window-size=${this.config.browser.viewport.width},${this.config.browser.viewport.height}`,
      '--disable-blink-features=AutomationControlled',
    ];

    if (this.config.browser.proxy) {
      args.push(`--proxy-server=${this.config.browser.proxy}`);
    }

    const headless =
      overrides.headless !== undefined ? overrides.headless : this.config.browser.headless;

    this.browser = await puppeteer.launch({
      headless,
      args,
      ...overrides.launchOptions,
    });

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
