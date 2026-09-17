// levels.js — world constants, the level-authoring builder, and the ten
// hand-authored levels. Pure data + math: no DOM, so the fairness checker in
// tools/verify-levels.mjs can import it under node.
//
// World units: a resolution-independent space. The playfield band runs from
// CEIL_Y (0) down to GROUND_Y (300); render.js maps it to CSS pixels with a
// single scale factor. TILE (30) is the size of the cube and of every block,
// so everything snaps to a readable grid.

export const TILE = 30;
export const GROUND_Y = 300;
export const CEIL_Y = 0;
export const VIEW_TOP = -150; // world Y at the top of the drawn band
export const VIEW_BOTTOM = 380; // world Y at the bottom of the drawn band
export const VIEW_W = 420; // minimum world units visible horizontally
// 420 units is 14 tiles: with the player parked at 28% of the width that is
// ~1s of lookahead at level-1 speed, which is the reaction window the jump arc
// (0.6s of airtime) actually needs. Narrower than this and levels stop being
// readable; wider and the obstacles shrink to specks on a phone.

export const MODES = ["cube", "ship", "ball", "wave", "ufo"];

export const MODE_LABEL = {
  cube: "CUBE — tap to jump",
  ship: "SHIP — hold to fly up",
  ball: "BALL — tap to flip gravity",
  wave: "WAVE — hold to climb",
  ufo: "UFO — tap to flap",
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

// Every authored level is written as a stream of cursor moves (`go`, in beats)
// and placements (which never move the cursor). Authoring in beats instead of
// world units is what keeps the obstacles landing on the music: one beat of
// runway is always one beat of runway, whatever the level's speed.
function makeBuilder(def) {
  const level = {
    solids: [],
    hazards: [],
    pads: [],
    orbs: [],
    portals: [],
    coins: [],
    pits: [],
    length: 0,
  };

  let x = 0;
  let speed = def.speed;
  let beat = (speed * 60) / def.bpm;

  const b = {
    get x() {
      return x;
    },
    get beat() {
      return beat;
    },
    /** Advance the cursor by `beats` of empty runway. */
    go(beats) {
      x += beats * beat;
      return b;
    },
    /** A row of `n` ground spikes starting at the cursor. */
    spikes(n = 1, opts = {}) {
      const base = opts.y != null ? opts.y : GROUND_Y;
      for (let i = 0; i < n; i++) {
        level.hazards.push({ type: "spike", dir: "up", x: x + i * TILE, y: base, w: TILE, h: TILE });
      }
      return b;
    },
    /** A row of `n` spikes hanging from the ceiling (or from `y`). */
    spikesDown(n = 1, opts = {}) {
      const base = opts.y != null ? opts.y : CEIL_Y;
      for (let i = 0; i < n; i++) {
        level.hazards.push({ type: "spike", dir: "down", x: x + i * TILE, y: base, w: TILE, h: TILE });
      }
      return b;
    },
    /** Solid block resting on the ground: `w` tiles wide, `h` tiles tall. */
    blk(w = 1, h = 1, opts = {}) {
      level.solids.push({
        x,
        y: GROUND_Y - h * TILE,
        w: w * TILE,
        h: h * TILE,
        style: opts.style || "block",
      });
      return b;
    },
    /** Solid block hanging from the ceiling, `h` tiles deep. */
    blkTop(w = 1, h = 1) {
      level.solids.push({ x, y: CEIL_Y, w: w * TILE, h: h * TILE, style: "block" });
      return b;
    },
    /** Thin floating platform, top surface `up` tiles above the ground. */
    plat(w = 2, up = 2, opts = {}) {
      const s = { x, y: GROUND_Y - up * TILE, w: w * TILE, h: 14, style: "plat" };
      if (opts.move) s.move = opts.move;
      level.solids.push(s);
      return b;
    },
    /** Free-floating solid at an absolute world Y. */
    slab(w, yTiles, hTiles, opts = {}) {
      const s = {
        x,
        y: GROUND_Y - yTiles * TILE,
        w: w * TILE,
        h: hTiles * TILE,
        style: opts.style || "block",
      };
      if (opts.move) s.move = opts.move;
      level.solids.push(s);
      return b;
    },
    /** A corridor for flight modes: solid floor `lo` tiles high, ceiling down to `hi`. */
    corridor(beats, lo, hi) {
      const w = beats * beat;
      if (lo > 0) level.solids.push({ x, y: GROUND_Y - lo * TILE, w, h: lo * TILE + 40, style: "wall" });
      const top = CEIL_Y;
      const depth = (GROUND_Y - hi * TILE) - top;
      if (depth > 0) level.solids.push({ x, y: top, w, h: depth, style: "wall" });
      return b;
    },
    /** A gap in the floor, `beats` long. Falling in is fatal. */
    pit(beats) {
      level.pits.push({ x0: x, x1: x + beats * beat });
      return b;
    },
    /** Spinning saw blade. `up` tiles above the ground, radius `r` tiles. */
    saw(up = 1, r = 1, opts = {}) {
      const h = { type: "saw", x, y: GROUND_Y - up * TILE, r: r * TILE };
      if (opts.move) h.move = opts.move;
      level.hazards.push(h);
      return b;
    },
    /** Jump pad on the ground (or on a surface `up` tiles high). */
    pad(kind = "yellow", up = 0) {
      level.pads.push({ x, y: GROUND_Y - up * TILE, kind, dir: 1 });
      return b;
    },
    /** Jump pad on the ceiling, firing downward (for flipped gravity). */
    padTop(kind = "yellow", down = 0) {
      level.pads.push({ x, y: CEIL_Y + down * TILE, kind, dir: -1 });
      return b;
    },
    /** Mid-air orb: tap while overlapping it to fire. */
    orb(kind = "yellow", up = 3) {
      level.orbs.push({ x, y: GROUND_Y - up * TILE, kind });
      return b;
    },
    orbAt(kind, worldY) {
      level.orbs.push({ x, y: worldY, kind });
      return b;
    },
    coin(up = 4) {
      level.coins.push({ x, y: GROUND_Y - up * TILE });
      return b;
    },
    /** Coin arc — three coins tracing a jump, purely decorative reward. */
    coinArc(up = 3) {
      for (let i = -1; i <= 1; i++) {
        level.coins.push({ x: x + i * TILE * 1.6, y: GROUND_Y - (up - Math.abs(i) * 0.8) * TILE });
      }
      return b;
    },
    portal(mode) {
      level.portals.push({ x, kind: "mode", value: mode, y: GROUND_Y - TILE * 2.2 });
      return b;
    },
    portalAt(mode, up) {
      level.portals.push({ x, kind: "mode", value: mode, y: GROUND_Y - up * TILE });
      return b;
    },
    grav(dir, up = 2.2) {
      level.portals.push({ x, kind: "grav", value: dir, y: GROUND_Y - up * TILE });
      return b;
    },
    speedUp(mult, up = 2.2) {
      level.portals.push({ x, kind: "speed", value: mult, y: GROUND_Y - up * TILE });
      speed = def.speed * mult;
      beat = (speed * 60) / def.bpm;
      return b;
    },
    finish() {
      level.length = x;
      return level;
    },
  };

  return b;
}

// ---------------------------------------------------------------------------
// Reusable rhythm patterns
// ---------------------------------------------------------------------------

/** A run of n spike clusters, one per `gap` beats. The bread and butter of cube
 * play — every third hit is a double so the run has a shape instead of being a
 * metronome. A double is 60 units wide against a ~180-unit jump arc, so it stays
 * inside the same single press. */
function spikeBeat(b, n, gap = 2) {
  for (let i = 0; i < n; i++) {
    b.spikes(i % 3 === 2 ? 2 : 1);
    if (i % 4 === 1) b.coin(3.4);
    b.go(gap);
  }
}

/** Stair of blocks up then back down — always landable, never a wall. */
function stairs(b, steps, gap = 1.4) {
  for (let i = 0; i < steps; i++) {
    b.blk(1, i + 1);
    if (i === steps - 1) b.coin(i + 2.6);
    b.go(gap);
  }
  for (let i = steps - 1; i >= 1; i--) {
    b.blk(1, i);
    b.go(gap);
  }
}

/** Pad -> long float -> land. Reads as a "lift" moment in the music. */
function padLaunch(b, coinsUp = 6) {
  b.pad("yellow");
  b.go(0.5);
  b.coinArc(coinsUp);
  b.go(2.2);
}

/** A ship/ufo tunnel that narrows then opens back up. */
function tunnelRun(b, beats, lo, hi) {
  const steps = Math.max(2, Math.round(beats / 2));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const wobble = Math.sin(t * Math.PI);
    b.corridor(2, lo + wobble * 0.8, hi - wobble * 0.6);
    b.go(2);
  }
}

