import { ssh, sshKeys, Terminal, FitAddon, Buffer } from './vendor/ssh-lib.js';

const PROFILE_KEY = 'ssh.profile';
const KNOWN_HOSTS_KEY = 'ssh.knownHosts';

const $ = (sel) => document.querySelector(sel);
const form = $('#connect-form');
const statusEl = $('#status');

let active = null;

// SSH channel requests the library doesn't ship message types for.
class PtyRequestMessage extends ssh.ChannelRequestMessage {
  constructor(cols, rows) {
    super('pty-req', true);
    this.cols = cols;
    this.rows = rows;
  }
  onWrite(writer) {
    super.onWrite(writer);
    writer.writeString('xterm-256color', 'ascii');
    writer.writeUInt32(this.cols);
    writer.writeUInt32(this.rows);
    writer.writeUInt32(0);
    writer.writeUInt32(0);
    writer.writeBinary(Buffer.from([0])); // no terminal modes (TTY_OP_END)
  }
}

class WindowChangeMessage extends ssh.ChannelRequestMessage {
  constructor(cols, rows) {
    super('window-change', false);
    this.cols = cols;
    this.rows = rows;
  }
  onWrite(writer) {
    super.onWrite(writer);
    writer.writeUInt32(this.cols);
    writer.writeUInt32(this.rows);
    writer.writeUInt32(0);
    writer.writeUInt32(0);
  }
}

// The library leaves out the language and submethods fields RFC 4256 requires in a
// keyboard-interactive request, which OpenSSH rejects as an incomplete message.
const baseAuthRequestWrite = ssh.AuthenticationRequestMessage.prototype.onWrite;
ssh.AuthenticationRequestMessage.prototype.onWrite = function (writer) {
  baseAuthRequestWrite.call(this, writer);
  if (this.constructor === ssh.AuthenticationRequestMessage && this.methodName === 'keyboard-interactive') {
    writer.writeString('', 'ascii');
    writer.writeString('', 'utf8');
  }
};

init();

function init() {
  // Refuse to run inside a frame so another site can't overlay or drive this page.
  if (window.top !== window.self) {
    document.body.textContent = 'This page cannot be embedded.';
    return;
  }

  const profile = readJson(PROFILE_KEY);
  if (profile) {
    form.host.value = profile.host || 'localhost';
    form.port.value = profile.port || 22;
    form.username.value = profile.username || '';
    form.bridge.value = profile.bridge || '';
    form.token.value = profile.token || '';
    form.remember.checked = true;
  }

  // bridge.py prints a link with the relay address and token in the URL fragment,
  // which browsers never send to the server. Read it, then drop it from the address bar.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('token')) form.token.value = hash.get('token');
  if (hash.has('bridge')) {
    const b = hash.get('bridge');
    form.bridge.value = /^\d+$/.test(b) ? `ws://127.0.0.1:${b}` : b;
  }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  form.addEventListener('change', (e) => {
    if (e.target.name === 'auth') syncAuthFields();
  });
  syncAuthFields();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    connect().catch((err) => fail(err));
  });
  $('#disconnect').addEventListener('click', () => disconnect('Disconnected.'));
  $('#known-hosts-btn').addEventListener('click', showKnownHosts);
  $('#gen-token').addEventListener('click', generateToken);
  window.addEventListener('pagehide', () => disconnect());
  setupKeybar();
  setupViewport();
}

function syncAuthFields() {
  const mode = form.auth.value;
  for (const el of form.querySelectorAll('[data-auth]')) el.hidden = el.dataset.auth !== mode;
}

