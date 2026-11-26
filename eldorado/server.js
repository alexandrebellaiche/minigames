/* El Dorado — server-authoritative game server (Node.js + ws)
 *
 * Serves the static client files and runs the game logic over WebSocket.
 * Two players join the same room from different devices; the server validates
 * every move and broadcasts full state. Solo mode plays against a simple AI.
 *
 * Protocol (JSON over WebSocket):
 *   C->S {type:'join', name, mode ('ai'|'2p'), map, room?}
 *   S->C {type:'joined', playerId, color, roomId, state}
 *   C->S {type:'play_card', cardIndex, chosenSymbol?}
 *   C->S {type:'toggle_buy', cardIndex}
 *   C->S {type:'buy_card', marketIndex}
 *   C->S {type:'free_pick', cardId}         (after Transmitter)
 *   C->S {type:'enter_special', cardIndexes}
 *   C->S {type:'remove_cards', cardIndexes}
 *   C->S {type:'end_turn'}
 *   S->C {type:'state', state}             (broadcast after every change)
 *   S->C {type:'error', message}
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8666;
const ROOT = path.resolve(__dirname, '..');

/* ---------- card library ---------- */

const TERRAIN = {
  jungle:   { color: '#3a7d44', symbol: '🌿', label: 'Jungle',   req: 'machete', any: false },
  river:    { color: '#2f6db5', symbol: '🌊', label: 'River',    req: 'paddle',  any: false },
  village:  { color: '#c9a227', symbol: '🏛️', label: 'Village',  req: 'coin',    any: false },
  rubble:   { color: '#8a7d68', symbol: '⛰️', label: 'Rubble',   req: 'any',     any: true },
  camp:     { color: '#b5484a', symbol: '⛺', label: 'Base Camp',req: 'any',     any: true },
  mountain: { color: '#353535', symbol: '⬛', label: 'Mountain', req: 'none',    any: false },
};

const CARD_LIBRARY = {
  sailor:    { id: 'sailor',    name: 'Sailor',    symbol: 'paddle',  power: 1, cost: 0 },
  explorer:  { id: 'explorer',  name: 'Explorer',  symbol: 'machete', power: 1, cost: 0 },
  traveler:  { id: 'traveler',  name: 'Traveler',  symbol: 'coin',    power: 1, cost: 0 },
  scout:     { id: 'scout',     name: 'Scout',     symbol: 'machete', power: 2, cost: 1 },
  trailblazer:{ id: 'trailblazer', name: 'Trailblazer', symbol: 'machete', power: 3, cost: 3 },
  pioneer:   { id: 'pioneer',   name: 'Pioneer',   symbol: 'machete', power: 5, cost: 5 },
  giantMachete: { id: 'giantMachete', name: 'Giant Machete', symbol: 'machete', power: 6, cost: 3, oneUse: true },
  captain:   { id: 'captain',   name: 'Captain',   symbol: 'paddle', power: 3, cost: 2 },
  photographer: { id: 'photographer', name: 'Photographer', symbol: 'coin', power: 2, cost: 2 },
  journalist: { id: 'journalist', name: 'Journalist', symbol: 'coin', power: 3, cost: 3 },
  treasureChest: { id: 'treasureChest', name: 'Treasure Chest', symbol: 'coin', power: 4, cost: 3 },
  millionaire: { id: 'millionaire', name: 'Millionaire', symbol: 'coin', power: 4, cost: 5 },
  jackOfAllTrades: { id: 'jackOfAllTrades', name: 'Jack of All Trades', symbol: 'wild', power: 1, cost: 2 },
  adventurer: { id: 'adventurer', name: 'Adventurer', symbol: 'wild', power: 2, cost: 4 },
  propPlane: { id: 'propPlane', name: 'Prop Plane', symbol: 'wild', power: 4, cost: 4, oneUse: true },
  transmitter: { id: 'transmitter', name: 'Transmitter', symbol: 'action', power: 0, cost: 4, action: true, oneUse: true },
  cartographer: { id: 'cartographer', name: 'Cartographer', symbol: 'action', power: 0, cost: 4, action: true },
  compass:   { id: 'compass',   name: 'Compass',   symbol: 'action', power: 0, cost: 2, action: true, oneUse: true },
  travelLog: { id: 'travelLog', name: 'Travel Log', symbol: 'action', power: 0, cost: 3, action: true, oneUse: true },
  scientist: { id: 'scientist', name: 'Scientist', symbol: 'action', power: 0, cost: 4, action: true, oneUse: true },
  native:    { id: 'native',    name: 'Native',    symbol: 'action', power: 0, cost: 5, action: true },
};

