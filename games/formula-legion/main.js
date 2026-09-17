// main.js — boot/orchestration for Formula Legion. Wires the pure gameplay
// modules (levels.js/legion.js/combat.js) to three.js rendering (render.js)
// and DOM/HUD. No gameplay math lives here — only state-machine glue.

import * as THREE from "three";
import { onPointer, createLoop, loadHighScore, saveHighScore, showToast } from "../../shared/game-utils.js";
import { getLevelDef, generateLevel, bestScoreKey } from "./levels.js";
import { createLegion, resetLegion, beginSteer, updateSteer, endSteer, updateLateralEase } from "./legion.js";
import { createRun, stepRun } from "./combat.js";
import {
  createGround,
  createLevelVisuals,
  disposeLevelVisuals,
  updateLevelVisuals,
  updateWaveDummies,
  createLegionCrowd,
  updateLegionCrowd,
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
const progressFillEl = document.getElementById("progress-fill");
const toastEl = document.getElementById("toast");

const BEST_KEY = bestScoreKey();
let best = loadHighScore(BEST_KEY, 0);
bestValueEl.textContent = String(best);

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
  bestValueEl.textContent = String(best);
  finalLevelEl.textContent = String(level.id);
  finalScoreEl.textContent = String(run.score);
  finalBestEl.textContent = String(best);
  gameoverOverlay.hidden = false;
}

function advanceToNextLevel() {
  showToast(toastEl, `Level ${level.id} cleared!`);
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
