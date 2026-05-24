const fs = require('fs').promises;
const path = require('path');

const CONFIG_FILENAME = 'accounts.config.json';

function defaultProfilesConfig(config) {
  return {
    maxParallel: config.accounts?.maxParallel ?? 3,
    accounts: [],
  };
}

async function loadProfilesConfig(accountsDir, config) {
  const configPath = path.join(accountsDir, CONFIG_FILENAME);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      maxParallel: parsed.maxParallel ?? config.accounts?.maxParallel ?? 3,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return defaultProfilesConfig(config);
  }
}

function resolveKeywords(mode, profileKeywords, globalKeywords, config) {
  if (profileKeywords?.length) return profileKeywords;
  if (globalKeywords?.length) return globalKeywords;
  if (mode === 'airdrop') return config.airdrop.searchKeywords;
  return config.keywords;
}

function buildAccountJobs(accountNames, profilesConfig, globalDefaults, config) {
  const profileMap = new Map(
    profilesConfig.accounts.map((a) => [a.name?.trim(), a]).filter(([name]) => name)
  );

  const jobs = [];
  for (const name of accountNames) {
    const profile = profileMap.get(name) || {};
    if (profile.enabled === false) continue;

    const mode = profile.mode || globalDefaults.mode || 'engage';
    const useAi = profile.useAi ?? globalDefaults.useAi ?? false;
    const keywords = resolveKeywords(
      mode,
      profile.keywords,
      globalDefaults.keywords,
      config
    );

    jobs.push({
      accountName: name,
      mode,
      useAi,
      keywords,
      engageOnReply:
        profile.engageOnReply ??
        globalDefaults.engageOnReply ??
        config.airdrop?.engageOnReply ??
        true,
      followOnReply:
        profile.followOnReply ??
        globalDefaults.followOnReply ??
        config.airdrop?.followOnReply ??
        true,
      minFollowersToFollow:
        profile.minFollowersToFollow ??
        globalDefaults.minFollowersToFollow ??
        config.airdrop?.minFollowersToFollow ??
        config.follow?.minFollowers ??
        1000,
    });
  }

  return jobs;
}

function formatJobsSummary(jobs) {
  return jobs
    .map(
      (j) =>
        `  - ${j.accountName}: ${j.mode}${j.mode === 'airdrop' ? ` (${j.useAi ? 'AI' : 'Rule'}${j.engageOnReply !== false ? ', like+RT' : ''}${j.followOnReply !== false ? '+follow' : ''})` : ''} | keywords: ${j.keywords.slice(0, 3).join(', ')}${j.keywords.length > 3 ? '...' : ''}`
    )
    .join('\n');
}

module.exports = {
  CONFIG_FILENAME,
  loadProfilesConfig,
  buildAccountJobs,
  formatJobsSummary,
};
