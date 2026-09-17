// scoring.js — score, the decaying combo multiplier, the RAMPAGE overdrive
// state, damage, and high-score persistence.

import { loadHighScore, saveHighScore } from "../../shared/game-utils.js";

const HIGHSCORE_KEY = "game-tastic:demolition-run:highscore";

export const COMBO_WINDOW = 2.6; // seconds of grace between smashes
export const RAMPAGE_AT = 12; // chained smashes needed to go overdrive
export const RAMPAGE_DURATION = 7;

export function createScoreState() {
  return {
    score: 0,
    damage: 0,
    combo: 0,
    comboTimer: 0,
    multiplier: 1,
    rampage: 0,
    rampageFired: false,
    bestCombo: 0,
    smashes: 0,
    nearMisses: 0,
  };
}

/** Multiplier curve: 1x .. 8x, doubled while RAMPAGE is up. */
function multiplierFor(state) {
  const base = 1 + Math.min(7, Math.floor(state.combo / 2) * 0.5);
  return state.rampage > 0 ? base * 2 : base;
}

/**
 * Register a smash. Returns { points, multiplier, rampageStarted } so the
 * caller can throw up a popup at the impact point.
 */
export function registerSmash(state, prop, speedNorm) {
  state.combo += 1;
  state.comboTimer = COMBO_WINDOW;
  state.smashes += 1;
  if (state.combo > state.bestCombo) state.bestCombo = state.combo;

  let rampageStarted = false;
  if (state.combo >= RAMPAGE_AT && state.rampage <= 0 && !state.rampageFired) {
    state.rampage = RAMPAGE_DURATION;
    state.rampageFired = true;
    rampageStarted = true;
  }

  state.multiplier = multiplierFor(state);
  const speedBonus = 1 + speedNorm * 1.2;
  const points = Math.round(prop.points * speedBonus * state.multiplier);
  state.score += points;
  return { points, multiplier: state.multiplier, rampageStarted };
}

export function registerNearMiss(state) {
  state.nearMisses += 1;
  state.comboTimer = Math.max(state.comboTimer, COMBO_WINDOW * 0.6);
  const points = Math.round(30 * state.multiplier);
  state.score += points;
  return points;
}

export function registerAir(state, airTime) {
  const points = Math.round(airTime * 220 * state.multiplier);
  state.score += points;
  state.comboTimer = Math.max(state.comboTimer, COMBO_WINDOW * 0.8);
  return points;
}

/** Tick the combo/rampage timers. Returns true on the frame the combo drops. */
export function tickScore(state, dt) {
  let dropped = false;
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      dropped = state.combo > 0;
      state.combo = 0;
      state.comboTimer = 0;
      state.rampageFired = false;
    }
  }
  if (state.rampage > 0) {
    state.rampage -= dt;
    if (state.rampage < 0) state.rampage = 0;
  }
  state.multiplier = multiplierFor(state);
  return dropped;
}

export function applyDamage(state, amount) {
  state.damage = Math.min(100, Math.max(0, state.damage + amount));
  return state.damage;
}

export function loadBest() {
  return loadHighScore(HIGHSCORE_KEY, 0);
}

export function saveBestIfNeeded(score, currentBest) {
  if (score > currentBest) {
    saveHighScore(HIGHSCORE_KEY, score);
    return score;
  }
  return currentBest;
}
