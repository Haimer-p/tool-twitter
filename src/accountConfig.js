const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_PATH = path.join(process.cwd(), 'accounts.config.json');
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

function loadAccountConfig(globalConfig = require('../config')) {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid accounts.config.json: ${error.message}`);
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
    throw new Error('accounts.config.json has no enabled accounts');
  }

  return { accounts, parallel };
}

function filterAccountsByName(profiles, names) {
  if (!names?.length) return profiles;
  const set = new Set(names.map((n) => n.trim()));
  return profiles.filter((p) => set.has(p.name));
}

module.exports = {
  CONFIG_PATH,
  loadAccountConfig,
  filterAccountsByName,
  resolveAccountProfile,
  deepMerge,
};
