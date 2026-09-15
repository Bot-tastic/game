import {
  lockViewport,
  onPointer,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
  showToast,
} from "../../shared/game-utils.js";

const HIGH_SCORE_KEY = "game-tastic:stack-tower:highscore";
const BLOCK_H = 30;
const BASE_WIDTH_FRAC = 0.5;
const CAMERA_THRESHOLD_FRAC = 0.6;
const CAMERA_TARGET_FRAC = 0.6;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const toastEl = document.getElementById("toast");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");
const menuOverlay = document.getElementById("menu-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");

lockViewport(canvas);

let cssW = window.innerWidth;
let cssH = window.innerHeight;
let baseY = 0;
let cameraThreshold = 0;
let cameraTargetScreenY = 0;

const STATE = { MENU: "MENU", PLAYING: "PLAYING", GAMEOVER: "GAMEOVER" };
let state = STATE.MENU;

let bestScore = loadHighScore(HIGH_SCORE_KEY, 0);
bestValueEl.textContent = String(bestScore);

let score = 0;
let stack = []; // resting blocks: {x, y, w, h, color}
let debris = []; // falling cosmetic pieces: {x, y, w, h, color, vy}
let moving = null; // {x, y, w, h, color, dir, speed}
let lastSpawnSide = "right"; // so first spawn alternates to "left"
let cameraY = 0;

function hueForIndex(i) {
  return (165 + i * 18) % 360;
}

function colorForIndex(i) {
  return `hsl(${hueForIndex(i)}, 70%, 55%)`;
}

function computeGeometry() {
  baseY = cssH - 80;
  cameraThreshold = cssH * CAMERA_THRESHOLD_FRAC;
  cameraTargetScreenY = baseY - cameraThreshold;
}

function resetGame() {
  score = 0;
  stack = [];
  debris = [];
  cameraY = 0;
  lastSpawnSide = "right";

  const baseW = cssW * BASE_WIDTH_FRAC;
  const baseX = (cssW - baseW) / 2;
  const baseTopY = baseY - BLOCK_H;
  stack.push({
    x: baseX,
    y: baseTopY,
    w: baseW,
    h: BLOCK_H,
    color: colorForIndex(0),
  });

  spawnMoving();
  updateScoreHud();
}

function spawnMoving() {
  const level = stack.length; // number of resting blocks so far
  const resting = stack[stack.length - 1];
  const width = resting.w;
  const y = resting.y - BLOCK_H;

  const side = lastSpawnSide === "left" ? "right" : "left";
  lastSpawnSide = side;

  const speed = Math.min(2.2 + level * 0.12, 6.5);
  let x, dir;
  if (side === "left") {
    x = 0;
    dir = 1;
  } else {
    x = cssW - width;
    dir = -1;
  }

  moving = {
    x,
    y,
    w: width,
    h: BLOCK_H,
    color: colorForIndex(level),
    dir,
    speed,
  };
}

function updateScoreHud() {
  scoreValueEl.textContent = String(score);
  if (score > bestScore) {
    bestScore = score;
    bestValueEl.textContent = String(bestScore);
    saveHighScore(HIGH_SCORE_KEY, bestScore);
  }
}

function updateCamera() {
  const stackTopY = stack[stack.length - 1].y;
  cameraY = Math.min(0, stackTopY - cameraTargetScreenY);
}

function endGame() {
  state = STATE.GAMEOVER;
  saveHighScore(HIGH_SCORE_KEY, bestScore);
  finalScoreEl.textContent = String(score);
  finalBestEl.textContent = String(bestScore);
  gameoverOverlay.hidden = false;
}

function dropMoving() {
  if (!moving) return;
  const resting = stack[stack.length - 1];

  const left = Math.max(moving.x, resting.x);
  const right = Math.min(moving.x + moving.w, resting.x + resting.w);
  const overlapWidth = right - left;

  if (overlapWidth < 4) {
    moving = null;
    endGame();
    return;
  }

  let newBlock;
  const level = stack.length;

  if (overlapWidth >= resting.w * 0.98) {
    newBlock = {
      x: resting.x,
      y: moving.y,
      w: resting.w,
      h: BLOCK_H,
      color: colorForIndex(level),
    };
    showToast(toastEl, "PERFECT");
  } else {
    newBlock = {
      x: left,
      y: moving.y,
      w: overlapWidth,
      h: BLOCK_H,
      color: colorForIndex(level),
    };

    const leftLeftoverW = left - moving.x;
    if (leftLeftoverW > 0.5) {
      debris.push({
        x: moving.x,
        y: moving.y,
        w: leftLeftoverW,
        h: BLOCK_H,
        color: moving.color,
        vy: 0,
      });
    }

    const rightLeftoverW = moving.x + moving.w - right;
    if (rightLeftoverW > 0.5) {
      debris.push({
        x: right,
        y: moving.y,
        w: rightLeftoverW,
        h: BLOCK_H,
        color: moving.color,
        vy: 0,
      });
    }
  }

  stack.push(newBlock);
  score += 1;
  updateScoreHud();
  updateCamera();
  spawnMoving();
}

function update(dt) {
  if (state !== STATE.PLAYING) return;
  const scale = dt * 60;

  if (moving) {
    moving.x += moving.dir * moving.speed * scale;
    if (moving.x <= 0) {
      moving.x = 0;
      moving.dir = 1;
    } else if (moving.x + moving.w >= cssW) {
      moving.x = cssW - moving.w;
      moving.dir = -1;
    }
  }

  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vy += 0.6 * scale;
    d.y += d.vy * scale;
    const screenY = d.y - cameraY;
    if (screenY > cssH) {
      debris.splice(i, 1);
    }
  }
}

function drawBlock(b) {
  const screenY = b.y - cameraY;
  if (screenY + b.h < 0 || screenY > cssH) return;
  ctx.fillStyle = b.color;
  ctx.fillRect(b.x, screenY, b.w, b.h);
}

function render() {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, cssW, cssH);

  for (const b of stack) drawBlock(b);
  for (const d of debris) drawBlock(d);
  if (moving) drawBlock(moving);
}

fitCanvasToScreen(canvas, (w, h) => {
  cssW = w;
  cssH = h;
  computeGeometry();
});

onPointer(canvas, {
  onDown: () => {
    if (state === STATE.PLAYING) {
      dropMoving();
    }
  },
});

startBtn.addEventListener("click", () => {
  menuOverlay.hidden = true;
  resetGame();
  state = STATE.PLAYING;
});

retryBtn.addEventListener("click", () => {
  gameoverOverlay.hidden = true;
  resetGame();
  state = STATE.PLAYING;
});

const loop = createLoop({ update, render });
loop.start();
