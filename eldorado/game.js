/* El Dorado — client (thin WebSocket renderer)
 * Connects to the server-authoritative game server. Renders state received
 * from the server; user clicks are sent as intent messages.
 */

const MAPS = {
  classic: { name: 'The Classic Route', desc: 'Beginner — mixed terrain, short path' },
  jungle:  { name: 'Jungle Crawl',      desc: 'Standard — heavy jungle, river crossings' },
  river:   { name: 'River Run',         desc: 'Advanced — long river & village stretches' },
  isthmus: { name: 'The Isthmus',       desc: 'Expert — narrow jungle neck with river detour' },
  delta:   { name: 'The River Delta',   desc: 'Expert — many villages, rubble, and base camps' },
};

const SYMBOL_CHAR = { machete: '🌿', paddle: '🌊', coin: '🪙', wild: '⚪' };

const CARD_ARTWORK = {
  sailor: 'sailor',
  explorer: 'explorer',
  traveler: 'traveler',
  scout: 'scout',
  trailblazer: 'trailblazer',
  pioneer: 'pioneer',
  giantMachete: 'giant-machete',
  captain: 'captain',
  photographer: 'photographer',
  journalist: 'journalist',
  treasureChest: 'treasure-chest',
  millionaire: 'millionaire',
  jackOfAllTrades: 'jack-of-all-trades',
  adventurer: 'adventurer',
  propPlane: 'prop-plane',
  scientist: 'scientist',
  transmitter: 'transmitter',
  cartographer: 'cartographer',
  compass: 'compass',
  travelLog: 'travel-log',
  native: 'native',
};

const CARD_RULES = {
  giantMachete: 'Move through jungle with strength 6. Remove this card from the game after using it.',
  propPlane: 'Choose jungle, river, or village and move with strength 4. Remove this card from the game after using it.',
  transmitter: 'Take any available marketplace card for free and put it in your discard pile. Remove this card from the game after use.',
  cartographer: 'Draw 2 cards. You may play the drawn cards this turn.',
  compass: 'Draw 3 cards, then remove this card from the game.',
  travelLog: 'Draw 2 cards, then you may remove up to 2 cards from your hand. Remove this card from the game after use.',
  scientist: 'Draw 1 card, then you may remove 1 card from your hand. Remove this card from the game after use.',
  native: 'Move to an adjacent non-mountain, unoccupied space without meeting its terrain requirement.',
};

let ws;
const pendingMessages = [];
let myId = null;
let myColor = null;
let state = null;
let buyMode = false;
let selectedCardIndexes = new Set();
let selectedWildCardIndex = null;
let paymentMode = false;
let removalContext = '';
let paymentContext = '';
let cardPreviewAction = null;

/* ---------- elements ---------- */

const el = {
  screenConnect: document.getElementById('screen-connect'),
  screenWaiting: document.getElementById('screen-waiting'),
  screenGame: document.getElementById('screen-game'),
  overlayGameOver: document.getElementById('overlay-gameover'),
  overlayCardPreview: document.getElementById('overlay-card-preview'),
  cardPreviewCard: document.getElementById('card-preview-card'),
  cardPreviewRule: document.getElementById('card-preview-rule'),
  btnCloseCardPreview: document.getElementById('btn-close-card-preview'),
  btnCardPreviewAction: document.getElementById('btn-card-preview-action'),
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
  cardControls: document.getElementById('card-controls'),
  marketRow: document.getElementById('market-row'),
  message: document.getElementById('message'),
  btnEndTurn: document.getElementById('btn-end-turn'),
  goTitle: document.getElementById('go-title'),
  goDetail: document.getElementById('go-detail'),
  buyModeBtn: null,
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
    try {
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
          if (state) el.message.textContent = msg.error;
          else setConnectMessage(msg.error);
          break;
      }
    } catch (e) {
      console.error('WS message error:', e);
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
  if (!el.inputMap) return;
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
  renderCardControls();
  renderMessage();
  renderEndTurn();
}

