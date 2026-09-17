// levels.js — pure procedural content for Formula Legion (no three.js/DOM).
// Levels are infinite: getLevelDef(index) derives a deterministic def for any
// index >= 0, generateLevel(def) builds its z-ascending event list from a
// seeded PRNG (mulberry32, the pattern used across this repo).
//
// Fairness: the gun autofires but only damages the enemy column nearest the
// legion's x, so a wall's HP is sized against a "reference" legion that
// tracks the WORST outcome the player could pick at every gate so far,
// discounted by the travel time of switching columns. That keeps every level
// mathematically clearable no matter which side of every gate is chosen.

export const LANE_HALF_WIDTH = 3.9;
export const PLAYER_X_CLAMP = 3.1;
export const RANGE = 26; // world units ahead a wall must be within to take fire
export const COLUMN_HALF_SPAN = 2.5;
export const HIT_RADIUS = 1.0;
export const COIN_RADIUS = 1.3;
export const WARN_DISTANCE = 42;

const SWITCH_TIME = 0.4; // seconds budgeted per column switch when sizing HP
const TARGET_FRACTION = 0.8; // wall HP as a fraction of the reference max damage

export const BASE_COUNT = 10;
export const BASE_FIRE_RATE = 3.2;
export const BASE_DAMAGE = 3;
export const MIN_FIRE_RATE = 1;
export const MAX_TIER = 6;
export const TIER_STEP = 1.45; // damage multiplier per weapon tier

/** Per-tier team colours; the crowd recolours as the weapon tier climbs. */
export const TIER_COLORS = [0x4f8cff, 0x35d6c0, 0x7ef26a, 0xffd23f, 0xff8a3d, 0xff4d6d];
export const TIER_NAMES = ["Rifle", "Carbine", "Pulse", "Plasma", "Rail", "Nova"];

export const THEMES = [
  {
    name: "Neon Verge",
    skyTop: 0x120f2e,
    skyBot: 0x5c2b8a,
    fog: 0x2a1c52,
    road: 0x191530,
    edge: 0x00e5ff,
    accent: 0xff3fa4,
    prop: 0x2b2258,
    light: 0xa88cff,
    stars: true,
  },
  {
    name: "Ember Waste",
    skyTop: 0x2a0d10,
    skyBot: 0xd1502a,
    fog: 0x5c2318,
    road: 0x2a1a16,
    edge: 0xffb020,
    accent: 0xff5d3a,
    prop: 0x4a2a20,
    light: 0xffc48a,
    stars: false,
  },
  {
    name: "Glacier Run",
    skyTop: 0x06213a,
    skyBot: 0x7fd8ff,
    fog: 0x2b5f80,
    road: 0x1b3145,
    edge: 0x9df4ff,
    accent: 0x4fa8ff,
    prop: 0x2c4b63,
    light: 0xd8f4ff,
    stars: false,
  },
  {
    name: "Void Circuit",
    skyTop: 0x05060d,
    skyBot: 0x18304f,
    fog: 0x0d1526,
    road: 0x101624,
    edge: 0x5ee6c8,
    accent: 0x9d6bff,
    prop: 0x1b2438,
    light: 0x8fb6ff,
    stars: true,
  },
  {
    name: "Solar Deck",
    skyTop: 0x2b1240,
    skyBot: 0xffb35c,
    fog: 0x6e3a52,
    road: 0x2c1e33,
    edge: 0xffe08a,
    accent: 0xff6ba8,
    prop: 0x4a2f52,
    light: 0xffd9a8,
    stars: false,
  },
];

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
  const difficulty = clamp(index / 18, 0, 1);
  const speed = 13 + difficulty * 6;
  const duration = 26 + ((index * 7) % 9); // 26-34s — short, punchy levels
  const boss = (index + 1) % 3 === 0;
  return {
    id: index + 1,
    seed: 1000 + index * 97,
    difficulty,
    speed,
    boss,
    theme: THEMES[index % THEMES.length],
    length: Math.round(speed * duration),
  };
}

// ---- gate operations -------------------------------------------------------

export const GOOD_KINDS = new Set(["countAdd", "countMul", "rateUp", "tierUp", "shieldUp"]);

const GOOD_OPS = ["countAdd", "countMul", "rateUp", "tierUp", "shieldUp"];
const BAD_OPS = ["countSub", "countDiv", "rateDown"];

