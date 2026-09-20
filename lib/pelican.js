'use strict';

const WebSocket = require('ws');
const { EventEmitter } = require('events');

// Read-only connection to the server console through the Pelican client API.
// Endpoint: GET /api/client/servers/{id}/websocket -> { data: { token, socket } }
// Events (pelican-dev/wings): "auth", "auth success", "token expiring",
// "token expired", "console output".
//
// It only listens. Sending used to go through the "send command" event of
// this same socket; since 18.09.2026 it goes through commands.txt instead
// (see lib/commandsfile.js), because a long line on this channel closed the
// server's input for good.
//
// A connection can die without saying so. On 20.09.2026 the panel stopped
// sending at 02:53 and nothing came in for almost four hours: no 'close',
// no 'error', so the reconnect below never fired and the bridge kept
// reporting "connected" while the game chat was gone. Hence the idle clock:
// the panel sends 'token expiring' by itself every nine minutes, so silence
// for much longer than that means the line is dead, whatever the socket
// claims.
//
// Emits: 'line' (string), 'ready', 'down' (reason)
class PelicanConsole extends EventEmitter {
  constructor({ url, apiKey, serverId, reconnectDelayMs, fetchImpl, idleTimeoutMs = 900000, requestTimeoutMs = 15000 }) {
    super();
    this.url = url.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.serverId = serverId;
    // Not measured. Only there so a dead panel is not hammered in a loop.
    this.reconnectDelayMs = reconnectDelayMs;
    this.fetch = fetchImpl || fetch;
    this.ws = null;
    this.stopped = false;
    // 15 minutes. The observed heartbeat is nine, so this waits out one
    // missed beat before it acts - not measured further, just clearly
    // longer than the rhythm the log shows.
    this.idleTimeoutMs = idleTimeoutMs;
    this.idleTimer = null;
    // Node's fetch has NO timeout of its own. A request that is accepted and
    // then never answered waits for ever, and a token refresh that waits for
    // ever is a connection that is dead without anybody noticing
    // (20.09.2026). So every call to the panel gets a clock.
    this.requestTimeoutMs = requestTimeoutMs;
  }

  // Every frame from the panel counts as a sign of life, whatever it says.
  touch() {
    this.clearIdle();
    if (this.stopped || !this.idleTimeoutMs) return;
    this.idleTimer = setTimeout(() => this.onIdle(), this.idleTimeoutMs);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  onIdle() {
    this.idleTimer = null;
    this.emit('down', `nothing from the panel for ${Math.round(this.idleTimeoutMs / 60000)} min, reconnecting`);
    this.dropAndRetry();
  }

  // Throw this connection away and build a new one. The socket is taken out
  // of our hands first, so the close handler does not report the same
  // outage a second time.
  dropAndRetry() {
    this.clearIdle();
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.terminate(); } catch { /* already gone */ } }
    this.retry();
  }

  async credentials() {
    const res = await this.fetch(`${this.url}/api/client/servers/${this.serverId}/websocket`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
      ...(this.requestTimeoutMs ? { signal: AbortSignal.timeout(this.requestTimeoutMs) } : {}),
    });
    if (!res.ok) throw new Error(`websocket credentials: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    return body.data;
  }

  async start() {
    this.stopped = false;
    try {
      const { token, socket } = await this.credentials();
      this.open(socket, token);
    } catch (err) {
      this.emit('down', err.message);
      this.retry();
    }
  }

  open(socketUrl, token) {
    const ws = new WebSocket(socketUrl, { headers: { Origin: this.url } });
    this.ws = ws;
    ws.on('open', () => { this.touch(); this.send('auth', [token]); });
    ws.on('message', (data) => { this.touch(); this.onMessage(data); });
    ws.on('error', (err) => this.emit('down', err.message));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.clearIdle();
      this.ws = null;
      this.emit('down', 'socket closed');
      this.retry();
    });
  }

  retry() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.start(); }, this.reconnectDelayMs);
  }

  async onMessage(data) {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const args = msg.args || [];
    switch (msg.event) {
      case 'auth success':
        this.emit('ready');
        break;
      case 'console output':
        for (const chunk of args) for (const line of String(chunk).split('\n')) this.emit('line', line);
        break;
      case 'token expiring':
        try {
          const { token } = await this.credentials();
          this.send('auth', [token]);
        } catch (err) {
          // Not just reported: without a new token this connection is over
          // in a few minutes, and waiting for the panel to end it means
          // waiting for a panel we just failed to reach. Start again.
          this.emit('down', `token refresh failed: ${err.message}`);
          this.dropAndRetry();
        }
        break;
      case 'token expired':
      case 'jwt error':
        if (this.ws) this.ws.close();
        break;
      default:
        break;
    }
  }

  send(event, args) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ event, args }));
    return true;
  }

  stop() {
    this.stopped = true;
    this.clearIdle();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
  }
}

module.exports = { PelicanConsole };