const MARKET_DECK_IDS = [
  'scout','scout','scout',
  'trailblazer','trailblazer','trailblazer',
  'pioneer','pioneer','pioneer',
  'giantMachete','giantMachete','giantMachete',
  'captain','captain','captain',
  'photographer','photographer','photographer',
  'journalist','journalist','journalist',
  'treasureChest','treasureChest','treasureChest',
  'millionaire','millionaire','millionaire',
  'jackOfAllTrades','jackOfAllTrades','jackOfAllTrades',
  'adventurer','adventurer','adventurer',
  'propPlane','propPlane','propPlane',
  'transmitter','transmitter','transmitter',
  'cartographer','cartographer','cartographer',
  'compass','compass','compass',
  'travelLog','travelLog','travelLog',
  'scientist','scientist','scientist',
  'native','native','native',
];

const STARTING_DECK_IDS = [
  'sailor', 'explorer', 'explorer', 'explorer',
  'traveler', 'traveler', 'traveler', 'traveler',
];

/* ---------- preset maps (mimic the game's suggested routes) ---------- */

const MAPS = {
  classic: {
    name: 'The Classic Route',
    desc: 'Beginner — mixed terrain, short path',
    spaces: [
      {id:'start',terrain:'jungle',power:0,label:'Start',gate:false},
      {id:'a1',terrain:'jungle',power:1,label:'Jungle',gate:false},
      {id:'a2',terrain:'river',power:1,label:'River',gate:false},
      {id:'a3',terrain:'village',power:1,label:'Village',gate:false},
      {id:'a4',terrain:'jungle',power:2,label:'Jungle',gate:false},
      {id:'a5',terrain:'rubble',power:2,label:'Rubble',gate:false},
      {id:'a6',terrain:'river',power:2,label:'River',gate:false},
      {id:'a7',terrain:'village',power:2,label:'Village',gate:false},
      {id:'a8',terrain:'jungle',power:3,label:'Jungle',gate:false},
      {id:'a9',terrain:'camp',power:1,label:'Base Camp',gate:false},
      {id:'a10',terrain:'river',power:3,label:'River',gate:false},
      {id:'a11',terrain:'village',power:3,label:'Village',gate:false},
      {id:'dorado',terrain:'village',power:0,label:'EL DORADO',gate:true},
    ],
  },
  jungle: {
    name: 'Jungle Crawl',
    desc: 'Standard — heavy jungle, river crossings',
    spaces: [
      {id:'start',terrain:'jungle',power:0,label:'Start',gate:false},
      {id:'b1',terrain:'jungle',power:1,label:'Jungle',gate:false},
      {id:'b2',terrain:'jungle',power:2,label:'Jungle',gate:false},
      {id:'b3',terrain:'river',power:1,label:'River',gate:false},
      {id:'b4',terrain:'village',power:1,label:'Village',gate:false},
      {id:'b5',terrain:'jungle',power:3,label:'Jungle',gate:false},
      {id:'b6',terrain:'rubble',power:2,label:'Rubble',gate:false},
      {id:'b7',terrain:'river',power:2,label:'River',gate:false},
      {id:'b8',terrain:'village',power:2,label:'Village',gate:false},
      {id:'b9',terrain:'jungle',power:3,label:'Jungle',gate:false},
      {id:'b10',terrain:'river',power:3,label:'River',gate:false},
      {id:'b11',terrain:'camp',power:1,label:'Base Camp',gate:false},
      {id:'b12',terrain:'village',power:3,label:'Village',gate:false},
      {id:'b13',terrain:'jungle',power:4,label:'Jungle',gate:false},
      {id:'dorado',terrain:'village',power:0,label:'EL DORADO',gate:true},
    ],
  },
  river: {
    name: 'River Run',
    desc: 'Advanced — long river & village stretches',
    spaces: [
      {id:'start',terrain:'village',power:0,label:'Start',gate:false},
      {id:'c1',terrain:'river',power:1,label:'River',gate:false},
      {id:'c2',terrain:'village',power:1,label:'Village',gate:false},
      {id:'c3',terrain:'jungle',power:2,label:'Jungle',gate:false},
      {id:'c4',terrain:'river',power:2,label:'River',gate:false},
      {id:'c5',terrain:'village',power:2,label:'Village',gate:false},
      {id:'c6',terrain:'rubble',power:2,label:'Rubble',gate:false},
      {id:'c7',terrain:'river',power:3,label:'River',gate:false},
      {id:'c8',terrain:'jungle',power:3,label:'Jungle',gate:false},
      {id:'c9',terrain:'village',power:3,label:'Village',gate:false},
      {id:'c10',terrain:'camp',power:1,label:'Base Camp',gate:false},
      {id:'c11',terrain:'river',power:4,label:'River',gate:false},
      {id:'c12',terrain:'village',power:4,label:'Village',gate:false},
      {id:'c13',terrain:'jungle',power:4,label:'Jungle',gate:false},
      {id:'dorado',terrain:'village',power:0,label:'EL DORADO',gate:true},
    ],
  },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newCard(id) {
  const t = CARD_LIBRARY[id];
  return { ...t };
}

function cardCoinValue(card) {
  if (!card) return 0;
  if (card.symbol === 'coin') return card.power;
  return 0.5;
}

function terrainFor(space) {
  return TERRAIN[space.terrain];
}

function symbolChar(sym) {
  return { machete: '🌿', paddle: '🌊', coin: '🪙' }[sym] || '🪄';
}

/* ---------- game engine ---------- */

class Game {
  constructor({ roomId, mode, mapKey, players }) {
    this.roomId = roomId;
    this.mode = mode; // 'ai' | '2p'
    this.mapKey = mapKey;
    this.route = MAPS[mapKey].spaces;
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isAI: p.isAI,
      pos: 0,
      deck: shuffle(STARTING_DECK_IDS.map(id => newCard(id))),
      hand: [],
      discard: [],
      played: [],
      blockades: 0,
    }));
    this.currentIndex = 0;
    this.phase = 'movement';
    this.coins = 0;
    this.buyCandidates = []; // hand indices earmarked for purchase
    this.buyUsed = false;
    this.market = [];
    this.marketDeck = shuffle(MARKET_DECK_IDS.map(id => newCard(id)));
    this.gameOver = false;
    this.finalRound = false;
    this.finishedOrder = [];
    this.freePick = null; // {playerIndex} when Transmitter awaits a pick
    this.pendingRemoval = null;
    this.message = 'Expedition begins.';

    this.refillMarket();
    this.players.forEach(p => this.drawCards(p, 4));
  }

  /* ---------- market ---------- */

  refillMarket() {
    for (let i = 0; i < 6; i++) {
      if (!this.market[i] && this.marketDeck.length > 0) {
        this.market[i] = this.marketDeck.pop();
      }
    }
  }

  availableMarketPiles() {
    const counts = new Map();
    [...this.marketDeck, ...this.market.filter(Boolean)].forEach(card => {
      counts.set(card.id, (counts.get(card.id) || 0) + 1);
    });
    return [...counts]
      .sort(([a], [b]) => CARD_LIBRARY[a].name.localeCompare(CARD_LIBRARY[b].name))
      .map(([id, count]) => ({ ...newCard(id), count }));
  }

  /* ---------- deck / draw ---------- */

  drawCards(p, n) {
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        p.deck = shuffle(p.discard);
        p.discard = [];
      }
      if (p.deck.length === 0) break;
      p.hand.push(p.deck.pop());
    }
  }

  recomputeCoins() {
    const p = this.players[this.currentIndex];
    this.coins = this.buyCandidates.reduce((sum, i) => sum + cardCoinValue(p.hand[i]), 0);
  }

  /* ---------- movement ---------- */

  occupied(pos) {
    return this.players.some(other => other.pos === pos);
  }

  movementRange(p, card, chosenSymbol = card.symbol) {
    let pos = p.pos;
    let power = card.power;
    let steps = 0;
    while (pos < this.route.length - 1) {
      const next = this.route[pos + 1];
      if (next.terrain === 'mountain') break;
      if (this.occupied(pos + 1)) break;
      if (next.terrain === 'rubble' || next.terrain === 'camp') break;
      const t = terrainFor(next);
      if (next.power > 0) {
        if (!t.any && chosenSymbol !== t.req) break;
        if (power < next.power) break;
        power -= next.power;
      }
      pos++;
      steps++;
      if (next.gate) break;
    }
    return { pos, steps };
  }

  playMovementCard(p, cardIndex, chosenSymbol) {
    const card = p.hand[cardIndex];
    if (!card || card.action) return null;
    if (card.symbol === 'wild' && !['machete', 'paddle', 'coin'].includes(chosenSymbol)) return null;
    const movementSymbol = card.symbol === 'wild' ? chosenSymbol : card.symbol;
    const { pos, steps } = this.movementRange(p, card, movementSymbol);
    if (steps === 0) return null;

    p.hand.splice(cardIndex, 1);
    const space = this.route[pos];
    if (card.oneUse) {
      this.message = `${card.name} removed from the game after moving ${steps} space(s).`;
    } else {
      p.played.push(card);
      this.message = `Moved ${steps} space(s).`;
    }
    p.pos = pos;
    if (space.gate) this.reachElDorado(p);
    return { pos, steps };
  }

  enterSpecialSpace(playerIndex, cardIndexes) {
    const p = this.players[playerIndex];
    if (playerIndex !== this.currentIndex || this.gameOver || this.freePick !== null || this.pendingRemoval) {
      return { ok: false, error: 'Cannot enter that space now.' };
    }
    if (!Array.isArray(cardIndexes)) return { ok: false, error: 'Select cards to spend.' };
    const targetIndex = p.pos + 1;
    const target = this.route[targetIndex];
    if (!target || !['rubble', 'camp'].includes(target.terrain)) {
      return { ok: false, error: 'The next space does not require cards.' };
    }
    if (this.occupied(targetIndex)) return { ok: false, error: 'That space is occupied.' };
    const needed = target.power;
    const indexes = [...new Set(cardIndexes)];
    if (indexes.length !== cardIndexes.length || indexes.length !== needed || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= p.hand.length)) {
      return { ok: false, error: `Select exactly ${needed} card(s).` };
    }
    const spent = indexes.sort((a, b) => b - a).map(index => p.hand.splice(index, 1)[0]);
    if (target.terrain === 'rubble') p.discard.push(...spent);
    p.pos = targetIndex;
    this.message = target.terrain === 'camp'
      ? 'Entered Base Camp — cards spent were removed from the game.'
      : 'Entered Rubble — cards spent were discarded.';
    this.broadcast();
    return { ok: true };
  }

  removeCards(playerIndex, cardIndexes) {
    const pending = this.pendingRemoval;
    const p = this.players[playerIndex];
    if (!pending || pending.playerIndex !== playerIndex || playerIndex !== this.currentIndex) {
      return { ok: false, error: 'There is no card removal pending.' };
    }
    if (!Array.isArray(cardIndexes)) return { ok: false, error: 'Select cards to remove.' };
    const indexes = [...new Set(cardIndexes)];
    if (indexes.length !== cardIndexes.length || indexes.length > pending.max || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= p.hand.length)) {
      return { ok: false, error: `Remove up to ${pending.max} card(s).` };
    }
    indexes.sort((a, b) => b - a).forEach(index => p.hand.splice(index, 1));
    this.pendingRemoval = null;
    this.message = indexes.length
      ? `Removed ${indexes.length} card(s) from the game.`
      : 'Kept all remaining cards.';
    this.broadcast();
    return { ok: true };
  }

  /* ---------- actions ---------- */

  playActionCard(p, cardIndex) {
    const card = p.hand[cardIndex];
    if (!card || !card.action) return false;
    p.hand.splice(cardIndex, 1);
    if (!card.oneUse) p.played.push(card);

    switch (card.id) {
      case 'scientist':
        this.drawCards(p, 1);
        this.pendingRemoval = { playerIndex: this.currentIndex, max: 1 };
        this.message = `${card.name}: drew 1 card.`;
        break;
      case 'transmitter':
        this.freePick = this.currentIndex;
        this.message = `${card.name}: pick any market card to take for free.`;
        break;
      case 'cartographer':
        this.drawCards(p, 2);
        this.message = `${card.name}: drew 2 cards.`;
        break;
      case 'compass':
        this.drawCards(p, 3);
        this.message = `${card.name}: drew 3 cards.`;
        break;
      case 'travelLog':
        this.drawCards(p, 2);
        this.pendingRemoval = { playerIndex: this.currentIndex, max: 2 };
        this.message = `${card.name}: drew 2 cards.`;
        break;
      case 'native': {
        const p2 = this.players[this.currentIndex];
        const target = p2.pos + 1;
        if (target < this.route.length && !this.occupied(target) && this.route[target].terrain !== 'mountain') {
          p2.pos = target;
          if (this.route[target].gate) this.reachElDorado(p2);
          else this.message = `${card.name}: moved 1 space.`;
        } else {
          this.message = `${card.name}: nowhere to move.`;
        }
        break;
      }
    }
    return true;
  }

  /* ---------- public play entry ---------- */

  playCard(playerIndex, cardIndex, chosenSymbol) {
    const p = this.players[playerIndex];
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    if (this.gameOver || this.freePick !== null || this.pendingRemoval) return { ok: false, error: 'Cannot play now.' };
    const card = p.hand[cardIndex];
    if (!card) return { ok: false, error: 'No card.' };

    let ok = true;
    let error = null;
    if (card.action) {
      this.playActionCard(p, cardIndex);
    } else {
      const res = this.playMovementCard(p, cardIndex, chosenSymbol);
      if (!res) { ok = false; error = 'Cannot move with that card.'; }
    }
    this.broadcast(); // always sync state so clients stay in lockstep
    return { ok, error };
  }

  toggleBuy(playerIndex, cardIndex) {
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    const p = this.players[this.currentIndex];
    if (!p || this.gameOver || this.freePick !== null || this.pendingRemoval) return { ok: false, error: 'Cannot choose cards for purchase now.' };
    const card = p.hand[cardIndex];
    if (!card) return { ok: false, error: 'No card.' };
    const i = this.buyCandidates.indexOf(cardIndex);
    if (i >= 0) this.buyCandidates.splice(i, 1);
    else this.buyCandidates.push(cardIndex);
    this.recomputeCoins();
    this.broadcast();
    return { ok: true };
  }

  /* free pick from Transmitter */
  freePickCard(playerIndex, cardId) {
    if (this.freePick !== playerIndex) return { ok: false, error: 'No free pick pending.' };
    if (!CARD_LIBRARY[cardId] || !MARKET_DECK_IDS.includes(cardId)) {
      return { ok: false, error: 'That card is not in the marketplace.' };
    }
    const marketIndex = this.market.findIndex(card => card && card.id === cardId);
    let card;
    if (marketIndex >= 0) {
      card = this.market[marketIndex];
      this.market[marketIndex] = null;
    } else {
      const deckIndex = this.marketDeck.findIndex(item => item.id === cardId);
      if (deckIndex < 0) return { ok: false, error: 'That supply pile is empty.' };
      [card] = this.marketDeck.splice(deckIndex, 1);
    }
    const p = this.players[playerIndex];
    p.discard.push(card);
    this.refillMarket();
    this.freePick = null;
    this.message = `Took ${card.name} for free via Transmitter.`;
    this.broadcast();
    return { ok: true };
  }

  buyCard(playerIndex, marketIndex) {
    const p = this.players[playerIndex];
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    if (this.gameOver || this.buyUsed || this.freePick !== null || this.pendingRemoval) return { ok: false, error: 'Cannot buy now.' };
    const card = this.market[marketIndex];
    if (!card) return { ok: false, error: 'No card there.' };
    if (this.coins < card.cost - 1e-9) return { ok: false, error: 'Not enough coins.' };

    // spend earmarked cards
    [...this.buyCandidates].sort((a, b) => b - a).forEach(i => {
      const spent = p.hand.splice(i, 1)[0];
      p.discard.push(spent);
    });
    this.buyCandidates = [];
    this.coins = 0;
    this.buyUsed = true;

    p.discard.push(card);
    this.market[marketIndex] = null;
    this.refillMarket();
    this.message = `Bought ${card.name}.`;
    this.broadcast();
    return { ok: true };
  }

  /* ---------- turn flow ---------- */

  endTurn(playerIndex) {
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    if (this.gameOver || this.freePick !== null || this.pendingRemoval) return { ok: false, error: 'Resolve the current card effect first.' };
    const p = this.players[this.currentIndex];
    p.discard.push(...p.hand, ...p.played);
    p.hand = [];
    p.played = [];
    this.coins = 0;
    this.buyCandidates = [];
    this.buyUsed = false;
    this.freePick = null;

    this.currentIndex = (this.currentIndex + 1) % this.players.length;

    if (this.finalRound && this.currentIndex === 0) {
      this.finishGame();
      return { ok: true };
    }

    this.phase = 'movement';
    this.drawCards(p, 4);
    this.message = `Player ${this.currentIndex + 1} (${this.players[this.currentIndex].name})'s turn.`;
    this.broadcast();

    if (this.players[this.currentIndex].isAI && !this.gameOver) {
      setTimeout(() => this.aiTurn(), 700);
    }
    return { ok: true };
  }

  reachElDorado(p) {
    this.finishedOrder.push(p.id);
    if (!this.finalRound) {
      this.finalRound = true;
      this.message = `${p.name} reached El Dorado! Final round — others get one more turn.`;
    } else {
      this.message = `${p.name} also reached El Dorado.`;
    }
    this.broadcast();
    if (this.finishedOrder.length === this.players.length) {
      this.finishGame();
    }
  }

  finishGame() {
    this.gameOver = true;
    let winner = null;
    if (this.finishedOrder.length === 1) {
      winner = this.players.find(pl => pl.id === this.finishedOrder[0]);
    } else if (this.finishedOrder.length > 1) {
      const mostBlockades = Math.max(...this.players.map(pl => pl.blockades));
      const tied = this.players
        .filter(pl => pl.blockades === mostBlockades && this.finishedOrder.includes(pl.id))
        .sort((a, b) => this.finishedOrder.indexOf(a.id) - this.finishedOrder.indexOf(b.id));
      winner = tied[0] || this.players[this.finishedOrder[0]];
    }
    this.message = winner ? `${winner.name} found El Dorado first!` : 'Game over.';
    this.broadcast();
  }

  /* ---------- AI ---------- */

  aiTurn() {
    if (this.gameOver) return;
    if (!rooms.get(this.roomId)) return; // room closed while a turn was pending
    const p = this.players[this.currentIndex];
    if (!p.isAI) return;

    let safety = 0;
    while (safety++ < 50) {
      const actionIndex = p.hand.findIndex(card => card.action);
      if (actionIndex >= 0) {
        this.playActionCard(p, actionIndex);
        if (this.pendingRemoval) this.removeCards(this.currentIndex, []);
        if (this.freePick === this.currentIndex) {
          const pick = this.availableMarketPiles()
            .sort((a, b) => b.power - a.power || a.cost - b.cost)[0];
          if (pick) this.freePickCard(this.currentIndex, pick.id);
          else {
            this.freePick = null;
            this.message = 'No marketplace cards remain.';
            this.broadcast();
          }
        } else {
          this.broadcast();
        }
        if (this.gameOver) return;
        continue;
      }

      // try best movement
      let bestIdx = -1, bestSteps = 0, bestSymbol;
      p.hand.forEach((card, i) => {
        const symbols = card.symbol === 'wild' ? ['machete', 'paddle', 'coin'] : [card.symbol];
        symbols.forEach(symbol => {
          const r = this.movementRange(p, card, symbol);
          if (r.steps > bestSteps) {
            bestSteps = r.steps;
            bestIdx = i;
            bestSymbol = symbol;
          }
        });
      });
      if (bestIdx >= 0) {
        this.playMovementCard(p, bestIdx, bestSymbol);
        this.broadcast();
        if (this.gameOver) return;
        continue;
      }

      const next = this.route[p.pos + 1];
      if (
        next &&
        !this.occupied(p.pos + 1) &&
        ['rubble', 'camp'].includes(next.terrain) &&
        p.hand.length >= next.power
      ) {
        this.enterSpecialSpace(this.currentIndex, Array.from({ length: next.power }, (_, i) => i));
        continue;
      }
      break;
    }

    // try to buy best affordable card
    const totalCoins = p.hand.reduce((sum, card) => sum + cardCoinValue(card), 0);
    const affordable = this.market.filter(c => c && !this.buyUsed && totalCoins >= c.cost - 1e-9);
    if (affordable.length > 0) {
      affordable.sort((a, b) => b.power - a.power || b.cost - a.cost);
      const pick = affordable[0];
      // earmark cards greedily to afford it
      const handVals = p.hand.map((c, i) => ({ i, v: cardCoinValue(c) })).sort((a, b) => b.v - a.v);
      let sum = 0;
      for (const h of handVals) {
        if (sum >= pick.cost - 1e-9) break;
        this.buyCandidates.push(h.i);
        sum += h.v;
      }
      this.recomputeCoins();
      this.broadcast();
      if (sum >= pick.cost - 1e-9) {
        const mi = this.market.indexOf(pick);
        this.buyCard(this.currentIndex, mi);
        if (this.gameOver) return;
      }
    }

    this.endTurn(this.currentIndex);
  }

  /* ---------- state for client ---------- */

  clientState() {
    return {
      roomId: this.roomId,
      mode: this.mode,
      mapName: MAPS[this.mapKey].name,
      players: this.players.map(pl => ({
        id: pl.id, name: pl.name, color: pl.color, isAI: pl.isAI,
        pos: pl.pos, handSize: pl.hand.length, deckSize: pl.deck.length, discardSize: pl.discard.length,
        blockades: pl.blockades,
      })),
      currentIndex: this.currentIndex,
      phase: this.phase,
      coins: this.coins,
      buyCandidates: this.buyCandidates,
      buyUsed: this.buyUsed,
      freePick: this.freePick,
      pendingRemoval: this.pendingRemoval,
      market: this.market.map(c => c || null),
      marketSupply: this.availableMarketPiles(),
      route: this.route,
      gameOver: this.gameOver,
      finalRound: this.finalRound,
      finishedOrder: this.finishedOrder,
      message: this.message,
      // full hand only sent to the owning player (hand is public in this design, so send all)
      hands: this.players.map(pl => pl.hand.map(c => ({
        id: c.id, name: c.name, symbol: c.symbol, power: c.power, cost: c.cost, action: c.action,
      }))),
    };
  }

  broadcast() {
    const r = rooms.get(this.roomId);
    if (!r) return; // room was closed (e.g. all clients disconnected)
    const state = this.clientState();
    r.clients.forEach(ws => {
      const me = r.playerByWs.get(ws);
      const personal = { ...state, you: me };
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: personal }));
    });
  }
}

