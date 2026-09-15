import {
  lockViewport,
  onPointer,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
} from "../../shared/game-utils.js";

const HIGHSCORE_KEY = "game-tastic:flappy-tap:highscore";

const BIRD_RADIUS = 14;
const GRAVITY = 0.35;
const FLAP_VELOCITY = -6.5;
const MAX_FALL_SPEED = 9;
const PIPE_WIDTH = 70;
const GAP_HEIGHT = 170;
const PIPE_SPEED = 2.5;
const SPAWN_INTERVAL = 1.5; // seconds

const canvas = document.getElementById("game");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const gameoverOverlay = document.getElementById("gameover-overlay");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");
const retryBtn = document.getElementById("retry-btn");

const ctx = canvas.getContext("2d");

let width = 0;
let height = 0;

let best = loadHighScore(HIGHSCORE_KEY, 0);
bestValueEl.textContent = String(best);

/** @type {"ready"|"playing"|"gameover"} */
let state = "ready";

let bird = { x: 0, y: 0, vy: 0, angle: 0 };
let pipes = [];
let score = 0;
let spawnTimer = 0;

function resetGame() {
  bird = { x: width * 0.25, y: height / 2, vy: 0, angle: 0 };
  pipes = [];
  score = 0;
  spawnTimer = 0;
  scoreValueEl.textContent = "0";
  state = "ready";
  gameoverOverlay.hidden = true;
}

lockViewport(canvas);

fitCanvasToScreen(canvas, (w, h) => {
  const firstRun = width === 0 && height === 0;
  width = w;
  height = h;
  if (firstRun) {
    resetGame();
  } else {
    // Keep the bird within bounds on resize.
    bird.x = width * 0.25;
    if (state === "ready") bird.y = height / 2;
  }
});

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function spawnPipe() {
  const minCenter = height * 0.25;
  const maxCenter = height * 0.75;
  const gapY = minCenter + Math.random() * (maxCenter - minCenter);
  pipes.push({ x: width, gapY, scored: false });
}

function flap() {
  bird.vy = FLAP_VELOCITY;
}

function triggerGameOver() {
  state = "gameover";
  if (score > best) {
    best = score;
    saveHighScore(HIGHSCORE_KEY, best);
    bestValueEl.textContent = String(best);
  }
  finalScoreEl.textContent = String(score);
  finalBestEl.textContent = String(best);
  gameoverOverlay.hidden = false;
}

function handleTap() {
  if (state === "ready") {
    state = "playing";
    flap();
  } else if (state === "playing") {
    flap();
  } else if (state === "gameover") {
    resetGame();
  }
}

onPointer(canvas, {
  onDown: () => handleTap(),
});

retryBtn.addEventListener("click", () => {
  resetGame();
});

function update(dt) {
  if (state !== "playing") return;
  const frameScale = dt * 60;

  bird.vy += GRAVITY * frameScale;
  bird.vy = Math.min(bird.vy, MAX_FALL_SPEED);
  bird.y += bird.vy * frameScale;
  bird.angle = clamp(bird.vy * 3, -25, 90);

  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer -= SPAWN_INTERVAL;
    spawnPipe();
  }

  for (const pipe of pipes) {
    pipe.x -= PIPE_SPEED * frameScale;

    if (!pipe.scored && bird.x > pipe.x + PIPE_WIDTH / 2) {
      pipe.scored = true;
      score += 1;
      scoreValueEl.textContent = String(score);
    }
  }

  pipes = pipes.filter((pipe) => pipe.x + PIPE_WIDTH > 0);

  // Boundary collisions.
  if (bird.y - BIRD_RADIUS < 0 || bird.y + BIRD_RADIUS > height) {
    triggerGameOver();
    return;
  }

  // Pipe collisions.
  const topHalf = GAP_HEIGHT / 2;
  for (const pipe of pipes) {
    const topRectHeight = pipe.gapY - topHalf;
    const bottomRectY = pipe.gapY + topHalf;
    const bottomRectHeight = height - bottomRectY;

    if (
      circleRectCollide(bird.x, bird.y, BIRD_RADIUS, pipe.x, 0, PIPE_WIDTH, topRectHeight) ||
      circleRectCollide(bird.x, bird.y, BIRD_RADIUS, pipe.x, bottomRectY, PIPE_WIDTH, bottomRectHeight)
    ) {
      triggerGameOver();
      return;
    }
  }
}

function drawPipe(pipe) {
  const topHalf = GAP_HEIGHT / 2;
  const topRectHeight = pipe.gapY - topHalf;
  const bottomRectY = pipe.gapY + topHalf;
  const bottomRectHeight = height - bottomRectY;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#5ee6c8";
  ctx.fillRect(pipe.x, 0, PIPE_WIDTH, topRectHeight);
  ctx.fillRect(pipe.x, bottomRectY, PIPE_WIDTH, bottomRectHeight);
}

function drawBird() {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate((bird.angle * Math.PI) / 180);

  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Beak.
  ctx.fillStyle = "#ff8a3d";
  ctx.beginPath();
  ctx.moveTo(BIRD_RADIUS - 2, -4);
  ctx.lineTo(BIRD_RADIUS + 10, 0);
  ctx.lineTo(BIRD_RADIUS - 2, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function render() {
  if (width === 0 || height === 0) return;
  ctx.clearRect(0, 0, width, height);

  for (const pipe of pipes) {
    drawPipe(pipe);
  }

  drawBird();
}

const loop = createLoop({ update, render });
loop.start();
