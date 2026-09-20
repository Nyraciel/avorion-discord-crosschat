# FTP mode

For rented servers. Most Avorion hosters give you neither a
Pterodactyl-style API nor a shell, but nearly all of them give you file
access — and files are all this bridge ever needs: it uploads
`commands.txt` and reads the server log in pieces.

This is the slowest and least tested of the three modes. It runs against a
real FTP server in the test suite, but no hoster has been tried. Read
"What can go wrong" at the bottom before you rely on it.

---

## Before anything else: is it FTP?

`"mode": "ftp"` speaks **FTP** and **FTPS** (FTP with TLS, `"secure": true`).

It does **not** speak **SFTP**. SFTP looks similar and is often offered in
the same sentence by hosters, but it is a different protocol — it rides on
SSH and has nothing to do with FTP. If your hoster gives you SFTP only, this
mode cannot connect, and you will see a timeout or a garbled greeting rather
than a clear error.

Port 21 is usually FTP, port 22 is SFTP. If in doubt, ask your hoster
literally: *"Do you offer plain FTP or FTPS on port 21, or only SFTP?"*

---

## Step 1: Get an FTP program and check the access by hand

Do this before touching `config.json`. It takes two minutes and it tells you
straight away whether the mode can work at all — and if it cannot, you learn
it from a program with a proper error message instead of from a bridge log.

**Recommended: WinSCP** (Windows, free, open source) —
<https://winscp.net/eng/download.php>

Two panes, your PC on the left, the server on the right, remembers the
login, and it does FTP, FTPS and SFTP, so it also answers the question
above for you: if it connects as "FTP" it will work here, if only "SFTP"
works, it will not.

**Alternative: FileZilla Client** (Windows, Linux, macOS, free) —
<https://filezilla-project.org/>

Same job, runs everywhere. Two warnings: download it from that page and
nowhere else, and decline any extra software the Windows installer offers.
And take the **Client**, not the **Server** — FileZilla Server is a
different program that hands out files from *your* PC; you do not need it
for a rented server. (You do need it, or the little test server below, if
you want to try FTP mode against a server you host yourself.)

Both are free. Do not pay for an FTP program for this.

### The four things that must work

Connect with host, user, password from your hoster's panel, then check:

1. **You can see the galaxy folder** — the one holding `server.ini` and
   files named `serverlog 2026-09-20 16-05-51.txt`. Note the path the
   program shows while you are in it; that is your `dir`.
2. **You can open the newest `serverlog*.txt`** and see chat lines in it.
3. **You can upload a file** into that folder. Drag any small text file in.
4. **You can rename it and delete it again.**

If 1 or 2 fails, the bridge cannot read chat. If 3 or 4 fails, it can read
but not send — the account is read-only and your hoster has to change that.
Ask them for "write access to the galaxy folder over FTP".

Delete your test file afterwards. Do **not** leave a file called
`commands.txt` lying around: the server runs whatever is in it.

---

## Step 2: Fill in the config

```json
"mode": "ftp",
"ftp": {
  "host": "ftp.yourhost.example",
  "port": 21,
  "user": "your ftp user",
  "password": "your ftp password",
  "secure": false,
  "dir": "/avorion/galaxies/yourgalaxy",
  "commandsFile": "commands.txt",
  "pollSeconds": 5
}
```

- **`host`** — without `ftp://`, just the address.
- **`secure`** — `true` for FTPS. **Use it if your hoster offers it.** Plain
  FTP sends your password across the internet in clear text, and that
  password controls your server (see below).
- **`dir`** — exactly the path your FTP program showed in Step 1, with
  forward slashes. Often this is `/` if the account starts you in the right
  folder already.
- **`pollSeconds`** — how often the bridge looks. See below before lowering
  it.

Host, user and password belong in `secrets.json`, not in `config.json`, so
that an update cannot lose them:

```json
{ "ftp": { "host": "...", "user": "...", "password": "..." } }
```

Then start as usual: `npm start`.

---

## Step 3: What a working start looks like

    ftp: connected to ftp.yourhost.example:21
    ftp tail: reading serverlog 2026-09-20 16-05-51.txt from byte 48213
    console: connected

The first chat line from the game shows up in Discord within
`pollSeconds`. `!status` in Discord tells you whether commands are arriving.

### Errors and what they mean

| What you see | What it is |
|---|---|
| `530 ...` | user or password wrong |
| `550 ...` on upload or rename | the account may read but not write — ask the hoster |
| `ECONNREFUSED` | nothing is listening on that port — wrong port, or SFTP only |
| `ETIMEDOUT`, or it hangs at connect | firewall, wrong host, or SFTP only |
| connects, then times out on every listing | passive mode is being blocked — ask the hoster for the passive port range, or try `"secure": true` |
| `ftp tail: no log file ...` | `dir` points at the wrong folder, or the server has not written a log yet |

The bridge reports each of these once and keeps trying; it does not spam the
log with the same failure.

---

## What can go wrong

**How often a hoster tolerates polling is not documented anywhere.**
`pollSeconds: 5` means roughly one connection and one listing every five
seconds, around 17,000 a day. Some hosters will not care; some throttle;
some see it as abuse. If yours complains, raise the number — chat then
arrives later, which is a fair trade. Do not go below 2.

**An FTP listing only tells you the minute a file changed.** Measured
2026-09-20: two logs written a second apart both reported `Sep 20 15:27`.
The newest log is therefore found by its **name**, which works because
Avorion writes `serverlog 2026-09-20 16-05-51.txt`, date first, so sorting
names sorts by age. A hoster who renames logs would break that.

**Whoever has this FTP password controls your server.** The bridge sends
commands by putting `/run ...` lines into `commands.txt`, and the server
runs them. Anyone with write access to that folder can do the same. Keep the
password in `secrets.json`, keep `secrets.json` out of git (it already is,
via `.gitignore`), and use a separate FTP account for the bridge if your
hoster lets you make one.

**It is untested against a real hoster.** If you run it on one, please open
an issue and say which hoster and whether it worked — the honest state of
this mode is "works against a real FTP server in the test suite, nobody has
reported from the wild yet".
