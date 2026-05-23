const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

class AIService {
  constructor(apiKey, config) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: {
        temperature: config.gemini.temperature,
      },
    });
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
      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
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
}

module.exports = AIService;