function renderHud() {
  const p = state.players[state.currentIndex];
  el.turnLabel.textContent = state.finalRound
    ? `FINAL ROUND — ${p.name}'s turn`
    : `${p.name}'s turn${p.isAI ? ' (AI)' : ''}`;
  el.phaseLabel.textContent = `Phase: ${state.phase.charAt(0).toUpperCase() + state.phase.slice(1)}`;
  el.coins.textContent = `Coins: ${state.coins}`;

  if (!el.buyModeBtn) {
    el.buyModeBtn = document.createElement('button');
    el.buyModeBtn.className = 'btn-secondary btn-sm';
    el.buyModeBtn.id = 'btn-buy-mode';
    el.buyModeBtn.textContent = buyMode ? '💰 Buy Mode' : '🚶 Move Mode';
    el.buyModeBtn.addEventListener('click', () => {
      if (buyMode) {
        (state.buyCandidates || []).forEach(i => send({ type: 'toggle_buy', cardIndex: i }));
      }
      buyMode = !buyMode;
      selectedCardIndexes.clear();
      selectedWildCardIndex = null;
      paymentMode = false;
      render();
    });
    el.btnEndTurn.insertAdjacentElement('afterend', el.buyModeBtn);
  }
  el.buyModeBtn.textContent = buyMode ? '💰 Buy Mode' : '🚶 Move Mode';
  el.buyModeBtn.classList.toggle('active', buyMode);
}

function renderMap() {
  el.map.innerHTML = '';
  const mapStyles = getComputedStyle(el.map);
  const hexWidth = parseFloat(mapStyles.getPropertyValue('--hex-width')) || 56;
  const hexHeight = parseFloat(mapStyles.getPropertyValue('--hex-height')) || 64;
  const hexStep = hexWidth * 0.75;
  const bundleSize = 5;
  const bundleColumns = 3;
  const bundlePadding = parseFloat(mapStyles.getPropertyValue('--bundle-padding')) || 8;
  const bundleGap = parseFloat(mapStyles.getPropertyValue('--bundle-gap')) || 8;
  const bundleCount = Math.ceil(state.route.length / bundleSize);
  const bundleWidth = hexWidth + (bundleColumns - 1) * hexStep + bundlePadding * 2;
  const bundleHeight = hexHeight * 2.5 + bundlePadding * 2;
  const mapTrack = document.createElement('div');
  mapTrack.className = 'map-track';
  mapTrack.style.width = `${bundleCount * bundleWidth + (bundleCount - 1) * bundleGap}px`;
  const bundleTop = (index) => (index % 2 === 0 ? 0 : hexHeight * 0.75);
  mapTrack.style.height = `${bundleHeight + (bundleCount > 1 ? hexHeight * 0.75 : 0)}px`;
  el.map.appendChild(mapTrack);

  const centers = [];
  for (let bundleIndex = 0, routeIndex = 0; bundleIndex < bundleCount; bundleIndex++) {
    const bundle = document.createElement('div');
    bundle.className = 'map-bundle';
    const bundleLeft = bundleIndex * (bundleWidth + bundleGap);
    const bundleY = bundleTop(bundleIndex);
    bundle.style.left = `${bundleLeft}px`;
    bundle.style.top = `${bundleY}px`;
    bundle.style.width = `${bundleWidth}px`;
    bundle.style.height = `${bundleHeight}px`;
    mapTrack.appendChild(bundle);

    const spacesInBundle = Math.min(bundleSize, state.route.length - routeIndex);
    for (let localIndex = 0; localIndex < spacesInBundle; localIndex++, routeIndex++) {
      const row = Math.floor(localIndex / bundleColumns);
      const indexInRow = localIndex % bundleColumns;
      const column = row % 2 === 0 ? indexInRow : bundleColumns - 1 - indexInRow;
      const left = bundlePadding + column * hexStep;
      const top = bundlePadding + row * hexHeight + (column % 2 === 0 ? hexHeight / 2 : 0);
      const space = state.route[routeIndex];
      const hex = document.createElement('div');
      hex.className = `hex ${space.terrain}${space.gate ? ' dorado' : ''}`;
      hex.title = `${space.label}${space.power > 0 ? ` · power ${space.power}` : ''}`;
      hex.style.left = `${left}px`;
      hex.style.top = `${top}px`;
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
        if (pl.pos === routeIndex) {
          const piece = document.createElement('div');
          piece.className = 'piece';
          piece.style.backgroundColor = pl.color;
          piece.title = `${pl.name}${pl.isAI ? ' (AI)' : ''}`;
          pieces.appendChild(piece);
        }
      });
      hex.appendChild(pieces);
      bundle.appendChild(hex);
      centers[routeIndex] = {
        x: bundleLeft + left + hexWidth / 2,
        y: bundleY + top + hexHeight / 2,
      };
    }
  }

  if (bundleCount > 1) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const connectors = document.createElementNS(svgNS, 'svg');
    connectors.classList.add('map-connectors');
    connectors.setAttribute('viewBox', `0 0 ${parseFloat(mapTrack.style.width)} ${parseFloat(mapTrack.style.height)}`);
    connectors.setAttribute('aria-hidden', 'true');
    mapTrack.prepend(connectors);
    for (let bundleIndex = 0; bundleIndex < bundleCount - 1; bundleIndex++) {
      const routeIndex = Math.min((bundleIndex + 1) * bundleSize, state.route.length) - 1;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', centers[routeIndex].x);
      line.setAttribute('y1', centers[routeIndex].y);
      line.setAttribute('x2', centers[routeIndex + 1].x);
      line.setAttribute('y2', centers[routeIndex + 1].y);
      connectors.appendChild(line);
    }
  }
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
    if (CARD_ARTWORK[card.id]) elCard.classList.add('has-art');
    elCard.classList.toggle('selected', selectedCardIndexes.has(i) || selectedWildCardIndex === i);
    elCard.title = `${card.name} — ${card.symbol || 'action'} ${card.power}${card.cost ? ` · cost ${card.cost}` : ''}`;

    // Direct click-to-play: in move mode, movement cards play immediately.
    // In buy mode, click earmarks for purchase. Action/wild cards show preview.
    elCard.addEventListener('click', () => onHandCardClick(i));
    elCard.innerHTML = cardFaceMarkup(card, false);
    el.hand.appendChild(elCard);
  });

  const deck = document.createElement('div');
  const deckSize = me?.deckSize || 0;
  deck.className = 'draw-deck';
  deck.style.setProperty('--deck-depth', `${deckSize * 2}px`);
  deck.title = `${deckSize} card${deckSize === 1 ? '' : 's'} remaining in your draw deck`;
  deck.setAttribute('role', 'img');
  deck.setAttribute('aria-label', deck.title);
  deck.innerHTML = `<div class="draw-deck-face"><span>Draw deck</span><strong>${deckSize}</strong></div>`;
  el.hand.appendChild(deck);
}

