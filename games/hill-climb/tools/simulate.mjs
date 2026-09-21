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

// Two reference drivers. "reckless" holds the gas down and tells us whether
// the game can kill you at all; "careful" models what a player actually does
// — off the gas in the air, brake to bring the nose back down — and tells us
// whether the game is driveable.
const DRIVERS = {
  reckless: (car) => ({ throttle: 1, brake: false }),
  careful: (car) => {
    if (!car.grounded) {
      // Level the car out: brake pitches the nose down, gas lifts it.
      if (car.angle > 0.35) return { throttle: 0, brake: true };
      if (car.angle < -0.45) return { throttle: 1, brake: false };
      return { throttle: 0, brake: false };
    }
    // On the ground, ease off when the nose is already climbing.
    return { throttle: car.angle > 0.75 ? 0.35 : 1, brake: false };
  },
};

function run(stage, levels, seed, driver = "reckless") {
  const terrain = createTerrain(stage, seed);
  const tune = tuningFrom(levels);
  const car = createVehicle(terrain, tune);
  let t = 0;
  let maxSpeed = 0;
  let maxY = -1e9;
  let crashAt = null;
  let maxAir = 0;
  let airTotal = 0;
  let maxTurns = 0;
  const jumps = []; // airtimes of every hop longer than 0.3s
  for (; t < SECS; t += DT) {
    stepVehicle(car, terrain, stage, DRIVERS[driver](car), DT);
    terrain.prune(car.x);
    maxSpeed = Math.max(maxSpeed, car.speed);
    maxY = Math.max(maxY, car.y - terrain.groundY(car.x));
    maxAir = Math.max(maxAir, car.airTime);
    maxTurns = Math.max(maxTurns, Math.abs(car.flipTurns));
    if (!car.grounded) airTotal += DT;
    if (car.landed) {
      if (car.landed > 0.3) jumps.push(car.landed);
      car.landed = 0;
    }
    if (!Number.isFinite(car.x + car.y + car.angle)) return { bad: "NaN", t };
    if (car.crashed && crashAt == null) crashAt = { t, x: car.x };
    if (car.crashed) break;
  }
  return { dist: car.x, t, maxSpeed, maxY, crashAt, maxAir, airPct: airTotal / t, maxTurns, jumps };
}

let bad = 0;
for (const stage of STAGES) {
  for (const [name, levels] of [
    ["stock", emptyLevels()],
    ["maxed", { engine: 5, suspension: 5, tires: 5, fuel: 5, awd: 5 }],
  ]) {
    for (const [seed, driver] of [[1, "careful"], [7, "careful"], [99, "careful"], [1, "reckless"], [7, "reckless"]]) {
      const r = run(stage, levels, seed, driver);
      if (r.bad) {
        bad++;
        console.log(`FAIL ${stage.id}/${name}/${seed}/${driver}: ${r.bad} at t=${r.t.toFixed(1)}`);
        continue;
      }
      console.log(
        `${stage.id.padEnd(12)} ${name.padEnd(6)} ${driver.padEnd(8)} seed=${String(seed).padEnd(3)} ` +
          `dist=${r.dist.toFixed(0).padStart(5)}m  t=${r.t.toFixed(1).padStart(5)}s  ` +
          `vmax=${(r.maxSpeed * 3.6).toFixed(0).padStart(3)}km/h  ` +
          `air=${r.maxAir.toFixed(2)}s/${(r.airPct * 100).toFixed(0)}%  ` +
          `jumps=${r.jumps.length}(${r.jumps.filter((j) => j > 0.8).length} big)/100m=${(
            (r.jumps.length / Math.max(1, r.dist)) * 100
          ).toFixed(1)}  turns=${r.maxTurns.toFixed(2)}  ` +
          (r.crashAt ? `crash@${r.crashAt.x.toFixed(0)}m` : "survived")
      );
    }
  }
}
process.exit(bad ? 1 : 0);
