/* El Dorado — client (thin WebSocket renderer)
 * Connects to the server-authoritative game server. Renders state received
 * from the server; user clicks are sent as intent messages.
 */

const MAPS = {
  classic: { name: 'The Classic Route', desc: 'Beginner — mixed terrain, short path' },
  jungle:  { name: 'Jungle Crawl',      desc: 'Standard — heavy jungle, river crossings' },
  river:   { name: 'River Run',         desc: 'Advanced — long river & village stretches' },
};

const SYMBOL_CHAR = { machete: '🌿', paddle: '🌊', coin: '🪙' };

let ws;
const pendingMessages = [];
let myId = null;
let myColor = null;
let state = null;
let buyMode = false; // when true, hand clicks earmark for buying; when false, they play for movement

/* ---------- elements ---------- */

const el = {
  screenConnect: document.getElementById('screen-connect'),
  screenWaiting: document.getElementById('screen-waiting'),
  screenGame: document.getElementById('screen-game'),
  overlayGameOver: document.getElementById('overlay-gameover'),
  msgConnect: document.getElementById('msg-connect'),
  inputName: document.getElementById('input-name'),
  inputMap: document.getElementById('input-map'),
  inputRoom: document.getElementById('input-room'),
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  waitRoom: document.getElementById('wait-room'),
  waitPlayers: document.getElementById('wait-players'),
  waitHint: document.getElementById('wait-hint'),
  btnStart: document.getElementById('btn-start'),
  btnLeaveWait: document.getElementById('btn-leave-wait'),
  turnLabel: document.getElementById('turn-label'),
  phaseLabel: document.getElementById('phase-label'),
  coins: document.getElementById('coins'),
  map: document.getElementById('map'),
  hand: document.getElementById('hand'),
  marketRow: document.getElementById('market-row'),
  message: document.getElementById('message'),
  btnEndTurn: document.getElementById('btn-end-turn'),
  goTitle: document.getElementById('go-title'),
  goDetail: document.getElementById('go-detail'),
  buyModeBtn: null, // created below
};

/* ---------- connection ---------- */

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    while (pendingMessages.length > 0) {
      ws.send(JSON.stringify(pendingMessages.shift()));
    }
    setConnectMessage('');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'hello':
        populateMaps(msg.maps || Object.keys(MAPS));
        break;
      case 'joined':
        myId = msg.playerId;
        myColor = msg.color;
        state = msg.state;
        showScreen('waiting');
        renderWaiting();
        break;
      case 'state':
        state = msg.state;
        myId = msg.you !== undefined ? msg.you : myId;
        if (state.gameOver) {
          showScreen('game');
          showGameOver();
        } else {
          showScreen('game');
          render();
        }
        break;
      case 'error':
        setConnectMessage(msg.error);
        break;
    }
  };

  ws.onclose = () => {
    if (state && !state.gameOver) setConnectMessage('Disconnected from server.');
    ws = null;
  };

  ws.onerror = () => {
    setConnectMessage('Unable to connect to the game server.');
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else if (ws && ws.readyState === WebSocket.CONNECTING) {
    pendingMessages.push(obj);
  } else {
    setConnectMessage('Not connected to the game server. Please reload and try again.');
  }
}

function populateMaps(mapKeys) {
  const selectedMap = el.inputMap.value;
  el.inputMap.innerHTML = '';
  mapKeys.forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = `${MAPS[k] ? MAPS[k].name : k} — ${MAPS[k] ? MAPS[k].desc : ''}`;
    el.inputMap.appendChild(o);
  });
  if (mapKeys.includes(selectedMap)) el.inputMap.value = selectedMap;
}

/* ---------- screens ---------- */

function showScreen(name) {
  ['connect', 'waiting', 'game'].forEach((n) => {
    const screen = document.getElementById(`screen-${n}`);
    screen.classList.toggle('active', n === name);
    screen.classList.toggle('hidden', n !== name);
  });
  el.overlayGameOver.classList.add('hidden');
}

function setConnectMessage(t) { el.msgConnect.textContent = t; }

/* ---------- waiting lobby ---------- */