// ---------------------------------------------------------------------------
// The ten levels
// ---------------------------------------------------------------------------

const THEMES = {
  aqua: { sky0: "#03151c", sky1: "#0b3a44", accent: "#4fe3d0", accent2: "#ff5ec4", ground: "#0e5a63", glow: "#7ff5e6" },
  cobalt: { sky0: "#040a1e", sky1: "#132a63", accent: "#5b8cff", accent2: "#ff9de0", ground: "#1b3a86", glow: "#a8c6ff" },
  violet: { sky0: "#0e061d", sky1: "#331257", accent: "#a06bff", accent2: "#57f5d0", ground: "#4a1e80", glow: "#d3a9ff" },
  magenta: { sky0: "#1a0616", sky1: "#5a1244", accent: "#ff5ec4", accent2: "#5ee0ff", ground: "#7d1c5c", glow: "#ffb3e8" },
  amber: { sky0: "#170d04", sky1: "#5a3106", accent: "#ffa12e", accent2: "#5ee0ff", ground: "#8a4b0b", glow: "#ffd28a" },
  ember: { sky0: "#190504", sky1: "#5e1410", accent: "#ff5a48", accent2: "#ffd166", ground: "#8c2018", glow: "#ffa091" },
  gold: { sky0: "#151204", sky1: "#55480a", accent: "#ffd23f", accent2: "#6ee7ff", ground: "#7d6a10", glow: "#fff0a0" },
  neon: { sky0: "#190415", sky1: "#66104f", accent: "#ff2fa0", accent2: "#39e0ff", ground: "#8f1668", glow: "#ff9ad4" },
  lime: { sky0: "#061405", sky1: "#12521c", accent: "#5cf07a", accent2: "#ff8ae0", ground: "#17722a", glow: "#a8ffb8" },
  crimson: { sky0: "#140306", sky1: "#520a14", accent: "#ff2d4d", accent2: "#ffb03a", ground: "#7d0f1e", glow: "#ff8a99" },
};

