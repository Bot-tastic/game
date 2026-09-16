// main.js — boot/orchestration for Geo Dash.
import { lockViewport, onPointer, loadHighScore, saveHighScore, createLoop, fitCanvasToScreen } from "../../shared/game-utils.js";
import { LEVEL_DEFS, generateLevel, modeAt, bestScoreKey, WORLD_HEIGHT, GROUND_Y, GROUND_MODES } from "./levels.js";
import { createPlayer, updatePlayer, hitsHazard, snapToMode, HITBOX } from "./player.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const levelGridEl = document.getElementById("level-grid");
const levelSelectOverlay = document.getElementById("levelselect-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const winOverlay = document.getElementById("win-overlay");
const retryBtn = document.getElementById("retry-btn");
const backBtn = document.getElementById("back-btn");
const nextBtn = document.getElementById("next-btn");
const winBackBtn = document.getElementById("win-back-btn");
const progressValueEl = document.getElementById("progress-value");
const modeValueEl = document.getElementById("mode-value");
const attemptValueEl = document.getElementById("attempt-value");
const finalProgressEl = document.getElementById("final-progress");
const finalBestEl = document.getElementById("final-best");
const finalAttemptEl = document.getElementById("final-attempt");
const winAttemptsEl = document.getElementById("win-attempts");
const modeHintEl = document.getElementById("mode-hint");

const MODE_HINTS = {
  cube: "CUBE — tap/hold to jump",
  ship: "SHIP — hold to fly up, release to fall",
  robot: "ROBOT — hold to jump higher, can double-jump",
  ufo: "UFO — tap to hop, chain taps to stay airborne",
};
const MODE_ICONS = { cube: "◼", ship: "▲", robot: "🤖", ufo: "◉" };

lockViewport(canvas);

let width = 0;
let height = 0;
let scale = 1;

fitCanvasToScreen(canvas, (w, h) => {
  width = w;
  height = h;
  scale = height / WORLD_HEIGHT;
});

/** @type {"levelselect"|"playing"|"dead"|"win"} */
let state = "levelselect";
let currentLevelDef = null;
let currentLevel = null;
let player = null;
let attempts = 0;
let held = false;
let justPressed = false;
let hintTimer = 0;

function loadBest(id) {
  return loadHighScore(bestScoreKey(id), 0);
}

function isUnlocked(index) {
  if (index === 0) return true;
  return loadBest(LEVEL_DEFS[index - 1].id) >= 100;
}

function renderLevelGrid() {
  levelGridEl.innerHTML = "";
  LEVEL_DEFS.forEach((def, i) => {
    const unlocked = isUnlocked(i);
    const best = loadBest(def.id);
    const btn = document.createElement("button");
    btn.className = "level-card" + (unlocked ? "" : " locked");
    btn.innerHTML = `
      <span class="lv-diff" style="background:${def.color}22;color:${def.color}">${def.difficulty}</span>
      <span class="lv-name">${def.id}. ${def.name}</span>
      <span class="lv-best">Best: ${unlocked ? best + "%" : "🔒 locked"}</span>
    `;
    if (unlocked) {
      btn.addEventListener("click", () => startLevel(def));
    } else {
      btn.disabled = true;
    }
    levelGridEl.appendChild(btn);
  });
}

function startLevel(def) {
  currentLevelDef = def;
  currentLevel = generateLevel(def);
  attempts = 0;
  resetRun();
  levelSelectOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  winOverlay.hidden = true;
  state = "playing";
  hintTimer = 2.4;
  loop.start();
}

function resetRun() {
  player = createPlayer();
  player.mode = currentLevelDef.modePlan[0].mode;
  snapToMode(player, currentLevel, player.mode);
  player.x = 0;
  attempts += 1;
  attemptValueEl.textContent = String(attempts);
  updateHud();
}

function updateHud() {
  const pct = currentLevelDef ? Math.min(100, Math.floor((player.x / currentLevelDef.length) * 100)) : 0;
  progressValueEl.textContent = pct + "%";
  modeValueEl.textContent = (MODE_ICONS[player.mode] || "") + " " + player.mode;
}

function triggerDeath() {
  state = "dead";
  const pct = Math.min(99, Math.floor((player.x / currentLevelDef.length) * 100));
  const best = loadBest(currentLevelDef.id);
  if (pct > best) saveHighScore(bestScoreKey(currentLevelDef.id), pct);
  finalProgressEl.textContent = pct + "%";
  finalBestEl.textContent = Math.max(pct, best) + "%";
  finalAttemptEl.textContent = String(attempts);
  gameoverOverlay.hidden = false;
}

function triggerWin() {
  state = "win";
  saveHighScore(bestScoreKey(currentLevelDef.id), 100);
  winAttemptsEl.textContent = String(attempts);
  winOverlay.hidden = false;
}

retryBtn.addEventListener("click", () => {
  gameoverOverlay.hidden = true;
  resetRun();
  state = "playing";
});
backBtn.addEventListener("click", backToLevels);
winBackBtn.addEventListener("click", backToLevels);
nextBtn.addEventListener("click", () => {
  winOverlay.hidden = true;
  const idx = LEVEL_DEFS.findIndex((d) => d.id === currentLevelDef.id);
  const next = LEVEL_DEFS[idx + 1];
  if (next) startLevel(next);
  else backToLevels();
});

function backToLevels() {
  state = "levelselect";
  gameoverOverlay.hidden = true;
  winOverlay.hidden = true;
  renderLevelGrid();
  levelSelectOverlay.hidden = false;
}

onPointer(canvas, {
  onDown: () => {
    held = true;
    justPressed = true;
  },
  onUp: () => {
    held = false;
  },
});

renderLevelGrid();

function update(dt) {
  if (state !== "playing") return;

  const input = { pressed: held, justPressed, speed: currentLevelDef.speed };
  updatePlayer(player, currentLevel, dt, input);
  justPressed = false;

  if (!player.dead) {
    const activeMode = modeAt(currentLevel, player.x);
    if (activeMode !== player.mode) {
      snapToMode(player, currentLevel, activeMode);
      hintTimer = 1.8;
    }
    if (hitsHazard(player, currentLevel)) player.dead = true;
  }

  if (player.dead) {
    triggerDeath();
    return;
  }

  if (player.x >= currentLevelDef.length) {
    player.x = currentLevelDef.length;
    triggerWin();
    return;
  }

  updateHud();

  if (hintTimer > 0) {
    hintTimer -= dt;
    modeHintEl.hidden = false;
    modeHintEl.textContent = MODE_HINTS[player.mode];
    modeHintEl.classList.toggle("fade", hintTimer < 0.5);
  } else {
    modeHintEl.hidden = true;
  }
}

function worldToScreenX(worldX) {
  return width * 0.28 + (worldX - player.x) * scale;
}
function worldToScreenY(worldY) {
  return worldY * scale;
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0b0d12");
  grad.addColorStop(1, shadeColor(currentLevelDef.color, -0.75));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function shadeColor(hex, amt) {
  const c = hex.replace("#", "");
  const num = parseInt(c, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r + (amt < 0 ? r : 255 - r) * amt)));
  g = Math.max(0, Math.min(255, Math.round(g + (amt < 0 ? g : 255 - g) * amt)));
  b = Math.max(0, Math.min(255, Math.round(b + (amt < 0 ? b : 255 - b) * amt)));
  return `rgb(${r},${g},${b})`;
}

