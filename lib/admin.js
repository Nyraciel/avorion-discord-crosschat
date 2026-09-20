'use strict';

// Admin commands from the Discord channel. Currently: reboot and save.
//
// Why Discord and not the game chat: an Avorion chat line contains only
// "<Name> Text", and that name comes from the Steam profile - it can be
// changed in half a minute. A command that reboots the server must not hang
// on something anybody can put on. Discord hands us a user id that the
// person cannot choose, so the check is a comparison against a list.
//
// The reboot itself is the sequence that was tried out by hand in the night
// of 18./19.09.2026 and gave a complete reboot:
//
//     /save
//     /stop 60
//
// The server announces the countdown itself every 10 seconds, saves, shuts
// down cleanly, and Pelican starts it again.
//
// Two brakes on top of the list:
//  - nothing happens on the first !reboot. It has to be confirmed, by the
//    same person, within confirmSeconds. A misplaced word in a chat window
//    should not take the server down.
//  - an empty list refuses everything. Somebody who is not on it gets their
//    own id back, so the list can be filled without hunting for it.
const COMMANDS = ['!reboot', '!save', '!status', '!say', '!quiet', '!loud'];

// One line per fact, so it reads on a phone.
function formatStatus(s = {}) {
  const parts = [];
  parts.push(`Console: ${s.consoleConnected ? 'connected' : 'NOT connected'}`);
  // "arriving" used to mean no more than "nothing has gone wrong that I
  // noticed", and on 20.09.2026 it said that while every write was failing.
  // Failed tries are now named, because a quiet line is not a healthy one.
  if (s.commandsDead) parts.push('Commands: NOT arriving');
  else if (s.commandsFailing) parts.push(`Commands: ${s.commandsFailing} failed ${s.commandsFailing === 1 ? 'try' : 'tries'} in a row`);
  else parts.push('Commands: arriving');
  if (s.queued) parts.push(`${s.queued} waiting`);
  if (s.quiet) parts.push('companion silent (!loud)');
  if (s.playersOnline !== undefined) parts.push(`players seen online: ${s.playersOnline}`);
  if (s.uptimeSeconds !== undefined) parts.push(`bridge up ${Math.floor(s.uptimeSeconds / 60)} min`);
  return parts.join(' | ');
}

function createAdminCommands({
  config = {},
  sendCommand,
  reply = () => {},
  log = () => {},
  now = () => Date.now(),
  // Added 19.09.2026, all three answer in Discord and need no game access:
  //   status()      a plain object about the connection, formatted here
  //   sayInGame()   one announcement line into the game chat
  //   setQuiet()    silences the chat companion without a restart
  status = null,
  sayInGame = null,
  setQuiet = null,
}) {
  const allowed = (config.discordUserIds || []).map(String);
  const rebootSeconds = config.rebootSeconds === undefined ? 60 : config.rebootSeconds;
  const confirmMs = (config.confirmSeconds === undefined ? 30 : config.confirmSeconds) * 1000;
  let pending = null; // { userId, at }

  function reboot(userName) {
    // Two lines, in this order. The bridge writes them one after the other;
    // the second only goes in once the server has taken the first.
    const ok = sendCommand('/save') && sendCommand(`/stop ${rebootSeconds}`);
    if (!ok) {
      reply('Could not queue the reboot - the command channel is not accepting anything.');
      log('admin: reboot could not be queued');
      return { handled: true, action: 'reboot failed' };
    }
    reply(`Reboot started by ${userName}. The server saves and shuts down in ${rebootSeconds} seconds, then comes back on its own.`);
    log(`admin: reboot by ${userName}`);
    return { handled: true, action: 'reboot' };
  }

  // A message from the Discord channel. handled = this was an admin command,
  // so it must not be relayed into the game as chat.
  function onMessage({ userId, userName = 'unknown', text }) {
    const line = String(text || '').trim();
    if (!line.startsWith('!')) return { handled: false };
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (!COMMANDS.includes(cmd)) return { handled: false };

    if (!allowed.includes(String(userId))) {
      reply(`${userName}: you are not on the admin list. Your Discord ID is ${userId}.`);
      log(`admin: ${cmd} refused for ${userName} (id ${userId})`);
      return { handled: true, action: 'refused' };
    }

    if (cmd === '!status') {
      if (!status) { reply('Status is not available in this build.'); return { handled: true, action: 'status missing' }; }
      reply(formatStatus(status()));
      log(`admin: status by ${userName}`);
      return { handled: true, action: 'status' };
    }

    if (cmd === '!say') {
      const text = line.slice(cmd.length).trim();
      if (!text) { reply('Say what? Use: !say <text>'); return { handled: true, action: 'say empty' }; }
      if (!sayInGame || !sayInGame(text)) {
        reply('Could not queue the announcement.');
        return { handled: true, action: 'say failed' };
      }
      reply(`Announced in game: ${text}`);
      log(`admin: say by ${userName}: ${text}`);
      return { handled: true, action: 'say' };
    }

    if (cmd === '!quiet' || cmd === '!loud') {
      if (!setQuiet) { reply('This build has no chat companion to silence.'); return { handled: true, action: 'quiet missing' }; }
      const quiet = cmd === '!quiet';
      setQuiet(quiet);
      reply(quiet
        ? 'The chat companion is silent now. Chat commands and echoes keep working. Bring her back with !loud.'
        : 'The chat companion answers again.');
      log(`admin: ${cmd} by ${userName}`);
      return { handled: true, action: cmd.slice(1) };
    }

    if (cmd === '!save') {
      if (!sendCommand('/save')) {
        reply('Could not queue the save.');
        return { handled: true, action: 'save failed' };
      }
      reply('Save requested.');
      log(`admin: save by ${userName}`);
      return { handled: true, action: 'save' };
    }

    // !reboot
    const confirming = (parts[1] || '').toLowerCase() === 'yes';
    if (!confirming) {
      pending = { userId: String(userId), at: now() };
      reply(`This reboots the server with a ${rebootSeconds} second countdown. Confirm with "!reboot yes" within ${confirmMs / 1000} seconds.`);
      return { handled: true, action: 'asked' };
    }
    if (pending === null || pending.userId !== String(userId) || now() - pending.at > confirmMs) {
      pending = null;
      reply('Nothing to confirm. Send "!reboot" first.');
      return { handled: true, action: 'nothing to confirm' };
    }
    pending = null;
    return reboot(userName);
  }

  return { onMessage, _commands: () => COMMANDS.slice(), _pending: () => pending, _formatStatus: formatStatus };
}

module.exports = { createAdminCommands, COMMANDS };
