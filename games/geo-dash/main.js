// main.js — boot and orchestration for Geo Dash: state machine, level select,
// HUD, practice checkpoints, and the glue between input, physics, sound and FX.

import { lockViewport, onPointer, loadHighScore, saveHighScore, createLoop, fitCanvasToScreen, showToast } from "../../shared/game-utils.js";
import { LEVEL_DEFS, getLevel, storeKey, MODE_LABEL } from "./levels.js";
import { createPlayer, createRun, step, HITBOX } from "./player.js";
import { createRenderer } from "./render.js";
import { createFx, updateFx, clearFx, burst, ring, shatter, shake, flash, hitStop, banner } from "./fx.js";
import { createAudio } from "./audio.js";

const canvas = document.getElementById("game");
const renderer = createRenderer(canvas);
const audio = createAudio();
const fx = createFx();

const el = (id) => document.getElementById(id);
const menuOverlay = el("menu-overlay");
const detailOverlay = el("detail-overlay");
const pauseOverlay = el("pause-overlay");
const winOverlay = el("win-overlay");
const levelGrid = el("level-grid");
const progressWrap = el("progress-wrap");
const progressFill = el("progress-fill");
const progressBest = el("progress-best");
const progressNum = el("progress-num");
const attemptValue = el("attempt-value");
const coinValue = el("coin-value");
const modeTag = el("mode-tag");
const toastEl = el("toast");

const CHECKPOINT_GAP = 1.7;

let dpr = 1;
let state = "menu"; // menu | detail | playing | dying | paused | win
let def = null;
let level = null;
let player = null;
let run = null;
let detailDef = null;
let practice = loadHighScore(storeKey("practice"), 0) === 1;
let attempts = 0;
let runTime = 0;
let deathAt = 0;
let checkpoints = [];
let cpTimer = 0;
let held = false;
let queuedPress = false;
let modeTagTimer = 0;
let hudTick = 0;

