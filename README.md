# Punch Until Death

An original 8-bit-style browser brawler built with plain HTML, CSS, and JavaScript. No install or build step is required.

## Run

Open `index.html` in a browser.

On macOS, from this folder:

```sh
open index.html
```

If you prefer to serve it locally:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Controls

- Start: `Enter` or `Space`
- Move: `WASD` or arrow keys
- Punch: `J`
- Kick: `K`
- Special: `L`
- Jump: `Space`
- Block: `Shift`
- Roll: double-tap a movement direction
- Pause: `P`
- Mute: `M`

Gamepads are auto-detected after you plug one in and press a button.

## Files

- `index.html` loads the game canvas.
- `style.css` handles the page and canvas presentation.
- `game.js` contains the game logic, rendering, input, and audio.