async function connect() {
  if (active) return;
  const host = form.host.value.trim();
  const port = Number(form.port.value);
  const username = form.username.value.trim();
  const bridge = form.bridge.value.trim();
  const token = form.token.value.trim();
  const mode = form.auth.value;
  const relay = parseRelay(bridge);
  if (!/^[A-Za-z0-9_.~-]+$/.test(token)) throw new Error('The token may only contain letters, digits and - _ . ~');

  if (form.remember.checked) {
    writeJson(PROFILE_KEY, { host, port, username, bridge, token });
  } else {
    removeKey(PROFILE_KEY);
  }

  const credentials = { username };
  if (mode === 'password') {
    credentials.password = form.password.value;
  } else if (mode === 'key') {
    const text = form.keyfile.files[0] ? await form.keyfile.files[0].text() : form.keytext.value;
    if (!text.trim()) throw new Error('Choose or paste a private key.');
    if (text.includes('BEGIN OPENSSH PRIVATE KEY')) {
      throw new Error(
        'OpenSSH-format keys are not supported here. Convert a copy of an RSA or ECDSA key with ' +
        '"ssh-keygen -p -m PKCS8 -f copy_of_key" (Ed25519 keys cannot be used).'
      );
    }
    let keyPair;
    try {
      keyPair = await sshKeys.importKey(text, form.passphrase.value || null);
    } catch (err) {
      throw new Error(`Could not read the private key (${err.message}). Wrong passphrase or unsupported key type?`);
    }
    credentials.publicKeys = [keyPair];
  }
  // Secrets live only in memory for this attempt.
  form.password.value = '';
  form.passphrase.value = '';
  form.keytext.value = '';
  form.keyfile.value = '';

  setBusy(true);
  setStatus(`Connecting to ${host}:${port} via ${relay.host}…`);

  const conn = { closed: false };
  active = conn;
  try {
    relay.search = new URLSearchParams({ host, port: String(port) }).toString();
    // The token rides in the subprotocol header so it never appears in URLs or logs.
    conn.ws = await openWebSocket(relay.href, ['ssh-relay', `token.${token}`]);

    const config = new ssh.SshSessionConfiguration();
    conn.session = new ssh.SshClientSession(config);
    conn.session.onAuthenticating((e) => {
      if (e.authenticationType === ssh.SshAuthenticationType.serverPublicKey) {
        e.authenticationPromise = verifyHostKey(relay.host, host, port, e.publicKey);
      } else if (e.authenticationType === ssh.SshAuthenticationType.clientInteractive && e.infoRequest) {
        e.authenticationPromise = answerPrompts(e);
      }
    });
    conn.session.onClosed((e) => {
      if (active === conn) disconnect(e.message ? `Connection closed: ${e.message}` : 'Connection closed.');
    });

    await conn.session.connect(new ssh.WebSocketStream(conn.ws));
    setStatus('Verifying server identity…');
    if (!(await conn.session.authenticateServer())) throw new Error('Server identity was not accepted.');
    setStatus('Logging in…');
    if (!(await conn.session.authenticateClient(credentials))) throw new Error('Login failed.');

    await startShell(conn, `${username}@${host}${port === 22 ? '' : ':' + port}`);
    setStatus('');
  } catch (err) {
    if (active === conn) disconnect();
    throw err;
  } finally {
    setBusy(false);
  }
}

async function startShell(conn, title) {
  $('#setup').hidden = true;
  $('#session').hidden = false;
  document.body.classList.add('in-session');
  $('#session-title').textContent = title;

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 14,
    scrollback: 5000,
    theme: { background: '#000000' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open($('#terminal'));
  // Stop iOS from "fixing" what you type into the shell.
  for (const [k, v] of [['autocorrect', 'off'], ['autocapitalize', 'off'], ['autocomplete', 'off'], ['spellcheck', 'false']]) {
    term.textarea?.setAttribute(k, v);
  }
  fit.fit();
  conn.term = term;

  const channel = await conn.session.openChannel('session');
  conn.channel = channel;
  channel.onDataReceived((data) => {
    term.write(new Uint8Array(data));
    channel.adjustWindow(data.length);
  });
  channel.onExtendedDataReceived((e) => {
    term.write(new Uint8Array(e.data));
    channel.adjustWindow(e.data.length);
  });
  channel.onClosed(() => {
    if (active === conn) disconnect('Session ended.');
  });

  if (!(await channel.request(new PtyRequestMessage(term.cols, term.rows)))) {
    throw new Error('Server refused a terminal.');
  }
  if (!(await channel.request(new ssh.ChannelRequestMessage('shell', true)))) {
    throw new Error('Server refused to start a shell.');
  }

  conn.send = (d) => channel.send(Buffer.from(d, 'utf8')).catch(() => {});
  term.onData((d) => conn.send(applyModifiers(d)));
  term.onBinary((d) => channel.send(Buffer.from(d, 'binary')).catch(() => {}));
  term.onResize(({ cols, rows }) => channel.request(new WindowChangeMessage(cols, rows)).catch(() => {}));
  conn.resizeObserver = new ResizeObserver(() => fit.fit());
  conn.resizeObserver.observe($('#terminal'));
  term.focus();
}

// ---- on-screen keys for touch keyboards that lack Esc, Ctrl, Tab and arrows ----

const modifiers = { ctrl: false, alt: false };

function setupKeybar() {
  const bar = $('#keybar');
  const press = (e) => {
    const btn = e.target.closest('button');
    if (!btn || !active?.send) return;
    // Keep focus (and the iPad keyboard) on the terminal.
    e.preventDefault();
    keybarAction(btn);
    if (e.type === 'mousedown') active.term.focus();
  };
  bar.addEventListener('touchstart', press, { passive: false });
  bar.addEventListener('mousedown', press);
}

function keybarAction(btn) {
  const conn = active;
  const key = btn.dataset.key;
  if (btn.dataset.text) {
    conn.send(applyModifiers(btn.dataset.text));
    return;
  }
  if (key === 'ctrl' || key === 'alt') {
    modifiers[key] = !modifiers[key];
    syncModifierButtons();
    return;
  }
  if (key === 'paste') {
    navigator.clipboard?.readText().then((text) => text && conn.term.paste(text)).catch(() => {});
    return;
  }
  const appCursor = conn.term.modes.applicationCursorKeysMode;
  const arrow = (c) => (appCursor ? '\x1bO' : '\x1b[') + c;
  const seq = { esc: '\x1b', tab: '\t', up: arrow('A'), down: arrow('B'), right: arrow('C'), left: arrow('D') }[key];
  if (seq) conn.send((modifiers.alt ? '\x1b' : '') + seq);
  clearModifiers();
}

function applyModifiers(data) {
  if (!modifiers.ctrl && !modifiers.alt) return data;
  let out = data;
  if (modifiers.ctrl && data.length === 1) {
    const c = data.toUpperCase();
    const code = c.charCodeAt(0);
    if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64); // @, A-Z, [ \ ] ^ _
    else if (c === ' ') out = '\x00';
    else if (c === '?') out = '\x7f';
  }
  if (modifiers.alt) out = '\x1b' + out;
  clearModifiers();
  return out;
}

