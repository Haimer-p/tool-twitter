function matchesAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function classifyWalletRequest(tweetText, airdropConfig) {
  const {
    evmKeywords,
    solanaKeywords,
    genericKeywords,
    broadKeywords = [],
  } = airdropConfig;

  const hasEvm = matchesAny(tweetText, evmKeywords);
  const hasSolana = matchesAny(tweetText, solanaKeywords);
  const hasGeneric = matchesAny(tweetText, genericKeywords);
  const hasBroad = matchesAny(tweetText, broadKeywords);

  if (hasEvm && hasSolana) return 'both';
  if (hasEvm) return 'evm';
  if (hasSolana) return 'solana';
  if (hasGeneric) return 'both';
  if (hasBroad) return 'both';
  return 'none';
}

function truncateComment(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function buildRuleComments(walletType, config) {
  const { ruleTemplates, maxCommentLength } = config.airdrop;
  const { evm, solana } = config.wallets;

  if (walletType === 'evm') {
    return [truncateComment(ruleTemplates.evm.replace('{address}', evm), maxCommentLength)];
  }
  if (walletType === 'solana') {
    return [
      truncateComment(ruleTemplates.solana.replace('{address}', solana), maxCommentLength),
    ];
  }
  if (walletType === 'both') {
    return [
      truncateComment(ruleTemplates.evm.replace('{address}', evm), maxCommentLength),
      truncateComment(ruleTemplates.solana.replace('{address}', solana), maxCommentLength),
    ];
  }
  return [];
}

module.exports = {
  classifyWalletRequest,
  buildRuleComments,
  matchesAny,
};
