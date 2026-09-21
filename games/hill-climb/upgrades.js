// upgrades.js — the coin sink. Five parts, six levels each, priced so the
// first level of everything is affordable inside a couple of decent runs and
// the top levels are a long-term goal.
//
// Each part exposes `apply(tune, level)` so the physics only ever sees one
// flat tuning object — vehicle.js never needs to know the shop exists.

export const PARTS = [
  {
    id: "engine",
    name: "Engine",
    icon: "⚙️",
    blurb: "Wheel torque. More climb, more wheelspin.",
    costs: [140, 320, 700, 1400, 2600],
    value: (l) => 1 + l * 0.26,
    label: (l) => `${Math.round((1 + l * 0.26) * 100)}% torque`,
  },
  {
    id: "suspension",
    name: "Suspension",
    icon: "🪛",
    blurb: "Softer springs, more travel, fewer landings on your roof.",
    costs: [120, 280, 620, 1250, 2300],
    value: (l) => 1 + l * 0.22,
    label: (l) => `${Math.round((1 + l * 0.22) * 100)}% travel`,
  },
  {
    id: "tires",
    name: "Tires",
    icon: "🛞",
    blurb: "Grip. The difference between climbing and spinning.",
    costs: [150, 340, 720, 1450, 2700],
    value: (l) => 1 + l * 0.2,
    label: (l) => `${Math.round((1 + l * 0.2) * 100)}% grip`,
  },
  {
    id: "fuel",
    name: "Fuel Tank",
    icon: "⛽",
    blurb: "A bigger tank and a lighter right foot.",
    costs: [110, 260, 560, 1150, 2100],
    value: (l) => 1 + l * 0.18,
    label: (l) => `${Math.round((1 + l * 0.18) * 100)}% range`,
  },
  {
    id: "awd",
    name: "4WD",
    icon: "🧲",
    blurb: "Send torque to the front wheel too.",
    costs: [260, 520, 980, 1800, 3200],
    value: (l) => l * 0.18,
    label: (l) => (l === 0 ? "Rear wheel drive" : `${Math.round(l * 18)}% to the front`),
  },
];

export const MAX_LEVEL = 5;

export const partById = (id) => PARTS.find((p) => p.id === id);

/** Cost of the next level, or null when the part is maxed. */
export function nextCost(part, level) {
  return level >= MAX_LEVEL ? null : part.costs[level];
}

/** Flatten a {partId: level} map into the tuning the physics reads. */
export function tuningFrom(levels) {
  const lvl = (id) => Math.max(0, Math.min(MAX_LEVEL, levels[id] | 0));
  return {
    engine: partById("engine").value(lvl("engine")),
    suspension: partById("suspension").value(lvl("suspension")),
    tires: partById("tires").value(lvl("tires")),
    fuel: partById("fuel").value(lvl("fuel")),
    awd: partById("awd").value(lvl("awd")),
  };
}

export const emptyLevels = () => ({ engine: 0, suspension: 0, tires: 0, fuel: 0, awd: 0 });
