// main.js — boot and orchestration for Hill Climb: the state machine, level
// and stage select, garage, HUD, camera and the glue between input, physics,
// sound and FX. Everything simulation-shaped lives in vehicle.js / terrain.js;
// this file decides when a run starts, what it costs and what it pays out.

import {
  lockViewport,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
  showToast,
} from "../../shared/game-utils.js";
import { STAGES, getStage, storeKey } from "./stages.js";
import { LEVELS, getLevel, levelsOf, levelAfter, coinValueOf } from "./levels.js";
import { createTerrain, createPickups } from "./terrain.js";
import { createVehicle, stepVehicle, hazardHit } from "./vehicle.js";
import { VEHICLES, getVehicle } from "./vehicles.js";
import { createRenderer } from "./render.js";
import { createFx, updateFx, clearFx, dirt, smoke, sparks, pop, shake, flash } from "./fx.js";
import { createAudio } from "./audio.js";
import { PARTS, MAX_LEVEL, nextCost, tuningFrom, emptyLevels } from "./upgrades.js";
import { FUEL, COIN_VALUE, AIR_BONUS, FLIP_BONUS } from "./rules.js";

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

const FUEL_MAX = FUEL.max;
const STAR_COINS = 0.6; // share of a level's coins that earns the second star

// --- persistent state -------------------------------------------------------
const LEVEL_KEYS = PARTS.map((p) => p.id);

const hasKey = (k) => {
  try {
    return localStorage.getItem(storeKey(k)) != null;
  } catch {
    return false;
  }
};

/** Upgrade levels of one car. Saves from before the garage had several cars
 * stored the buggy's upgrades without a car id; those carry over. */
function loadLevels(vid) {
  const out = emptyLevels();
  for (const id of LEVEL_KEYS) {
    const key = `up:${vid}:${id}`;
    const legacy = vid === "buggy" && !hasKey(key) ? loadHighScore(storeKey(`up:${id}`), 0) : 0;
    out[id] = Math.min(MAX_LEVEL, loadHighScore(storeKey(key), legacy));
  }
  return out;
}
const saveLevel = (vid, id, v) => saveHighScore(storeKey(`up:${vid}:${id}`), v);
const garageLevels = Object.fromEntries(VEHICLES.map((v) => [v.id, loadLevels(v.id)]));
const owns = (v) => v.price === 0 || loadHighScore(storeKey(`own:${v.id}`), 0) > 0;

let coins = loadHighScore(storeKey("coins"), 0);
const bestOf = (id) => loadHighScore(storeKey(`best:${id}`), 0);
const setBest = (id, v) => saveHighScore(storeKey(`best:${id}`), Math.round(v));
const lifetimeBest = () => STAGES.reduce((m, s) => Math.max(m, bestOf(s.id)), 0);

const readPref = (k, d) => {
  try {
    return localStorage.getItem(storeKey(k)) || d;
  } catch {
    return d;
  }
};
const writePref = (k, v) => {
  try {
    localStorage.setItem(storeKey(k), v);
  } catch {
    // ignore — private browsing
  }
};

// Campaign progress: stars (0..3) and best time per level.
const starsOf = (lvl) => loadHighScore(storeKey(`lv:${lvl.id}`), 0);
const bestTimeOf = (lvl) => loadHighScore(storeKey(`lvt:${lvl.id}`), 0);
const isLevelOpen = (lvl) => {
  const i = LEVELS.indexOf(lvl);
  return i === 0 || starsOf(LEVELS[i - 1]) > 0;
};
const totalStars = () => LEVELS.reduce((n, l) => n + starsOf(l), 0);
/** Endless stages open with the world's first level, or the old distance rule. */
const isStageOpen = (s) => lifetimeBest() >= s.unlockAt || isLevelOpen(levelsOf(s.id)[0]);

let mode = readPref("mode", "levels") === "endless" ? "endless" : "levels";
let stageId = readPref("stage", STAGES[0].id);
if (!isStageOpen(getStage(stageId))) stageId = STAGES[0].id;
/** Default to the first level that still has no star — where the player is. */
const frontier = () => LEVELS.find((l) => isLevelOpen(l) && starsOf(l) === 0) || LEVELS[LEVELS.length - 1];
let levelId = readPref("level", frontier().id);
if (!getLevel(levelId) || !isLevelOpen(getLevel(levelId))) levelId = frontier().id;
let worldView = getLevel(levelId).world;