// -- 1. First Steps ---------------------------------------------------------
function buildL1(b) {
  b.go(6);
  b.coin(2);
  b.go(2);
  spikeBeat(b, 3, 3);
  b.go(1);
  b.coinArc(3);
  b.go(3);
  b.blk(2, 1);
  b.go(4);
  b.spikes(1);
  b.go(3);
  b.blk(1, 1);
  b.go(2);
  b.blk(1, 1);
  b.go(4);
  b.coin(2);
  b.go(2);
  b.pit(0.7);
  b.go(4);
  spikeBeat(b, 2, 2.6);
  b.go(1.5);
  padLaunch(b, 6);
  b.go(2);
  b.spikes(2);
  b.go(3.5);
  stairs(b, 2, 1.6);
  b.go(3);
  b.coinArc(3);
  b.go(2);
  b.spikes(1);
  b.go(2.6);
  b.spikes(1);
  b.go(2.6);
  b.spikes(1);
  b.go(4);
  b.pit(0.7);
  b.go(3);
  b.blk(3, 1);
  b.go(1.5);
  b.coin(3);
  b.go(3);
  spikeBeat(b, 3, 2.4);
  b.go(2);
  b.pad("yellow");
  b.go(0.5);
  b.coinArc(7);
  b.go(3);
  b.spikes(2);
  b.go(4);
  b.go(6);
}

// -- 2. Neon Drift ----------------------------------------------------------
function buildL2(b) {
  b.go(5);
  spikeBeat(b, 2, 2.6);
  b.go(1);
  b.blk(2, 1);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.coinArc(3);
  b.go(2);
  b.pit(0.75);
  b.go(3.5);
  b.blk(1, 2);
  b.go(2.5);
  b.spikes(1);
  b.go(3);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 14, 1.4, 6.6);
  b.go(1);
  b.corridor(2, 1.2, 5.4);
  b.coin(4);
  b.go(3);
  b.corridor(2, 2.2, 6.4);
  b.go(3);
  b.corridor(2, 1.0, 5.0);
  b.coin(3);
  b.go(3);
  tunnelRun(b, 10, 1.6, 6.2);
  b.go(2);
  b.portal("cube");
  b.go(3);
  spikeBeat(b, 3, 2.4);
  b.go(1);
  padLaunch(b, 6);
  b.go(2);
  b.spikes(2);
  b.go(3);
  stairs(b, 3, 1.4);
  b.go(2.5);
  b.spikes(1);
  b.go(2.4);
  b.spikes(2);
  b.go(3);
  b.pit(0.8);
  b.go(3);
  b.coinArc(4);
  b.go(2);
  b.spikes(1);
  b.go(6);
}

