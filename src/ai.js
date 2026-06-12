const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

class AIService {
  constructor(config) {
    this.config = config;
    this.geminiKey = process.env.GEMINI_API_KEY || '';
    this.deepseekKey = process.env.DEEPSEEK_API_KEY || '';
    this.strategy = config.ai?.strategy || 'alternate';
    this.replyCount = 0;

    this.geminiModels = [
      config.gemini.model,
      ...(config.gemini.fallbackModels || []),
    ].filter((name, i, arr) => name && arr.indexOf(name) === i);

    if (this.geminiKey) {
      this.genAI = new GoogleGenerativeAI(this.geminiKey);
    }
  }

  normalizeReplyOptions(replyOptions = {}) {
    const global = this.config.interactions || {};
    const required = replyOptions.requiredIncludes ?? global.replyRequiredIncludes ?? [];
    const includes = Array.isArray(required)
      ? required.filter((s) => s && String(s).trim())
      : [String(required).trim()].filter(Boolean);

    return {
      requiredIncludes: includes,
      maxLength: replyOptions.maxLength ?? global.replyMaxLength ?? 275,
    };
  }

  isWalletAddress(value) {
    const text = String(value).trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(text)) return true;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return true;
    return false;
  }

  buildPrompt(tweetText, tweetAuthor, context, replyOptions = {}) {
    const { requiredIncludes, maxLength } = this.normalizeReplyOptions(replyOptions);
    const hasRequired = requiredIncludes.length > 0;
    const walletIncludes = requiredIncludes.filter((s) => this.isWalletAddress(s));
    const isAirdropWalletReply = walletIncludes.length > 0;
    const hasUrlIncludes = requiredIncludes.some((s) => String(s).trim().startsWith('http'));

    let requiredBlock = '';
    let includeRule = '- No links unless part of mandatory includes';

    if (hasRequired) {
      const list = requiredIncludes.map((s) => `- ${s}`).join('\n');
      if (isAirdropWalletReply) {
        requiredBlock = `
MANDATORY — this is an airdrop/giveaway reply. Include each wallet below exactly ONCE:
${list}
Drop your wallet naturally (e.g. "wallet:", "here's my address", "count me in").
Put the wallet address on its own line at the end. Short comment (1-2 sentences) only.
Do NOT add dex links or other URLs — only the wallet address above.
`;
        includeRule =
          '- Include the wallet address exactly once; never paste dex links or duplicate the address';
      } else if (hasUrlIncludes) {
        requiredBlock = `
MANDATORY — include each item below exactly ONCE (never repeat the URL):
${list}
Put the link on its own line at the end. Short comment (1-2 sentences) only.
`;
        includeRule = '- Include each mandatory link exactly once; never paste the same URL twice';
      } else {
        requiredBlock = `
MANDATORY — include each item below exactly ONCE:
${list}
Short comment (1-2 sentences) only.
`;
        includeRule = '- Include each mandatory item exactly once';
      }
    }

    const persona = isAirdropWalletReply
      ? 'You are a crypto degen joining an airdrop/giveaway on Twitter.'
      : 'You are a crypto Twitter user.';

    return `
${persona} Write a short, natural comment/reply on this tweet.

Tweet from @${tweetAuthor}: "${tweetText}"
${context ? `Context: ${context}` : ''}
${requiredBlock}
Rules:
- 1-2 sentences plus mandatory includes; stay under ${maxLength} characters total
- Reference crypto/blockchain/DeFi when relevant to the tweet
- Add a genuine opinion or short excitement about the airdrop (not generic praise)
${includeRule}
- No hashtag spam, no "DM me"
- Sound like a real person, casual tone
- Max 1 emoji if it fits

Return ONLY the reply text.
`.trim();
  }

  dedupeUrlsInText(text) {
    const seen = new Set();
    return (text || '')
      .replace(/https?:\/\/[^\s\n]+/gi, (url) => {
        const key = url.toLowerCase().replace(/\/$/, '');
        if (seen.has(key)) return '';
        seen.add(key);
        return url;
      })
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  includesRequired(result, req) {
    const hay = (result || '').toLowerCase();
    const needle = String(req).toLowerCase().trim();
    if (!needle) return true;
    if (hay.includes(needle)) return true;
    if (needle.startsWith('http')) {
      try {
        const path = new URL(needle).pathname.toLowerCase();
        const slug = path.split('/').filter(Boolean).pop();
        if (slug && hay.includes(slug)) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  finalizeReply(text, replyOptions = {}) {
    const { requiredIncludes, maxLength } = this.normalizeReplyOptions(replyOptions);
    let result = this.dedupeUrlsInText(
      (text || '').trim().replace(/^["']|["']$/g, '')
    );

    const missing = requiredIncludes.filter((req) => !this.includesRequired(result, req));

    if (missing.length > 0) {
      const lines = missing.map((m) => String(m).trim()).filter(Boolean);
      const suffix = lines.join('\n');
      const sep = result.length > 0 ? '\n' : '';
      result = `${result}${sep}${suffix}`.trim();
      result = this.dedupeUrlsInText(result);
      logger.info(`Reply appended required: ${missing.length} item(s)`);
    }

    if (result.length > maxLength) {
      const linkReq = requiredIncludes.find((r) => String(r).startsWith('http'));
      const walletReq = requiredIncludes.find((r) => this.isWalletAddress(r));
      const otherReq = requiredIncludes.find(
        (r) => !String(r).startsWith('http') && !this.isWalletAddress(r)
      );
      const footer = [linkReq, walletReq, otherReq].filter(Boolean).join('\n');
      const reserved = footer.length + (footer ? 2 : 0);
      if (footer && reserved < maxLength) {
        const mainMax = maxLength - reserved;
        result = `${result.slice(0, mainMax).trim()}\n${footer}`;
      } else {
        result = result.slice(0, maxLength);
      }
      result = this.dedupeUrlsInText(result);
    }

    return result.trim();
  }

  getEnabledProviders() {
    const providers = [];
    if (this.geminiKey) providers.push('gemini');
    if (this.deepseekKey) providers.push('deepseek');
    return providers;
  }

  getStrategy() {
    return process.env.AI_STRATEGY || this.config.ai?.strategy || 'alternate';
  }

  getProviderOrder() {
    const enabled = this.getEnabledProviders();
    if (enabled.length === 0) return [];

    const strategy = this.getStrategy();

    if (strategy === 'gemini') {
      return enabled.includes('gemini') ? ['gemini'] : enabled;
    }
    if (strategy === 'deepseek') {
      return enabled.includes('deepseek') ? ['deepseek'] : enabled;
    }

    this.replyCount += 1;
    if (enabled.length === 1) return enabled;

    const primary = this.replyCount % 2 === 1 ? 'gemini' : 'deepseek';
    const secondary = primary === 'gemini' ? 'deepseek' : 'gemini';
    const order = [];
    if (enabled.includes(primary)) order.push(primary);
    if (enabled.includes(secondary)) order.push(secondary);
    return order.length ? order : enabled;
  }

  async generateGemini(prompt) {
    if (!this.genAI) throw new Error('Gemini API key not configured');

    const failures = [];
    for (const modelName of this.geminiModels) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: this.config.gemini.temperature,
          },
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) {
          logger.info(`AI reply via Gemini (${modelName})`);
          return text;
        }
      } catch (error) {
        const short = error.message?.slice(0, 120) || String(error);
        failures.push({ modelName, short });
        logger.warn(`Gemini ${modelName}: ${short.slice(0, 100)}`);
      }
    }
    throw new Error(
      `All Gemini models failed (${failures.map((f) => f.modelName).join(', ')})`
    );
  }

  async generateDeepSeek(prompt) {
    if (!this.deepseekKey) throw new Error('DeepSeek API key not configured');

    const { baseUrl, model, temperature, maxTokens } = this.config.deepseek;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deepseekKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg = data.error?.message || response.statusText || 'DeepSeek API error';
      throw new Error(`DeepSeek ${response.status}: ${msg}`);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek returned empty response');

    logger.info(`AI reply via DeepSeek (${model})`);
    return text;
  }

  isRetryableError(error) {
    const msg = (error.message || '').toLowerCase();
    return (
      msg.includes('404') ||
      msg.includes('not found') ||
      msg.includes('not supported') ||
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('500') ||
      msg.includes('503') ||
      msg.includes('error fetching') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound')
    );
  }

  async generateReply(tweetText, tweetAuthor, context = '', replyOptions = {}) {
    const prompt = this.buildPrompt(tweetText, tweetAuthor, context, replyOptions);
    const providers = this.getProviderOrder();

    if (providers.length === 0) {
      logger.error('No AI provider configured (GEMINI_API_KEY or DEEPSEEK_API_KEY)');
      return this.finalizeReply(this.fallbackReply(tweetText), replyOptions);
    }

    logger.info(`AI providers this reply: ${providers.join(' → ')}`);

    for (const provider of providers) {
      try {
        let raw;
        if (provider === 'gemini') {
          raw = await this.generateGemini(prompt);
        } else if (provider === 'deepseek') {
          raw = await this.generateDeepSeek(prompt);
        }
        if (raw) {
          return this.finalizeReply(raw, replyOptions);
        }
      } catch (error) {
        logger.warn(`${provider} failed: ${error.message?.slice(0, 120)}`);
      }
    }

    logger.error('All AI providers failed — using fallback reply');
    return this.finalizeReply(this.fallbackReply(tweetText), replyOptions);
  }

  buildAppealPrompt({ username, suspendReason, accountName, language = 'en' }) {
    const handle = username ? `@${username}` : accountName || 'my account';
    const reasonBlock = suspendReason
      ? `\nStated suspension reason on the page: "${suspendReason}"`
      : '';

    return `
Write a formal Twitter/X account suspension appeal in ${language === 'vi' ? 'Vietnamese' : 'English'}.

Account: ${handle}${reasonBlock}

Rules:
- Polite, professional tone — request a review because the suspension appears to be a mistake
- Explain the account is used legitimately for crypto/Web3 discussion and community engagement
- State you do not use bots, spam, or automated mass actions; you follow X rules
- Commit to continuing compliant use if the account is restored
- Length: 150–500 characters
- Return ONLY the appeal text — no quotes, labels, or markdown

Return ONLY the appeal text.
`.trim();
  }

  finalizeAppealText(raw, options = {}) {
    const minLen = options.minLength ?? 150;
    const maxLen = options.maxLength ?? 500;
    let text = String(raw || '')
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^\*\*|\*\*$/g, '');

    if (text.length > maxLen) {
      text = text.slice(0, maxLen - 3).trimEnd() + '...';
    }
    if (text.length < minLen) {
      text = this.fallbackAppealText(options);
    }
    return text;
  }

  fallbackAppealText({ username, accountName } = {}) {
    const handle = username ? `@${username}` : accountName || 'my account';
    return (
      `Hello, I believe ${handle} was suspended in error. I use this account personally to discuss ` +
      `crypto and Web3 topics, engage with the community, and share legitimate content. I do not run bots ` +
      `or spam, and I respect X's rules. Please review my account and restore access. I will continue ` +
      `to use the platform responsibly. Thank you.`
    );
  }

  async generateAppealText(meta = {}) {
    const appealCfg = this.config.appeal || {};
    const options = {
      minLength: appealCfg.appealMinLength ?? 150,
      maxLength: appealCfg.appealMaxLength ?? 500,
      username: meta.username,
      accountName: meta.accountName,
    };
    const prompt = this.buildAppealPrompt({
      ...meta,
      language: appealCfg.language || 'en',
    });
    const providers = this.getProviderOrder();

    if (providers.length === 0) {
      logger.warn('No AI provider for appeal — using fallback template');
      return this.finalizeAppealText(this.fallbackAppealText(options), options);
    }

    logger.info(`AI appeal providers: ${providers.join(' → ')}`);

    for (const provider of providers) {
      try {
        let raw;
        if (provider === 'gemini') {
          raw = await this.generateGemini(prompt);
        } else if (provider === 'deepseek') {
          raw = await this.generateDeepSeek(prompt);
        }
        if (raw) {
          return this.finalizeAppealText(raw, options);
        }
      } catch (error) {
        logger.warn(`Appeal ${provider} failed: ${error.message?.slice(0, 120)}`);
      }
    }

    logger.warn('All AI providers failed for appeal — using fallback template');
    return this.finalizeAppealText(this.fallbackAppealText(options), options);
  }

  fallbackReply(tweetText) {
    const fallbacks = [
      `Interesting take on ${this.extractTopic(tweetText)} — watching this closely`,
      'Solid point, the on-chain data will tell us soon',
      'Been tracking this narrative, thanks for sharing',
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  extractTopic(tweetText) {
    const keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'ethereum', 'solana'];
    const lower = tweetText.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return kw;
    }
    return 'this';
  }
}

module.exports = AIService;