function clearModifiers() {
  modifiers.ctrl = modifiers.alt = false;
  syncModifierButtons();
}

function syncModifierButtons() {
  for (const name of ['ctrl', 'alt']) {
    $(`#keybar [data-key=${name}]`).setAttribute('aria-pressed', String(modifiers[name]));
  }
}

// On iPad the on-screen keyboard covers the page instead of resizing it, so size
// the terminal to the visible area.
function setupViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const layout = () => {
    const session = $('#session');
    session.style.height = `${vv.height}px`;
    session.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  vv.addEventListener('resize', layout);
  vv.addEventListener('scroll', layout);
  layout();
}

function disconnect(message) {
  const conn = active;
  if (!conn) return;
  active = null;
  conn.resizeObserver?.disconnect();
  try { conn.session?.dispose(); } catch {}
  try { conn.ws?.close(); } catch {}
  conn.term?.dispose();
  clearModifiers();
  document.body.classList.remove('in-session');
  $('#session').hidden = true;
  $('#setup').hidden = false;
  if (message) setStatus(message);
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  form.token.value = token;
  form.token.type = 'text';
  setStatus('New token is in the Token field. Use it as the Worker\'s TOKEN secret.');
  navigator.clipboard?.writeText(token).then(
    () => setStatus('New token copied. Paste it as the Worker\'s TOKEN secret.'),
    () => {}
  );
}

function parseRelay(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter the relay address bridge.py printed, e.g. wss://something.trycloudflare.com');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:' && local) url.protocol = 'ws:';
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) {
    throw new Error('The relay address must start with wss:// (an encrypted connection).');
  }
  url.hash = '';
  return url;
}

function openWebSocket(url, protocols) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url, protocols);
    } catch (err) {
      reject(new Error(`Could not open the bridge connection: ${err.message}`));
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.onopen = ws.onerror = null;
      resolve(ws);
    };
    ws.onerror = () => {
      const local = url.startsWith('ws:');
      reject(new Error(
        'Could not reach the relay. Check the relay address and token, and that this server is on the relay\'s ' +
        'allow list (Worker: ALLOW variable; bridge.py: --allow, default localhost:22). With bridge.py, is it still running?' +
        (local ? ' Safari cannot use a ws:// relay on this device; use the wss:// address instead.' : '')
      ));
    };
  });
}

// ---- Host key verification (trust on first use, like ~/.ssh/known_hosts) ----

