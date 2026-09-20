# Setup, start to finish

Everything needed to connect an Avorion server's chat with a Discord channel.
Takes about 20 minutes, most of it in Discord's developer portal.

You need Node.js 18 or newer (`node -v` to check) and a machine that stays on
for as long as the bridge should run.

---

## Step 1: Decide which mode you need

**`local`** — the bridge runs on the same machine as the Avorion server.
Reads the server's log file, writes `commands.txt` directly. No panel, no API
key, no credentials beyond the Discord token. Use this if you host the server
yourself, including with the client's built-in
*Multiplayer → Dedicated Server* option.

**`panel`** — the bridge runs anywhere and talks to a **Pelican** or
**Pterodactyl** panel. Use this if you rent a server on one of those panels.

**`ftp`** — the bridge runs anywhere and reaches the server's files over FTP.
This is the mode for most rented servers: no API and no shell, but file
access. Slower than the other two and the least tested — see the README
before you rely on it.

A hoster that gives neither an API, nor a shell, nor FTP cannot run this.

---

## Step 2: Create the Discord application

1. Open https://discord.com/developers/applications and log in.
2. **New Application**, give it a name, accept, **Create**.

## Step 3: Keep the bot private (optional but tidy)

Discord only allows a private bot if the application offers no install link of
its own.

1. **Installation** → set **Install Link** to **None**, save.
2. **Bot** → turn **Public Bot** off, save.
3. **Requires OAuth2 Code Grant** must stay off, or inviting it fails.

Leaving Public Bot on only means someone with your client ID could add the bot
to their own Discord server. It gives them no access to your Avorion server.

## Step 4: Turn on the Message Content Intent

Without it Discord refuses to let the bot start at all
("Used disallowed intents").

1. **Bot** → scroll to **Privileged Gateway Intents**.
2. Turn on **Message Content Intent**.
3. **Save Changes**.

Presence Intent and Server Members Intent stay off.

## Step 5: Get the bot token

The token is shown once. If you did not copy it, generate a new one — the old
one stops working, nothing else happens.

1. **Bot** → **Token** → **Reset Token** → confirm.
2. Copy it straight away. It is the bot's password: not into chats, not onto
   screenshots.

## Step 6: Invite the bot

1. **OAuth2** → **URL Generator**.
2. Under **Scopes** tick only **bot**.
3. Under Bot Permissions tick exactly three: **View Channel**,
   **Send Messages**, **Read Message History**.
4. If an **Integration Type** field appears: **Guild Install**, not User
   Install.
5. Open the generated URL, pick your Discord server, confirm.

By hand, with your client ID filled in:

    https://discord.com/oauth2/authorize?client_id=YOUR_ID&scope=bot&permissions=68608

## Step 7: Copy the channel ID

1. Discord → gear icon → **Advanced** → turn on **Developer Mode**.
2. Right-click the chat channel → **Copy Channel ID**.

The bridge reads and writes in this one channel only.

---

## Step 8a: local mode — find the galaxy folder

The galaxy folder is the one holding `server.ini`, the sector files and the
`serverlog ....txt` files. With the client's built-in dedicated server the
path is shown in the hosting dialog, typically:

    C:\Users\<you>\AppData\Roaming\Avorion\galaxies\<galaxy>

On Linux, typically:

    ~/.avorion/galaxies/<galaxy>

That path goes into `local.galaxyPath`. If your logs live somewhere else, put
that folder into `local.logDir`; otherwise leave it empty.

Nothing needs to be enabled on the server: reading `commands.txt` from the
galaxy folder is stock behaviour. The server's start log names the path it
uses.

## Step 8c: ftp mode — the access data

From your hoster's panel: address, user, password, and the folder that holds
the galaxy (the one with `server.ini` and the `serverlog ....txt` files).
Those go into the `ftp` block. `"secure": true` switches on FTPS, which most
hosters offer and which you should prefer if they do.

**Check the access with an FTP program first** — WinSCP or FileZilla
Client, both free. You must be able to see the galaxy folder, open the
newest `serverlog*.txt`, and upload, rename and delete a file in it. If you
can do all four, the bridge can too; if you cannot, no amount of config will
help.

Note that **SFTP is not FTP** and is not supported here. Many hosters offer
only SFTP.

**[FTP.md](FTP.md) walks through all of this**, including what the errors
mean and how to try the mode without renting a server.

## Step 8b: panel mode — API key and server ID

1. In the panel, top right, your **account/profile** → **API Keys** → create
   one. This is the account key, **not** the "Application API Key" from the
   admin area — that one is for panel administration and does not work here.
   Leave "Allowed IPs" empty. The key is shown once.
2. Open your Avorion server in the panel. The server ID is in the address bar
   after `/server/`. If it is wrong the bridge reports `HTTP 404`.
3. `pelicanUrl` is the panel's address without any path, e.g.
   `https://panel.yourhost.com`.

This key may write files in the server folder, and that is how `/run` commands
get in. Whoever has it controls the server. Never share `config.json`.

---

## Step 9: DeepSeek key (only for the AI companion)

