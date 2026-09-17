// combat.js — pure per-frame run simulation (no three.js/DOM). Shared by the
// live game loop (main.js) and reusable for a headless fairness check, the
// same split used by geo-dash's levels.js/player.js.

import { RANGE, HIT_RADIUS, applyGateOp } from "./levels.js";
import { dps } from "./legion.js";

// Reward for finishing a level, scaled by how strong the legion is at that
// moment (its current dps) — a bigger/better-equipped army banks more, on
// top of whatever score it earned clearing waves along the way.
const LEVEL_CLEAR_BONUS_SCALE = 3;

/** Index of the nearest still-alive column to x within HIT_RADIUS, or -1. */
function nearestColumn(ev, x) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < ev.colHp.length; i++) {
    if (ev.colHp[i] <= 0) continue;
    const d = Math.abs(ev.colX[i] - x);
    if (d <= HIT_RADIUS && d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * The wave (if any) currently taking fire and which of its columns is the
 * live target, given the legion's position. Pure/read-only — used both
 * inside stepRun to apply damage and by the renderer to know where to aim
 * bullet tracers, so the two never drift out of sync.
 */
export function findActiveTarget(level, playerZ, legionX) {
  for (const ev of level.events) {
    if (ev.type !== "wave" || ev.resolved || ev.cleared) continue;
    const dist = ev.z - playerZ;
    if (dist > RANGE || dist < -0.001) continue;
    const col = nearestColumn(ev, legionX);
    if (col === -1) continue;
    return { ev, col, x: ev.colX[col], z: ev.z };
  }
  return null;
}

/** Fresh run state for a generated level + a legion object (mutated in place). */
export function createRun(level, legion) {
  return {
    level,
    legion,
    playerZ: 0,
    score: 0,
    dead: false,
    finished: false,
  };
}

/**
 * Advance the run by dt seconds. Mutates run.legion in place (gate ops,
 * wave-miss penalties) and run's own score/dead/finished flags. Returns
 * nothing — read the fields back off `run`/`run.legion`.
 */
export function stepRun(run, dt) {
  if (run.dead || run.finished) return;

  run.playerZ += run.level.speed * dt;

  for (const ev of run.level.events) {
    if (ev.type === "gate") {
      if (!ev.applied && ev.z <= run.playerZ) {
        ev.applied = true;
        ev.chosen = run.legion.x < 0 ? "left" : "right";
        applyGateOp(run.legion, ev[ev.chosen]);
      }
      continue;
    }

    // wave
    if (ev.resolved) continue;
    const dist = ev.z - run.playerZ;
    if (!ev.cleared && dist <= RANGE && dist >= -0.001) {
      const target = nearestColumn(ev, run.legion.x);
      if (target !== -1) {
        ev.colHp[target] -= dps(run.legion) * dt;
        if (ev.colHp[target] <= 0) {
          ev.colHp[target] = 0;
          if (ev.colHp.every((hp) => hp <= 0)) {
            ev.cleared = true;
            run.score += Math.round(ev.maxHp);
          }
        }
      }
    }
    if (ev.z <= run.playerZ) {
      ev.resolved = true;
      if (!ev.cleared) {
        const columnsLeft = ev.colHp.filter((hp) => hp > 0).length;
        run.legion.count -= ev.penalty * columnsLeft;
        if (run.legion.count <= 0) {
          run.legion.count = 0;
          run.dead = true;
        }
      }
    }
  }

  if (!run.dead && run.playerZ >= run.level.length) {
    run.finished = true;
    run.score += Math.round(dps(run.legion) * LEVEL_CLEAR_BONUS_SCALE);
  }
}
