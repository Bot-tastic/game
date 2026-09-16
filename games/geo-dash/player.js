// player.js — per-mode physics for Geo Dash's four control modes. Each mode
// shares the same world-unit space and the same {x (world, = distance
// traveled), y, vy} player record, but reads input and applies
// gravity/thrust differently. Ground modes (cube/robot/ufo) collide against
// levels.js's floor height-map; ship collides against the floor/ceiling
// tunnel. Keeping all four in one file (rather than one per mode) is
// deliberate — they share constants and the step-tolerance landing rule, and
// splitting them would just scatter a handful of numbers across files.

import { floorAt, tunnelAt, GROUND_Y, GROUND_MODES } from "./levels.js";

const GRAVITY = 1500;
const STEP_TOLERANCE = 14; // world units of penetration tolerated as "landing", not "collision"
const FALL_DEATH_Y = 460; // fell through a pit past this world Y => dead

export const HITBOX = {
  cube: { halfW: 15, halfH: 15 },
  robot: { halfW: 13, halfH: 19 },
  ufo: { halfW: 15, halfH: 12 },
  ship: { halfW: 17, halfH: 11 },
};

const CUBE_JUMP_V = -560;
const ROBOT_JUMP_V = -480;
const ROBOT_HOLD_ACCEL = -1700; // extra upward accel while holding, capped by ROBOT_HOLD_TIME
const ROBOT_HOLD_TIME = 0.16;
const UFO_HOP_V = -480;
const SHIP_THRUST_ACCEL = -2600; // net with gravity while held: ~ -1100
const SHIP_VY_MAX = 320;

export function createPlayer() {
  return {
    x: 0,
    y: GROUND_Y - HITBOX.cube.halfH,
    vy: 0,
    mode: "cube",
    grounded: true,
    rotation: 0,
    holding: false,
    airborneJumpUsed: false,
    hopCooldown: 0,
    dead: false,
  };
}

/** Reposition the player cleanly at the start of a freshly-entered mode segment. */
export function snapToMode(player, level, mode) {
  player.mode = mode;
  player.vy = 0;
  player.airborneJumpUsed = false;
  if (mode === "ship") {
    const t = tunnelAt(level, player.x);
    player.y = (t.floorY + t.ceilY) / 2;
  } else {
    const floor = floorAt(level, player.x);
    const groundY = floor == null ? GROUND_Y : floor;
    player.y = groundY - HITBOX[mode].halfH;
    player.grounded = true;
  }
}

function getHalfH(mode) {
  return HITBOX[mode].halfH;
}

function updateGroundMode(player, level, dt, input) {
  const halfH = getHalfH(player.mode);
  const wasBottom = player.y + halfH;
  const prevFloor = floorAt(level, player.x);

  // Jump handling per mode, only meaningful at the moment of press/hold.
  if (player.mode === "cube") {
    if (input.justPressed && player.grounded) {
      player.vy = CUBE_JUMP_V;
      player.grounded = false;
    } else if (input.pressed && player.grounded) {
      // Classic GD "holding auto-rejumps on landing" behavior.
      player.vy = CUBE_JUMP_V;
      player.grounded = false;
    }
  } else if (player.mode === "robot") {
    if (input.justPressed && (player.grounded || !player.airborneJumpUsed)) {
      player.vy = ROBOT_JUMP_V;
      if (!player.grounded) player.airborneJumpUsed = true;
      player.grounded = false;
      player._holdTimer = 0;
    }
    if (input.pressed && player._holdTimer != null && player._holdTimer < ROBOT_HOLD_TIME) {
      player._holdTimer += dt;
      player.vy += ROBOT_HOLD_ACCEL * dt;
    } else {
      player._holdTimer = null;
    }
  } else if (player.mode === "ufo") {
    player.hopCooldown = Math.max(0, player.hopCooldown - dt);
    if (input.justPressed && player.hopCooldown <= 0) {
      player.vy = UFO_HOP_V;
      player.hopCooldown = 0.1;
      player.grounded = false;
    }
  }

  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;
  player.x += input.speed * dt;
  player.rotation += (player.mode === "cube" ? 6 : 3) * dt * (player.grounded ? 0 : 1);

  const floor = floorAt(level, player.x);
  if (floor == null) {
    // Over a pit: no floor to land on. Falling too far is death.
    player.grounded = false;
    if (player.y + halfH > FALL_DEATH_Y) player.dead = true;
    return;
  }

  const bottom = player.y + halfH;
  if (bottom >= floor) {
    const penetration = bottom - floor;
    if (penetration <= STEP_TOLERANCE || wasBottom <= prevFloor + 0.5) {
      // Flat landing (or was already at/above floor level last frame): clamp and land.
      player.y = floor - halfH;
      player.vy = 0;
      player.grounded = true;
      player.rotation = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);
      player.airborneJumpUsed = false;
    } else {
      // Ran into the vertical face of a raised block at ground level.
      player.dead = true;
    }
  } else {
    player.grounded = false;
  }
}

function updateShipMode(player, dt, input) {
  const accel = input.pressed ? GRAVITY + SHIP_THRUST_ACCEL : GRAVITY;
  player.vy += accel * dt;
  player.vy = Math.max(-SHIP_VY_MAX, Math.min(SHIP_VY_MAX, player.vy));
  player.y += player.vy * dt;
  player.x += input.speed * dt;
  player.rotation = Math.max(-0.5, Math.min(0.5, player.vy / SHIP_VY_MAX));
}

/**
 * Advance the player by dt. `input` is { pressed, justPressed, speed }
 * (speed = current world scroll speed, i.e. the player's forward velocity).
 * Mutates player in place; sets player.dead = true on any fatal collision.
 */
export function updatePlayer(player, level, dt, input) {
  if (player.dead) return;

  if (GROUND_MODES.includes(player.mode)) {
    updateGroundMode(player, level, dt, input);
  } else {
    updateShipMode(player, dt, input);
    const t = tunnelAt(level, player.x);
    const halfH = getHalfH("ship");
    if (player.y - halfH <= t.ceilY || player.y + halfH >= t.floorY) {
      player.dead = true;
    }
  }

  if (player.y > FALL_DEATH_Y || player.y < -60) player.dead = true;
}

/** Hazard (spike) overlap test — instant death regardless of mode. */
export function hitsHazard(player, level) {
  const half = HITBOX[player.mode];
  const left = player.x - half.halfW;
  const right = player.x + half.halfW;
  const top = player.y - half.halfH;
  const bottom = player.y + half.halfH;

  for (const h of level.hazards) {
    if (left < h.x1 && right > h.x0 && top < h.y1 && bottom > h.y0) return true;
  }
  return false;
}
