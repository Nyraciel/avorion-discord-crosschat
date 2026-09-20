'use strict';

const { EventEmitter } = require('events');

// Reads the game chat straight from the server's log file, for a bridge that
// runs on the same machine as the server. Same events as lib/pelican.js
// ('line', 'ready', 'down'), so nothing downstream notices the difference.
//
// Why this works at all: the log carries the chat lines in exactly the same
// shape as the console, only with a timestamp in front, and lib/format.js
// already strips that:
//
//   2026-09-16 21-07-53| <nyx> shipyard finally finished :)
//
// Checked against two real server logs (test/fixtures), 54 chat lines.
//
// Avorion names its log after the date ("serverlog 2026-09-16.txt", the exact
// shape differs), so the file changes while the bridge runs. We therefore do
// not hold on to a name: on every tick the newest matching file wins. Without
// that, the chat would quietly stop at midnight.
const DEFAULT_PATTERN = /^serverlog.*\.txt$/i;

function createLogTail({
  dir,
  fs,
  path,
  pattern = DEFAULT_PATTERN,
  pollMs = 500,
  // Where to start in the file that is current at startup. The end, because
  // a restarted bridge must not push hours of old chat into Discord.
  fromStart = false,
  log = () => {},
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  const events = new EventEmitter();
  let timer = null;
  let current = null;   // file we are reading
  let position = 0;     // how far we have read
  let rest = Buffer.alloc(0); // last line, still without its newline
  let ready = false;
  let complained = false;

  // The newest file that matches, or null. mtime decides, not the name: the
  // date format in the name is not documented anywhere I could verify.
  function newest() {
    let best = null;
    let bestTime = -1;
    for (const name of fs.readdirSync(dir)) {
      if (!pattern.test(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs <= bestTime) continue;
      best = full;
      bestTime = st.mtimeMs;
    }
    return best;
  }

  // Only say it once per outage, not twice a second.
  function down(reason) {
    if (ready || !complained) events.emit('down', reason);
    ready = false;
    complained = true;
  }

  function openAt(file, pos) {
    current = file;
    position = pos;
    rest = Buffer.alloc(0);
    if (!ready) { ready = true; complained = false; events.emit('ready'); }
    log(`log tail: reading ${file} ${pos === -1 ? 'from the end' : `from byte ${pos}`}`);
  }

  function emitFrom(buf) {
    rest = Buffer.concat([rest, buf]);
    let nl;
    // eslint-disable-next-line no-cond-assign
    while ((nl = rest.indexOf(0x0a)) !== -1) {
      const line = rest.slice(0, nl).toString('utf8');
      rest = rest.slice(nl + 1);
      events.emit('line', line);
    }
  }

  function read(file, from, to) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(to - from);
      const n = fs.readSync(fd, buf, 0, buf.length, from);
      return buf.slice(0, n);
    } finally {
      fs.closeSync(fd);
    }
  }

  function tick() {
    let file;
    try { file = newest(); } catch (err) { down(`${dir}: ${err.message}`); return; }
    if (!file) { down(`no log file in ${dir}`); return; }

    // A new log file means a new day or a restart: read it from the start,
    // that content is new.
    if (file !== current) { openAt(file, current === null && !fromStart ? -1 : 0); }

    let size;
    try { size = fs.statSync(file).size; } catch (err) { down(`${file}: ${err.message}`); return; }

    if (position === -1) { position = size; } // first sight: skip the history
    // Shrunk: the file was truncated or replaced under the same name.
    if (size < position) { log(`log tail: ${file} got shorter, starting over`); position = 0; rest = Buffer.alloc(0); }
    if (size === position) return;

    let buf;
    try { buf = read(file, position, size); } catch (err) { down(`${file}: ${err.message}`); return; }
    position += buf.length;
    emitFrom(buf);
  }

  function start() {
    if (timer) return;
    tick();
    timer = setTimer(tick, pollMs);
    if (timer && timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  events.start = start;
  events.stop = stop;
  events._tick = tick;
  events._state = () => ({ current, position, ready });
  return events;
}

module.exports = { createLogTail, DEFAULT_PATTERN };
