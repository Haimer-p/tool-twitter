function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomMs(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function parseTweetId(url) {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Parse "1,234" / "1.2K" / "10M" / "1,2 N" → number */
function parseSocialCount(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw)
    .trim()
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/followers?|following|ngườitheodõi/gi, '');
  const m = s.match(/^([\d.]+)\s*([KkMmBb])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  return Math.floor(n);
}

module.exports = { sleep, randomMs, parseTweetId, parseSocialCount };
