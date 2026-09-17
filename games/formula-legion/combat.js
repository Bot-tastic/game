// combat.js — pure per-frame run simulation (no three.js/DOM). Everything the
// presentation layer needs to react to is pushed onto run.events as small
// plain objects, so main.js can drive FX/audio without re-deriving game state.

import { RANGE, HIT_RADIUS, COIN_RADIUS, applyGateOp, rollRisk, GOOD_KINDS } from "./levels.js";
import { dps, hasPerk, MAX_COUNT } from "./legion.js";

// Score is deliberately NOT tied to raw dps: headcount grows exponentially in
// this genre, and a score in the tens of millions stops meaning anything.
// Points come from things the player actually did — walls broken, coins taken,
// levels survived — weighted by how deep the run got.
const WALL_SCORE = 120;
const BOSS_MULT = 5;
const LEVEL_CLEAR_SCORE = 400;
const COIN_SCORE = 20;
const BOSS_SHOT_SPEED = 22;
const BOSS_SHOT_INTERVAL = 1.5;
const BOSS_SHOT_RADIUS = 1.1;
// Fraction of a wall left standing at impact that counts as a total overrun.
const WIPE_THRESHOLD = 0.75;

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

/** The wall currently taking fire and which column is the live target. */
export function findActiveTarget(level, playerZ, legionX) {
  for (const ev of level.events) {
    if (ev.type !== "wall" || ev.resolved || ev.cleared) continue;
    const dist = ev.z - playerZ;
    if (dist > RANGE || dist < -0.001) continue;
    const col = nearestColumn(ev, legionX);
    if (col === -1) continue;
    return { ev, col, x: ev.colX[col], z: ev.z };
  }
  return null;
}

/** The next unresolved wall ahead of the player, for the incoming warning. */
export function nextWall(level, playerZ) {
  for (const ev of level.events) {
    if (ev.type !== "wall" || ev.resolved || ev.cleared) continue;
    if (ev.z >= playerZ) return ev;
  }
  return null;
}

export function createRun(level, legion) {
  return {
    level,
    legion,
    playerZ: 0,
    score: 0,
    dead: false,
    finished: false,
    events: [],
    rng: Math.random,
  };
}

function emit(run, e) {
  run.events.push(e);
}

/**
 * Take a loss. `survivable` losses always leave at least one trooper alive:
 * only a wall the legion barely scratched (see stepWall) can actually end a
 * run, so a wipe always traces back to a gate the player misread rather than
 * to accumulated chip damage.
 */
function loseUnits(run, amount, reason, survivable = true) {
  const legion = run.legion;
  if (legion.shields > 0) {
    legion.shields--;
    emit(run, { type: "shield" });
    return;
  }
  let lost = Math.max(1, Math.round(amount));
  // Salvage softens ordinary losses but cannot save a legion that was run
  // over outright — otherwise no run would ever actually end.
  if (survivable && hasPerk(legion, "salvage")) lost = Math.max(1, Math.round(lost * 0.65));
  lost = Math.min(lost, survivable ? legion.count - 1 : legion.count);
  if (lost <= 0) return;
  legion.count -= lost;
  emit(run, { type: "lost", n: lost, reason });
  if (legion.count <= 0) {
    legion.count = 0;
    run.dead = true;
  }
}

function applyGate(run, ev) {
  const legion = run.legion;
  ev.applied = true;
  ev.chosen = legion.x < 0 ? "left" : "right";
  let op = ev[ev.chosen];
  if (op.kind === "risk") {
    op = rollRisk(run.rng);
    ev.resolvedOp = op;
  }
  const before = legion.count;
  applyGateOp(legion, op);
  legion.count = Math.min(MAX_COUNT, legion.count);
  emit(run, {
    type: "gate",
    op,
    side: ev.chosen,
    good: GOOD_KINDS.has(op.kind),
    delta: legion.count - before,
    x: ev.chosen === "left" ? -1.6 : 1.6,
  });
  if (legion.count <= 0) {
    legion.count = 0;
    run.dead = true;
  }
}

