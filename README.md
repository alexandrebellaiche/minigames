# Minigames

A collection of browser-based minigames.

## Games

| Game | Description |
|------|-------------|
| [Mastermind](mastermind/) | Classic code-breaking board game |
| [Darkroom](darkroom/) | Lights-out grid puzzle |
| [El Dorado](eldorado/) | Deck-building race through the jungle to the golden city |

## Run

```
cd eldorado && npm install
cd ..
make serve
```

`make serve` serves the game hub and starts the El Dorado WebSocket server.
To open El Dorado directly, run `make serve-eldorado`.

For static games without the WebSocket server:

```
cd mastermind && python3 -m http.server 8000
```

## Structure

```
minigames/
├── README.md
├── LICENSE
├── Makefile
├── .gitignore
├── darkroom/
│   ├── index.html
│   ├── style.css
│   └── game.js
├── eldorado/
│   ├── DESIGN.md
│   ├── artwork_v2/ (named full-card artwork)
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   ├── style.css
│   └── game.js
└── mastermind/
    ├── index.html
    ├── style.css
    └── game.js
```
