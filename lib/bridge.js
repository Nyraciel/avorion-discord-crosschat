'use strict';

const { parseChatLine, buildChatCommand, isCoordinatePing } = require('./format');

// Glue between the server and Discord. Both sides are injected so the whole
// path can be tested without a real server or bot.
//
// The two directions use two different channels since 18.09.2026:
//   game -> Discord   the panel console (read only, it just listens)
//   Discord -> game   commands.txt (see lib/commandsfile.js)
// Reading over the console is harmless; it was sending that closed the input.
function createBridge({ consoleConn, commandSink, postToDiscord, log, onPlayerChat, onServerLine, skipCoordinatePings = true, now = () => Date.now() }) {
  consoleConn.on('line', (line) => {
    // Lines the chat parser drops (<Server> ...) can still matter, e.g. a
    // newly created player.
    if (onServerLine) {
      try { onServerLine(line); } catch (err) { log(`server line handler failed: ${err.message}`); }
    }
    const chat = parseChatLine(line);
    if (!chat) return;
    // A bare map ping stays in the game; in Discord it is noise.
    if (!(skipCoordinatePings && isCoordinatePing(chat.text))) {
      // .then(() => ...) so a handler that throws right away is caught too,
      // not only a rejected promise.
      Promise.resolve()
        .then(() => postToDiscord(chat.name, chat.text))
        .catch((err) => log(`discord send failed: ${err.message}`));
    }
    if (onPlayerChat) {
      Promise.resolve()
        .then(() => onPlayerChat(chat.name, chat.text))
        .catch((err) => log(`ai failed: ${err.message}`));
    }
  });

  function send(name, text, opts) {
    const ok = commandSink.command(buildChatCommand(name, text, opts));
    if (!ok) { log('command not queued, message dropped'); return false; }
    return true;
  }

  function fromDiscord(authorName, content) {
    if (!content || !String(content).trim()) return false;
    return send(authorName, content);
  }

  return { fromDiscord, send };
}

module.exports = { createBridge };