async function verifyHostKey(relayHost, host, port, publicKey) {
  const bytes = await publicKey.getPublicKeyBytes();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const fingerprint = 'SHA256:' + btoa(String.fromCharCode(...digest)).replace(/=+$/, '');
  const algorithm = publicKey.keyAlgorithmName;
  // "localhost:22" behind two different relays is two different servers.
  const id = `${relayHost} → ${host.toLowerCase()}:${port}`;
  const known = readJson(KNOWN_HOSTS_KEY) || {};
  const saved = known[id];

  if (saved && saved.fingerprint === fingerprint) return { host: id };

  if (saved) {
    await ask(
      'Server identity changed!',
      [
        para('The key this server presented does not match the one you saved. Someone could be intercepting the connection, or the server was reinstalled.', 'danger'),
        para(`Saved (${saved.algorithm}):`), code(saved.fingerprint),
        para(`Now (${algorithm}):`), code(fingerprint),
        para('Only continue if you have confirmed the new fingerprint with the server admin. To accept it, remove the old entry under "Known hosts" first.'),
      ],
      [{ label: 'Abort', value: 'no', primary: true }]
    );
    return null;
  }

  const choice = await ask(
    'New server',
    [
      para(`First connection to ${host}:${port} via ${relayHost}. Check that this ${algorithm} fingerprint matches the server (ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub):`),
      code(fingerprint),
    ],
    [
      { label: 'Trust & remember', value: 'save', primary: true },
      { label: 'Trust once', value: 'once' },
      { label: 'Cancel', value: 'no' },
    ]
  );
  if (choice === 'save') {
    known[id] = { algorithm, fingerprint, added: new Date().toISOString() };
    writeJson(KNOWN_HOSTS_KEY, known);
  }
  return choice === 'save' || choice === 'once' ? { host: id } : null;
}

function showKnownHosts() {
  const known = readJson(KNOWN_HOSTS_KEY) || {};
  const ids = Object.keys(known).sort();
  const body = [];
  if (!ids.length) {
    body.push(para('No saved servers yet.', 'muted'));
  } else {
    const list = document.createElement('ul');
    list.className = 'host-list';
    for (const id of ids) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${id}  ${known[id].fingerprint}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost';
      btn.textContent = 'Forget';
      btn.addEventListener('click', () => {
        const current = readJson(KNOWN_HOSTS_KEY) || {};
        delete current[id];
        writeJson(KNOWN_HOSTS_KEY, current);
        li.remove();
      });
      li.append(label, btn);
      list.append(li);
    }
    body.push(list);
  }
  ask('Known hosts', body, [{ label: 'Close', value: 'close', primary: true }]);
}

// ---- keyboard-interactive (password prompts, one-time codes) ----

async function answerPrompts(e) {
  const req = e.infoRequest;
  const prompts = req.prompts || [];
  const body = [];
  if (req.name) body.push(para(req.name));
  if (req.instruction) body.push(para(req.instruction, 'muted'));
  const inputs = prompts.map((p) => {
    const label = document.createElement('label');
    label.textContent = p.prompt;
    const input = document.createElement('input');
    input.type = p.echo ? 'text' : 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    label.append(input);
    body.push(label);
    return input;
  });
  if (prompts.length) {
    const choice = await ask('Server asks', body, [
      { label: 'Send', value: 'ok', primary: true },
      { label: 'Cancel', value: 'no' },
    ]);
    if (choice !== 'ok') return null;
  }
  const response = new ssh.AuthenticationInfoResponseMessage();
  response.responses = inputs.map((i) => i.value);
  inputs.forEach((i) => (i.value = ''));
  e.infoResponse = response;
  return null;
}

// ---- small UI helpers ----

function ask(title, nodes, buttons) {
  const dialog = $('#dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-body').replaceChildren(...nodes);
  const actions = $('#dialog-actions');
  actions.replaceChildren(
    ...buttons.map((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.primary ? 'btn--primary' : 'btn--ghost');
      btn.value = b.value;
      btn.textContent = b.label;
      return btn;
    })
  );
  dialog.returnValue = '';
  dialog.showModal();
  const first = dialog.querySelector('input') || actions.querySelector('.btn--primary');
  first?.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue || 'no'), { once: true });
  });
}

function para(text, cls) {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  return p;
}

function code(text) {
  const c = document.createElement('code');
  c.className = 'fingerprint';
  c.textContent = text;
  return c;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setBusy(busy) {
  for (const el of form.querySelectorAll('button, input, textarea')) el.disabled = busy;
}

function fail(err) {
  setStatus(err?.message || String(err), true);
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
