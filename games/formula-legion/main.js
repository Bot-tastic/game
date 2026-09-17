// main.js — boot/orchestration for Formula Legion. Wires the pure gameplay
// modules (levels/legion/combat) to the three.js presentation layer
// (render/crowd/props/fx), the DOM HUD and the Web Audio synth. No gameplay
// math lives here, only state-machine glue and event plumbing.

import * as THREE from "three";
import { onPointer, createLoop, loadHighScore, saveHighScore, showToast } from "../../shared/game-utils.js";
import {
  getLevelDef,
  generateLevel,
  bestScoreKey,
  rollPerks,
  PERKS,
  TIER_NAMES,
  TIER_COLORS,
  WARN_DISTANCE,
} from "./levels.js";
import {
  createLegion,
  resetLegion,
  updateLateralEase,
  beginSteer,
  updateSteer,
  endSteer,
  steerBy,
  effectiveFireRate,
  applyLevelStartPerks,
  teamColor,
} from "./legion.js";
import { createRun, stepRun, findActiveTarget, nextWall } from "./combat.js";
import {
  createRenderer,
  createComposer,
  createLights,
  applyTheme,
  createSky,
  updateSky,
  createTrack,
  updateTrack,
  disposeObject,
  createCameraRig,
  addShake,
  updateCamera,
  canAffordBloom,
  prefersReducedMotion,
} from "./render.js";
import { createCrowd, syncCrowd, updateCrowd, forEachMuzzle } from "./crowd.js";
import { createLevelProps, updateLevelProps } from "./props.js";
import { createFx, spawnTracer, spawnFlash, spawnSparks, spawnNumber, updateFx } from "./fx.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);

/** Compact big numbers so a seven-figure legion still reads at a glance. */
function fmt(n) {
  if (n < 10000) return String(Math.round(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e5 ? 1 : 0) + "K";
  return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M";
}
const canvas = $("game");
const menuOverlay = $("menu-overlay");
const perkOverlay = $("perk-overlay");
const gameoverOverlay = $("gameover-overlay");
const countValueEl = $("count-value");
const armyCountEl = document.querySelector(".army-count");
const tierBadgeEl = $("tier-badge");
const shieldBadgeEl = $("shield-badge");
const shieldValueEl = $("shield-value");
const scoreValueEl = $("score-value");
const bestValueEl = $("best-value");
const levelValueEl = $("level-value");
const themeNameEl = $("theme-name");
const progressFillEl = $("progress-fill");
const warnBanner = $("warn-banner");
const warnSub = $("warn-sub");
const toastEl = $("toast");
const perkGrid = $("perk-grid");
const muteBtn = $("mute-btn");
const qualityBtn = $("quality-btn");

const BEST_KEY = bestScoreKey();
const DEPTH_KEY = "game-tastic:formula-legion:depth";
const PEAK_KEY = "game-tastic:formula-legion:peak";
const QUALITY_KEY = "game-tastic:formula-legion:bloom";

let best = loadHighScore(BEST_KEY, 0);
let deepest = Math.max(1, loadHighScore(DEPTH_KEY, 1));
let peakBest = loadHighScore(PEAK_KEY, 0);
// 0 means "never chosen" (a missing key reads back as 0), 1 = lite, 2 = high,
// so the device check still decides the first time the game is opened.
const storedQuality = loadHighScore(QUALITY_KEY, 0);
let bloomOn = storedQuality === 0 ? canAffordBloom() : storedQuality === 2;

bestValueEl.textContent = fmt(best);
$("menu-best").textContent = fmt(best);
$("menu-depth").textContent = String(deepest);
qualityBtn.textContent = `Effects: ${bloomOn ? "High" : "Lite"}`;

canvas.style.touchAction = "none";
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---- scene ----
const { renderer, scene, camera } = createRenderer(canvas, { bloom: bloomOn });
const lights = createLights(scene);
const sky = createSky(scene);
const crowd = createCrowd(scene);
const fx = createFx(scene);
const rig = createCameraRig();
let composer = null;

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
}
window.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", handleResize);
handleResize();