function drawGround() {
  const viewLeft = player.x - width * 0.28 / scale - 40;
  const viewRight = player.x + (width - width * 0.28) / scale + 40;

  for (const seg of currentLevel.groundSegments) {
    if (seg.x1 < viewLeft || seg.x0 > viewRight) continue;
    if (seg.floorY == null) continue; // pit, nothing to draw
    const sx0 = worldToScreenX(seg.x0);
    const sx1 = worldToScreenX(seg.x1);
    const sy = worldToScreenY(seg.floorY);
    ctx.fillStyle = currentLevelDef.color;
    ctx.fillRect(sx0, sy, sx1 - sx0, height - sy);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(sx0, sy, sx1 - sx0, 4);
  }
}

function drawTunnel() {
  const kf = currentLevel.tunnelKeyframes;
  if (kf.length === 0) return;
  ctx.fillStyle = currentLevelDef.color;

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(kf[0].x), worldToScreenY(kf[0].floorY));
  for (const p of kf) ctx.lineTo(worldToScreenX(p.x), worldToScreenY(p.floorY));
  ctx.lineTo(worldToScreenX(kf[kf.length - 1].x), height);
  ctx.lineTo(worldToScreenX(kf[0].x), height);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(kf[0].x), worldToScreenY(kf[0].ceilY));
  for (const p of kf) ctx.lineTo(worldToScreenX(p.x), worldToScreenY(p.ceilY));
  ctx.lineTo(worldToScreenX(kf[kf.length - 1].x), 0);
  ctx.lineTo(worldToScreenX(kf[0].x), 0);
  ctx.closePath();
  ctx.fill();
}

function drawHazards() {
  const viewLeft = player.x - width * 0.28 / scale - 40;
  const viewRight = player.x + (width - width * 0.28) / scale + 40;

  for (const h of currentLevel.hazards) {
    if (h.x1 < viewLeft || h.x0 > viewRight) continue;
    const sx0 = worldToScreenX(h.x0);
    const sx1 = worldToScreenX(h.x1);
    const sy0 = worldToScreenY(h.y0);
    const sy1 = worldToScreenY(h.y1);
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.moveTo((sx0 + sx1) / 2, sy0);
    ctx.lineTo(sx1, sy1);
    ctx.lineTo(sx0, sy1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPortals() {
  for (const p of currentLevel.portals) {
    const sx = worldToScreenX(p.x);
    if (sx < -20 || sx > width + 20) continue;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(sx - 4, 0, 8, height);
  }
}

function drawPlayer() {
  const half = HITBOX[player.mode];
  const sx = worldToScreenX(player.x);
  const sy = worldToScreenY(player.y);
  const w = half.halfW * 2 * scale;
  const h = half.halfH * 2 * scale;

  ctx.save();
  ctx.translate(sx, sy);

  if (player.mode === "cube" || player.mode === "robot") {
    ctx.rotate(player.rotation);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "#c9960a";
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  } else if (player.mode === "ship") {
    ctx.rotate(player.rotation);
    ctx.fillStyle = "#5ee6c8";
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
  } else if (player.mode === "ufo") {
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -h / 4, w / 3.5, Math.PI, 0);
    ctx.fillStyle = "#9fd8ff";
    ctx.fill();
  }

  ctx.restore();
}

function render() {
  if (width === 0 || height === 0 || !currentLevel) return;
  drawBackground();
  drawGround();
  drawTunnel();
  drawHazards();
  drawPortals();
  drawPlayer();
}

const loop = createLoop({ update, render });
