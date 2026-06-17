const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_PATH = path.join(process.cwd(), 'accounts.config.json');
const CONFIGS_DIR = path.join(process.cwd(), 'configs');
const ACCOUNTS_DIR = path.join(process.cwd(), 'accounts');

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return target;
  }
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] || {}, val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

function resolveAccountProfile(rawAccount, defaults, globalConfig) {
  const merged = deepMerge(
    {
      name: rawAccount.name,
      enabled: rawAccount.enabled !== false,
      keywords: defaults.keywords || globalConfig.keywords,
      delays: deepMerge(globalConfig.delays, defaults.delays || {}),
      interactions: deepMerge(globalConfig.interactions, defaults.interactions || {}),
    },
    {
      keywords: rawAccount.keywords,
      delays: rawAccount.delays,
      interactions: rawAccount.interactions,
      enabled: rawAccount.enabled,
    }
  );

  merged.name = rawAccount.name;
  return merged;
}

function listConfigFiles() {
  const files = [];
  if (fs.existsSync(CONFIGS_DIR)) {
    for (const file of fs.readdirSync(CONFIGS_DIR)) {
      if (!file.endsWith('.json')) continue;
      files.push(path.join(CONFIGS_DIR, file));
    }
  }
  if (fs.existsSync(CONFIG_PATH)) {
    files.push(CONFIG_PATH);
  }
  // preserve order: configs/* first, then accounts.config.json
  return Array.from(new Set(files));
}

function resolveConfigPath(configFile) {
  if (!configFile) return CONFIG_PATH;
  if (path.isAbsolute(configFile)) return configFile;

  const normalized = configFile.replace(/\\/g, '/');
  if (normalized.startsWith('configs/')) {
    return path.join(process.cwd(), normalized);
  }
  if (normalized.endsWith('.json')) {
    return path.join(CONFIGS_DIR, normalized);
  }
  return path.join(CONFIGS_DIR, `${normalized}.json`);
}

function readConfigJson(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    const fileName = path.basename(configPath);
    throw new Error(`Invalid ${fileName}: ${error.message}`);
  }
}

function loadAccountConfig(globalConfig = require('../config'), options = {}) {
  const configPath = resolveConfigPath(options.configFile);
  const raw = readConfigJson(configPath);
  if (!raw) {
    return null;
  }

  const defaults = raw.defaults || {};
  const parallel = {
    maxConcurrent:
      raw.parallel?.maxConcurrent ??
      globalConfig.parallel?.maxConcurrent ??
      2,
  };

  const accounts = (raw.accounts || [])
    .filter((acc) => acc.name)
    .map((acc) => resolveAccountProfile(acc, defaults, globalConfig))
    .filter((acc) => acc.enabled !== false);

  for (const acc of accounts) {
    const cookiePath = path.join(ACCOUNTS_DIR, `${acc.name}.json`);
    if (!fs.existsSync(cookiePath)) {
      logger.warn(`${acc.name}: cookie file not found at accounts/${acc.name}.json`);
    }
  }

  if (accounts.length === 0) {
    throw new Error(`${path.basename(configPath)} has no enabled accounts`);
  }

  return {
    accounts,
    parallel,
    sourcePath: configPath,
    sourceName: path.basename(configPath),
  };
}

function filterAccountsByName(profiles, names) {
  if (!names?.length) return profiles;
  const set = new Set(names.map((n) => n.trim()));
  return profiles.filter((p) => set.has(p.name));
}

function loadCampaignFromDb(database, campaignId, globalConfig = require('../config')) {
  if (!database?.connected) return null;
  return database.getCampaign(campaignId).then((raw) => {
    if (!raw) return null;

    const defaults = raw.defaults || {};
    const parallel = {
      maxConcurrent:
        raw.parallel?.maxConcurrent ??
        globalConfig.parallel?.maxConcurrent ??
        2,
    };

    const accounts = (raw.accounts || [])
      .filter((acc) => acc.name)
      .map((acc) =>
        resolveAccountProfile(
          { ...acc, enabled: acc.enabled !== false },
          defaults,
          globalConfig
        )
      )
      .filter((acc) => acc.enabled !== false);

    if (accounts.length === 0) {
      throw new Error(`Campaign ${raw.slug} has no enabled accounts`);
    }

    return {
      accounts,
      parallel,
      sourcePath: null,
      sourceName: raw.slug,
      campaignId: String(raw._id),
      campaign: raw,
    };
  });
}

