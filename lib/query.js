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

// The question itself: who is on the server right now. Server():getOnlinePlayers()
// was tried out on a running server on 20.09.2026 before this was written.
function onlineCommand(marker) {
  return `/run local t = {} for _, p in pairs({Server():getOnlinePlayers()}) do t[#t+1] = tostring(p.name) end print("${marker} " .. table.concat(t, ", "))`;
}

function parseOnline(answer) {
  if (answer === null || answer === undefined) return null;
  return String(answer).split(',').map((n) => n.trim()).filter(Boolean);
}

module.exports = { createQuery, onlineCommand, parseOnline };
