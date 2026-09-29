// verify-levels.mjs — drive every campaign level with a scripted driver and
// check the difficulty curve in both directions: each level must be
// finishable with the garage a player can afford by then, and the later ones
// must NOT be finishable with a stock (or barely upgraded) car.
//
// The driver is deliberately plain (full gas up to a speed cap, level out in
// the air, back up when stuck), so a level it finishes is one a player can
// finish; a skilled player gets roughly one upgrade tier more out of a car.
//
// A "rung" is one car with every part at the same upgrade level. Rungs are
// sorted by what they cost to own, and for each level the tool reports the
// cheapest rung that finishes it, next to the coins a player has plausibly
// earned by then.
//
// Run: node tools/verify-levels.mjs            full ladder report
//      node tools/verify-levels.mjs quick      only the expected rung per level
import { getStage } from "../stages.js";
import { LEVELS } from "../levels.js";
import { createTerrain, createPickups } from "../terrain.js";
import { createVehicle, stepVehicle, hazardHit } from "../vehicle.js";
import { tuningFrom, uniformLevels, costToLevel, MAX_LEVEL } from "../upgrades.js";
import { VEHICLES, getVehicle } from "../vehicles.js";
import { FUEL } from "../rules.js";

const DT = 1 / 60;

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
  // Wheelie control: lift off when the nose climbs past the slope under it.
  const rel = car.angle - Math.atan(terrain.slopeAt(car.x));
  if (car.angle > 0.95 || rel > 0.5) return { gas: false, brake: false };
  // Full speed at pits, a cap elsewhere so crests don't throw the car.
  const pitAhead = terrain.pits.some((q) => q.x0 - car.x > 0 && q.x0 - car.x < 60);
  if (!pitAhead && car.speed > bot.vcap) return { gas: false, brake: false };
  return { gas: true, brake: false };
}

function toCmd(car, inp) {
  let throttle = 0;
  if (inp.gas) throttle += 1;
  if (inp.brake) throttle -= 1;
  return { throttle, brake: inp.brake && car.vx > 1.2 };
}

export function runLevel(level, spec, levels) {
  const stage = getStage(level.world);
  const terrain = createTerrain(stage, level.seed, level);
  const pickups = createPickups(terrain, level.seed);
  const tune = tuningFrom(spec, levels);
  const car = createVehicle(terrain, spec, tune);
  const bot = { reverse: 0, watch: 0, mark: car.x, vcap: stage.gravity < 10 ? 13 : 19 };
  const maxFuel = FUEL.max * tune.fuel;
  let fuel = maxFuel;
  let minFuel = fuel;
  let coins = 0;
  let time = 0;
  const out = (end) => ({ end, x: car.x, time, coins, total: pickups.total, minFuel: minFuel / maxFuel });
  for (; time < 500; time += DT) {
    const cmd = fuel > 0 ? toCmd(car, drive(car, bot, DT, terrain)) : { throttle: 0, brake: false };
    stepVehicle(car, terrain, stage, cmd, DT);
    fuel -= (FUEL.idle + Math.abs(cmd.throttle) * FUEL.gas) * DT;
    for (const it of pickups.items) {
      if (it.taken || Math.abs(it.x - car.x) > 3) continue;
      if (Math.hypot(it.x - car.x, it.y - car.y) > 1.25) continue;
      it.taken = true;
      if (it.kind === "coin") coins++;
      else fuel = Math.min(maxFuel, fuel + FUEL.pickup * maxFuel);
    }
    minFuel = Math.min(minFuel, fuel);
    if (!Number.isFinite(car.x + car.y)) return out("NaN");
    if (car.crashed) return out("neck");
    const hz = hazardHit(car, terrain);
    if (hz) return out(hz.kind);
    if (fuel <= 0 && Math.abs(car.vx) < 0.3) return out("fuel");
    if (car.x >= terrain.finishX) return out("FINISH");
  }
  return out("timeout");
}

/** Every car at every upgrade level, cheapest to own first. */
export const LADDER = VEHICLES.flatMap((spec) =>
  Array.from({ length: MAX_LEVEL + 1 }, (_, l) => ({ spec, l, cost: spec.price + costToLevel(spec, l) }))
).sort((a, b) => a.cost - b.cost);

const rungName = (r) => `${r.spec.id}/${r.l}`;

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "level") {
  // node tools/verify-levels.mjs level 7-1  — every rung on one level
  const level = LEVELS.find((l) => l.number === process.argv[3]);
  for (const r of LADDER) {
    const res = runLevel(level, r.spec, uniformLevels(r.l));
    console.log(`${rungName(r).padEnd(10)} ${String(r.cost).padStart(7)} ${res.end.padEnd(7)}@${res.x.toFixed(0).padStart(5)} t=${res.time.toFixed(0)}s fuelMin=${(res.minFuel * 100).toFixed(0)}%`);
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  // A car finishing on the first try is luck as much as balance; call a rung
  // good for a level when it finishes it at all (the bot is deterministic).
  let earned = 0;
  let bad = 0;
  for (const level of LEVELS) {
    let hit = null;
    let last = null;
    for (const r of LADDER) {
      const res = runLevel(level, r.spec, uniformLevels(r.l));
      if (res.end === "FINISH") {
        hit = { r, res };
        break;
      }
      last = res;
    }
    const stock = runLevel(level, VEHICLES[0], uniformLevels(0));
    const need = hit ? hit.r.cost : Infinity;
    const note = !hit ? "UNBEATABLE" : need > earned * 1.3 + 800 ? "TOO HARD" : "";
    if (note) bad++;
    console.log(
      `${level.number.padEnd(4)} ${level.name.padEnd(15)} ${String(level.length).padStart(4)}m ` +
        `need=${hit ? rungName(hit.r).padEnd(10) : "-".padEnd(10)} cost=${String(hit ? need : "-").padStart(6)} ` +
        `earned≈${String(Math.round(earned)).padStart(6)} stock=${stock.end.padEnd(6)}@${stock.x.toFixed(0).padStart(4)} ` +
        (hit ? `t=${hit.res.time.toFixed(0)}s par=${level.par}s fuelMin=${(hit.res.minFuel * 100).toFixed(0)}%` : `last=${last.end}@${last.x.toFixed(0)}`) +
        (note ? `  <-- ${note}` : "")
    );
    // What a player has banked after clearing this level: its reward, two
    // thirds of its coins, and one more run's worth of coins (a failed
    // attempt still keeps what it picked up).
    const coinsHere = (hit ? hit.res.total : 60) * 0.65 * level.coinValue;
    earned += level.reward + coinsHere * 2;
  }
  console.log(bad ? `${bad} levels out of balance` : "all levels in balance");
}
