// stages.js — stage definitions: terrain shape, physics flavour and palette.
//
// Everything here is data plus a couple of pure helpers. A stage is described
// by the parameters its terrain generator consumes (hill amplitude, hill
// wavelength, roughness), the physics it bends (gravity, grip, air drag) and a
// theme the renderer paints from. Stages unlock on lifetime distance so a new
// player always has the next one in sight.

export const STORE_PREFIX = "hillclimb:";
export const storeKey = (name) => STORE_PREFIX + name;

export const STAGES = [
  {
    id: "countryside",
    name: "Countryside",
    blurb: "Rolling green hills. Gentle enough to learn the throttle on.",
    unlockAt: 0,
    gravity: 20,
    grip: 1,
    drag: 0.06,
    terrain: { amp: 2.3, wave: 26, rough: 0.55, bumps: 0.5, ramp: 0.35 },
    theme: {
      sky0: "#7fd2ff",
      sky1: "#cdeeff",
      sun: "#fff3c4",
      ridgeFar: "#8fc2a8",
      ridgeNear: "#5d9c78",
      crust: "#6ed07f",
      soil: "#4a3a28",
      soilDark: "#33281c",
      accent: "#3ddc84",
      cloud: "rgba(255,255,255,0.85)",
      deco: "tree",
    },
  },
  {
    id: "desert",
    name: "Desert",
    blurb: "Long dunes and loose sand. Momentum is everything out here.",
    unlockAt: 600,
    gravity: 20,
    grip: 0.82,
    drag: 0.055,
    terrain: { amp: 3.4, wave: 34, rough: 0.75, bumps: 0.35, ramp: 0.5 },
    theme: {
      sky0: "#ffb774",
      sky1: "#ffe7bd",
      sun: "#fff0b8",
      ridgeFar: "#e3b184",
      ridgeNear: "#d0925f",
      crust: "#f0c987",
      soil: "#a9744a",
      soilDark: "#7c5334",
      accent: "#ffb020",
      cloud: "rgba(255,240,215,0.6)",
      deco: "cactus",
    },
  },
  {
    id: "arctic",
    name: "Arctic",
    blurb: "Ice with almost no grip. Feather the gas or spin the wheels.",
    unlockAt: 1600,
    gravity: 20,
    grip: 0.55,
    drag: 0.05,
    terrain: { amp: 3, wave: 24, rough: 0.9, bumps: 0.7, ramp: 0.45 },
    theme: {
      sky0: "#3f6f9e",
      sky1: "#bfe2f5",
      sun: "#eaf6ff",
      ridgeFar: "#9fc3dc",
      ridgeNear: "#7aa4c4",
      crust: "#eaf6ff",
      soil: "#8aa6bb",
      soilDark: "#5f7c96",
      accent: "#67e8f9",
      cloud: "rgba(255,255,255,0.7)",
      deco: "pine",
    },
  },
  {
    id: "highway",
    name: "Highway",
    blurb: "Smooth tarmac, big grip, bigger speed. Mind the crests.",
    unlockAt: 3200,
    gravity: 20,
    grip: 1.15,
    drag: 0.045,
    terrain: { amp: 2.6, wave: 40, rough: 0.3, bumps: 0.2, ramp: 0.7 },
    theme: {
      sky0: "#2a3552",
      sky1: "#8ea2d0",
      sun: "#ffd9a0",
      ridgeFar: "#48557a",
      ridgeNear: "#333d5c",
      crust: "#3a3f4b",
      soil: "#2b2f38",
      soilDark: "#1d2027",
      accent: "#ff5d8f",
      cloud: "rgba(200,215,255,0.5)",
      deco: "pylon",
    },
  },
  {
    id: "moon",
    name: "Moon",
    blurb: "One-sixth gravity, dusty craters. Every jump is a long one.",
    unlockAt: 5200,
    gravity: 6.2,
    grip: 0.7,
    drag: 0.012,
    terrain: { amp: 4.2, wave: 30, rough: 0.8, bumps: 0.6, ramp: 0.6 },
    theme: {
      sky0: "#05060f",
      sky1: "#161a33",
      sun: "#dfe7ff",
      ridgeFar: "#2d3350",
      ridgeNear: "#454b6b",
      crust: "#b9bed0",
      soil: "#6c7186",
      soilDark: "#4a4f62",
      accent: "#a06bff",
      cloud: "rgba(160,170,220,0.18)",
      deco: "rock",
    },
  },
];

export const getStage = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

/** Unlocked stages, given the player's best lifetime distance in metres. */
export function isUnlocked(stage, lifetimeBest) {
  return lifetimeBest >= stage.unlockAt;
}
