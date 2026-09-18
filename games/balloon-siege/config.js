// Static game data: world size, maps, bloon types, tower definitions and the
// round table. Nothing in here mutates at runtime — the simulation copies what
// it needs, so this module stays safe to import from tools and tests.

export const WORLD = { w: 720, h: 1180 };

/** Global clock multiplier. Every timer in the simulation is driven by the same
 * dt, so scaling it here changes pace without touching balance: a round that
 * took 75 seconds of watching bloons walk now takes about 40. */
export const GAME_SPEED = 1.8;

/** Half-width of the walkable track. Towers may not overlap it. */
export const PATH_RADIUS = 27;

// ---------------------------------------------------------------- maps -----
// Waypoints start and end off-screen so bloons visibly enter and leave.
// `speedMul` normalises how long a bloon spends on the track. Without it the
// short maps are literally unbeatable at round 40 — there is not enough
// engagement time for any build to chew through a ZOMG. Difficulty on the
// short maps comes from cramped building space instead of raw travel time.
export const MAPS = [
  {
    id: "serpentine",
    speedMul: 1.35,
    name: "Serpentine",
    difficulty: "Relaxed",
    blurb: "A long, lazy switchback. Plenty of time to shoot.",
    grass: "#1d3323",
    grass2: "#16281c",
    track: "#5b4a33",
    points: [
      [-50, 120], [600, 120], [670, 200], [670, 300], [600, 380],
      [80, 380], [30, 460], [30, 560], [100, 640], [620, 640],
      [680, 720], [680, 820], [610, 900], [90, 900], [40, 980],
      [40, 1080], [120, 1160], [400, 1160], [400, 1260],
    ],
  },
  {
    id: "meadow",
    speedMul: 0.82,
    name: "Meadow Run",
    difficulty: "Tricky",
    blurb: "A short open S-curve. Bloons reach the exit fast.",
    grass: "#1b3030",
    grass2: "#142626",
    track: "#55483a",
    points: [
      [-50, 200], [250, 200], [330, 290], [330, 520], [130, 610],
      [130, 830], [330, 920], [600, 920], [670, 1010], [670, 1240],
    ],
  },
  {
    id: "canyon",
    speedMul: 1.12,
    name: "Canyon Zigzag",
    difficulty: "Standard",
    blurb: "Hard corners, but a long way round for the bloons.",
    grass: "#332420",
    grass2: "#271b18",
    track: "#6b5340",
    points: [
      [360, -50], [360, 160], [90, 250], [90, 420], [630, 470],
      [630, 650], [110, 700], [110, 880], [560, 930], [560, 1100],
      [330, 1240],
    ],
  },
  {
    id: "shortcut",
    speedMul: 0.76,
    name: "The Shortcut",
    difficulty: "Brutal",
    blurb: "Barely any track. Every shot has to count.",
    grass: "#2a2036",
    grass2: "#1f182a",
    track: "#5a4b6b",
    points: [
      [360, -50], [360, 440], [165, 560], [165, 800], [545, 915],
      [360, 1015], [360, 1260],
    ],
  },
];

export const DIFFICULTIES = [
  { id: "easy", name: "Easy", lives: 150, cash: 850, reward: 1.15 },
  { id: "normal", name: "Normal", lives: 100, cash: 650, reward: 1 },
  { id: "hard", name: "Hard", lives: 60, cash: 500, reward: 0.85 },
];

// -------------------------------------------------------------- bloons -----
// `children` are spawned where the parent died, so popping a big bloon is a
// setback as much as a reward. `immune` lists damage types that bounce off
// unless the projectile carries the matching override flag (see canDamage).
export const BLOONS = {
  red: { hp: 1, speed: 44, r: 11, color: "#e2444a", children: [] },
  blue: { hp: 1, speed: 62, r: 12, color: "#4aa3e8", children: ["red"] },
  green: { hp: 1, speed: 80, r: 13, color: "#3fc26a", children: ["blue"] },
  yellow: { hp: 1, speed: 114, r: 14, color: "#f2d040", children: ["green"] },
  pink: { hp: 1, speed: 136, r: 15, color: "#ff7fc4", children: ["yellow"] },
  black: { hp: 1, speed: 80, r: 12, color: "#2b2e38", children: ["pink", "pink"], immune: ["explosive"] },
  white: { hp: 1, speed: 88, r: 12, color: "#e8eef7", children: ["pink", "pink"], immune: ["cold"] },
  lead: { hp: 1, speed: 44, r: 14, color: "#8d93a3", children: ["black", "black"], immune: ["sharp"] },
  rainbow: { hp: 1, speed: 100, r: 16, color: "#ff9d3d", rainbow: true, children: ["black", "white"] },
  ceramic: { hp: 10, speed: 110, r: 18, color: "#c8763c", cashBonus: 3, children: ["rainbow", "rainbow"] },
  moab: { hp: 200, speed: 44, r: 30, color: "#2f6fd0", moab: true, slowResist: 0.4, cashBonus: 45, children: ["ceramic", "ceramic", "ceramic", "ceramic"] },
  bfb: { hp: 700, speed: 28, r: 42, color: "#c0392b", moab: true, slowResist: 0.25, cashBonus: 140, children: ["moab", "moab", "moab"] },
  zomg: { hp: 3200, speed: 22, r: 56, color: "#4c9c3a", moab: true, slowResist: 0.12, cashBonus: 450, children: ["bfb", "bfb", "bfb"] },
};

/** Total pops a bloon is worth including everything inside it — used for the
 * round preview so the player can see what is actually coming. */
export function totalPops(type, seen = new Map()) {
  if (seen.has(type)) return seen.get(type);
  const def = BLOONS[type];
  let n = def.hp;
  for (const c of def.children) n += totalPops(c, seen);
  seen.set(type, n);
  return n;
}

/** Can this projectile hurt this bloon? Immunities are absolute unless the
 * projectile carries the specific override (e.g. sharp shots that pop lead). */
export function canDamage(bloon, proj) {
  const def = BLOONS[bloon.type];
  if (!def.immune) return true;
  if (!def.immune.includes(proj.dmgType)) return true;
  if (proj.dmgType === "sharp" && proj.popsLead) return true;
  if (proj.dmgType === "explosive" && proj.popsBlack) return true;
  if (proj.dmgType === "cold" && proj.popsWhite) return true;
  return false;
}