function makeOp(kind, rng, difficulty) {
  let value = 1;
  let label = "";
  let sub = "";
  switch (kind) {
    case "countAdd":
      value = 8 + Math.floor(rng() * 14) + Math.floor(difficulty * 20);
      label = `+${value}`;
      sub = "TROOPS";
      break;
    case "countMul":
      value = rng() < 0.65 ? 2 : 3;
      label = `×${value}`;
      sub = "TROOPS";
      break;
    case "countSub":
      value = 5 + Math.floor(rng() * 8) + Math.floor(difficulty * 12);
      label = `−${value}`;
      sub = "TROOPS";
      break;
    case "countDiv":
      value = rng() < 0.7 ? 2 : 3;
      label = `÷${value}`;
      sub = "TROOPS";
      break;
    case "rateUp":
      value = 1.2 + Math.floor(rng() * 3) * 0.1;
      label = `×${value.toFixed(1)}`;
      sub = "FIRE RATE";
      break;
    case "rateDown":
      value = 0.6 + Math.floor(rng() * 3) * 0.1;
      label = `×${value.toFixed(1)}`;
      sub = "FIRE RATE";
      break;
    case "tierUp":
      value = 1;
      label = "TIER ↑";
      sub = "WEAPON";
      break;
    case "shieldUp":
      value = 1 + (rng() < 0.3 ? 1 : 0);
      label = `+${value}`;
      sub = "SHIELD";
      break;
    case "risk":
      value = 0;
      label = "?";
      sub = "RISK";
      break;
  }
  return { kind, value, label, sub };
}

/** Apply one op to a plain legion-like state {count, fireRate, tier, shields}. */
export function applyGateOp(state, op) {
  switch (op.kind) {
    case "countAdd":
      state.count += op.value;
      break;
    case "countMul":
      state.count = Math.round(state.count * op.value);
      break;
    // Gates never wipe a run on their own — only enemy walls can. A bad pick
    // still hurts badly, but death always has a readable cause on screen.
    case "countSub":
      state.count = Math.max(1, state.count - op.value);
      break;
    case "countDiv":
      state.count = Math.max(1, Math.floor(state.count / op.value));
      break;
    case "rateUp":
      state.fireRate *= op.value;
      break;
    case "rateDown":
      state.fireRate = Math.max(MIN_FIRE_RATE, state.fireRate * op.value);
      break;
    case "tierUp":
      state.tier = Math.min(MAX_TIER, state.tier + 1);
      break;
    case "shieldUp":
      state.shields = Math.min(5, state.shields + op.value);
      break;
    case "risk":
      // resolved by the caller (needs a live roll); worst case handled below
      break;
  }
}

/** The pessimistic version of a risk gate, used only for HP sizing. */
export const RISK_WORST = { kind: "countDiv", value: 3, label: "÷3", sub: "TROOPS" };
/** Roll what a risk gate actually does when the player drives through it. */
export function rollRisk(rng) {
  const r = rng();
  if (r < 0.45) return { kind: "countMul", value: 3, label: "×3", sub: "JACKPOT" };
  if (r < 0.65) return { kind: "tierUp", value: 1, label: "TIER ↑", sub: "WEAPON" };
  if (r < 0.8) return { kind: "shieldUp", value: 2, label: "+2", sub: "SHIELD" };
  return { kind: "countDiv", value: 2, label: "÷2", sub: "BUST" };
}

function dpsOf(state) {
  return state.count * state.fireRate * BASE_DAMAGE * Math.pow(TIER_STEP, state.tier - 1);
}

// Walls are sized against a reference legion updated per dimension: a gate
// changes exactly one of {count, fireRate, tier}, so for each dimension we
// take the worse of the two sides and nudge it 45% toward the better one.
// Sizing purely off the worst case would make walls melt for anyone reading
// the gates; this blend means good reads shred walls, sloppy reads cost
// troops, and nothing is ever unwinnable RNG.
const REF_BLEND = 0.45;

function blendGateUpdate(ref, left, right) {
  const l = left.kind === "risk" ? RISK_WORST : left;
  const r = right.kind === "risk" ? RISK_WORST : right;
  for (const dim of ["count", "fireRate", "tier"]) {
    const a = { ...ref };
    applyGateOp(a, l);
    const b = { ...ref };
    applyGateOp(b, r);
    const lo = Math.min(a[dim], b[dim]);
    const hi = Math.max(a[dim], b[dim]);
    ref[dim] = lo + (hi - lo) * REF_BLEND;
  }
  ref.count = Math.max(1, ref.count);
  ref.tier = Math.max(1, ref.tier);
}

/**
 * Gates always present a readable choice. Most are good-vs-bad (a clear
 * right answer if you're paying attention); some are good-vs-good of
 * different flavours (a real decision); occasionally risk-vs-safe.
 */
function rollGatePair(rng, difficulty) {
  const roll = rng();
  let left, right;
  if (roll < 0.14) {
    left = makeOp("risk", rng, difficulty);
    right = makeOp(GOOD_OPS[Math.floor(rng() * 2)], rng, difficulty);
  } else if (roll < 0.42) {
    const a = GOOD_OPS[Math.floor(rng() * GOOD_OPS.length)];
    let b = GOOD_OPS[Math.floor(rng() * GOOD_OPS.length)];
    let guard = 0;
    while (b === a && guard++ < 8) b = GOOD_OPS[Math.floor(rng() * GOOD_OPS.length)];
    left = makeOp(a, rng, difficulty);
    right = makeOp(b, rng, difficulty);
  } else {
    left = makeOp(GOOD_OPS[Math.floor(rng() * GOOD_OPS.length)], rng, difficulty);
    right = makeOp(BAD_OPS[Math.floor(rng() * BAD_OPS.length)], rng, difficulty);
  }
  if (rng() < 0.5) {
    const t = left;
    left = right;
    right = t;
  }
  return { left, right };
}

