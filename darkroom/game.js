let state = {
  size: 5,
  grid: [],
  moves: 0,
  gameOver: false,
};

const boardEl    = document.getElementById('board');
const msgEl      = document.getElementById('message');
const movesEl    = document.getElementById('move-count');
const overlayEl  = document.getElementById('win-overlay');
const winDetail  = document.getElementById('win-detail');
const btnNew     = document.getElementById('btn-new-game');
const btnAgain   = document.getElementById('btn-play-again');
const sizeIn     = document.getElementById('grid-size');

/* ---------- init ---------- */

function init() {
  btnNew.addEventListener('click', startGame);
  btnAgain.addEventListener('click', () => { overlayEl.classList.add('hidden'); startGame(); });
  startGame();
}

/* ---------- game ---------- */

function startGame() {
  state.size = clamp(parseInt(sizeIn.value) || 5, 3, 9);
  sizeIn.value = state.size;
  state.moves = 0;
  state.gameOver = false;

  generatePuzzle();
  render();
  updateStats();
  setMessage('Click a light to toggle it and its neighbors');
}

function generatePuzzle() {
  const n = state.size;
  state.grid = Array.from({ length: n }, () => Array(n).fill(false));

  const clicks = 4 + Math.floor(Math.random() * (n * 2));
  for (let i = 0; i < clicks; i++) {
    toggle(Math.floor(Math.random() * n), Math.floor(Math.random() * n), true);
  }

  if (isWon()) toggle(0, 0, true);
}

function toggle(r, c, silent) {
  const n = state.size;
  const dirs = [[0,0],[0,1],[0,-1],[1,0],[-1,0]];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < n && nc >= 0 && nc < n) {
      state.grid[nr][nc] = !state.grid[nr][nc];
    }
  }
  if (!silent) {
    state.moves++;
    render();
    updateStats();
    checkWin();
  }
}

function checkWin() {
  if (!isWon()) return;
  state.gameOver = true;
  render();
  winDetail.textContent = `Solved in ${state.moves} moves`;
  overlayEl.classList.remove('hidden');
}

function isWon() {
  return state.grid.every(row => row.every(cell => !cell));
}

/* ---------- render ---------- */

function render() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${state.size}, 56px)`;

  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (state.grid[r][c] ? 'on' : 'off');
      if (state.gameOver && state.grid[r][c]) cell.classList.add('win');
      if (!state.gameOver) {
        cell.addEventListener('click', () => toggle(r, c, false));
      }
      boardEl.appendChild(cell);
    }
  }
}

function updateStats() {
  movesEl.textContent = `${state.moves} move${state.moves !== 1 ? 's' : ''}`;
}

function setMessage(t) { msgEl.textContent = t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

init();
