// Wiring: menu, input, dock UI and the frame loop. The rules live in game.js —
// nothing here should decide what is legal, only what is shown and tapped.

import { createLoop, lockViewport, loadHighScore, onPointer, saveHighScore, showToast } from "../../shared/game-utils.js";
import { BLOONS, DIFFICULTIES, MAPS, WORLD } from "./config.js";
import { buildPath } from "./path.js";
import { ROUND_COUNT, roundPreview } from "./rounds.js";
import { TOWERS, TOWER_BY_ID, TOWER_RADIUS, nextUpgrade, sellValue, upgradeBlocked } from "./towers.js";
import { TARGET_MODES, buyUpgrade, canPlace, createGame, placeTower, sellTower, startRound, towerStats, update } from "./game.js";
import { drawBloons, drawProjectiles, drawRange, drawTower, drawTowers, invalidateMapLayer, paintMapInto } from "./render.js";
import { createFx, drawFx, handleEvent, updateFx } from "./fx.js";
import { isMuted, resumeAudio, setMuted, sfx } from "./audio.js";

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 2, 3];
const FIXED_DT = 1 / 60;
// Cap the backlog so a backgrounded tab does not resolve ten rounds at once.
const MAX_CATCHUP = 0.5;
const BEST_KEY = (map, diff) => `balloon-siege:best:${map}:${diff}`;

const canvas = $("game");
const ctx = canvas.getContext("2d");
const mapCanvas = $("map-layer");

let state = null;
let fx = createFx();
let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
let selection = { placing: null, tower: null, pointer: null, valid: false };
let speedIndex = 0;
let autoStart = false;
let paused = false;
let time = 0;
let autoTimer = 0;
let accumulator = 0;
let shopItems = [];
let livesChip = null;

let chosenMap = MAPS[0].id;
let chosenDiff = "normal";

// ------------------------------------------------------------- viewport ----

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  view.w = w;
  view.h = h;
  // Keep the whole playfield clear of the HUD and the round controls: both
  // float over the board, and a tower built underneath them is unreachable.
  const topInset = $("topbar-row").offsetHeight + 6;
  const bottomInset = $("round-controls").offsetHeight + 6;
  const avail = Math.max(1, h - topInset - bottomInset);
  view.scale = Math.min(w / WORLD.w, avail / WORLD.h);
  view.ox = (w - WORLD.w * view.scale) / 2;
  view.oy = topInset + (avail - WORLD.h * view.scale) / 2;
  view.dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  positionMapLayer();
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);

/** Line the static map layer up exactly with the letterboxed world rect. */
function positionMapLayer() {
  if (!state) return;
  mapCanvas.style.left = `${view.ox}px`;
  mapCanvas.style.top = `${view.oy}px`;
  paintMapInto(mapCanvas, state, WORLD.w * view.scale, WORLD.h * view.scale, view.dpr);
}

function toWorld(x, y) {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}

// ----------------------------------------------------------------- menu ----

/** Tiny map thumbnail so the player can see the track before committing. */
function drawThumb(cv, map) {
  const W = 180;
  const H = 180 * (WORLD.h / WORLD.w);
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  const s = W / WORLD.w;
  c.fillStyle = map.grass;
  c.fillRect(0, 0, W, H);
  const path = buildPath(map.points);
  c.beginPath();
  c.moveTo(path.points[0][0] * s, path.points[0][1] * s);
  for (let i = 1; i < path.points.length; i++) c.lineTo(path.points[i][0] * s, path.points[i][1] * s);
  c.lineWidth = 12 * s;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = map.track;
  c.stroke();
}

