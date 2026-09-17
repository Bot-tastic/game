// levels.js — pure (no three.js/DOM) procedural level generation for Formula
// Legion. Levels are infinite: getLevelDef(index) derives a deterministic
// def for any index >= 0, and generateLevel(def) builds its event list from
// a seeded PRNG (mulberry32, same pattern as the other games in this repo).
//
// Design note on fairness: the gun always autofires (no timing/aiming
// skill), but it only ever damages the column of enemies nearest the
// legion's current x (see HIT_RADIUS) — so clearing a wave with several
// columns means actually steering across to each one before it reaches you.
// generateLevel() sizes each wave's total HP against a "reference" legion's
// DPS at that point, discounted by a conservative time budget for the
// column-switching travel (SWITCH_TIME) so the numbers stay beatable even
// though real movement is now required, not just automatic hits. Gates come
// in pairs (steer left or right to choose one of two operations); the
// reference legion tracks the WORSE possible outcome per stat (see
// worstCaseGateUpdate below) so every level stays completable no matter
// which side of every gate the player picks.

export const LANE_HALF_WIDTH = 3;
export const PLAYER_X_CLAMP = 2.6;
export const RANGE = 22; // world units ahead a wave must be within to take fire

// A wave's enemies are spread across up to 4 columns; the gun only ever
// damages the column nearest the legion's current x, so clearing a
// multi-column wave means actually steering across to each one in turn —
// this is the whole point (previously every column took damage regardless
// of position, which made steering during combat pointless).
export const WAVE_COLUMN_HALF_SPAN = PLAYER_X_CLAMP * 0.9;
// Must stay under half the tightest column spacing (4 columns across
// WAVE_COLUMN_HALF_SPAN*2 gives ~0.78 half-spacing) so distinct columns
// never both read as "in range" from the same legion position.
export const HIT_RADIUS = 0.7;
// Time budget (seconds) generation assumes a real steer-to-adjacent-column
// costs, given the legion's lateral ease rate — used only to size wave HP
// conservatively, never to change actual runtime movement.
const SWITCH_TIME = 0.35;

export const BASE_COUNT = 1;
export const BASE_FIRE_RATE = 2; // shots/sec equivalent
export const BASE_DAMAGE = 4; // damage per shot-equivalent
export const MIN_FIRE_RATE = 0.5;
export const MIN_DAMAGE = 1;

// Fraction of the theoretical max damage-in-window a wave's HP is sized to.
// Close to 1 makes every wave a real threat; kept just under it so dt-step
// integration error never produces a mathematically-unfair wave.
const TARGET_FRACTION = 0.88;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Deterministic level def for any level index (0-based). Infinite. */
export function getLevelDef(index) {
  const difficulty = clamp(index / 24, 0, 1); // ramps up over ~25 levels, then plateaus
  const speed = 10 + difficulty * 5.5; // world units/sec, 10 -> 15.5
  const duration = 75 + ((index * 37) % 60); // 75-134s, varied but deterministic — "1-3 minutes"
  return {
    id: index + 1,
    seed: 1000 + index * 97,
    difficulty,
    speed,
    length: Math.round(speed * duration),
  };
}

// Weighted gate op table. Every op is full-lane-width and mandatory — the
// player can't dodge a gate, only choose how well-positioned their legion
// already is when it hits (which is itself entirely gate-driven).
const GATE_OPS = [
  { kind: "countAdd", weight: 0.22 },
  { kind: "countSub", weight: 0.12 },
  { kind: "countMul", weight: 0.1 },
  { kind: "countDiv", weight: 0.1 },
  { kind: "fireRateAdd", weight: 0.12 },
  { kind: "fireRateSub", weight: 0.08 },
  { kind: "damageAdd", weight: 0.12 },
  { kind: "damageSub", weight: 0.08 },
];
const GATE_OPS_TOTAL = GATE_OPS.reduce((s, o) => s + o.weight, 0);

function rollGateOp(rng, difficulty) {
  let r = rng() * GATE_OPS_TOTAL;
  let kind = GATE_OPS[0].kind;
  for (const o of GATE_OPS) {
    if (r < o.weight) {
      kind = o.kind;
      break;
    }
    r -= o.weight;
  }

  let value = 1;
  let label = "";
  switch (kind) {
    case "countAdd":
      value = 2 + Math.floor(rng() * 4) + Math.floor(difficulty * 3);
      label = `+${value}`;
      break;
    case "countSub":
      value = 1 + Math.floor(rng() * 3);
      label = `-${value}`;
      break;
    case "countMul":
      value = rng() < 0.7 ? 2 : 3;
      label = `×${value}`;
      break;
    case "countDiv":
      value = rng() < 0.7 ? 2 : 3;
      label = `÷${value}`;
      break;
    case "fireRateAdd":
      value = 1.2 + Math.floor(rng() * 3) * 0.1; // 1.2 - 1.4
      label = `RATE ×${value.toFixed(1)}`;
      break;
    case "fireRateSub":
      value = 0.6 + Math.floor(rng() * 3) * 0.1; // 0.6 - 0.8
      label = `RATE ×${value.toFixed(1)}`;
      break;
    case "damageAdd":
      value = 1.2 + Math.floor(rng() * 3) * 0.1;
      label = `DMG ×${value.toFixed(1)}`;
      break;
    case "damageSub":
      value = 0.6 + Math.floor(rng() * 3) * 0.1;
      label = `DMG ×${value.toFixed(1)}`;
      break;
  }
  return { kind, value, label };
}

