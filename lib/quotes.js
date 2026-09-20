'use strict';

// A quote collection in the game chat. The commands follow what Twitch
// quote bots do, so nobody has to learn a new one:
//
//   !quote              a random one
//   !quote 12           that one
//   !quote search <x>   a random one containing <x>
//   !quote add <text> - <name>     admin only (alias: !addquote)
//   !quote this                    admin only, takes the last chat line
//   !quote remove <n>              admin only (also del, delete, -)
//
// Differences to the Twitch bot, on purpose:
//  - adding and removing is admin-only here, and "admin" means a Discord id
//    from the list. A name in the game chat proves nothing.
//  - "!quote this" exists because the good lines happen in the game, where
//    retyping them is a nuisance.
const DEFAULT_FILE = 'quotes.json';

function createQuotes({
  file = DEFAULT_FILE,
  fs,
  log = () => {},
  now = () => new Date(),
  random = Math.random,
  maxTextChars = 300,
  maxNameChars = 40,
}) {
  let quotes = [];
  let nextId = 1;
  let last = null; // { name, text } - the last line said in the GAME chat

  function load() {
    try {
      if (!fs.existsSync(file)) return;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(data)) { log('quotes: file is not a list, ignored'); return; }
      quotes = data.filter((q) => q && typeof q.text === 'string');
      nextId = quotes.reduce((m, q) => Math.max(m, Number(q.id) || 0), 0) + 1;
      log(`quotes: ${quotes.length} loaded from ${file}`);
    } catch (err) {
      log(`quotes: ${file} not readable (${err.message}), starting empty`);
    }
  }

  function save() {
    try {
      fs.writeFileSync(file, `${JSON.stringify(quotes, null, 2)}\n`);
      return true;
    } catch (err) {
      log(`quotes: ${file} not writable: ${err.message}`);
      return false;
    }
  }

  function stamp() {
    const d = now();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function format(q) {
    const who = [q.quotee, q.date].filter(Boolean).join(', ');
    return `#${q.id} "${q.text}"${who ? ` - ${who}` : ''}`;
  }

  function pick(list) {
    return list[Math.floor(random() * list.length)];
  }

  // Remember what was said in the game, for "!quote this".
  function remember(name, text) {
    const t = String(text || '').trim();
    if (!t || t.startsWith('!')) return; // a command is not a quote
    last = { name: String(name), text: t };
  }

  function add(text, quotee, addedBy) {
    const q = {
      id: nextId++,
      text: String(text).slice(0, maxTextChars),
      quotee: String(quotee || '').slice(0, maxNameChars),
      addedBy: String(addedBy || ''),
      date: stamp(),
    };
    quotes.push(q);
    if (!save()) { quotes.pop(); nextId -= 1; return null; }
    log(`quotes: #${q.id} added by ${addedBy}`);
    return q;
  }

  // Returns { handled, reply } - reply is one line for the chat, or null.
  function handle({ text, user = 'someone', isAdmin = false }) {
    const line = String(text || '').trim();
    const lower = line.toLowerCase();
    const isAddAlias = lower === '!addquote' || lower.startsWith('!addquote ');
    if (lower !== '!quote' && !lower.startsWith('!quote ') && !isAddAlias) return { handled: false };

    const rest = isAddAlias
      ? `add ${line.slice('!addquote'.length).trim()}`
      : line.slice('!quote'.length).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();

    if (sub === 'add' || sub === '+') {
      if (!isAdmin) return { handled: true, reply: `${user}: only an admin adds quotes.` };
      let body = rest.replace(/^(\+|add)\s*/i, '').trim();
      if (!body) return { handled: true, reply: `${user}: use !quote add <text> - <name>` };
      let quotee = '';
      // The name stands behind the LAST " - ", so a dash inside the quote is
      // harmless. A line that begins with the dash has no quote at all.
      const lead = body.match(/^-\s+(.*)$/);
      const dash = body.lastIndexOf(' - ');
      if (lead) { quotee = lead[1].trim(); body = ''; }
      else if (dash !== -1) { quotee = body.slice(dash + 3).trim(); body = body.slice(0, dash).trim(); }
      if (!body) return { handled: true, reply: `${user}: the quote itself is missing.` };
      const q = add(body, quotee, user);
      return { handled: true, reply: q ? `Quote ${format(q)}` : `${user}: could not save the quote.` };
    }

    if (sub === 'this') {
      if (!isAdmin) return { handled: true, reply: `${user}: only an admin adds quotes.` };
      if (!last) return { handled: true, reply: `${user}: nothing said in the game chat yet.` };
      const q = add(last.text, last.name, user);
      return { handled: true, reply: q ? `Quote ${format(q)}` : `${user}: could not save the quote.` };
    }

    if (sub === 'remove' || sub === 'delete' || sub === 'del' || sub === '-') {
      if (!isAdmin) return { handled: true, reply: `${user}: only an admin removes quotes.` };
      const id = parseInt(parts[1], 10);
      const idx = quotes.findIndex((q) => q.id === id);
      if (Number.isNaN(id) || idx === -1) return { handled: true, reply: `${user}: quote #${parts[1] || '?'} does not exist.` };
      quotes.splice(idx, 1);
      save();
      log(`quotes: #${id} removed by ${user}`);
      return { handled: true, reply: `Quote #${id} removed.` };
    }

    if (sub === 'search' || sub === 'find') {
      const term = rest.replace(/^(search|find)\s*/i, '').trim().toLowerCase();
      if (!term) return { handled: true, reply: `${user}: use !quote search <text>` };
      const hits = quotes.filter((q) => q.text.toLowerCase().includes(term));
      if (!hits.length) return { handled: true, reply: `${user}: no quote about "${term}".` };
      return { handled: true, reply: format(pick(hits)) };
    }

    if (/^\d+$/.test(sub)) {
      const q = quotes.find((x) => x.id === parseInt(sub, 10));
      return { handled: true, reply: q ? format(q) : `${user}: quote #${sub} does not exist.` };
    }

    if (!quotes.length) return { handled: true, reply: `${user}: no quotes yet.` };
    return { handled: true, reply: format(pick(quotes)) };
  }

  load();
  return { handle, remember, count: () => quotes.length, _all: () => quotes.slice(), _last: () => last };
}

module.exports = { createQuotes, DEFAULT_FILE };