function cardFaceMarkup(card, showCost) {
  const artwork = CARD_ARTWORK[card.id];
  const stats = `
    <div class="stats">
      <div class="power">${card.power}</div>
      ${showCost || card.cost > 0 ? `<div class="cost buyable">${card.cost}</div>` : ''}
    </div>
  `;
  if (!artwork) {
    return `
      <div class="symbol">${card.symbol ? SYMBOL_CHAR[card.symbol] || '⚪' : '🪄'}</div>
      <div class="name">${card.name}</div>
      ${stats}
    `;
  }
  return `
    <img class="card-art" src="artwork_v2/${artwork}.png" alt="">
    <div class="card-info">${stats}</div>
  `;
}

function renderMarket() {
  el.marketRow.innerHTML = '';
  if (state.freePick === myId) {
    state.marketSupply.forEach((card, i) => {
      const elCard = document.createElement('div');
      elCard.className = `market-card symbol-${card.symbol || 'action'}${CARD_ARTWORK[card.id] ? ' has-art' : ''}`;
      elCard.innerHTML = `${cardFaceMarkup(card, true)}<div class="stock-count">${card.count} left</div>`;
      elCard.title = `Take ${card.name} for free — ${card.count} available`;
      elCard.addEventListener('click', () => onMarketCardClick(i, card.id));
      el.marketRow.appendChild(elCard);
    });
    return;
  }

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
    if (CARD_ARTWORK[card.id]) elCard.classList.add('has-art');
    elCard.addEventListener('click', () => onMarketCardClick(i, card.id));
    elCard.innerHTML = cardFaceMarkup(card, true);
    elCard.title = `${card.name} — cost ${card.cost}`;
    el.marketRow.appendChild(elCard);
  });
}