/** Apply one gate op to a plain {count, fireRate, damage} legion-like state. */
export function applyGateOp(state, op) {
  switch (op.kind) {
    case "countAdd":
      state.count += op.value;
      break;
    case "countSub":
      state.count = Math.max(1, state.count - op.value);
      break;
    case "countMul":
      state.count *= op.value;
      break;
    case "countDiv":
      state.count = Math.max(1, Math.floor(state.count / op.value));
      break;
    case "fireRateAdd":
      state.fireRate *= op.value;
      break;
    case "fireRateSub":
      state.fireRate = Math.max(MIN_FIRE_RATE, state.fireRate * op.value);
      break;
    case "damageAdd":
      state.damage *= op.value;
      break;
    case "damageSub":
      state.damage = Math.max(MIN_DAMAGE, state.damage * op.value);
      break;
  }
}

function dpsOf(state) {
  return state.count * state.fireRate * state.damage;
}

// Update the fairness reference for a choice gate using a per-dimension
// worst-case LOWER BOUND rather than "whichever side's total dps is lower":
// a gate always changes exactly one of {count, fireRate, damage} (whichever
// dimension a chosen op's kind targets), so for each dimension separately,
// the worst possible outcome is the smaller of "this side's effect on that
// dimension" and "the other side's effect on that dimension" (which is a
// no-op if that side targets a different dimension). Taking this min
// independently per dimension — rather than assuming one single consistent
// choice minimizes total dps — stays a valid lower bound on real dps no
// matter which side the player actually picks at every gate in the level,
// because actual dps is always >= the product of each dimension's own
// worst-case-so-far value.
function worstCaseGateUpdate(ref, left, right) {
  for (const dim of ["count", "fireRate", "damage"]) {
    const tempLeft = { ...ref };
    applyGateOp(tempLeft, left);
    const tempRight = { ...ref };
    applyGateOp(tempRight, right);
    ref[dim] = Math.min(tempLeft[dim], tempRight[dim]);
  }
}

/** Roll two distinct-kind ops for a choice gate; returns {left, right}. */
function rollGatePair(rng, difficulty) {
  const left = rollGateOp(rng, difficulty);
  let right = rollGateOp(rng, difficulty);
  let guard = 0;
  while (right.kind === left.kind && guard++ < 8) right = rollGateOp(rng, difficulty);
  return { left, right };
}

/**
 * Build the full event list for a level def. Returns { ...def, events }
 * where events is a z-ascending array of:
 *   { type: "gate", z, left: {kind,value,label}, right: {kind,value,label} }
 *   { type: "wave", z, maxHp, hpEach, cols, rows, count, colX, colHp, penalty }
 *     colX/colHp are parallel per-column arrays; a column is "cleared" once
 *     its colHp reaches 0, and the whole wave once every column is.
 */
export function generateLevel(def) {
  const rng = mulberry32(def.seed);
  const events = [];

  const ref = { count: BASE_COUNT, fireRate: BASE_FIRE_RATE, damage: BASE_DAMAGE };
  const window = RANGE / def.speed;

  const marginEnd = def.speed * 2.5;
  let cursor = def.speed * 3.5; // breathing room before the first event
  let lastType = null;

  while (cursor < def.length - marginEnd) {
    // Never two waves back to back (each needs its full window clear); a
    // gate can follow anything, including another gate. Weighted toward
    // waves compared to the original pass — this is meant to feel dense.
    const placeWave = lastType !== "wave" && rng() < 0.62;

    if (!placeWave) {
      const { left, right } = rollGatePair(rng, def.difficulty);
      worstCaseGateUpdate(ref, left, right);
      events.push({ type: "gate", z: cursor, left, right });
      lastType = "gate";
      cursor += def.speed * (1.3 + rng() * 1.0);
    } else {
      const dps = dpsOf(ref);
      const cols = 1 + Math.floor(rng() * 4);
      const rows = 1 + Math.floor(rng() * Math.min(3, 1 + def.difficulty * 2));
      const count = cols * rows;

      // Only the column nearest the legion's current x takes damage, so
      // clearing every column costs real travel time between them — budget
      // for that conservatively (see SWITCH_TIME) rather than assuming the
      // full window is available for pure damage output.
      const usableWindow = Math.max(window * 0.4, window - cols * SWITCH_TIME);
      const targetHp = dps * usableWindow * TARGET_FRACTION;
      const hpEach = targetHp / count;

      const colX = [];
      const colHp = [];
      for (let c = 0; c < cols; c++) {
        colX.push(cols === 1 ? 0 : ((c / (cols - 1)) * 2 - 1) * WAVE_COLUMN_HALF_SPAN);
        colHp.push(targetHp / cols);
      }

      const penalty = Math.min(3, 1 + Math.floor(count / 5));
      events.push({
        type: "wave",
        z: cursor,
        maxHp: targetHp,
        hpEach,
        cols,
        rows,
        count,
        colX,
        colHp,
        penalty,
        cleared: false,
        resolved: false,
      });
      lastType = "wave";
      cursor += Math.max(def.speed * window + def.speed * 0.5, def.speed * (1.8 + rng() * 1.2));
    }
  }

  return { ...def, events };
}

export function bestScoreKey() {
  return "game-tastic:formula-legion:best";
}