function buildMenu() {
  const grid = $("map-grid");
  grid.innerHTML = "";
  for (const map of MAPS) {
    const card = document.createElement("button");
    card.className = "map-card";
    card.type = "button";
    const cv = document.createElement("canvas");
    drawThumb(cv, map);
    card.append(cv);
    const name = document.createElement("span");
    name.className = "mc-name";
    name.textContent = map.name;
    const diff = document.createElement("span");
    diff.className = "mc-diff";
    diff.textContent = map.difficulty;
    const blurb = document.createElement("span");
    blurb.className = "mc-blurb";
    blurb.textContent = map.blurb;
    card.append(name, diff, blurb);
    card.addEventListener("click", () => {
      chosenMap = map.id;
      refreshMenu();
    });
    card.dataset.map = map.id;
    grid.append(card);
  }

  const row = $("diff-row");
  row.innerHTML = "";
  for (const d of DIFFICULTIES) {
    const card = document.createElement("button");
    card.className = "diff-card";
    card.type = "button";
    card.dataset.diff = d.id;
    card.innerHTML = `<span class="dc-name"></span><span class="dc-sub"></span>`;
    card.querySelector(".dc-name").textContent = d.name;
    card.querySelector(".dc-sub").textContent = `${d.lives} lives · $${d.cash}`;
    card.addEventListener("click", () => {
      chosenDiff = d.id;
      refreshMenu();
    });
    row.append(card);
  }
  refreshMenu();
}

function refreshMenu() {
  for (const el of document.querySelectorAll(".map-card")) {
    el.classList.toggle("selected", el.dataset.map === chosenMap);
  }
  for (const el of document.querySelectorAll(".diff-card")) {
    el.classList.toggle("selected", el.dataset.diff === chosenDiff);
  }
  const best = loadHighScore(BEST_KEY(chosenMap, chosenDiff), 0);
  $("best-line").textContent = best > 0 ? `Best on this map: round ${best}` : "No run here yet.";
}

// ----------------------------------------------------------------- shop ----

function buildShop() {
  const shop = $("shop");
  shop.innerHTML = "";
  for (const def of TOWERS) {
    const item = document.createElement("button");
    item.className = "shop-item";
    item.type = "button";
    item.dataset.tower = def.id;
    item.innerHTML = `<span class="si-icon"></span><span class="si-name"></span><span class="si-cost"></span>`;
    item.querySelector(".si-icon").textContent = def.icon;
    item.querySelector(".si-name").textContent = def.name;
    item.querySelector(".si-cost").textContent = `$${def.cost}`;
    item.addEventListener("click", () => {
      resumeAudio();
      if (selection.placing === def.id) {
        selection.placing = null;
      } else if (state.cash < def.cost) {
        sfx.denied();
        showToast($("toast"), "Not enough cash");
        return;
      } else {
        selection.placing = def.id;
        selection.tower = null;
      }
      refreshDock();
    });
    shop.append(item);
  }
  shopItems = [...shop.querySelectorAll(".shop-item")];
}

function refreshDock() {
  const inspecting = !!selection.tower;
  $("inspector").hidden = !inspecting;
  $("shop").hidden = inspecting;

  for (const el of shopItems) {
    const def = TOWER_BY_ID[el.dataset.tower];
    el.classList.toggle("selected", selection.placing === def.id);
    el.classList.toggle("poor", state.cash < def.cost);
  }

  $("hint-bar").hidden = !selection.placing;
  if (selection.placing) {
    $("hint-bar").textContent = `Tap a green spot to build the ${TOWER_BY_ID[selection.placing].name}`;
  }

  if (inspecting) refreshInspector();
}

function statLine(def, stats) {
  if (stats.support) return `Earns $${stats.income} at the end of every round`;
  const bits = [`DMG ${stats.damage}`, `Range ${Math.round(stats.range > 1000 ? 999 : stats.range)}`];
  if (stats.rate) bits.push(`${stats.rate.toFixed(1)}/s`);
  if (stats.pierce) bits.push(`Pierce ${stats.pierce}`);
  if (stats.camo) bits.push("Camo");
  return bits.join(" · ");
}

