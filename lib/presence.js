'use strict';

const { cleanLine } = require('./format');

// Who is online, as far as the console has told us.
//
// The server announces both events itself:
//   <Server> Player Viscount joined the galaxy
//   <Server> Player Viscount left the galaxy
// So this is only as complete as the time the bridge has been listening -
// players who were already in the game when it started are missing until
// they log in again. !status says "seen online" for exactly that reason.
const JOINED = /^<Server> Player (.+) joined the galaxy$/;
const LEFT = /^<Server> Player (.+) left the galaxy$/;

function createPresence() {
  const online = new Set();

  function onLine(raw) {
    const line = cleanLine(raw);
    const joined = JOINED.exec(line);
    if (joined) { online.add(joined[1]); return { name: joined[1], event: 'joined' }; }
    const left = LEFT.exec(line);
    if (left) { online.delete(left[1]); return { name: left[1], event: 'left' }; }
    return null;
  }

  // A restart of the server empties the galaxy, so the list starts over.
  function reset() { online.clear(); }

  return { onLine, reset, count: () => online.size, names: () => [...online] };
}

// One line for !online. The wording says "since I started watching" on
// purpose: the list is only as good as the time the bridge has been up, and
// a player who was already in the game when it started is missing from it.
// Better a sentence that admits that than a number people stop trusting.
function formatOnline(names, maxNames = 15) {
  const list = [...names];
  if (!list.length) return 'Nobody online since I started watching.';
  const shown = list.slice(0, maxNames);
  const rest = list.length - shown.length;
  return `Online (${list.length}): ${shown.join(', ')}${rest > 0 ? ` + ${rest} more` : ''}`;
}

module.exports = { createPresence, formatOnline };