function stepWall(run, ev, dt) {
  const legion = run.legion;
  const dist = ev.z - run.playerZ;

  // boss walls shoot back
  if (ev.boss && !ev.cleared && dist <= RANGE * 1.3 && dist > -2) {
    ev.shotTimer -= dt;
    if (ev.shotTimer <= 0) {
      ev.shotTimer = BOSS_SHOT_INTERVAL;
      const lane = ev.colX[Math.floor(run.rng() * ev.colX.length)];
      ev.shots.push({ x: lane, z: ev.z - 1 });
      emit(run, { type: "bossShot", x: lane, z: ev.z - 1 });
    }
  }
  for (let i = ev.shots.length - 1; i >= 0; i--) {
    const s = ev.shots[i];
    s.z -= BOSS_SHOT_SPEED * dt;
    if (s.z <= run.playerZ) {
      if (Math.abs(s.x - legion.x) < BOSS_SHOT_RADIUS) {
        emit(run, { type: "bossHit", x: s.x, z: run.playerZ });
        loseUnits(run, legion.count * 0.18 + 2, "boss");
      }
      ev.shots.splice(i, 1);
    } else if (s.z < run.playerZ - 6) {
      ev.shots.splice(i, 1);
    }
  }

  if (!ev.cleared && dist <= RANGE && dist >= -0.001) {
    const target = nearestColumn(ev, legion.x);
    if (target !== -1) {
      let out = dps(legion) * dt;
      if (ev.boss && hasPerk(legion, "vanguard")) out *= 2;
      const before = ev.colHp[target];
      ev.colHp[target] = Math.max(0, before - out);
      emit(run, { type: "damage", col: target, ev, amount: out, x: ev.colX[target], z: ev.z });
      if (ev.colHp[target] === 0 && before > 0) {
        emit(run, { type: "columnDown", col: target, ev, x: ev.colX[target], z: ev.z });
        if (ev.colHp.every((hp) => hp <= 0)) {
          ev.cleared = true;
          run.score += WALL_SCORE * run.level.id * (ev.boss ? BOSS_MULT : 1);
          if (hasPerk(legion, "momentum")) {
            legion.count = Math.min(MAX_COUNT, Math.round(legion.count * 1.08) + 1);
          }
          emit(run, { type: "wallCleared", ev, boss: ev.boss, z: ev.z });
        }
      }
    }
  }

  if (ev.z <= run.playerZ && !ev.resolved) {
    ev.resolved = true;
    if (!ev.cleared) {
      const remaining = ev.colHp.reduce((s, h) => s + h, 0) / ev.maxHp;
      emit(run, { type: "crash", z: ev.z, boss: ev.boss });
      // Readable, dramatic rule: a wall you barely scratched runs the legion
      // over completely (a shield still eats it whole). Anything you got
      // meaningfully into only costs troops, and never your last one — so a
      // wipe always traces back to arriving at a wall you had no business
      // meeting, which the incoming-wall warning told you about in advance.
      // Level 1 is where the player learns that fire only lands on the column
      // they are lined up with; ending that lesson with a score-0 run teaches
      // nothing, so the first level always leaves a survivor to rebuild from.
      const fatal = remaining >= WIPE_THRESHOLD && run.level.id > 1;
      if (fatal) loseUnits(run, legion.count, "wall", false);
      else loseUnits(run, legion.count * (0.25 + 0.5 * remaining) + ev.cols, "wall", true);
    }
  }
}

function stepCoins(run, ev) {
  const legion = run.legion;
  for (const item of ev.items) {
    if (item.taken || item.z > run.playerZ) continue;
    item.taken = true;
    if (Math.abs(item.x - legion.x) <= COIN_RADIUS) {
      const worth = COIN_SCORE * run.level.id * (hasPerk(legion, "scavenge") ? 3 : 1);
      run.score += worth;
      legion.coins++;
      emit(run, { type: "coin", x: item.x, z: item.z, worth });
    }
  }
}

/** Advance the run by dt seconds. Mutates run.legion and run's own flags. */
export function stepRun(run, dt) {
  if (run.dead || run.finished) return;
  run.events.length = 0;
  run.playerZ += run.level.speed * dt;

  for (const ev of run.level.events) {
    if (ev.type === "gate") {
      if (!ev.applied && ev.z <= run.playerZ) applyGate(run, ev);
    } else if (ev.type === "coins") {
      stepCoins(run, ev);
    } else if (!ev.resolved || ev.shots.length) {
      stepWall(run, ev, dt);
    }
    if (run.dead) return;
  }

  if (!run.dead && run.playerZ >= run.level.length) {
    run.finished = true;
    run.score += LEVEL_CLEAR_SCORE * run.level.id;
  }
}
