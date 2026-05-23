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

  buildPrompt(tweetText, tweetAuthor, context) {
    return `
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
`.trim();
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

    // alternate: luân phiên gemini ↔ deepseek mỗi reply
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
        if (!this.isRetryableError(error)) throw error;
        logger.warn(`Gemini ${modelName}: ${error.message?.slice(0, 100)}`);
      }
    }
    throw new Error('All Gemini models failed');
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
    const msg = error.message || '';
    return (
      msg.includes('404') ||
      msg.includes('not found') ||
      msg.includes('not supported') ||
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('500') ||
      msg.includes('503')
    );
  }

  async generateReply(tweetText, tweetAuthor, context = '') {
    const prompt = this.buildPrompt(tweetText, tweetAuthor, context);
    const providers = this.getProviderOrder();

    if (providers.length === 0) {
      logger.error('No AI provider configured (GEMINI_API_KEY or DEEPSEEK_API_KEY)');
      return this.fallbackReply(tweetText);
    }

    logger.info(`AI providers this reply: ${providers.join(' → ')}`);

    for (const provider of providers) {
      try {
        if (provider === 'gemini') {
          return await this.generateGemini(prompt);
        }
        if (provider === 'deepseek') {
          return await this.generateDeepSeek(prompt);
        }
      } catch (error) {
        logger.warn(`${provider} failed: ${error.message?.slice(0, 120)}`);
      }
    }

    logger.error('All AI providers failed — using fallback reply');
    return this.fallbackReply(tweetText);
  }

  fallbackReply(tweetText) {
    const fallbacks = [
      `Thanks for sharing this! Really interesting perspective on ${this.extractTopic(tweetText)}`,
      'Great point! Web3 needs more discussions like this',
      "I've been following this closely. Thanks for the update!",
      'This is why I love the Web3 space - always learning something new',
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  extractTopic(tweetText) {
    const keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'ethereum', 'solana'];
    const lower = tweetText.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return kw;
    }
    return 'this topic';
  }
}

module.exports = AIService;
