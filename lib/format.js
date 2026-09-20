'use strict';

// Pure functions: parsing console lines and building console commands.
// Everything here is covered by test/format.test.js.

// Console lines may carry ANSI colour codes and a trailing \r from the daemon.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The log file prefixes lines with "YYYY-MM-DD HH-MM-SS| ". The live console
// did not show it in the 16.09. test, so it is optional.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\| /;

// Chat as seen in the server log: "<Name> text".
const CHAT = /^<([^<>]*)> (.*)$/;

const DISCORD_PREFIX = '[Discord] ';

function cleanLine(raw) {
  return String(raw).replace(ANSI, '').replace(/\r/g, '').replace(TIMESTAMP, '');
}

// Returns {name, text} for a line that should go to Discord, otherwise null.
//  - "<> ..."        system/NPC notice to a single player  -> skip
//  - "<Server> ..."  join/leave and announcements          -> skip
//  - "<[Discord] X>" our own message echoed back           -> skip (else loop)
function parseChatLine(raw) {
  const m = CHAT.exec(cleanLine(raw));
  if (!m) return null;
  const name = m[1];
  const text = m[2].trim();
  if (name === '' || name === 'Server') return null;
  if (name.startsWith(DISCORD_PREFIX)) return null;
  if (text === '') return null;
  return { name, text };
}

// Lua string literal body. Only the three things that could break out of
// the literal are escaped: the closing quote, the backslash and control
// characters. Everything else - letters, digits, punctuation, umlauts,
// emoji - goes in as it is.
//
// Why so little: until 18.09.2026 every byte outside [A-Za-z0-9 ] became a
// four-character \ddd escape. That was safe, but it tripled the length of a
// normal sentence, and length is exactly what killed the console channel
// ("input closed."). The command now travels through commands.txt, where the
// text is written as UTF-8 and Lua reads the same bytes back.
//
// Escapes are always three digits, so a digit right after an escape can
// never be read as part of it. The result cannot close the string or inject
// code: without an unescaped " the literal cannot end, and without an
// unescaped \ no other escape can be formed.
function luaEscape(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    const mustEscape = ch === '"' || ch === '\\' || code < 0x20 || code === 0x7f;
    out += mustEscape ? '\\' + String(code).padStart(3, '0') : ch;
  }
  return out;
}

// Discord text -> one chat line. Newlines would split the console command.
function flattenText(text) {
  return String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

// Names go into "<...>" in game; brackets would let someone fake a sender.
function cleanName(name) {
  return flattenText(name).replace(/[<>]/g, '').trim() || 'unknown';
}

// opts.raw = true: send under the given name as it is (the chat companion),
// otherwise the name is marked as coming from Discord.
// Clicking a sector on the map posts its coordinates as a chat line, e.g.
// "(-259:-40)". In the game that is a ping somebody clicks on; in Discord it
// is noise, sometimes ten lines in a row (19.09.2026).
const COORDS = /^\(\s*-?\d+\s*:\s*-?\d+\s*\)$/;

function isCoordinatePing(text) {
  const parts = String(text).trim().split(/\s+(?=\()/);
  return parts.length > 0 && parts.every((p) => COORDS.test(p.trim()));
}

function buildChatCommand(discordName, text, opts = {}) {
  const sender = luaEscape((opts.raw ? '' : DISCORD_PREFIX) + cleanName(discordName));
  const body = luaEscape(flattenText(text));
  return `/run Server():broadcastChatMessage("${sender}", ChatMessageType.Normal, "${body}")`;
}

module.exports = { cleanLine, parseChatLine, isCoordinatePing, luaEscape, flattenText, cleanName, buildChatCommand, DISCORD_PREFIX };
