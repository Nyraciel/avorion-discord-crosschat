'use strict';

// Writing commands.txt over FTP. Same interface as lib/commandsfile.js and
// lib/localcommands.js, and the same three rules, which come from Avorion
// deleting the file after reading it:
//  - never write while the file is still there
//  - write under a temporary name and rename it into place
//  - the file disappearing is the only real proof the server is alive
function createFtpCommands({
  ftp,
  name = 'commands.txt',
  tmpSuffix = '.part',
  pollMs = 5000,
  linesPerWrite = 1,
  maxQueue = 50,
  watchdog = null,
  log = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const queue = [];
  let timer = null;
  let stopped = false;
  let writtenAt = null;
  let lastTakenMs = null;
  let takenLogged = false;
  let failures = 0;
  let inFlight = false;

  async function step() {
    if (await ftp.exists(name)) return; // not picked up yet

    if (writtenAt !== null) {
      lastTakenMs = now() - writtenAt;
      if (!takenLogged) {
        takenLogged = true;
        log(`commands.txt taken by the server after ${lastTakenMs} ms (said once)`);
      }
      writtenAt = null;
      if (watchdog) watchdog.acked(now());
    }
    if (!queue.length) return;

    const batch = queue.slice(0, linesPerWrite);
    await ftp.upload(name + tmpSuffix, `${batch.join('\n')}\n`);
    await ftp.rename(name + tmpSuffix, name);
    queue.splice(0, batch.length);
    writtenAt = now();
    if (watchdog) watchdog.sent(now());
  }

  function backoffMs() {
    if (!failures) return pollMs;
    return Math.min(pollMs * 2 ** Math.min(failures, 4), 120000);
  }

  function schedule(delay) {
    if (stopped || timer) return;
    timer = setTimer(async () => {
      timer = null;
      if (inFlight) { schedule(pollMs); return; }
      inFlight = true;
      try {
        await step();
        if (failures) { log(`ftp commands: works again after ${failures} failed tries`); failures = 0; }
      } catch (err) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) log(`ftp commands: ${err.message}${failures > 1 ? ` (${failures}x)` : ''}`);
      } finally {
        inFlight = false;
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

module.exports = { createFtpCommands };