// -- 3. Pulse Grid ----------------------------------------------------------
function buildL3(b) {
  b.go(5);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.blk(1, 1);
  b.go(1.6);
  b.blk(1, 2);
  b.go(1.6);
  b.blk(1, 1);
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.orb("yellow", 3.2);
  b.coin(5);
  b.go(0.6);
  b.pit(1.5);
  b.go(3.5);
  b.spikes(1);
  b.go(2.4);
  b.spikes(2);
  b.go(3);
  b.plat(3, 3);
  b.coin(4.4);
  b.go(3);
  b.spikes(1);
  b.go(2.2);
  b.orb("yellow", 3);
  b.go(0.6);
  b.pit(1.4);
  b.go(3.4);
  stairs(b, 3, 1.3);
  b.go(2);
  b.spikes(2);
  b.go(2.6);
  padLaunch(b, 7);
  b.go(1.4);
  b.spikes(2);
  b.go(3);
  b.blk(2, 2);
  b.go(3);
  b.spikes(1);
  b.go(2.2);
  b.spikes(1);
  b.go(2.2);
  b.spikes(2);
  b.go(3);
  b.plat(2, 4);
  b.coin(5.4);
  b.go(2.6);
  b.orb("yellow", 3.4);
  b.go(0.6);
  b.pit(1.4);
  b.go(3.5);
  spikeBeat(b, 3, 2.2);
  b.go(2);
  b.coinArc(3);
  b.go(6);
}

// -- 4. Gravity Well --------------------------------------------------------
function buildL4(b) {
  b.go(5);
  spikeBeat(b, 2, 2.4);
  b.go(1);
  b.blk(2, 1);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.grav(-1);
  b.go(3);
  b.spikesDown(2);
  b.go(3);
  b.blkTop(2, 1);
  b.go(3);
  b.spikesDown(1);
  b.go(2.4);
  b.spikesDown(2);
  b.go(3);
  b.coin(8);
  b.go(2);
  b.grav(1);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.portal("ball");
  b.go(3);
  b.spikes(1);
  b.go(2.4);
  b.blkTop(3, 1);
  b.spikes(2);
  b.go(3.4);
  b.spikesDown(2);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.blkTop(2, 2);
  b.go(3);
  b.spikes(1);
  b.go(2.2);
  b.spikesDown(1);
  b.go(2.2);
  b.spikes(1);
  b.go(3);
  b.coin(5);
  b.go(2);
  b.portal("cube");
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  padLaunch(b, 7);
  b.go(2);
  b.spikes(2);
  b.go(3);
  stairs(b, 3, 1.3);
  b.go(3);
  b.spikes(1);
  b.go(2.4);
  b.spikes(2);
  b.go(6);
}

// -- 5. Ion Tunnel ----------------------------------------------------------
function buildL5(b) {
  b.go(4);
  spikeBeat(b, 2, 2.4);
  b.go(1);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 12, 1.4, 6.4);
  b.go(1);
  b.corridor(2, 2.6, 6.8);
  b.coin(5);
  b.go(3);
  b.corridor(2, 1.0, 4.8);
  b.go(3);
  b.corridor(2, 2.4, 6.6);
  b.coin(4);
  b.go(3);
  b.corridor(2, 1.2, 5.2);
  b.go(3);
  tunnelRun(b, 8, 1.8, 6.0);
  b.go(2);
  b.portal("wave");
  b.go(3);
  b.corridor(3, 1.2, 6.6);
  b.go(4);
  b.corridor(3, 2.0, 6.4);
  b.coin(4);
  b.go(4);
  b.corridor(3, 1.0, 5.6);
  b.go(4);
  b.corridor(3, 2.2, 6.6);
  b.go(4);
  b.corridor(3, 1.4, 5.8);
  b.go(4);
  b.portal("cube");
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.blk(2, 2);
  b.go(3);
  b.spikes(2);
  b.go(2.8);
  padLaunch(b, 7);
  b.go(2);
  b.spikes(2);
  b.go(3);
  b.pit(0.8);
  b.go(3);
  spikeBeat(b, 2, 2.2);
  b.go(6);
}

