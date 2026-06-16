const { getDb } = require('../../../../lib/db');
const { checkAuth, unauthorized, json, error } = require('../../../../lib/api');
const { fetchTokenFromDexUrl } = require('../../../../lib/dexscreener');
const { generateKeywords, DEFAULT_DELAYS, DEFAULT_INTERACTIONS } = require('../../../../lib/generate-campaign');

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'campaign';
}

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    const body = await request.json();
    const {
      dexUrl,
      accountNames = [],
      defaults = {},
      parallel = { maxConcurrent: accountNames.length || 2 },
      save = true,
    } = body;

    if (!dexUrl) return error('dexUrl required');
    if (!accountNames.length) return error('accountNames required');

    const meta = await fetchTokenFromDexUrl(dexUrl);
    const generated = await generateKeywords(meta, {
      count: body.keywordCount || 60,
      accountNames,
    });

    const accounts = accountNames.map((name) => ({
      name,
      enabled: true,
      keywords: generated.perAccount[name] || [],
      delays: defaults.delays || DEFAULT_DELAYS,
      interactions: {
        ...(defaults.interactions || DEFAULT_INTERACTIONS),
        replyRequiredIncludes: [meta.dexUrl, meta.symbol],
      },
    }));

    const campaignData = {
      slug: body.slug || slugify(meta.symbol),
      dexUrl: meta.dexUrl,
      symbol: meta.symbol,
      name: meta.name,
      mintAddress: meta.mintAddress || '',
      pairAddress: meta.pairAddress || '',
      defaults: {
        keywords: generated.allKeywords,
        delays: defaults.delays || DEFAULT_DELAYS,
        interactions: {
          ...(defaults.interactions || DEFAULT_INTERACTIONS),
          ...(generated.defaults.interactions || {}),
          replyRequiredIncludes: [meta.dexUrl, meta.symbol],
        },
      },
      accounts,
      parallel,
      status: 'draft',
    };

    if (!save) {
      return json({ meta, generated, campaign: campaignData });
    }

    const db = await getDb();
    const all = await db.listCampaigns();
    const normalizedSymbol = String(meta.symbol || '').toUpperCase();
    const normalizedMint = String(meta.mintAddress || '').trim();
    const normalizedPair = String(meta.pairAddress || '').trim();

    const existing =
      all.find((c) => normalizedMint && c.mintAddress && c.mintAddress === normalizedMint) ||
      all.find((c) => normalizedPair && c.pairAddress && c.pairAddress === normalizedPair) ||
      (await db.getCampaignBySlug(campaignData.slug)) ||
      all.find((c) => String(c.symbol || '').toUpperCase() === normalizedSymbol);

    if (existing?._id) {
      const campaign = await db.updateCampaign(existing._id, campaignData);
      return json({ meta, generated, campaign, updated: true });
    }

    const campaign = await db.createCampaign(campaignData);
    return json({ meta, generated, campaign }, 201);
  } catch (e) {
    return error(e.message, 500);
  }
}
