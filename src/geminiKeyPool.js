const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function splitKeyTokens(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function parseGeminiKeysFromEnv() {
  const keys = [];

  const bulk = process.env.GEMINI_API_KEYS;
  if (bulk) {
    splitKeyTokens(bulk).forEach((k) => keys.push(k));
  }

  const single = process.env.GEMINI_API_KEY;
  if (single) {
    // Hỗ trợ GEMINI_API_KEY=key1,key2,key3 (phổ biến khi paste nhiều key)
    splitKeyTokens(single).forEach((k) => keys.push(k));
  }

  for (let i = 1; i <= 20; i++) {
    const v = process.env[`GEMINI_API_KEY_${i}`];
    if (v) splitKeyTokens(v).forEach((k) => keys.push(k));
  }

  return [...new Set(keys)];
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

class GeminiKeyPool {
  constructor(options = {}) {
    this.keys = parseGeminiKeysFromEnv();
    this.statePath =
      options.statePath ||
      process.env.GEMINI_KEY_STATE_FILE ||
      path.join(process.cwd(), 'logs', 'gemini-key-pool.json');
    this.state = { resetDate: todayKey(), failed: {} };
    this.loadState();
    this.maybeDailyReset();
    if (this.keys.length) {
      logger.info(`Gemini key pool loaded: ${this.keys.length} key(s)`);
    }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.state = {
          resetDate: raw.resetDate || todayKey(),
          failed: raw.failed && typeof raw.failed === 'object' ? raw.failed : {},
        };
      }
    } catch (err) {
      logger.warn(`Gemini key pool: could not read state — ${err.message}`);
    }
  }

  saveState() {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.warn(`Gemini key pool: could not save state — ${err.message}`);
    }
  }

  maybeDailyReset() {
    const today = todayKey();
    if (this.state.resetDate === today) return;

    const prevFailed = Object.keys(this.state.failed || {}).length;
    this.state = { resetDate: today, failed: {} };
    this.saveState();
    logger.info(
      `Gemini key pool: daily reset (${today}) — ${this.keys.length} key(s), cleared ${prevFailed} failed`
    );
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  keyLabel(index) {
    const k = this.keys[index] || '';
    const tail = k.length >= 4 ? k.slice(-4) : '????';
    return `key#${index + 1}(...${tail})`;
  }

  getAvailableIndices() {
    this.maybeDailyReset();
    return this.keys.map((_, i) => i).filter((i) => !this.state.failed[String(i)]);
  }

  markFailed(index, reason) {
    this.state.failed[String(index)] = {
      failedAt: new Date().toISOString(),
      reason: String(reason || 'unknown').slice(0, 240),
    };
    this.saveState();
    logger.warn(
      `Gemini ${this.keyLabel(index)} disabled until tomorrow: ${String(reason || '').slice(0, 100)}`
    );
  }

  isTransientError(error) {
    const msg = (error?.message || String(error)).toLowerCase();
    return (
      msg.includes('error fetching') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('socket') ||
      msg.includes('timeout') ||
      msg.includes('503') ||
      msg.includes('500')
    );
  }

  isKeyLevelError(error) {
    if (this.isTransientError(error)) return false;
    const msg = (error?.message || String(error)).toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit') ||
      msg.includes('403') ||
      msg.includes('401') ||
      msg.includes('permission denied') ||
      msg.includes('api key not valid') ||
      msg.includes('api_key_invalid') ||
      msg.includes('invalid api key') ||
      msg.includes('unauthorized') ||
      msg.includes('billing') ||
      (msg.includes('exceeded') && msg.includes('quota'))
    );
  }

  getStatus() {
    this.maybeDailyReset();
    const available = this.getAvailableIndices().length;
    return {
      total: this.keys.length,
      available,
      failed: this.keys.length - available,
      resetDate: this.state.resetDate,
      failedDetails: Object.entries(this.state.failed || {}).map(([idx, info]) => ({
        index: Number(idx),
        label: this.keyLabel(Number(idx)),
        ...info,
      })),
    };
  }

  /**
   * @param {(apiKey: string, index: number) => Promise<*>} fn
   */
  async executeWithFallback(fn) {
    this.maybeDailyReset();
    const indices = this.getAvailableIndices();

    if (!indices.length) {
      throw new Error('All Gemini API keys exhausted for today — resets at midnight UTC');
    }

    const errors = [];
    for (const index of indices) {
      const apiKey = this.keys[index];
      try {
        return await fn(apiKey, index);
      } catch (error) {
        const short = error?.message?.slice(0, 160) || String(error);
        errors.push(`${this.keyLabel(index)}: ${short}`);
        if (this.isKeyLevelError(error)) {
          this.markFailed(index, short);
        } else {
          logger.warn(`Gemini ${this.keyLabel(index)} failed (not disabling key): ${short.slice(0, 100)}`);
        }
      }
    }

    throw new Error(`All Gemini keys failed: ${errors.join(' | ')}`);
  }
}

let sharedPool = null;

function getGeminiKeyPool() {
  if (!sharedPool) sharedPool = new GeminiKeyPool();
  return sharedPool;
}

module.exports = {
  GeminiKeyPool,
  getGeminiKeyPool,
  parseGeminiKeysFromEnv,
};
