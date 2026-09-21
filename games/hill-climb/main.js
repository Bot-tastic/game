// main.js — boot and orchestration for Hill Climb: the state machine, stage
// select, garage, HUD, camera and the glue between input, physics, sound and
// FX. Everything simulation-shaped lives in vehicle.js / terrain.js; this file
// decides when a run starts, what it costs and what it pays out.

import {
  lockViewport,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
  showToast,
} from "../../shared/game-utils.js";
import { STAGES, getStage, isUnlocked, storeKey } from "./stages.js";
import { createTerrain, createPickups } from "./terrain.js";
import { createVehicle, stepVehicle, WHEEL } from "./vehicle.js";
import { createRenderer } from "./render.js";
import { createFx, updateFx, clearFx, dirt, smoke, sparks, pop, shake, flash } from "./fx.js";
import { createAudio } from "./audio.js";
import { PARTS, MAX_LEVEL, nextCost, tuningFrom, emptyLevels } from "./upgrades.js";

const canvas = document.getElementById("game");
const renderer = createRenderer(canvas);
const audio = createAudio();
const fx = createFx();

const el = (id) => document.getElementById(id);
const menuOverlay = el("menu-overlay");
const garageOverlay = el("garage-overlay");
const pauseOverlay = el("pause-overlay");
const overOverlay = el("over-overlay");
const hud = el("hud");
const gauges = el("gauges");
const controls = el("controls");
const pauseBtn = el("pause-btn");
const muteBtn = el("mute-btn");
const toastEl = el("toast");
const airBanner = el("air-banner");

// --- tuning knobs the design is balanced around ----------------------------
const FUEL_MAX = 100;
const FUEL_IDLE = 0.8; // units/second just for running
const FUEL_GAS = 1.9; // extra units/second at full throttle
const FUEL_PICKUP = 42;
const COIN_VALUE = 10;
const AIR_BONUS = 12; // coins per second of airtime, paid on landing
const FLIP_BONUS = 120;

// --- persistent state -------------------------------------------------------
const LEVEL_KEYS = PARTS.map((p) => p.id);

function loadLevels() {
  const out = emptyLevels();
  for (const id of LEVEL_KEYS) out[id] = loadHighScore(storeKey(`up:${id}`), 0);
  return out;
}
const saveLevel = (id, v) => saveHighScore(storeKey(`up:${id}`), v);

let coins = loadHighScore(storeKey("coins"), 0);
let levels = loadLevels();
const bestOf = (id) => loadHighScore(storeKey(`best:${id}`), 0);
const setBest = (id, v) => saveHighScore(storeKey(`best:${id}`), Math.round(v));
const lifetimeBest = () => STAGES.reduce((m, s) => Math.max(m, bestOf(s.id)), 0);

let stageId = localStorage.getItem(storeKey("stage")) || STAGES[0].id;
if (!isUnlocked(getStage(stageId), lifetimeBest())) stageId = STAGES[0].id;

// --- run state --------------------------------------------------------------
let state = "menu"; // menu | garage | playing | paused | over
let stage = getStage(stageId);
let terrain = null;
let pickups = null;
let car = null;
let fuel = FUEL_MAX;
let runCoins = 0;
let runDistance = 0;
let bestAir = 0;
let flips = 0;
let time = 0;
let camX = 0;
let camY = 0;
let overReason = "";
let crashTimer = 0;
let dryTimer = 0;
let lowFuelWarned = false;
let smokeTimer = 0;
let lastFlipTurn = 0;

const input = { gas: false, brake: false };

lockViewport(canvas);
fitCanvasToScreen(canvas, (w, h) => renderer.resize(w, h));

// ---------------------------------------------------------------------------
// Stage select + garage UI
// ---------------------------------------------------------------------------

