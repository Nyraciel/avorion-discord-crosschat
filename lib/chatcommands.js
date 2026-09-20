'use strict';

// Fun commands in the game chat: !hug, !love, !8ball, plus whatever stands in
// chat-commands.json. Text only: nothing here touches the game, nothing costs
// money, nothing calls a model - a template and a random number.
//
// The file holds two kinds of entry, told apart by the key:
//   "!discord": "..."   a command, triggered by exactly that word with the !
//   "meow": "Meow"      an echo, triggered when somebody just says meow
//   "!slap": false      switched off, even a built-in one
//
// and one reserved key at the top, the switchboard:
//
//   "_enabled": { "!hug": true, "!slap": false }
//
// It does two jobs at once: it lists the built-in commands, which are in the
// code and would otherwise be invisible here, and it switches any of them on
// or off. Asked for on 20.09.2026, after looking for !slap in this file and
// not finding it.
//
// Switching off belongs here and not in the configuration because this file
// is re-read while running: the command is gone within five seconds, without
// a restart. "_enabled" starts with an underscore on purpose - a key like
// that was never allowed before, so no existing file can collide with it.
//
// Deliberately NOT in here:
//  - commands that change something in the game. Every line this bridge sends
//    leaves as /run with full admin rights; a command that does more than talk
//    hangs on that same lever.
//  - adding commands from the chat (!addcmd). An Avorion chat line carries the
//    player name and nothing else, no role, so the bridge cannot tell an admin
//    from someone calling themselves one. The table is a file instead, and it
//    is re-read while running, so no restart is needed.
//
// Everything that decides behaviour is injected, so the tests run without a
// server, without a clock and without randomness.

// Used when the file has no own list under "!8ball".
const DEFAULT_8BALL = [
  'Yes.',
  'No.',
  'Obviously.',
  'Not a chance.',
  'Ask again when it matters.',
  'The data is inconclusive. So am I.',
  'Certainly. I would not lie about something this trivial.',
  'That would require you to be lucky.',
  'Probably. Do not build anything on it.',
  'I would say yes, but you would misread it.',
];

const BUILTINS = ['!hug', '!love', '!slap', '!duel', '!8ball', '!commands'];

// The reserved key that holds the switches.
const SWITCHES = '_enabled';

// How often a slap crits. A fifth of the time is often enough to be worth
// waiting for and rare enough to still be funny.
const DEFAULT_CRIT_CHANCE = 0.05;

// An echo fires when the whole line is that one word - also when it is
// repeated and whatever punctuation hangs off it: "meow", "Meow!", "meow
// meow meow". Two different words are a sentence, and a sentence is not an
// echo.
const NOT_A_LETTER = /[^\p{L}\p{N}]+/gu;
function echoWord(line) {
  const words = String(line).toLowerCase().split(NOT_A_LETTER).filter(Boolean);
  if (!words.length) return null;
  return words.every((w) => w === words[0]) ? words[0] : null;
}

// A target is a player name someone typed. It ends up inside a Lua string, so
// it cannot break anything - this only keeps the line from getting silly.
function cleanTarget(raw) {
  return String(raw).replace(/^@+/, '').replace(/[<>]/g, '').trim().slice(0, 32);
}