let vehicleId = readPref("vehicle", VEHICLES[0].id);
if (!owns(getVehicle(vehicleId))) vehicleId = VEHICLES[0].id;
let garageView = vehicleId; // the car shown in the garage, owned or not
const currentSpec = () => getVehicle(vehicleId);
const currentTune = () => tuningFrom(currentSpec(), garageLevels[vehicleId]);

// --- run state --------------------------------------------------------------
let state = "menu"; // menu | garage | playing | crashing | finishing | paused | over
let level = null; // the campaign level being driven, or null in endless
let stage = getStage(mode === "levels" ? getLevel(levelId).world : stageId);
let terrain = null;
let pickups = null;
let car = null;
let fuel = FUEL_MAX;
let fuelMax = FUEL_MAX;
let coinValue = COIN_VALUE;
let runCoins = 0;
let coinsTaken = 0;
let runDistance = 0;
let runTime = 0;
let bestAir = 0;
let flips = 0;
let time = 0;
let camX = 0;
let camY = 0;
let crashTimer = 0;
let finishTimer = 0;
let deathReason = "neck";
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

function selectMode(m) {
  mode = m;
  writePref("mode", m);
  stage = getStage(mode === "levels" ? getLevel(levelId).world : stageId);
  renderMenu();
  previewStage();
}

function renderMenu() {
  for (const b of document.querySelectorAll(".mode-tab")) b.classList.toggle("on", b.dataset.mode === mode);
  el("levels-view").hidden = mode !== "levels";
  el("endless-view").hidden = mode !== "endless";
  el("star-total").textContent = `${totalStars()}/${LEVELS.length * 3}★`;
  el("wallet-value").textContent = coins;
  if (mode === "levels") {
    renderWorlds();
    renderLevels();
    const lvl = getLevel(levelId);
    el("start-btn").textContent = `Play ${lvl.number}`;
  } else {
    renderStages();
    el("start-btn").textContent = "Start Engine";
  }
}

const starString = (n) => "★".repeat(n) + "☆".repeat(3 - n);

function renderWorlds() {
  const wrap = el("world-tabs");
  wrap.innerHTML = "";
  STAGES.forEach((s, w) => {
    const lvls = levelsOf(s.id);
    const open = isLevelOpen(lvls[0]);
    const got = lvls.reduce((n, l) => n + starsOf(l), 0);
    const b = document.createElement("button");
    b.className = "world-tab" + (s.id === worldView ? " on" : "") + (open ? "" : " locked");
    b.style.setProperty("--st-a", s.theme.sky0);
    b.style.setProperty("--st-b", s.theme.crust);
    b.style.setProperty("--st-glow", s.theme.accent);
    b.innerHTML = `<span class="wt-num">${w + 1}</span><span class="wt-name">${s.name}</span><span class="wt-stars">${open ? `${got}/18★` : "🔒"}</span>`;
    b.disabled = !open;
    b.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      worldView = s.id;
      // Jump to the furthest open level in that world.
      const pick = [...lvls].reverse().find((l) => isLevelOpen(l)) || lvls[0];
      chooseLevel(pick);
    });
    wrap.appendChild(b);
  });
  const on = wrap.querySelector(".on");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderLevels() {
  const grid = el("level-grid");
  grid.innerHTML = "";
  const world = getStage(worldView);
  grid.style.setProperty("--st-glow", world.theme.accent);
  for (const lvl of levelsOf(worldView)) {
    const open = isLevelOpen(lvl);
    const stars = starsOf(lvl);
    const best = bestTimeOf(lvl);
    const tile = document.createElement("button");
    tile.className = "level-tile" + (lvl.id === levelId ? " on" : "") + (open ? "" : " locked") + (stars ? " done" : "");
    tile.innerHTML = `
      <span class="lt-num">${lvl.number}</span>
      <span class="lt-name">${lvl.name}</span>
      <span class="lt-stars">${open ? starString(stars) : "🔒"}</span>
      <span class="lt-meta">${open ? `${lvl.length}m · ${best ? fmtTime(best) : `par ${fmtTime(lvl.par)}`}` : "Finish the one before"}</span>
    `;
    tile.disabled = !open;
    tile.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      if (lvl.id === levelId && state === "menu") return startRun();
      chooseLevel(lvl);
    });
    grid.appendChild(tile);
  }
}

