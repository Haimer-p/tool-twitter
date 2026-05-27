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

module.exports = {
  CONFIG_PATH,
  CONFIGS_DIR,
  listConfigFiles,
  resolveConfigPath,
  loadAccountConfig,
  filterAccountsByName,
  resolveAccountProfile,
  deepMerge,
};
