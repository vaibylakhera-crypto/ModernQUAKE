# ModernQUAKE

Quake III-style arena FPS in the browser (Three.js + TypeScript + Vite).

## Play solo (with bots)
`npm install && npm run dev` then open http://127.0.0.1:5173

## Multiplayer
The room server (`server/server.mjs`) serves the built game AND the WebSocket relay on one port.

    npm install
    npm start            # builds, then serves on http://localhost:8080 (PORT env var to change)

Open the page and use the menu:
- **HOST GAME** - pick map, bots (0-7), bot skill, frag limit, time limit and visibility. You get a room code plus
  COPY INVITE LINK / SHARE. The host's device runs the bots; if the host leaves, another player takes them over.
- **JOIN GAME** - type the code, or tap a game in OPEN GAMES (listed rooms, from `GET /api/rooms`).
- **Lobby** - warm up until the host presses START MATCH; results show when a limit is hit, then back to warmup.
- Invite links look like `https://your-host/?room=CODE`. Max 8 players per room, plus bots.

### Let friends join
- **Quick (your PC):** `cloudflared tunnel --url http://localhost:8080` and send the printed https link.
- **Permanent:** deploy this repo to Render / Railway / Fly.io as a Node web service
  (build: `npm install && npm run build`, start: `npm run server`). Vercel can't host WebSockets, so if you want the
  page on Vercel, deploy the server elsewhere and open the Vercel page with `?server=your-server.onrender.com&room=CODE`.

## Play on phones (add to Home Screen)
Phones get touch controls automatically: left thumb = move stick, right thumb = drag to aim, hold **FIRE** and drag to
shoot while aiming, **JUMP**, **DUCK** (toggle), **⇄** next weapon, tap a weapon slot to pick it, **❚❚** pause.
Aim speed slider is on the start screen. Play in landscape.

Open the hosted URL (e.g. your Render link) on the phone, then:
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Add to Home screen* / *Install app*.

Launching from the icon opens it fullscreen like an app. Everyone uses the same room code to play together.
Test touch controls on desktop with `?touch=1`. The default look is the dark alien-fortress arena (`?style=kit` = the older bright sci-fi kit). The default sky is black with stars; `?sky=nebula` brings back the painted space sky.
