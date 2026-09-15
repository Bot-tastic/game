import { lockViewport, onPointer } from "../../shared/game-utils.js";
import { renderJoinScreen } from "../../shared/multiplayer/trystero-room.js";

const GAME_SLUG = "connect-four-duel";
const COLS = 7;
const ROWS = 6;

// board[col][row], row 0 = top, row (ROWS-1) = bottom. 0 = empty, 1 = player1 (red), 2 = player2 (yellow)
const board = [];
for (let c = 0; c < COLS; c++) {
  board.push(new Array(ROWS).fill(0));
}

let currentTurn = 1; // player 1 (host) always starts
let localPlayerNumber = null; // 1 or 2, set once role is known
let room = null;
let sendMove = null;
let gameOver = false;

const boardEl = document.getElementById("board");
const menuOverlay = document.getElementById("menu-overlay");
const joinContainer = document.getElementById("join-container");
const opponentLeftOverlay = document.getElementById("opponent-left-overlay");
const resultOverlay = document.getElementById("result-overlay");
const resultMessageEl = document.getElementById("result-message");
const turnIndicatorEl = document.getElementById("turn-indicator");
const youColorEl = document.getElementById("you-color");
const oppColorEl = document.getElementById("opp-color");

document.getElementById("opponent-left-back").addEventListener("click", () => location.reload());
document.getElementById("result-back").addEventListener("click", () => location.reload());

lockViewport(boardEl);

// ---- Build the DOM grid: 7 columns x 6 rows, each column a clickable strip ----
const columnEls = [];
for (let c = 0; c < COLS; c++) {
  const colEl = document.createElement("div");
  colEl.className = "column";
  colEl.dataset.col = String(c);

  const cellEls = [];
  for (let r = 0; r < ROWS; r++) {
    const cellEl = document.createElement("div");
    cellEl.className = "cell";
    const discEl = document.createElement("div");
    discEl.className = "disc";
    cellEl.appendChild(discEl);
    colEl.appendChild(cellEl);
    cellEls.push(cellEl);
  }

  boardEl.appendChild(colEl);
  columnEls.push(cellEls);

  onPointer(colEl, {
    onDown: () => handleColumnTap(c),
  });
}

function handleColumnTap(col) {
  if (gameOver) return;
  if (localPlayerNumber == null) return;
  // Turn enforcement: a player may only act when it's genuinely their turn.
  // This is what keeps both boards in lockstep without a central authority —
  // a move can only ever be SENT when it was that player's own turn, and the
  // reliable, ordered Trystero data channel delivers moves in the order they
  // were sent, so there's never a race: only one side is ever authorized to
  // originate a move at any given moment, and turns strictly alternate.
  if (currentTurn !== localPlayerNumber) return;

  const row = dropDisc(board, col, localPlayerNumber);
  if (row === -1) return; // column full, ignore (columns should be disabled before this happens)

  renderDisc(col, row, localPlayerNumber);

  const won = checkWin(board, col, row, localPlayerNumber);
  if (won) {
    gameOver = true;
    showResult("You Win!");
    updateColumnInteractivity();
    return;
  }

  if (isBoardFull(board)) {
    gameOver = true;
    showResult("Draw");
    updateColumnInteractivity();
    return;
  }

  // Not a win/draw: flip turn locally, then transmit the move.
  currentTurn = localPlayerNumber === 1 ? 2 : 1;
  updateTurnIndicator();
  updateColumnInteractivity();
  sendMove && sendMove({ column: col });
}

function handleRemoteMove(data, otherPlayerNumber) {
  if (gameOver) return;
  const col = data.column;
  const row = dropDisc(board, col, otherPlayerNumber);
  if (row === -1) return; // defensive guard; should never happen

  renderDisc(col, row, otherPlayerNumber);

  const won = checkWin(board, col, row, otherPlayerNumber);
  if (won) {
    gameOver = true;
    showResult("You Lose");
    updateColumnInteractivity();
    return;
  }

  if (isBoardFull(board)) {
    gameOver = true;
    showResult("Draw");
    updateColumnInteractivity();
    return;
  }

  // Opponent's move didn't end the game: it's our turn again.
  currentTurn = localPlayerNumber;
  updateTurnIndicator();
  updateColumnInteractivity();
}

