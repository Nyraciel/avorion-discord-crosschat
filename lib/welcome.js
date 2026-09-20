'use strict';

const { cleanLine } = require('./format');

// Greets a player the first time their character is created.
//
// Avorion announces this itself, once per player, e.g. 18.09.2026:
//   10-55-53| <Server> Player Voidling created!
//   10-55-53| New Player registered: 76561190000000001 [Voidling] index: 142
// So no list of known names is needed - the line IS the proof.
//
// The greeting is delayed: the line appears while the player is still
// loading, and a message sent then is never seen. The delay is a guess, not
// a measurement; it is in the configuration so it can be corrected.
const CREATED = /^<Server> Player (.+) created!$/;

function createWelcome({ config, sendChat, log, setTimer = setTimeout }) {
  const text = String(config.text || '');

  // Returns the name when this line greets someone, otherwise null.
  function match(raw) {
    const m = CREATED.exec(cleanLine(raw));
    return m ? m[1] : null;
  }

  function onLine(raw) {
    const name = match(raw);
    if (name === null) return null;
    if (!text) { log(`welcome: no text configured, ${name} not greeted`); return null; }
    log(`welcome: new player ${name}, greeting in ${config.delayMs} ms`);
    setTimer(() => sendChat(text.replace(/\{user\}/g, name)), config.delayMs);
    return name;
  }

  return { onLine, _match: match };
}

module.exports = { createWelcome };
