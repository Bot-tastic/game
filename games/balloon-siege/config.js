// Static game data: world size, maps, bloon types and the difficulty table.
// Nothing in here mutates at runtime — the simulation copies what it needs, so
// this module stays safe to import from tools and tests.

// Landscape. A tower defense is read left-to-right along the track, and a tall
// world letterboxed into a wide screen left the board postage-stamp sized on
// anything that was not a phone held upright.
export const WORLD = { w: 1280, h: 720 };

/** Global clock multiplier. Every timer in the simulation is driven by the same
 * dt, so scaling it here changes pace without touching balance. */
export const GAME_SPEED = 1.9;

/** Half-width of the walkable track. Towers may not overlap it. */
export const PATH_RADIUS = 26;

// ---------------------------------------------------------------- maps -----
// Waypoints start and end off-screen so bloons visibly enter and leave.
// `speedMul` scales how fast bloons walk, which sets two different things at
// once: total time on the track (length / speedMul) and how long any single
// tower gets to shoot at a passing bloon (1 / speedMul). Both have to move the
// same way or the labels lie — an early version gave the long "Relaxed" map
// fast bloons, and it measured as the hardest map in the game because a thin
// defence never got enough time per pass however long the track was.
export const MAPS = [
  {
    id: "serpentine",
    speedMul: 0.9,
    name: "Serpentine",
    difficulty: "Relaxed",
    blurb: "Four long lanes of switchback. Plenty of time to shoot.",
    grass: "#1d3323",
    grass2: "#16281c",
    track: "#5b4a33",
    points: [
      [-60, 88], [1085, 88], [1195, 178], [1195, 222], [1090, 300],
      [150, 300], [58, 382], [58, 424], [152, 498], [1090, 498],
      [1196, 578], [1196, 622], [1090, 694], [420, 694], [420, 800],
    ],
  },
  {
    id: "canyon",
    speedMul: 1.0,
    name: "Canyon Zigzag",
    difficulty: "Standard",
    blurb: "Hard corners and long diagonals. Crossfire heaven.",
    grass: "#332420",
    grass2: "#271b18",
    track: "#6b5340",
    points: [
      [-60, 150], [300, 150], [430, 268], [1000, 210], [1120, 330],
      [980, 452], [320, 400], [180, 520], [300, 648], [900, 648],
      [1050, 560], [1340, 560],
    ],
  },
  {
    id: "meadow",
    speedMul: 0.95,
    name: "Meadow Run",
    difficulty: "Tricky",
    blurb: "A short open S-curve. Bloons reach the exit fast.",
    grass: "#1b3030",
    grass2: "#142626",
    track: "#55483a",
    points: [
      [-60, 176], [330, 176], [438, 288], [438, 448], [648, 548],
      [1000, 548], [1092, 444], [1092, 246], [1340, 246],
    ],
  },
  {
    id: "shortcut",
    speedMul: 1.0,
    name: "The Shortcut",
    difficulty: "Brutal",
    blurb: "Barely any track. Every single shot has to count.",
    grass: "#2a2036",
    grass2: "#1f182a",
    track: "#5a4b6b",
    points: [
      [-60, 292], [360, 292], [478, 420], [700, 420], [818, 276],
      [1058, 276], [1160, 400], [1340, 400],
    ],
  },
];

export const DIFFICULTIES = [
  { id: "easy", name: "Easy", lives: 150, cash: 900, reward: 1.15 },
  { id: "normal", name: "Normal", lives: 100, cash: 700, reward: 1 },
  { id: "hard", name: "Hard", lives: 60, cash: 550, reward: 0.85 },
];

// -------------------------------------------------------------- bloons -----
// `children` are spawned where the parent died, so popping a big bloon is a
// setback as much as a reward. `immune` lists damage types that bounce off
// unless the projectile carries the matching override flag (see canDamage).
export const BLOONS = {
  red: { hp: 1, speed: 46, r: 11, color: "#e2444a", children: [] },
  blue: { hp: 1, speed: 64, r: 12, color: "#4aa3e8", children: ["red"] },
  green: { hp: 1, speed: 82, r: 13, color: "#3fc26a", children: ["blue"] },
  yellow: { hp: 1, speed: 116, r: 14, color: "#f2d040", children: ["green"] },
  pink: { hp: 1, speed: 138, r: 15, color: "#ff7fc4", children: ["yellow"] },
  black: { hp: 1, speed: 82, r: 12, color: "#2b2e38", children: ["pink", "pink"], immune: ["explosive"] },
  white: { hp: 1, speed: 90, r: 12, color: "#e8eef7", children: ["pink", "pink"], immune: ["cold"] },
  lead: { hp: 1, speed: 46, r: 14, color: "#8d93a3", children: ["black", "black"], immune: ["sharp"] },
  rainbow: { hp: 1, speed: 102, r: 16, color: "#ff9d3d", rainbow: true, children: ["black", "white"] },
  ceramic: { hp: 14, speed: 112, r: 18, color: "#c8763c", cashBonus: 3, children: ["rainbow", "rainbow"] },
  moab: { hp: 320, speed: 46, r: 30, color: "#2f6fd0", moab: true, slowResist: 0.4, cashBonus: 45, children: ["ceramic", "ceramic", "ceramic", "ceramic"] },
  bfb: { hp: 1050, speed: 28, r: 42, color: "#c0392b", moab: true, slowResist: 0.25, cashBonus: 140, children: ["moab", "moab", "moab"] },
  zomg: { hp: 4000, speed: 22, r: 56, color: "#4c9c3a", moab: true, slowResist: 0.12, cashBonus: 450, children: ["bfb", "bfb", "bfb"] },
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
 * projectile carries the specific override (e.g. sharp shots that pop lead).
 * Activated abilities use dmgType "ability", which nothing is immune to — the
 * whole point of spending a 40-second cooldown is that it always lands. */
export function canDamage(bloon, proj) {
  const def = BLOONS[bloon.type];
  if (!def.immune) return true;
  if (!def.immune.includes(proj.dmgType)) return true;
  if (proj.dmgType === "sharp" && proj.popsLead) return true;
  if (proj.dmgType === "explosive" && proj.popsBlack) return true;
  if (proj.dmgType === "cold" && proj.popsWhite) return true;
  return false;
}
