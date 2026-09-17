// combat.js — pure per-frame run simulation (no three.js/DOM). Shared by the
// live game loop (main.js) and reusable for a headless fairness check, the
// same split used by geo-dash's levels.js/player.js.

import { RANGE, applyGateOp } from "./levels.js";
import { dps } from "./legion.js";

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
      ev.hp -= dps(run.legion) * dt;
      if (ev.hp <= 0) {
        ev.hp = 0;
        ev.cleared = true;
        run.score += Math.round(ev.maxHp);
      }
    }
    if (ev.z <= run.playerZ) {
      ev.resolved = true;
      if (!ev.cleared) {
        run.legion.count -= ev.penalty;
        if (run.legion.count <= 0) {
          run.legion.count = 0;
          run.dead = true;
        }
      }
    }
  }

  if (!run.dead && run.playerZ >= run.level.length) {
    run.finished = true;
  }
}
