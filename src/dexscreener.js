function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  return [...pairs].sort((a, b) => {
    const liqA = Number(a?.liquidity?.usd) || 0;
    const liqB = Number(b?.liquidity?.usd) || 0;
    if (liqB !== liqA) return liqB - liqA;
    const volA = Number(a?.volume?.h24) || 0;
    const volB = Number(b?.volume?.h24) || 0;
    return volB - volA;
  })[0];
}

function parseDexAddress(dexUrl) {
  const raw = String(dexUrl || '').trim();
  if (!raw) return '';

  const m = raw.match(/dexscreener\.com\/(?:[a-z0-9-]+\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (m?.[1]) return m[1];

  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return raw;

  return raw
    .replace(/.*\/solana\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .trim();
}

function mapPair(p, fallbackAddress = '') {
  const base = p.baseToken || {};
  const pairAddress = p.pairAddress || fallbackAddress;
  return {
    dexUrl: p.url || `https://dexscreener.com/solana/${pairAddress}`,
    pairAddress,
    symbol: (base.symbol || '').toUpperCase(),
    name: base.name || base.symbol || '',
    mintAddress: base.address || '',
    website: p.info?.websites?.[0]?.url || null,
    twitter: p.info?.socials?.find((s) => s.type === 'twitter')?.url || null,
    priceUsd: p.priceUsd,
    liquidityUsd: p.liquidity?.usd,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
  return res.json();
}

async function fetchTokenFromDexUrl(dexUrl) {
  const address = parseDexAddress(dexUrl);
  if (!address) throw new Error('Invalid DexScreener URL');

  try {
    const byPair = await fetchJson(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`
    );
    const p = byPair.pair || pickBestPair(byPair.pairs);
    if (p) return mapPair(p, address);
  } catch {
    /* try next */
  }

  try {
    const byToken = await fetchJson(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`
    );
    const p = pickBestPair(byToken.pairs);
    if (p) return mapPair(p, p.pairAddress);
  } catch {
    /* try next */
  }

  try {
    const bySearch = await fetchJson(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`
    );
    const solPairs = (bySearch.pairs || []).filter((x) => x.chainId === 'solana');
    const p = pickBestPair(solPairs.length ? solPairs : bySearch.pairs);
    if (p) return mapPair(p, p.pairAddress);
  } catch {
    /* fall through */
  }

  throw new Error('Pair not found on DexScreener');
}

module.exports = { fetchTokenFromDexUrl, parseDexAddress, pickBestPair };
