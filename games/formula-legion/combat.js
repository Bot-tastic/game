// combat.js — pure per-frame run simulation (no three.js/DOM). Everything the
// presentation layer needs to react to is pushed onto run.events as small
// plain objects, so main.js can drive FX/audio without re-deriving game state.

import { RANGE, HIT_RADIUS, COIN_RADIUS, applyGateOp, rollRisk, GOOD_KINDS } from "./levels.js";
import { dps, hasPerk, MAX_COUNT } from "./legion.js";

const LEVEL_CLEAR_BONUS = 4;
const COIN_SCORE = 25;
const BOSS_SHOT_SPEED = 22;
const BOSS_SHOT_INTERVAL = 1.5;
const BOSS_SHOT_RADIUS = 1.1;

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

function loseUnits(run, amount, reason) {
  const legion = run.legion;
  if (legion.shields > 0) {
    legion.shields--;
    emit(run, { type: "shield" });
    return;
  }
  let lost = Math.max(1, Math.round(amount));
  if (hasPerk(legion, "salvage")) lost = Math.max(1, Math.round(lost * 0.65));
  lost = Math.min(lost, legion.count);
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
          run.score += Math.round(ev.maxHp * (ev.boss ? 2 : 1));
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
      loseUnits(run, legion.count * 0.42 * remaining + ev.cols, "wall");
    }
  }
}

function stepCoins(run, ev) {
  const legion = run.legion;
  for (const item of ev.items) {
    if (item.taken || item.z > run.playerZ) continue;
    item.taken = true;
    if (Math.abs(item.x - legion.x) <= COIN_RADIUS) {
      const worth = COIN_SCORE * (hasPerk(legion, "scavenge") ? 3 : 1);
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
    run.score += Math.round(dps(run.legion) * LEVEL_CLEAR_BONUS);
  }
}
