// player.js — physics and collision for the five gamemodes. Pure math (no DOM,
// no imports beyond levels.js) so the same code runs in the browser and in the
// offline fairness checker.
//
// Every mode shares one record and one collision resolver; what differs is how
// input becomes vertical velocity. Landing on a surface is allowed, running
// into its side is fatal — that single rule is what makes blocks read as
// obstacles rather than decoration.

import { GROUND_Y, CEIL_Y, TILE, solidRect, speedAt, gravityAt, modeAt } from "./levels.js";

export const HITBOX = {
  cube: { hw: 15, hh: 15 },
  ship: { hw: 16, hh: 10 },
  ball: { hw: 14, hh: 14 },
  wave: { hw: 7, hh: 7 },
  ufo: { hw: 15, hh: 11 },
};

const G = {
  cube: 2400,
  ball: 2400,
  ufo: 1900,
  ship: 1700,
  wave: 0,
};

const CUBE_JUMP = 720;
const BALL_KICK = 90;
const UFO_FLAP = 560;
const SHIP_THRUST = -3000;
const SHIP_VY_MAX = 400;
const WAVE_SLOPE = 1.0;

const PAD_V = { yellow: 1080, pink: 760 };
const ORB_V = { yellow: 720, pink: 520 };

const CONTACT_EPS = 1.6; // probe distance used to keep "standing" sticky
const LAND_TOL = 12; // penetration still counted as a landing, not a crash
const KILL_LOW = 460;
const KILL_HIGH = -240;

export function createPlayer(level, atX = 0) {
  const mode = modeAt(level, atX);
  const grav = gravityAt(level, atX);
  const hh = HITBOX[mode].hh;
  return {
    x: atX,
    y: grav > 0 ? GROUND_Y - hh : CEIL_Y + hh,
    vy: 0,
    mode,
    grav,
    grounded: true,
    rotation: 0,
    dead: false,
    speed: speedAt(level, atX),
    waveTrail: [],
    animT: 0,
  };
}

export function createRun(level) {
  return {
    padUsed: new Uint8Array(level.pads.length),
    coins: new Uint8Array(level.coins.length),
    coinCount: 0,
  };
}