// ---- level assembly --------------------------------------------------------

function makeWall(rng, ref, def, z, boss) {
  const window = RANGE / def.speed;
  const cols = boss ? 3 : 1 + Math.floor(rng() * 4);
  const rows = boss ? 4 : 1 + Math.floor(rng() * Math.min(3, 1 + def.difficulty * 2.4));
  const usableWindow = Math.max(window * 0.4, window - cols * SWITCH_TIME);
  const totalHp = dpsOf(ref) * usableWindow * TARGET_FRACTION * (boss ? 1.25 : 1);

  const colX = [];
  const colHp = [];
  const colMax = [];
  for (let c = 0; c < cols; c++) {
    colX.push(cols === 1 ? 0 : ((c / (cols - 1)) * 2 - 1) * COLUMN_HALF_SPAN);
    colHp.push(totalHp / cols);
    colMax.push(totalHp / cols);
  }

  const ev = {
    type: "wall",
    z,
    boss,
    cols,
    rows,
    colX,
    colHp,
    colMax,
    maxHp: totalHp,
    blocks: cols * rows,
    cleared: false,
    resolved: false,
    shots: [],
    shotTimer: boss ? 0.8 : 0,
  };
  return ev;
}

/**
 * Build the full event list for a level def. Returns { ...def, events }
 * where events is a z-ascending array of gate / wall / coins entries.
 */
export function generateLevel(def) {
  const rng = mulberry32(def.seed);
  const events = [];
  const ref = { count: BASE_COUNT, fireRate: BASE_FIRE_RATE, tier: 1, shields: 0 };
  const window = RANGE / def.speed;

  const marginEnd = def.speed * (def.boss ? 6 : 3);
  let cursor = def.speed * 2.2;
  let lastType = null;

  while (cursor < def.length - marginEnd) {
    const r = rng();
    const wantWall = lastType !== "wall" && r < 0.5;
    const wantCoins = !wantWall && lastType !== "coins" && r > 0.86;

    if (wantCoins) {
      const items = [];
      const baseX = (rng() * 2 - 1) * COLUMN_HALF_SPAN;
      const swing = (rng() * 2 - 1) * 1.6;
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        items.push({
          z: cursor + i * 2.4,
          x: clamp(baseX + Math.sin(t * Math.PI) * swing, -PLAYER_X_CLAMP, PLAYER_X_CLAMP),
          taken: false,
        });
      }
      events.push({ type: "coins", z: cursor, items });
      lastType = "coins";
      cursor += def.speed * 1.4;
    } else if (wantWall) {
      events.push(makeWall(rng, ref, def, cursor, false));
      lastType = "wall";
      cursor += Math.max(def.speed * window + def.speed * 0.6, def.speed * (2.0 + rng() * 1.0));
    } else {
      const { left, right } = rollGatePair(rng, def.difficulty);
      blendGateUpdate(ref, left, right);
      events.push({ type: "gate", z: cursor, left, right, applied: false, chosen: null });
      lastType = "gate";
      cursor += def.speed * (1.4 + rng() * 0.9);
    }
  }

  if (def.boss) {
    events.push(makeWall(rng, ref, def, def.length - def.speed * 2.2, true));
  }

  return { ...def, events };
}

// ---- perks -----------------------------------------------------------------

export const PERKS = [
  { id: "volley", icon: "⚡", name: "Rapid Volley", desc: "+30% fire rate, permanently." },
  { id: "recruit", icon: "➕", name: "Reinforcements", desc: "+25% troops at the start of every level." },
  { id: "plating", icon: "✦", name: "Ablative Plating", desc: "Begin each level with 2 shields." },
  { id: "piercing", icon: "◆", name: "Piercing Rounds", desc: "+25% damage per shot." },
  { id: "scavenge", icon: "●", name: "Scavengers", desc: "Coins are worth triple score." },
  { id: "momentum", icon: "➤", name: "Momentum", desc: "Each wall shattered recruits +8% troops." },
  { id: "vanguard", icon: "⚑", name: "Vanguard", desc: "Deal double damage to boss walls." },
  { id: "salvage", icon: "⚙", name: "Salvage Crew", desc: "Losses cost 35% fewer troops." },
];

/** Three distinct perk choices for the level just cleared (deterministic). */
export function rollPerks(levelIndex, owned) {
  const rng = mulberry32(7331 + levelIndex * 613);
  const pool = PERKS.filter((p) => !owned.includes(p.id));
  const src = pool.length >= 3 ? pool : PERKS.slice();
  const picked = [];
  const used = new Set();
  let guard = 0;
  while (picked.length < 3 && guard++ < 60) {
    const i = Math.floor(rng() * src.length);
    if (used.has(i)) continue;
    used.add(i);
    picked.push(src[i]);
  }
  return picked;
}

export function bestScoreKey() {
  return "game-tastic:formula-legion:best";
}
