# ModernQUAKE

Quake III-style arena FPS in the browser (Three.js + TypeScript + Vite).

## Play solo (with bots)
`npm install && npm run dev` then open http://127.0.0.1:5173

## Multiplayer
The room server (`server/server.mjs`) serves the built game AND the WebSocket relay on one port.

    npm install
    npm start            # builds, then serves on http://localhost:8080 (PORT env var to change)

Open the page, type a name + room code, press PLAY ONLINE. Anyone who opens the same URL and enters the
same room code joins you (max 8 per room). `?room=CODE&name=YOU` in the URL does the same.

### Let friends join
- **Quick (your PC):** `cloudflared tunnel --url http://localhost:8080` and send the printed https link.
- **Permanent:** deploy this repo to Render / Railway / Fly.io as a Node web service
  (build: `npm install && npm run build`, start: `npm run server`). Vercel can't host WebSockets, so if you want the
  page on Vercel, deploy the server elsewhere and open the Vercel page with `?server=your-server.onrender.com&room=CODE`.
