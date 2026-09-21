'use strict';

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, escapeMarkdown } = require('discord.js');
const { PelicanConsole } = require('./lib/pelican');
const { createCommandsFile } = require('./lib/commandsfile');
const { createLogTail } = require('./lib/logtail');
const { createLocalCommands } = require('./lib/localcommands');
const { createFtp } = require('./lib/ftp');
const { createFtpTail } = require('./lib/ftptail');
const { createFtpCommands } = require('./lib/ftpcommands');
const { createBridge } = require('./lib/bridge');
const { createAi, deepseekCaller } = require('./lib/ai');
const { createChatCommands, createFileTable } = require('./lib/chatcommands');
const { createAdminCommands } = require('./lib/admin');
const { createWatchdog } = require('./lib/watchdog');
const { createWelcome } = require('./lib/welcome');
const { createPresence, formatOnline } = require('./lib/presence');
const { createQuery, onlineCommand, parseOnline, bossCommand, parseBoss, formatBoss } = require('./lib/query');
const { createQuotes } = require('./lib/quotes');
const { routeDiscordMessage } = require('./lib/route');
const { trimStrings, mergeSecrets, strayKeys, textFromFile } = require('./lib/config');

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json is missing. Copy config.example.json to config.json and fill it in (see SETUP.md).');
  process.exit(1);
}
let config = trimStrings(JSON.parse(fs.readFileSync(configPath, 'utf8')));

// Everything that belongs to this installation - keys, ids and paths - may
// live in secrets.json and is laid over the configuration. An update can
// then take the new config.example.json as it is, without typing a token,
// a server id or a galaxy path back in.
const secretsPath = path.join(__dirname, 'secrets.json');
if (fs.existsSync(secretsPath)) {
  let secrets;
  try {
    secrets = trimStrings(JSON.parse(fs.readFileSync(secretsPath, 'utf8')));
  } catch (err) {
    console.error(`secrets.json is not readable: ${err.message}`);
    process.exit(1);
  }
  const stray = strayKeys(secrets, config);
  if (stray.length) {
    // Not fatal - but a value that lands nowhere has to be said out loud,
    // or the next hour goes into looking for it.
    log(`secrets.json: these do not exist in config.json and do nothing: ${stray.join(', ')}`);
  }
  config = mergeSecrets(config, secrets);
  log(`secrets.json in use (${Object.keys(secrets).length} entries on top of config.json)`);
}

// Three ways to reach the server:
//   "panel"  through Pelican/Pterodactyl, for a bridge that runs anywhere
//   "local"  the galaxy folder directly, for a bridge beside the server
//   "ftp"    the same files over FTP, for a rented server
// A setting still holding its example text counts as not filled in.
const isPlaceholder = (v) => /^fill in\b/i.test(String(v));

const mode = config.mode || 'panel';
if (!['panel', 'local', 'ftp'].includes(mode)) {
  console.error(`config.json: "mode" is "${mode}", expected "panel", "local" or "ftp".`);
  process.exit(1);
}
const needed = mode === 'panel'
  ? ['pelicanUrl', 'pelicanApiKey', 'serverId', 'discordToken', 'discordChannelId']
  : ['discordToken', 'discordChannelId'];
for (const key of needed) {
  if (!config[key] || isPlaceholder(config[key])) {
    console.error(`config.json: "${key}" is not filled in (secrets.json may fill it in instead).`);
    process.exit(1);
  }
}
const local = config.local || {};
const ftpConf = config.ftp || {};
if (mode === 'ftp') {
  for (const key of ['host', 'user', 'password', 'dir']) {
    if (!ftpConf[key] || isPlaceholder(ftpConf[key])) {
      console.error(`config.json: "ftp.${key}" is not filled in.`);
      process.exit(1);
    }
  }
}
if (mode === 'local') {
  if (!local.galaxyPath || isPlaceholder(local.galaxyPath)) {
    console.error('config.json: "local.galaxyPath" is not filled in (the folder that holds the galaxy and its logs).');
    process.exit(1);
  }
  if (!fs.existsSync(local.galaxyPath)) {
    console.error(`config.json: "local.galaxyPath" does not exist: ${local.galaxyPath}`);
    process.exit(1);
  }
}

// One connection to the files on the server, shared by both directions.
const ftpFiles = mode === 'ftp' ? createFtp({ ...ftpConf, log }) : null;

