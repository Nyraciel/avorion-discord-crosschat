'use strict';

// Copying a key from a web page easily drags a space or a line break along.
// That cost an evening on 18.09.2026 (Pelican answered HTTP 401), so every
// string in the configuration is trimmed before it is used.
function trimStrings(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimStrings);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimStrings(v);
    return out;
  }
  return value;
}

// Everything that belongs to THIS installation - keys, ids and paths - can
// live in its own file and is laid over the configuration at startup.
//
// The point is updating: a new version brings a new config.example.json with
// new settings in it. Without this, every update means finding your token,
// your server id and your galaxy path in the old file and typing them into
// the new one. With it, the new example can simply be taken over and nothing
// personal is lost. Asked for on 20.09.2026.
//
// Deep, not flat: "ai": { "apiKey": "..." } in the secrets must not wipe out
// the rest of the "ai" block in the configuration. Arrays are replaced
// whole - a list of admin ids is one decision, not a pile to merge.
function mergeSecrets(config, secrets) {
  if (secrets === undefined || secrets === null) return config;
  if (Array.isArray(secrets) || typeof secrets !== 'object') return secrets;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ...secrets };
  const out = { ...config };
  for (const [k, v] of Object.entries(secrets)) {
    out[k] = mergeSecrets(config[k], v);
  }
  return out;
}

// What the secrets file may set. Anything else in it is a typo, and a typo
// that is silently ignored is a lost evening - so it is named out loud.
// A key starting with an underscore is a comment and is left alone; the
// example file carries one.
function strayKeys(secrets, config) {
  const out = [];
  const walk = (s, c, prefix) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    for (const [k, v] of Object.entries(s)) {
      if (k.startsWith('_')) continue; // a comment, not a setting
      const path = prefix ? `${prefix}.${k}` : k;
      if (!c || !(k in c)) { out.push(path); continue; }
      walk(v, c[k], path);
    }
  };
  walk(secrets, config, '');
  return out;
}

// A text that lives in its own file instead of in the configuration: the
// persona of the chat companion, and anything else that is a paragraph
// rather than a setting. The file wins when it is there; the value from the
// configuration stays as the fallback, so nothing breaks for someone who
// never makes one.
//
// Comment lines starting with # are for the reader of the file, not for the
// model, and are dropped. An empty file counts as no file - better the
// fallback than a companion with no character at all.
function textFromFile({ fs, file, fallback = '', log = () => {}, what = 'text' }) {
  if (!file) return fallback;
  try {
    if (!fs.existsSync(file)) return fallback;
    const text = String(fs.readFileSync(file, 'utf8'))
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
      .trim();
    if (!text) { log(`${what}: ${file} is empty, using the one from config.json`); return fallback; }
    log(`${what}: ${text.length} characters from ${file}`);
    return text;
  } catch (err) {
    log(`${what}: ${file} not readable (${err.message}), using the one from config.json`);
    return fallback;
  }
}

module.exports = { trimStrings, mergeSecrets, strayKeys, textFromFile };
