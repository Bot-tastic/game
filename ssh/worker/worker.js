// Cloudflare Worker relay for the web SSH client (the hub's /ssh page).
//
// Browsers can't open TCP connections, so the SSH page sends its (already
// encrypted) SSH traffic over a WebSocket to this Worker, which forwards it to
// the SSH server's TCP port. The SSH handshake, encryption and login all happen
// in the browser: this Worker never sees passwords, keys or what you type.
//
// Settings (Worker → Settings → Variables and Secrets):
//   TOKEN   (secret, required)  long random string; the page must present it
//   ALLOW   (required)          comma-separated SSH targets the page may reach,
//                               e.g. "myserver.example.com:22, 203.0.113.7:2222"
//   ORIGIN  (optional)          page origin(s) allowed to connect, comma-separated
//                               (default https://bot-tastic.github.io)
//
// The file has no dependencies, so it can be pasted straight into the
// Cloudflare dashboard's editor (works from Safari on an iPad). When the whole
// hub runs on Workers (wrangler.jsonc at the repo root), worker/index.js serves
// this relay at /ssh/relay and no separate Worker is needed.

import { connect } from 'cloudflare:sockets';

const DEFAULT_ORIGIN = 'https://bot-tastic.github.io';
const PROTOCOL = 'ssh-relay';
const TOKEN_PREFIX = 'token.';

export default {
  async fetch(request, env) {
    const configured = Boolean(env.TOKEN && env.TOKEN.length >= 32 && env.ALLOW);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      // The SSH page probes this header to offer a relay on its own origin.
      return new Response('SSH relay. Open the SSH page and use this address as the relay.\n', {
        headers: { 'X-SSH-Relay': configured ? 'ready' : 'not-configured' },
      });
    }

    const origin = request.headers.get('Origin') || '';
    const origins = (env.ORIGIN || DEFAULT_ORIGIN).split(',').map((s) => s.trim().replace(/\/+$/, ''));
    if (!origins.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }

    // The token travels in the WebSocket subprotocol header rather than the URL,
    // so it doesn't end up in request logs.
    const offered = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim());
    const presented = offered.find((p) => p.startsWith(TOKEN_PREFIX))?.slice(TOKEN_PREFIX.length) || '';
    if (!env.TOKEN || env.TOKEN.length < 32) {
      return new Response('Relay not configured: set a TOKEN secret of at least 32 characters', { status: 500 });
    }
    if (!offered.includes(PROTOCOL) || !(await sameSecret(presented, env.TOKEN))) {
      return new Response('Bad token', { status: 401 });
    }

    const url = new URL(request.url);
    const host = (url.searchParams.get('host') || '').trim().toLowerCase();
    const port = Number(url.searchParams.get('port') || '22');
    const allow = new Set((env.ALLOW || '').split(',').map((s) => normalizeTarget(s)).filter(Boolean));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return new Response('Bad target', { status: 400 });
    }
    if (!allow.has(`${host}:${port}`)) {
      return new Response('Target not allowed', { status: 403 });
    }

    let socket;
    try {
      socket = connect({ hostname: host, port });
      await socket.opened;
    } catch (err) {
      return new Response('Could not reach SSH server', { status: 502 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    relay(server, socket);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': PROTOCOL },
    });
  },
};

function relay(ws, socket) {
  const writer = socket.writable.getWriter();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { ws.close(1000, 'closed'); } catch {}
    socket.close().catch(() => {});
  };

  // Writes are chained so bytes reach the server in order.
  let pending = Promise.resolve();
  ws.addEventListener('message', (event) => {
    pending = pending.then(async () => writer.write(await toBytes(event.data))).catch(close);
  });
  ws.addEventListener('close', close);
  ws.addEventListener('error', close);

  (async () => {
    const reader = socket.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        ws.send(value);
      }
    } catch {}
    close();
  })();
}

// Binary messages may arrive as ArrayBuffer or Blob depending on the runtime.
async function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(await data.arrayBuffer());
}

function normalizeTarget(s) {
  s = s.trim().toLowerCase();
  if (!s) return '';
  return /:\d+$/.test(s) ? s : `${s}:22`;
}

async function sameSecret(a, b) {
  // Compare fixed-length digests in constant time so timing reveals nothing.
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}
