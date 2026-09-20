'use strict';

// Run this before pushing. It refuses if anything private is in the folder.
//
//   node tools/prepublish-check.js
//
// Until 20.09.2026 this folder was GENERATED: a script copied a fixed list of
// files into it and searched every line for keys before anything went out.
// Now the folder is worked in directly, so that net is gone - and a net that
// is gone is exactly how a token ends up on the internet. This replaces it
// with a check that costs one second and exits non-zero when it finds
// something.
//
// The rule behind it, decided 20.09.2026: THIS FOLDER NEVER HOLDS REAL
// SECRETS. Not a config.json, not a secrets.json, not the quote collection.
// Only the .example files. The bridge is RUN from a copy elsewhere, with the
// real files there. That way a mistake in .gitignore cannot cost anything,
// because there is nothing here to leak.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Files that must never lie here, even for a minute. These are the names the
// bridge reads at runtime - their presence means somebody ran the bridge from
// the repository folder instead of from their own copy.
const FORBIDDEN_FILES = [
  'config.json',
  'config.json.bak',
  'secrets.json',
  'chat-commands.json',
  'quotes.json',
  'persona.md',
  'server-facts.md',
  'mod-facts.md',
];

// Whole folders that have no business in a repository.
const FORBIDDEN_DIRS = ['test/fixtures'];

// Never in the repository, whatever anyone says. The patterns come from what
// was really found on 20.09.2026: server logs with other people's chat, a
// player's Steam id in a test, and a live Discord invite.
// Rule 19 of this project's working rules: a published file talks about the
// program, not about how the program came to be. No author's name, no
// mention of the test suite, no path from somebody's disk, no note about
// where a decision was discussed. The REASON for a line stays welcome -
// "asked for on 20.09.2026" is right and useful. WHERE it was asked is not.
const INTERNAL = [
  ['the test suite', /\b(counter\.sh|harness|dry run)\b/i],
  ['a note about the machine it was built on', /\bthis machine\b/i],
  ['a transcript file', /\.jsonl\b/],
  ['a private folder', /\b(SteamLibrary|twitchbot)\b/i],
];

// Rule 6: everything a stranger reads is English. Only words that cannot be
// English are listed - "die", "an", "in", "man", "so" and "war" are ordinary
// English and would fire on honest lines.
const GERMAN = /\b(und|oder|nicht|ist|sind|wird|werden|wenn|dann|aber|auch|noch|schon|hier|kein|keine|eine|einen|einem|eines|fuer|ueber|mehr|sehr|immer|nach|aus|ohne|durch|gegen|zwischen|weil|dass|soll|muss|kann|darf|nur|sich|ihre|seine|diese[rs]?|wurde|haben|hat|waren|beim|zum|zur|vom|dem|den|des)\b/i;

const NEVER = [
  ['a Pelican or Pterodactyl key', /\b(pacc|papp|ptlc|ptla)_[A-Za-z0-9]{8,}/],
  ['a Discord bot token', /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}\b/],
  ['a Discord invite', /discord\.gg\//],
  ['a Steam id', /\b7656119(?!0000000)[0-9]{9,10}\b/],
  ['an 18-digit Discord id', /(?<![0-9])[0-9]{18}(?![0-9])/],
  ['a Windows user folder', /C:\\+Users\\+(?!<|DU|you)[A-Za-z0-9]/i],
];

// .gitignore is the second line of defence. If a line disappears from it, the
// check says so - silently losing one is how this goes wrong months later.
const GITIGNORE_MUST_HAVE = ['node_modules/', ...FORBIDDEN_FILES];

// Only what git would actually publish. Everything in .gitignore - the test
// suite, node_modules, your own config - is none of this check's business,
// and walking it anyway produced 229 false alarms on the first run.
function publishedFiles() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const list = out.split('\n').map((l) => l.trim()).filter(Boolean);
    if (list.length) return list;
  } catch { /* no git, or not a repository yet - fall back to the walk */ }
  return null;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);
const BINARY = /\.(png|jpe?g|gif|zip|ico|pdf|woff2?)$/i;

