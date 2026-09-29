// Cloud saves. Every game keeps its progress in localStorage under its own key
// prefix; when the player is signed in, this module mirrors that slice of
// localStorage to the server and back. The games themselves know nothing about
// it — each game page awaits cloudBoot() before loading its main module, so by
// the time a game reads its storage the newest save is already in place.
//
// Where no API exists (GitHub Pages, opening the files locally) every call
// quietly does nothing and the games work exactly as before.
//
// Sync rules, per game:
//   - server has nothing          -> upload what this device has
//   - server unchanged since our  -> upload if this device changed anything
//     last sync
//   - server newer (other device) -> take the server's copy; if this device
//     had unsynced changes they are kept aside under cloud:backup:<game>
// While a game is open, changes are pushed every few seconds and when the page
// is hidden, so the most recently played device is always what the cloud has.

export const GAME_PREFIXES = {
  "hill-climb": ["hillclimb:"],
  "balloon-siege": ["balloon-siege:"],
  "geo-dash": ["game-tastic:geo-dash:"],
  "formula-legion": ["game-tastic:formula-legion:"],
  "demolition-run": ["game-tastic:demolition-run:"],
};

const META = "cloud:"; // local bookkeeping, never uploaded
const PUSH_EVERY_MS = 15000;
const KEEPALIVE_LIMIT = 60000; // browsers cap keepalive request bodies at 64 KB

let signedIn = false;
let pushing = false;
// Set once this page has reconciled with the server in time. Until then
// nothing is uploaded: pushing an unreconciled copy could overwrite progress
// made on another device.
let reconciled = false;
// Set when cloudBoot stops waiting. A pull that finishes after that must not
// swap the storage out from under a game that is already running.
let gameStarted = false;

// ------------------------------------------------------------- helpers ----

const ls = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* quota / private mode */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
  keys() {
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

/** Call the API. Resolves to {status, body}; status 0 means no API here. */
export async function api(method, path, body, { keepalive = false } = {}) {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      keepalive,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") ?? "";
    // A static host answers /api/* with an HTML 404 page: that is "no API".
    if (!type.includes("application/json")) return { status: 0, body: null };
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 0, body: null };
  }
}

function snapshot(game) {
  const prefixes = GAME_PREFIXES[game];
  const out = {};
  for (const k of ls.keys().sort()) {
    if (prefixes.some((p) => k.startsWith(p))) out[k] = ls.get(k);
  }
  return out;
}

/** FNV-1a over the snapshot: enough to notice "something changed". */
function signature(data) {
  const s = JSON.stringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length;
}

function apply(game, data) {
  const prefixes = GAME_PREFIXES[game];
  for (const k of ls.keys()) if (prefixes.some((p) => k.startsWith(p))) ls.del(k);
  for (const [k, v] of Object.entries(data ?? {})) {
    // Only ever write keys that belong to this game.
    if (typeof v === "string" && prefixes.some((p) => k.startsWith(p))) ls.set(k, v);
  }
}

function markSynced(game, rev, data) {
  ls.set(`${META}rev:${game}`, String(rev));
  ls.set(`${META}sig:${game}`, signature(data));
}

/** Forget sync state when a different account signs in on this device. */
function adoptUser(userId) {
  if (ls.get(`${META}user`) === String(userId)) return;
  for (const k of ls.keys()) {
    if (k.startsWith(`${META}rev:`) || k.startsWith(`${META}sig:`)) ls.del(k);
  }
  ls.set(`${META}user`, String(userId));
}

async function push(game, { keepalive = false } = {}) {
  if (!signedIn || !reconciled || pushing) return false;
  const data = snapshot(game);
  const sig = signature(data);
  if (sig === ls.get(`${META}sig:${game}`)) return true;
  const body = { data };
  if (keepalive && JSON.stringify(body).length > KEEPALIVE_LIMIT) keepalive = false;
  pushing = true;
  try {
    const res = await api("PUT", `/api/saves/${game}`, body, { keepalive });
    if (res.status === 200) {
      markSynced(game, res.body.rev, data);
      return true;
    }
    if (res.status === 401) signedIn = false;
    return false;
  } finally {
    pushing = false;
  }
}

async function pull(game) {
  const me = await api("GET", "/api/me");
  if (me.status !== 200) return;
  signedIn = true;
  adoptUser(me.body.user.id);

  const res = await api("GET", `/api/saves/${game}`);
  if (res.status !== 200) return;
  const server = res.body.save;
  const local = snapshot(game);
  const lastRev = Number(ls.get(`${META}rev:${game}`) ?? 0);
  const lastSig = ls.get(`${META}sig:${game}`);
  const localChanged = signature(local) !== lastSig;

  if (gameStarted) return;
  if (!server) {
    reconciled = true;
    if (Object.keys(local).length) await push(game);
    return;
  }
  if (server.rev === lastRev) {
    reconciled = true;
    if (localChanged) await push(game);
    return;
  }
  // Another device saved since we last synced: its copy wins.
  if (localChanged && Object.keys(local).length) {
    ls.set(`${META}backup:${game}`, JSON.stringify({ at: Date.now(), data: local }));
  }
  apply(game, server.data);
  markSynced(game, server.rev, snapshot(game));
  reconciled = true;
}

// --------------------------------------------------------------- public ---

/**
 * Bring this game's localStorage up to date with the cloud, then keep pushing
 * changes while the page is open. Never throws and never waits longer than
 * `timeout` — an unreachable server must not stop anyone from playing.
 */
export async function cloudBoot(game, { timeout = 2500 } = {}) {
  if (!GAME_PREFIXES[game]) return;
  let timer;
  await Promise.race([
    pull(game).catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(resolve, timeout); }),
  ]);
  clearTimeout(timer);
  gameStarted = true;

  setInterval(() => { push(game); }, PUSH_EVERY_MS);
  const flush = () => { push(game, { keepalive: true }); };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  window.addEventListener("pagehide", flush);
}

export const isSignedIn = () => signedIn;