// -- 6. Sawmill -------------------------------------------------------------
function buildL6(b) {
  b.go(4);
  spikeBeat(b, 2, 2.4);
  b.go(1);
  b.saw(1, 1);
  b.go(3);
  b.spikes(2);
  b.go(2.8);
  b.saw(1.2, 1.2);
  b.go(3);
  b.blk(2, 1);
  b.go(2.4);
  b.saw(4, 1, { move: { axis: "y", amp: 2 * TILE, periodBeats: 4 } });
  b.go(3);
  b.spikes(2);
  b.go(2.8);
  b.plat(3, 3, { move: { axis: "y", amp: 1.2 * TILE, periodBeats: 6 } });
  b.coin(4.6);
  b.go(3.4);
  b.saw(1, 1.3);
  b.go(3);
  b.orb("yellow", 3.2);
  b.go(0.6);
  b.pit(1.5);
  b.go(3.6);
  b.spikes(3);
  b.go(3);
  b.saw(1, 1);
  b.go(2.6);
  b.saw(1, 1);
  b.go(3);
  padLaunch(b, 7);
  b.go(1.2);
  b.saw(5, 1.4);
  b.go(2.4);
  b.spikes(2);
  b.go(3);
  stairs(b, 3, 1.3);
  b.go(2.4);
  b.saw(1.2, 1.2);
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.orb("yellow", 3.2);
  b.go(0.6);
  b.pit(1.5);
  b.go(3.6);
  b.plat(3, 3, { move: { axis: "y", amp: 1.4 * TILE, periodBeats: 5 } });
  b.coin(4.6);
  b.go(3.4);
  b.saw(1, 1.2);
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(6);
}

// -- 7. Quad Shift ----------------------------------------------------------
function buildL7(b) {
  b.go(4);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.blk(2, 2);
  b.go(3);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 10, 1.6, 6.2);
  b.go(2);
  b.portal("ufo");
  b.go(3);
  b.corridor(2, 1.0, 6.4);
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.spikesDown(2, { y: GROUND_Y - 6.4 * TILE });
  b.go(3);
  b.corridor(2, 1.2, 6.0);
  b.coin(4);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.portal("ball");
  b.go(3);
  b.spikes(1);
  b.go(2.4);
  b.blkTop(3, 1);
  b.spikes(2);
  b.go(3.4);
  b.spikesDown(2);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.portal("wave");
  b.go(3);
  b.corridor(3, 1.4, 6.4);
  b.go(4);
  b.corridor(3, 2.2, 6.6);
  b.coin(4);
  b.go(4);
  b.corridor(3, 1.2, 5.6);
  b.go(4);
  b.portal("cube");
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  padLaunch(b, 7);
  b.go(2);
  b.spikes(2);
  b.go(3);
  b.saw(1, 1.2);
  b.go(3);
  spikeBeat(b, 2, 2.2);
  b.go(6);
}

// -- 8. Overdrive -----------------------------------------------------------
function buildL8(b) {
  b.go(4);
  spikeBeat(b, 2, 2.2);
  b.go(1);
  b.speedUp(1.2);
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.blk(2, 2);
  b.go(2.8);
  b.spikes(2);
  b.go(2.6);
  b.saw(1, 1.2);
  b.go(3);
  b.orb("yellow", 3.2);
  b.go(0.6);
  b.pit(1.4);
  b.go(3.4);
  b.spikes(3);
  b.go(3);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 12, 1.6, 6.0);
  b.go(2);
  b.portal("cube");
  b.go(3);
  b.speedUp(1.0);
  b.go(2.4);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  stairs(b, 3, 1.3);
  b.go(2.4);
  b.saw(4, 1.2, { move: { axis: "y", amp: 2.2 * TILE, periodBeats: 4 } });
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.grav(-1);
  b.go(3);
  b.spikesDown(2);
  b.go(2.8);
  b.blkTop(2, 1);
  b.go(3);
  b.spikesDown(3);
  b.go(3);
  b.grav(1);
  b.go(3);
  b.speedUp(1.25);
  b.go(2.4);
  spikeBeat(b, 4, 2.2);
  b.go(1);
  padLaunch(b, 7);
  b.go(2);
  b.spikes(2);
  b.go(2.6);
  b.saw(1, 1.2);
  b.go(3);
  spikeBeat(b, 3, 2.2);
  b.go(6);
}

