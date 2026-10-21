# Meadow Multiplayer — Pixel Art World Remake

A top-down HTML5 multiplayer RPG. This release replaces the previously code-drawn scenery and actors with **original PNG pixel-art sprites** and replaces the old tiled/grid-looking ground with **one continuous pixel-art landscape**.

## What's new

- A completely rebuilt, winding forest world: blended forest floor, broad curved dirt trails, forests of various species, flowers and mushrooms, ponds and a river, bridges, highlands and a ruined stone boss sanctuary.
- A **120×80-tile** world (3840×2560 world units), with no visible square-grid seams in the graphics.
- A newly illustrated four-direction adventurer with brown hair, blue-and-gold armor, red cape, sword and shield. Sprite sheet includes idle/walking animation frames.
- Newly illustrated Rat, Bat, Baphomet and Baphomet.Jr sprites; original trees, rocks, foliage, mushrooms and runestones.
- Redrawn sword slashes, whirlwind, Earthbreaker cracks/debris, stun sprites, projectile effects, and Baphomet Earthquake telegraph/cast bar.
- **Fixed character heading at rest.** The server changes the player's facing direction only when there is deliberate movement input (or an intentional attack), never on residual knockback drift or settling interpolation. The last walking direction is maintained when released.
- **The UI remains unchanged** (`public/index.html` is byte-for-byte identical to the input version).
- Existing WebSocket formats, saved character key, stats, levels, skills and boss phases have been preserved.

## Source layout

- `public/game.js` — browser rendering and input, sprite loading, visual effects and minimap.
- `public/assets/world.png` — continuous world background with no tile/grid boundaries.
- `public/assets/world.json` — **single authoritative map layout** and object placements. The browser and Node server use the same map, avoiding invisible walls.
- `public/assets/hero.png` — player sprite sheet (4 frames × 4 facing rows: down, left, right, up).
- `public/assets/rat.png`, `bat.png`, `baphomet.png`, `baphometjr.png` — 4-frame monster animations.
- `public/assets/oak.png`, `pine.png`, `cherry.png`, `rock.png`, `bush.png`, `mushroom.png`, `obelisk.png` — depth-sorted scenery sprites.
- `server.js` — multiplayer server, collision based on `world.json`, boss AI and facing-direction fix.
- `scripts/generate_art.py` — editable original artwork generator using Python, Pillow and NumPy. Running it overwrites `public/assets`, so do this only when you deliberately want to rebuild the world artwork and map.

## Play locally

1. Install Node.js (18+).
2. Run `npm install` in this folder (Windows PowerShell: `npm.cmd install`).
3. Run `npm start` (`npm.cmd start` in PowerShell).
4. Open `http://localhost:3000` in your browser.

To deploy, upload the **entire new project contents** to the GitHub repo and let Render redeploy. **Upload all files in `public/assets/`** — the game will not render without them. The UI and saved character data remain unchanged.

## Controls

WASD / arrows to move; left Shift to run; Space to jump; hold left click to attack; `1` Whirlwind; `2` Earthbreaker (aim with cursor); Enter to chat; stats controls in the unchanged top-left panel.

## Notes

Normal monsters spawn in random valid locations and respawn elsewhere. Baphomet respawns 60 seconds after defeat. At 75% and 25% health, he casts an Earthquake telegraphed for 3 seconds, with damaging radius 360 units. At 50% HP he summons five Baphomet.Jr. The juniors never respawn independently and are removed when Baphomet dies.

Saving continues in browser localStorage and is not secure against player-side edits. This is a multiplayer prototype, not a persistent server-side account system.

### Verification

- `node --check` passed for both JavaScript files.
- Mock WebSocket server test confirmed joining, state broadcasts, one Baphomet present and player facing left after moving left and stopping.
- Full-world pathfinding verified that the player starting area connects to the Baphomet sanctuary.
- The game was **not** visually smoke-tested in a live browser against Render in this environment; the included previews are offline compositions made with the actual PNG assets, not screenshots of a running game.
