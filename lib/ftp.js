'use strict';

const { EventEmitter } = require('events');
const { Writable } = require('stream');

// The third way to reach a server: plain files over FTP.
//
// Most rented Avorion servers give neither a Pterodactyl-style API nor a
// shell - but nearly all of them give file access (checked 19.09.2026 across
// the common hosters). Both directions of this bridge only ever need files,
// so FTP is enough: upload commands.txt, fetch the log in pieces.
//
// Two things make it slower and more careful than the local mode:
//  - every look costs a connection and a listing, so the interval is counted
//    in seconds, not milliseconds. How often a hoster tolerates it is not
//    documented anywhere; the default is deliberately lazy.
//  - a download can only start at an offset (REST), which every server of
//    the last twenty years supports, but not every one does correctly. If a
//    fetch comes back shorter than asked for, the file is read from the
//    start rather than guessing.
const DEFAULT_PATTERN = /^serverlog.*\.txt$/i;

// Collects bytes into whole lines. The same job the local tail does, and
// for the same reason: a fetch can end in the middle of a line, or in the
// middle of a character.
function createLineBuffer() {
  let rest = Buffer.alloc(0);
  return {
    push(chunk, onLine) {
      rest = Buffer.concat([rest, chunk]);
      let nl;
      // eslint-disable-next-line no-cond-assign
      while ((nl = rest.indexOf(0x0a)) !== -1) {
        onLine(rest.slice(0, nl).toString('utf8'));
        rest = rest.slice(nl + 1);
      }
    },
    clear() { rest = Buffer.alloc(0); },
    pending: () => rest.length,
  };
}

function createFtp({
  host,
  port = 21,
  user,
  password,
  secure = false,
  dir = '/',
  timeoutMs = 20000,
  log = () => {},
  clientFactory,
}) {
  const ftp = require('basic-ftp');
  let client = null;

  async function connected() {
    if (client && !client.closed) return client;
    client = clientFactory ? clientFactory() : new ftp.Client(timeoutMs);
    client.ftp.verbose = false;
    await client.access({ host, port, user, password, secure });
    log(`ftp: connected to ${host}:${port}`);
    return client;
  }

  // Every call gets a working connection, and a broken one is thrown away
  // instead of being nursed: the next call builds a new one.
  async function withClient(fn) {
    try {
      return await fn(await connected());
    } catch (err) {
      if (client) { try { client.close(); } catch { /* already gone */ } }
      client = null;
      throw err;
    }
  }

  const path = (name) => `${dir.replace(/\/+$/, '')}/${name}`;

  return {
    list: () => withClient(async (c) => c.list(dir)),
    exists: (name) => withClient(async (c) => (await c.list(dir)).some((e) => e.name === name)),
    upload: (name, text) => withClient(async (c) => {
      const { Readable } = require('stream');
      await c.uploadFrom(Readable.from([Buffer.from(text, 'utf8')]), path(name));
    }),
    rename: (from, to) => withClient(async (c) => c.rename(path(from), path(to))),
    size: (name) => withClient(async (c) => c.size(path(name))),
    // Fetches from byte `from` on. Returns a buffer, possibly empty.
    read: (name, from) => withClient(async (c) => {
      const chunks = [];
      const sink = new Writable({
        write(chunk, enc, cb) { chunks.push(chunk); cb(); },
      });
      await c.downloadTo(sink, path(name), from);
      return Buffer.concat(chunks);
    }),
    close: () => { if (client) { try { client.close(); } catch { /* already gone */ } } client = null; },
  };
}

module.exports = { createFtp, createLineBuffer, DEFAULT_PATTERN };
