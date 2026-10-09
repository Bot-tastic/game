// Drives every level (and a long endless run) with autopilot bots and reports
// any crash. Usage: node games/rider/tools/verify-levels.mjs [fromLevel] [toLevel]
import { buildLevel, createEndless, makeBot } from "../levels.js";
import { createBike, placeBike, launchBike, stepBike, P } from "../physics.js";
import { LEVEL_COUNT } from "../themes.js";

const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || LEVEL_COUNT);

function run(world, bot, { untilX = Infinity, maxT = 900 } = {}) {
  const b = createBike();
  placeBike(b, world.track, world.start);
  launchBike(b);
  const crashes = [];
  let lastCp = world.start;
  let flips = 0, perfects = 0, t = 0, finishT = -1;
  const ev = [];
  while (t < maxT) {
    if (world.extend) world.extend(b.x + 5000);
    ev.length = 0;
    stepBike(b, world.track, bot(b, world.track), P.DT, ev);
    t += P.DT;
    for (const e of ev) {
      if (e.type === "checkpoint") lastCp = e.cp;
      if (e.type === "land") { flips += e.flips; if (e.perfect) perfects++; }
      if (e.type === "finish") finishT = t;
      if (e.type === "crash") {
        const f = world.features.find((f) => e.x >= f.x0 - 50 && e.x <= f.x1 + 50);
        crashes.push(`${e.reason}@${Math.round(e.x)}(${f ? f.kind : "?"})`);
        if (crashes.length > 6) return { crashes, flips, perfects, t, stuck: true };
        placeBike(b, world.track, lastCp);
        launchBike(b);
      }
    }
    if (finishT >= 0 && t > finishT + 1) break;
    if (b.x > untilX) break;
  }
  return { crashes, flips, perfects, t, finished: finishT >= 0 || b.x > untilX };
}

let bad = 0;
for (let n = from; n <= to; n++) {
  const out = [];
  for (const mode of [{ flips: false }, { flips: true, maxFlips: 1 }, { flips: true, maxFlips: 3 }]) {
    const lv = buildLevel(n);
    const r = run(lv, makeBot(mode));
    out.push(r);
    if (r.crashes.length || !r.finished) bad++;
  }
  const lv = buildLevel(n);
  console.log(
    `L${String(n).padStart(2)} len=${Math.round(lv.track.finish.x)} gems=${lv.gemTotal} flipT=${lv.flipTarget} ` +
      out.map((r, i) => `[bot${i} ${r.finished ? "ok" : "DNF"} t=${r.t.toFixed(0)} f=${r.flips} p=${r.perfects}${r.crashes.length ? " CRASH " + r.crashes.join(",") : ""}]`).join(" ")
  );
}
for (const seed of [1, 2, 3]) {
  for (const mode of [{ flips: false }, { flips: true }]) {
    const r = run(createEndless(seed), makeBot(mode), { untilX: 90000, maxT: 400 });
    console.log(`endless seed=${seed} flips=${mode.flips} ${r.finished ? "ok" : "DNF"} f=${r.flips} ${r.crashes.join(",")}`);
    if (r.crashes.length) bad++;
  }
}
console.log(bad ? `${bad} problem runs` : "all clean");
process.exit(bad ? 1 : 0);
