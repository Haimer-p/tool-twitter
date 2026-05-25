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

  buildPrompt(tweetText, tweetAuthor, context, replyOptions = {}) {
    const { requiredIncludes, maxLength } = this.normalizeReplyOptions(replyOptions);
    const hasRequired = requiredIncludes.length > 0;

    const requiredBlock = hasRequired
      ? `
MANDATORY — reply MUST include ALL of these strings exactly (copy-paste as given):
${requiredIncludes.map((s) => `- ${s}`).join('\n')}
Weave them in naturally (e.g. "chart looking good" + link on new line). Do NOT omit any.
`
      : '';

    const linkRule = hasRequired
      ? '- Links are allowed when listed in MANDATORY above'
      : '- No links unless part of mandatory includes';

    return `
You are a crypto Twitter user. Write a short, natural comment/reply on this tweet.

Tweet from @${tweetAuthor}: "${tweetText}"
${context ? `Context: ${context}` : ''}
${requiredBlock}
Rules:
- 1-2 sentences plus mandatory includes; stay under ${maxLength} characters total
- Reference crypto/blockchain/DeFi/Solana when relevant to the tweet
- Add a genuine opinion or question (not generic praise)
${linkRule}
- No hashtag spam, no "DM me"
- Sound like a real person, casual tone
- Max 1 emoji if it fits

Return ONLY the reply text.
`.trim();
  }

  finalizeReply(text, replyOptions = {}) {
    const { requiredIncludes, maxLength } = this.normalizeReplyOptions(replyOptions);
    let result = (text || '').trim().replace(/^["']|["']$/g, '');

    const missing = requiredIncludes.filter(
      (req) => !result.toLowerCase().includes(String(req).toLowerCase())
    );

    if (missing.length > 0) {
      const suffix = missing.join(' ');
      const sep = result.length > 0 && !result.endsWith('\n') ? '\n' : '';
      result = `${result}${sep}${suffix}`.trim();
      logger.info(`Reply appended required: ${missing.length} item(s)`);
    }

    if (result.length > maxLength) {
      const requiredText = requiredIncludes.join(' ');
      const reserved = requiredText.length + 4;
      if (requiredIncludes.length > 0 && reserved < maxLength) {
        const mainMax = maxLength - reserved;
        result = `${result.slice(0, mainMax).trim()}… ${requiredText}`;
      } else {
        result = result.slice(0, maxLength);
      }
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
          // #region agent log
          fetch('http://127.0.0.1:7338/ingest/9511d480-bf20-4dae-8e27-edbadaf3f9e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6e2746'},body:JSON.stringify({sessionId:'6e2746',location:'ai.js:generateGemini',message:'gemini ok',data:{modelName},timestamp:Date.now(),hypothesisId:'B',runId:'post-fix'})}).catch(()=>{});
          // #endregion
          return text;
        }
      } catch (error) {
        const short = error.message?.slice(0, 120) || String(error);
        failures.push({ modelName, short });
        logger.warn(`Gemini ${modelName}: ${short.slice(0, 100)}`);
        // #region agent log
        fetch('http://127.0.0.1:7338/ingest/9511d480-bf20-4dae-8e27-edbadaf3f9e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6e2746'},body:JSON.stringify({sessionId:'6e2746',location:'ai.js:generateGemini',message:'gemini model fail',data:{modelName,error:short},timestamp:Date.now(),hypothesisId:'B',runId:'post-fix'})}).catch(()=>{});
        // #endregion
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
