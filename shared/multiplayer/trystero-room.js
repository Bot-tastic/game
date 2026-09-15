// Shared peer-to-peer room helper built on Trystero's BitTorrent-tracker
// signaling strategy. No backend/account needed: matchmaking rides on public
// WebTorrent trackers, gameplay data flows directly peer-to-peer afterwards.
//
// This module owns ONLY join-code generation, room creation, and the shared
// host/join UI. Each game defines its own gameplay message channels via
// room.makeAction(...) in its own main.js.
import { joinRoom } from "https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent@0.25.4/dist/index.mjs";

const APP_ID = "bot-tastic-game-hub-v1";
// Ambiguity-free charset: no 0/O, 1/I/L.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function roomIdFor(gameSlug, code) {
  return `${gameSlug}-${code.toUpperCase()}`;
}

/** Creates a fresh room as the host. Returns { code, room }. */
export function hostRoom(gameSlug) {
  const code = generateRoomCode();
  const room = joinRoom({ appId: APP_ID }, roomIdFor(gameSlug, code));
  return { code, room };
}

/** Joins an existing room using a code someone else generated. Returns { room }. */
export function joinRoomByCode(gameSlug, code) {
  const room = joinRoom({ appId: APP_ID }, roomIdFor(gameSlug, code));
  return { room };
}

export function onPeerJoin(room, cb) {
  room.onPeerJoin(cb);
}

export function onPeerLeave(room, cb) {
  room.onPeerLeave(cb);
}

/**
 * Renders the shared "Host or Join" flow into `container` (an existing DOM
 * element, typically the game's MENU overlay). Calls onHostReady({ room,
 * role: 'host' }) once a peer has actually joined the hosted room, or
 * onGuestReady({ room, role: 'guest' }) once the guest's join call resolves
 * and the host peer is present. onError(err) is called if joining fails.
 */
export function renderJoinScreen(container, { gameSlug, onHostReady, onGuestReady, onError }) {
  container.innerHTML = `
    <div class="mp-join">
      <div class="mp-join__choice">
        <button class="btn btn--primary" data-action="host">Host Game</button>
        <button class="btn btn--ghost" data-action="join">Join Game</button>
      </div>
      <div class="mp-join__host" hidden>
        <p>Share this code with your opponent</p>
        <button class="mp-join__code" data-action="copy" type="button"></button>
        <p class="mp-join__status">Waiting for opponent&hellip;</p>
      </div>
      <div class="mp-join__guest" hidden>
        <p>Enter your opponent's code</p>
        <input class="mp-join__input" data-role="code-input" inputmode="text"
               autocapitalize="characters" autocomplete="off" maxlength="4"
               placeholder="ABCD" />
        <button class="btn btn--primary" data-action="connect">Connect</button>
        <p class="mp-join__status" data-role="guest-status"></p>
      </div>
    </div>
  `;

  const choiceEl = container.querySelector(".mp-join__choice");
  const hostEl = container.querySelector(".mp-join__host");
  const guestEl = container.querySelector(".mp-join__guest");
  const codeEl = container.querySelector(".mp-join__code");
  const inputEl = container.querySelector('[data-role="code-input"]');
  const guestStatusEl = container.querySelector('[data-role="guest-status"]');

  container.querySelector('[data-action="host"]').addEventListener("click", () => {
    choiceEl.hidden = true;
    hostEl.hidden = false;
    try {
      const { code, room } = hostRoom(gameSlug);
      codeEl.textContent = code;
      onPeerJoin(room, () => onHostReady({ room, role: "host" }));
    } catch (err) {
      onError && onError(err);
    }
  });

  codeEl.addEventListener("click", () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(codeEl.textContent).catch(() => {});
      const original = codeEl.textContent;
      codeEl.textContent = "Copied!";
      setTimeout(() => (codeEl.textContent = original), 700);
    }
  });

  container.querySelector('[data-action="join"]').addEventListener("click", () => {
    choiceEl.hidden = true;
    guestEl.hidden = false;
    inputEl.focus();
  });

  container.querySelector('[data-action="connect"]').addEventListener("click", () => {
    const code = inputEl.value.trim().toUpperCase();
    if (code.length !== 4) {
      guestStatusEl.textContent = "Enter the 4-character code.";
      return;
    }
    guestStatusEl.textContent = "Connecting…";
    try {
      const { room } = joinRoomByCode(gameSlug, code);
      onPeerJoin(room, () => onGuestReady({ room, role: "guest" }));
    } catch (err) {
      guestStatusEl.textContent = "Could not connect. Check the code and try again.";
      onError && onError(err);
    }
  });

  inputEl.addEventListener("input", () => {
    inputEl.value = inputEl.value.toUpperCase().slice(0, 4);
  });
}
