const PALETTE = [
  { name: 'indigo',   hex: '#9b34e9' },
  { name: 'azure',    hex: '#2c7ce5' },
  { name: 'malachite',hex: '#49cc5c' },
  { name: 'saffron',  hex: '#f8c421' },
  { name: 'tomato',   hex: '#fb6640' },
  { name: 'fuchsia',  hex: '#f82553' },
];

let state = {
  mode: 'solo',
  phase: 'playing',
  secret: [],
  codeLength: 4,
  maxAttempts: 10,
  allowDuplicates: true,
  currentAttempt: 0,
  currentSlot: 0,
  selectedColor: null,
  guesses: [],
  enabledColors: [...PALETTE],
  gameOver: false,
};

let codeEntryState = {
  selectedColor: null,
  slots: [],
  currentSlot: 0,
};

const boardEl    = document.getElementById('board');
const msgEl      = document.getElementById('message');
const wheelEl    = document.getElementById('color-wheel');
const overlayEl  = document.getElementById('win-overlay');
const winTitle   = document.getElementById('win-title');
const winDetail  = document.getElementById('win-detail');
const btnNew     = document.getElementById('btn-new-game');
const btnReset   = document.getElementById('btn-reset');
const btnAgain   = document.getElementById('btn-play-again');
const codeLenIn  = document.getElementById('code-length');
const maxAttIn   = document.getElementById('max-attempts');
const dupesCheck = document.getElementById('allow-duplicates');
// const debugCheck = document.getElementById('debug-mode');
// const debugCodeEl = document.getElementById('debug-code');
const codeEntryOverlay = document.getElementById('code-entry-overlay');
const codeEntryBoard   = document.getElementById('code-entry-board');
const codeEntryPalette = document.getElementById('code-entry-palette');
const btnClearCode     = document.getElementById('btn-clear-code');
const btnLockCode      = document.getElementById('btn-lock-code');
const modeBtns         = document.querySelectorAll('.mode-btn');

/* ---------- init ---------- */

const DEFAULTS = {
  mode: 'solo',
  codeLength: 4,
  maxAttempts: 10,
  allowDuplicates: true,
};

function resetDefaults() {
  state.mode = DEFAULTS.mode;
  codeLenIn.value = DEFAULTS.codeLength;
  maxAttIn.value = DEFAULTS.maxAttempts;
  dupesCheck.checked = DEFAULTS.allowDuplicates;
  modeBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.mode === DEFAULTS.mode);
  });
}

// function updateDebugDisplay() {
//   if (!debugCheck.checked || state.gameOver || state.secret.length === 0) {
//     debugCodeEl.classList.add('hidden');
//     return;
//   }
//   debugCodeEl.innerHTML = state.secret.map(c =>
//     `<span class="debug-peg" style="background:${c.hex}" title="${c.name}"></span>`
//   ).join('');
//   debugCodeEl.classList.remove('hidden');
// }

