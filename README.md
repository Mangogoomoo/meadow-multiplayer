# Meadow Multiplayer RPG

A lightweight top-down HTML5 multiplayer game with a Node.js WebSocket server.

## Play locally

Install Node.js, open a terminal in the folder containing `package.json`, and run:

```powershell
npm.cmd install
npm.cmd start
```

Open http://localhost:3000 in two browser windows to test multiplayer.

## Controls

- WASD / Arrow keys: move, including diagonally
- Space: cosmetic jump (your shadow shrinks as you rise)
- F: swing sword in the last facing direction
- Type a name in the top-left field and click Rename

## Gameplay

- Players start with 5 HP at level 1, with level cap 50.
- Every level increases maximum HP by 1.5 and sword damage by 0.18.
- XP required to advance from a level: round(10 + 6 * level + 1.3 * level²).
- Rat: 3 HP, gives 6 XP; charges at nearby players; deals 0.5–1 HP per hit.
- Bat: 2.5 HP, gives 8 XP; fires purple spit when near; deals 0.5–1 HP.
- Monsters respawn after 6 seconds. Players who reach 0 HP respawn at the starting area with full HP.
- Movement, monster attacks, damage, level-ups and XP are simulated by the server.

## Local saving

The browser automatically saves name, X/Y position, HP, XP and level to `localStorage` about once per second, on page hide, and when disconnected. Chrome typically stores this under its Windows AppData browser profile, but it is **not** a standalone AppData save file. Saves are specific to the website origin and browser profile; clearing site data deletes them.

The server validates that loaded positions are on traversable ground and clamps the other values to sane ranges. These browser-side saves are **not cheat-proof**: players can edit localStorage. A future account/database system is needed for a trustworthy online RPG.

## Deploy on Render

1. Upload `server.js`, `package.json`, and the `public` folder into the root of your GitHub repository (README optional).
2. Create a Render **Web Service**, choose Node, and select your repository.
3. Use build command `npm install` and start command `npm start`; root directory blank; instance Free.
4. The game is playable directly at the Render URL (such as `https://your-game.onrender.com`).

## Separate InfinityFree frontend

If you want to host the HTML/JS files on InfinityFree instead of serving them from Render:

1. Edit **`public/game.js`**, near the top, replacing `const SERVER_URL='';` with `const SERVER_URL='https://YOUR-SERVICE.onrender.com';` (use your actual Render service URL).
2. Upload the contents of `public/` to an InfinityFree directory, keeping `index.html` and `game.js` together.
3. The client automatically converts `https://` to `wss://` to reach the WebSocket server on Render.

On Render Free, the backend may sleep after periods of inactivity. Only Node.js runs on Render; InfinityFree serves static client files.

## Notes

The map is deterministic (same trees/water on both sides). Collision and combat are enforced by the server. This is an early multiplayer prototype, not a secured production account system.

## Automatic updates and cache refresh

- `public/index.html` requests `game.js` with a unique timestamp on **every page open or reload**, bypassing old cached JavaScript.
- Render's Node server responds with `Cache-Control: no-store` for game files so browsers revalidate/load the HTML rather than hanging onto an old copy.
- The WebSocket welcome message contains a version fingerprint of the deployed files. If it changes **while a player keeps the page open** (for example after a Render redeploy/reconnect), the client saves progress and automatically reloads once.
- The game preserves localStorage saves; no progress reset or storage clearing is required.
- Browser code cannot literally invoke Ctrl+Shift+R. This is the practical equivalent for this project's JS/HTML files.
- With an **InfinityFree** frontend, you still must upload the new `public/` files there. A new backend deployment cannot magically replace old client files on InfinityFree.
- Keep `public/index.html` and `public/game.js` together on either host. No new dependencies are needed.


## Online keyboard-action troubleshooting

This version adds Jump/Sword buttons and an action-status display in the top-left HUD.
Press Space/F or click the corresponding button. A checkmark confirms the WebSocket
server received and accepted the action. If it stays on "sent…", check that the
latest server.js was committed and deployed to Render. Both client and server files
must be deployed together.


## Remote animation sync fix

Jump and sword slash effects now use browser-local animation timing rather than
subtracting the server's timestamps from the browser's clock. The server still
authoritatively handles sword damage, jump cooldowns and multiplayer state.
Action acknowledgements provide immediate animation feedback, and new action
timestamps in state snapshots animate other connected players as well.
This fixes animations not showing when the Render server clock differs from the
player's PC clock. Player saves remain unchanged.

## Stats and mouse combat update

