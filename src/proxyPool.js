const http = require('http');
const https = require('https');
const tls = require('tls');
const logger = require('./logger');

/**
 * ProxyPool — quản lý danh sách proxy từ MongoDB.
 * Mỗi browser session sẽ được cấp 1 proxy riêng từ pool.
 * Tự động failover khi proxy chết.
 */
class ProxyPool {
  constructor(database) {
    this.db = database;
    this._enabled = false;
  }

  async init() {
    if (!this.db?.connected) return;
    const proxies = await this.db.listProxies();
    const active = proxies.filter((p) => p.status === 'active');
    this._enabled = active.length > 0;
    logger.info(
      `ProxyPool initialized: ${proxies.length} total, ${active.length} active`
    );
  }

  get enabled() {
    return this._enabled;
  }

  /**
   * Lấy 1 proxy có sẵn từ DB (active trước, untested sau).
   * @returns {{ _id, url, status, ... } | null}
   */
  async getNext() {
    if (!this.db?.connected) return null;
    return this.db.getNextAvailableProxy();
  }

  async getForAccount(accountName) {
    if (!this.db?.connected || !accountName) return null;
    const proxy = await this.db.getOrAssignProxy(accountName);
    if (proxy) {
      logger.info(`[ProxyPool] Sticky proxy for ${accountName}: ${proxy.url}`);
    }
    return proxy;
  }

  static normalizeUrl(proxyUrl) {
    if (!proxyUrl) return '';
    let raw = String(proxyUrl).trim();
    if (!raw) return '';

    const parts = raw.split(':');
    if (parts.length === 4 && !raw.includes('@') && !raw.includes('//')) {
      // host:port:user:pass -> http://user:pass@host:port
      return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
    }

    if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('socks5://') && !raw.startsWith('socks4://')) {
      return `http://${raw}`;
    }
    return raw;
  }

  /**
   * Test 1 proxy URL bằng cách gửi request qua proxy
   * Hỗ trợ cả HTTPS CONNECT tunneling và HTTP Forward proxy
   * @param {string} proxyUrl e.g. "http://host:port", "user:pass@host:port", or "host:port:user:pass"
   * @param {number} timeoutMs
   * @returns {{ ok: boolean, latencyMs?: number, error?: string }}
   */
  static testProxy(proxyUrl, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      let settled = false;
      let connectRequest = null;
      let tunnelSocket = null;
      let tlsSocket = null;

      const done = (ok, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connectRequest?.destroy();
        tlsSocket?.destroy();
        tunnelSocket?.destroy();
        resolve({ ok, latencyMs: Date.now() - start, error: error || undefined });
      };

      const timer = setTimeout(() => done(false, `Timeout (${timeoutMs}ms)`), timeoutMs);

      try {
        const normalized = ProxyPool.normalizeUrl(proxyUrl);
        if (!normalized) return done(false, 'Empty URL');

        const parsed = new URL(normalized);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return done(false, `Unsupported proxy protocol: ${parsed.protocol}`);
        }
        const proxyHost = parsed.hostname;
        const proxyPort = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
        const proxyAuth = parsed.username
          ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
          : null;

        // Establish a CONNECT tunnel and then complete a real, certificate-checked
        // TLS request. A bare CONNECT 200 is not enough: many dead public proxies fake it.
        const connectOptions = {
          host: proxyHost,
          port: proxyPort,
          method: 'CONNECT',
          path: 'x.com:443',
          headers: { Host: 'x.com:443', 'User-Agent': 'Mozilla/5.0' },
          timeout: timeoutMs,
        };
        if (proxyAuth) {
          connectOptions.headers['Proxy-Authorization'] =
            'Basic ' + Buffer.from(proxyAuth).toString('base64');
        }

        connectRequest = (parsed.protocol === 'https:' ? https : http).request(connectOptions);
        connectRequest.once('timeout', () => done(false, 'CONNECT timeout'));
        connectRequest.once('error', (error) =>
          done(false, error.message || 'Proxy connection failed')
        );
        connectRequest.once('connect', (res, socket, head) => {
          tunnelSocket = socket;
          if (res.statusCode !== 200) return done(false, `CONNECT ${res.statusCode}`);
          if (head?.length) socket.unshift(head);

          tlsSocket = tls.connect({
            socket,
            servername: 'x.com',
            rejectUnauthorized: true,
          });
          tlsSocket.setTimeout(Math.max(1000, timeoutMs - (Date.now() - start)));
          tlsSocket.once('timeout', () => done(false, 'TLS timeout'));
          tlsSocket.once('error', (error) => done(false, `TLS: ${error.message}`));
          tlsSocket.once('secureConnect', () => {
            tlsSocket.write(
              'GET /i/flow/login HTTP/1.1\r\nHost: x.com\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36\r\nAccept: text/html,application/xhtml+xml\r\nConnection: close\r\n\r\n'
            );
          });

          let response = '';
          tlsSocket.on('data', (chunk) => {
            response += chunk.toString('latin1');
            const status = response.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
            if (status) {
              const code = Number(status[1]);
              done(code >= 200 && code < 400, code >= 400 ? `X HTTP ${code}` : null);
            }
          });
          tlsSocket.once('end', () => {
            if (!settled) done(false, 'X closed tunnel without an HTTP response');
          });
        });

        connectRequest.end();
      } catch (err) {
        done(false, err.message);
      }
    });
  }

  /**
   * Test tất cả proxy untested/dead và cập nhật status vào DB
   */
  async testAll(options = {}) {
    if (!this.db?.connected) return;
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    const allProxies = await this.db.listProxies();
    const proxies = statuses
      ? allProxies.filter((proxy) => statuses.has(proxy.status))
      : allProxies;
    const results = new Array(proxies.length);
    const concurrency = Math.max(
      1,
      Math.min(parseInt(process.env.PROXY_TEST_CONCURRENCY || '15', 10) || 15, 50)
    );
    let nextIndex = 0;

    const testNext = async () => {
      const index = nextIndex++;
      if (index >= proxies.length) return;
      const proxy = proxies[index];
      const { ok, latencyMs, error } = await ProxyPool.testProxy(proxy.url, 12000);
      if (ok) {
        await this.db.updateProxyStatus(proxy._id.toString(), 'active');
        logger.info(`[ProxyPool] Active: ${proxy.url}${latencyMs ? ` (${latencyMs}ms)` : ''}`);
        results[index] = { id: proxy._id, url: proxy.url, status: 'active', latencyMs };
      } else {
        // Automatically delete dead proxies to keep the pool clean
        await this.db.deleteProxy(proxy._id.toString());
        if (proxy.assignedAccountName) {
          await this.db.getOrAssignProxy(proxy.assignedAccountName);
        }
        logger.info(`[ProxyPool] Auto-deleted dead proxy: ${proxy.url} (${error || 'failed'})`);
        results[index] = { id: proxy._id, url: proxy.url, status: 'deleted', error };
      }
      await testNext();
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, proxies.length) }, () => testNext())
    );
    // Re-check availability
    await this.init();
    return results;
  }

  /**
   * Đánh dấu proxy chết và tự động xóa khỏi DB, sau đó lấy proxy khác
   */
  async markDeadAndGetNext(accountName, proxyId, error) {
    if (this.db?.connected) {
      await this.db.deleteProxy(proxyId.toString());
      logger.warn(`[ProxyPool] Auto-deleted dead proxy during run: ${proxyId}, reason: ${error}`);
    }
    return accountName ? this.getForAccount(accountName) : this.getNext();
  }
}

module.exports = ProxyPool;