// Words that must not appear, kept OUT of this file on purpose: writing the
// author's name into the checker would be the very breach it looks for. Put
// them in .private-words, one per line, which .gitignore keeps out of the
// repository. Names, account handles, the Windows user name. No file, no
// check - that is a deliberate blind spot, not an oversight.
function privateWords() {
  const p = path.join(root, '.private-words');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
const PRIVATE = privateWords();

const SELF = 'tools/prepublish-check.js';
const problems = [];

// One file, by its path relative to the folder.
function check(here) {
  const full = path.join(root, here);
  const name = path.basename(here);
  if (FORBIDDEN_DIRS.some((d) => here === d || here.startsWith(`${d}/`))) {
    problems.push(`${here} must not be in the repository`);
    return;
  }
  if (FORBIDDEN_FILES.includes(here)) {
    problems.push(`${here} is a live file of your own installation - it belongs in the copy you run, not here`);
    return;
  }
  if (/\.log$/i.test(here)) { problems.push(`${here} is a log - logs hold other people's chat`); return; }
  if (/^serverlog.*\.txt$/i.test(name)) { problems.push(`${here} is a server log`); return; }
  if (BINARY.test(name)) return;
  if (here === SELF) return; // this file holds the patterns; it is not a breach of them
  if (here === '.private-words') return; // the list of names is the check, not a breach of it
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (err) { problems.push(`${here} not readable: ${err.message}`); return; }
  text.split('\n').forEach((line, i) => {
    for (const [what, re] of NEVER) {
      if (re.test(line)) problems.push(`${here}:${i + 1} looks like ${what}: ${line.trim().slice(0, 80)}`);
    }
    for (const [what, re] of INTERNAL) {
      if (re.test(line)) problems.push(`${here}:${i + 1} names ${what}: ${line.trim().slice(0, 80)}`);
    }
    if (GERMAN.test(line)) problems.push(`${here}:${i + 1} is not English: ${line.trim().slice(0, 80)}`);
    // The licence has to name a copyright holder - that is what the file is
    // for, and the only place a real name belongs.
    if (here === 'LICENSE') return;
    for (const word of PRIVATE) {
      if (line.toLowerCase().includes(word.toLowerCase())) {
        problems.push(`${here}:${i + 1} names a person or account from .private-words`);
      }
    }
  });
}

// Fallback for a folder that is not a git repository yet. It has to honour
// .gitignore itself, or it complains about the very files that are kept out
// on purpose.
function ignoredPaths() {
  const p = path.join(root, '.gitignore');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/\/+$/, ''));
}
const IGNORED = ignoredPaths();
const isIgnored = (rel) => IGNORED.some((e) => rel === e || rel.startsWith(`${e}/`));

function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    const here = rel ? `${rel}/${name}` : name;
    if (isIgnored(here)) continue;
    if (fs.statSync(path.join(dir, name)).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(path.join(dir, name), here);
      continue;
    }
    check(here);
  }
}

// The live files are looked for DIRECTLY, not in the list of what git would
// publish - .gitignore keeps them out of a commit, and that is exactly the
// single point of failure this rule exists to avoid. One edit to .gitignore
// and a token would be one `git add -f` away. Caught 20.09.2026 while
// testing this file: a planted secrets.json went unreported.
for (const f of FORBIDDEN_FILES) {
  if (fs.existsSync(path.join(root, f))) {
    problems.push(`${f} is here - this folder never holds live files, whatever .gitignore says`);
  }
}
for (const d of FORBIDDEN_DIRS) {
  if (fs.existsSync(path.join(root, d))) problems.push(`${d} must not be in this folder`);
}

const fromGit = publishedFiles();
if (fromGit) {
  for (const rel of fromGit) check(rel);
} else {
  walk(root);
}

// The identity that will sign the commits. On 20.09.2026 a push went out
// carrying a real private address in the commit data - a file check cannot
// catch that, because it is not in a file. So it is checked here, before
// anything is committed, and a wrong one stops the run.
//
// GitHub hands out an address of the form 12345678+name@users.noreply.github.com
// under Settings -> Emails. Anything else is refused: a private address in a
// commit cannot be taken back once it is pushed.
const NOREPLY = /@users\.noreply\.github\.com$/i;

function gitIdentity() {
  try {
    const { execFileSync } = require('child_process');
    const get = (key) => execFileSync('git', ['config', '--get', key], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { name: get('user.name'), email: get('user.email') };
  } catch {
    return null;
  }
}

const who = gitIdentity();
if (!who || !who.email) {
  problems.push('git has no user.email set - every commit would carry whatever git picks by itself');
} else if (!NOREPLY.test(who.email)) {
  problems.push(`git user.email is a real address and would be public on every commit: set the @users.noreply.github.com one from GitHub Settings -> Emails`);
} else {
  console.log(`commit identity: ${who.name || '(no name set)'}, address is the noreply one`);
}

const ignorePath = path.join(root, '.gitignore');
if (!fs.existsSync(ignorePath)) {
  problems.push('.gitignore is missing');
} else {
  const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/).map((l) => l.trim());
  for (const want of GITIGNORE_MUST_HAVE) {
    if (!lines.includes(want)) problems.push(`.gitignore no longer lists ${want}`);
  }
}

if (problems.length) {
  console.error(`NOT ready to publish, ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nNothing was changed. Fix these, then run the check again.');
  process.exit(1);
}
console.log('ready to publish: no keys, no tokens, no invites, no Steam ids, no private paths, no live files');
