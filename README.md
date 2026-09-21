# Avorion Crosschat

**Two-way chat bridge between an Avorion server and a Discord channel.**
No mod, no plugin, nothing installed on the server.

    in game:  <nyx> shipyard finally finished :)
    Discord:  nyx: shipyard finally finished :)

    Discord:  Ada: back in 10 minutes
    in game:  <[Discord] Ada> back in 10 minutes

On top of the relay: chat commands, a quote collection, admin commands from
Discord, a greeting for new players, and an optional AI chat companion.

Node.js 18 or newer. Windows, Linux and macOS.

## How it reaches the server

Set `"mode"` in `config.json`:

| | `panel` | `local` | `ftp` |
|---|---|---|---|
| Runs on | any machine | the machine the server runs on | any machine |
| Reads chat from | the panel console | the server's log file | the log over FTP |
| Sends commands via | the panel file API | writing `commands.txt` | uploading `commands.txt` |
| Needs | a panel API key | a path | FTP access |
| Delay | immediate | 0.5 s | 5 s |

`panel` works with **Pelican and Pterodactyl** — same client API, same
websocket, same wings protocol. Used daily against Pelican; against
Pterodactyl it is untested.

`ftp` speaks FTP and FTPS, **not SFTP**. It has been driven end to end
against a running server, but **never against a rented one** — see
**[FTP.md](FTP.md)** before you rely on it.

## How it works

The server prints every public chat line as `<Name> text`. The bridge reads
those and posts them to Discord. Skipped: `<>`, `<Server>` and the bridge's
own `[Discord]` lines.

The other way, the bridge writes

    /run Server():broadcastChatMessage("[Discord] Name", ChatMessageType.Normal, "text")

into `commands.txt` in the galaxy folder. Avorion picks that file up by
itself, runs it and deletes it. The file disappearing is the only honest
proof the server is alive, so three rules hold: never write while the file is
still there, write under a temporary name and rename it into place, and treat
the deletion — not any echo — as the acknowledgement.

Alliance chat and whispers never reach the console and cannot leak into
Discord. Sector chat does. Party chat is untested.

## Security

Every line the bridge sends leaves as `/run` with full admin rights. That is
the whole reason for the following.

- **Nothing a player or a Discord user types is ever executed.** Their text
  only ever ends up inside a Lua string. Escaping covers `"`, `\` and control
  characters; without an unescaped quote the string never ends, without an
  unescaped backslash no other escape can form.
- **Admin commands are accepted only from Discord**, and only from user IDs
  on a list. A name in the game chat proves nothing — Steam names change in
  half a minute. A Discord user ID cannot be chosen freely.
- **No chat command does anything in the game.** They return text. There is
  no way to add a command from chat either.
- **The companion has no tools, no server access and no files.**
- Whoever holds your `config.json` or `secrets.json` controls your server.
  Both are in `.gitignore` for that reason.

## Setup

**[SETUP.md](SETUP.md)** goes through it step by step. Short version:

1. `npm install`
2. Copy `config.example.json` to `config.json` and fill it in
3. Copy `chat-commands.example.json` to `chat-commands.json`
4. `npm start`

Anything personal — tokens, IDs, paths — can go into `secrets.json` instead
(`secrets.example.json` shows how). It is laid over `config.json` at startup,
so an update can take the new `config.example.json` as it is.

## Chat commands

Text only, in the game chat and — unless you switch that off — from Discord.

    !hug <name>      a hug, strength 1-100 %
    !love <name>     a percentage
    !slap <name>     0-100 % damage, 5 % chance of a critical hit
    !duel <name>     two rolls, higher one wins
    !online          who is on the server right now, asked of the game
    !boss            whether a Behemoth or Leviathan is out, and where
    !8ball <question>
    !quote           see below
    !commands        lists everything that exists right now

Everything else lives in `chat-commands.json`, which is **re-read while
running** — a new command is live within five seconds, no restart:

    "!discord": "Join us: https://example.com/invite"
    "!fortune": ["line A", "line B"]     a list = one at random
    "meow":     "Meow"                   no ! = answers the bare word

`{user}` becomes whoever typed, `{target}` the name they gave. An echo fires
on the bare word and on words starting with it ("meowww"), not inside a
sentence. Echoes are not listed by `!commands`.

The built-in commands are switched at the top of the same file:

    "_enabled": { "!slap": false, "!8ball": true }

`false` and the command answers nothing and is not listed. It works for
entries from the file too. `!ai` and `!help` are not in there — they belong to
the companion and follow `ai.enabled`.

Brakes: `globalCooldownSeconds` (3) for everyone, `cooldownSeconds` (10) per
player. A broken `chat-commands.json` takes nothing down; the last working
version stays in use.

## Quotes

    !quote                        a random one
    !quote 12                     that one
    !quote search <text>          a random one containing it
    !quote add <text> - <name>    admin only
    !quote this                   admin only, takes the last line said in game
    !quote remove 12              admin only

Reading works for everyone. Adding and removing work **only from Discord**,
for an ID in `admin.discordUserIds`. Numbers are never reused. Stored in
`quotes.json`.

## Admin commands from Discord

Only from Discord, only from the IDs in `admin.discordUserIds`.

    !reboot        /save + /stop, asks first, confirm with !reboot yes
    !save          save once
    !status        console, commands, players seen, uptime
    !say <text>    an announcement in game
    !quiet         the companion goes silent
    !loud          and back again

An empty list refuses everything and answers with the caller's own ID — which
is how you fill it. Put a private channel's ID in `admin.channelId` and admin
commands are accepted and answered only there; nothing from that channel goes
into the game.

## AI chat companion (optional)

Off by default (`ai.enabled`). With it off, nothing is sent and nothing is
spent.

- Answers only when addressed: `!ai <question>`, or its name in a sentence.
- One line, capped by `maxReplyChars`. Brakes: `maxRepliesPerHour`,
  `cooldownSeconds`.
- `persona` sets the tone, or `personaFile` for a file of its own
  (`persona.example.md` is a starting point).
- It chats. It does not carry out orders, take on tasks, or speak for the
  admin.
- It answers in the game, not in Discord — that would be a second, cheaper
  door to the model.
- `!help <question>` is the same companion without persona: factual, short,
  and strictly about Avorion and the mods on this server.

**What leaves the house.** The companion gets three things and nothing else:
the last `historyLines` chat lines, the question, and the two fact files
(`server-facts.md`, `mod-facts.md`). Those travel to the provider with every
request, so both files must hold **only what is public anyway**. The prompt
does tell it to keep quiet about the rest, but a prompt rule is a request,
not a lock.

Provider is DeepSeek. Any provider with the same request format works through
`baseUrl` and `model`.

## Greeting new players

`<Server> Player <Name> created!` appears once per player, and the bridge
answers it with a fixed text from `config.json` (`welcome.text`, `{user}`
becomes the name). No model call. Sent after `welcome.delayMs` because the
player is still on the loading screen — raise it if newcomers miss the line.
Off by default.

## Map pings stay out of Discord

Clicking a sector in game writes `(-259:-40)` into the chat: a ping in game,
noise in Discord. Lines consisting only of coordinates are dropped;
`look at (-259:-40)` goes through. Off with
`"discord": { "skipCoordinatePings": false }`.

## Configuration

`config.example.json` carries every setting with a comment on what it does.
**[SETUP.md](SETUP.md)** explains where the values come from.

## License

MIT — see [LICENSE](LICENSE).
