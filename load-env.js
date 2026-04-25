const fs = require('fs');
const path = require('path');

function parseEnvValue(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const isQuoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''));

  const unwrapped = isQuoted ? value.slice(1, -1) : value;
  return unwrapped
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = parseEnvValue(match[2]);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

if (!global.__DREKEE_ENV_LOADED__) {
  loadEnvFile(path.join(__dirname, '.env'));
  loadEnvFile(path.join(__dirname, '.env.local'));
  global.__DREKEE_ENV_LOADED__ = true;
}

module.exports = {
  loadEnvFile,
};
