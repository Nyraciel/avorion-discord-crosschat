'use strict';

// Command channel through commands.txt instead of the console.
//
// Background 18.09.2026: the server writes "input closed." into its log and
// from then on ignores every line that comes in over the panel console. The
// panel still accepts and echoes input, so a dead channel looks exactly like
// a working one. Length is the prime suspect - a GLaDOS answer is far longer
// than the longest line that ever went through.
//
// Avorion reads <galaxy>/commands.txt on its own and DELETES it afterwards.
// That path was tested on 18.09.2026 at 20:25:17 with a 400 character
// /run print(...) while stdin was already dead: it ran.
//
// Three rules follow from the file being deleted after reading:
//  - never write while the file still exists. The server has not picked up
//    the previous command yet and it would be lost.
//  - write under a temporary name and rename. A rename is one step for the
//    filesystem, so the server can never read half a line.
//  - the file disappearing is the only honest proof that the server is
//    alive. Nothing the panel shows proves it; the console echo is written
//    by the panel, not by the game.
//
// Pelican client file API (Pterodactyl compatible):
//   GET  /api/client/servers/{id}/files/list?directory=<dir>  listing
//   POST /api/client/servers/{id}/files/write?file=<path>     raw body
//   PUT  /api/client/servers/{id}/files/rename                {root, files}
//
// Whether the file is there is asked with the LISTING, not with
// files/contents. The panel answered HTTP 500 for a file that is not there
// (18.09.2026, 20:50), and a 500 says nothing: it could mean gone, it could
// mean broken. The listing has a defined answer either way.
function createCommandsFile({
  url,
  apiKey,
  serverId,
  filePath = '/galaxy/Avorion/commands.txt',
  tmpSuffix = '.part',
  // Not measured yet. How often we ask whether the server has taken the file.
  // Every consumed file logs how long it lay there, so the real interval
  // shows up in the log within minutes of the first message.
  pollMs = 500,
  // Whether Avorion runs every line of the file or only the first one is
  // untested. 1 is the safe assumption; raise it once two lines in one file
  // have been seen to run.
  linesPerWrite = 1,
  maxQueue = 50,
  // Node's fetch has NO timeout of its own. A request the panel accepts and
  // never answers would wait for ever, and because the watchdog only learns
  // about a command once it has been written, a hanging write is invisible:
  // the status line keeps saying "arriving" while nothing goes out at all
  // (20.09.2026).
  requestTimeoutMs = 15000,
  watchdog = null,
  log = () => {},
  fetchImpl,
  now = () => Date.now(),
}) {
  const base = String(url).replace(/\/+$/, '');
  const doFetch = fetchImpl || fetch;
  const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const tmpPath = filePath + tmpSuffix;

  const queue = [];
  let timer = null;
  let stopped = false;
  let writtenAt = null; // set while a written file has not been consumed
  let lastTakenMs = null;   // how long the last line waited, for !status
  let takenLogged = false;  // the proof of pickup is said once, then never
  let failures = 0;     // consecutive errors, for backing off and not spamming
  let inFlight = false; // one request at a time, so nothing can pile up

  function api(path, init = {}) {
    return doFetch(`${base}/api/client/servers/${serverId}${path}`, {
      ...(requestTimeoutMs ? { signal: AbortSignal.timeout(requestTimeoutMs) } : {}),
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
  }

  // true = still there, false = gone. Anything unclear throws, because
  // taking it for "gone" would overwrite a command the server has not read.
  async function exists() {
    const res = await api(`/files/list?directory=${encodeURIComponent(dir)}`);
    const text = await res.text();
    if (!res.ok) throw new Error(`file check: HTTP ${res.status} ${text.slice(0, 200)}`);
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`file check: answer is not JSON: ${text.slice(0, 120)}`); }
    if (!Array.isArray(body.data)) throw new Error('file check: listing without data');
    return body.data.some((e) => (e && e.attributes ? e.attributes.name : e && e.name) === name);
  }

  async function writeTmp(text) {
    const res = await api(`/files/write?file=${encodeURIComponent(tmpPath)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    });
    if (!res.ok) throw new Error(`file write: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async function renameIntoPlace() {
    const res = await api('/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, files: [{ from: name + tmpSuffix, to: name }] }),
    });
    if (!res.ok) throw new Error(`file rename: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async function step() {
    if (await exists()) return; // not picked up yet, try again later

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

    // Taken off the queue only once it really lies in commands.txt. A write
    // that fails on HTTP must not swallow the message.
    const batch = queue.slice(0, linesPerWrite);
    await writeTmp(batch.join('\n') + '\n');
    await renameIntoPlace();
    queue.splice(0, batch.length);
    writtenAt = now();
    if (watchdog) watchdog.sent(now());
  }

  // A panel that answers with an error must not be asked twice a second for
  // hours. Back off to at most 30 s and log the first failure, then every
  // tenth, instead of every single one.
  function backoffMs() {
    if (!failures) return pollMs;
    return Math.min(pollMs * 2 ** Math.min(failures, 6), 30000);
  }

  function schedule(delay) {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      // A request that is still running gets its turn finished first.
      if (inFlight) { schedule(pollMs); return; }
      inFlight = true;
      try {
        await step();
        if (failures) { log(`commands file: works again after ${failures} failed tries`); failures = 0; }
      } catch (err) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) log(`commands file: ${err.message}${failures > 1 ? ` (${failures}x)` : ''}`);
      } finally {
        inFlight = false;
      }
      if (queue.length || writtenAt !== null) schedule(backoffMs());
    }, delay);
    if (timer.unref) timer.unref();
  }

  // Queues one command line. true only means "accepted", never "ran" - that
  // is what the watchdog is for.
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
    clearTimeout(timer);
    timer = null;
  }

  return {
    command,
    stop,
    stats: () => ({ queued: queue.length, lastTakenMs, pendingSince: writtenAt, failures }),
    _queue: () => queue.slice(),
    _pendingSince: () => writtenAt,
  };
}

module.exports = { createCommandsFile };