function createChatCommands({
  config = {},
  sendChat,
  // Commands that belong to somebody else but should still be in the list.
  // !ai is the chat companion's (lib/ai.js) and only exists when it is on.
  extraCommands = [],
  // Commands that another module answers, e.g. !quote from lib/quotes.js.
  // [{ commands: ['!quote'], run: ({ cmd, user, rest, isAdmin }) => text|null }]
  // They run through the same cooldowns and the same "handled" rule as the
  // rest, so one command cannot be spammed through a second door.
  handlers = [],
  log = () => {},
  loadTable = () => ({}),
  random = Math.random,
  now = () => Date.now(),
}) {
  const botName = config.botName || 'Bot';
  const perPlayerMs = (config.cooldownSeconds === undefined ? 10 : config.cooldownSeconds) * 1000;
  const globalMs = (config.globalCooldownSeconds === undefined ? 3 : config.globalCooldownSeconds) * 1000;
  const critChance = config.critChance === undefined ? DEFAULT_CRIT_CHANCE : config.critChance;
  const lastPerPlayer = new Map();
  let lastAny = null;

  const pick = (list) => list[Math.floor(random() * list.length)];
  const handlerFor = (cmd) => handlers.find((h) => (h.commands || []).includes(cmd)) || null;
  // Off when the switchboard says so, or when the entry itself is false.
  const switchedOff = (table, key) => {
    const sw = table[SWITCHES];
    return (sw && sw[key] === false) || table[key] === false;
  };

  function hug(user, target) {
    const s = Math.floor(random() * 100) + 1;
    const flavor = s >= 90 ? ' - bone-crushing!' : s <= 10 ? ' - barely a pat' : '';
    return `${user} hugs ${target} with a strength of ${s}%${flavor}`;
  }

  // 0 to 100 per cent, and now and then twice that. A zero is a miss - the
  // funniest outcome should not read like a rounding error. The unit is
  // damage, not strength: strength belongs to !hug, and a slap that reads
  // like a combat log is the better joke in a game about shooting things.
  function slap(user, target) {
    const p = Math.floor(random() * 101);
    const crit = random() < critChance;
    if (crit) return `${user} slaps ${target} for ${p * 2}% damage - CRITICAL HIT!`;
    if (p === 0) return `${user} swings at ${target} and misses completely`;
    const flavor = p >= 90 ? ' - that will leave a mark' : p <= 10 ? ' - barely a tap' : '';
    return `${user} slaps ${target} for ${p}% damage${flavor}`;
  }

  // Two rolls against each other. Nothing happens in the game, it is a
  // number and a sentence - but it takes two people, which is more than
  // every other command here manages.
  function duel(user, target) {
    const a = Math.floor(random() * 101);
    const b = Math.floor(random() * 101);
    if (a === b) return `${user} and ${target} fight to a draw, ${a} to ${b}`;
    const winner = a > b ? user : target;
    return `${user} challenges ${target} - ${a} to ${b}, ${winner} wins`;
  }

  function love(user, target) {
    const p = Math.floor(random() * 101);
    const flavor = p >= 90 ? ' - get a room' : p <= 10 ? ' - awkward' : '';
    return `${user} and ${target}: ${p}% love${flavor}`;
  }

  // The answer for one command, or null when there is nothing to say.
  function answer(cmd, user, rest, table, opts = {}) {
    const own = table[cmd];

    const handler = handlerFor(cmd);
    if (handler) return handler.run({ cmd, user, rest, isAdmin: opts.isAdmin === true });

    if (cmd === '!hug' || cmd === '!love' || cmd === '!slap' || cmd === '!duel') {
      const target = cleanTarget(rest);
      if (!target) return `${user}: who? Use ${cmd} <name>`;
      if (cmd === '!hug') return hug(user, target);
      if (cmd === '!slap') return slap(user, target);
      if (cmd === '!duel') return duel(user, target);
      return love(user, target);
    }
    if (cmd === '!8ball') {
      const list = Array.isArray(own) && own.length ? own : DEFAULT_8BALL;
      if (!rest.trim()) return `${user}: ask something, then I shake the ball.`;
      return `${user}: ${pick(list)}`;
    }
    if (cmd === '!commands') {
      // Only real commands. Echo words are a gimmick of the chat companion,
      // not something anybody should have to look up in a list.
      const fromFile = Object.keys(table).filter((k) => k.startsWith('!'));
      const all = [...new Set([...BUILTINS, ...extraCommands, ...fromFile])]
        .filter((k) => !switchedOff(table, k)) // what is off is not advertised
        .sort();
      return `Commands: ${all.join(' ')}`;
    }
    return fromTable(own, user, rest);
  }

  // An entry from the file: one text, or a list to pick from.
  function fromTable(entry, user, rest) {
    const text = typeof entry === 'string' ? entry : (Array.isArray(entry) && entry.length ? pick(entry) : null);
    if (text === null) return null;
    return text.replace(/\{user\}/g, user).replace(/\{target\}/g, cleanTarget(rest) || user);
  }

  // Returns { handled } - handled means the line was a command or an echo, so
  // nothing else should look at it any more (the chat companion in particular).
  function onChat(speaker, text, opts = {}) {
    const isAdmin = opts.isAdmin === true;
    if (!sendChat) return { handled: false };
    if (String(speaker).toLowerCase() === botName.toLowerCase()) return { handled: false }; // our own line
    const line = String(text).trim();
    const table = loadTable() || {};

    if (line.startsWith('!')) {
      const space = line.search(/\s/);
      const cmd = (space === -1 ? line : line.slice(0, space)).toLowerCase();
      const rest = space === -1 ? '' : line.slice(space + 1);
      // Switched off in the file. Counts for the built-in ones too, and the
      // line goes on its way as if the command had never existed.
      if (switchedOff(table, cmd)) return { handled: false };
      if (!BUILTINS.includes(cmd) && !handlerFor(cmd) && table[cmd] === undefined) return { handled: false };
      return say(speaker, cmd, () => answer(cmd, String(speaker), rest, table, { isAdmin }), isAdmin);
    }

    const word = echoWord(line);
    if (word === null) return { handled: false };
    // The word itself, or a word that BEGINS with an echo key: "meowtest"
    // and "meowww" answer like "meow" (19.09.2026). Only at the start, so
    // "homeowner" stays quiet. The longest key wins, so a longer echo word
    // is not swallowed by a shorter one.
    if (switchedOff(table, word)) return { handled: false };
    const key = table[word] !== undefined
      ? word
      : Object.keys(table)
        .filter((k) => !k.startsWith('!') && !switchedOff(table, k) && k.length > 1 && word.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { handled: false };
    return say(speaker, key, () => fromTable(table[key], String(speaker), ''));
  }

  // Cooldowns and sending, the same for commands and echoes. The text is
  // only produced once the brakes have let it through, so a swallowed line
  // does not roll dice for nothing.
  function say(speaker, what, makeReply, skipCooldown = false) {
    const t = now();
    if (!skipCooldown && lastAny !== null && t - lastAny < globalMs) {
      log(`${what} from ${speaker}: too soon after the last one`);
      return { handled: true, reason: 'global cooldown' };
    }
    const last = lastPerPlayer.get(String(speaker).toLowerCase());
    if (!skipCooldown && last !== undefined && t - last < perPlayerMs) {
      log(`${what} from ${speaker}: player cooldown`);
      return { handled: true, reason: 'player cooldown' };
    }

    const reply = makeReply();
    if (reply === null) return { handled: false };

    // An answer the bridge has to ask the server for (!online) arrives late.
    // The brakes are applied straight away - otherwise the same question
    // could be asked ten times while the first answer is still on its way.
    if (reply && typeof reply.then === 'function') {
      lastAny = t;
      lastPerPlayer.set(String(speaker).toLowerCase(), t);
      reply.then((text) => {
        if (!text) return;
        log(`${what} from ${speaker} -> ${text}`);
        sendChat(text);
      }).catch((err) => log(`${what} from ${speaker} failed: ${err.message}`));
      return { handled: true, pending: true };
    }

    lastAny = t;
    lastPerPlayer.set(String(speaker).toLowerCase(), t);
    log(`${what} from ${speaker} -> ${reply}`);
    sendChat(reply);
    return { handled: true, reply };
  }

  return { onChat, _answer: answer, _builtins: () => BUILTINS.slice() };
}

// Reads the command table from a file and notices when the file changes, so
// an edit takes effect without restarting. A broken file keeps the last good
// table instead of taking every command down with it.
function createFileTable({ path, fs, log = () => {}, recheckMs = 5000, now = () => Date.now() }) {
  let table = {};
  let mtime = null;
  let checked = null;

  return function loadTable() {
    if (checked !== null && now() - checked < recheckMs) return table;
    checked = now();
    try {
      if (!fs.existsSync(path)) {
        if (mtime !== null) { log(`chat commands: ${path} is gone, only the built-in ones left`); table = {}; mtime = null; }
        return table;
      }
      const m = fs.statSync(path).mtimeMs;
      if (m === mtime) return table;
      const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
      for (const [k, v] of Object.entries(parsed)) {
        if (k === SWITCHES) {
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`"${SWITCHES}" must be a block of switches`);
          for (const [name, on] of Object.entries(v)) {
            if (typeof on !== 'boolean') throw new Error(`"${SWITCHES}" -> "${name}" is neither true nor false`);
          }
          continue;
        }
        // "!name" is a command, a bare single word is an echo. A key with a
        // space can never match anything, so it is a typo, not an entry.
        if (!k.startsWith('!') && (k !== k.toLowerCase() || /[^\p{L}\p{N}]/u.test(k))) {
          throw new Error(`"${k}" is neither !command nor a single lower-case word`);
        }
        const ok = v === false || typeof v === 'string' || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'));
        if (!ok) throw new Error(`"${k}" is neither a text, a list of texts nor false`);
      }
      table = parsed;
      mtime = m;
      log(`chat commands: ${Object.keys(table).filter((k) => k !== SWITCHES).length} from ${path}`);
    } catch (err) {
      log(`chat commands: ${path} not usable, keeping the last good one: ${err.message}`);
    }
    return table;
  };
}

module.exports = { createChatCommands, createFileTable, echoWord, DEFAULT_8BALL, DEFAULT_CRIT_CHANCE, SWITCHES };
