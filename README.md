# Meadow Multiplayer

A simple HTML5 top-down multiplayer game. All visitors connect to a Node.js WebSocket server, so they see each other moving around the same grass / tree / water map.

## Requirements
- Node.js 18 or newer
- Hosting that can run a persistent Node.js process and accept WebSocket connections (or a VPS)

## Start locally
1. Open a terminal in this folder.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000 in your browser.
5. Open the same URL in a second browser/tab/device to see multiplayer.

## Put it on a website
Upload this entire folder to your Node.js-capable host, run `npm install` and `npm start`, and point your domain to the process through a reverse proxy that supports WebSocket upgrades. For a public deployment, use HTTPS so connections become WSS automatically. If you're using nginx, proxy the site to `http://127.0.0.1:3000` and forward the `Upgrade` and `Connection` headers.

An ordinary static-only web host (HTML/PHP-only shared plan without long-running Node processes) cannot host this multiplayer server by itself. You can still host the files in `public/` there if you separately run a WebSocket backend, but then `game.js` needs its WebSocket URL changed to that backend.

## Notes
- Movement is server-authoritative; trees and water block movement.
- Players receive randomized appearances and temporary IDs. No accounts, chat, persistence, or database.
- This is a starter project, not yet production-hardened for massive public traffic.