function renderWaiting() {
  if (!state) return;
  el.waitRoom.textContent = state.roomId;
  el.waitPlayers.innerHTML = '';
  state.players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = `player-chip${i === myId ? ' me' : ''}`;
    chip.textContent = `${p.isAI ? '🤖 ' : ''}${p.name}`;
    el.waitPlayers.appendChild(chip);
  });
  const bothJoined = state.players.filter((p) => !p.isAI).length >= 2;
  el.btnStart.hidden = !(state.mode === '2p' && myId === 0 && bothJoined);
  el.waitHint.textContent =
    state.mode === 'ai'
      ? 'Starting solo expedition vs AI…'
      : state.players.length >= 2
        ? 'Both players joined — starting…'
        : 'Waiting for opponent…';
}

/* ---------- game render ---------- */

function render() {
  if (!state) return;
  renderHud();
  renderMap();
  renderHand();
  renderMarket();
  renderMessage();
  renderEndTurn();
}

function renderHud() {
  const p = state.players[state.currentIndex];
  el.turnLabel.textContent = state.finalRound
    ? `FINAL ROUND — ${p.name}'s turn`
    : `${p.name}'s turn${p.isAI ? ' (AI)' : ''}`;
  el.phaseLabel.textContent = `Phase: ${state.phase.charAt(0).toUpperCase() + state.phase.slice()}`;
  el.coins.textContent = `Coins: ${state.coins}`;

  // buy mode toggle
  if (!el.buyModeBtn) {
    el.buyModeBtn = document.createElement('button');
    el.buyModeBtn.className = 'btn-secondary btn-sm';
    el.buyModeBtn.id = 'btn-buy-mode';
    el.buyModeBtn.textContent = buyMode ? '💰 Buy Mode' : '🚶 Move Mode';
    el.buyModeBtn.addEventListener('click', () => {
      buyMode = !buyMode;
      state.buyCandidates = [];
      state.coins = 0;
      render();
    });
    el.btnEndTurn.insertAdjacentElement('afterend', el.buyModeBtn);
  }
  el.buyModeBtn.textContent = buyMode ? '💰 Buy Mode' : '🚶 Move Mode';
  el.buyModeBtn.classList.toggle('active', buyMode);
}

function renderMap() {
  el.map.innerHTML = '';
  state.route.forEach((space, i) => {
    const hex = document.createElement('div');
    hex.className = `hex ${space.terrain}${space.gate ? ' dorado' : ''}`;
    hex.style.backgroundColor = {
      jungle: '#3a7d44', river: '#2f6db5', village: '#c9a227',
      rubble: '#8a7d68', camp: '#b5484a', mountain: '#353535',
    }[space.terrain];
    const t = {
      jungle: { symbol: '🌿' }, river: { symbol: '🌊' }, village: { symbol: '🏛️' },
      rubble: { symbol: '⛰️' }, camp: { symbol: '⛺' }, mountain: { symbol: '⬛' },
    }[space.terrain];
    hex.innerHTML = `
      <div class="symbol">${space.gate ? '🏆' : t.symbol}</div>
      ${space.power > 0 ? `<div class="power">${space.power}</div>` : ''}
      <div class="label">${space.label}</div>
    `;
    const pieces = document.createElement('div');
    pieces.className = 'pieces';
    state.players.forEach((pl) => {
      if (pl.pos === i) {
        const piece = document.createElement('div');
        piece.className = 'piece';
        piece.style.backgroundColor = pl.color;
        piece.title = `${pl.name}${pl.isAI ? ' (AI)' : ''}`;
        pieces.appendChild(piece);
      }
    });
    hex.appendChild(pieces);
    el.map.appendChild(hex);
  });
}

function renderHand() {
  el.hand.innerHTML = '';
  const me = state.players[state.myId !== undefined ? state.myId : myId];
  const hand = state.hands && state.hands[state.myId !== undefined ? state.myId : myId];
  if (!hand) return;

  hand.forEach((card, i) => {
    const elCard = document.createElement('div');
    elCard.className = `card symbol-${card.symbol || 'action'} ${
      state.buyCandidates && state.buyCandidates.includes(i) ? 'earmarked' : ''
    }`;
    elCard.title = `${card.name} — ${card.symbol || 'action'} ${card.power}${card.cost ? ` · cost ${card.cost}` : ''}`;
    elCard.addEventListener('click', () => onHandCardClick(i));
    elCard.innerHTML = `
      <div class="symbol">${card.symbol ? SYMBOL_CHAR[card.symbol] : '🪄'}</div>
      <div class="name">${card.name}</div>
      <div class="stats">
        <div class="power">${card.power}</div>
        ${card.cost > 0 ? `<div class="cost buyable">${card.cost}</div>` : ''}
      </div>
    `;
    el.hand.appendChild(elCard);
  });
}