function chooseLevel(lvl) {
  levelId = lvl.id;
  worldView = lvl.world;
  writePref("level", levelId);
  stage = getStage(lvl.world);
  renderMenu();
  previewStage();
}

function renderStages() {
  const grid = el("stage-grid");
  grid.innerHTML = "";
  for (const s of STAGES) {
    const unlocked = isStageOpen(s);
    const card = document.createElement("button");
    card.className = "stage-card" + (s.id === stageId ? " on" : "") + (unlocked ? "" : " locked");
    card.style.setProperty("--st-a", s.theme.sky0);
    card.style.setProperty("--st-b", s.theme.crust);
    card.style.setProperty("--st-glow", s.theme.accent);
    card.innerHTML = `
      <span class="st-name">${s.name}</span>
      <span class="st-blurb">${unlocked ? s.blurb : "Reach this world in the levels to unlock"}</span>
      <span class="st-best">${unlocked ? `Best ${bestOf(s.id)}m` : "🔒 Locked"}</span>
    `;
    card.disabled = !unlocked;
    card.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      stageId = s.id;
      stage = getStage(stageId);
      writePref("stage", stageId);
      renderStages();
      previewStage();
    });
    grid.appendChild(card);
  }
}

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(0).padStart(2, "0")}` : `${r.toFixed(1)}s`;
};

/** 0..1 bars for the garage card, relative to the best stock car. */
function statBars(spec) {
  const top = (v) => (v.fade * v.wheel.r) / 0.42; // wheel speed at half torque
  const max = (f) => Math.max(...VEHICLES.map(f));
  return [
    ["Power", (spec.power / spec.chassis.mass) / max((v) => v.power / v.chassis.mass)],
    ["Speed", top(spec) / max(top)],
    ["Grip", (spec.grip * (1 + spec.awd * 0.6)) / max((v) => v.grip * (1 + v.awd * 0.6))],
    ["Fuel", spec.fuel / max((v) => v.fuel)],
  ];
}

function renderGarage() {
  el("garage-wallet").textContent = coins;
  el("wallet-value").textContent = coins;

  const cars = el("vehicles");
  cars.innerHTML = "";
  for (const v of VEHICLES) {
    const owned = owns(v);
    const card = document.createElement("button");
    card.className = "vehicle" + (v.id === garageView ? " on" : "") + (v.id === vehicleId ? " driving" : "") + (owned ? "" : " locked");
    card.style.setProperty("--v-a", v.look.accent);
    card.style.setProperty("--v-b", v.look.body[2]);
    card.innerHTML = `
      <span class="v-icon">${v.icon}</span>
      <span class="v-name">${v.name}</span>
      <span class="v-tag">${v.id === vehicleId ? "Driving" : owned ? "Owned" : `🪙 ${v.price.toLocaleString()}`}</span>
    `;
    card.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      garageView = v.id;
      renderGarage();
    });
    cars.appendChild(card);
  }

  const spec = getVehicle(garageView);
  const owned = owns(spec);
  const lv = garageLevels[spec.id];
  const detail = el("vehicle-detail");
  detail.style.setProperty("--v-a", spec.look.accent);
  detail.innerHTML = `
    <div class="vd-head">
      <span class="vd-icon">${spec.icon}</span>
      <div><b>${spec.name}</b><span class="vd-blurb">${spec.blurb}</span></div>
    </div>
    <div class="vd-stats">${statBars(spec)
      .map(([k, f]) => `<span class="vd-stat"><i>${k}</i><em><s style="width:${Math.round(f * 100)}%"></s></em></span>`)
      .join("")}</div>
    <button class="btn vd-action ${owned ? (spec.id === vehicleId ? "btn--ghost" : "btn--primary") : coins >= spec.price ? "btn--primary" : "btn--ghost"}" id="vd-action">
      ${owned ? (spec.id === vehicleId ? "✓ Driving this" : "Drive this") : `Buy for 🪙 ${spec.price.toLocaleString()}`}
    </button>
  `;
  el("vd-action").addEventListener("click", () => {
    audio.unlock();
    if (!owned) {
      if (coins < spec.price) {
        audio.sfx("deny");
        showToast(toastEl, `Need ${(spec.price - coins).toLocaleString()} more coins`);
        return;
      }
      coins -= spec.price;
      saveHighScore(storeKey("coins"), coins);
      saveHighScore(storeKey(`own:${spec.id}`), 1);
      audio.sfx("buy");
      showToast(toastEl, `${spec.name} unlocked!`, 1500);
    } else audio.sfx("click");
    vehicleId = spec.id;
    writePref("vehicle", vehicleId);
    renderGarage();
  });

  const wrap = el("parts");
  wrap.innerHTML = "";
  wrap.classList.toggle("locked", !owned);
  for (const part of PARTS) {
    const lvl = lv[part.id] | 0;
    const cost = nextCost(part, lvl, spec);
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
      <button class="buy" ${cost == null || !owned ? "disabled" : ""}>${cost == null ? "MAX" : `🪙 ${cost.toLocaleString()}`}</button>
    `;
    const buy = row.querySelector(".buy");
    if (cost != null && owned) {
      buy.classList.toggle("afford", coins >= cost);
      buy.addEventListener("click", () => {
        audio.unlock();
        if (coins < cost) {
          audio.sfx("deny");
          showToast(toastEl, "Not enough coins");
          return;
        }
        coins -= cost;
        lv[part.id] = lvl + 1;
        saveLevel(spec.id, part.id, lv[part.id]);
        saveHighScore(storeKey("coins"), coins);
        audio.sfx("buy");
        renderGarage();
      });
    }
    wrap.appendChild(row);
  }
  el("parts-title").textContent = owned ? `${spec.name} upgrades` : `Buy the ${spec.name} to upgrade it`;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Build a fresh world; `withCar` false leaves the car out (menu backdrop). */