const consoleConn = mode === 'panel'
  ? new PelicanConsole({
    url: config.pelicanUrl,
    apiKey: config.pelicanApiKey,
    serverId: config.serverId,
    reconnectDelayMs: 10000,
    // A connection that goes quiet is rebuilt. 0 switches that off.
    idleTimeoutMs: ((config.console && config.console.idleMinutes) ?? 15) * 60000,
    // No request to the panel may wait for ever (20.09.2026).
    requestTimeoutMs: ((config.console && config.console.requestSeconds) ?? 15) * 1000,
  })
  : (mode === 'ftp'
    ? createFtpTail({ ftp: ftpFiles, pollMs: (ftpConf.pollSeconds || 5) * 1000, log })
    : createLogTail({
      dir: local.logDir || local.galaxyPath,
      fs,
      path,
      pollMs: local.pollMs || 500,
      log,
    }));
const sourceName = { panel: 'Pelican console', local: 'log tail', ftp: 'ftp tail' }[mode];
// Only changes are worth a line. The panel renews the token every nine
// minutes and every renewal ends in 'ready' again - saying "connected" each
// time filled the window with news that nothing had happened (20.09.2026).
consoleConn.on('ready', () => {
  const wasDown = !consoleConnected;
  consoleConnected = true;
  if (wasDown) log(`${sourceName} connected (listening)`);
});
consoleConn.on('down', (reason) => {
  const wasUp = consoleConnected;
  consoleConnected = false;
  if (wasUp || !consoleDownReported) log(`${sourceName} down: ${reason}`);
  consoleDownReported = true;
});

const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let channel = null;
// Optional private channel for admin commands and the notices of the bridge.
let adminChannel = null;
const adminChannelId = (config.admin && config.admin.channelId) || null;

async function postToDiscord(name, text) {
  if (!channel) return;
  await channel.send({
    content: `**${escapeMarkdown(name)}**: ${escapeMarkdown(text)}`,
    allowedMentions: { parse: [] },
  });
}

// Watches whether our commands still reach the server (see lib/watchdog.js).
const watchdog = createWatchdog({
  // Not measured. Clearly longer than the server needs to pick the file up,
  // which the "taken by the server after N ms" lines in the log will show.
  timeoutMs: (config.commands && config.commands.timeoutMs) || 20000,
  onDead: () => notifyDiscord('The server has stopped reading commands: messages from Discord are not reaching the game.'),
  onAlive: () => notifyDiscord('The server takes commands again.'),
  log,
});
setInterval(() => watchdog.tick(Date.now()), 5000).unref();

// Discord -> game. Not the console: a long line closes the server's input
// (18.09.2026), and GLaDOS answers are long by nature.
const commandsFile = mode === 'panel'
  ? createCommandsFile({
    url: config.pelicanUrl,
    apiKey: config.pelicanApiKey,
    serverId: config.serverId,
    watchdog,
    log,
    ...(config.commands || {}),
  })
  : (mode === 'ftp'
    ? createFtpCommands({
      ftp: ftpFiles,
      name: ftpConf.commandsFile || 'commands.txt',
      pollMs: (ftpConf.pollSeconds || 5) * 1000,
      watchdog,
      log,
      ...(config.commands || {}),
    })
    : createLocalCommands({
      file: path.join(local.galaxyPath, local.commandsFile || 'commands.txt'),
      fs,
      watchdog,
      log,
      ...(config.commands || {}),
    }));

// Asking the game a question: a /run that prints a marked line, and the
// answer picked out of what the server prints (see lib/query.js).
const query = createQuery({
  sendCommand: (line) => commandsFile.command(line),
  timeoutMs: ((config.console && config.console.querySeconds) ?? 8) * 1000,
  log,
});

// Notices go to the admin channel when there is one - they are operating
// information, not chat. "noticesToAdminChannel": false puts them back into
// the public channel.
function notifyDiscord(text) {
  const wantAdmin = !config.admin || config.admin.noticesToAdminChannel !== false;
  const target = (wantAdmin && adminChannel) || channel;
  if (!target) return;
  target.send({ content: text, allowedMentions: { parse: [] } })
    .catch((err) => log(`discord notice failed: ${err.message}`));
}

// An answer to a command goes back to the channel the command came from.
function replyIn(ch, text) {
  if (!ch) return;
  ch.send({ content: text, allowedMentions: { parse: [] } })
    .catch((err) => log(`discord reply failed: ${err.message}`));
}

