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

/** Parse "1,234" / "1.2K" / "10M" / "1.2B" → integer followers */
function parseFollowerCount(text) {
  if (!text) return null;
  const normalized = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '')
    .trim();
  const match = normalized.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return null;

  let num = parseFloat(match[1]);
  if (Number.isNaN(num)) return null;

  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'K') num *= 1000;
  else if (suffix === 'M') num *= 1_000_000;
  else if (suffix === 'B') num *= 1_000_000_000;

  return Math.floor(num);
}

module.exports = { sleep, randomMs, parseTweetId, parseFollowerCount };