async function loadCampaignFromDbAsync(database, campaignId, globalConfig) {
  return loadCampaignFromDb(database, campaignId, globalConfig);
}

function configFileRelativePath(configPath) {
  const rel = path.relative(process.cwd(), configPath).replace(/\\/g, '/');
  return rel.startsWith('configs/') ? rel : `configs/${path.basename(configPath)}`;
}

function summarizeConfigFile(configFile, globalConfig = require('../config')) {
  const configPath = resolveConfigPath(configFile);
  const raw = readConfigJson(configPath);
  if (!raw) return null;
  const names = (raw.accounts || [])
    .filter((a) => a.name && a.enabled !== false)
    .map((a) => a.name);
  return {
    type: 'file',
    name: path.basename(configPath),
    path: configFileRelativePath(configPath),
    accountCount: names.length,
    accounts: names,
  };
}

function listConfigSummaries(globalConfig = require('../config')) {
  return listConfigFiles()
    .map((abs) => summarizeConfigFile(configFileRelativePath(abs), globalConfig))
    .filter(Boolean);
}

async function resolveBatchProfiles(
  database,
  globalConfig,
  { campaignIds = [], configFiles = [], accountNames = [] } = {}
) {
  const ids = [...new Set((campaignIds || []).map(String).filter(Boolean))];
  const files = [...new Set((configFiles || []).map(String).filter(Boolean))];

  if (!ids.length && !files.length) {
    throw new Error('At least one campaignId or configFile required');
  }

  const sources = [];

  for (const id of ids) {
    const loaded = await loadCampaignFromDb(database, id, globalConfig);
    if (!loaded) throw new Error(`Campaign not found: ${id}`);
    sources.push({
      type: 'campaign',
      name: loaded.sourceName,
      campaignId: loaded.campaignId,
      accounts: loaded.accounts,
      parallel: loaded.parallel,
    });
  }

  for (const file of files) {
    const loaded = loadAccountConfig(globalConfig, { configFile: file });
    if (!loaded) throw new Error(`Config not found: ${file}`);
    sources.push({
      type: 'file',
      name: loaded.sourceName,
      path: configFileRelativePath(loaded.sourcePath),
      accounts: loaded.accounts,
      parallel: loaded.parallel,
    });
  }

  const seen = new Map();
  const duplicates = [];

  for (const src of sources) {
    for (const acc of src.accounts) {
      const key = acc.name;
      if (seen.has(key)) {
        duplicates.push({ account: key, sources: [seen.get(key), src.name] });
      } else {
        seen.set(key, src.name);
      }
    }
  }

  if (duplicates.length) {
    const detail = duplicates
      .map((d) => `${d.account} (${d.sources.join(' + ')})`)
      .join(', ');
    throw new Error(`Duplicate accounts across configs: ${detail}`);
  }

  let profiles = sources.flatMap((src) =>
    src.accounts.map((acc) => ({
      ...acc,
      _source: src.name,
      _sourceType: src.type,
    }))
  );

  if (accountNames?.length) {
    profiles = filterAccountsByName(profiles, accountNames);
  }

  if (!profiles.length) {
    throw new Error('No accounts to run after batch merge');
  }

  const activeSources = sources.map((s) => ({
    type: s.type,
    name: s.name,
    path: s.path || null,
    campaignId: s.campaignId || null,
    accountCount: s.accounts.length,
  }));

  const defaultMax = parseInt(process.env.MAX_PARALLEL_ACCOUNTS || '2', 10);

  return {
    profiles,
    sources: activeSources,
    totalAccounts: profiles.length,
    suggestedMaxConcurrent: Math.min(defaultMax, profiles.length),
  };
}

module.exports = {
  CONFIG_PATH,
  CONFIGS_DIR,
  listConfigFiles,
  listConfigSummaries,
  summarizeConfigFile,
  configFileRelativePath,
  resolveConfigPath,
  loadAccountConfig,
  loadCampaignFromDb: loadCampaignFromDbAsync,
  resolveBatchProfiles,
  filterAccountsByName,
  resolveAccountProfile,
  deepMerge,
};