function refreshInspector() {
  const tower = selection.tower;
  if (!tower) return;
  const def = TOWER_BY_ID[tower.defId];
  const stats = towerStats(tower);

  $("insp-icon").textContent = def.icon;
  $("insp-name").textContent = def.name;
  $("insp-detail").textContent = statLine(def, stats);
  $("target-btn").textContent = tower.target[0].toUpperCase() + tower.target.slice(1);
  $("target-btn").disabled = !!stats.support;
  $("sell-btn").textContent = `Sell $${sellValue(def, tower.tiers)}`;

  for (let p = 0; p < 2; p++) {
    const btn = $(`up-${p}`);
    const up = nextUpgrade(def, tower.tiers, p);
    const blocked = upgradeBlocked(def, tower.tiers, p);
    $(`up-${p}-path`).textContent = `${def.paths[p].name} · ${tower.tiers[p]}/${def.paths[p].tiers.length}`;
    if (!up) {
      $(`up-${p}-name`).textContent = "Fully upgraded";
      $(`up-${p}-desc`).textContent = "";
      $(`up-${p}-cost`).textContent = "—";
      btn.disabled = true;
      btn.className = "upgrade";
      continue;
    }
    $(`up-${p}-name`).textContent = blocked ? "Path locked" : up.name;
    $(`up-${p}-desc`).textContent = blocked ? "You committed to the other path." : up.desc;
    $(`up-${p}-cost`).textContent = blocked ? "—" : `$${up.cost}`;
    const affordable = !blocked && state.cash >= up.cost;
    btn.disabled = !!blocked;
    btn.className = `upgrade${affordable ? " affordable" : ""}${!blocked && !affordable ? " too-dear" : ""}`;
  }
}

// ----------------------------------------------------------------- input ---

function handleTap(sx, sy) {
  resumeAudio();
  const { x, y } = toWorld(sx, sy);

  if (selection.placing) {
    if (canPlace(state, x, y) && placeTower(state, selection.placing, x, y)) {
      sfx.build();
      selection.placing = null;
    } else {
      sfx.denied();
      showToast($("toast"), state.cash < TOWER_BY_ID[selection.placing].cost ? "Not enough cash" : "Can't build there");
    }
    refreshDock();
    return;
  }

  const hit = state.towers.find((t) => Math.hypot(t.x - x, t.y - y) <= TOWER_RADIUS + 8);
  selection.tower = hit ?? null;
  refreshDock();
}

function bindInput() {
  lockViewport(canvas);
  onPointer(canvas, {
    onDown: (x, y) => {
      selection.pointer = toWorld(x, y);
      selection.valid = canPlace(state, selection.pointer.x, selection.pointer.y);
    },
    onMove: (x, y) => {
      if (!selection.placing) return;
      selection.pointer = toWorld(x, y);
      selection.valid = canPlace(state, selection.pointer.x, selection.pointer.y);
    },
    onUp: (x, y) => {
      handleTap(x, y);
      selection.pointer = null;
    },
  });
}

// ---------------------------------------------------------------- rounds ---

function refreshPreview() {
  const box = $("preview");
  box.innerHTML = "";
  if (state.phase !== "build") {
    resize();
    return;
  }
  for (const { type, camo } of roundPreview(state.round)) {
    const chip = document.createElement("span");
    chip.className = `pv${camo ? " camo" : ""}`;
    const dot = document.createElement("i");
    dot.style.background = BLOONS[type].color;
    chip.append(dot, document.createTextNode(camo ? `${type} camo` : type));
    box.append(chip);
  }
  resize();
}

const hudShown = { lives: null, cash: null, round: null, running: null, wave: null, poor: null };

function refreshHud() {
  if (hudShown.lives !== state.lives) {
    hudShown.lives = state.lives;
    $("lives-value").textContent = state.lives;
    livesChip.classList.toggle("low", state.lives <= 20);
  }
  if (hudShown.cash !== state.cash) {
    hudShown.cash = state.cash;
    $("cash-value").textContent = state.cash;
    refreshAffordability();
  }
  if (hudShown.round !== state.round) {
    hudShown.round = state.round;
    $("round-value").textContent = `${Math.min(state.round, ROUND_COUNT)}/${ROUND_COUNT}`;
  }

  const running = state.phase === "wave";
  if (hudShown.running !== running) {
    hudShown.running = running;
    const btn = $("start-btn");
    btn.classList.toggle("running", running);
    btn.textContent = running ? "In progress" : "Start Round";
    btn.disabled = running;
    $("wave-bar").hidden = !running;
  }
  if (running) {
    const pct = Math.round((state.spawnIdx / Math.max(1, state.schedule.length)) * 100);
    if (hudShown.wave !== pct) {
      hudShown.wave = pct;
      $("wave-fill").style.width = `${pct}%`;
    }
  }
}

