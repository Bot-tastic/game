// Wiring: menu, input, dock UI and the frame loop. The rules live in game.js —
// nothing here should decide what is legal, only what is shown and tapped.

import { createLoop, lockViewport, loadHighScore, onPointer, saveHighScore, showToast } from "../../shared/game-utils.js";
import { BLOONS, DIFFICULTIES, MAPS, WORLD } from "./config.js";
import { buildPath } from "./path.js";
import { ROUND_COUNT, ROUND_TITLES, roundPreview } from "./rounds.js";
import {
  ALL_TOWERS, HERO, HERO_ID, HERO_MAX_LEVEL, TOWER_BY_ID, TOWER_RADIUS,
  heroProgress, nextUpgrade, sellValue, upgradeBlocked,
} from "./towers.js";
import {
  TARGET_MODES, abilityOf, activateAbility, alreadyPlaced, buyUpgrade, canPlace, canStartRound,
  createGame, placeTower, sellTower, startRound, towerStats, update,
} from "./game.js";
import { drawBloons, drawEffects, drawProjectiles, drawRange, drawTower, drawTowers, invalidateMapLayer, paintMapInto } from "./render.js";
import { createFx, drawFx, drawOverlayFx, handleEvent, updateFx } from "./fx.js";
import { isMuted, resumeAudio, setMuted, sfx } from "./audio.js";

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 2, 3];
const FIXED_DT = 1 / 60;
// Cap the backlog so a backgrounded tab does not resolve ten rounds at once.
const MAX_CATCHUP = 0.5;
// Narrow layouts need enough dock left for the shop and an open upgrade panel.
const MIN_DOCK_H = 232;
const BEST_KEY = (map, diff) => `balloon-siege:best:${map}:${diff}`;

const canvas = $("game");
const ctx = canvas.getContext("2d");
const mapCanvas = $("map-layer");
const board = $("board");

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
// The ability bar is rebuilt only when the set of abilities changes; its
// cooldown shading is refreshed every frame, which has to stay cheap.
let abilityRows = [];
let abilitySig = "";

let chosenMap = MAPS[0].id;
let chosenDiff = "normal";

// ------------------------------------------------------------- viewport ----

/** Pick the layout, then size the canvas inside whatever box it ended up with.
 * Wide viewports get the dock as a sidebar; narrow ones get the board sized to
 * its own aspect ratio so the dock keeps a usable share of the screen. */
function layout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const wide = W > H * 1.15;
  document.body.classList.toggle("wide", wide);
  if (wide) {
    board.style.height = "";
  } else {
    const topInset = ($("topbar-row").offsetHeight || 46) + 6;
    const maxBoard = Math.max(160, H - MIN_DOCK_H);
    const scale = Math.min(W / WORLD.w, (maxBoard - topInset) / WORLD.h);
    board.style.height = `${Math.round(WORLD.h * scale + topInset)}px`;
  }
  resize();
}

const MAX_CANVAS_PX = 2_100_000;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  // Canvas 2D is fill-rate bound: measured framerate here is very nearly
  // inversely proportional to the backing-store pixel count, so cap it rather
  // than letting a 3x-DPI phone render four million pixels a frame.
  let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  if (w * h * dpr * dpr > MAX_CANVAS_PX) dpr = Math.max(1, Math.sqrt(MAX_CANVAS_PX / (w * h)));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  view.w = w;
  view.h = h;
  // Keep the playfield clear of the HUD: it floats over the board, and a tower
  // built underneath it would be unreachable.
  const topInset = ($("topbar-row").offsetHeight || 46) + 6;
  const avail = Math.max(1, h - topInset);
  view.scale = Math.min(w / WORLD.w, avail / WORLD.h);
  view.ox = (w - WORLD.w * view.scale) / 2;
  view.oy = topInset + (avail - WORLD.h * view.scale) / 2;
  view.dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  positionMapLayer();
}

window.addEventListener("resize", layout);
window.addEventListener("orientationchange", layout);

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
  const W = 240;
  const H = 240 * (WORLD.h / WORLD.w);
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
  c.lineWidth = 14 * s;
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
  $("rotate-note").hidden = window.innerWidth > window.innerHeight;
}

// ----------------------------------------------------------------- shop ----