function renderCardControls() {
  if (!state) return;
  const pending = state.pendingRemoval?.playerIndex === myId ? state.pendingRemoval : null;
  const removalKey = pending ? `${pending.playerIndex}:${pending.max}` : '';
  if (removalKey !== removalContext) {
    selectedCardIndexes.clear();
    removalContext = removalKey;
  }

  const player = state.players[myId];
  const next = player && state.route[player.pos + 1];
  const special = next && ['rubble', 'camp'].includes(next.terrain) ? next : null;
  const nextKey = special ? `${player.pos}:${special.terrain}:${special.power}` : '';
  if (paymentMode && nextKey !== paymentContext) {
    paymentMode = false;
    selectedCardIndexes.clear();
  }
  if (!paymentMode) paymentContext = nextKey;

  const myTurn = state.currentIndex === myId && !state.gameOver && state.freePick === null;
  if (!myTurn) {
    el.cardControls.classList.add('hidden');
    el.cardControls.innerHTML = '';
    renderEndTurn();
    return;
  }

  if (pending) {
    el.cardControls.innerHTML = `
      <div>Select up to ${pending.max} card(s) to remove from the game.</div>
      <button id="btn-remove-selected" class="btn-primary btn-sm">Remove selected (${selectedCardIndexes.size})</button>
      <button id="btn-skip-removal" class="btn-secondary btn-sm">Keep remaining cards</button>
    `;
    el.cardControls.querySelector('#btn-remove-selected').disabled = selectedCardIndexes.size === 0;
    el.cardControls.querySelector('#btn-remove-selected').addEventListener('click', () => {
      send({ type: 'remove_cards', cardIndexes: [...selectedCardIndexes] });
    });
    el.cardControls.querySelector('#btn-skip-removal').addEventListener('click', () => {
      send({ type: 'remove_cards', cardIndexes: [] });
    });
  } else if (selectedWildCardIndex !== null) {
    el.cardControls.innerHTML = `
      <div>Choose the movement symbol for this card.</div>
      <button class="btn-secondary btn-sm" data-symbol="machete">🌿 Jungle</button>
      <button class="btn-secondary btn-sm" data-symbol="paddle">🌊 River</button>
      <button class="btn-secondary btn-sm" data-symbol="coin">🪙 Village</button>
      <button id="btn-cancel-symbol" class="btn-secondary btn-sm">Cancel</button>
    `;
    el.cardControls.querySelectorAll('[data-symbol]').forEach(button => {
      button.addEventListener('click', () => {
        const cardIndex = selectedWildCardIndex;
        selectedWildCardIndex = null;
        renderHand();
        renderCardControls();
        send({ type: 'play_card', cardIndex, chosenSymbol: button.dataset.symbol });
      });
    });
    el.cardControls.querySelector('#btn-cancel-symbol').addEventListener('click', () => {
      selectedWildCardIndex = null;
      renderHand();
      renderCardControls();
    });
  } else if (paymentMode && special) {
    const label = special.terrain === 'camp' ? 'Base Camp' : 'Rubble';
    el.cardControls.innerHTML = `
      <div>Select exactly ${special.power} card(s) to enter ${label}.</div>
      <button id="btn-pay-cards" class="btn-primary btn-sm">Enter ${label} (${selectedCardIndexes.size}/${special.power})</button>
      <button id="btn-cancel-payment" class="btn-secondary btn-sm">Cancel</button>
    `;
    el.cardControls.querySelector('#btn-pay-cards').disabled = selectedCardIndexes.size !== special.power;
    el.cardControls.querySelector('#btn-pay-cards').addEventListener('click', () => {
      send({ type: 'enter_special', cardIndexes: [...selectedCardIndexes] });
    });
    el.cardControls.querySelector('#btn-cancel-payment').addEventListener('click', () => {
      paymentMode = false;
      paymentContext = '';
      selectedCardIndexes.clear();
      renderHand();
      renderCardControls();
    });
  } else if (special && !buyMode) {
    const label = special.terrain === 'camp' ? 'Base Camp' : 'Rubble';
    el.cardControls.innerHTML = `<button id="btn-start-payment" class="btn-secondary btn-sm">Pay ${special.power} card(s) to enter ${label}</button>`;
    el.cardControls.querySelector('#btn-start-payment').addEventListener('click', () => {
      paymentMode = true;
      paymentContext = nextKey;
      selectedCardIndexes.clear();
      renderHand();
      renderCardControls();
    });
  } else {
    el.cardControls.classList.add('hidden');
    el.cardControls.innerHTML = '';
    renderEndTurn();
    return;
  }

  el.cardControls.classList.remove('hidden');
  renderEndTurn();
}

function renderMessage() {
  el.message.textContent = state.message;
}

function renderEndTurn() {
  const me = state.players[state.myId !== undefined ? state.myId : myId];
  const unresolvedEffect = state.pendingRemoval || state.freePick !== null;
  const myTurn = state.currentIndex === myId && !state.gameOver && !unresolvedEffect;
  el.btnEndTurn.classList.toggle('hidden', !myTurn);
  el.btnEndTurn.disabled = !me || me.isAI || unresolvedEffect;
  if (el.buyModeBtn) el.buyModeBtn.disabled = !myTurn || paymentMode || selectedWildCardIndex !== null;
}