// -- 9. Chaos Theory --------------------------------------------------------
function buildL9(b) {
  b.go(4);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.portal("ufo");
  b.go(3);
  b.corridor(2, 1.0, 6.2);
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.spikesDown(2, { y: GROUND_Y - 6.2 * TILE });
  b.go(3);
  b.corridor(2, 1.4, 6.0);
  b.coin(4);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.portal("wave");
  b.go(3);
  b.corridor(3, 1.4, 6.2);
  b.go(4);
  b.corridor(3, 2.4, 6.6);
  b.go(4);
  b.corridor(3, 1.0, 5.4);
  b.coin(3);
  b.go(4);
  b.corridor(3, 2.0, 6.2);
  b.go(4);
  b.portal("cube");
  b.go(3);
  b.speedUp(1.2);
  b.go(2.4);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.saw(1, 1.2);
  b.go(2.8);
  b.spikes(3);
  b.go(3);
  b.orb("yellow", 3.2);
  b.go(0.6);
  b.pit(1.4);
  b.go(3.4);
  b.blk(2, 2);
  b.go(2.8);
  b.spikes(2);
  b.go(2.6);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 12, 1.8, 6.0);
  b.go(2);
  b.portal("cube");
  b.go(3);
  b.speedUp(1.0);
  b.go(2.4);
  padLaunch(b, 7);
  b.go(2);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.saw(1, 1.2);
  b.go(3);
  b.spikes(2);
  b.go(6);
}

// -- 10. Demon Core ---------------------------------------------------------
function buildL10(b) {
  b.go(4);
  spikeBeat(b, 3, 2.2);
  b.go(1);
  b.blk(2, 2);
  b.go(2.8);
  b.spikes(2);
  b.go(2.6);
  b.saw(1, 1.2);
  b.go(3);
  b.portal("ship");
  b.go(2);
  tunnelRun(b, 10, 1.8, 6.0);
  b.go(2);
  b.portal("ball");
  b.go(3);
  b.spikes(2);
  b.go(2.8);
  b.blkTop(3, 1);
  b.spikes(2);
  b.go(3.4);
  b.spikesDown(2);
  b.go(3);
  b.spikes(2);
  b.go(3);
  b.portal("ufo");
  b.go(3);
  b.corridor(2, 1.2, 6.2);
  b.go(3);
  b.spikes(2);
  b.go(2.6);
  b.spikesDown(2, { y: GROUND_Y - 6.2 * TILE });
  b.go(3);
  b.corridor(2, 1.0, 5.8);
  b.coin(4);
  b.go(3);
  b.portal("wave");
  b.go(3);
  b.corridor(3, 1.4, 6.0);
  b.go(4);
  b.corridor(3, 2.4, 6.4);
  b.go(4);
  b.corridor(3, 1.2, 5.4);
  b.go(4);
  b.portal("cube");
  b.go(3);
  b.speedUp(1.25);
  b.go(2.4);
  spikeBeat(b, 4, 2.2);
  b.go(1);
  b.saw(1, 1.2);
  b.go(2.8);
  b.spikes(3);
  b.go(3);
  b.orb("yellow", 3.2);
  b.go(0.6);
  b.pit(1.4);
  b.go(3.4);
  stairs(b, 3, 1.3);
  b.go(2.4);
  b.saw(4, 1.2, { move: { axis: "y", amp: 2.2 * TILE, periodBeats: 4 } });
  b.go(3);
  b.speedUp(1.0);
  b.go(2.4);
  b.grav(-1);
  b.go(3);
  b.spikesDown(2);
  b.go(2.8);
  b.spikesDown(3);
  b.go(3);
  b.grav(1);
  b.go(3);
  padLaunch(b, 7);
  b.go(2);
  spikeBeat(b, 4, 2.2);
  b.go(1);
  b.blk(2, 2);
  b.go(3);
  b.spikes(2);
  b.go(6);
}