/** Deterministic drop: scans a column from the bottom row upward to find the
 * lowest empty row, places `player`'s value there, returns the landed row
 * index (or -1 if the column is already full). Called identically from the
 * local-tap path and the received-message path so both peers stay in lockstep. */
function dropDisc(board, column, player) {
  const col = board[column];
  for (let r = ROWS - 1; r >= 0; r--) {
    if (col[r] === 0) {
      col[r] = player;
      return r;
    }
  }
  return -1;
}

function isBoardFull(board) {
  for (let c = 0; c < COLS; c++) {
    if (board[c][0] === 0) return false;
  }
  return true;
}

/** Checks all 4 directions from (lastCol, lastRow) for 4-in-a-row of `player`. */
function checkWin(board, lastCol, lastRow, player) {
  const directions = [
    [1, 0], // horizontal
    [0, 1], // vertical
    [1, -1], // diagonal "/" (down-left to up-right)
    [1, 1], // diagonal "\" (up-left to down-right)
  ];

  for (const [dc, dr] of directions) {
    let count = 1; // the just-placed disc
    count += countDirection(board, lastCol, lastRow, dc, dr, player);
    count += countDirection(board, lastCol, lastRow, -dc, -dr, player);
    if (count >= 4) return true;
  }
  return false;
}

function countDirection(board, col, row, dc, dr, player) {
  let count = 0;
  let c = col + dc;
  let r = row + dr;
  while (c >= 0 && c < COLS && r >= 0 && r < ROWS && board[c][r] === player) {
    count++;
    c += dc;
    r += dr;
  }
  return count;
}

function renderDisc(col, row, player) {
  const cellEl = columnEls[col][row];
  cellEl.classList.add("filled");
  const discEl = cellEl.querySelector(".disc");
  discEl.classList.add(player === 1 ? "disc--p1" : "disc--p2");
}

function updateColumnInteractivity() {
  // Anti-double-tap guard + turn gating: columns are only "live" when it's
  // genuinely the local player's turn and the game isn't over.
  const myTurn = !gameOver && currentTurn === localPlayerNumber;
  boardEl.querySelectorAll(".column").forEach((colEl) => {
    colEl.classList.toggle("column--disabled", !myTurn);
  });
}

function updateTurnIndicator() {
  turnIndicatorEl.hidden = false;
  if (gameOver) return;
  turnIndicatorEl.textContent = currentTurn === localPlayerNumber ? "Your Turn" : "Opponent's Turn";
}

function showResult(message) {
  resultMessageEl.textContent = message;
  resultOverlay.hidden = false;
  turnIndicatorEl.hidden = true;
}

function showOpponentLeft() {
  opponentLeftOverlay.hidden = false;
}

function setupPlayerLabels() {
  if (localPlayerNumber === 1) {
    youColorEl.textContent = "Red";
    oppColorEl.textContent = "Yellow";
  } else {
    youColorEl.textContent = "Yellow";
    oppColorEl.textContent = "Red";
  }
}

function startGame({ room: r, role }) {
  room = r;
  localPlayerNumber = role === "host" ? 1 : 2;
  const otherPlayerNumber = localPlayerNumber === 1 ? 2 : 1;

  const [send, getMove] = room.makeAction("dropMove");
  sendMove = send;

  getMove((data) => handleRemoteMove(data, otherPlayerNumber));

  room.onPeerLeave(() => showOpponentLeft());

  setupPlayerLabels();
  menuOverlay.hidden = true;
  updateTurnIndicator();
  updateColumnInteractivity();
}

renderJoinScreen(joinContainer, {
  gameSlug: GAME_SLUG,
  onHostReady: (info) => startGame(info),
  onGuestReady: (info) => startGame(info),
  onError: (err) => {
    console.error("Multiplayer connection error:", err);
  },
});