/* ---------- interaction ---------- */

function onHandCardClick(i) {
  if (state.freePick !== null || state.gameOver || state.currentIndex !== state.myId) return;
  const card = state.hands[state.myId][i];
  if (!card) return;

  const pending = state.pendingRemoval?.playerIndex === myId ? state.pendingRemoval : null;
  if (pending) {
    toggleSelectedCard(i, pending.max);
  } else if (paymentMode) {
    const player = state.players[myId];
    const target = state.route[player.pos + 1];
    if (target) toggleSelectedCard(i, target.power);
  } else if (buyMode) {
    send({ type: 'toggle_buy', cardIndex: i });
  } else if (card.symbol === 'wild') {
    selectedWildCardIndex = i;
    renderHand();
    renderCardControls();
  } else if (card.action) {
    // Action cards show a preview because they have special effects
    showCardPreview(card, {
      label: 'Play action',
      action: () => onHandCardClick(i),
    });
  } else {
    // Movement card: play directly without preview overlay
    selectedWildCardIndex = null;
    send({ type: 'play_card', cardIndex: i });
  }
}

function toggleSelectedCard(i, limit) {
  if (selectedCardIndexes.has(i)) selectedCardIndexes.delete(i);
  else if (selectedCardIndexes.size < limit) selectedCardIndexes.add(i);
  renderHand();
  renderCardControls();
}

function onMarketCardClick(i, cardId) {
  if (state.gameOver || state.currentIndex !== state.myId) return;
  if (state.freePick === state.myId) {
    send({ type: 'free_pick', cardId });
  } else {
    send({ type: 'buy_card', marketIndex: i });
  }
}

function cardRuleText(card) {
  if (CARD_RULES[card.id]) return CARD_RULES[card.id];
  const symbol = { machete: 'jungle', paddle: 'river', coin: 'village' }[card.symbol];
  if (card.symbol === 'wild') return `Choose jungle, river, or village and move with strength ${card.power}.`;
  if (symbol) return `Move through ${symbol} with strength ${card.power}.`;
  return 'No special rule.';
}

function showCardPreview(card, { label, action }) {
  cardPreviewAction = action;
  el.cardPreviewCard.className = `card-preview-card card symbol-${card.symbol || 'action'}${CARD_ARTWORK[card.id] ? ' has-art' : ''}`;
  el.cardPreviewCard.innerHTML = cardFaceMarkup(card, true);
  el.cardPreviewRule.textContent = cardRuleText(card);
  el.btnCardPreviewAction.textContent = label;
  el.btnCardPreviewAction.classList.remove('hidden');
  el.overlayCardPreview.classList.remove('hidden');
  el.btnCardPreviewAction.focus();
}

function closeCardPreview() {
  cardPreviewAction = null;
  el.overlayCardPreview.classList.add('hidden');
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

window.addEventListener('error', (e) => {
  console.error('Global JS error:', e.error?.message || e.message);
  setConnectMessage('JavaScript error: ' + (e.error?.message || e.message));
});

function init() {
  console.log('init() called');
  try {
    populateMaps(Object.keys(MAPS));
    console.log('populateMaps done, options:', el.inputMap?.options.length);
  } catch (e) {
    console.error('populateMaps failed:', e);
    setConnectMessage('Error loading maps. Please reload.');
  }
  connect();

  el.btnCreate.addEventListener('click', () => {
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'ai';
    const mapKey = el.inputMap.value;
    send({ type: 'join', name: el.inputName.value.trim() || 'Player', mode, mapKey });
  });

  el.btnJoin.addEventListener('click', () => {
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'ai';
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

  el.btnCloseCardPreview.addEventListener('click', closeCardPreview);
  el.overlayCardPreview.addEventListener('click', (event) => {
    if (event.target === el.overlayCardPreview) closeCardPreview();
  });

  el.btnCardPreviewAction.addEventListener('click', () => {
    const action = cardPreviewAction;
    closeCardPreview();
    if (action) action();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.overlayCardPreview.classList.contains('hidden')) closeCardPreview();
  });

  document.getElementById('btn-go-menu').addEventListener('click', () => {
    showScreen('connect');
    state = null;
  });
  document.getElementById('btn-go-again').addEventListener('click', () => location.reload());
}

init();
