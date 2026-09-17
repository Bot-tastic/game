// verify-levels.mjs — offline completability check.
//
// Runs the real player.js physics under a beam search over the tap/hold input
// stream. If the search reaches the end of a level, a human can too; if it
// stalls, the report prints the world-x where every branch died, which is the
// obstacle that needs re-authoring. Run with: node games/geo-dash/tools/verify-levels.mjs
//
// This exists because a rhythm platformer with a jump the player physically
// cannot clear is a bug, and eyeballing geometry does not catch it.

import { LEVEL_DEFS, getLevel } from "../levels.js";
import { createPlayer, createRun, step } from "../player.js";

const DT = 1 / 60;
const BEAM = 700;

function clone(s) {
  return {
    p: {
      ...s.p,
      waveTrail: [],
    },
    run: {
      padUsed: s.run.padUsed.slice(),
      coins: s.run.coins.slice(),
      coinCount: s.run.coinCount,
    },
    held: s.held,
  };
}

function key(s) {
  return `${s.p.mode}|${s.p.grav}|${Math.round(s.p.y / 4)}|${Math.round(s.p.vy / 25)}|${s.p.grounded ? 1 : 0}|${s.held ? 1 : 0}`;
}

function solve(def) {
  const level = getLevel(def);
  const start = { p: createPlayer(level, 0), run: createRun(level), held: false };
  start.p.waveTrail = [];
  let beam = [start];
  let best = 0;
  const maxFrames = Math.ceil((level.length / (def.speed * 0.8)) * 60) + 600;

  for (let f = 0; f < maxFrames; f++) {
    const next = new Map();
    for (const s of beam) {
      for (const held of [false, true]) {
        const c = clone(s);
        const justPressed = held && !c.held;
        c.held = held;
        step(c.p, level, c.run, DT, { pressed: held, justPressed });
        if (c.p.dead) continue;
        if (c.p.x > best) best = c.p.x;
        if (c.p.x >= level.length) return { ok: true, pct: 100, level };
        const k = key(c);
        if (!next.has(k)) next.set(k, c);
      }
    }
    beam = [...next.values()];
    if (beam.length === 0) break;
    if (beam.length > BEAM) {
      beam.sort((a, b) => b.p.x - a.p.x);
      beam.length = BEAM;
    }
  }

  return { ok: false, pct: (best / level.length) * 100, at: best, level };
}

let failures = 0;
for (const def of LEVEL_DEFS) {
  const t0 = Date.now();
  const r = solve(def);
  const ms = Date.now() - t0;
  const lvl = getLevel(def);
  if (r.ok) {
    console.log(
      `OK   ${String(def.id).padStart(2)}  ${def.name.padEnd(14)} len=${Math.round(lvl.length)}  ` +
        `haz=${lvl.hazards.length} solids=${lvl.solids.length} coins=${lvl.coins.length}  (${ms}ms)`
    );
  } else {
    failures++;
    console.log(
      `FAIL ${String(def.id).padStart(2)}  ${def.name.padEnd(14)} stuck at x=${Math.round(r.at)} ` +
        `(${r.pct.toFixed(1)}% of ${Math.round(lvl.length)})  (${ms}ms)`
    );
  }
}

console.log(failures === 0 ? "\nAll levels completable." : `\n${failures} level(s) not completable.`);
process.exit(failures === 0 ? 0 : 1);
