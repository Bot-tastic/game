// Tower definitions and the stat resolver.
//
// Every tower has two upgrade paths of three tiers. The crossover rule keeps
// choices meaningful: once one path is past tier 1, the other is capped at
// tier 1, so no tower ever becomes strictly better than every other tower.

export const CROSSOVER_TIER = 1;

/** Upgrade mods are merged onto the base stats. Numeric keys add, `*Mul` keys
 * multiply, booleans latch on, and strings overwrite. */
export const TOWERS = [
  {
    id: "dart",
    name: "Dart Monkey",
    icon: "🎯",
    cost: 200,
    blurb: "Cheap, reliable, throws a single dart.",
    base: { range: 118, rate: 1.05, damage: 1, pierce: 2, dmgType: "sharp", projSpeed: 430, count: 1 },
    paths: [
      {
        name: "Sharpshooter",
        tiers: [
          { name: "Razor Darts", cost: 120, desc: "Darts pass through one extra bloon.", mods: { pierce: 1 } },
          { name: "Spiked Tips", cost: 340, desc: "+1 damage and darts pop lead.", mods: { damage: 1, popsLead: true } },
          { name: "Triple Shot", cost: 820, desc: "Throws three darts in a spread.", mods: { count: 2, spread: 0.32, pierce: 1 } },
        ],
      },
      {
        name: "Scout",
        tiers: [
          { name: "Long Range", cost: 110, desc: "+25% range.", mods: { rangeMul: 1.25 } },
          { name: "Eagle Eye", cost: 280, desc: "Sees camo bloons. +15% range.", mods: { camo: true, rangeMul: 1.15 } },
          { name: "Quick Hands", cost: 660, desc: "Throws 80% faster.", mods: { rateMul: 1.8 } },
        ],
      },
    ],
  },
  {
    id: "tack",
    name: "Tack Shooter",
    icon: "✳️",
    cost: 280,
    blurb: "Sprays tacks in every direction. Brutal on corners.",
    base: { range: 82, rate: 0.85, damage: 1, pierce: 1, dmgType: "sharp", projSpeed: 300, count: 8, radial: true, projLife: 0.34 },
    paths: [
      {
        name: "Storm",
        tiers: [
          { name: "Faster Shooting", cost: 190, desc: "Fires 40% faster.", mods: { rateMul: 1.4 } },
          { name: "More Tacks", cost: 360, desc: "12 tacks per volley.", mods: { count: 4 } },
          { name: "Blade Storm", cost: 940, desc: "16 blades, +1 damage, longer reach.", mods: { count: 4, damage: 1, pierce: 1, projLife: 0.16 } },
        ],
      },
      {
        name: "Inferno",
        tiers: [
          { name: "Long Reach", cost: 160, desc: "+30% range.", mods: { rangeMul: 1.3 } },
          { name: "Hot Tacks", cost: 400, desc: "Flaming tacks pop lead bloons.", mods: { popsLead: true, damage: 1, tint: "#ff8a3d" } },
          { name: "Ring of Fire", cost: 1150, desc: "+2 damage, +2 pierce, burns everything near.", mods: { damage: 2, pierce: 2, rangeMul: 1.15, tint: "#ff5c1a" } },
        ],
      },
    ],
  },
  {
    id: "bomb",
    name: "Bomb Shooter",
    icon: "💣",
    cost: 550,
    blurb: "Lobs explosives. Black bloons shrug them off.",
    base: { range: 132, rate: 0.7, damage: 2, pierce: 8, dmgType: "explosive", projSpeed: 320, count: 1, blast: 48 },
    paths: [
      {
        name: "Ordnance",
        tiers: [
          { name: "Bigger Bombs", cost: 370, desc: "Larger blast, +2 pierce.", mods: { blast: 18, pierce: 2 } },
          { name: "Heavy Shells", cost: 740, desc: "+2 damage.", mods: { damage: 2 } },
          { name: "Cluster Bombs", cost: 1700, desc: "Each bomb throws three more. 1.6x vs blimps.", mods: { cluster: 3, damage: 1, moabBonus: 1.6 } },
        ],
      },
      {
        name: "Artillery",
        tiers: [
          { name: "Faster Reload", cost: 320, desc: "Fires 45% faster.", mods: { rateMul: 1.45 } },
          { name: "Frag Shrapnel", cost: 680, desc: "Shrapnel lets bombs hurt black bloons.", mods: { popsBlack: true, pierce: 3 } },
          { name: "Missile Barrage", cost: 1550, desc: "Homing missiles, 60% faster, 2x vs blimps.", mods: { rateMul: 1.6, damage: 1, homing: true, projSpeed: 140, moabBonus: 2 } },
        ],
      },
    ],
  },
  {
    id: "ice",
    name: "Ice Tower",
    icon: "❄️",
    cost: 400,
    blurb: "Chills everything in range. White bloons are immune.",
    base: { range: 88, rate: 0.55, damage: 1, pierce: 40, dmgType: "cold", pulse: true, slow: 0.45, slowDur: 2.2 },
    paths: [
      {
        name: "Permafrost",
        tiers: [
          { name: "Deeper Chill", cost: 230, desc: "Stronger, longer slow.", mods: { slow: 0.15, slowDur: 0.8 } },
          { name: "Cold Snap", cost: 540, desc: "+1 damage per pulse.", mods: { damage: 1 } },
          { name: "Absolute Zero", cost: 1450, desc: "Freezes bloons solid for a moment. +2 damage.", mods: { damage: 2, freeze: 1.1, rangeMul: 1.25 } },
        ],
      },
      {
        name: "Arctic",
        tiers: [
          { name: "Enhanced Freeze", cost: 210, desc: "+30% range.", mods: { rangeMul: 1.3 } },
          { name: "Arctic Wind", cost: 620, desc: "Constant aura slows everything nearby.", mods: { aura: 0.3, rangeMul: 1.1 } },
          { name: "Snowstorm", cost: 1350, desc: "Pulses twice as often and sees camo.", mods: { rateMul: 2, camo: true } },
        ],
      },
    ],
  },
  {
    id: "sniper",
    name: "Sniper",
    icon: "🔭",
    cost: 350,
    blurb: "Hits anywhere on the map. Picks the strongest target.",
    base: { range: 4000, rate: 0.45, damage: 5, pierce: 1, dmgType: "sharp", hitscan: true, defaultTarget: "strong" },
    paths: [
      {
        name: "Calibre",
        tiers: [
          { name: "Full Metal Jacket", cost: 420, desc: "+5 damage, punches through lead.", mods: { damage: 5, popsLead: true } },
          { name: "Large Calibre", cost: 950, desc: "+10 damage.", mods: { damage: 10 } },
          { name: "Cripple MOAB", cost: 2300, desc: "+30 damage, 2.5x vs blimps, slows them badly.", mods: { damage: 30, moabSlow: 0.6, moabBonus: 2.5 } },
        ],
      },
      {
        name: "Marksman",
        tiers: [
          { name: "Night Vision", cost: 260, desc: "Sees camo bloons.", mods: { camo: true } },
          { name: "Fast Cycle", cost: 470, desc: "Fires 60% faster.", mods: { rateMul: 1.6 } },
          { name: "Semi-Automatic", cost: 1400, desc: "Fires 2.4x faster, shots hit 2 bloons.", mods: { rateMul: 2.4, pierce: 1 } },
        ],
      },
    ],
  },
  {
    id: "wizard",
    name: "Wizard",
    icon: "🪄",
    cost: 700,
    blurb: "Magic bolts. Lead is no problem for them.",
    base: { range: 128, rate: 0.9, damage: 2, pierce: 4, dmgType: "magic", projSpeed: 380, count: 1 },
    paths: [
      {
        name: "Pyromancy",
        tiers: [
          { name: "Guided Magic", cost: 320, desc: "Bolts seek their target.", mods: { homing: true, projSpeed: 90 } },
          { name: "Fireball", cost: 760, desc: "Every third bolt explodes.", mods: { fireball: 3, damage: 1 } },
          { name: "Dragon's Breath", cost: 1850, desc: "+3 damage, +4 pierce, 1.5x vs blimps.", mods: { damage: 3, pierce: 4, blast: 34, moabBonus: 1.5, tint: "#ff6a2a" } },
        ],
      },
      {
        name: "Arcana",
        tiers: [
          { name: "Arcane Sight", cost: 360, desc: "Sees camo bloons. +15% range.", mods: { camo: true, rangeMul: 1.15 } },
          { name: "Arcane Blast", cost: 820, desc: "+2 damage, +3 pierce.", mods: { damage: 2, pierce: 3 } },
          { name: "Archmage", cost: 2400, desc: "80% faster and +3 damage.", mods: { rateMul: 1.8, damage: 3 } },
        ],
      },
    ],
  },
  {
    id: "super",
    name: "Super Monkey",
    icon: "🦸",
    cost: 3200,
    blurb: "A wall of darts. Costs a fortune, earns it back.",
    base: { range: 152, rate: 9, damage: 1, pierce: 1, dmgType: "sharp", projSpeed: 620, count: 1 },
    paths: [
      {
        name: "Beam",
        tiers: [
          { name: "Laser Blasts", cost: 1900, desc: "+1 damage, pops lead.", mods: { damage: 1, popsLead: true, tint: "#ff4d6d" } },
          { name: "Plasma Blasts", cost: 3400, desc: "+2 damage, +1 pierce, 40% faster.", mods: { damage: 2, pierce: 1, rateMul: 1.4, dmgType: "magic", tint: "#7ad7ff" } },
          { name: "Sun Avatar", cost: 8500, desc: "Three searing beams, +6 damage, 1.5x vs blimps.", mods: { count: 2, spread: 0.24, damage: 6, moabBonus: 1.5, tint: "#ffd166" } },
        ],
      },
      {
        name: "Vision",
        tiers: [
          { name: "Super Range", cost: 1400, desc: "+30% range, sees camo.", mods: { rangeMul: 1.3, camo: true } },
          { name: "Epic Range", cost: 2600, desc: "+30% range, +1 pierce.", mods: { rangeMul: 1.3, pierce: 1 } },
          { name: "Robo Monkey", cost: 6200, desc: "Twin arms fire two shots at once.", mods: { count: 1, spread: 0.5, damage: 1 } },
        ],
      },
    ],
  },
  {
    id: "farm",
    name: "Banana Farm",
    icon: "🍌",
    cost: 1000,
    blurb: "Pops nothing. Pays out at the end of every round.",
    base: { range: 70, income: 150, support: true },
    paths: [
      {
        name: "Yield",
        tiers: [
          { name: "Increased Production", cost: 520, desc: "+120 per round.", mods: { income: 120 } },
          { name: "Greater Production", cost: 1150, desc: "+180 per round.", mods: { income: 180 } },
          { name: "Banana Plantation", cost: 2700, desc: "+340 per round.", mods: { income: 340 } },
        ],
      },
      {
        name: "Market",
        tiers: [
          { name: "Long Life Bananas", cost: 420, desc: "+60 per round and repairs 1 life.", mods: { income: 60, lifeGain: 1 } },
          { name: "Valuable Bananas", cost: 900, desc: "+140 per round.", mods: { income: 140 } },
          { name: "Central Market", cost: 2500, desc: "+260 per round and repairs 2 more lives.", mods: { income: 260, lifeGain: 2 } },
        ],
      },
    ],
  },
];