if (bloomOn) {
  createComposer(renderer, scene, camera).then((c) => {
    composer = c;
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---- run state ----
/** @type {"menu"|"playing"|"perk"|"gameover"} */
let state = "menu";
let levelIndex = 0;
const legion = createLegion();
let level = null;
let run = null;
let track = null;
let props = null;
let playerZ = 0;
let time = 0;
let fireAcc = 0;
let gunCooldown = 0;
let sparkCooldown = 0;
let pendingDamage = 0;
let damageTimer = 0;
let peakCount = 0;
let lastCount = legion.count;
const _v = new THREE.Vector3();

function loadLevel(index) {
  disposeObject(scene, track && track.group);
  disposeObject(scene, props && props.root);
  level = generateLevel(getLevelDef(index), legion);
  run = createRun(level, legion);
  track = createTrack(scene, level);
  props = createLevelProps(scene, level);
  applyTheme(scene, lights, level.theme);
  playerZ = 0;
  fireAcc = 0;
  levelValueEl.textContent = String(level.id);
  themeNameEl.textContent = level.theme.name;
  audio.setIntensity(level.difficulty);
}

function beginNewGame() {
  levelIndex = 0;
  resetLegion(legion);
  peakCount = legion.count;
  lastCount = legion.count;
  loadLevel(0);
  updateHud(true);
}

// ---- input ----
onPointer(canvas, {
  onDown: (x) => state === "playing" && beginSteer(legion, x),
  onMove: (x) => state === "playing" && updateSteer(legion, x),
  onUp: () => endSteer(legion),
});

const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "a", "A", "d", "D"].includes(e.key)) {
    keys.add(e.key.toLowerCase());
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function keyboardSteer(dt) {
  let dir = 0;
  if (keys.has("arrowleft") || keys.has("a")) dir -= 1;
  if (keys.has("arrowright") || keys.has("d")) dir += 1;
  if (dir !== 0) steerBy(legion, dir * 5.5 * dt);
}

// ---- HUD ----
function updateHud(force) {
  if (force || legion.count !== lastCount) {
    countValueEl.textContent = fmt(legion.count);
    if (!prefersReducedMotion() && !force) {
      const cls = legion.count > lastCount ? "bump" : "drop";
      armyCountEl.classList.remove("bump", "drop");
      void armyCountEl.offsetWidth;
      armyCountEl.classList.add(cls);
    }
    lastCount = legion.count;
  }
  scoreValueEl.textContent = fmt(run ? run.score : 0);
  tierBadgeEl.textContent = `MK${legion.tier} ${TIER_NAMES[legion.tier - 1]}`;
  const tc = "#" + teamColor(legion).toString(16).padStart(6, "0");
  tierBadgeEl.style.borderColor = tc;
  tierBadgeEl.style.color = tc;
  shieldBadgeEl.hidden = legion.shields <= 0;
  shieldValueEl.textContent = String(legion.shields);
  progressFillEl.style.width = Math.min(100, (playerZ / level.length) * 100) + "%";

  const wall = state === "playing" ? nextWall(level, playerZ) : null;
  if (wall && wall.z - playerZ < WARN_DISTANCE) {
    const hp = wall.colHp.reduce((s, h) => s + h, 0);
    warnBanner.hidden = false;
    warnSub.textContent = `${wall.boss ? "BOSS " : ""}HP ${fmt(hp)} · ${wall.cols} COLUMN${
      wall.cols > 1 ? "S" : ""
    }`;
  } else {
    warnBanner.hidden = true;
  }
}

// ---- combat presentation ----
function fireVolley() {
  const target = findActiveTarget(level, playerZ, legion.x);
  if (!target) return;
  const color = teamColor(legion);
  let n = 0;
  forEachMuzzle(crowd, 42, (x, y, z) => {
    spawnTracer(fx, x, y, z, target.z - z, color);
    if (n % 3 === 0) spawnFlash(fx, x, y + 0.02, z);
    n++;
  });
  if (gunCooldown <= 0) {
    audio.gunfire(legion.count, legion.tier);
    gunCooldown = 0.07;
  }
  if (sparkCooldown <= 0) {
    spawnSparks(fx, target.x, 1.1, target.z - 0.5, 5, 0xffd9a0, 0.7);
    sparkCooldown = 0.09;
  }
}

function handleRunEvents() {
  for (const e of run.events) {
    switch (e.type) {
      case "gate": {
        audio.gateChime(e.good);
        if (e.op.kind === "tierUp") {
          audio.upgrade();
          showToast(toastEl, `MK${legion.tier} ${TIER_NAMES[legion.tier - 1].toUpperCase()}`);
          spawnSparks(fx, legion.x, 1.2, playerZ, 26, TIER_COLORS[legion.tier - 1], 1.4);
          rig.kick = 4;
        } else if (e.op.kind === "shieldUp") {
          showToast(toastEl, "SHIELDS UP");
        } else if (e.delta !== 0) {
          spawnNumber(
            fx,
            legion.x,
            2.4,
            playerZ + 2,
            (e.delta > 0 ? "+" : "-") + fmt(Math.abs(e.delta)),
            e.delta > 0 ? "#3ddc84" : "#ff4d6d",
            Math.abs(e.delta) > 40
          );
        }
        if (e.op.sub === "JACKPOT" || e.op.sub === "BUST") showToast(toastEl, e.op.sub);
        if (!e.good) addShake(rig, 0.25);
        break;
      }
      case "damage":
        pendingDamage += e.amount;
        break;
      case "columnDown":
        audio.crack();
        spawnSparks(fx, e.x, 1.4, e.z, 22, 0xff7a5c, 1.3);
        addShake(rig, 0.35);
        break;
      case "wallCleared":
        audio.shatter();
        spawnSparks(fx, 0, 1.6, e.z, e.boss ? 60 : 34, 0xffb020, e.boss ? 2 : 1.4);
        spawnNumber(fx, 0, 3, e.z, e.boss ? "BOSS DOWN" : "SHATTERED", "#ffd23f", true);
        addShake(rig, e.boss ? 0.9 : 0.5);
        rig.kick = 5;
        break;
      case "crash":
        audio.hurt();
        addShake(rig, 1.0);
        spawnSparks(fx, legion.x, 1.2, playerZ, 26, 0xff4d6d, 1.6);
        break;
      case "bossHit":
        audio.hurt();
        addShake(rig, 0.7);
        spawnSparks(fx, e.x, 1, playerZ, 18, 0xff4d6d, 1.2);
        break;
      case "lost":
        spawnNumber(fx, legion.x, 2.6, playerZ + 1.5, `-${fmt(e.n)}`, "#ff4d6d", e.n > 30);
        break;
      case "shield":
        audio.shield();
        showToast(toastEl, "SHIELD HELD");
        spawnSparks(fx, legion.x, 1.4, playerZ, 18, 0x63e2ff, 1.1);
        break;
      case "coin":
        audio.coin();
        spawnNumber(fx, e.x, 1.6, e.z, `+${e.worth}`, "#ffd23f");
        spawnSparks(fx, e.x, 1.1, e.z, 5, 0xffd23f, 0.6);
        break;
      default:
        break;
    }
  }
}

// ---- level flow ----
function showPerks() {
  state = "perk";
  audio.fanfare();
  $("perk-level").textContent = String(level.id);
  $("perk-summary").textContent = `Score ${fmt(run.score)} · Legion ${fmt(legion.count)} · MK${legion.tier}`;
  perkGrid.innerHTML = "";
  for (const perk of rollPerks(levelIndex, legion.perks)) {
    const btn = document.createElement("button");
    btn.className = "perk-card";
    btn.innerHTML = `<span class="p-icon">${perk.icon}</span><span><span class="p-name">${perk.name}</span><span class="p-desc">${perk.desc}</span></span>`;
    btn.addEventListener("click", () => choosePerk(perk.id));
    perkGrid.appendChild(btn);
  }
  perkOverlay.hidden = false;
}

function choosePerk(id) {
  if (legion.perks.indexOf(id) === -1) legion.perks.push(id);
  perkOverlay.hidden = true;
  const bankedScore = run.score;
  levelIndex++;
  loadLevel(levelIndex);
  run.score = bankedScore;
  applyLevelStartPerks(legion);
  deepest = Math.max(deepest, level.id);
  saveHighScore(DEPTH_KEY, deepest);
  $("menu-depth").textContent = String(deepest);
  showToast(toastEl, `LEVEL ${level.id} · ${level.theme.name.toUpperCase()}`, 1100);
  audio.upgrade();
  state = "playing";
  updateHud(true);
}

function triggerGameOver() {
  state = "gameover";
  audio.defeat();
  best = Math.max(best, run.score);
  saveHighScore(BEST_KEY, best);
  peakBest = Math.max(peakBest, peakCount);
  saveHighScore(PEAK_KEY, peakBest);
  bestValueEl.textContent = fmt(best);
  $("menu-best").textContent = fmt(best);
  $("final-level").textContent = String(level.id);
  $("final-score").textContent = fmt(run.score);
  $("final-best").textContent = fmt(best);
  $("final-peak").textContent = fmt(peakCount);
  const wrap = $("final-perks");
  wrap.innerHTML = "";
  for (const id of legion.perks) {
    const p = PERKS.find((x) => x.id === id);
    if (!p) continue;
    const chip = document.createElement("span");
    chip.className = "perk-chip";
    chip.textContent = `${p.icon} ${p.name}`;
    wrap.appendChild(chip);
  }
  warnBanner.hidden = true;
  gameoverOverlay.hidden = false;
}

// ---- buttons ----
function startRun() {
  audio.unlock();
  audio.startMusic();
  menuOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  beginNewGame();
  state = "playing";
}
$("start-btn").addEventListener("click", startRun);
$("retry-btn").addEventListener("click", startRun);

muteBtn.addEventListener("click", () => {
  audio.unlock();
  const m = audio.toggleMute();
  muteBtn.classList.toggle("off", m);
  muteBtn.innerHTML = m ? "&#128263;" : "&#9834;";
});

qualityBtn.addEventListener("click", () => {
  bloomOn = !bloomOn;
  saveHighScore(QUALITY_KEY, bloomOn ? 2 : 1);
  qualityBtn.textContent = `Effects: ${bloomOn ? "High" : "Lite"}`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, bloomOn ? 1.5 : 1.25));
  if (bloomOn && !composer) {
    createComposer(renderer, scene, camera).then((c) => {
      composer = c;
      if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    });
  }
  handleResize();
});

