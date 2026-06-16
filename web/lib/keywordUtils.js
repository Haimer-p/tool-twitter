const CORE_GENERIC = [
  'web3',
  'blockchain',
  'crypto',
  'solana',
  'solana meme',
  'pump fun',
  'memecoin',
  'dexscreener',
  'trending',
  'gem',
  'alpha',
  'CT',
  'send it',
  'fresh launch',
  'still early',
];

function buildCoreKeywords(meta) {
  const sym = meta.symbol || '';
  const slug = sym.toLowerCase();
  const name = meta.name || sym;
  const pair = (meta.pairAddress || '').toLowerCase();
  const mint = meta.mintAddress || '';

  return [
    sym,
    `$${sym}`,
    name,
    name.toLowerCase(),
    `${sym} solana`,
    `${sym} pump fun`,
    `${sym} dexscreener`,
    `${sym} trending`,
    `${sym} chart`,
    `${sym} gem`,
    `${sym} moon`,
    `${sym} raid`,
    `${sym} alpha`,
    `buy ${sym}`,
    `${sym} community`,
    `${sym} memecoin`,
    `${sym} send it`,
    `${sym} pumpswap`,
    `${sym} fresh launch`,
    `${sym} still early`,
    pair,
    mint,
    meta.dexUrl,
    meta.website,
    meta.twitter ? meta.twitter.replace(/.*\//, '') : null,
    slug,
    `${slug} meme`,
    `${slug} solana`,
    `${slug} token`,
    ...CORE_GENERIC,
  ].filter(Boolean);
}

function distributeKeywords(allKeywords, accountNames) {
  const unique = [...new Set(allKeywords.map((k) => String(k).trim()).filter(Boolean))];
  const names = accountNames.filter(Boolean);
  if (!names.length) return {};

  const perAccount = Math.max(1, Math.ceil(unique.length / names.length));
  const map = {};
  names.forEach((name, i) => {
    const slice = unique.slice(i * perAccount, (i + 1) * perAccount);
    map[name] = [...new Set(slice)];
  });
  return map;
}

function parseKeywordLines(text) {
  return String(text || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  CORE_GENERIC,
  buildCoreKeywords,
  distributeKeywords,
  parseKeywordLines,
};