lockViewport(canvas);
fitCanvasToScreen(canvas, (w, h) => {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  renderer.resize(w, h);
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const bestOf = (id) => loadHighScore(storeKey(`best:${id}`), 0);
const attemptsOf = (id) => loadHighScore(storeKey(`att:${id}`), 0);
const coinsOf = (id) => loadHighScore(storeKey(`coins:${id}`), 0);

function recordBest(id, pct) {
  if (pct > bestOf(id)) {
    saveHighScore(storeKey(`best:${id}`), pct);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------

const MODE_GLYPH = { cube: "◼", ship: "▲", ball: "●", wave: "◆", ufo: "⬭" };

/** The gamemodes a level actually contains, in the order you meet them. */
function modesIn(d) {
  const lv = getLevel(d);
  const out = ["cube"];
  for (const p of lv.portals) {
    if (p.kind === "mode" && p.value !== out[out.length - 1]) out.push(p.value);
  }
  return [...new Set(out)];
}

function renderLevelGrid() {
  levelGrid.innerHTML = "";
  for (const d of LEVEL_DEFS) {
    const best = bestOf(d.id);
    const done = best >= 100;
    const card = document.createElement("button");
    card.className = "level-card" + (done ? " done" : "");
    card.style.setProperty("--lc-a", d.theme.sky1);
    card.style.setProperty("--lc-b", d.theme.sky0);
    card.style.setProperty("--lc-glow", d.theme.accent);
    card.style.setProperty("--lc-edge", d.theme.accent + "66");
    card.innerHTML = `
      <span class="lv-num">LEVEL ${String(d.id).padStart(2, "0")}</span>
      <span class="lv-name">${d.name}</span>
      <span class="lv-diff">${d.difficulty}</span>
      ${done ? '<span class="lv-crown">👑</span>' : ""}
      <span class="lv-modes">${modesIn(d).map((m) => `<i title="${m}">${MODE_GLYPH[m]}</i>`).join("")}</span>
      <span class="lv-bar"><i style="width:${best}%"></i></span>
      <span class="lv-best">${done ? "COMPLETE" : best + "%"}</span>
    `;
    card.addEventListener("click", () => {
      audio.unlock();
      audio.sfx("click");
      openDetail(d);
    });
    levelGrid.appendChild(card);
  }
}

const DIFF_COLOR = {
  Easy: "#3ddc84",
  Normal: "#4fc3ff",
  Hard: "#ffb020",
  Harder: "#ff7a1a",
  Insane: "#ff3fa4",
  Demon: "#ff2d4d",
};

function openDetail(d) {
  detailDef = d;
  state = "detail";
  el("detail-name").textContent = d.name;
  const pill = el("detail-diff");
  pill.textContent = d.difficulty;
  pill.style.setProperty("--pill-bg", (DIFF_COLOR[d.difficulty] || "#888") + "33");
  pill.style.setProperty("--pill-fg", DIFF_COLOR[d.difficulty] || "#fff");
  el("detail-stars").textContent = "★".repeat(Math.min(5, Math.ceil(d.stars / 2))) + "☆".repeat(5 - Math.min(5, Math.ceil(d.stars / 2)));
  el("detail-best").textContent = bestOf(d.id) + "%";
  el("detail-attempts").textContent = attemptsOf(d.id);
  el("detail-coins").textContent = coinsOf(d.id);
  el("detail-sheet").style.background = `linear-gradient(160deg, ${d.theme.sky1}, ${d.theme.sky0})`;
  menuOverlay.hidden = true;
  detailOverlay.hidden = false;
}

function backToMenu() {
  state = "menu";
  audio.stop();
  detailOverlay.hidden = true;
  pauseOverlay.hidden = true;
  winOverlay.hidden = true;
  progressWrap.hidden = true;
  modeTag.hidden = true;
  el("attempt-chip").hidden = true;
  el("coin-chip").hidden = true;
  el("pause-btn").hidden = true;
  renderLevelGrid();
  menuOverlay.hidden = false;
  loop.stop();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startLevel(d, practiceMode) {
  def = d;
  level = getLevel(d);
  practice = practiceMode;
  saveHighScore(storeKey("practice"), practice ? 1 : 0);
  attempts = 0;
  checkpoints = [];
  menuOverlay.hidden = true;
  detailOverlay.hidden = true;
  pauseOverlay.hidden = true;
  winOverlay.hidden = true;
  progressWrap.hidden = false;
  el("attempt-chip").hidden = false;
  el("coin-chip").hidden = false;
  el("pause-btn").hidden = false;
  progressWrap.style.setProperty("--gd-a", d.theme.accent);
  progressWrap.style.setProperty("--gd-b", d.theme.accent2);
  progressBest.style.left = bestOf(d.id) + "%";
  audio.unlock();
  audio.playTheme(d);
  beginAttempt(true);
  loop.start();
}

function beginAttempt(fresh) {
  const cp = practice && checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
  player = createPlayer(level, cp ? cp.x : 0);
  run = createRun(level);
  if (cp) {
    player.y = cp.y;
    player.vy = cp.vy;
    player.mode = cp.mode;
    player.grav = cp.grav;
    player.grounded = cp.grounded;
    run.padUsed.set(cp.padUsed);
    run.coins.set(cp.coins);
    run.coinCount = cp.coinCount;
  }
  player.trail = [];
  attempts += 1;
  saveHighScore(storeKey(`att:${def.id}`), attemptsOf(def.id) + 1);
  attemptValue.textContent = String(attempts);
  coinValue.textContent = String(run.coinCount);
  runTime = 0;
  cpTimer = 0;
  clearFx(fx);
  if (fresh) {
    checkpoints = [];
    showModeTag(player.mode);
  }
  state = "playing";
  held = false;
  queuedPress = false;
  flash(fx, def.theme.glow, 0.28);
}

function snapshotCheckpoint() {
  checkpoints.push({
    x: player.x,
    y: player.y,
    vy: player.vy,
    mode: player.mode,
    grav: player.grav,
    grounded: player.grounded,
    padUsed: run.padUsed.slice(),
    coins: run.coins.slice(),
    coinCount: run.coinCount,
  });
  if (checkpoints.length > 40) checkpoints.shift();
  audio.sfx("checkpoint");
  ring(fx, player.x, player.y, { color: "#5ae6a0", r1: 70, life: 0.5 });
}

function progressPct() {
  return Math.max(0, Math.min(100, (player.x / level.length) * 100));
}

function die() {
  state = "dying";
  deathAt = runTime;
  audio.sfx("die");
  shatter(fx, player.x, player.y, "#ffe066", def.theme.glow);
  burst(fx, player.x, player.y, { count: 18, color: "#ffffff", speed: 260, size: 4, life: 0.5 });
  shake(fx, 22);
  flash(fx, "#ff4d5e", 0.45);
  hitStop(fx, 0.09);

  if (!practice) {
    const pct = Math.floor(progressPct());
    if (recordBest(def.id, pct)) {
      progressBest.style.left = pct + "%";
      showToast(toastEl, `NEW BEST ${pct}%`, 900);
    }
  }
}

function win() {
  state = "win";
  audio.stop();
  audio.sfx("win");
  for (let i = 0; i < 4; i++) {
    ring(fx, player.x, player.y, { color: i % 2 ? "#ffd23f" : def.theme.glow, r1: 90 + i * 50, life: 0.7 + i * 0.1 });
  }
  burst(fx, player.x, player.y, { count: 46, color: "#ffd23f", speed: 340, size: 7, life: 1 });
  flash(fx, "#ffffff", 0.5);
  if (!practice) {
    recordBest(def.id, 100);
    const c = Math.max(coinsOf(def.id), run.coinCount);
    saveHighScore(storeKey(`coins:${def.id}`), c);
  }
  el("win-attempts").textContent = String(attempts);
  el("win-coins").textContent = String(run.coinCount);
  el("win-mode").textContent = practice ? "Practice" : "Normal";
  winOverlay.hidden = false;
  progressWrap.hidden = true;
}

function showModeTag(mode) {
  modeTag.hidden = false;
  modeTag.textContent = MODE_LABEL[mode] || mode;
  modeTag.classList.remove("fade");
  modeTagTimer = 2.2;
}

// ---------------------------------------------------------------------------
// Events from the simulation
// ---------------------------------------------------------------------------

const PORTAL_TINT = { cube: "#4fe3d0", ship: "#ff9c3d", ball: "#ff5ec4", wave: "#7c6bff", ufo: "#5cf07a" };

function handleEvents(events) {
  for (const e of events) {
    if (e.type === "jump") {
      audio.sfx("jump");
      burst(fx, e.x, e.y + HITBOX[player.mode].hh * player.grav, {
        count: 7,
        color: def.theme.glow,
        speed: 120,
        size: 4,
        life: 0.32,
        dir: Math.PI / 2 * player.grav,
        spread: 1.9,
      });
    } else if (e.type === "land") {
      audio.sfx("land");
      burst(fx, e.x, e.y, {
        count: 8,
        color: "#ffffff",
        speed: 150,
        size: 3.5,
        life: 0.3,
        dir: player.grav > 0 ? Math.PI : 0,
        spread: 2.4,
        gravity: 500 * player.grav,
      });
      if (e.vy > 500) shake(fx, 4);
    } else if (e.type === "pad") {
      audio.sfx("pad");
      ring(fx, e.x, e.y, { color: e.kind === "yellow" ? "#ffd23f" : "#ff6ad5", r1: 90, life: 0.45, width: 5 });
      burst(fx, e.x, e.y, { count: 14, color: "#ffd23f", speed: 240, size: 5, life: 0.5, dir: -Math.PI / 2, spread: 1.6 });
      shake(fx, 5);
    } else if (e.type === "orb") {
      audio.sfx("orb");
      ring(fx, e.x, e.y, { color: "#ffd23f", r1: 74, life: 0.4, width: 4 });
      burst(fx, e.x, e.y, { count: 12, color: "#fff0a0", speed: 200, size: 4, life: 0.4, gravity: 0 });
    } else if (e.type === "coin") {
      audio.sfx("coin");
      burst(fx, e.x, e.y, { count: 12, color: "#ffd23f", speed: 190, size: 4, life: 0.45, gravity: 260 });
      coinValue.textContent = String(run.coinCount);
    } else if (e.type === "flip") {
      burst(fx, e.x, e.y, { count: 10, color: "#ff5ec4", speed: 170, size: 4, life: 0.35, gravity: 0 });
    } else if (e.type === "portal") {
      audio.sfx("portal");
      const tint = e.kind === "mode" ? PORTAL_TINT[e.value] : e.kind === "grav" ? "#3dd8ff" : "#ff5a48";
      flash(fx, tint, 0.55);
      ring(fx, e.x, player.y, { color: tint, r1: 160, life: 0.55, width: 6 });
      burst(fx, e.x, player.y, { count: 22, color: tint, speed: 280, size: 5, life: 0.55, gravity: 0 });
      shake(fx, 8);
      player.trail = [];
      if (e.kind === "mode") {
        showModeTag(e.value);
        banner(fx, e.value.toUpperCase(), tint);
      } else if (e.kind === "grav") {
        banner(fx, "GRAVITY", tint);
      } else {
        banner(fx, e.value > 1 ? "SPEED UP" : "NORMAL", tint);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function update(dt) {
  updateFx(fx, dt);

  if (state === "dying") {
    runTime += dt;
    const beat = 60 / def.bpm;
    const wait = Math.max(0.7, Math.ceil(0.7 / beat) * beat);
    if (runTime - deathAt >= wait) beginAttempt(false);
    return;
  }

  if (state !== "playing") return;

  if (fx.hitStop > 0) {
    fx.hitStop -= dt;
    return;
  }

  runTime += dt;

  const input = { pressed: held, justPressed: queuedPress };
  queuedPress = false;
  const events = step(player, level, run, dt, input);
  handleEvents(events);

  // Ribbon trail behind the player.
  player.trail.push({ x: player.x, y: player.y });
  if (player.trail.length > 16) player.trail.shift();

  if (player.dead) {
    die();
    return;
  }

  if (player.x >= level.length) {
    player.x = level.length;
    win();
    return;
  }

  if (practice) {
    cpTimer += dt;
    const flight = player.mode === "ship" || player.mode === "wave" || player.mode === "ufo";
    if (cpTimer >= CHECKPOINT_GAP && (player.grounded || flight)) {
      cpTimer = 0;
      snapshotCheckpoint();
    }
  }

  if (modeTagTimer > 0) {
    modeTagTimer -= dt;
    if (modeTagTimer <= 0.6) modeTag.classList.add("fade");
    if (modeTagTimer <= 0) modeTag.hidden = true;
  }

  if (++hudTick % 3 === 0) {
    const pct = progressPct();
    progressFill.style.width = pct + "%";
    progressNum.textContent = Math.floor(pct) + "%";
  }
}

function render() {
  if (!level) return;
  const beat = 60 / def.bpm;
  const t = audio.ready && !audio.muted ? audio.elapsed() : runTime;
  const phase = ((t / beat) % 1 + 1) % 1;
  renderer.draw({
    dpr,
    level,
    theme: def.theme,
    player,
    run,
    fx,
    camX: player.x,
    time: runTime,
    pulse: Math.pow(1 - phase, 3),
    thrusting: held && player.mode === "ship",
    checkpoints: practice ? checkpoints : null,
  });
}

const loop = createLoop({ update, render });

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function press() {
  if (state !== "playing") return;
  held = true;
  queuedPress = true;
}

function release() {
  held = false;
}

onPointer(canvas, { onDown: press, onUp: release });

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (!e.repeat) press();
  } else if (e.code === "Escape" && state === "playing") {
    openPause();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") release();
});
window.addEventListener("blur", release);

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function openPause() {
  if (state !== "playing" && state !== "dying") return;
  state = "paused";
  held = false;
  el("pause-name").textContent = def.name;
  el("pause-progress").textContent = Math.floor(progressPct()) + "%";
  el("pause-best").textContent = bestOf(def.id) + "%";
  el("pause-attempts").textContent = String(attempts);
  updatePracticeBtn();
  pauseOverlay.hidden = false;
}

function updatePracticeBtn() {
  const b = el("toggle-practice-btn");
  b.textContent = practice ? "Practice ✓" : "Practice";
  b.classList.toggle("is-on", practice);
}

el("play-btn").addEventListener("click", () => startLevel(detailDef, false));
el("practice-btn").addEventListener("click", () => startLevel(detailDef, true));
el("detail-back").addEventListener("click", () => {
  detailOverlay.hidden = true;
  menuOverlay.hidden = false;
  state = "menu";
});

el("pause-btn").addEventListener("click", openPause);
el("resume-btn").addEventListener("click", () => {
  pauseOverlay.hidden = true;
  state = "playing";
});
el("restart-btn").addEventListener("click", () => {
  pauseOverlay.hidden = true;
  beginAttempt(true);
});
el("toggle-practice-btn").addEventListener("click", () => {
  practice = !practice;
  saveHighScore(storeKey("practice"), practice ? 1 : 0);
  updatePracticeBtn();
  pauseOverlay.hidden = true;
  beginAttempt(true);
});
el("quit-btn").addEventListener("click", backToMenu);
el("win-back-btn").addEventListener("click", backToMenu);
el("next-btn").addEventListener("click", () => {
  const i = LEVEL_DEFS.findIndex((d) => d.id === def.id);
  const nd = LEVEL_DEFS[i + 1];
  if (nd) startLevel(nd, practice);
  else backToMenu();
});

const muteBtn = el("mute-btn");
function paintMute() {
  muteBtn.textContent = audio.muted ? "♪̸" : "♪";
  muteBtn.classList.toggle("is-off", audio.muted);
}
muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  audio.unlock();
  audio.toggleMute();
  paintMute();
});
paintMute();

el("attempt-chip").hidden = true;
el("coin-chip").hidden = true;
el("pause-btn").hidden = true;
renderLevelGrid();

// Dev hook (opt-in via ?dev): jump to a fraction of the current level so the
// smoke test can screenshot the ship/wave/gravity sections without playing to
// them. Never exposed on a normal load.
if (location.search.includes("dev")) {
  window.__gdWarp = (frac) => {
    if (!level) return;
    player = createPlayer(level, level.length * frac);
    player.trail = [];
    // Drop into the first free lane at that x so flight sections can be
    // screenshotted without spawning inside a corridor wall.
    // Land in the middle of the widest free lane at that x, so tight flight
    // corridors can be screenshotted without spawning inside a wall.
    const hh = HITBOX[player.mode].hh + 6;
    const free = (y) =>
      level.allSolids.every(
        (so) => player.x + 26 < so.x || player.x - 26 > so.x + so.w || y + hh < so.y || y - hh > so.y + so.h
      );
    let bestY = player.y;
    let bestLen = -1;
    let runStart = null;
    for (let y = 10; y <= 295; y += 3) {
      if (free(y)) {
        if (runStart === null) runStart = y;
      } else if (runStart !== null) {
        if (y - runStart > bestLen) {
          bestLen = y - runStart;
          bestY = (runStart + y) / 2;
        }
        runStart = null;
      }
    }
    if (runStart !== null && 295 - runStart > bestLen) bestY = (runStart + 295) / 2;
    player.y = bestY;
    player.grounded = false;
    showModeTag(player.mode);
  };
}
