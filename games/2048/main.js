import { lockViewport, onPointer, loadHighScore, saveHighScore } from "../../shared/game-utils.js";

const BEST_KEY = "game-tastic:2048:bestscore";

const COLORS = {
  2: { bg: "#eee4da", fg: "#776e65" },
  4: { bg: "#ede0c8", fg: "#776e65" },
  8: { bg: "#f2b179", fg: "#f9f6f2" },
  16: { bg: "#f59563", fg: "#f9f6f2" },
  32: { bg: "#f67c5f", fg: "#f9f6f2" },
  64: { bg: "#f65e3b", fg: "#f9f6f2" },
  128: { bg: "#edcf72", fg: "#f9f6f2" },
  256: { bg: "#edcc61", fg: "#f9f6f2" },
  512: { bg: "#edc850", fg: "#f9f6f2" },
  1024: { bg: "#edc53f", fg: "#f9f6f2" },
  2048: { bg: "#edc22e", fg: "#f9f6f2" },
};
const COLOR_HIGH = { bg: "#3c3a32", fg: "#f9f6f2" };

const boardEl = document.getElementById("board");
const gridEl = document.getElementById("grid");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const newGameBtn = document.getElementById("new-game-btn");
const winOverlay = document.getElementById("win-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const keepGoingBtn = document.getElementById("keep-going-btn");
const winNewGameBtn = document.getElementById("win-new-game-btn");
const gameoverNewGameBtn = document.getElementById("gameover-new-game-btn");
const gameoverScoreEl = document.getElementById("gameover-score");
const gameoverBestEl = document.getElementById("gameover-best");

let board = [];
let score = 0;
let best = loadHighScore(BEST_KEY, 0);
let hasWon = false;
let cellEls = [];

function createGrid() {
  gridEl.innerHTML = "";
  cellEls = [];
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    gridEl.appendChild(cell);
    cellEls.push(cell);
  }
}

function newBoard() {
  board = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  score = 0;
  hasWon = false;
  spawnTile();
  spawnTile();
  render();
  winOverlay.hidden = true;
  gameoverOverlay.hidden = true;
}

function emptyCells() {
  const cells = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

function spawnTile() {
  const cells = emptyCells();
  if (cells.length === 0) return;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  board[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function render() {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const value = board[r][c];
      const cell = cellEls[r * 4 + c];
      if (value === 0) {
        cell.textContent = "";
        cell.classList.remove("filled");
        cell.style.background = "";
        cell.style.color = "";
      } else {
        cell.textContent = String(value);
        cell.classList.add("filled");
        const color = COLORS[value] || COLOR_HIGH;
        cell.style.background = color.bg;
        cell.style.color = color.fg;
      }
    }
  }
  scoreValueEl.textContent = String(score);
  if (score > best) {
    best = score;
    saveHighScore(BEST_KEY, best);
  }
  bestValueEl.textContent = String(best);
}

/** Compact + merge a single line (array of 4 values) toward index 0 (leading edge).
 * Returns { line, gained, changed } where `line` is the new array (still length 4),
 * `gained` is score gained from merges in this line, `changed` is whether anything moved. */
function processLine(line) {
  const original = line.slice();
  const nonZero = line.filter((v) => v !== 0);
  const merged = [];
  let gained = 0;
  let i = 0;
  while (i < nonZero.length) {
    if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
      const value = nonZero[i] * 2;
      merged.push(value);
      gained += value;
      i += 2;
    } else {
      merged.push(nonZero[i]);
      i += 1;
    }
  }
  while (merged.length < 4) merged.push(0);
  const changed = original.some((v, idx) => v !== merged[idx]);
  return { line: merged, gained, changed };
}

function getLine(direction, index) {
  const line = [];
  for (let i = 0; i < 4; i++) {
    if (direction === "left" || direction === "right") {
      line.push(board[index][i]);
    } else {
      line.push(board[i][index]);
    }
  }
  // For 'right' and 'down', reverse so the leading edge (index 0 of `line`)
  // corresponds to the trailing edge of the board (rightmost/bottommost).
  if (direction === "right" || direction === "down") line.reverse();
  return line;
}

function setLine(direction, index, line) {
  const oriented = direction === "right" || direction === "down" ? line.slice().reverse() : line;
  for (let i = 0; i < 4; i++) {
    if (direction === "left" || direction === "right") {
      board[index][i] = oriented[i];
    } else {
      board[i][index] = oriented[i];
    }
  }
}

function move(direction) {
  let moved = false;
  let gainedTotal = 0;
  for (let index = 0; index < 4; index++) {
    const line = getLine(direction, index);
    const result = processLine(line);
    if (result.changed) moved = true;
    gainedTotal += result.gained;
    setLine(direction, index, result.line);
  }
  if (!moved) return;
  score += gainedTotal;
  spawnTile();
  render();
  checkWin();
  checkGameOver();
}

function checkWin() {
  if (hasWon) return;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 2048) {
        hasWon = true;
        winOverlay.hidden = false;
        return;
      }
    }
  }
}

function checkGameOver() {
  if (emptyCells().length > 0) return;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const value = board[r][c];
      if (c + 1 < 4 && board[r][c + 1] === value) return;
      if (r + 1 < 4 && board[r + 1][c] === value) return;
    }
  }
  gameoverScoreEl.textContent = String(score);
  gameoverBestEl.textContent = String(best);
  gameoverOverlay.hidden = false;
}

let downX = 0;
let downY = 0;

lockViewport(boardEl);
onPointer(boardEl, {
  onDown(x, y) {
    downX = x;
    downY = y;
  },
  onUp(x, y) {
    const dx = x - downX;
    const dy = y - downY;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    let direction;
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? "right" : "left";
    } else {
      direction = dy > 0 ? "down" : "up";
    }
    move(direction);
  },
});

newGameBtn.addEventListener("click", newBoard);
winNewGameBtn.addEventListener("click", newBoard);
gameoverNewGameBtn.addEventListener("click", newBoard);
keepGoingBtn.addEventListener("click", () => {
  winOverlay.hidden = true;
});

createGrid();
bestValueEl.textContent = String(best);
newBoard();
