'use strict';

const { cleanLine } = require('./format');

// Asking the game a question and waiting for the answer.
//
// The bridge can already send (commands.txt) and read (console or log file).
// Put the two together and it can ask: a /run that prints a marked line, and
// a watcher that picks that line out of everything the server prints.
//
// Proven on a live server, 20.09.2026: the /run below printed the marker
// and the player name back into the log, and the watcher picked it out.
//
// Every question gets its own marker, so two answers can never be mixed up,
// and a question that is never answered ends after a timeout instead of
// waiting for ever - the lesson from the same day.
const MARKER = /^CBQ(\d+) ?(.*)$/;

function createQuery({
  sendCommand,
  timeoutMs = 8000,
  log = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let seq = 0;
  const waiting = new Map(); // id -> { resolve, timer }

  // makeCommand(marker) builds the command line. The marker has to end up in
  // exactly one print() at the start of the printed line.
  function ask(makeCommand, opts = {}) {
    seq += 1;
    const id = seq;
    const marker = `CBQ${id}`;
    return new Promise((resolve) => {
      const timer = setTimer(() => {
        waiting.delete(id);
        log(`query ${marker}: no answer within ${opts.timeoutMs || timeoutMs} ms`);
        resolve(null);
      }, opts.timeoutMs || timeoutMs);
      if (timer && timer.unref) timer.unref();
      waiting.set(id, { resolve, timer });

      if (!sendCommand(makeCommand(marker))) {
        clearTimer(timer);
        waiting.delete(id);
        log(`query ${marker}: could not be sent`);
        resolve(null);
      }
    });
  }

  // Every line the server prints passes through here. Only a line that
  // STARTS with a marker counts: the server echoes the script it ran, and
  // that echo carries the marker in the middle of the line.
  function onLine(raw) {
    const m = MARKER.exec(cleanLine(raw));
    if (!m) return false;
    const entry = waiting.get(Number(m[1]));
    if (!entry) return false;
    waiting.delete(Number(m[1]));
    clearTimer(entry.timer);
    entry.resolve(m[2]);
    return true;
  }

  return { ask, onLine, _waiting: () => waiting.size };
}

// Every question is ONE Lua expression, wrapped as print((function() ... end)()).
// Avorion first tries a /run line as `return <line>`, and only when that does
// not compile does it run the line as a statement - after writing a syntax
// error and a stack-trace notice into the server log. Seen on the live server
// 21.09.2026 on every single !online, whose line began with `local`.

// Who is on the server right now. Server():getOnlinePlayers() was tried out on
// a running server on 20.09.2026 before this was written.
function onlineCommand(marker) {
  return `/run print((function() local t = {} for _, p in pairs({Server():getOnlinePlayers()}) do t[#t+1] = tostring(p.name) end return "${marker} " .. table.concat(t, ", ") end)())`;
}

function parseOnline(answer) {
  if (answer === null || answer === undefined) return null;
  return String(answer).split(',').map((n) => n.trim()).filter(Boolean);
}

// Is a Behemoth or Leviathan out? The galaxy script behemothevent.lua keeps
// its state in a table that its secure() hands out; read on the local server
// 21.09.2026: r=0, a table, countDown=3600, and no currentlyAttackedSector
// while nothing was out. On the live server the same day, with a boss out,
// .x and [1] of the sector both came back nil without an error - which is
// what a string does. So a string is passed on as it is, a table or object is
// read as x/y, and anything else says "?" rather than "nil".
function bossCommand(marker) {
  return `/run print((function() local r,d=Galaxy():invokeFunction("data/scripts/galaxy/behemothevent.lua","secure") if r~=0 or type(d)~="table" then return "${marker} off" end local s,p=d.currentlyAttackedSector,"" if s then p="?" if type(s)=="string" then p=s else pcall(function() local x,y=s.x or s[1],s.y or s[2] if x and y then p=x..":"..y end end) end end return "${marker} "..tostring(d.countDown).." "..p end)())`;
}

// "off" | "<countDown> <where>" - where is empty when nothing is out, "?"
// when the sector could not be read, otherwise text holding two numbers.
function parseBoss(answer) {
  if (answer === null || answer === undefined) return null;
  const text = String(answer).trim();
  if (text === 'off') return { off: true };
  const space = text.indexOf(' ');
  const count = space === -1 ? text : text.slice(0, space);
  const where = space === -1 ? '' : text.slice(space + 1).trim();
  const out = { off: false, countDown: Number(count), out: where !== '', sector: null, raw: where };
  const m = where.match(/^\D*?(-?\d+)\D+?(-?\d+)\D*$/);
  if (m) out.sector = { x: m[1], y: m[2] };
  return out;
}

// No countdown on purpose: players would set a timer and log in only for the
// kill (decided 21.09.2026).
function formatBoss(state) {
  if (state === null) return 'The server did not answer.';
  if (state.off) return 'Boss attacks are not running on this server.';
  if (state.sector) return `A boss is out at (${state.sector.x}:${state.sector.y}).`;
  if (state.out) return 'A boss is out right now.';
  return 'No boss out right now.';
}

module.exports = { createQuery, onlineCommand, parseOnline, bossCommand, parseBoss, formatBoss };
