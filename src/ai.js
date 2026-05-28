const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

class AIService {
  constructor(keys, config) {
    this.config = config;

    if (typeof keys === 'string') {
      this.geminiKey = keys;
      this.deepseekKey = '';
    } else {
      this.geminiKey =
        keys?.geminiKey !== undefined ? keys.geminiKey : process.env.GEMINI_API_KEY || '';
      this.deepseekKey =
        keys?.deepseekKey !== undefined
          ? keys.deepseekKey
          : process.env.DEEPSEEK_API_KEY || '';
    }

    this.geminiQuotaExceeded = false;

    if (this.geminiKey) {
      this.genAI = new GoogleGenerativeAI(this.geminiKey);
      this.geminiModel = this.genAI.getGenerativeModel({
        model: config.gemini.model,
        generationConfig: {
          temperature: config.gemini.temperature,
        },
      });
    }
  }

  hasAnyProvider() {
    return !!(this.geminiKey?.trim() || this.deepseekKey?.trim());
  }

  getProviderOrder() {
    const primary = this.config.ai?.primary || 'gemini';
    const order = primary === 'deepseek' ? ['deepseek', 'gemini'] : ['gemini', 'deepseek'];
    return order.filter((provider) => this.hasProvider(provider));
  }

  hasProvider(provider) {
    if (provider === 'gemini') return !!this.geminiKey?.trim();
    if (provider === 'deepseek') return !!this.deepseekKey?.trim();
    return false;
  }

  async callGemini(prompt) {
    if (!this.geminiModel) throw new Error('Gemini API key not configured');
    const result = await this.geminiModel.generateContent(prompt);
    const text = result.response.text()?.trim();
    if (!text) throw new Error('Gemini returned empty response');
    return text;
  }

  async callDeepseek(prompt) {
    if (!this.deepseekKey?.trim()) throw new Error('DeepSeek API key not configured');

    const { baseUrl, model, temperature } = this.config.deepseek;
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.deepseekKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          stream: false,
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        throw new Error(`DeepSeek: ${msg}`);
      }

      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('DeepSeek returned empty response');
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  isQuotaError(error) {
    const msg = error?.message || '';
    return /429|quota exceeded|too many requests/i.test(msg);
  }

  isGeminiDisabledError(error) {
    const msg = error?.message || '';
    return (
      this.isQuotaError(error) ||
      /403|forbidden|leaked|api key not valid|invalid.*api key/i.test(msg)
    );
  }

  async generateWithFallback(prompt, maxLen = null) {
    const providers = this.getProviderOrder();
    if (providers.length === 0) {
      throw new Error('No AI provider configured (GEMINI_API_KEY or DEEPSEEK_API_KEY)');
    }

    let lastError;
    for (const provider of providers) {
      if (provider === 'gemini' && this.geminiQuotaExceeded) continue;

      try {
        logger.info(`AI request → ${provider}`);
        const text =
          provider === 'gemini'
            ? await this.callGemini(prompt)
            : await this.callDeepseek(prompt);
        if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
        return text;
      } catch (error) {
        lastError = error;
        if (provider === 'gemini' && this.isGeminiDisabledError(error)) {
          this.geminiQuotaExceeded = true;
          logger.warn('Gemini không dùng được — chỉ dùng DeepSeek cho các lần sau');
        } else {
          logger.warn(`${provider} failed: ${error.message}`);
        }
      }
    }

    throw lastError || new Error('All AI providers failed');
  }

  async generateReply(tweetText, tweetAuthor, context = '') {
    const prompt = `
You are a crypto Twitter user. Write a short, natural comment/reply on this tweet.

Tweet from @${tweetAuthor}: "${tweetText}"
${context ? `Context: ${context}` : ''}

Rules:
- 1-2 sentences max, under 200 characters
- Reference crypto/blockchain/DeFi/NFT when relevant
- Add a genuine opinion or question (not generic praise)
- No hashtags spam, no "DM me", no links
- Sound like a real person, casual tone
- Max 1 emoji if it fits

Return ONLY the reply text.
`;

    try {
      return await this.generateWithFallback(prompt, 200);
    } catch (error) {
      logger.error(`AI generation error: ${error.message}`);
      const fallbacks = [
        `Thanks for sharing this! Really interesting perspective on ${this.extractTopic(tweetText)}`,
        'Great point! Web3 needs more discussions like this',
        "I've been following this closely. Thanks for the update!",
        'This is why I love the Web3 space - always learning something new',
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  extractTopic(tweetText) {
    const keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'ethereum', 'solana'];
    const lower = tweetText.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return kw;
    }
    return 'this topic';
  }

  async generateAirdropReply(tweetText, tweetAuthor, walletType, wallets) {
    const maxLen = 100;
    const walletInstructions = {
      evm: `Include ONLY this EVM wallet: ${wallets.evm}`,
      solana: `Include ONLY this Solana wallet: ${wallets.solana}`,
      both: `Include BOTH wallets — EVM: ${wallets.evm}, Solana: ${wallets.solana}`,
    };

    const prompt = `
You are a crypto Twitter user replying to an airdrop post that asks for wallet addresses.

Tweet from @${tweetAuthor}: "${tweetText}"

${walletInstructions[walletType] || walletInstructions.both}

Rules:
- VERY SHORT reply, max ${maxLen} characters total
- Must include the correct wallet address(es) exactly as given
- Natural casual tone, 1 short sentence or just the address(es)
- No hashtags, no "DM me", no extra links
- Max 1 emoji if it fits
- Return ONLY the reply text, nothing else
`;

    try {
      return await this.generateWithFallback(prompt, maxLen);
    } catch (error) {
      logger.error(`AI airdrop reply error: ${error.message}`);
      const { buildRuleComments } = require('./walletMatcher');
      const comments = buildRuleComments(walletType, {
        airdrop: { ruleTemplates: { evm: '{address}', solana: '{address}' }, maxCommentLength: maxLen },
        wallets,
      });
      return comments[0] || wallets.evm || wallets.solana || '';
    }
  }
}

module.exports = AIService;