function buildWorld(withCar) {
  level = mode === "levels" ? getLevel(levelId) : null;
  stage = getStage(level ? level.world : stageId);
  terrain = level ? createTerrain(stage, level.seed, level) : createTerrain(stage);
  pickups = createPickups(terrain, terrain.seed);
  car = withCar ? createVehicle(terrain, currentSpec(), currentTune()) : null;
  coinValue = level ? level.coinValue : coinValueOf(STAGES.indexOf(stage));
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
  fuelMax = FUEL_MAX * currentTune().fuel;
  fuel = fuelMax;
  runCoins = 0;
  coinsTaken = 0;
  runDistance = 0;
  runTime = 0;
  bestAir = 0;
  flips = 0;
  crashTimer = 0;
  finishTimer = 0;
  dryTimer = 0;
  lowFuelWarned = false;
  lastFlipTurn = 0;
  state = "playing";
  setScreen();
  audio.sfx("click");
  if (level) showToast(toastEl, `${level.number} · ${level.name}`, 1300);
}

const REASONS = {
  fuel: "Out of fuel",
  neck: "Broken neck",
  water: "Took a swim",
  swamp: "Swallowed by the bog",
  icewater: "Through the ice",
  spikes: "Spiked",
  lava: "Melted",
  void: "Lost in space",
};

