const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
  }

  async launch() {
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

    const protocolTimeout =
      this.config.browser.protocolTimeout || parseInt(process.env.BROWSER_PROTOCOL_TIMEOUT || '180000', 10);

    this.browser = await puppeteer.launch({
      headless: this.config.browser.headless,
      args,
      protocolTimeout,
    });

    logger.info('Browser launched');
    return this.browser;
  }

  async newPage() {
    if (!this.browser) {
      await this.launch();
    }
    const page = await this.browser.newPage();
    const defaultTimeout =
      this.config.browser.defaultTimeout || parseInt(process.env.BROWSER_DEFAULT_TIMEOUT || '60000', 10);
    page.setDefaultTimeout(defaultTimeout);
    page.setDefaultNavigationTimeout(
      this.config.browser.navigationTimeout || parseInt(process.env.BROWSER_NAV_TIMEOUT || '45000', 10)
    );
    await page.setViewport(this.config.browser.viewport);
    await page.setUserAgent(this.config.browser.userAgent);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    page.on('dialog', async (dialog) => {
      try {
        const msg = dialog.message();
        logger.info(`Browser dialog [${dialog.type()}]: ${msg.slice(0, 100)}`);
        const leavePrompt =
          dialog.type() === 'beforeunload' || /leave site|changes you made/i.test(msg);
        if (leavePrompt) {
          await dialog.dismiss();
        } else {
          await dialog.accept();
        }
      } catch (err) {
        logger.warn(`Không đóng được dialog: ${err.message}`);
      }
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