// Optional chat companion. Off unless config.ai.enabled is true.
let ai = null;
if (config.ai && config.ai.enabled) {
  const factsPath = path.join(__dirname, 'server-facts.md');
  const facts = fs.existsSync(factsPath) ? fs.readFileSync(factsPath, 'utf8').trim() : '';
  // Knowledge for !help. Public only - it travels to the model with every
  // question and the companion may repeat any of it in open chat.
  const modFactsPath = path.join(__dirname, config.ai.modFactsFile || 'mod-facts.md');
  const modFacts = fs.existsSync(modFactsPath) ? fs.readFileSync(modFactsPath, 'utf8').trim() : '';
  if (!config.ai.apiKey || isPlaceholder(config.ai.apiKey)) {
    console.error('config.json: "ai.apiKey" is not filled in.');
    process.exit(1);
  }
  // The tone lives in its own file when there is one, so everybody can give
  // their companion a character of their own without touching config.json
  // (20.09.2026). The value in config.json stays as the fallback.
  const persona = textFromFile({
    fs,
    file: config.ai.personaFile ? path.resolve(__dirname, config.ai.personaFile) : null,
    fallback: config.ai.persona || '',
    log,
    what: 'persona',
  });
  ai = createAi({
    config: { maxHelpChars: 400, ...config.ai, persona, facts, modFacts },
    sendChat: (text) => bridge.send(config.ai.botName, text, { raw: true }),
    callModel: deepseekCaller({
      baseUrl: config.ai.baseUrl,
      apiKey: config.ai.apiKey,
      model: config.ai.model,
      timeoutMs: 30000,
    }),
    log,
  });
  log(`AI companion active as "${config.ai.botName}" (${config.ai.model}), ${facts ? 'with' : 'without'} server facts, ${modFacts ? `${modFacts.length} characters of mod notes for !help` : 'NO mod notes - !help cannot answer'}`);
}

// Quotes (!quote), like the Twitch bot. Adding and removing is admin-only,
// and "admin" here means a Discord id from admin.discordUserIds - a name in
// the game chat proves nothing, so in the game only reading works.
let quotes = null;
if (!config.quotes || config.quotes.enabled !== false) {
  const qc = config.quotes || {};
  quotes = createQuotes({
    file: path.resolve(__dirname, qc.file || 'quotes.json'),
    fs,
    log,
  });
  log(`quotes active (${quotes.count()} in ${path.resolve(__dirname, qc.file || 'quotes.json')})`);
}
const isAdminUser = (id) => ((config.admin && config.admin.discordUserIds) || [])
  .map(String).includes(String(id));

// Fun commands in the game chat (!hug, !love, !8ball, plus chat-commands.json).
// Off only if "chatCommands": { "enabled": false } says so.
let chatCommands = null;
if (!config.chatCommands || config.chatCommands.enabled !== false) {
  const cc = config.chatCommands || {};
  const tablePath = path.resolve(__dirname, cc.file || 'chat-commands.json');
  // The name the answers appear under in the game. Not "Server": the bridge
  // skips <Server> lines when reading, so they would never reach Discord.
  const cmdName = cc.botName || (config.ai && config.ai.botName) || 'Bot';
  chatCommands = createChatCommands({
    config: { ...cc, botName: cmdName },
    // !ai belongs to the chat companion, but players should find it in the list
    extraCommands: [...(ai ? ['!ai', '!help'] : []), ...(quotes ? ['!quote'] : []), '!online', '!boss'],
    // !quote, !online and !boss run through the same cooldowns as everything else.
    handlers: [
      ...(quotes ? [{
        commands: ['!quote', '!addquote'],
        run: ({ cmd, user, rest, isAdmin }) => quotes.handle({
          text: `${cmd} ${rest}`.trim(), user, isAdmin,
        }).reply,
      }] : []),
      // Asked of the game itself, not answered from memory: the bridge only
      // knows the joins it has seen, so after a restart it would say nobody
      // is there while the server is full (20.09.2026). The list the bridge
      // has seen is the fallback when the server does not answer.
      {
        commands: ['!online'],
        run: () => query.ask(onlineCommand).then((answer) => {
          const names = parseOnline(answer);
          if (names === null) return formatOnline(presence.names());
          return names.length ? `Online (${names.length}): ${names.join(', ')}` : 'Nobody online.';
        }),
      },
      // Is a Behemoth or Leviathan out, and where. Read from the galaxy's own
      // event script, so it is right after a restart too.
      {
        commands: ['!boss'],
        run: () => query.ask(bossCommand).then((answer) => formatBoss(parseBoss(answer))),
      },
    ],
    sendChat: (text) => bridge.send(cmdName, text, { raw: true }),
    loadTable: createFileTable({ path: tablePath, fs, log }),
    log,
  });
  log(`chat commands active as "${cmdName}" (table: ${tablePath})`);
}

// Who is online, as far as the console has said (for !status).
const presence = createPresence();
const startedAt = Date.now();
let consoleConnected = false;
let consoleDownReported = false;
let quiet = false;
let replyTo = null; // the channel the admin command we are handling came from

