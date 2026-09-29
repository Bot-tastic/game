// upgrades.js — the coin sink. Five parts, eight levels each, bought per
// vehicle: upgrading the buggy does nothing for the jeep. A car's price scales
// its upgrade prices (vehicles.js `costScale`), so a maxed buggy is a long
// grind and a maxed rocket is the end game.
//
// `tuningFrom(spec, levels)` folds a car's stock numbers and its upgrades into
// one flat tuning object — vehicle.js reads that and never needs to know the
// shop exists.

export const MAX_LEVEL = 8;

// Price of level 1..8 on the buggy; other cars multiply by their costScale.
const BASE_COSTS = [150, 320, 600, 1000, 1600, 2400, 3500, 5000];

export const PARTS = [
  {
    id: "engine",
    name: "Engine",
    icon: "⚙️",
    blurb: "Wheel torque. More climb, more speed, more wheelspin.",
    price: 1.1,
    value: (l) => 1 + l * 0.1,
    label: (l) => `${Math.round((1 + l * 0.1) * 100)}% torque`,
  },
  {
    id: "suspension",
    name: "Suspension",
    icon: "🪛",
    blurb: "Softer springs, more travel, fewer landings on your roof.",
    price: 0.8,
    value: (l) => 1 + l * 0.06,
    label: (l) => `${Math.round((1 + l * 0.06) * 100)}% travel`,
  },
  {
    id: "tires",
    name: "Tires",
    icon: "🛞",
    blurb: "Grip. The difference between climbing and spinning.",
    price: 1,
    value: (l) => 1 + l * 0.05,
    label: (l) => `${Math.round((1 + l * 0.05) * 100)}% grip`,
  },
  {
    id: "fuel",
    name: "Fuel Tank",
    icon: "⛽",
    blurb: "A bigger tank and a lighter right foot.",
    price: 0.9,
    value: (l) => 1 + l * 0.12,
    label: (l) => `${Math.round((1 + l * 0.12) * 100)}% range`,
  },
  {
    id: "awd",
    name: "4WD",
    icon: "🧲",
    blurb: "Send more torque to the front wheel.",
    price: 1.2,
    value: (l) => l * 0.05,
    label: (l) => `+${Math.round(l * 5)}% to the front`,
  },
];

export const partById = (id) => PARTS.find((p) => p.id === id);

/** Cost of the next level of `part` on `spec`, or null when it is maxed. */
export function nextCost(part, level, spec) {
  if (level >= MAX_LEVEL) return null;
  return Math.round((BASE_COSTS[level] * part.price * (spec ? spec.costScale : 1)) / 10) * 10;
}

/** Coins it takes to bring every part of `spec` to `level`. */
export function costToLevel(spec, level) {
  let n = 0;
  for (const p of PARTS) for (let l = 0; l < level; l++) n += nextCost(p, l, spec);
  return n;
}

/** Flatten a car and its {partId: level} map into the tuning the physics reads. */
export function tuningFrom(spec, levels) {
  const lvl = (id) => Math.max(0, Math.min(MAX_LEVEL, levels[id] | 0));
  return {
    power: spec.power * partById("engine").value(lvl("engine")),
    suspension: spec.susp * partById("suspension").value(lvl("suspension")),
    tires: spec.grip * partById("tires").value(lvl("tires")),
    fuel: spec.fuel * partById("fuel").value(lvl("fuel")),
    awd: Math.min(0.95, spec.awd + partById("awd").value(lvl("awd"))),
  };
}

export const emptyLevels = () => ({ engine: 0, suspension: 0, tires: 0, fuel: 0, awd: 0 });
export const uniformLevels = (l) => ({ engine: l, suspension: l, tires: l, fuel: l, awd: l });