/** Shop affordability and the open upgrade panel both depend only on cash. */
function refreshAffordability() {
  for (const el of shopItems) {
    el.classList.toggle("poor", state.cash < TOWER_BY_ID[el.dataset.tower].cost);
  }
  if (selection.tower) refreshInspector();
}

function beginRound() {
  if (state.phase !== "build") return;
  selection.placing = null;
  startRound(state);
  sfx.roundStart();
  refreshDock();
  refreshHud();
  refreshPreview();
}

// ------------------------------------------------------------------ flow ---

function newGame() {
  for (const k of Object.keys(hudShown)) hudShown[k] = null;
  state = createGame({ mapId: chosenMap, difficultyId: chosenDiff });
  fx = createFx();
  selection = { placing: null, tower: null, pointer: null, valid: false };
  paused = false;
  autoTimer = 0;
  accumulator = 0;
  $("menu-overlay").hidden = true;
  $("end-overlay").hidden = true;
  $("pause-overlay").hidden = true;
  invalidateMapLayer();
  resize();
  buildShop();
  refreshDock();
  refreshHud();
  refreshPreview();
}

function endGame() {
  const reached = state.phase === "won" ? ROUND_COUNT : state.round;
  const key = BEST_KEY(state.map.id, state.difficulty.id);
  const best = loadHighScore(key, 0);
  if (reached > best) saveHighScore(key, reached);

  $("end-title").textContent = state.phase === "won" ? "Map cleared!" : "Overrun";
  $("end-round").textContent = `${reached}/${ROUND_COUNT}`;
  $("end-pops").textContent = state.popsTotal;
  $("end-best").textContent = reached > best ? "New best on this map!" : `Best here: round ${Math.max(best, reached)}`;
  $("end-overlay").hidden = false;
  if (state.phase === "won") sfx.victory();
  else sfx.defeat();
}

function drainEvents() {
  for (const ev of state.events) {
    handleEvent(fx, ev);
    if (ev.kind === "pop") (ev.moab ? sfx.moabPop() : sfx.pop());
    else if (ev.kind === "shoot") sfx.shoot();
    else if (ev.kind === "blast") sfx.blast();
    else if (ev.kind === "leak") sfx.leak();
    else if (ev.kind === "roundEnd") sfx.roundEnd();
  }
  state.events.length = 0;
}

function step(dt) {
  time += dt;
  updateFx(fx, dt);
  if (!state || paused) return;
  if (state.phase === "won" || state.phase === "lost") return;

  const wasPhase = state.phase;
  // Fixed timestep: the simulation must behave the same on a 30fps phone as on
  // a 120fps one, and fast-forward must not coarsen collision detection.
  accumulator = Math.min(accumulator + dt * SPEEDS[speedIndex], MAX_CATCHUP);
  while (accumulator >= FIXED_DT) {
    accumulator -= FIXED_DT;
    update(state, FIXED_DT);
    if (state.phase === "won" || state.phase === "lost") break;
  }
  drainEvents();

  if (wasPhase === "wave" && state.phase === "build") {
    refreshPreview();
    autoTimer = 0;
  }
  if (state.phase === "build" && autoStart) {
    autoTimer += dt;
    if (autoTimer > 1.2) beginRound();
  }
  if (selection.tower && !state.towers.includes(selection.tower)) {
    selection.tower = null;
    refreshDock();
  }
  refreshHud();
  if (state.phase === "won" || state.phase === "lost") endGame();
}

