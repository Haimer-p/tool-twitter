async function fetchTokenFromDexUrl(dexUrl) {
  const pair = String(dexUrl)
    .replace(/.*\/solana\//i, '')
    .replace(/\/$/, '')
    .trim();
  if (!pair) throw new Error('Invalid DexScreener URL');

  const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
  const json = await res.json();
  const p = json.pair || json.pairs?.[0];
  if (!p) throw new Error('Pair not found on DexScreener');

  const base = p.baseToken || {};
  return {
    dexUrl: p.url || `https://dexscreener.com/solana/${pair}`,
    pairAddress: p.pairAddress || pair,
    symbol: (base.symbol || '').toUpperCase(),
    name: base.name || base.symbol || '',
    mintAddress: base.address || '',
    website: p.info?.websites?.[0]?.url || null,
    twitter: p.info?.socials?.find((s) => s.type === 'twitter')?.url || null,
    priceUsd: p.priceUsd,
    liquidityUsd: p.liquidity?.usd,
  };
}

module.exports = { fetchTokenFromDexUrl };
