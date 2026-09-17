// main.js — boot/orchestration for Formula Legion. Wires the pure gameplay
// modules (levels.js/legion.js/combat.js) to three.js rendering (render.js)
// and DOM/HUD. No gameplay math lives here — only state-machine glue.

import * as THREE from "three";
import { onPointer, createLoop, loadHighScore, saveHighScore, showToast } from "../../shared/game-utils.js";
import { getLevelDef, generateLevel, bestScoreKey } from "./levels.js";
import { createLegion, resetLegion, dps, beginSteer, updateSteer, endSteer, updateLateralEase } from "./legion.js";
import { createRun, stepRun, findActiveTarget } from "./combat.js";
import {
  createGround,
  createLevelVisuals,
  disposeLevelVisuals,
  updateLevelVisuals,
  updateWaveDummies,
  createLegionCrowd,
  updateLegionCrowd,
  createBulletPool,
  spawnBullet,
  updateBullets,
  updateCamera,
} from "./render.js";

const canvas = document.getElementById("game");
const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");
const menuOverlay = document.getElementById("menu-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const countValueEl = document.getElementById("count-value");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const levelValueEl = document.getElementById("level-value");
const finalLevelEl = document.getElementById("final-level");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");
const finalPowerEl = document.getElementById("final-power");
const finalBestPowerEl = document.getElementById("final-best-power");
const menuBestPowerEl = document.getElementById("menu-best-power");
const progressFillEl = document.getElementById("progress-fill");
const toastEl = document.getElementById("toast");

const BEST_KEY = bestScoreKey();
let best = loadHighScore(BEST_KEY, 0);
bestValueEl.textContent = String(best);

// "Global" reward: army power (count x fire rate x damage) is a persistent
// high score of its own, independent of any single run's score, so it
// reflects how strong an army you've ever built rather than resetting
// every time you die.
const BEST_POWER_KEY = "game-tastic:formula-legion:best-power";
let bestPower = loadHighScore(BEST_POWER_KEY, 0);
menuBestPowerEl.textContent = String(Math.round(bestPower));

canvas.style.touchAction = "none";

/** @type {"menu"|"playing"|"gameover"} */
let state = "menu";

// ---- three.js scene setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 20, 70);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = false;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 90);

const hemiLight = new THREE.HemisphereLight(0xaab8ff, 0x2a2320, 1.2);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xfff2d9, 0.9);
dirLight.position.set(-10, 20, 10);
scene.add(dirLight);

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", handleResize);
handleResize();

const crowd = createLegionCrowd(scene);
const bulletPool = createBulletPool(scene);
let fireAccumulator = 0;
const muzzleVec = new THREE.Vector3();
const targetVec = new THREE.Vector3();

// ---- run state ----
let levelIndex = 0;
let legion = createLegion();
let level = null;
let run = null;
let levelGroup = null;
let ground = null;

function loadLevel(index) {
  if (levelGroup) disposeLevelVisuals(scene, levelGroup);
  if (ground) {
    scene.remove(ground);
    ground.geometry.dispose();
    ground.material.dispose();
  }
  const def = getLevelDef(index);
  level = generateLevel(def);
  run = createRun(level, legion);
  ground = createGround(scene, level);
  levelGroup = createLevelVisuals(scene, level);
  levelValueEl.textContent = String(level.id);
}

function beginNewGame() {
  levelIndex = 0;
  resetLegion(legion);
  loadLevel(levelIndex);
  updateHud();
}

// ---- steering input ----
onPointer(canvas, {
  onDown: (x) => {
    if (state !== "playing") return;
    beginSteer(legion, x);
  },
  onMove: (x) => {
    if (state !== "playing") return;
    updateSteer(legion, x);
  },
  onUp: () => endSteer(legion),
});

startBtn.addEventListener("click", () => {
  menuOverlay.hidden = true;
  beginNewGame();
  state = "playing";
  loop.start();
});

retryBtn.addEventListener("click", () => {
  gameoverOverlay.hidden = true;
  beginNewGame();
  state = "playing";
  loop.start();
});

function updateHud() {
  countValueEl.textContent = String(legion.count);
  scoreValueEl.textContent = String(run ? run.score : 0);
  const pct = run ? Math.min(100, (run.playerZ / level.length) * 100) : 0;
  progressFillEl.style.width = pct + "%";
}

function triggerGameOver() {
  state = "gameover";
  best = Math.max(best, run.score);
  saveHighScore(BEST_KEY, best);
  const power = dps(legion);
  bestPower = Math.max(bestPower, power);
  saveHighScore(BEST_POWER_KEY, bestPower);

  bestValueEl.textContent = String(best);
  finalLevelEl.textContent = String(level.id);
  finalScoreEl.textContent = String(run.score);
  finalBestEl.textContent = String(best);
  finalPowerEl.textContent = String(Math.round(power));
  finalBestPowerEl.textContent = String(Math.round(bestPower));
  menuBestPowerEl.textContent = String(Math.round(bestPower));
  gameoverOverlay.hidden = false;
}

function advanceToNextLevel() {
  const power = dps(legion);
  if (power > bestPower) {
    bestPower = power;
    saveHighScore(BEST_POWER_KEY, bestPower);
    menuBestPowerEl.textContent = String(Math.round(bestPower));
  }
  showToast(toastEl, `Level ${level.id} cleared! Army power ${Math.round(power)}`);
  levelIndex++;
  loadLevel(levelIndex);
}

function update(dt) {
  if (state !== "playing") return;

  updateLateralEase(legion, dt);
  stepRun(run, dt);

  for (const ev of level.events) {
    if (ev.type === "wave") updateWaveDummies(ev);
  }
  updateLevelVisuals(level, run.playerZ);
  updateLegionCrowd(crowd, legion, run.playerZ);
  updateCamera(camera, legion, run.playerZ, dt);

  // Tracer bullets: purely cosmetic, but they're the only reason shooting
  // is visible at all — spawn toward whatever combat.js is actually
  // damaging right now, so they always point at a real, live target.
  const target = findActiveTarget(level, run.playerZ, legion.x);
  if (target) {
    const visualRate = Math.min(16, Math.max(3, legion.fireRate * Math.sqrt(legion.count)));
    fireAccumulator += dt * visualRate;
    while (fireAccumulator >= 1) {
      fireAccumulator -= 1;
      muzzleVec.set(legion.x, 1.0, run.playerZ + 0.8);
      targetVec.set(target.x, 0.9, target.z);
      spawnBullet(bulletPool, muzzleVec, targetVec);
    }
  } else {
    fireAccumulator = 0;
  }
  updateBullets(bulletPool, dt);

  updateHud();

  if (run.dead) {
    triggerGameOver();
  } else if (run.finished) {
    advanceToNextLevel();
  }
}

function render() {
  renderer.render(scene, camera);
}

const loop = createLoop({ update, render });
render();
