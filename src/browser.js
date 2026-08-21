const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
  }

  parseProxy(proxyString) {
    if (!proxyString) return null;
    let raw = proxyString.trim();
    if (!raw) return null;

    // host:port:user:pass format
    const parts = raw.split(':');
    if (parts.length === 4 && !raw.includes('@') && !raw.includes('//')) {
      raw = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
    } else if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('socks5://') && !raw.startsWith('socks4://')) {
      raw = `http://${raw}`;
    }

    try {
      const parsed = new URL(raw);
      const server = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol.startsWith('https') ? '443' : '80')}`;
      const auth = parsed.username
        ? {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          }
        : null;
      return { server, auth, raw };
    } catch {
      return { server: raw, auth: null, raw };
    }
  }

  buildLaunchArgs(overrides = {}) {
    const viewport = this.config.browser.viewport;

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=en-US,en',
    ];

    const proxyConfig = this.parseProxy(this.config.browser.proxy);
    if (proxyConfig?.server) {
      args.push(`--proxy-server=${proxyConfig.server}`);
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
      protocolTimeout: parseInt(process.env.BROWSER_PROTOCOL_TIMEOUT_MS || '180000', 10),
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
      ...overrides.launchOptions,
    };

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

    // Keep UA and Client Hints aligned with the Chromium binary Puppeteer launched.
    // A hard-coded Chrome major is easy for X to detect when it differs from Chromium.
    const runtimeUserAgent = (await this.browser.userAgent()).replace('HeadlessChrome/', 'Chrome/');
    await page.setUserAgent(runtimeUserAgent);

    // Authenticate proxy credentials if required
    const proxyConfig = this.parseProxy(this.config.browser.proxy);
    if (proxyConfig?.auth) {
      await page.authenticate(proxyConfig.auth);
      logger.info(`Proxy authenticated for user: ${proxyConfig.auth.username}`);
    }

    // Do not spoof sec-ch-ua manually; Chromium generates matching client hints.
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    });

    page.on('requestfailed', (request) => {
      const type = request.resourceType();
      const url = request.url();
      if (!['document', 'script'].includes(type) || !/https?:\/\/([^/]+\.)?(x\.com|twimg\.com)\//i.test(url)) return;
      logger.warn(
        `[BrowserNetwork] ${type} failed: ${request.failure()?.errorText || 'unknown'} ${url.slice(0, 220)}`
      );
    });
    page.on('response', (response) => {
      const request = response.request();
      const type = request.resourceType();
      const url = response.url();
      if (response.status() < 400 || !['document', 'script'].includes(type)) return;
      if (!/https?:\/\/([^/]+\.)?(x\.com|twimg\.com)\//i.test(url)) return;
      logger.warn(`[BrowserNetwork] HTTP ${response.status()} ${type}: ${url.slice(0, 220)}`);
    });

    // Deep anti-detection injection
    await page.evaluateOnNewDocument(() => {
      // 1. Remove navigator.webdriver
      try {
        delete Object.getPrototypeOf(navigator).webdriver;
      } catch {}
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. Mock window.chrome
      window.chrome = {
        app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        },
        loadTimes: () => {},
        csi: () => {},
      };

      // 3. Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'vi'],
      });

      // 4. Mock plugins length
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // 5. Mock permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
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
