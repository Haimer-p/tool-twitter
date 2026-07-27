/**
 * Test Gemini + DeepSeek AI providers (no browser required).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = require('../config');
const AIService = require('../src/ai');
const { parseGeminiKeysFromEnv, getGeminiKeyPool } = require('../src/geminiKeyPool');

const SAMPLE_TWEET = 'Bitcoin just broke $100k! The bull run is finally here.';
const SAMPLE_AUTHOR = 'cryptotrader';

async function testStrategy(strategy, label) {
  process.env.AI_STRATEGY = strategy;
  const ai = new AIService(config);
  console.log(`\n--- ${label} (strategy=${strategy}) ---`);

  const reply = await ai.generateReply(SAMPLE_TWEET, SAMPLE_AUTHOR);
  console.log(`Reply (${reply.length} chars): ${reply.substring(0, 120)}${reply.length > 120 ? '...' : ''}`);
  return reply;
}

async function main() {
  const geminiKeys = parseGeminiKeysFromEnv();
  const hasGemini = geminiKeys.length > 0;
  const hasDeepseek = !!process.env.DEEPSEEK_API_KEY;

  console.log('=== AI Provider Test ===');
  console.log(`Gemini keys: ${hasGemini ? geminiKeys.length : 'MISSING'}`);
  if (hasGemini) {
    const status = getGeminiKeyPool().getStatus();
    console.log(`Gemini pool: ${status.available}/${status.total} available (reset ${status.resetDate})`);
  }
  console.log(`DeepSeek key: ${hasDeepseek ? 'OK' : 'MISSING'}`);

  if (!hasGemini && !hasDeepseek) {
    console.error('Need GEMINI_API_KEY / GEMINI_API_KEYS or DEEPSEEK_API_KEY in .env');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  if (hasGemini && hasDeepseek) {
    try {
      process.env.AI_STRATEGY = 'alternate';
      const aiAlt = new AIService(config);
      console.log('\n--- Alternate #1 ---');
      await aiAlt.generateReply(SAMPLE_TWEET, SAMPLE_AUTHOR);
      console.log('\n--- Alternate #2 ---');
      await aiAlt.generateReply(SAMPLE_TWEET, SAMPLE_AUTHOR);
      passed += 2;
    } catch (e) {
      console.error(`FAIL alternate: ${e.message}`);
      failed += 2;
    }
  }

  if (hasGemini) {
    try {
      await testStrategy('gemini', 'Gemini only');
      passed++;
    } catch (e) {
      console.error(`FAIL gemini: ${e.message}`);
      failed++;
    }
  }

  if (hasDeepseek) {
    try {
      await testStrategy('deepseek', 'DeepSeek only');
      passed++;
    } catch (e) {
      console.error(`FAIL deepseek: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