function buildShop() {
  const shop = $("shop");
  shop.innerHTML = "";
  for (const def of ALL_TOWERS) {
    const item = document.createElement("button");
    item.className = `shop-item${def.hero ? " shop-item--hero" : ""}`;
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
      } else if (alreadyPlaced(state, def.id)) {
        sfx.denied();
        showToast($("toast"), "Only one hero per run");
        return;
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

  refreshAffordability();

  $("hint-bar").hidden = !selection.placing;
  if (selection.placing) {
    $("hint-bar").textContent = `Tap a clear spot to build the ${TOWER_BY_ID[selection.placing].name}`;
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

  // The hero has no bought upgrades: it shows its level track instead.
  $("upgrades").hidden = !def.paths.length;
  $("hero-panel").hidden = !def.hero;
  if (def.hero) {
    const prog = heroProgress(state.heroXp);
    $("hp-level").textContent = `Level ${state.heroLevel}`;
    $("hp-next").textContent = prog ? `${Math.floor(prog.have)}/${prog.need} XP` : "Max level";
    $("hp-fill").style.width = prog ? `${Math.min(100, (prog.have / prog.need) * 100)}%` : "100%";
    const nextPerk = HERO.levels[state.heroLevel - 1];
    $("hp-perk").textContent = nextPerk
      ? `Next: ${nextPerk.name} — ${nextPerk.desc}`
      : "Every perk unlocked.";
    return;
  }

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

// ------------------------------------------------------------ abilities ----

/** Rebuild the ability bar only when the set of abilities actually changes —
 * this runs off the frame loop, so it has to be a cheap no-op most frames. */
function syncAbilityBar() {
  const owners = state.towers.filter((t) => abilityOf(t));
  const sig = owners.map((t) => `${t.id}:${abilityOf(t).id}`).join("|");
  if (sig === abilitySig) return;
  abilitySig = sig;
  const bar = $("ability-bar");
  bar.innerHTML = "";
  abilityRows = owners.map((tower) => {
    const ab = abilityOf(tower);
    const btn = document.createElement("button");
    btn.className = "ability";
    btn.type = "button";
    btn.title = ab.name;
    btn.setAttribute("aria-label", ab.name);
    btn.append(document.createTextNode(ab.icon));
    const secs = document.createElement("span");
    secs.className = "ab-secs";
    btn.append(secs);
    btn.addEventListener("click", () => {
      resumeAudio();
      if (activateAbility(state, tower)) {
        sfx.ability();
        showToast($("toast"), ab.name);
      } else {
        sfx.denied();
      }
    });
    bar.append(btn);
    return { tower, ab, btn, secs, shownCd: -1, shownReady: null };
  });
}

function refreshAbilityBar() {
  for (const row of abilityRows) {
    const left = Math.max(0, row.tower.abilityCd ?? 0);
    const ready = left <= 0;
    if (ready !== row.shownReady) {
      row.shownReady = ready;
      row.btn.classList.toggle("ready", ready);
    }
    const whole = Math.ceil(left);
    if (whole !== row.shownCd) {
      row.shownCd = whole;
      row.secs.textContent = ready ? "" : String(whole);
      row.btn.style.setProperty("--cd", (left / row.ab.cooldown).toFixed(2));
    }
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
  if (state.round > ROUND_COUNT) return;
  for (const { type, camo } of roundPreview(state.round)) {
    const chip = document.createElement("span");
    chip.className = `pv${camo ? " camo" : ""}`;
    const dot = document.createElement("i");
    dot.style.background = BLOONS[type].color;
    chip.append(dot, document.createTextNode(camo ? `${type} camo` : type));
    box.append(chip);
  }
}

const hudShown = { lives: null, cash: null, round: null, running: null, wave: null, hero: null, xp: null };

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
  const shownRound = Math.min(state.round, ROUND_COUNT);
  if (hudShown.round !== shownRound) {
    hudShown.round = shownRound;
    $("round-value").textContent = `${shownRound}/${ROUND_COUNT}`;
    // Rounds advance inside update() now, not only through beginRound, so the
    // "what is coming" chips have to follow the counter rather than the button.
    refreshPreview();
  }

  const hasHero = state.towers.some((t) => t.defId === HERO_ID);
  $("hero-chip").hidden = !hasHero;
  if (hasHero) {
    if (hudShown.hero !== state.heroLevel) {
      hudShown.hero = state.heroLevel;
      $("hero-level").textContent = state.heroLevel;
    }
    const prog = heroProgress(state.heroXp);
    const pct = prog ? Math.round((prog.have / prog.need) * 100) : 100;
    if (hudShown.xp !== pct) {
      hudShown.xp = pct;
      $("hero-xp").style.width = `${pct}%`;
    }
  }

  const running = state.phase === "wave";
  const canStart = canStartRound(state);
  const early = state.bloons.length > 0 && canStart;
  const key = `${running}:${early}:${canStart}`;
  if (hudShown.running !== key) {
    hudShown.running = key;
    const btn = $("start-btn");
    btn.classList.toggle("running", running);
    btn.classList.toggle("early", early);
    btn.textContent = running ? "Sending…" : early ? "Send next" : "Start Round";
    btn.disabled = !canStart;
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
    const def = TOWER_BY_ID[el.dataset.tower];
    const gone = alreadyPlaced(state, def.id);
    el.classList.toggle("selected", selection.placing === def.id);
    el.classList.toggle("gone", gone);
    el.classList.toggle("poor", !gone && state.cash < def.cost);
  }
  if (selection.tower) refreshInspector();
}

function beginRound() {
  if (!canStartRound(state)) return;
  selection.placing = null;
  const round = state.round;
  startRound(state);
  sfx.roundStart();
  refreshDock();
  refreshHud();
  refreshPreview();
  return round;
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
  abilitySig = "none";
  abilityRows = [];
  $("ability-bar").innerHTML = "";
  $("menu-overlay").hidden = true;
  $("end-overlay").hidden = true;
  $("pause-overlay").hidden = true;
  invalidateMapLayer();
  layout();
  buildShop();
  refreshDock();
  refreshHud();
  refreshPreview();
}

function endGame() {
  const reached = state.phase === "won" ? ROUND_COUNT : Math.min(state.round, ROUND_COUNT);
  const key = BEST_KEY(state.map.id, state.difficulty.id);
  const best = loadHighScore(key, 0);
  if (reached > best) saveHighScore(key, reached);

  $("end-title").textContent = state.phase === "won" ? "Map cleared!" : "Overrun";
  $("end-round").textContent = `${reached}/${ROUND_COUNT}`;
  $("end-pops").textContent = state.popsTotal;
  $("end-hero").textContent = `${state.heroLevel}/${HERO_MAX_LEVEL}`;
  $("end-best").textContent = reached > best ? "New best on this map!" : `Best here: round ${Math.max(best, reached)}`;
  $("end-overlay").hidden = false;
  if (state.phase === "won") sfx.victory();
  else sfx.defeat();
}

function drainEvents() {
  for (const ev of state.events) {
    if (ev.kind === "roundStart") {
      handleEvent(fx, { ...ev, title: `Round ${ev.round}`, sub: ROUND_TITLES[ev.round] ?? "" });
      continue;
    }
    handleEvent(fx, ev);
    if (ev.kind === "pop") (ev.moab ? sfx.moabPop() : sfx.pop());
    else if (ev.kind === "shoot") sfx.shoot();
    else if (ev.kind === "blast") sfx.blast();
    else if (ev.kind === "leak") sfx.leak();
    else if (ev.kind === "roundEnd") sfx.roundEnd();
    else if (ev.kind === "heroLevel") sfx.upgrade();
  }
  state.events.length = 0;
}

/** True while the menu, pause or end screen covers the board. Nothing behind an
 * overlay is worth simulating or drawing, and the menu in particular was
 * burning a full frame budget rendering a board nobody could see. */
function overlayUp() {
  return !$("menu-overlay").hidden || !$("end-overlay").hidden || !$("pause-overlay").hidden;
}

function step(dt) {
  if (overlayUp()) return;
  time += dt;
  updateFx(fx, dt);
  if (!state || paused) return;
  if (state.phase === "won" || state.phase === "lost") return;

  // Fixed timestep: the simulation must behave the same on a 30fps phone as on
  // a 120fps one, and fast-forward must not coarsen collision detection.
  accumulator = Math.min(accumulator + dt * SPEEDS[speedIndex], MAX_CATCHUP);
  while (accumulator >= FIXED_DT) {
    accumulator -= FIXED_DT;
    update(state, FIXED_DT);
    if (state.phase === "won" || state.phase === "lost") break;
  }
  drainEvents();

  // Auto-start waits for a clear board. Sending a wave early is meant to be a
  // deliberate risk, not something a toggle does on the player's behalf.
  if (state.phase === "build" && autoStart && state.bloons.length === 0) {
    autoTimer += dt;
    if (autoTimer > 1) {
      autoTimer = 0;
      beginRound();
    }
  } else if (state.phase !== "build" || state.bloons.length > 0) {
    autoTimer = 0;
  }

  if (selection.tower && !state.towers.includes(selection.tower)) {
    selection.tower = null;
    refreshDock();
  }
  syncAbilityBar();
  refreshAbilityBar();
  refreshHud();
  if (state.phase === "won" || state.phase === "lost") endGame();
}

function render() {
  if (!state || overlayUp()) return;
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
    drawTower(ctx, { defId: def.id, x: p.x, y: p.y, tiers: [0, 0], level: state.heroLevel, angle: 0 }, { ghost: true });
  }

  drawEffects(ctx, state, time);
  drawTowers(ctx, state, selection.tower, time);
  drawBloons(ctx, state, time);
  drawProjectiles(ctx, state);
  drawFx(ctx, fx);
  drawOverlayFx(ctx, fx, WORLD);
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
    } else if (e.code.startsWith("Digit")) {
      // 1-9 fire the abilities in bar order, so a keyboard player never has to
      // hunt for a 52px circle mid-wave.
      const idx = Number(e.code.slice(5)) - 1;
      const row = abilityRows[idx];
      if (row && activateAbility(state, row.tower)) sfx.ability();
    }
  });

  // Pausing on tab-away stops a backgrounded round quietly losing the run.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state && state.bloons.length > 0) {
      paused = true;
      $("pause-round").textContent = Math.min(state.round, ROUND_COUNT);
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
layout();
createLoop({ update: step, render }).start();