function renderMarket() {
  el.marketRow.innerHTML = '';
  const me = state.players[state.myId !== undefined ? state.myId : myId];
  state.market.forEach((card, i) => {
    const elCard = document.createElement('div');
    const affordable = card && state.coins >= card.cost - 1e-9 && !state.buyUsed;
    elCard.className = `market-card symbol-${card ? (card.symbol || 'action') : 'empty'} ${
      !card ? 'empty' : affordable ? '' : 'unaffordable'
    }`;
    if (!card) {
      elCard.innerHTML = '<div class="symbol">—</div><div class="name">Empty</div>';
      el.marketRow.appendChild(elCard);
      return;
    }
    const action = state.freePick === state.myId ? 'freePick' : 'buy';
    elCard.addEventListener('click', () => onMarketCardClick(i));
    elCard.innerHTML = `
      <div class="symbol">${card.symbol ? SYMBOL_CHAR[card.symbol] : '🪄'}</div>
      <div class="name">${card.name}</div>
      <div class="stats">
        <div class="power">${card.power}</div>
        <div class="cost buyable">${card.cost}</div>
      </div>
    `;
    elCard.title = `${card.name} — ${action === 'freePick' ? 'FREE (Transmitter)' : `cost ${card.cost}`}`;
    el.marketRow.appendChild(elCard);
  });
}

function renderMessage() {
  el.message.textContent = state.message;
}

function renderEndTurn() {
  const me = state.players[state.myId !== undefined ? state.myId : myId];
  const myTurn = state.currentIndex === state.myId && !state.gameOver && !state.freePick;
  el.btnEndTurn.classList.toggle('hidden', !myTurn || state.freePick !== null);
  el.btnEndTurn.disabled = !me || me.isAI;
  if (el.buyModeBtn) el.buyModeBtn.disabled = !myTurn || state.freePick !== null;
}

/* ---------- interaction ---------- */

function onHandCardClick(i) {
  if (state.freePick !== null || state.gameOver || state.currentIndex !== state.myId) return;
  const card = state.hands[state.myId][i];
  if (!card) return;

  if (buyMode) {
    // earmark / un-earmark for buying
    send({ type: 'toggle_buy', cardIndex: i });
  } else if (card.action) {
    send({ type: 'play_card', cardIndex: i });
  } else {
    send({ type: 'play_card', cardIndex: i });
  }
}

function onMarketCardClick(i) {
  if (state.gameOver || state.currentIndex !== state.myId) return;
  if (state.freePick === state.myId) {
    send({ type: 'free_pick', marketIndex: i });
  } else {
    send({ type: 'buy_card', marketIndex: i });
  }
}

/* ---------- game over ---------- */

function showGameOver() {
  const me = state.players[state.myId];
  const winnerId = state.finishedOrder[0];
  const winner = state.players.find((p) => p.id === winnerId);
  const youWon = winnerId === myId;
  el.goTitle.textContent = youWon ? 'You found El Dorado!' : `${winner ? winner.name : 'Someone'} found El Dorado first!`;
  el.goDetail.textContent = youWon
    ? 'The golden city is yours.'
    : `The expedition is over. ${state.message}`;
  el.overlayGameOver.classList.remove('hidden');
}

/* ---------- init ---------- */

function init() {
  populateMaps(Object.keys(MAPS));
  connect();

  el.btnCreate.addEventListener('click', () => {
    const mode = document.querySelector('.mode-btn.active').dataset.mode;
    const mapKey = el.inputMap.value;
    send({ type: 'join', name: el.inputName.value.trim() || 'Player', mode, mapKey });
  });

  el.btnJoin.addEventListener('click', () => {
    const mode = document.querySelector('.mode-btn.active').dataset.mode;
    send({
      type: 'join',
      name: el.inputName.value.trim() || 'Player',
      mode,
      mapKey: el.inputMap.value,
      room: el.inputRoom.value.trim().toUpperCase(),
    });
  });

  el.btnStart.addEventListener('click', () => send({ type: 'start' }));

  el.btnLeaveWait.addEventListener('click', () => { showScreen('connect'); });

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((m) => m.classList.remove('active'));
      b.classList.add('active');
    });
  });

  el.btnEndTurn.addEventListener('click', () => send({ type: 'end_turn' }));

  document.getElementById('btn-go-menu').addEventListener('click', () => {
    showScreen('connect');
    state = null;
  });
  document.getElementById('btn-go-again').addEventListener('click', () => location.reload());
}

init();