function renderStages() {
  const grid = el("stage-grid");
  const best = lifetimeBest();
  grid.innerHTML = "";
  for (const s of STAGES) {
    const unlocked = isUnlocked(s, best);
    const card = document.createElement("button");
    card.className = "stage-card" + (s.id === stageId ? " on" : "") + (unlocked ? "" : " locked");
    card.style.setProperty("--st-a", s.theme.sky0);
    card.style.setProperty("--st-b", s.theme.crust);
    card.style.setProperty("--st-glow", s.theme.accent);
    card.innerHTML = `
      <span class="st-name">${s.name}</span>
      <span class="st-blurb">${unlocked ? s.blurb : `Reach ${s.unlockAt}m to unlock`}</span>
      <span class="st-best">${unlocked ? `Best ${bestOf(s.id)}m` : "🔒 Locked"}</span>
    `;
    card.disabled = !unlocked;
    card.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      stageId = s.id;
      stage = getStage(stageId);
      try {
        localStorage.setItem(storeKey("stage"), stageId);
      } catch {
        // ignore — private browsing
      }
      renderStages();
      previewStage();
    });
    grid.appendChild(card);
  }
}

function renderGarage() {
  el("garage-wallet").textContent = coins;
  el("wallet-value").textContent = coins;
  const wrap = el("parts");
  wrap.innerHTML = "";
  for (const part of PARTS) {
    const lvl = levels[part.id] | 0;
    const cost = nextCost(part, lvl);
    const row = document.createElement("div");
    row.className = "part" + (cost == null ? " maxed" : "");
    row.innerHTML = `
      <span class="part-icon">${part.icon}</span>
      <div class="part-body">
        <b>${part.name}</b>
        <span class="part-blurb">${part.blurb}</span>
        <span class="pips">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("")}</span>
        <span class="part-value">${part.label(lvl)}</span>
      </div>
      <button class="buy" ${cost == null ? "disabled" : ""}>${cost == null ? "MAX" : `🪙 ${cost}`}</button>
    `;
    const buy = row.querySelector(".buy");
    if (cost != null) {
      buy.classList.toggle("afford", coins >= cost);
      buy.addEventListener("click", () => {
        audio.unlock();
        if (coins < cost) {
          audio.sfx("deny");
          showToast(toastEl, "Not enough coins");
          return;
        }
        coins -= cost;
        levels[part.id] = lvl + 1;
        saveLevel(part.id, levels[part.id]);
        saveHighScore(storeKey("coins"), coins);
        audio.sfx("buy");
        renderGarage();
      });
    }
    wrap.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Build a fresh world; `driver` false leaves the car out (menu backdrop). */
function buildWorld(withCar) {
  terrain = createTerrain(stage);
  pickups = createPickups(terrain, terrain.seed);
  car = withCar ? createVehicle(terrain, tuningFrom(levels)) : null;
  camX = withCar ? car.x : 14;
  camY = (withCar ? car.y : terrain.groundY(14)) + 1;
  clearFx(fx);
}

/** The menu shows the selected stage's landscape behind the panel. */
function previewStage() {
  buildWorld(false);
}

function startRun() {
  audio.unlock();
  buildWorld(true);
  fuel = FUEL_MAX * tuningFrom(levels).fuel;
  runCoins = 0;
  runDistance = 0;
  bestAir = 0;
  flips = 0;
  crashTimer = 0;
  dryTimer = 0;
  lowFuelWarned = false;
  lastFlipTurn = 0;
  state = "playing";
  setScreen();
  audio.sfx("click");
}

function endRun(reason) {
  if (state === "over") return;
  state = "over";
  overReason = reason;
  audio.stopEngine();
  audio.sfx(reason === "fuel" ? "dry" : "crash");

  const dist = Math.max(0, Math.round(runDistance));
  const prevBest = bestOf(stage.id);
  const record = dist > prevBest;
  if (record) setBest(stage.id, dist);
  coins += runCoins;
  saveHighScore(storeKey("coins"), coins);

  el("over-reason").textContent = reason === "fuel" ? "Out of fuel" : "Broken neck";
  el("final-dist").textContent = dist;
  el("final-coins").textContent = runCoins;
  el("final-air").textContent = `${bestAir.toFixed(1)}s`;
  el("final-flips").textContent = flips;
  el("final-best").textContent = `${Math.max(dist, prevBest)}m`;
  el("verdict").textContent = record
    ? "New stage record."
    : verdictFor(dist, prevBest);

  // Anything newly unlocked is worth saying out loud.
  const newly = STAGES.find((s) => s.unlockAt > 0 && prevBest < s.unlockAt && dist >= s.unlockAt);
  if (newly) showToast(toastEl, `${newly.name} unlocked!`, 1800);

  setScreen();
}

function verdictFor(dist, best) {
  const gap = best - dist;
  if (best > 0 && gap <= 25) return `${gap}m short of your best.`;
  if (dist < 120) return "Barely left the yard.";
  if (dist < 400) return "Warming up.";
  if (dist < 900) return "Solid run.";
  return "That was a proper drive.";
}

function quitRun() {
  state = "menu";
  audio.stopEngine();
  coins += runCoins;
  runCoins = 0;
  saveHighScore(storeKey("coins"), coins);
  previewStage();
  renderStages();
  setScreen();
}

/** Single place that decides which chrome is visible for the current state. */
function setScreen() {
  menuOverlay.hidden = state !== "menu";
  garageOverlay.hidden = state !== "garage";
  pauseOverlay.hidden = state !== "paused";
  overOverlay.hidden = state !== "over";
  const live = state === "playing" || state === "paused";
  hud.hidden = !live;
  gauges.hidden = !live;
  controls.hidden = !live;
  pauseBtn.hidden = state !== "playing";
  if (state === "menu") {
    renderStages();
    el("wallet-value").textContent = coins;
  }
  if (state === "garage") renderGarage();
  if (state === "paused") {
    el("pause-stage").textContent = stage.name;
    el("pause-dist").textContent = `${Math.round(runDistance)}m`;
    el("pause-coins").textContent = runCoins;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function bindPad(btn, key) {
  const down = (e) => {
    e.preventDefault();
    audio.unlock();
    input[key] = true;
    btn.classList.add("on");
  };
  const up = (e) => {
    e.preventDefault();
    input[key] = false;
    btn.classList.remove("on");
  };
  btn.addEventListener("pointerdown", down, { passive: false });
  btn.addEventListener("pointerup", up, { passive: false });
  btn.addEventListener("pointercancel", up, { passive: false });
  btn.addEventListener("pointerleave", up, { passive: false });
}

bindPad(el("gas-btn"), "gas");
bindPad(el("brake-btn"), "brake");

// Split-screen fallback: dragging anywhere on the canvas works as two pads,
// which is how most players will instinctively try to drive.
canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (state !== "playing") return;
    audio.unlock();
    const right = e.clientX > window.innerWidth / 2;
    input[right ? "gas" : "brake"] = true;
    canvas.setPointerCapture(e.pointerId);
  },
  { passive: false }
);
const releaseCanvas = () => {
  input.gas = false;
  input.brake = false;
};
canvas.addEventListener("pointerup", releaseCanvas);
canvas.addEventListener("pointercancel", releaseCanvas);

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "arrowright" || k === "d" || k === " ") {
    input.gas = true;
    e.preventDefault();
  }
  if (k === "arrowleft" || k === "a") {
    input.brake = true;
    e.preventDefault();
  }
  if (k === "escape" || k === "p") togglePause();
  if (k === "enter" && (state === "over" || state === "menu")) startRun();
  if (k === "m") toggleMute();
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "arrowright" || k === "d" || k === " ") input.gas = false;
  if (k === "arrowleft" || k === "a") input.brake = false;
});