function endRun(reason) {
  if (state === "over") return;
  state = "over";
  audio.stopEngine();
  audio.sfx(reason === "fuel" ? "dry" : "crash");
  coins += runCoins;
  saveHighScore(storeKey("coins"), coins);

  el("over-reason").textContent = REASONS[reason] || "Run over";
  el("over-reason").classList.add("eyebrow--warn");
  el("over-title").textContent = level ? "Try again" : "Run over";
  el("final-stars").hidden = true;
  el("star-goals").hidden = true;
  el("next-btn").hidden = true;
  el("retry-btn").textContent = "Run It Back";
  el("retry-btn").classList.add("btn--primary");
  el("retry-btn").classList.remove("btn--ghost");
  el("final-coins").textContent = runCoins;
  el("final-air").textContent = `${bestAir.toFixed(1)}s`;
  el("final-flips").textContent = flips;

  const dist = Math.max(0, Math.round(runDistance));
  if (level) {
    el("final-dist").textContent = Math.round((Math.min(dist, level.length) / level.length) * 100);
    el("final-unit").textContent = "%";
    el("final-best").textContent = `${dist}/${level.length}m`;
    el("final-best-label").textContent = "Distance";
    el("verdict").textContent =
      dist > level.length * 0.8 ? "So close. The flag was right there." : dist > level.length * 0.4 ? "Past halfway. Again!" : "Upgrades in the garage help.";
  } else {
    const prevBest = bestOf(stage.id);
    const record = dist > prevBest;
    if (record) setBest(stage.id, dist);
    el("final-dist").textContent = dist;
    el("final-unit").textContent = "m";
    el("final-best").textContent = `${Math.max(dist, prevBest)}m`;
    el("final-best-label").textContent = "Stage best";
    el("verdict").textContent = record ? "New stage record." : verdictFor(dist, prevBest);
  }
  setScreen();
}

/** A level's finish line was crossed: stars, rewards and the results panel. */
function finishLevel() {
  state = "over";
  audio.stopEngine();
  const lvl = level;
  const t = runTime;
  const coinShare = pickups.total ? coinsTaken / pickups.total : 1;
  const earned = [true, coinShare >= STAR_COINS, t <= lvl.par];
  const stars = earned.filter(Boolean).length;
  const prevStars = starsOf(lvl);
  const firstClear = prevStars === 0;
  const reward = firstClear ? lvl.reward : Math.round(lvl.reward * 0.25);
  runCoins += reward;
  coins += runCoins;
  saveHighScore(storeKey("coins"), coins);
  if (stars > prevStars) saveHighScore(storeKey(`lv:${lvl.id}`), stars);
  const prevTime = bestTimeOf(lvl);
  if (!prevTime || t < prevTime) saveHighScore(storeKey(`lvt:${lvl.id}`), Math.round(t * 10) / 10);

  el("over-reason").textContent = `${lvl.number} · ${lvl.name}`;
  el("over-reason").classList.remove("eyebrow--warn");
  el("over-title").textContent = "Finish!";
  const starsEl = el("final-stars");
  starsEl.hidden = false;
  starsEl.innerHTML = [0, 1, 2].map((i) => `<i class="${i < stars ? "on" : ""}" style="--d:${i * 0.18}s">★</i>`).join("");
  el("final-dist").textContent = fmtTime(t);
  el("final-unit").textContent = "";
  el("final-coins").textContent = runCoins;
  el("final-air").textContent = `${bestAir.toFixed(1)}s`;
  el("final-flips").textContent = flips;
  el("final-best").textContent = fmtTime(prevTime ? Math.min(prevTime, t) : t);
  el("final-best-label").textContent = "Best time";
  const goals = el("star-goals");
  goals.hidden = false;
  goals.innerHTML = [
    ["Reach the finish", true],
    [`Collect ${Math.round(STAR_COINS * 100)}% of the coins (${coinsTaken}/${pickups.total})`, earned[1]],
    [`Beat par ${fmtTime(lvl.par)}`, earned[2]],
  ]
    .map(([text, ok]) => `<li class="${ok ? "ok" : ""}"><b>${ok ? "★" : "☆"}</b>${text}</li>`)
    .join("");
  el("verdict").textContent = firstClear ? `Level cleared! +${reward} coin bonus.` : stars > prevStars ? `New star! +${reward} coins.` : `+${reward} coins.`;
  const next = levelAfter(lvl);
  el("next-btn").hidden = !next;
  el("retry-btn").textContent = "Replay";
  el("retry-btn").classList.toggle("btn--primary", !next);
  el("retry-btn").classList.toggle("btn--ghost", !!next);
  audio.sfx("finish");
  for (let i = 0; i < stars; i++) setTimeout(() => audio.sfx("star"), 350 + i * 180);
  if (next && next.index === 0 && firstClear) showToast(toastEl, `${getStage(next.world).name} unlocked!`, 1800);
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
  setScreen();
}

