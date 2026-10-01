#!/usr/bin/env python3
"""Local WebSocket -> TCP bridge for the web SSH client.

Browsers cannot open raw TCP sockets, so the SSH page talks to this bridge over
a WebSocket and the bridge forwards the bytes to the SSH server. The SSH
handshake, encryption and authentication all happen inside the browser: the
bridge only ever sees encrypted SSH traffic, never passwords or keys.

Safety rails:
  * listens on 127.0.0.1 only (never reachable from the network)
  * only accepts WebSocket connections from the allowed page origin
  * requires a random per-run token, so other local programs or web pages
    cannot use it as an open proxy
  * optional --allow list to restrict which SSH servers can be reached

Usage:
  python3 bridge.py                      # any SSH target, port 8022
  python3 bridge.py --allow myhost:22    # only myhost:22
Then open the link it prints. Standard library only, Python 3.8+.
"""

import argparse
import asyncio
import base64
import hashlib
import hmac
import secrets
import struct
import sys
from urllib.parse import parse_qs, urlsplit

PAGE_ORIGIN = "https://bot-tastic.github.io"
PAGE_URL = PAGE_ORIGIN + "/game/ssh/"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1 << 20
MAX_HEADER = 8192


class Bridge:
    def __init__(self, token, origins, allow):
        self.token = token
        self.origins = origins
        self.allow = allow

    async def handle(self, reader, writer):
        try:
            await self.serve(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError, asyncio.TimeoutError):
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
            return await reject(writer, 401, "Bad token")

        host = query.get("host", [""])[0].strip()
        try:
            port = int(query.get("port", ["22"])[0])
        except ValueError:
            port = 0
        if not host or not (0 < port < 65536):
            return await reject(writer, 400, "Bad target")
        if self.allow and f"{host}:{port}".lower() not in self.allow:
            log(f"rejected target {host}:{port} (not in --allow)")
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
        log(f"tunnel open -> {host}:{port}")

        try:
            await pump(reader, writer, t_reader, t_writer)
        finally:
            t_writer.close()
            log(f"tunnel closed -> {host}:{port}")


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

    tasks = [asyncio.ensure_future(ws_to_tcp()), asyncio.ensure_future(tcp_to_ws())]
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


def main():
    ap = argparse.ArgumentParser(description="Local WebSocket->TCP bridge for the web SSH client.")
    ap.add_argument("--port", type=int, default=8022, help="local port to listen on (default 8022)")
    ap.add_argument("--allow", action="append", default=[], metavar="HOST:PORT",
                    help="only allow this SSH target (repeatable; default: any target)")
    ap.add_argument("--origin", action="append", default=[],
                    help=f"extra allowed page origin (default only {PAGE_ORIGIN})")
    args = ap.parse_args()

    token = secrets.token_urlsafe(24)
    origins = {PAGE_ORIGIN, *args.origin}
    allow = {a.lower() if ":" in a else f"{a.lower()}:22" for a in args.allow}
    bridge = Bridge(token, origins, allow)

    async def run():
        server = await asyncio.start_server(bridge.handle, "127.0.0.1", args.port)
        print(f"Bridge listening on 127.0.0.1:{args.port} (Ctrl+C to stop)")
        print("Allowed targets: " + (", ".join(sorted(allow)) if allow else "any"))
        print("\nOpen this link (the token stays in your browser, it is never sent to GitHub):\n")
        print(f"  {PAGE_URL}#bridge={args.port}&token={token}\n")
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
