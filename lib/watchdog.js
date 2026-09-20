'use strict';

// Watches whether commands actually reach the server.
//
// Background 18.09.2026: the server writes "input closed." into its log and
// from then on ignores every console line. The panel still accepts input and
// still echoes it, so a dead channel looks exactly like a working one.
//
// Since the switch to commands.txt the proof is a different one and a much
// better one: Avorion deletes the file after reading it. The file
// disappearing can only be the game. Nothing the panel does looks like it.
//
// sent(now)  - a command has been placed in the file
// acked(now) - the server has taken the file
function createWatchdog({ timeoutMs, onDead, onAlive, log }) {
  let pending = null; // { at }
  let dead = false;

  function sent(now) {
    if (pending === null) pending = { at: now };
  }

  function acked(now) {
    pending = null;
    if (dead) {
      dead = false;
      onAlive();
      log('server takes commands again');
    }
  }

  function tick(now) {
    if (dead || pending === null) return;
    if (now - pending.at < timeoutMs) return;
    dead = true;
    pending = null;
    log('server is not reading commands.txt any more');
    onDead();
  }

  return { sent, acked, tick, isDead: () => dead, _pending: () => pending };
}

module.exports = { createWatchdog };
