// legion.js — pure player-legion state (no three.js/DOM).

import { BASE_COUNT, BASE_FIRE_RATE, BASE_DAMAGE, PLAYER_X_CLAMP } from "./levels.js";

const STEER_SENSITIVITY = 0.018; // world units per CSS px of drag
const LATERAL_EASE_RATE = 10;

export function createLegion() {
  return {
    count: BASE_COUNT,
    fireRate: BASE_FIRE_RATE,
    damage: BASE_DAMAGE,
    x: 0, // lane position, world units
    targetX: 0,
  };
}

export function resetLegion(legion) {
  legion.count = BASE_COUNT;
  legion.fireRate = BASE_FIRE_RATE;
  legion.damage = BASE_DAMAGE;
  legion.x = 0;
  legion.targetX = 0;
}

export function dps(legion) {
  return legion.count * legion.fireRate * legion.damage;
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

/** Ease legion.x toward legion.targetX. Call once per frame. */
export function updateLateralEase(legion, dt) {
  legion.x += (legion.targetX - legion.x) * Math.min(1, LATERAL_EASE_RATE * dt);
}
