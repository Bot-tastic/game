// legion.js — pure player-legion state (no three.js/DOM).

import {
  BASE_COUNT,
  BASE_FIRE_RATE,
  BASE_DAMAGE,
  PLAYER_X_CLAMP,
  TIER_STEP,
  TIER_COLORS,
  MAX_TIER,
} from "./levels.js";

const STEER_SENSITIVITY = 0.022; // world units per CSS px of drag
const LATERAL_EASE_RATE = 12;
export const MAX_COUNT = 9999;

export function createLegion() {
  return {
    count: BASE_COUNT,
    fireRate: BASE_FIRE_RATE,
    tier: 1,
    shields: 0,
    coins: 0,
    perks: [],
    x: 0,
    targetX: 0,
    lean: 0,
  };
}

export function resetLegion(legion) {
  legion.count = BASE_COUNT;
  legion.fireRate = BASE_FIRE_RATE;
  legion.tier = 1;
  legion.shields = 0;
  legion.coins = 0;
  legion.perks = [];
  legion.x = 0;
  legion.targetX = 0;
  legion.lean = 0;
}

export function hasPerk(legion, id) {
  return legion.perks.indexOf(id) !== -1;
}

export function damagePerShot(legion) {
  let d = BASE_DAMAGE * Math.pow(TIER_STEP, legion.tier - 1);
  if (hasPerk(legion, "piercing")) d *= 1.25;
  return d;
}

export function effectiveFireRate(legion) {
  return legion.fireRate * (hasPerk(legion, "volley") ? 1.3 : 1);
}

export function dps(legion) {
  return legion.count * effectiveFireRate(legion) * damagePerShot(legion);
}

export function teamColor(legion) {
  return TIER_COLORS[Math.min(MAX_TIER, legion.tier) - 1];
}

/** Perk effects that fire once when a new level starts. */
export function applyLevelStartPerks(legion) {
  if (hasPerk(legion, "recruit")) legion.count = Math.min(MAX_COUNT, Math.round(legion.count * 1.25));
  if (hasPerk(legion, "plating")) legion.shields = Math.max(legion.shields, 2);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function beginSteer(legion, clientX) {
  legion._dragStartX = clientX;
  legion._dragStartTargetX = legion.targetX;
}

export function updateSteer(legion, clientX) {
  if (legion._dragStartX == null) return;
  const dx = (clientX - legion._dragStartX) * STEER_SENSITIVITY;
  legion.targetX = clamp(legion._dragStartTargetX + dx, -PLAYER_X_CLAMP, PLAYER_X_CLAMP);
}

export function endSteer(legion) {
  legion._dragStartX = null;
}

/** Keyboard steering nudge (arrows / A-D), world units per second. */
export function steerBy(legion, delta) {
  legion.targetX = clamp(legion.targetX + delta, -PLAYER_X_CLAMP, PLAYER_X_CLAMP);
  legion._dragStartX = null;
}

/** Ease legion.x toward legion.targetX and track lean for the crowd tilt. */
export function updateLateralEase(legion, dt) {
  const prev = legion.x;
  legion.x += (legion.targetX - legion.x) * Math.min(1, LATERAL_EASE_RATE * dt);
  const vel = dt > 0 ? (legion.x - prev) / dt : 0;
  legion.lean += (clamp(vel * 0.06, -0.35, 0.35) - legion.lean) * Math.min(1, 8 * dt);
}