function render() {
  if (!state) return;
  ctx.save();
  ctx.clearRect(0, 0, view.w, view.h);

  const shakeX = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
  const shakeY = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
  ctx.translate(view.ox + shakeX, view.oy + shakeY);
  ctx.scale(view.scale, view.scale);
  // Confine everything to the map rect; bloons enter and leave off-map and
  // would otherwise be drawn floating on the letterbox background.
  ctx.beginPath();
  ctx.rect(0, 0, WORLD.w, WORLD.h);
  ctx.clip();

  if (selection.tower) {
    const s = towerStats(selection.tower);
    if (!s.support) drawRange(ctx, selection.tower.x, selection.tower.y, Math.min(s.range, 900), true);
  }
  if (selection.placing && selection.pointer) {
    const def = TOWER_BY_ID[selection.placing];
    const p = selection.pointer;
    drawRange(ctx, p.x, p.y, Math.min(def.base.range, 900), selection.valid);
    drawTower(ctx, { defId: def.id, x: p.x, y: p.y, tiers: [0, 0], angle: -Math.PI / 2 }, { ghost: true });
  }

  drawTowers(ctx, state, selection.tower);
  drawBloons(ctx, state, time);
  drawProjectiles(ctx, state);
  drawFx(ctx, fx);
  ctx.restore();
}

// ----------------------------------------------------------------- setup ---

function bindUi() {
  $("play-btn").addEventListener("click", () => {
    resumeAudio();
    newGame();
  });
  $("start-btn").addEventListener("click", () => {
    resumeAudio();
    beginRound();
  });
  $("speed-btn").addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    $("speed-btn").textContent = `${SPEEDS[speedIndex]}x`;
    $("speed-btn").classList.toggle("on", speedIndex > 0);
  });
  $("auto-btn").addEventListener("click", () => {
    autoStart = !autoStart;
    $("auto-btn").setAttribute("aria-pressed", String(autoStart));
  });
  $("mute-btn").addEventListener("click", () => {
    resumeAudio();
    setMuted(!isMuted());
    $("mute-btn").textContent = isMuted() ? "🔇" : "♪";
  });
  $("target-btn").addEventListener("click", () => {
    const t = selection.tower;
    if (!t) return;
    t.target = TARGET_MODES[(TARGET_MODES.indexOf(t.target) + 1) % TARGET_MODES.length];
    refreshInspector();
  });
  $("sell-btn").addEventListener("click", () => {
    if (!selection.tower) return;
    sellTower(state, selection.tower);
    sfx.sell();
    selection.tower = null;
    refreshDock();
    refreshHud();
  });
  $("close-insp").addEventListener("click", () => {
    selection.tower = null;
    refreshDock();
  });
  for (let p = 0; p < 2; p++) {
    $(`up-${p}`).addEventListener("click", () => {
      const t = selection.tower;
      if (!t) return;
      if (buyUpgrade(state, t, p)) {
        sfx.upgrade();
        refreshInspector();
        refreshHud();
      } else {
        sfx.denied();
        showToast($("toast"), "Not enough cash");
      }
    });
  }
  $("resume-btn").addEventListener("click", () => {
    paused = false;
    $("pause-overlay").hidden = true;
  });
  $("quit-btn").addEventListener("click", () => {
    paused = false;
    $("pause-overlay").hidden = true;
    $("menu-overlay").hidden = false;
    refreshMenu();
  });
  $("retry-btn").addEventListener("click", newGame);
  $("menu-btn").addEventListener("click", () => {
    $("end-overlay").hidden = true;
    $("menu-overlay").hidden = false;
    refreshMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (!state) return;
    if (e.code === "Space") {
      e.preventDefault();
      beginRound();
    } else if (e.code === "Escape") {
      selection.placing = null;
      selection.tower = null;
      refreshDock();
    }
  });

  // Pausing on tab-away stops a backgrounded round quietly losing the run.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state && state.phase === "wave") {
      paused = true;
      $("pause-round").textContent = state.round;
      $("pause-overlay").hidden = false;
    }
  });
}

livesChip = document.querySelector(".stat-chip--lives");
buildMenu();
bindUi();
bindInput();
state = createGame({ mapId: chosenMap, difficultyId: chosenDiff });
buildShop();
resize();
createLoop({ update: step, render }).start();
