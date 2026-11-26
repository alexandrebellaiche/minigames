/* El Dorado — server-authoritative game server (Node.js + ws)
 *
 * Serves the static client files and runs the game logic over WebSocket.
 * Two players join the same room from different devices; the server validates
 * every move and broadcasts full state. Solo mode plays against a simple AI.
 *
 * Protocol (JSON over WebSocket):
 *   C->S {type:'join', name, mode ('ai'|'2p'), map, room?}
 *   S->C {type:'joined', playerId, color, roomId, state}
 *   C->S {type:'play_card', cardIndex}
 *   C->S {type:'toggle_buy', cardIndex}
 *   C->S {type:'buy_card', marketIndex}
 *   C->S {type:'free_pick', marketIndex}   (after Transmitter)
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
  scout:     { id: 'scout',     name: 'Scout',     symbol: 'machete', power: 2, cost: 2 },
  guide:     { id: 'guide',     name: 'River Guide', symbol: 'paddle', power: 2, cost: 2 },
  merchant:  { id: 'merchant',  name: 'Merchant',  symbol: 'coin',    power: 2, cost: 2 },
  trailblazer:{ id: 'trailblazer', name: 'Trailblazer', symbol: 'machete', power: 3, cost: 4 },
  waterman:  { id: 'waterman',  name: 'Waterman',  symbol: 'paddle',  power: 3, cost: 4 },
  trader:    { id: 'trader',    name: 'Trader',    symbol: 'coin',    power: 3, cost: 4 },
  navigator: { id: 'navigator', name: 'Navigator', symbol: 'machete', power: 4, cost: 6 },
  voyager:   { id: 'voyager',   name: 'Voyager',   symbol: 'paddle',  power: 4, cost: 6 },
  tycoon:    { id: 'tycoon',    name: 'Tycoon',    symbol: 'coin',    power: 4, cost: 6 },
  scientist: { id: 'scientist', name: 'Scientist', symbol: null, power: 0, cost: 3, action: true },
  transmitter:{ id: 'transmitter', name: 'Transmitter', symbol: null, power: 0, cost: 4, action: true },
  cartographer:{ id: 'cartographer', name: 'Cartographer', symbol: null, power: 0, cost: 3, action: true },
  compass:   { id: 'compass',   name: 'Compass',   symbol: null, power: 0, cost: 2, action: true },
  travelLog: { id: 'travelLog', name: 'Travel Log', symbol: null, power: 0, cost: 4, action: true },
  native:    { id: 'native',    name: 'Native',    symbol: null, power: 0, cost: 2, action: true },
};

const MARKET_DECK_IDS = [
  'scout','scout','scout',
  'guide','guide','guide',
  'merchant','merchant','merchant',
  'trailblazer','trailblazer','trailblazer',
  'waterman','waterman','waterman',
  'trader','trader','trader',
  'navigator','navigator','navigator',
  'voyager','voyager','voyager',
  'tycoon','tycoon','tycoon',
  'scientist','scientist','scientist',
  'transmitter','transmitter','transmitter',
  'cartographer','cartographer','cartographer',
  'compass','compass','compass',
  'travelLog','travelLog','travelLog',
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
  return card.power / 2;
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

  /* ---------- deck / draw ---------- */

  drawCards(p, n) {
    while (p.hand.length < n && (p.deck.length > 0 || p.discard.length > 0)) {
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

  movementRange(p, card) {
    let pos = p.pos;
    let power = card.power;
    let steps = 0;
    while (pos < this.route.length - 1) {
      const next = this.route[pos + 1];
      if (next.terrain === 'mountain') break;
      if (this.occupied(pos + 1)) break;
      const t = terrainFor(next);
      if (next.power > 0) {
        if (!t.any && card.symbol !== t.req) break;
        if (power < next.power) break;
        power -= next.power;
      }
      pos++;
      steps++;
      if (next.gate) break;
    }
    return { pos, steps };
  }

  playMovementCard(p, cardIndex) {
    const card = p.hand[cardIndex];
    if (!card || card.action) return null;
    const { pos, steps } = this.movementRange(p, card);
    if (steps === 0) return null;

    p.hand.splice(cardIndex, 1);
    const space = this.route[pos];
    if (space.terrain === 'camp') {
      // Base Camp: card removed from the game (deck thinning)
      this.message = `Moved ${steps} space(s) — ${card.name} removed at Base Camp.`;
    } else {
      p.discard.push(card);
      this.message = `Moved ${steps} space(s).`;
    }
    p.pos = pos;
    if (space.gate) this.reachElDorado(p);
    return { pos, steps };
  }

  /* ---------- actions ---------- */

  playActionCard(p, cardIndex) {
    const card = p.hand[cardIndex];
    if (!card || !card.action) return false;
    p.hand.splice(cardIndex, 1); // action cards are removed from the game after use

    switch (card.id) {
      case 'scientist':
        this.drawCards(p, 1);
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

  playCard(playerIndex, cardIndex) {
    const p = this.players[playerIndex];
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    if (this.gameOver || this.freePick !== null) return { ok: false, error: 'Cannot play now.' };
    const card = p.hand[cardIndex];
    if (!card) return { ok: false, error: 'No card.' };

    let ok = true;
    let error = null;
    if (card.action) {
      this.playActionCard(p, cardIndex);
    } else {
      const res = this.playMovementCard(p, cardIndex);
      if (!res) { ok = false; error = 'Cannot move with that card.'; }
    }
    this.broadcast(); // always sync state so clients stay in lockstep
    return { ok, error };
  }

  toggleBuy(cardIndex) {
    const p = this.players[this.currentIndex];
    if (!p) return;
    if (this.gameOver || this.freePick !== null) return;
    const card = p.hand[cardIndex];
    if (!card) return;
    const i = this.buyCandidates.indexOf(cardIndex);
    if (i >= 0) this.buyCandidates.splice(i, 1);
    else this.buyCandidates.push(cardIndex);
    this.recomputeCoins();
    this.broadcast();
  }

  /* free pick from Transmitter */
  freePickCard(playerIndex, marketIndex) {
    if (this.freePick !== playerIndex) return { ok: false, error: 'No free pick pending.' };
    const card = this.market[marketIndex];
    if (!card) return { ok: false, error: 'No card there.' };
    const p = this.players[playerIndex];
    p.discard.push(card);
    this.market[marketIndex] = null;
    this.refillMarket();
    this.freePick = null;
    this.message = `Took ${card.name} for free via Transmitter.`;
    this.broadcast();
    return { ok: true };
  }

  buyCard(playerIndex, marketIndex) {
    const p = this.players[playerIndex];
    if (playerIndex !== this.currentIndex) return { ok: false, error: 'Not your turn.' };
    if (this.gameOver || this.buyUsed || this.freePick !== null) return { ok: false, error: 'Cannot buy now.' };
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

  endTurn() {
    if (this.gameOver) return;
    const p = this.players[this.currentIndex];
    p.discard.push(...p.hand);
    p.hand = [];
    this.coins = 0;
    this.buyCandidates = [];
    this.buyUsed = false;
    this.freePick = null;

    this.currentIndex = (this.currentIndex + 1) % this.players.length;

    if (this.finalRound && this.currentIndex === 0) {
      this.finishGame();
      return;
    }

    this.phase = 'movement';
    this.drawCards(p, 4);
    this.message = `Player ${this.currentIndex + 1} (${this.players[this.currentIndex].name})'s turn.`;
    this.broadcast();

    if (this.players[this.currentIndex].isAI && !this.gameOver) {
      setTimeout(() => this.aiTurn(), 700);
    }
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
    while (safety++ < 30) {
      // try best movement
      let bestIdx = -1, bestSteps = -1;
      p.hand.forEach((c, i) => {
        if (c.action) return;
        const r = this.movementRange(p, c);
        if (r.steps > bestSteps) { bestSteps = r.steps; bestIdx = i; }
      });
      if (bestIdx >= 0 && bestSteps > 0) {
        this.playMovementCard(p, p.hand[bestIdx]);
        this.broadcast();
        if (this.gameOver) return;
        continue;
      }
      break;
    }

    // try to buy best affordable card
    const affordable = this.market.filter((c, i) => c && !this.buyUsed && this.coins >= c.cost - 1e-9);
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

    this.endTurn();
  }

  /* ---------- state for client ---------- */

  clientState() {
    return {
      roomId: this.roomId,
      mode: this.mode,
      mapName: MAPS[this.mapKey].name,
      players: this.players.map(pl => ({
        id: pl.id, name: pl.name, color: pl.color, isAI: pl.isAI,
        pos: pl.pos, handSize: pl.hand.length, discardSize: pl.discard.length,
        blockades: pl.blockades,
      })),
      currentIndex: this.currentIndex,
      phase: this.phase,
      coins: this.coins,
      buyCandidates: this.buyCandidates,
      buyUsed: this.buyUsed,
      freePick: this.freePick,
      market: this.market.map(c => c || null),
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
    const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.md': 'text/markdown' }[ext] || 'text/plain';
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
      const res = game.playCard(pi, msg.cardIndex);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'toggle_buy') {
      game.toggleBuy(msg.cardIndex);
    } else if (type === 'buy_card') {
      const res = game.buyCard(pi, msg.marketIndex);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'free_pick') {
      const res = game.freePickCard(pi, msg.marketIndex);
      if (!res.ok) ws.send(JSON.stringify({ type: 'error', error: res.error }));
    } else if (type === 'start') {
      if (pi === 0 && game.mode === '2p' && r.clients.size >= 2) {
        game.message = 'Expedition underway!';
        game.broadcast();
      }
    } else if (type === 'end_turn') {
      game.endTurn();
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
