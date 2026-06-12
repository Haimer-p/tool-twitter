const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const REPORT_DIR = path.join(process.cwd(), 'logs', 'health-check');
const LATEST_JSON = path.join(REPORT_DIR, 'latest.json');
const LATEST_TXT = path.join(REPORT_DIR, 'latest-report.txt');

function mark(check) {
  return check?.ok ? 'OK' : 'FAIL';
}

function formatOneResult(r) {
  const c = r.checks || {};
  const lines = [
    '',
    `--- ${r.accountName} [${r.status}] ---`,
    `  Cookie: ${r.accountName}`,
    `  Twitter: ${r.profile?.displayName || '?'} @${r.profile?.username || '?'}`,
    `  Login: ${mark(c.login)}  Search: ${mark(c.search)}  Like: ${mark(c.like)}  RT: ${mark(c.retweet)}  Reply: ${mark(c.reply)}`,
  ];

  if (r.status === 'suspended') {
    lines.push('  Note: Account suspended (session OK)');
  }
  if (c.search?.keyword) {
    lines.push(`  Search keyword: ${c.search.keyword} (${c.search.tweetCount || 0} tweets)`);
  }
  if (c.login?.error) lines.push(`  Login error: ${c.login.error}`);
  if (c.search?.error) lines.push(`  Search error: ${c.search.error}`);
  if (c.like?.error) lines.push(`  Like error: ${c.like.error}`);
  if (c.retweet?.error) lines.push(`  Retweet error: ${c.retweet.error}`);
  if (c.reply?.error) lines.push(`  Reply error: ${c.reply.error}`);
  lines.push(`  Duration: ${Math.round((r.durationMs || 0) / 1000)}s`);

  return lines.join('\n');
}

function buildSummary(results, meta = {}) {
  const alive = results.filter((r) => r.status === 'alive').length;
  const partial = results.filter((r) => r.status === 'partial').length;
  const suspended = results.filter((r) => r.status === 'suspended').length;
  const dead = results.filter((r) => r.status === 'dead').length;

  const header = [
    '=== Health Check Report ===',
    meta.startedAt ? `Started: ${meta.startedAt}` : '',
    meta.completedAt ? `Completed: ${meta.completedAt}` : '',
    meta.keyword ? `Keyword: ${meta.keyword}` : '',
    meta.stoppedEarly ? 'Stopped early: yes' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const body = results.map(formatOneResult).join('\n');
  const footer = `\n=== Summary ===\nAlive: ${alive}  Partial: ${partial}  Suspended: ${suspended}  Dead: ${dead}\n`;

  return `${header}\n${body}${footer}`;
}

function buildStateFromResults(results, meta = {}) {
  const alive = results.filter((r) => r.status === 'alive').length;
  const partial = results.filter((r) => r.status === 'partial').length;
  const suspended = results.filter((r) => r.status === 'suspended').length;
  const dead = results.filter((r) => r.status === 'dead').length;

  return {
    running: false,
    stopping: false,
    stoppedEarly: !!meta.stoppedEarly,
    results,
    startedAt: meta.startedAt || null,
    completedAt: meta.completedAt || new Date().toISOString(),
    summary: { alive, partial, suspended, dead, total: results.length },
    reportText: buildSummary(results, meta),
    savedAt: new Date().toISOString(),
  };
}

async function saveHealthCheckReport(results, meta = {}) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const state = buildStateFromResults(results, meta);
  await fsp.writeFile(LATEST_JSON, JSON.stringify(state, null, 2), 'utf8');
  await fsp.writeFile(LATEST_TXT, state.reportText, 'utf8');

  return {
    state,
    jsonPath: LATEST_JSON,
    txtPath: LATEST_TXT,
  };
}

async function loadHealthCheckReport() {
  try {
    const raw = await fsp.readFile(LATEST_JSON, 'utf8');
    const state = JSON.parse(raw);
    if (!state.reportText && state.results?.length) {
      state.reportText = buildSummary(state.results, {
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        stoppedEarly: state.stoppedEarly,
        keyword: state.keyword,
      });
    }
    return state;
  } catch {
    return null;
  }
}

async function persistHealthCheckResults(database, config, results, meta = {}) {
  const fullMeta = {
    keyword: config?.healthCheck?.keyword,
    ...meta,
  };
  const { state, jsonPath, txtPath } = await saveHealthCheckReport(results, fullMeta);

  if (database?.connected) {
    try {
      await database.saveHealthCheckRun({
        startedAt: fullMeta.startedAt,
        completedAt: fullMeta.completedAt || state.completedAt,
        stoppedEarly: fullMeta.stoppedEarly,
        keyword: fullMeta.keyword,
        summary: state.summary,
        results,
        reportText: state.reportText,
      });
    } catch {
      // DB optional — file report still saved
    }
  }

  return { state, jsonPath, txtPath };
}

module.exports = {
  REPORT_DIR,
  LATEST_JSON,
  LATEST_TXT,
  formatOneResult,
  buildSummary,
  buildStateFromResults,
  saveHealthCheckReport,
  loadHealthCheckReport,
  persistHealthCheckResults,
};
