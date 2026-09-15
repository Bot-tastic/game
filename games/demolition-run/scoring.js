// scoring.js — score/damage state, speed-multiplier scoring, and high-score
// persistence for Demolition Run.
//
// Contract:
//   createScoreState()               -> { score: 0, damage: 0 }
//   awardPoints(scoreState, prop, carSpeed)
//       adds Math.round(prop.basePoints * speedMultiplier) to scoreState.score,
//       where speedMultiplier = 1 + (carSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)
//       (ranges 1.0 at MIN_SPEED=8 to 2.0 at MAX_SPEED=40).
//   applyDamage(scoreState, amount)
//       adds `amount` to scoreState.damage, clamps to [0, 100]. No passive
//       decay — damage only ever goes up during a run.
//   loadBest() / saveBestIfNeeded(score)
//       thin wrapper around shared/game-utils.js's loadHighScore/saveHighScore
//       under this game's localStorage key, mirroring flappy-tap's
//       load-once/update-on-beat pattern.

import { loadHighScore, saveHighScore } from "../../shared/game-utils.js";

const HIGHSCORE_KEY = "game-tastic:demolition-run:highscore";

const MIN_SPEED = 8;
const MAX_SPEED = 40;

/** Fresh score/damage state for a run. */
export function createScoreState() {
  return { score: 0, damage: 0 };
}

/** Award points for smashing `prop`, scaled by current car speed. */
export function awardPoints(scoreState, prop, carSpeed) {
  const speedMultiplier = 1 + (carSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  scoreState.score += Math.round(prop.basePoints * speedMultiplier);
}

/** Add `amount` damage, clamped to [0, 100]. */
export function applyDamage(scoreState, amount) {
  scoreState.damage = Math.min(100, Math.max(0, scoreState.damage + amount));
}

/** Load the persisted best score (0 if none yet). Call once at boot. */
export function loadBest() {
  return loadHighScore(HIGHSCORE_KEY, 0);
}

/**
 * Persist `score` as the new best if it beats `currentBest`. Returns the
 * (possibly updated) best value, mirroring flappy-tap's inline pattern but
 * factored out so main.js doesn't need to touch localStorage directly.
 */
export function saveBestIfNeeded(score, currentBest) {
  if (score > currentBest) {
    saveHighScore(HIGHSCORE_KEY, score);
    return score;
  }
  return currentBest;
}