function togglePause() {
  if (state === "playing") {
    state = "paused";
    audio.stopEngine();
  } else if (state === "paused") {
    state = "playing";
  } else return;
  setScreen();
}

function toggleMute() {
  const m = audio.toggleMute();
  muteBtn.classList.toggle("muted", m);
  muteBtn.setAttribute("aria-label", m ? "Unmute" : "Mute");
}
muteBtn.classList.toggle("muted", audio.muted);
muteBtn.addEventListener("click", toggleMute);
pauseBtn.addEventListener("click", togglePause);

el("start-btn").addEventListener("click", startRun);
el("retry-btn").addEventListener("click", startRun);
el("garage-btn").addEventListener("click", () => {
  audio.unlock();
  audio.sfx("click");
  state = "garage";
  setScreen();
});
el("over-garage").addEventListener("click", () => {
  state = "garage";
  setScreen();
});
el("over-stages").addEventListener("click", () => {
  state = "menu";
  previewStage();
  setScreen();
});
el("garage-back").addEventListener("click", () => {
  audio.sfx("click");
  state = "menu";
  setScreen();
});
el("garage-drive").addEventListener("click", startRun);
el("resume-btn").addEventListener("click", togglePause);
el("quit-btn").addEventListener("click", quitRun);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") togglePause();
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function collectPickups() {
  const reach = 1.25;
  for (const it of pickups.items) {
    if (it.taken || Math.abs(it.x - car.x) > 3) continue;
    if (Math.hypot(it.x - car.x, it.y - car.y) > reach) continue;
    it.taken = true;
    if (it.kind === "coin") {
      runCoins += COIN_VALUE;
      audio.sfx("coin");
      pop(fx, it.x, it.y + 0.4, `+${COIN_VALUE}`, "#ffd166");
      sparks(fx, it.x, it.y, 6, "#ffd166");
    } else {
      fuel = Math.min(FUEL_MAX * tuningFrom(levels).fuel, fuel + FUEL_PICKUP);
      lowFuelWarned = false;
      audio.sfx("fuel");
      pop(fx, it.x, it.y + 0.5, "+FUEL", "#5ee6c8");
      flash(fx, "#5ee6c8", 0.18);
    }
  }
}