export const LEVEL_DEFS = [
  { id: 1, name: "First Steps", difficulty: "Easy", stars: 1, speed: 300, bpm: 120, theme: THEMES.aqua, build: buildL1 },
  { id: 2, name: "Neon Drift", difficulty: "Easy", stars: 2, speed: 310, bpm: 126, theme: THEMES.cobalt, build: buildL2 },
  { id: 3, name: "Pulse Grid", difficulty: "Normal", stars: 3, speed: 330, bpm: 132, theme: THEMES.violet, build: buildL3 },
  { id: 4, name: "Gravity Well", difficulty: "Normal", stars: 4, speed: 340, bpm: 136, theme: THEMES.magenta, build: buildL4 },
  { id: 5, name: "Ion Tunnel", difficulty: "Hard", stars: 5, speed: 355, bpm: 140, theme: THEMES.amber, build: buildL5 },
  { id: 6, name: "Sawmill", difficulty: "Hard", stars: 6, speed: 365, bpm: 144, theme: THEMES.ember, build: buildL6 },
  { id: 7, name: "Quad Shift", difficulty: "Harder", stars: 7, speed: 380, bpm: 150, theme: THEMES.gold, build: buildL7 },
  { id: 8, name: "Overdrive", difficulty: "Harder", stars: 8, speed: 395, bpm: 156, theme: THEMES.neon, build: buildL8 },
  { id: 9, name: "Chaos Theory", difficulty: "Insane", stars: 9, speed: 410, bpm: 162, theme: THEMES.lime, build: buildL9 },
  { id: 10, name: "Demon Core", difficulty: "Demon", stars: 10, speed: 425, bpm: 170, theme: THEMES.crimson, build: buildL10 },
];

const cache = new Map();

/** Build (and memoise) the full geometry for a level definition. */
export function getLevel(def) {
  if (cache.has(def.id)) return cache.get(def.id);

  const b = makeBuilder(def);
  def.build(b);
  const raw = b.finish();
  const length = raw.length;

  // Floor solids: one long slab, split around every authored pit.
  const pits = raw.pits.slice().sort((p, q) => p.x0 - q.x0);
  const floor = [];
  let cursor = -400;
  for (const p of pits) {
    if (p.x0 > cursor) floor.push({ x: cursor, y: GROUND_Y, w: p.x0 - cursor, h: 220, style: "ground" });
    cursor = p.x1;
  }
  floor.push({ x: cursor, y: GROUND_Y, w: length + 600 - cursor, h: 220, style: "ground" });

  // Ceiling slab so flipped gravity and flight modes have a real surface.
  const ceiling = [{ x: -400, y: CEIL_Y - 220, w: length + 1000, h: 220, style: "ground" }];

  const level = {
    def,
    length,
    pits,
    floor,
    ceiling,
    solids: raw.solids,
    hazards: raw.hazards,
    pads: raw.pads,
    orbs: raw.orbs,
    portals: raw.portals.slice().sort((p, q) => p.x - q.x),
    coins: raw.coins,
  };
  // A ceiling is only *drawn* for levels that actually use it (flight modes,
  // gravity flips, hanging blocks). Elsewhere it stays as an invisible lid so
  // nothing can escape the world, and the sky is left open.
  level.usesCeiling =
    raw.portals.some((p) => p.kind === "grav" || (p.kind === "mode" && p.value !== "cube" && p.value !== "ball")) ||
    raw.solids.some((s) => s.y <= CEIL_Y + 1) ||
    raw.hazards.some((h) => h.dir === "down");

  level.allSolids = [...ceiling, ...floor, ...raw.solids];
  level.allSolids.sort((a, c) => a.x - c.x);

  cache.set(def.id, level);
  return level;
}

/** Vertical offset of a moving solid/hazard, keyed off world-x so retries match. */
export function moveOffset(move, level, x) {
  if (!move) return 0;
  const period = move.periodBeats * ((level.def.speed * 60) / level.def.bpm);
  return move.amp * Math.sin((x / period) * Math.PI * 2 + (move.phase || 0));
}

/** Current rect of a solid, with any movement applied. */
export function solidRect(s, level, x) {
  const dy = moveOffset(s.move, level, x);
  return { x: s.x, y: s.y + dy, w: s.w, h: s.h, style: s.style };
}

export function modeAt(level, x) {
  let mode = "cube";
  for (const p of level.portals) {
    if (p.kind === "mode" && p.x <= x) mode = p.value;
  }
  return mode;
}

export function gravityAt(level, x) {
  let g = 1;
  for (const p of level.portals) {
    if (p.kind === "grav" && p.x <= x) g = p.value;
  }
  return g;
}

export function speedAt(level, x) {
  let mult = 1;
  for (const p of level.portals) {
    if (p.kind === "speed" && p.x <= x) mult = p.value;
  }
  return level.def.speed * mult;
}

export function storeKey(suffix) {
  return `game-tastic:geo-dash:${suffix}`;
}