function overlap(ax0, ax1, ay0, ay1, bx0, bx1, by0, by1) {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

/** Solids whose x-range can matter this frame. Levels are sorted by x. */
function nearbySolids(level, x) {
  const out = [];
  for (const s of level.allSolids) {
    if (s.x > x + 120) continue;
    if (s.x + s.w < x - 120) continue;
    out.push(s);
  }
  return out;
}

function applyInput(p, dt, input) {
  const g = G[p.mode] * p.grav;

  if (p.mode === "cube") {
    if (input.pressed && p.grounded) {
      p.vy = -CUBE_JUMP * p.grav;
      p.grounded = false;
      p.jumped = true;
    }
    p.vy += g * dt;
  } else if (p.mode === "ball") {
    if (input.justPressed && p.grounded) {
      p.grav = -p.grav;
      p.vy = -BALL_KICK * p.grav;
      p.grounded = false;
      p.flipped = true;
    }
    p.vy += G.ball * p.grav * dt;
  } else if (p.mode === "ufo") {
    if (input.justPressed) {
      p.vy = -UFO_FLAP * p.grav;
      p.grounded = false;
      p.flapped = true;
    }
    p.vy += g * dt;
  } else if (p.mode === "ship") {
    p.vy += (G.ship + (input.pressed ? SHIP_THRUST : 0)) * p.grav * dt;
    p.vy = Math.max(-SHIP_VY_MAX, Math.min(SHIP_VY_MAX, p.vy));
  } else if (p.mode === "wave") {
    p.vy = (input.pressed ? -1 : 1) * WAVE_SLOPE * p.speed * p.grav;
  }
}

function resolveSolids(p, level, prevY, events) {
  const box = HITBOX[p.mode];
  const solids = nearbySolids(level, p.x);
  const down = p.grav;

  let x0 = p.x - box.hw;
  let x1 = p.x + box.hw;

  for (const raw of solids) {
    const s = solidRect(raw, level, p.x);
    const sy0 = s.y;
    const sy1 = s.y + s.h;

    // Probe slightly in the gravity direction so resting contact never flickers.
    const py0 = p.y - box.hh - (down < 0 ? CONTACT_EPS : 0);
    const py1 = p.y + box.hh + (down > 0 ? CONTACT_EPS : 0);
    if (!overlap(x0, x1, py0, py1, s.x, s.x + s.w, sy0, sy1)) continue;

    if (p.mode === "wave") {
      p.dead = true;
      return;
    }

    const prevBottom = prevY + box.hh;
    const prevTop = prevY - box.hh;

    if (down > 0) {
      if (p.vy >= 0 && prevBottom <= sy0 + LAND_TOL) {
        p.y = sy0 - box.hh;
        if (p.vy > 220) events.push({ type: "land", x: p.x, y: sy0, vy: p.vy });
        p.vy = 0;
        p.grounded = true;
        continue;
      }
      if (p.vy < 0 && prevTop >= sy1 - LAND_TOL) {
        p.y = sy1 + box.hh;
        p.vy = 0;
        continue;
      }
    } else {
      if (p.vy <= 0 && prevTop >= sy1 - LAND_TOL) {
        p.y = sy1 + box.hh;
        if (-p.vy > 220) events.push({ type: "land", x: p.x, y: sy1, vy: -p.vy });
        p.vy = 0;
        p.grounded = true;
        continue;
      }
      if (p.vy > 0 && prevBottom <= sy0 + LAND_TOL) {
        p.y = sy0 - box.hh;
        p.vy = 0;
        continue;
      }
    }

    p.dead = true;
    return;
  }
}

function groundedCheck(p, level) {
  const box = HITBOX[p.mode];
  const down = p.grav;
  const x0 = p.x - box.hw;
  const x1 = p.x + box.hw;
  const py0 = p.y - box.hh - (down < 0 ? CONTACT_EPS : 0);
  const py1 = p.y + box.hh + (down > 0 ? CONTACT_EPS : 0);
  for (const raw of nearbySolids(level, p.x)) {
    const s = solidRect(raw, level, p.x);
    if (overlap(x0, x1, py0, py1, s.x, s.x + s.w, s.y, s.y + s.h)) return true;
  }
  return false;
}

function hazardHit(p, level) {
  const box = HITBOX[p.mode];
  const pad = Math.min(5, box.hw * 0.3);
  const x0 = p.x - box.hw + pad;
  const x1 = p.x + box.hw - pad;
  const y0 = p.y - box.hh + pad;
  const y1 = p.y + box.hh - pad;

  for (const h of level.hazards) {
    if (h.x + (h.w || h.r * 2) < x0 - 40 || h.x - (h.r || 0) > x1 + 60) continue;

    if (h.type === "spike") {
      // Forgiving inner box: the drawn triangle is wider than what kills you.
      const hx0 = h.x + h.w * 0.28;
      const hx1 = h.x + h.w * 0.72;
      const hy0 = h.dir === "up" ? h.y - h.h : h.y;
      const hy1 = h.dir === "up" ? h.y : h.y + h.h;
      if (overlap(x0, x1, y0, y1, hx0, hx1, hy0 + h.h * 0.15, hy1)) return true;
    } else if (h.type === "saw") {
      const dy = h.move ? sawOffset(h, level, p.x) : 0;
      const cx = h.x;
      const cy = h.y + dy;
      const nx = Math.max(x0, Math.min(cx, x1));
      const ny = Math.max(y0, Math.min(cy, y1));
      const r = h.r * 0.72;
      if ((nx - cx) ** 2 + (ny - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

function sawOffset(h, level, x) {
  const period = h.move.periodBeats * ((level.def.speed * 60) / level.def.bpm);
  return h.move.amp * Math.sin((x / period) * Math.PI * 2 + (h.move.phase || 0));
}

function handlePickups(p, level, run, input, events) {
  const box = HITBOX[p.mode];
  const x0 = p.x - box.hw;
  const x1 = p.x + box.hw;
  const y0 = p.y - box.hh;
  const y1 = p.y + box.hh;

  for (let i = 0; i < level.pads.length; i++) {
    if (run.padUsed[i]) continue;
    const pd = level.pads[i];
    if (pd.x < x0 - 60 || pd.x > x1 + 60) continue;
    const py = pd.y;
    if (overlap(x0, x1, y0, y1, pd.x - 22, pd.x + 22, py - 16, py + 16)) {
      run.padUsed[i] = 1;
      p.vy = -PAD_V[pd.kind] * pd.dir;
      p.grounded = false;
      events.push({ type: "pad", x: pd.x, y: py, kind: pd.kind });
    }
  }

  if (input.justPressed) {
    for (const ob of level.orbs) {
      if (ob.x < x0 - 60 || ob.x > x1 + 60) continue;
      const dx = ob.x - p.x;
      const dy = ob.y - p.y;
      if (dx * dx + dy * dy < 46 * 46) {
        if (ob.kind === "blue") {
          p.grav = -p.grav;
          p.vy = -BALL_KICK * p.grav;
        } else {
          p.vy = -(ORB_V[ob.kind] || ORB_V.yellow) * p.grav;
        }
        p.grounded = false;
        events.push({ type: "orb", x: ob.x, y: ob.y, kind: ob.kind });
        break;
      }
    }
  }

  for (let i = 0; i < level.coins.length; i++) {
    if (run.coins[i]) continue;
    const c = level.coins[i];
    if (c.x < x0 - 60 || c.x > x1 + 60) continue;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (dx * dx + dy * dy < 40 * 40) {
      run.coins[i] = 1;
      run.coinCount++;
      events.push({ type: "coin", x: c.x, y: c.y });
    }
  }
}

/** Reposition cleanly when a portal changes the active mode. */
export function enterMode(p, level, mode) {
  const prev = p.mode;
  p.mode = mode;
  const hh = HITBOX[mode].hh;
  const prevHh = HITBOX[prev].hh;
  // Keep the same surface contact when swapping hitbox sizes.
  if (p.grounded) p.y += (prevHh - hh) * -p.grav;
  if (mode === "ship" || mode === "wave" || mode === "ufo") {
    p.y = Math.max(CEIL_Y + hh + 2, Math.min(GROUND_Y - hh - 2, p.y));
    p.grounded = false;
  }
  if (mode === "wave") p.vy = 0;
  p.rotation = 0;
  p.waveTrail = [];
}

/**
 * Advance one step. `input` is { pressed, justPressed }. Returns an event list
 * (jump / land / pad / orb / coin / portal / die) for the caller to turn into
 * particles and sound.
 */
export function step(p, level, run, dt, input) {
  const events = [];
  if (p.dead) return events;

  const prevX = p.x;
  const prevY = p.y;
  p.jumped = false;
  p.flipped = false;
  p.flapped = false;

  applyInput(p, dt, input);
  p.y += p.vy * dt;
  p.speed = speedAt(level, p.x);
  p.x += p.speed * dt;
  p.animT += dt;

  if (p.jumped || p.flapped) events.push({ type: "jump", x: p.x, y: p.y, mode: p.mode });
  if (p.flipped) events.push({ type: "flip", x: p.x, y: p.y });

  // Portals are crossings, not overlaps — they can never be missed.
  for (const portal of level.portals) {
    if (portal.x > prevX && portal.x <= p.x) {
      if (portal.kind === "mode" && portal.value !== p.mode) {
        enterMode(p, level, portal.value);
        events.push({ type: "portal", kind: "mode", value: portal.value, x: portal.x });
      } else if (portal.kind === "grav" && portal.value !== p.grav) {
        p.grav = portal.value;
        p.grounded = false;
        events.push({ type: "portal", kind: "grav", value: portal.value, x: portal.x });
      } else if (portal.kind === "speed") {
        events.push({ type: "portal", kind: "speed", value: portal.value, x: portal.x });
      }
    }
  }

  p.grounded = false;
  resolveSolids(p, level, prevY, events);
  if (!p.dead && !p.grounded) p.grounded = groundedCheck(p, level);

  if (!p.dead) handlePickups(p, level, run, input, events);
  if (!p.dead && hazardHit(p, level)) p.dead = true;
  if (p.y > KILL_LOW || p.y < KILL_HIGH) p.dead = true;

  // Rotation / visual state.
  if (p.mode === "cube" || p.mode === "ball") {
    if (p.grounded) {
      if (p.mode === "cube") p.rotation = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2);
      else p.rotation += (p.speed / TILE) * dt * p.grav;
    } else {
      p.rotation += (p.mode === "cube" ? 7.2 : 9) * dt * p.grav;
    }
  } else if (p.mode === "ship") {
    p.rotation = Math.max(-0.6, Math.min(0.6, (p.vy / SHIP_VY_MAX) * 0.6));
  } else if (p.mode === "wave") {
    p.rotation = (input.pressed ? -1 : 1) * 0.72 * p.grav;
    p.waveTrail.push({ x: p.x, y: p.y });
    if (p.waveTrail.length > 220) p.waveTrail.shift();
  } else if (p.mode === "ufo") {
    p.rotation = Math.max(-0.35, Math.min(0.35, p.vy / 1400));
  }

  if (p.dead) events.push({ type: "die", x: p.x, y: p.y });
  return events;
}

/** A safe-looking spot at or before `x` — used to place practice checkpoints. */
export function isSafeSpot(p) {
  return p.grounded && Math.abs(p.vy) < 1;
}