/** Airtime and flips are the run's style points; both pay coins. */
function scoreAerials() {
  if (car.airTime > 0.01) {
    const turns = Math.abs(car.flipTurns);
    if (turns >= lastFlipTurn + 1) {
      lastFlipTurn = Math.floor(turns);
      flips++;
      runCoins += FLIP_BONUS;
      audio.sfx("flip");
      pop(fx, car.x, car.y + 1.6, `FLIP +${FLIP_BONUS}`, "#a06bff", true);
    }
  }
  if (car.landed) {
    const air = car.landed;
    car.landed = 0;
    lastFlipTurn = 0;
    bestAir = Math.max(bestAir, air);
    const bonus = Math.round(air * AIR_BONUS);
    if (air > 0.8) {
      runCoins += bonus;
      pop(fx, car.x, car.y + 1.4, `AIR ${air.toFixed(1)}s +${bonus}`, "#5ee6c8");
    }
    audio.sfx(air > 1.4 ? "bigland" : "land");
    shake(fx, Math.min(0.9, air * 0.45));
    for (const w of car.wheels) dirt(fx, w.x, w.y - WHEEL.r, 0, Math.min(1, air), stage.theme.soil);
  }
}

function driveInput() {
  // Gas and brake on the same axis: holding both is a burnout, holding brake
  // alone reverses once the car has stopped — the genre's rocking technique.
  let throttle = 0;
  if (input.gas) throttle += 1;
  if (input.brake) throttle -= 1;
  const rolling = car.vx > 1.2;
  return { throttle, brake: input.brake && rolling };
}