function init() {
  btnNew.addEventListener('click', startGame);
  btnAgain.addEventListener('click', () => { overlayEl.classList.add('hidden'); startGame(); });
  btnReset.addEventListener('click', () => { resetDefaults(); startGame(); });
  btnClearCode.addEventListener('click', clearCodeEntry);
  btnLockCode.addEventListener('click', lockCode);
  // debugCheck.addEventListener('change', updateDebugDisplay);

  modeBtns.forEach(b => b.addEventListener('click', () => {
    modeBtns.forEach(m => m.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.mode;
  }));

  startGame();
}

/* ---------- start ---------- */

function startGame() {
  state.codeLength  = clamp(parseInt(codeLenIn.value) || 4, 2, 6);
  state.maxAttempts = clamp(parseInt(maxAttIn.value) || 10, 4, 20);
  state.allowDuplicates = dupesCheck.checked;
  codeLenIn.value   = state.codeLength;
  maxAttIn.value    = state.maxAttempts;

  state.enabledColors = [...PALETTE];

  state.currentAttempt = 0;
  state.currentSlot    = 0;
  state.selectedColor  = null;
  state.guesses        = [{ colors: new Array(state.codeLength).fill(null), feedback: [] }];
  state.gameOver       = false;
  state.phase          = 'playing';

  if (state.mode === '2p') {
    showCodeEntry();
  } else {
    state.secret = generateSecret();
    renderBoard();
    // updateDebugDisplay();
    setMessage(`Attempt 1 / ${state.maxAttempts} \u2014 pick a color, then click a slot`);
  }
}

/* ---------- code entry (2P) ---------- */

function showCodeEntry() {
  codeEntryState = { selectedColor: null, slots: new Array(state.codeLength).fill(null), currentSlot: 0 };
  codeEntryOverlay.classList.remove('hidden');
  renderCodeEntryPalette();
  renderCodeEntryBoard();
  updateLockButton();
}

function renderCodeEntryPalette() {
  codeEntryPalette.innerHTML = '';
  state.enabledColors.forEach(c => {
    const d = document.createElement('div');
    d.className = 'palette-color';
    d.style.background = c.hex;
    d.title = c.name;
    d.addEventListener('click', () => {
      codeEntryState.selectedColor = c;
      codeEntryPalette.querySelectorAll('.palette-color').forEach(el => el.classList.remove('active'));
      d.classList.add('active');
    });
    codeEntryPalette.appendChild(d);
  });
}

function renderCodeEntryBoard() {
  codeEntryBoard.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'row';

  for (let s = 0; s < state.codeLength; s++) {
    const hole = document.createElement('div');
    hole.className = 'hole';
    if (s < codeEntryState.currentSlot) {
      hole.classList.add('filled');
      hole.style.background = codeEntryState.slots[s].hex;
    }
    if (s === codeEntryState.currentSlot) {
      hole.classList.add('active');
    }
    hole.addEventListener('click', () => codeEntrySlotClick(s));
    row.appendChild(hole);
  }
  codeEntryBoard.appendChild(row);
}

function codeEntrySlotClick(s) {
  if (!codeEntryState.selectedColor) return;
  codeEntryState.slots[s] = codeEntryState.selectedColor;
  if (s >= codeEntryState.currentSlot) codeEntryState.currentSlot = Math.min(s + 1, state.codeLength);
  renderCodeEntryBoard();
  updateLockButton();
}

function clearCodeEntry() {
  codeEntryState.slots = new Array(state.codeLength).fill(null);
  codeEntryState.currentSlot = 0;
  codeEntryState.selectedColor = null;
  renderCodeEntryBoard();
  updateLockButton();
}

function updateLockButton() {
  btnLockCode.disabled = codeEntryState.slots.some(c => c === null);
}

function lockCode() {
  if (codeEntryState.slots.some(c => c === null)) return;
  state.secret = [...codeEntryState.slots];
  codeEntryOverlay.classList.add('hidden');
  renderBoard();
  // updateDebugDisplay();
  setMessage(`Attempt 1 / ${state.maxAttempts} \u2014 Player 2: pick a color, then click a slot`);
}

/* ---------- main board render ---------- */

function renderBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < state.maxAttempts; r++) {
    const row = document.createElement('div');
    row.className = 'row';

    const num = document.createElement('div');
    num.className = 'row-number';
    num.textContent = r + 1;
    row.appendChild(num);

    for (let s = 0; s < state.codeLength; s++) {
      const hole = document.createElement('div');
      hole.className = 'hole';
      hole.dataset.attempt = r;
      hole.dataset.slot = s;

      if (r < state.currentAttempt) {
        const g = state.guesses[r];
        hole.classList.add('filled', 'locked');
        hole.style.background = g.colors[s].hex;
      } else if (r === state.currentAttempt) {
        if (s < state.currentSlot) {
          const g = state.guesses[state.currentAttempt];
          hole.classList.add('filled');
          hole.style.background = g.colors[s].hex;
        }
        if (s === state.currentSlot && !state.gameOver) {
          hole.classList.add('active');
        }
      } else {
        hole.classList.add('locked');
      }
      row.appendChild(hole);
    }

    const fb = document.createElement('div');
    fb.className = 'feedback';
    for (let f = 0; f < state.codeLength; f++) {
      const fp = document.createElement('div');
      fp.className = 'fb-peg';
      if (r < state.currentAttempt) {
        const fbData = state.guesses[r].feedback;
        if (f < fbData.length) {
          fp.classList.add(fbData[f]);
        } else {
          fp.classList.add('empty');
        }
      } else {
        fp.classList.add('empty');
      }
      fb.appendChild(fp);
    }
    row.appendChild(fb);
    boardEl.appendChild(row);
  }
}

/* ---------- color wheel ---------- */

function showWheel(holeEl) {
  hideWheel();
  const rect = holeEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = 48;
  const colors = state.enabledColors;

  wheelEl.style.left = (cx - 65) + 'px';
  wheelEl.style.top  = (cy - 65) + 'px';

  wheelEl.innerHTML = '';
  colors.forEach((c, i) => {
    const angle = (i / colors.length) * 2 * Math.PI - Math.PI / 2;
    const btn = document.createElement('div');
    btn.className = 'wheel-btn';
    btn.style.background = c.hex;
    btn.style.left = (65 - 17 + Math.cos(angle) * radius) + 'px';
    btn.style.top  = (65 - 17 + Math.sin(angle) * radius) + 'px';
    btn.title = c.name;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      placeColor(c);
      hideWheel();
    });
    wheelEl.appendChild(btn);
  });
  wheelEl.classList.remove('hidden');
}

