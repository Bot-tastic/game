// levels.js — pure (no three.js/DOM) procedural level generation for Formula
// Legion. Levels are infinite: getLevelDef(index) derives a deterministic
// def for any index >= 0, and generateLevel(def) builds its event list from
// a seeded PRNG (mulberry32, same pattern as the other games in this repo).
//
// Design note on fairness: the player's gun always autofires at whatever
// wave is in range (no aiming skill involved), so a wave is beatable exactly
// when its total HP fits inside deliverable damage during its firing
// window. generateLevel() runs a "reference" legion through the exact same
// gate sequence the real run will see (gates are deterministic and apply to
// legion count/fire rate/damage only — never to fairness margins the
// player can't affect) and sizes each wave's HP against that reference's
// DPS at that point, with a fixed safety margin. This means every level is
// guaranteed completable by construction, independent of anything except
// the deterministic gate sequence itself.

export const LANE_HALF_WIDTH = 3;
export const PLAYER_X_CLAMP = 2.6;
export const RANGE = 22; // world units ahead a wave must be within to take fire

export const BASE_COUNT = 1;
export const BASE_FIRE_RATE = 2; // shots/sec equivalent
export const BASE_DAMAGE = 4; // damage per shot-equivalent
export const MIN_FIRE_RATE = 0.5;
export const MIN_DAMAGE = 1;

// Fraction of the theoretical max damage-in-window a wave's HP is sized to.
// Kept well under 1 so dt-step integration error and level-generation edge
// cases never produce an unfair wave.
const TARGET_FRACTION = 0.55;

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
      value = 1.25;
      label = "RATE+";
      break;
    case "fireRateSub":
      value = 0.8;
      label = "RATE-";
      break;
    case "damageAdd":
      value = 1.25;
      label = "DMG+";
      break;
    case "damageSub":
      value = 0.8;
      label = "DMG-";
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

/**
 * Build the full event list for a level def. Returns { ...def, events }
 * where events is a z-ascending array of:
 *   { type: "gate", z, op: {kind,value,label} }
 *   { type: "wave", z, hp, maxHp, cols, rows, penalty }
 */
export function generateLevel(def) {
  const rng = mulberry32(def.seed);
  const events = [];

  const ref = { count: BASE_COUNT, fireRate: BASE_FIRE_RATE, damage: BASE_DAMAGE };
  const window = RANGE / def.speed;

  const marginEnd = def.speed * 2.5;
  let cursor = def.speed * 4; // breathing room before the first event
  let lastType = null;

  while (cursor < def.length - marginEnd) {
    // Never two waves back to back (each needs its full window clear); a
    // gate can follow anything, including another gate.
    const placeWave = lastType !== "wave" && rng() < 0.5;

    if (!placeWave) {
      const op = rollGateOp(rng, def.difficulty);
      applyGateOp(ref, op);
      events.push({ type: "gate", z: cursor, op });
      lastType = "gate";
      cursor += def.speed * (1.6 + rng() * 1.4);
    } else {
      const dps = ref.count * ref.fireRate * ref.damage;
      const cols = 1 + Math.floor(rng() * 4);
      const rows = 1 + Math.floor(rng() * Math.min(3, 1 + def.difficulty * 2));
      const count = cols * rows;
      const targetHp = dps * window * TARGET_FRACTION;
      const hpEach = targetHp / count;
      const penalty = Math.min(3, 1 + Math.floor(count / 5));
      events.push({ type: "wave", z: cursor, hp: targetHp, maxHp: targetHp, hpEach, cols, rows, count, penalty, cleared: false, resolved: false });
      lastType = "wave";
      cursor += Math.max(def.speed * window + def.speed * 0.8, def.speed * (2.2 + rng() * 1.6));
    }
  }

  return { ...def, events };
}

export function bestScoreKey() {
  return "game-tastic:formula-legion:best";
}
