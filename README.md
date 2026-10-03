# Crew Zero

A browser game for 3–6 players. Create a room, share its six-character code, and have friends open the same game URL and join. The host starts the round. Each round randomly assigns one impostor.

- Crewmates repair four shared systems or vote out the impostor.
- The impostor wins by reducing the living crew to one or letting the four-minute timer expire.
- Move with WASD, arrows, or the mobile direction pad. E repairs, R reports. Use the Commons table for one emergency meeting per player.
- Meetings include text chat, a 12-second discussion period, and voting. Ties skip ejection.
- Eliminated players spectate. The host can return everyone to the lobby after the round.
- Refreshing the same tab reconnects its session. Players absent for 30 seconds are removed from the lobby or eliminated from a running round; hosting transfers automatically.
- Rooms expire after two hours. Share codes only with the people you want to play with. There is no public room directory.

## Run locally

Requires Node.js 24+.

```sh
npm ci
npm start
```

Open http://localhost:3000. Other devices on the same network use the host computer's LAN address and port 3000. Allow the port through the host's firewall if needed. Keep the process running. Local state is stored in `.local/rooms.sqlite` and is excluded from Git.

## Validate and build

```sh
npm test
npm run build
```

The hosted Worker uses D1 with a `DB` binding and the versioned Drizzle migrations. It embeds the browser assets, so no asset service is needed. The server validates roles, movement, task proximity, kills, cooldowns, voting eligibility, and host actions. Revision checks prevent concurrent room writes from losing updates. Session tokens are never included in other players' responses. Clients synchronize over HTTP every 180ms; real-world latency can make movement less smooth than dedicated action-game servers.

`public/solo.html` preserves the original solo game. The downloadable `Crew-Zero.html` is that older standalone solo version; multiplayer requires the shared server.
