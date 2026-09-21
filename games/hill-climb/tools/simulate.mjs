// simulate.mjs — headless physics probe. Runs a naive "hold the gas" driver
// over every stage and reports whether the buggy behaves: does it reach a
// sane top speed, does it climb, does it stay solved (no NaNs, no launches
// into orbit)? Run: node tools/simulate.mjs [seconds]
import { STAGES } from "../stages.js";
import { createTerrain } from "../terrain.js";
import { createVehicle, stepVehicle } from "../vehicle.js";
import { tuningFrom, emptyLevels } from "../upgrades.js";

const SECS = Number(process.argv[2] || 60);
const DT = 1 / 60;

function run(stage, levels, seed) {
  const terrain = createTerrain(stage, seed);
  const tune = tuningFrom(levels);
  const car = createVehicle(terrain, tune);
  let t = 0;
  let maxSpeed = 0;
  let maxY = -1e9;
  let crashAt = null;
  for (; t < SECS; t += DT) {
    // Naive driver: gas, plus a dab of brake to level out in a long flight.
    const input = { throttle: 1, brake: car.airTime > 0.8 && car.angle > 0.9 };
    stepVehicle(car, terrain, stage, input, DT);
    terrain.prune(car.x);
    maxSpeed = Math.max(maxSpeed, car.speed);
    maxY = Math.max(maxY, car.y - terrain.groundY(car.x));
    if (!Number.isFinite(car.x + car.y + car.angle)) return { bad: "NaN", t };
    if (car.crashed && crashAt == null) crashAt = { t, x: car.x };
    if (car.crashed) break;
  }
  return { dist: car.x, t, maxSpeed, maxY, crashAt };
}

let bad = 0;
for (const stage of STAGES) {
  for (const [name, levels] of [
    ["stock", emptyLevels()],
    ["maxed", { engine: 5, suspension: 5, tires: 5, fuel: 5, awd: 5 }],
  ]) {
    for (const seed of [1, 7, 99]) {
      const r = run(stage, levels, seed);
      if (r.bad) {
        bad++;
        console.log(`FAIL ${stage.id}/${name}/${seed}: ${r.bad} at t=${r.t.toFixed(1)}`);
        continue;
      }
      console.log(
        `${stage.id.padEnd(12)} ${name.padEnd(6)} seed=${String(seed).padEnd(3)} ` +
          `dist=${r.dist.toFixed(0).padStart(5)}m  t=${r.t.toFixed(1).padStart(5)}s  ` +
          `vmax=${(r.maxSpeed * 3.6).toFixed(0).padStart(3)}km/h  air=${r.maxY.toFixed(1)}m  ` +
          (r.crashAt ? `crash@${r.crashAt.x.toFixed(0)}m` : "survived")
      );
    }
  }
}
process.exit(bad ? 1 : 0);