Create an API key on the DeepSeek platform. Base URL and model go into the
`ai` block; the example file ships with `https://api.deepseek.com`.

Without AI: leave `"enabled": false` and nothing is called and nothing is
spent.

## Step 10: Fill in config.json

In the bridge folder:

1. Copy `config.example.json` and rename the copy to `config.json`.
   Optional but recommended: also copy `secrets.example.json` to
   `secrets.json` and put your keys, ids and paths in there instead. They are
   laid over `config.json` at startup, and an update can then take a fresh
   `config.json` without you typing any of it back in.
2. Copy `chat-commands.example.json` to `chat-commands.json`. This file holds
   your own text commands. The built-in ones (`!hug`, `!slap`, `!online` and
   the rest) are in the code, but the `"_enabled"` block at the top of the
   file lists them and switches any of them off.
3. Fill in:

       mode              "local" or "panel"
       discordToken      from step 5
       discordChannelId  from step 7

   local mode:

       local.galaxyPath  from step 8a

   panel mode:

       pelicanUrl        from step 8b
       pelicanApiKey     from step 8b
       serverId          from step 8b
       commands.filePath the galaxy path inside the container,
                         e.g. /galaxy/Avorion/commands.txt

4. In the `ai` block, if you want the companion:

       enabled           true
       apiKey            from step 9
       botName           the name it answers to
       maxRepliesPerHour 180
       cooldownSeconds   10     per player
       maxReplyChars     200    length of one answer
       historyLines      15     how many chat lines it sees
       personaFile       persona.md, a file with the tone it should have
                         (copy persona.example.md); "persona" in this file
                         is used when there is no such file

## Step 11: Admin commands (optional)

In the `admin` block, `discordUserIds` lists the Discord accounts allowed to
use `!reboot`, `!save`, `!status`, `!say` and `!quiet`. Empty means nobody.

Your own ID: Discord → Settings → Advanced → Developer Mode, then right-click
your name → **Copy User ID**. Or just type `!reboot` in the channel — the
bridge answers with your ID.

For a private admin channel, put its ID into `admin.channelId` and give the
bot the same three rights there.

## Step 12: Tell the companion about your server

`server-facts.md` holds everything the companion may say about your server.
What is not in there, it does not know, and it says so. `mod-facts.md` holds
what `!help` knows about your mods.

Both files are sent to the AI provider with every request, so **put only
public information in them**. Copy the `.example` files and edit.

Both are read at startup, so restart the bridge after a change.

## Step 13: Start it

    npm install
    npm start

On Windows `start.cmd` does both and restarts the bridge if it crashes.

It works when the window says:

    Discord logged in as ...
    Discord channel: #...
    log tail connected (listening)            (local mode)
    Pelican console connected (listening)     (panel mode)

## Step 14: Check it

1. Type in the game's general chat → it appears in Discord.
2. Type in the Discord channel → it appears in game as `<[Discord] Name> text`.
3. Type `!commands` in game → the list comes back.
4. Type `!reboot` in Discord → you get a confirmation question, not a reboot.
   Anyone not on the admin list gets their own ID instead.

After the first Discord message the window shows this line **once**:

    commands.txt taken by the server after 640 ms (said once)

That is the proof the server really picks the file up, and the measurement of
how long it takes. It is said once per start and never again — a line per
message is noise, and the bridge says it by itself when commands stop
arriving. If that line never comes at all, the server is not reading the
file: check the path, and check `commandsFile` in the server configuration.

---

## When something does not work

**"Used disallowed intents"**
Step 4 is missing: turn on the Message Content Intent and save.

**`HTTP 404` when connecting to the panel**
Wrong `serverId` or wrong `pelicanUrl`.

**`HTTP 401` or `403`**
Wrong or expired panel key, or it is the application key from the admin area
instead of the account key (step 8b).

**`no log file in ...` (local mode)**
`local.galaxyPath` points somewhere without a `serverlog ....txt`. The server
has to have been started at least once.

**The bridge runs but ignores Discord messages**
Wrong `discordChannelId`, or the bot cannot see the channel (channel settings
→ permissions → the bot's role).

**Messages from Discord do not arrive in game**
The bridge reports this by itself in Discord ("The server has stopped reading
commands"). The window says why:

- `file check: HTTP 403` or `404` — the panel key may not read the folder, or
  the path points nowhere
- `EACCES` (local mode) — the bridge may not write in the galaxy folder
- no `taken by the server` line at all — the server is not reading the file.
  Check `commandsFile` in the server configuration; the server's start log
  names the path it uses
- the file stays put — the server is hung or dead

A logged-in admin can still intervene through the game chat in all of these
cases.

**The companion does not answer**
- is `"enabled": true` and the key filled in?
- was it actually addressed? Only `!ai ...` or its name in the sentence
- brakes: 10 seconds per player, 180 answers per hour by default
- the window names the cause, e.g. `ai: model call failed: HTTP 402`
  (no credit) or `HTTP 401` (wrong key)

**It should sound different**
Change `persona` in `config.json` and restart.
