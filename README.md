# Minigames

A collection of browser-based minigames.

## Games

| Game | Description |
|------|-------------|
| [Mastermind](mastermind/) | Classic code-breaking board game |

## Run

```
make serve
```

Or per-game:

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
└── mastermind/
    ├── index.html
    ├── style.css
    └── game.js
```