function hideWheel() {
  wheelEl.classList.add('hidden');
  wheelEl.innerHTML = '';
}

function placeColor(c) {
  if (state.gameOver) return;
  state.selectedColor = c;
  const guess = state.guesses[state.currentAttempt];
  guess.colors[state.currentSlot] = c;

  state.currentSlot = guess.colors.findIndex(x => x === null);
  if (state.currentSlot === -1) state.currentSlot = state.codeLength;

  renderBoard();
  setMessage(state.currentSlot === state.codeLength
    ? 'All slots filled \u2014 press Enter to guess'
    : `${c.name} placed \u2014 click another slot`);
}

/* ---------- interaction ---------- */

boardEl.addEventListener('click', e => {
  const hole = e.target.closest('.hole');
  if (!hole) return;
  const r = parseInt(hole.dataset.attempt);
  const s = parseInt(hole.dataset.slot);
  if (isNaN(r) || isNaN(s)) return;
  if (state.gameOver || r !== state.currentAttempt) return;
  if (hole.classList.contains('locked')) return;
  state.currentSlot = s;
  showWheel(hole);
});

document.addEventListener('click', e => {
  if (!wheelEl.classList.contains('hidden') && !e.target.closest('.color-wheel') && !e.target.closest('.hole')) {
    hideWheel();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideWheel();
  if (state.gameOver) return;
  if (!codeEntryOverlay.classList.contains('hidden')) return;
  if (e.key === 'Enter') submitGuess();
  if (e.key === 'Backspace') undoLastSlot();
});

function undoLastSlot() {
  if (state.gameOver || state.currentSlot === 0) return;
  const guess = state.guesses[state.currentAttempt];
  state.currentSlot--;
  guess.colors[state.currentSlot] = null;
  renderBoard();
}

function submitGuess() {
  if (state.gameOver) return;
  const guess = state.guesses[state.currentAttempt];
  if (guess.colors.some(c => c === null)) {
    setMessage(`Fill all ${state.codeLength} slots before submitting`);
    return;
  }

  guess.feedback = evaluate(guess.colors);
  const correct = guess.feedback.filter(f => f === 'correct').length;

  if (correct === state.codeLength) {
    state.gameOver = true;
    renderBoard();
    showWin(true);
    return;
  }

  state.currentAttempt++;
  state.currentSlot = 0;
  state.guesses.push({ colors: new Array(state.codeLength).fill(null), feedback: [] });

  if (state.currentAttempt >= state.maxAttempts) {
    state.gameOver = true;
    renderBoard();
    showWin(false);
    return;
  }

  renderBoard();
  setMessage(`Attempt ${state.currentAttempt + 1} / ${state.maxAttempts} \u2014 pick a color`);
}

/* ---------- evaluate ---------- */

function evaluate(guess) {
  const fb = new Array(state.codeLength).fill(null);
  const secretUsed = new Array(state.codeLength).fill(false);
  const guessUsed  = new Array(state.codeLength).fill(false);

  for (let i = 0; i < state.codeLength; i++) {
    if (guess[i].name === state.secret[i].name) {
      fb[i] = 'correct';
      secretUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  for (let i = 0; i < state.codeLength; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < state.codeLength; j++) {
      if (secretUsed[j]) continue;
      if (guess[i].name === state.secret[j].name) {
        fb[i] = 'wrong-pos';
        secretUsed[j] = true;
        break;
      }
    }
  }

  return fb.filter(Boolean);
}

/* ---------- helpers ---------- */

function generateSecret() {
  const pool = state.enabledColors;
  const code = [];
  if (state.allowDuplicates) {
    for (let i = 0; i < state.codeLength; i++) {
      code.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  } else {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (let i = 0; i < state.codeLength; i++) {
      code.push(shuffled[i % shuffled.length]);
    }
  }
  return code;
}

function showWin(won) {
  const attemptWord = state.currentAttempt === 1 ? 'attempt' : 'attempts';
  if (won) {
    winTitle.textContent = state.mode === '2p' ? 'Player 2 cracks it!' : 'You cracked it!';
    winDetail.textContent = `Solved in ${state.currentAttempt + 1} ${attemptWord}`;
  } else {
    winTitle.textContent = state.mode === '2p' ? 'Player 1 wins!' : 'Out of attempts';
    winDetail.textContent = `The code was: ${state.secret.map(c => c.name).join(', ')}`;
  }
  overlayEl.classList.remove('hidden');
}

function setMessage(t) { msgEl.textContent = t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

init();