- Move with WASD or arrow keys. Movement interpolation and camera follow are faster for a snappier feel.
- Press Space to jump. **Left-click on the map** to swing the sword toward the cursor. F is no longer bound to attack.
- Use the **Stats** button in the top-left HUD to show STR, AGI, VIT, INT, DEX and LUK and spend available points.
- You earn **5 stat points per level**, 245 total by level 50. All stats begin at zero and cap at 50. Stat levels 1–10 cost one point each, 11–20 cost two each, 21–30 cost three, 31–40 cost four, 41–50 cost five. Maximizing one stat takes **150 points**, leaving **95 points**, so you cannot maximize two stats.
- STR adds melee damage, AGI reduces sword cooldown, VIT increases max health, INT increases displayed magic damage (magic spells not implemented yet), DEX improves monster hit rating, LUK improves critical chance and critical damage. Bats need more hit rating than rats. Low hit rating can cause misses.
- Save data now includes allocated stats and remains in browser localStorage. The server checks saved stat allocations against points earned for the submitted level, but browser saves remain editable and are not appropriate for competitive progression.
- Replace the full `server.js`, `public/game.js`, and `public/index.html` together in your GitHub repository. Render must run the updated server for stats and mouse aiming to work.


## Combat / movement update
- Left Shift sprints (285 versus 175 walking speed). Running drains 33 energy/second, resting/walking regenerates 19/second. Energy is server-controlled.
- Hold left mouse to auto attack; sword faces cursor and swings. Server controls attack cooldown.
- Monsters are knocked back on sword hits; players are knocked back when damaged. Server enforces collisions.
- Damage numbers and misses appear at the point of impact.
- Jump now lasts 480 ms. Server rejects bat spit hits throughout the jump window (while airborne).
- Replace server.js AND public/game.js AND public/index.html together. Existing browser saves stay intact.


## Social and skills update
- Chat at lower left is broadcast to connected players; latest 30 messages remain in RAM until the server restarts.
- Reset stats at bottom of Stats window returns spent points, without changing level.
- Delete character double-confirms, clears localStorage, and reloads a fresh character. It only affects that browser/site origin.
- Action bar has five slots, shortcut keys 1–5. Slot 1 Whirlwind spins for three seconds while moving, deals repeated area damage, and has an 11-second cooldown from activation. Slots 2–5 are placeholders.
- Controls guide moves to lower right.
- Changes are server authoritative for stat resets, chat, and Whirlwind. Use updated server.js and both public files together.


## New in this update
- Hold down a stat `+` button to continuously spend available points. Upgrades remain server-validated.
- Whirlwind's overlay disappears completely when ready (no black box or `0s`).
- Removed sword/jump debug status and player collision-box outline.
- Slot **2** / key **2**: Earthbreaker. Aim with the mouse, leap up to 230 world units (520 ms), then stun monsters within 100 units for 2 seconds. 9-second cooldown. Landing cracks linger and fade over 4.4 seconds. Invalid landing locations cannot be selected.
- Expanded Stats window with melee attack, attack speed, magic attack, hit rating, crit chance, crit damage, max HP and movement speed.

### Deployment
Upload `server.js` at the GitHub repository root and `public/game.js` and `public/index.html` inside `public`, then commit. Render redeploys automatically if enabled. Both client and server files must be updated together.

### Verification
Both JavaScript files passed Node syntax checks. A live multiplayer integration test was not possible in this environment because the `ws` package was not locally available.

## HUD polish and effects update
- Added a **Minimap** in the top-right corner and a **Debug Level Up** button below it.
- Added a bottom-right **?** help button that shows the controls guide on hover/focus.
- Improved the Stats panel scrollbar styling.
- Added action-bar art for **Whirlwind** and **Earthbreaker** and centered the action-bar text.
- Added more Earthbreaker impact particles and dust.
- Added directional hit particles / blood splatter when enemies are hit and impact particles when players are damaged.
- Added rotating **stun** stars above stunned enemies.
- Added a server-side `debug_level` message used by the Debug Level Up button.


## Level 99 and notifications update
- Max player level is now **99**, and all six stats cap at **99**.
- Stat point costs now step up every **20** stat ranks, rather than every 10, to keep 99 reachable with five points per level. A single stat needs 295 points to max; level 99 provides 490 points total. You can max one stat with points left over, but not two.
- Notifications now appear in a right-side stack below the minimap and debug level button, rather than overlapping them.

## Baphomet phase update
- Baphomet respawns 60 seconds after defeat, with fresh phase flags.
- Baphomet.Jr spawn once when the boss first reaches 50% health; defeated juniors do not respawn. All remaining juniors are removed immediately when the boss dies.
- Earthquake casts at the first crossing of 75% and 25% boss health, once each per boss life. Baphomet stands still to cast for 3 seconds. A large 360-unit radius red warning circle, shrinking countdown circle, and EARTHQUAKE castbar appear on all clients. When the cast completes, anyone in the radius takes approximately 13-18 HP (subject to existing invulnerability). The boss resumes fighting after the cast.
- Update `server.js` and `public/game.js` together. The other project files are included unchanged.