// ---- frame ----
function update(dt) {
  time += dt;
  gunCooldown -= dt;
  sparkCooldown -= dt;

  if (state === "playing") {
    keyboardSteer(dt);
    updateLateralEase(legion, dt);
    stepRun(run, dt);
    playerZ = run.playerZ;
    handleRunEvents();
    peakCount = Math.max(peakCount, legion.count);

    fireAcc += dt * effectiveFireRate(legion);
    let volleys = 0;
    while (fireAcc >= 1 && volleys < 2) {
      fireAcc -= 1;
      fireVolley();
      volleys++;
    }
    if (fireAcc > 2) fireAcc = 0;

    damageTimer -= dt;
    if (pendingDamage > 0 && damageTimer <= 0) {
      const target = findActiveTarget(level, playerZ, legion.x);
      if (target) spawnNumber(fx, target.x, 2.2, target.z, fmt(pendingDamage), "#fff3b0");
      pendingDamage = 0;
      damageTimer = 0.32;
    }
  } else {
    // idle showcase scroll behind the overlays
    playerZ += (level ? level.speed : 12) * dt * 0.45;
    if (level && playerZ > level.length - 40) playerZ = 0;
    legion.x = Math.sin(time * 0.5) * 1.6;
    updateLateralEase(legion, dt);
  }

  syncCrowd(crowd, state === "playing" ? legion.count : 26, legion.x, playerZ);
  for (let i = 0; i + 2 < crowd.deaths.length && i < 30; i += 3) {
    spawnSparks(fx, crowd.deaths[i], crowd.deaths[i + 1], crowd.deaths[i + 2], 3, teamColor(legion), 0.6);
  }
  updateCrowd(crowd, legion, playerZ, dt, time);
  updateTrack(track, time, playerZ);
  updateLevelProps(props, level, playerZ, legion.x, time);
  updateSky(sky, camera, time, level.theme);
  updateCamera(camera, rig, legion, playerZ, crowd.spread, dt, time);
  updateFx(fx, dt);
  updateHud(false);

  if (state === "playing") {
    if (run.dead) triggerGameOver();
    else if (run.finished) showPerks();
  }
}

function render() {
  if (composer && bloomOn) composer.render();
  else renderer.render(scene, camera);
}

loadLevel(0);
updateHud(true);
const loop = createLoop({ update, render });
loop.start();
