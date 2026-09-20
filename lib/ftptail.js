'use strict';

const { EventEmitter } = require('events');
const { createLineBuffer, DEFAULT_PATTERN } = require('./ftp');

// Reading the game chat out of the server log over FTP. Same events as
// lib/pelican.js and lib/logtail.js ('line', 'ready', 'down'), so nothing
// downstream notices which of the three it got.
//
// The differences to the local tail, both forced by the protocol:
//  - a listing is a request of its own, so the newest file is looked up on
//    every turn but the interval is seconds, not milliseconds
//  - an FTP listing only carries the MINUTE a file was changed (measured
//    20.09.2026: two logs written a second apart both said "Sep 20 15:27").
//    So the newest log is found by NAME, not by time - Avorion names them
//    "serverlog 2026-09-20 16-05-51.txt", date first, so sorting the names
//    sorts them by age. The local tail can use the real timestamp and does.
//  - a fetch can fail halfway; the offset only moves by what really arrived,
//    so the next turn picks up exactly where this one stopped
function createFtpTail({
  ftp,
  pattern = DEFAULT_PATTERN,
  pollMs = 5000,
  fromStart = false,
  log = () => {},
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  const events = new EventEmitter();
  const lines = createLineBuffer();
  let timer = null;
  let current = null;
  let position = 0;
  let ready = false;
  let complained = false;
  let busy = false;

  function down(reason) {
    if (ready || !complained) events.emit('down', reason);
    ready = false;
    complained = true;
  }

  function up(file, pos) {
    current = file;
    position = pos;
    lines.clear();
    if (!ready) { ready = true; complained = false; events.emit('ready'); }
    log(`ftp tail: reading ${file} from byte ${pos}`);
  }

  async function tick() {
    if (busy) return; // one turn at a time, never two connections at once
    busy = true;
    try {
      const listing = await ftp.list();
      const logs = listing
        .filter((e) => e.isFile !== false && pattern.test(e.name))
        .sort((a, b) => String(b.name).localeCompare(String(a.name)));
      if (!logs.length) { down('no log file on the server'); return; }

      const newest = logs[0];
      if (newest.name !== current) {
        // a new day or a restart: that file is new, read it whole - except
        // at startup, where hours of old chat must not be pushed into Discord
        up(newest.name, current === null && !fromStart ? newest.size : 0);
      }

      const size = newest.size;
      if (size < position) { log(`ftp tail: ${newest.name} got shorter, starting over`); position = 0; lines.clear(); }
      if (size === position) { if (!ready) { ready = true; events.emit('ready'); } return; }

      const chunk = await ftp.read(newest.name, position);
      if (!chunk.length) return;
      position += chunk.length;
      lines.push(chunk, (line) => events.emit('line', line));
      if (!ready) { ready = true; complained = false; events.emit('ready'); }
    } catch (err) {
      down(err.message);
    } finally {
      busy = false;
    }
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
    ftp.close();
  }

  events.start = start;
  events.stop = stop;
  events._tick = tick;
  events._state = () => ({ current, position, ready });
  return events;
}

module.exports = { createFtpTail };