export const TOWER_BY_ID = Object.fromEntries(TOWERS.map((t) => [t.id, t]));

/** Placement footprint. Kept uniform so the "can I build here?" preview never
 * lies about a tower the player has not selected yet. */
export const TOWER_RADIUS = 20;

function applyMods(stats, mods) {
  for (const [key, value] of Object.entries(mods)) {
    if (key.endsWith("Mul")) {
      const target = key.slice(0, -3);
      stats[target] = (stats[target] ?? 1) * value;
    } else if (typeof value === "number") {
      stats[key] = (stats[key] ?? 0) + value;
    } else {
      stats[key] = value;
    }
  }
}

/** Effective stats for a tower at its current upgrade tiers. */
export function resolveStats(def, tiers) {
  const stats = { ...def.base };
  for (let p = 0; p < def.paths.length; p++) {
    for (let t = 0; t < tiers[p]; t++) applyMods(stats, def.paths[p].tiers[t].mods);
  }
  return stats;
}

/** The crossover rule: a path may only be upgraded past tier 1 while every
 * other path is still at tier 1 or below. Returns null when allowed, or a
 * short reason to show on the locked button. */
export function upgradeBlocked(def, tiers, pathIndex) {
  const next = tiers[pathIndex] + 1;
  if (next > def.paths[pathIndex].tiers.length) return "Maxed";
  if (next > CROSSOVER_TIER) {
    for (let p = 0; p < tiers.length; p++) {
      if (p !== pathIndex && tiers[p] > CROSSOVER_TIER) return "Other path locked in";
    }
  }
  return null;
}

/** What the next upgrade on a path costs, or null when there is none. */
export function nextUpgrade(def, tiers, pathIndex) {
  const tier = tiers[pathIndex];
  if (tier >= def.paths[pathIndex].tiers.length) return null;
  return def.paths[pathIndex].tiers[tier];
}

/** Total cash sunk into a tower, used for the 75% sell price. */
export function investedValue(def, tiers) {
  let total = def.cost;
  for (let p = 0; p < def.paths.length; p++) {
    for (let t = 0; t < tiers[p]; t++) total += def.paths[p].tiers[t].cost;
  }
  return total;
}

export function sellValue(def, tiers) {
  return Math.floor(investedValue(def, tiers) * 0.75);
}