/** Single place that decides which chrome is visible for the current state. */
function setScreen() {
  menuOverlay.hidden = state !== "menu";
  garageOverlay.hidden = state !== "garage";
  pauseOverlay.hidden = state !== "paused";
  overOverlay.hidden = state !== "over";
  const live = state === "playing" || state === "paused" || state === "finishing" || state === "crashing";
  hud.hidden = !live;
  gauges.hidden = !live;
  controls.hidden = !live;
  el("progress").hidden = !live || !level;
  el("best-label").textContent = level ? "Time" : "Best";
  pauseBtn.hidden = state !== "playing";
  if (state === "menu") renderMenu();
  if (state === "garage") renderGarage();
  if (state === "paused") {
    el("pause-stage").textContent = level ? `${level.number} ${level.name}` : stage.name;
    el("pause-dist").textContent = level ? `${Math.round(runDistance)}/${level.length}m` : `${Math.round(runDistance)}m`;
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
  if (k === "enter" && (state === "over" || state === "menu")) {
    if (state === "over" && !el("next-btn").hidden) el("next-btn").click();
    else startRun();
  }
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
el("next-btn").addEventListener("click", () => {
  const next = level && levelAfter(level);
  if (!next) return;
  levelId = next.id;
  worldView = next.world;
  writePref("level", levelId);
  startRun();
});
for (const b of document.querySelectorAll(".mode-tab")) {
  b.addEventListener("click", () => {
    audio.unlock();
    audio.sfx("click");
    selectMode(b.dataset.mode);
  });
}
el("garage-btn").addEventListener("click", () => {
  audio.unlock();
  audio.sfx("click");
  garageView = vehicleId;
  state = "garage";
  setScreen();
});
el("over-garage").addEventListener("click", () => {
  garageView = vehicleId;
  state = "garage";
  setScreen();
});
el("over-stages").addEventListener("click", () => {
  state = "menu";
  // After a clear, the menu opens on whatever comes next.
  if (level && starsOf(level) > 0 && levelAfter(level) && isLevelOpen(levelAfter(level))) {
    levelId = levelAfter(level).id;
    worldView = getLevel(levelId).world;
    writePref("level", levelId);
  }
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
      runCoins += coinValue;
      coinsTaken++;
      audio.sfx("coin");
      pop(fx, it.x, it.y + 0.4, `+${coinValue}`, "#ffd166");
      sparks(fx, it.x, it.y, 6, "#ffd166");
    } else {
      fuel = Math.min(fuelMax, fuel + FUEL.pickup * fuelMax);
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
    for (const w of car.wheels) dirt(fx, w.x, w.y - car.spec.wheel.r, 0, Math.min(1, air), dustColor());
  }
}

/** What the wheels throw up: soil under grass, the surface itself elsewhere. */
const dustColor = () => (stage.theme.grass ? stage.theme.soil : stage.theme.crust);

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
  const stopping = state === "over" || state === "finishing";
  const cmd = driving ? driveInput() : { throttle: 0, brake: stopping && car.vx > 0.5 };

  stepVehicle(car, terrain, stage, cmd, dt);
  pickups.ensure(car.x);
  pickups.prune(car.x);
  terrain.prune(car.x);

  if (state === "playing") {
    runTime += dt;
    runDistance = Math.max(runDistance, car.x - 6);
    collectPickups();
    scoreAerials();

    // Fuel burn, and a single warning as the tank runs low.
    if (fuel > 0) {
      fuel -= (FUEL.idle + Math.abs(cmd.throttle) * FUEL.gas) * dt;
      if (fuel <= fuelMax * 0.2 && !lowFuelWarned) {
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
        dirt(fx, w.x, w.y - car.spec.wheel.r * 0.8, Math.sign(w.slip) || 1, Math.abs(w.slip), dustColor());
      }
    }
    smokeTimer -= dt;
    if (smokeTimer <= 0 && driving) {
      smokeTimer = 0.09 + (cmd.throttle !== 0 ? 0 : 0.22);
      const back = car.spec.chassis.w / 2 + 0.15;
      smoke(fx, car.x - Math.cos(car.angle) * back, car.y - Math.sin(car.angle) * back - 0.1, car.vx);
    }

    audio.engine(car.engineRpm, cmd.throttle !== 0 ? 1 : 0.25, Math.abs(car.wheels[0].slip), driving);

    const hz = hazardHit(car, terrain);
    if (level && car.x >= terrain.finishX) {
      // Over the line: confetti, coast to a stop, then the results.
      state = "finishing";
      finishTimer = 1.4;
      audio.stopEngine();
      flash(fx, "#ffffff", 0.25);
      for (const c of ["#ffd166", "#3ddc84", "#5ec8ff", "#ff5d8f"]) sparks(fx, car.x + 1, car.y + 2, 10, c);
    } else if (hz) {
      audio.stopEngine();
      shake(fx, 0.8);
      flash(fx, stage.theme.hazard.top, 0.35);
      sparks(fx, car.x, hz.surface + 0.3, 22, stage.theme.hazard.top);
      sparks(fx, car.x, hz.surface + 0.3, 10, "#ffffff");
      deathReason = hz.kind;
      crashTimer = 1.1;
      state = "crashing";
    } else if (car.crashed) {
      audio.stopEngine();
      shake(fx, 1);
      flash(fx, "#ff5d8f", 0.3);
      sparks(fx, car.x, car.y + 0.8, 16, "#ff5d8f");
      deathReason = "neck";
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
    if (crashTimer <= 0) endRun(deathReason);
  } else if (state === "finishing") {
    finishTimer -= dt;
    if (Math.random() < dt * 14) {
      const c = ["#ffd166", "#3ddc84", "#5ec8ff", "#ff5d8f"][Math.floor(Math.random() * 4)];
      sparks(fx, car.x + (Math.random() - 0.3) * 6, car.y + 3 + Math.random() * 2, 3, c);
    }
    if (finishTimer <= 0) finishLevel();
  }

  // Camera: lead the car, pull back with speed and with height so a big jump
  // still shows the landing, and settle softly.
  const height = Math.max(0, car.y - terrain.groundY(car.x) - 1);
  const lead = Math.max(-1, Math.min(3.2, car.vx * 0.3));
  const targetX = car.x + lead;
  const targetY = car.y + 0.5 - Math.min(2.5, height * 0.35);
  camX += (targetX - camX) * Math.min(1, dt * 6);
  camY += (targetY - camY) * Math.min(1, dt * (car.grounded ? 4 : 2.6));
  const pull = Math.max(0, car.speed - 8) * 0.016 + height * 0.035;
  renderer.setZoom(1 - Math.min(0.42, pull));
}

// ---------------------------------------------------------------------------
// HUD + render
// ---------------------------------------------------------------------------

let hudTick = 0;

function updateHud(dt) {
  hudTick -= dt;
  if (hudTick > 0) return;
  hudTick = 0.08;
  if (level) {
    el("dist-value").innerHTML = `${Math.round(runDistance)}<small>/${level.length}m</small>`;
    el("best-value").innerHTML = fmtTime(runTime).replace(/s$/, "<small>s</small>");
    el("best-value").classList.toggle("over-par", runTime > level.par);
    const f = Math.max(0, Math.min(1, runDistance / level.length));
    el("progress-fill").style.width = `${f * 100}%`;
    el("progress-car").style.left = `${f * 100}%`;
  } else {
    el("dist-value").innerHTML = `${Math.round(runDistance)}<small>m</small>`;
    el("best-value").innerHTML = `${bestOf(stage.id)}<small>m</small>`;
    el("best-value").classList.remove("over-par");
  }
  el("coin-value").textContent = runCoins;
  el("speed-value").textContent = car ? Math.round(Math.abs(car.vx) * 3.6) : 0;
  const pct = Math.max(0, Math.min(1, fuel / fuelMax));
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

createLoop({
  update(dt) {
    update(dt);
    updateHud(dt);
  },
  render,
}).start();
