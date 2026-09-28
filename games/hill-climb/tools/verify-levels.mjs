// verify-levels.mjs — drive every campaign level with a scripted driver and
// report whether it can be finished, how long it takes against par, and how
// close the tank runs to empty. The driver is deliberately plain (full gas,
// level out in the air, back up when stuck) so a level it can finish is one a
// player can finish.
// Run: node tools/verify-levels.mjs [tier-offset]   (tier-offset shifts upgrades)
import { STAGES, getStage } from "../stages.js";
import { LEVELS } from "../levels.js";
import { createTerrain, createPickups } from "../terrain.js";
import { createVehicle, stepVehicle, hazardHit } from "../vehicle.js";
import { tuningFrom } from "../upgrades.js";
import { FUEL } from "../rules.js";

const DT = 1 / 60;
const OFFSET = Number(process.argv[2] || 0);
// Upgrade level a player plausibly has on arriving in each world.
const TIER = [0, 0, 1, 1, 2, 2, 3, 4];

function drive(car, bot, dt, terrain) {
  if (bot.reverse > 0) {
    bot.reverse -= dt;
    return { gas: false, brake: true };
  }
  if (!car.grounded) {
    // Match the slope under the likely landing spot, damped by spin rate.
    const target = Math.atan(terrain.slopeAt(car.x + car.vx * 0.3));
    const u = (car.angle - target) * 3 + car.av * 0.45;
    if (u > 0.5) return { gas: false, brake: true };
    if (u < -0.5) return { gas: true, brake: false };
    return { gas: false, brake: false };
  }
  bot.watch += dt;
  if (bot.watch > 2.5) {
    if (car.x - bot.mark < 0.8) bot.reverse = 1.6;
    bot.watch = 0;
    bot.mark = car.x;
  }
  if (car.angle > 0.95) return { gas: false, brake: false };
  if (car.speed > bot.vcap) return { gas: false, brake: false };
  return { gas: true, brake: false };
}

function toCmd(car, inp) {
  let throttle = 0;
  if (inp.gas) throttle += 1;
  if (inp.brake) throttle -= 1;
  return { throttle, brake: inp.brake && car.vx > 1.2 };
}

export function runLevel(level, tier) {
  const stage = getStage(level.world);
  const terrain = createTerrain(stage, level.seed, level);
  const pickups = createPickups(terrain, level.seed);
  const t = Math.max(0, Math.min(5, tier));
  const tune = tuningFrom({ engine: t, suspension: t, tires: t, fuel: t, awd: t });
  const car = createVehicle(terrain, tune);
  const bot = { reverse: 0, watch: 0, mark: car.x, vcap: stage.gravity < 10 ? 11 : 15 };
  const maxFuel = FUEL.max * tune.fuel;
  let fuel = maxFuel;
  let minFuel = fuel;
  let coins = 0;
  let time = 0;
  for (; time < 400; time += DT) {
    const cmd = fuel > 0 ? toCmd(car, drive(car, bot, DT, terrain)) : { throttle: 0, brake: false };
    stepVehicle(car, terrain, stage, cmd, DT);
    fuel -= (FUEL.idle + Math.abs(cmd.throttle) * FUEL.gas) * DT;
    for (const it of pickups.items) {
      if (it.taken || Math.abs(it.x - car.x) > 3) continue;
      if (Math.hypot(it.x - car.x, it.y - car.y) > 1.25) continue;
      it.taken = true;
      if (it.kind === "coin") coins++;
      else fuel = Math.min(maxFuel, fuel + FUEL.pickup);
    }
    minFuel = Math.min(minFuel, fuel);
    if (!Number.isFinite(car.x + car.y)) return { end: "NaN", x: car.x, time };
    if (car.crashed) return { end: "neck", x: car.x, time, coins, total: pickups.total };
    const hz = hazardHit(car, terrain);
    if (hz) return { end: hz.kind, x: car.x, time, coins, total: pickups.total };
    if (fuel <= 0 && Math.abs(car.vx) < 0.3) return { end: "fuel", x: car.x, time, coins, total: pickups.total };
    if (car.x >= terrain.finishX) return { end: "FINISH", x: car.x, time, coins, total: pickups.total, minFuel: minFuel / maxFuel };
  }
  return { end: "timeout", x: car.x, time, coins, total: pickups.total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let fails = 0;
  for (const level of LEVELS) {
    const tier = TIER[level.worldIndex] + OFFSET;
    const r = runLevel(level, tier);
    const ok = r.end === "FINISH";
    if (!ok) fails++;
    console.log(
      `${level.number.padEnd(4)} ${level.name.padEnd(15)} len=${String(level.length).padStart(4)} tier=${tier} ` +
        `${ok ? "FINISH" : r.end.toUpperCase().padEnd(6)} at ${r.x.toFixed(0).padStart(4)}m ` +
        `t=${r.time.toFixed(0).padStart(3)}s par=${level.par}s ` +
        `coins=${r.coins}/${r.total}` +
        (ok ? ` fuelMin=${(r.minFuel * 100).toFixed(0)}%` : "")
    );
  }
  console.log(`${LEVELS.length - fails}/${LEVELS.length} finished`);
}
