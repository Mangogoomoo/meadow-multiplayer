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
