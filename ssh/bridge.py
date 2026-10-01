#!/usr/bin/env python3
"""WebSocket -> TCP relay for the web SSH client (bot-tastic.github.io/game/ssh).

Browsers (including Safari on iPad) cannot open raw TCP connections, so the SSH
page talks to this relay over a WebSocket and the relay forwards the bytes to
the SSH server. The SSH handshake, encryption and login all happen inside the
browser tab: the relay only ever sees encrypted SSH traffic, never passwords
or keys.

Run it ON THE MACHINE YOU WANT TO SSH INTO (or any always-on machine next to
it). Nothing needs to be installed on the iPad.

  Easiest, no domain or router setup (needs `cloudflared` installed):
      python3 bridge.py --tunnel
  It starts a free Cloudflare quick tunnel and prints a link to open in Safari.

  Your own domain + TLS certificate (e.g. from Let's Encrypt):
      python3 bridge.py --listen 0.0.0.0 --port 8443 \\
          --tls-cert fullchain.pem --tls-key privkey.pem \\
          --public-url wss://ssh.example.com:8443

  Same computer as the browser (desktop Chrome/Firefox only, not Safari):
      python3 bridge.py --allow-any

Safety rails:
  * only accepts WebSocket connections from the SSH page's origin
  * requires a secret token (kept in ~/.config/web-ssh-bridge/token so saved
    links keep working; rotate it with --new-token)
  * only relays to localhost:22 unless you widen it with --allow / --allow-any
  * refuses to listen on a network interface without TLS

Standard library only, Python 3.8+.
"""

import argparse
import asyncio
import base64
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import shutil
import ssl
import struct
import sys
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

PAGE_ORIGIN = "https://bot-tastic.github.io"
PAGE_URL = PAGE_ORIGIN + "/game/ssh/"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
TOKEN_FILE = Path.home() / ".config" / "web-ssh-bridge" / "token"
MAX_FRAME = 1 << 20
MAX_HEADER = 8192
PING_INTERVAL = 25  # keeps proxies such as Cloudflare from dropping idle sessions


class Bridge:
    def __init__(self, token, origins, allow):
        self.token = token
        self.origins = origins
        self.allow = allow  # None means any target

    async def handle(self, reader, writer):
        try:
            await self.serve(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
                asyncio.TimeoutError, ssl.SSLError):
            pass
        finally:
            writer.close()

    async def serve(self, reader, writer):
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        if len(head) > MAX_HEADER:
            return await reject(writer, 431, "Header too large")
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) != 3 or parts[0] != "GET":
            return await reject(writer, 405, "Method not allowed")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        origin = headers.get("origin", "")
        if origin not in self.origins:
            log(f"rejected connection from origin {origin!r}")
            return await reject(writer, 403, "Origin not allowed")
        if headers.get("upgrade", "").lower() != "websocket" or "sec-websocket-key" not in headers:
            return await reject(writer, 400, "WebSocket upgrade required")

        query = parse_qs(urlsplit(parts[1]).query)
        token = query.get("token", [""])[0]
        if not hmac.compare_digest(token.encode(), self.token.encode()):
            log("rejected connection with a wrong token")
            await asyncio.sleep(1)
            return await reject(writer, 401, "Bad token")

        host = query.get("host", [""])[0].strip().lower()
        try:
            port = int(query.get("port", ["22"])[0])
        except ValueError:
            port = 0
        if not host or not (0 < port < 65536):
            return await reject(writer, 400, "Bad target")
        if self.allow is not None and f"{host}:{port}" not in self.allow:
            log(f"rejected target {host}:{port} (allowed: {', '.join(sorted(self.allow))})")
            return await reject(writer, 403, "Target not allowed")

        try:
            t_reader, t_writer = await asyncio.wait_for(asyncio.open_connection(host, port), 15)
        except (OSError, asyncio.TimeoutError) as e:
            log(f"could not reach {host}:{port}: {e}")
            return await reject(writer, 502, "Could not reach SSH server")

        accept = base64.b64encode(
            hashlib.sha1((headers["sec-websocket-key"] + WS_GUID).encode()).digest()
        ).decode()
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        await writer.drain()
        log(f"session open -> {host}:{port}")

        try:
            await pump(reader, writer, t_reader, t_writer)
        finally:
            t_writer.close()
            log(f"session closed -> {host}:{port}")


