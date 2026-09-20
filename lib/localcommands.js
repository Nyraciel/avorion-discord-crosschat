'use strict';

// Command channel for a bridge that runs on the same machine as the server:
// write <galaxy>/commands.txt directly, no panel in between.
//
// Same rules as the panel version in lib/commandsfile.js, and for the same
// reasons - Avorion deletes the file after reading it:
//  - never write while the file is still there, the server has not read the
//    last one yet and it would be lost
//  - write under a temporary name and rename it into place, so the server
//    cannot catch half a line (a rename is one step for the file system)
//  - the file disappearing is the only real proof the server is alive
//
// Same interface as createCommandsFile, so bridge.js does not care which one
// it got.
function createLocalCommands({
  file,
  fs,
  tmpSuffix = '.part',
  pollMs = 500,
  linesPerWrite = 1,
  maxQueue = 50,
  watchdog = null,
  log = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const tmp = file + tmpSuffix;
  const queue = [];
  let timer = null;
  let stopped = false;
  let writtenAt = null;
  let lastTakenMs = null;
  let takenLogged = false;
  let failures = 0;

  function step() {
    if (fs.existsSync(file)) return; // not picked up yet

    if (writtenAt !== null) {
      lastTakenMs = now() - writtenAt;
      // Once per start, as proof that the server really picks the file up -
      // and never again. Asked for on 20.09.2026: a line per message is a
      // line per message, and the watchdog says it when it stops working.
      if (!takenLogged) {
        takenLogged = true;
        log(`commands.txt taken by the server after ${lastTakenMs} ms (said once)`);
      }
      writtenAt = null;
      if (watchdog) watchdog.acked(now());
    }
    if (!queue.length) return;

    // Off the queue only once it really lies in the file.
    const batch = queue.slice(0, linesPerWrite);
    fs.writeFileSync(tmp, `${batch.join('\n')}\n`);
    fs.renameSync(tmp, file);
    queue.splice(0, batch.length);
    writtenAt = now();
    if (watchdog) watchdog.sent(now());
  }

  function backoffMs() {
    if (!failures) return pollMs;
    return Math.min(pollMs * 2 ** Math.min(failures, 6), 30000);
  }

  function schedule(delay) {
    if (stopped || timer) return;
    timer = setTimer(() => {
      timer = null;
      try {
        step();
        if (failures) { log(`commands file: works again after ${failures} failed tries`); failures = 0; }
      } catch (err) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) log(`commands file: ${err.message}${failures > 1 ? ` (${failures}x)` : ''}`);
      }
      if (queue.length || writtenAt !== null) schedule(backoffMs());
    }, delay);
    if (timer && timer.unref) timer.unref();
  }

  function command(cmd) {
    const line = String(cmd).replace(/[\r\n]+/g, ' ').trim();
    if (!line) return false;
    if (queue.length >= maxQueue) {
      log(`command queue full (${maxQueue}), dropping: ${line.slice(0, 60)}`);
      return false;
    }
    queue.push(line);
    schedule(0);
    return true;
  }

  function stop() {
    stopped = true;
    clearTimer(timer);
    timer = null;
  }

  return {
    command,
    stop,
    stats: () => ({ queued: queue.length, lastTakenMs, pendingSince: writtenAt, failures }),
    _queue: () => queue.slice(),
  };
}

module.exports = { createLocalCommands };