/* ---------- rooms / connections ---------- */

const rooms = new Map(); // roomId -> { game, clients: Set<ws>, playerByWs: Map<ws, playerIndex> }

function makeRoomId() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function createGame({ name, mode, mapKey }) {
  const roomId = makeRoomId();
  const color1 = mode === 'ai' ? '#d4af37' : '#d4af37';
  const color2 = '#4a9e5c';
  const players = [
    { id: 0, name, color: color1, isAI: false },
    { id: 1, name: mode === 'ai' ? 'El Dorado AI' : 'Player 2', color: color2, isAI: mode === 'ai' },
  ];
  const game = new Game({ roomId, mode, mapKey, players });
  rooms.set(roomId, { game, clients: new Set(), playerByWs: new Map() });
  return { roomId, game };
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

/* ---------- HTTP + WebSocket ---------- */

function serveStatic(res, file) {
  const filePath = path.join(ROOT, file);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file);
    const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.md': 'text/markdown', '.png': 'image/png' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const files = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/mastermind/': 'mastermind/index.html',
    '/mastermind/index.html': 'mastermind/index.html',
    '/mastermind/style.css': 'mastermind/style.css',
    '/mastermind/game.js': 'mastermind/game.js',
    '/darkroom/': 'darkroom/index.html',
    '/darkroom/index.html': 'darkroom/index.html',
    '/darkroom/style.css': 'darkroom/style.css',
    '/darkroom/game.js': 'darkroom/game.js',
    '/eldorado/': 'eldorado/index.html',
    '/eldorado/index.html': 'eldorado/index.html',
    '/eldorado/style.css': 'eldorado/style.css',
    '/eldorado/game.js': 'eldorado/game.js',
    '/eldorado/DESIGN.md': 'eldorado/DESIGN.md',
    '/eldorado/artwork_v2/sailor.png': 'eldorado/artwork_v2/sailor.png',
    '/eldorado/artwork_v2/explorer.png': 'eldorado/artwork_v2/explorer.png',
    '/eldorado/artwork_v2/traveler.png': 'eldorado/artwork_v2/traveler.png',
    '/eldorado/artwork_v2/scout.png': 'eldorado/artwork_v2/scout.png',
    '/eldorado/artwork_v2/trailblazer.png': 'eldorado/artwork_v2/trailblazer.png',
    '/eldorado/artwork_v2/pioneer.png': 'eldorado/artwork_v2/pioneer.png',
    '/eldorado/artwork_v2/giant-machete.png': 'eldorado/artwork_v2/giant-machete.png',
    '/eldorado/artwork_v2/photographer.png': 'eldorado/artwork_v2/photographer.png',
    '/eldorado/artwork_v2/journalist.png': 'eldorado/artwork_v2/journalist.png',
    '/eldorado/artwork_v2/millionaire.png': 'eldorado/artwork_v2/millionaire.png',
    '/eldorado/artwork_v2/treasure-chest.png': 'eldorado/artwork_v2/treasure-chest.png',
    '/eldorado/artwork_v2/captain.png': 'eldorado/artwork_v2/captain.png',
    '/eldorado/artwork_v2/jack-of-all-trades.png': 'eldorado/artwork_v2/jack-of-all-trades.png',
    '/eldorado/artwork_v2/adventurer.png': 'eldorado/artwork_v2/adventurer.png',
    '/eldorado/artwork_v2/prop-plane.png': 'eldorado/artwork_v2/prop-plane.png',
    '/eldorado/artwork_v2/transmitter.png': 'eldorado/artwork_v2/transmitter.png',
    '/eldorado/artwork_v2/cartographer.png': 'eldorado/artwork_v2/cartographer.png',
    '/eldorado/artwork_v2/compass.png': 'eldorado/artwork_v2/compass.png',
    '/eldorado/artwork_v2/travel-log.png': 'eldorado/artwork_v2/travel-log.png',
    '/eldorado/artwork_v2/scientist.png': 'eldorado/artwork_v2/scientist.png',
    '/eldorado/artwork_v2/native.png': 'eldorado/artwork_v2/native.png',
    '/style.css': 'eldorado/style.css',
    '/game.js': 'eldorado/game.js',
    '/DESIGN.md': 'eldorado/DESIGN.md',
  };
  if (files[url.pathname]) return serveStatic(res, files[url.pathname]);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPlayerIndex = null;

  ws.send(JSON.stringify({ type: 'hello', maps: Object.keys(MAPS) }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Bad JSON' }));
      return;
    }

    const { type } = msg;

    if (type === 'join') {
      const { name, mode, mapKey, room } = msg;
      if (!name || !mode || !mapKey) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing join fields' }));
        return;
      }

      let roomId = room;
      let game;
      if (roomId && rooms.has(roomId)) {
        const r = rooms.get(roomId);
        if (r.clients.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', error: 'Room full' }));
          return;
        }
        game = r.game;
        roomId = r.game.roomId;
      } else {
        const created = createGame({ name: name || 'Player', mode, mapKey });
        roomId = created.roomId;
        game = created.game;
      }

      // assign player index
      const r = rooms.get(roomId);
      let playerIndex;
      if (r.playerByWs.size === 0) playerIndex = 0;
      else if (r.playerByWs.size === 1) playerIndex = 1;
      else { ws.send(JSON.stringify({ type: 'error', error: 'Room full' })); return; }

      currentRoom = roomId;
      currentPlayerIndex = playerIndex;
      // store the joining player's name (host name set at creation)
      game.players[playerIndex].name = name;
      r.clients.add(ws);
      r.playerByWs.set(ws, playerIndex);

      // if 2p and both present, mark started; AI starts immediately
      if (game.mode === '2p' && r.clients.size === 2) {
        game.message = 'Both players joined. Player 1 starts.';
      }

      ws.send(JSON.stringify({
        type: 'joined',
        playerId: playerIndex,
        color: game.players[playerIndex].color,
        roomId,
        state: game.clientState(),
      }));
      game.broadcast();

      if (game.mode === 'ai' && playerIndex === 0 && !game.gameOver) {
        setTimeout(() => game.aiTurn(), 500);
      }
      return;
    }

    // from here on, require a joined room
    if (!currentRoom) {
      ws.send(JSON.stringify({ type: 'error', error: 'Join a room first' }));
      return;
    }

    const r = rooms.get(currentRoom);
    if (!r) return;
    const game = r.game;
    const pi = currentPlayerIndex;

    if (type === 'play_card') {
      const res = game.playCard(pi, msg.cardIndex, msg.chosenSymbol);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'toggle_buy') {
      const res = game.toggleBuy(pi, msg.cardIndex);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'buy_card') {
      const res = game.buyCard(pi, msg.marketIndex);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'free_pick') {
      const res = game.freePickCard(pi, msg.cardId);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'enter_special') {
      const res = game.enterSpecialSpace(pi, msg.cardIndexes);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'remove_cards') {
      const res = game.removeCards(pi, msg.cardIndexes);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'start') {
      if (pi === 0 && game.mode === '2p' && r.clients.size >= 2) {
        game.message = 'Expedition underway!';
        game.broadcast();
      }
    } else if (type === 'end_turn') {
      const res = game.endTurn(pi);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const r = rooms.get(currentRoom);
      if (r) {
        r.clients.delete(ws);
        r.playerByWs.delete(ws);
        if (r.clients.size === 0) rooms.delete(currentRoom);
        else {
          const game = r.game;
          const pi = currentPlayerIndex;
          if (pi !== null && pi !== undefined) {
            game.message = `Player ${pi + 1} disconnected.`;
            game.broadcast();
          }
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`El Dorado server listening on http://localhost:${PORT}`);
});
