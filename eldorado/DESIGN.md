# El Dorado — Design Decisions & Roadmap

## Source material
"The Quest for El Dorado" (Reiner Knizia, Ravensburger, 2017/2023).
- Deck-building race across terrain hexes to El Dorado.
- Jungle=machete/green, River=paddle/blue, Village=coin/yellow.
- Enter a space with a matching card whose power >= space cost; leftover power carries across adjacent same-terrain spaces.
- Cards cannot be combined to pay for one space.
- Rubble takes any cards; Base Camp removes spent cards from the game (deck thinning).
- Turn: play any number of cards to move and/or buy **one** card; discard played cards; draw back to 4.
- Coin cards = full coin value for buying; all other cards = ½ coin; no change.
- First to El Dorado triggers the final round; ties broken by blockades (deferred).

## Design decisions

### Networked multiplayer
- **Server-authoritative** Node.js + WebSocket game server (`server.js`).
- The same HTTP process serves the minigame hub, each game's static files, and the WebSocket endpoint. The El Dorado client connects to that same host and port.
- Start the server from the repository root with `make serve`, or open El Dorado directly with `make serve-eldorado`. Install the server dependency first with `cd eldorado && npm install`.
- Two players join the same room; the server validates every move and broadcasts full state to both clients. No game logic lives in the browser (prevents desync/cheating).
- Solo mode plays against a simple server-side AI that takes its turns automatically.

### Client model
- Thin client: renders the state it receives from the server; user clicks are sent as intent messages (`play_card`, `buy_card`, `toggle_buy`, `end_turn`).
- Connection screens handle name entry, mode selection (AI / 2-player), map selection, and room join.

### Maps
- Preset linear routes mimicking the game's suggested set layouts (Beginner / Standard / Advanced).
- Each route ends at the gate to El Dorado. Route is chosen when the room is created.

### Action cards (implemented in this release)
- **Scientist**: draw 1 card, then optionally remove 1 card from hand.
- **Transmitter**: take any available market card for free (put on discard pile).
- **Cartographer**: draw 2 cards (playable this turn).
- **Compass**: draw 3 cards.
- **Travel Log**: draw 2 cards, remove up to 2 cards from hand.
- **Native**: move 1 space ignoring terrain requirements (not onto mountain or occupied space).
- Action cards are removed from the game after use.

### Scope (this release)
- Networked 2-player (same room, alternating turns)
- Solo vs simple AI
- Action cards, market buying (½ coin for non-coin, no change), Base Camp deck thinning
- Final round + first-to-El-Dorado wins

### Deferred (roadmap)
- Blockades on tile connections
- Caves variant & cave tokens
- Two pieces per player (2-player advanced rules)
- Route editor / custom maps
- Animations, sound, mobile layout polish, reconnect handling

## Roadmap
1. MVP: networked 2-player + AI, action cards, preset maps, market, base camp, win condition
2. Polish: animations, mobile layout, reconnect handling
3. Blockades + caves variant
4. Route editor