function update(dt) {
  time += dt;
  updateFx(fx, dt);

  if (state === "menu" || state === "garage") {
    // Slow drift over the landscape behind the panels.
    camX += dt * 3.4;
    camY += (terrain.groundY(camX) + 2.4 - camY) * Math.min(1, dt * 3);
    pickups.ensure(camX);
    terrain.prune(camX - 40);
    return;
  }
  if (state === "paused" || !car) return;

  const driving = state === "playing" && !car.crashed && fuel > 0;
  const cmd = driving ? driveInput() : { throttle: 0, brake: state === "over" };

  stepVehicle(car, terrain, stage, cmd, dt);
  pickups.ensure(car.x);
  pickups.prune(car.x);
  terrain.prune(car.x);

  if (state === "playing") {
    runDistance = Math.max(runDistance, car.x - 6);
    collectPickups();
    scoreAerials();

    // Fuel burn, and a single warning as the tank runs low.
    if (fuel > 0) {
      fuel -= (FUEL_IDLE + Math.abs(cmd.throttle) * FUEL_GAS) * dt;
      if (fuel <= 22 && !lowFuelWarned) {
        lowFuelWarned = true;
        audio.sfx("warn");
        showToast(toastEl, "Low fuel", 1100);
      }
      if (fuel <= 0) {
        fuel = 0;
        audio.sfx("dry");
        showToast(toastEl, "Out of fuel", 1400);
      }
    }

    // Wheelspin dust and exhaust smoke.
    for (const w of car.wheels) {
      if (w.onGround && Math.abs(w.slip) > 0.12) {
        dirt(fx, w.x, w.y - WHEEL.r * 0.8, Math.sign(w.slip) || 1, Math.abs(w.slip), stage.theme.soil);
      }
    }
    smokeTimer -= dt;
    if (smokeTimer <= 0 && driving) {
      smokeTimer = 0.09 + (cmd.throttle !== 0 ? 0 : 0.22);
      smoke(fx, car.x - 1.15, car.y - 0.1, car.vx);
    }

    audio.engine(car.engineRpm, cmd.throttle !== 0 ? 1 : 0.25, Math.abs(car.wheels[0].slip), driving);

    if (car.crashed) {
      audio.stopEngine();
      shake(fx, 1);
      flash(fx, "#ff5d8f", 0.3);
      sparks(fx, car.x, car.y + 0.8, 16, "#ff5d8f");
      crashTimer = 1.1;
      state = "crashing";
    } else if (fuel <= 0 && Math.abs(car.vx) < 0.35 && car.grounded) {
      dryTimer += dt;
      if (dryTimer > 0.9) endRun("fuel");
    } else {
      dryTimer = 0;
    }
  } else if (state === "crashing") {
    crashTimer -= dt;
    if (crashTimer <= 0) endRun("neck");
  }

  // Camera: lead the car, pull back with speed, and settle softly.
  const lead = Math.min(4.5, car.vx * 0.42);
  const targetX = car.x + lead;
  const targetY = car.y + 0.9;
  camX += (targetX - camX) * Math.min(1, dt * 6);
  camY += (targetY - camY) * Math.min(1, dt * 4);
  renderer.setZoom(1 - Math.min(0.26, Math.max(0, car.speed - 8) * 0.016));
}

// ---------------------------------------------------------------------------
// HUD + render
// ---------------------------------------------------------------------------

let hudTick = 0;

function updateHud(dt) {
  hudTick -= dt;
  if (hudTick > 0) return;
  hudTick = 0.08;
  el("dist-value").innerHTML = `${Math.round(runDistance)}<small>m</small>`;
  el("best-value").innerHTML = `${bestOf(stage.id)}<small>m</small>`;
  el("coin-value").textContent = runCoins;
  el("speed-value").textContent = car ? Math.round(Math.abs(car.vx) * 3.6) : 0;
  const maxFuel = FUEL_MAX * tuningFrom(levels).fuel;
  const pct = Math.max(0, Math.min(1, fuel / maxFuel));
  const fill = el("fuel-fill");
  fill.style.width = `${pct * 100}%`;
  fill.classList.toggle("warn", pct <= 0.3 && pct > 0.12);
  fill.classList.toggle("crit", pct <= 0.12);

  // Airtime readout, live while flying.
  const flying = car && car.airTime > 0.45 && state === "playing";
  airBanner.classList.toggle("on", !!flying);
  if (flying) {
    el("air-time").textContent = `${car.airTime.toFixed(1)}s`;
    el("air-label").textContent = Math.abs(car.flipTurns) > 0.45 ? "FLIPPING" : "AIRTIME";
  }
}

function render() {
  renderer.setCamera(camX, camY);
  renderer.draw({
    terrain,
    stage,
    car: state === "menu" || state === "garage" ? null : car,
    pickups,
    fx,
    time,
    showMarkers: state !== "menu" && state !== "garage",
  });
}

previewStage();
setScreen();
renderStages();

createLoop({
  update(dt) {
    update(dt);
    updateHud(dt);
  },
  render,
}).start();