async def pump(ws_reader, ws_writer, t_reader, t_writer):
    async def ws_to_tcp():
        while True:
            opcode, payload = await read_frame(ws_reader)
            if opcode == 0x8:  # close
                send_frame(ws_writer, 0x8, payload[:2])
                return
            if opcode == 0x9:  # ping
                send_frame(ws_writer, 0xA, payload)
            elif opcode in (0x0, 0x1, 0x2):
                t_writer.write(payload)
                await t_writer.drain()

    async def tcp_to_ws():
        while True:
            data = await t_reader.read(65536)
            if not data:
                send_frame(ws_writer, 0x8, struct.pack("!H", 1000))
                return
            send_frame(ws_writer, 0x2, data)
            await ws_writer.drain()

    async def keepalive():
        while True:
            await asyncio.sleep(PING_INTERVAL)
            send_frame(ws_writer, 0x9, b"")
            await ws_writer.drain()

    tasks = [asyncio.ensure_future(c) for c in (ws_to_tcp(), tcp_to_ws(), keepalive())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    for t in done:
        if t.exception() and not isinstance(t.exception(), (ConnectionError, asyncio.IncompleteReadError)):
            raise t.exception()


async def read_frame(reader):
    b1, b2 = await reader.readexactly(2)
    opcode = b1 & 0x0F
    if not b2 & 0x80:
        raise ConnectionError("client frames must be masked")
    length = b2 & 0x7F
    if length == 126:
        (length,) = struct.unpack("!H", await reader.readexactly(2))
    elif length == 127:
        (length,) = struct.unpack("!Q", await reader.readexactly(8))
    if length > MAX_FRAME:
        raise ConnectionError("frame too large")
    mask = await reader.readexactly(4)
    data = bytearray(await reader.readexactly(length))
    for i in range(length):
        data[i] ^= mask[i & 3]
    return opcode, bytes(data)


def send_frame(writer, opcode, payload):
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", 0x80 | opcode, n)
    elif n < 65536:
        header = struct.pack("!BBH", 0x80 | opcode, 126, n)
    else:
        header = struct.pack("!BBQ", 0x80 | opcode, 127, n)
    writer.write(header + payload)


async def reject(writer, status, reason):
    writer.write(f"HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".encode())
    await writer.drain()


def log(msg):
    print(f"[bridge] {msg}", file=sys.stderr, flush=True)


def load_token(rotate):
    if not rotate:
        try:
            token = TOKEN_FILE.read_text().strip()
            if len(token) >= 32:
                return token
        except OSError:
            pass
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token + "\n")
    return token


def page_link(bridge_url, token):
    return f"{PAGE_URL}#bridge={quote(bridge_url, safe='')}&token={token}"


def print_link(bridge_url, token):
    print("\nOpen this link in Safari (bookmark it or add it to the Home Screen).")
    print("The part after # never leaves your device; GitHub doesn't see it.\n")
    print(f"  {page_link(bridge_url, token)}\n", flush=True)


async def start_tunnel(port):
    exe = shutil.which("cloudflared")
    if not exe:
        sys.exit("--tunnel needs cloudflared: https://developers.cloudflare.com/cloudflare-one/"
                 "connections/connect-networks/downloads/")
    proc = await asyncio.create_subprocess_exec(
        exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    pattern = re.compile(rb"https://[a-z0-9-]+\.trycloudflare\.com")
    while True:
        line = await asyncio.wait_for(proc.stderr.readline(), 60)
        if not line:
            sys.exit("cloudflared exited before the tunnel came up")
        m = pattern.search(line)
        if m:
            break

    async def drain():  # keep reading so cloudflared never blocks on a full pipe
        while await proc.stderr.readline():
            pass

    asyncio.ensure_future(drain())
    return proc, "wss://" + m.group(0).decode()[len("https://"):]


def is_loopback(addr):
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return addr == "localhost"


def main():
    ap = argparse.ArgumentParser(description="WebSocket->TCP relay for the web SSH client.")
    ap.add_argument("--port", type=int, default=8022, help="port to listen on (default 8022)")
    ap.add_argument("--listen", default="127.0.0.1", help="address to listen on (default 127.0.0.1)")
    ap.add_argument("--tunnel", action="store_true", help="publish via a Cloudflare quick tunnel (needs cloudflared)")
    ap.add_argument("--tls-cert", help="TLS certificate chain (PEM) for wss://")
    ap.add_argument("--tls-key", help="TLS private key (PEM)")
    ap.add_argument("--public-url", help="the wss:// address the browser should use, for the printed link")
    ap.add_argument("--allow", action="append", default=[], metavar="HOST[:PORT]",
                    help="SSH target the page may reach (repeatable; default localhost:22)")
    ap.add_argument("--allow-any", action="store_true", help="let the page reach any SSH target")
    ap.add_argument("--new-token", action="store_true", help="generate a new token (old links stop working)")
    ap.add_argument("--origin", action="append", default=[], help=argparse.SUPPRESS)
    args = ap.parse_args()

    tls = None
    if args.tls_cert or args.tls_key:
        if not (args.tls_cert and args.tls_key):
            sys.exit("--tls-cert and --tls-key go together")
        tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        tls.load_cert_chain(args.tls_cert, args.tls_key)
    if not is_loopback(args.listen) and tls is None:
        sys.exit("Refusing to listen on a network interface without TLS. Use --tunnel, or --tls-cert/--tls-key.")

    token = load_token(args.new_token)
    origins = {PAGE_ORIGIN, *args.origin}
    if args.allow_any:
        allow = None
    else:
        allow = {a.lower() if ":" in a else f"{a.lower()}:22" for a in args.allow} or {"localhost:22", "127.0.0.1:22"}
    bridge = Bridge(token, origins, allow)

    async def run():
        server = await asyncio.start_server(bridge.handle, args.listen, args.port, ssl=tls)
        scheme = "wss" if tls else "ws"
        print(f"Relay listening on {scheme}://{args.listen}:{args.port} (Ctrl+C to stop)")
        print("Allowed SSH targets: " + ("any" if allow is None else ", ".join(sorted(allow))))
        tunnel = None
        if args.tunnel:
            print("Starting Cloudflare tunnel…", flush=True)
            tunnel, url = await start_tunnel(args.port)
            print("Note: quick-tunnel addresses change every time cloudflared restarts.")
        else:
            url = args.public_url or f"{scheme}://{'127.0.0.1' if is_loopback(args.listen) else args.listen}:{args.port}"
        print_link(url, token)
        try:
            async with server:
                await server.serve_forever()
        finally:
            if tunnel and tunnel.returncode is None:
                tunnel.terminate()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