// Greeting for a newly created player. Off unless "welcome" says otherwise.
let welcome = null;
if (config.welcome && config.welcome.enabled) {
  const wName = config.welcome.botName || (config.ai && config.ai.botName) || 'Bot';
  welcome = createWelcome({
    config: { delayMs: 10000, ...config.welcome },
    sendChat: (text) => bridge.send(wName, text, { raw: true }),
    log,
  });
  log(`welcome active as "${wName}" (${config.welcome.delayMs ?? 10000} ms after a player is created)`);
}

// A command line is answered and then finished with - the chat companion
// does not get to see it as well.
function onPlayerChat(name, text) {
  // The last line said in the game, for "!quote this".
  if (quotes) quotes.remember(name, text);
  // isAdmin stays false here: the game chat carries a Steam name and nothing
  // else, so nobody can prove anything in it.
  if (chatCommands && chatCommands.onChat(name, text).handled) return undefined;
  // !quiet from Discord silences the companion only - commands and echoes
  // keep working, because those cost nothing and nobody complained about them.
  if (quiet) return undefined;
  return ai ? ai.onChat(name, text) : undefined;
}

const bridge = createBridge({
  consoleConn,
  skipCoordinatePings: config.discord ? config.discord.skipCoordinatePings !== false : true,
  commandSink: commandsFile,
  postToDiscord,
  log,
  onPlayerChat,
  onServerLine: (line) => {
    if (query.onLine(line)) return; // an answer to one of our questions
    presence.onLine(line);
    if (welcome) welcome.onLine(line);
  },
});

discord.once(Events.ClientReady, async (c) => {
  log(`Discord logged in as ${c.user.tag}`);
  channel = await c.channels.fetch(config.discordChannelId);
  log(`Discord channel: #${channel.name}`);
  if (adminChannelId) {
    try {
      adminChannel = await c.channels.fetch(adminChannelId);
      log(`Discord admin channel: #${adminChannel.name}`);
    } catch (err) {
      log(`admin channel ${adminChannelId} not reachable: ${err.message} - admin commands stay in #${channel.name}`);
      adminChannel = null;
    }
  }
  consoleConn.start();
});

// Admin commands from Discord (!reboot, !save). Discord hands us a user id
// that cannot be chosen freely - in the game chat there is only a Steam name,
// and that is not proof of anything.
let admin = null;
if (config.admin && config.admin.enabled !== false) {
  admin = createAdminCommands({
    config: config.admin,
    sendCommand: (line) => commandsFile.command(line),
    reply: (text) => replyIn(replyTo || adminChannel || channel, text),
    log,
    status: () => {
      const cs = commandsFile.stats();
      return {
        consoleConnected,
        commandsDead: watchdog.isDead(),
        commandsFailing: cs.failures,
        lastTakenMs: cs.lastTakenMs,
        queued: cs.queued,
        quiet,
        playersOnline: presence.count(),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      };
    },
    sayInGame: (text) => bridge.send(config.admin.sayName || 'Server', text, { raw: true }),
    setQuiet: ai ? (v) => { quiet = v; } : null,
  });
  const n = (config.admin.discordUserIds || []).length;
  log(`admin commands active for ${n} Discord ${n === 1 ? 'account' : 'accounts'}`);
}

discord.on(Events.MessageCreate, (msg) => {
  if (msg.author.bot || msg.webhookId) return;
  const where = routeDiscordMessage({
    channelId: msg.channelId,
    chatChannelId: config.discordChannelId,
    adminChannelId: adminChannel ? adminChannelId : null,
  });
  if (where === 'ignore') return;
  const name = msg.member?.displayName || msg.author.globalName || msg.author.username;
  // An admin command is answered in Discord and never goes into the game.
  if (admin && where !== 'chat') {
    replyTo = where === 'admin' ? adminChannel : channel;
    if (admin.onMessage({ userId: msg.author.id, userName: name, text: msg.cleanContent }).handled) return;
  }
  if (where === 'admin') {
    // Not relayed into the game - but !quote is answered right there, so a
    // quote can be added without the whole server watching.
    if (quotes) {
      const q = quotes.handle({ text: msg.cleanContent, user: name, isAdmin: isAdminUser(msg.author.id) });
      if (q.handled && q.reply) replyIn(adminChannel, q.reply);
    }
    return;
  }
  bridge.fromDiscord(name, msg.cleanContent);
  // Chat commands and echoes from Discord too (19.09.2026). The line itself
  // still goes into the game first, so players see what was answered. The
  // chat companion (!ai, !help) stays out of this on purpose - it would make
  // Discord a second, cheaper door to the model.
  if (chatCommands && (!config.chatCommands || config.chatCommands.fromDiscord !== false)) {
    chatCommands.onChat(name, msg.cleanContent, { isAdmin: isAdminUser(msg.author.id) });
  }
});

discord.login(config.discordToken);

function shutdown() {
  log('stopping');
  commandsFile.stop();
  consoleConn.stop();
  discord.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
