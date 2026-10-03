// public/map.js
var rooms = [{ x: 65, y: 65, w: 245, h: 180, name: "ELECTRICAL" }, { x: 590, y: 65, w: 245, h: 180, name: "OXYGEN" }, { x: 65, y: 365, w: 245, h: 170, name: "NAVIGATION" }, { x: 590, y: 365, w: 245, h: 170, name: "REACTOR" }, { x: 355, y: 215, w: 190, h: 180, name: "COMMONS" }];
var floors = [...rooms, { x: 180, y: 270, w: 540, h: 60 }, { x: 165, y: 220, w: 65, h: 180 }, { x: 670, y: 220, w: 65, h: 180 }, { x: 420, y: 320, w: 60, h: 220 }, { x: 370, y: 475, w: 160, h: 85 }];
var stations = [{ x: 120, y: 125, title: "Restore power", room: "Electrical" }, { x: 775, y: 125, title: "Refresh oxygen", room: "Oxygen" }, { x: 120, y: 465, title: "Set coordinates", room: "Navigation" }, { x: 775, y: 465, title: "Stabilize reactor", room: "Reactor" }];
function canWalk(x, y) {
  return [[-11, -11], [11, -11], [-11, 11], [11, 11]].every(([a, b]) => floors.some((r) => x + a >= r.x && x + a <= r.x + r.w && y + b >= r.y && y + b <= r.y + r.h));
}
function move(p, dx, dy) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5) || 1;
  for (let i = 0; i < steps; i++) {
    if (canWalk(p.x + dx / steps, p.y)) p.x += dx / steps;
    if (canWalk(p.x, p.y + dy / steps)) p.y += dy / steps;
  }
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function visible(a, b) {
  for (let t = 0; t <= 1; t += 0.04) if (!canWalk(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  return true;
}

// src/engine.mjs
var GameError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var requireThat = (ok, msg, status) => {
  if (!ok) throw new GameError(msg, status);
};
var newRoom = (code, now) => ({ code, phase: "lobby", players: [], host: null, tasks: [], bodies: [], votes: {}, chat: [], meeting: null, winner: null, message: "Waiting for the crew.", created: now, expires: now + 72e5 });
function addPlayer(r, name, now, id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID()) {
  requireThat(r.phase === "lobby", "This mission has already started. Join the next round.");
  requireThat(r.players.length < 9, "This room is full.");
  requireThat(typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 16 && !/[\x00-\x1f<>]/.test(name), "Use a name of 1\u201316 characters.");
  const taken = new Set(r.players.map((p2) => p2.color));
  let color = 0;
  while (taken.has(color)) color++;
  const p = { id, token, name: name.trim(), color, x: 435 + color % 3 * 15, y: 490 + Math.floor(color / 3) * 25, alive: true, role: "crew", seen: now, moved: now, seq: 0, called: false, repair: null, cooldown: 0 };
  r.players.push(p);
  r.host ??= p.id;
  return p;
}
function finish(r, winner, message) {
  r.motionEpoch = (r.motionEpoch || 0) + 1;
  r.phase = "ended";
  r.winner = winner;
  r.message = message;
  r.players.forEach((p) => p.repair = null);
}
function checkWin(r) {
  if (r.phase !== "playing" && r.phase !== "meeting") return;
  const alive = r.players.filter((p) => p.alive), imp = alive.filter((p) => p.role === "impostor");
  if (!imp.length) finish(r, "crew", "The impostor is out. The crew wins!");
  else if (r.players.length === 2 ? alive.length - imp.length === 0 : alive.length - imp.length <= imp.length) finish(r, "impostor", "The impostor has taken over the ship.");
  else if (r.tasks.length === 4) finish(r, "crew", "All systems repaired. The crew escapes!");
}
function resolveVote(r, now) {
  const counts = {};
  Object.values(r.votes).forEach((id) => counts[id] = (counts[id] || 0) + 1);
  const scores = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let ejected = null;
  if (scores.length && scores[0][0] !== "skip" && (!scores[1] || scores[0][1] > scores[1][1])) ejected = r.players.find((p) => p.id === scores[0][0] && p.alive);
  if (ejected) {
    ejected.alive = false;
    r.message = `${ejected.name} was ejected.`;
  } else r.message = "No one was ejected.";
  r.motionEpoch = (r.motionEpoch || 0) + 1;
  r.phase = "playing";
  r.deadline += now - r.meeting.started;
  r.meeting = null;
  r.bodies = [];
  r.players.forEach((p) => {
    p.repair = null;
    p.cooldown = now + 12e3;
    p.moved = now;
  });
  checkWin(r);
}
function advance(r, now) {
  const gone = r.players.filter((p) => now - p.seen > 3e4);
  if (r.phase === "lobby") r.players = r.players.filter((p) => now - p.seen <= 3e4);
  else gone.forEach((p) => {
    p.alive = false;
    p.repair = null;
  });
  if (!r.players.some((p) => p.id === r.host && now - p.seen <= 3e4)) r.host = r.players.find((p) => now - p.seen <= 3e4)?.id ?? null;
  checkWin(r);
  if (r.phase === "meeting" && now >= r.meeting.ends) resolveVote(r, now);
  if (r.phase === "playing" && now >= r.deadline) finish(r, "impostor", "Time ran out before the repairs were finished.");
}
function applyInputs(r, p, inputs, epoch, now) {
  requireThat(Array.isArray(inputs) && inputs.length <= 48, "Invalid movement batch.");
  for (const f of inputs) requireThat(Number.isSafeInteger(f.id) && f.id > 0 && Number.isFinite(f.dx) && Number.isFinite(f.dy) && Math.abs(f.dx) <= 1 && Math.abs(f.dy) <= 1 && Number.isFinite(f.dt) && f.dt > 0 && f.dt <= 0.1, "Invalid movement frame.");
  if (epoch !== (r.motionEpoch || 0)) return;
  if (!inputs.length) return;
  p.motionSeq ??= 0;
  let budget = Math.min(1.5, (p.motionBudget ?? 0.12) + Math.max(0, (now - (p.motionAt ?? now)) / 1e3));
  for (const f of inputs) {
    if (f.id <= p.motionSeq) continue;
    const dt = Math.min(f.dt, budget);
    budget -= dt;
    p.motionSeq = f.id;
    if (r.phase === "playing" && p.alive && !p.repair) {
      const len = Math.max(1, Math.hypot(f.dx, f.dy));
      move(p, f.dx / len * 165 * dt, f.dy / len * 165 * dt);
    }
  }
  p.motionAt = now;
  p.motionBudget = budget;
}
function apply(r, p, a, now, random = Math.random) {
  requireThat(a && typeof a.type === "string", "Invalid action.");
  if (now - p.seen >= 3e3) p.seen = now;
  if (a.inputs !== void 0) {
    applyInputs(r, p, a.inputs, a.epoch, now);
    if (a.type === "input") return;
  }
  if (a.type === "input") {
    requireThat(Number.isFinite(a.dx) && Number.isFinite(a.dy) && Math.abs(a.dx) <= 1 && Math.abs(a.dy) <= 1, "Invalid movement.");
    const dt = Math.max(0, Math.min((now - p.moved) / 1e3, 0.3));
    p.moved = now;
    if (r.phase === "playing" && p.alive && !p.repair) {
      let len = Math.hypot(a.dx, a.dy) || 1;
      move(p, a.dx / Math.max(1, len) * 165 * dt, a.dy / Math.max(1, len) * 165 * dt);
    }
    return;
  }
  requireThat(Number.isSafeInteger(a.seq) && a.seq > 0, "Invalid action sequence.");
  if (a.seq <= p.seq) return;
  const host = () => requireThat(r.host === p.id, "Only the host can do this.", 403);
  if (a.type === "start") {
    host();
    requireThat(r.phase === "lobby", "The mission has already started.");
    requireThat(r.players.length >= 2, "You need at least 2 players.");
    r.motionEpoch = (r.motionEpoch || 0) + 1;
    r.phase = "playing";
    r.deadline = now + 24e4;
    r.tasks = [];
    r.bodies = [];
    r.chat = [];
    r.votes = {};
    r.winner = null;
    r.message = "Repair the ship. One of you is the impostor.";
    const imp = Math.floor(random() * r.players.length);
    r.players.forEach((q, i) => Object.assign(q, { alive: true, role: i === imp ? "impostor" : "crew", x: 435 + i % 3 * 15, y: 490 + Math.floor(i / 3) * 25, moved: now, motionAt: now, motionBudget: 0.12, called: false, repair: null, cooldown: now + 2e4 }));
  } else if (a.type === "rematch") {
    host();
    requireThat(r.phase === "ended", "Finish this round first.");
    r.phase = "lobby";
    r.tasks = [];
    r.bodies = [];
    r.meeting = null;
    r.votes = {};
    r.chat = [];
    r.winner = null;
    r.message = "Ready for another shift?";
    r.players = r.players.filter((q) => now - q.seen <= 3e4);
    r.players.forEach((q) => Object.assign(q, { alive: true, role: "crew", repair: null }));
  } else if (a.type === "leave") {
    if (r.phase === "lobby") r.players = r.players.filter((q) => q.id !== p.id);
    else {
      p.alive = false;
      p.seen = now - 31e3;
    }
    if (r.host === p.id) r.host = r.players.find((q) => q.id !== p.id && now - q.seen <= 3e4)?.id ?? null;
    checkWin(r);
  } else {
    requireThat(p.alive, "You are spectating this round.");
    if (a.type === "vote") {
      requireThat(r.phase === "meeting", "There is no meeting.");
      requireThat(now >= r.meeting.discussUntil, "Discuss before voting.");
      requireThat(!r.votes[p.id], "You already voted.");
      requireThat(a.target === "skip" || r.players.some((q) => q.id === a.target && q.alive), "Choose a living player or skip.");
      r.votes[p.id] = a.target;
      if (r.players.filter((q) => q.alive).every((q) => r.votes[q.id])) resolveVote(r, now);
    } else if (a.type === "chat") {
      requireThat(r.phase === "meeting", "Chat is available during meetings.");
      requireThat(typeof a.text === "string" && a.text.trim().length > 0 && a.text.length <= 160, "Use 1\u2013160 characters.");
      requireThat(!p.chatted || now - p.chatted >= 700, "Please wait a moment.");
      p.chatted = now;
      r.chat.push({ id: crypto.randomUUID(), name: p.name, color: p.color, text: a.text.trim() });
      r.chat = r.chat.slice(-40);
    } else {
      requireThat(r.phase === "playing", "The mission is not running.");
      if (a.type === "repair") {
        requireThat(p.role === "crew", "Impostors cannot repair systems.");
        requireThat(Number.isInteger(a.station) && stations[a.station] && !r.tasks.includes(a.station), "Choose an unfinished task.");
        requireThat(distance(p, stations[a.station]) < 68, "Move closer to the terminal.");
        p.repair = { station: a.station, started: now };
      } else if (a.type === "complete") {
        requireThat(p.role === "crew" && p.repair, "Start a repair first.");
        if (a.order !== void 0) requireThat(Array.isArray(a.order) && a.order.length === 4 && a.order.every((v, i) => v === i + 1), "Finish the switches in order.");
        else requireThat(now - p.repair.started >= 800, "Finish the switches first.");
        requireThat(distance(p, stations[p.repair.station]) < 68, "Move closer to the terminal.");
        if (!r.tasks.includes(p.repair.station)) r.tasks.push(p.repair.station);
        p.repair = null;
        checkWin(r);
      } else if (a.type === "cancel") p.repair = null;
      else if (a.type === "kill") {
        requireThat(p.role === "impostor", "Only the impostor can eliminate players.", 403);
        requireThat(now >= p.cooldown, "Eliminate is still cooling down.");
        const q = r.players.find((q2) => q2.id === a.target && q2.alive && q2.id !== p.id);
        requireThat(q && distance(p, q) < 48 && visible(p, q), "Move closer to a crewmate.");
        q.alive = false;
        q.repair = null;
        r.bodies.push({ id: q.id, x: q.x, y: q.y, color: q.color });
        p.cooldown = now + 2e4;
        checkWin(r);
      } else if (a.type === "report" || a.type === "meeting") {
        if (a.type === "report") requireThat(r.bodies.some((b) => distance(p, b) < 70 && visible(p, b)), "Move closer to a downed crewmate.");
        else {
          requireThat(!p.called, "You already called your emergency meeting.");
          requireThat(distance(p, { x: 450, y: 270 }) < 70, "Visit the table in Commons.");
          p.called = true;
        }
        r.motionEpoch = (r.motionEpoch || 0) + 1;
        r.phase = "meeting";
        r.meeting = { started: now, discussUntil: now + 12e3, ends: now + 45e3, caller: p.name, reason: a.type === "report" ? "A crewmate was found." : "Emergency meeting." };
        r.votes = {};
        r.chat = [];
        r.players.forEach((q) => q.repair = null);
      } else throw new GameError("Unknown action.");
    }
  }
  p.seq = a.seq;
}
function view(r, p, now) {
  return { motionAck: p.motionSeq || 0, motionEpoch: r.motionEpoch || 0, code: r.code, phase: r.phase, host: r.host, you: p.id, role: r.phase === "lobby" ? null : p.role, alive: p.alive, seq: p.seq, tasks: r.tasks, bodies: r.bodies, winner: r.winner, message: r.message, remaining: r.phase === "meeting" ? Math.max(0, (r.deadline - r.meeting.started) / 1e3) : Math.max(0, ((r.deadline || now) - now) / 1e3), cooldown: Math.max(0, (p.cooldown - now) / 1e3), repair: p.repair, called: p.called, meeting: r.meeting ? { ...r.meeting, remaining: Math.max(0, (r.meeting.ends - now) / 1e3), discussion: Math.max(0, (r.meeting.discussUntil - now) / 1e3) } : null, chat: r.chat, voted: !!r.votes[p.id], votesCast: Object.keys(r.votes).length, players: r.players.map((q) => ({ id: q.id, name: q.name, color: q.color, x: q.x, y: q.y, alive: q.alive, connected: now - q.seen < 1e4, ...r.phase === "ended" ? { role: q.role } : {} })) };
}

// src/api.mjs
var json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function api(request, db) {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "Origin not allowed." }, 403);
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: "Request too large." }, 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const path = new URL(request.url).pathname, now = Date.now();
    if (path === "/api/create") {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => alphabet[n % alphabet.length]).join("");
      const r = newRoom(code, now);
      const p = addPlayer(r, input.name, now);
      await db.prepare("DELETE FROM rooms WHERE expires < ?").bind(now).run();
      const result = await db.prepare("INSERT OR IGNORE INTO rooms (code,state,revision,expires) VALUES (?,?,0,?)").bind(code, JSON.stringify(r), r.expires).run();
      if (!result.meta.changes) throw new GameError("Please try creating the room again.", 409);
      return json({ token: p.token, state: view(r, p, now) });
    }
    if (!/^\/api\/(join|sync)$/.test(path)) return json({ error: "Not found." }, 404);
    if (typeof input.code !== "string" || !/^[A-Z2-9]{6}$/.test(input.code)) throw new GameError("Enter a six-character room code.");
    for (let attempt = 0; attempt < 16; attempt++) {
      const row = await db.prepare("SELECT state,revision FROM rooms WHERE code = ? AND expires > ?").bind(input.code, now).first();
      if (!row) throw new GameError("Room not found or expired.", 404);
      const r = JSON.parse(row.state);
      let p;
      if (path === "/api/sync") {
        p = r.players.find((q) => q.token === input.token);
        if (!p) throw new GameError("Your session has ended. Please join again.", 401);
        if (now - p.seen >= 3e3) p.seen = now;
      }
      advance(r, now);
      if (path === "/api/join") p = addPlayer(r, input.name, now);
      else apply(r, p, input.action, now);
      const serialized = JSON.stringify(r);
      if (serialized === row.state) return json({ state: view(r, p, now) });
      const updated = await db.prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE code = ? AND revision = ?").bind(serialized, r.code, row.revision).run();
      if (updated.meta.changes) return json({ ...path === "/api/join" ? { token: p.token } : {}, state: view(r, p, now) });
    }
    throw new GameError("Room is busy. Please retry.", 409);
  } catch (e) {
    if (!(e instanceof GameError)) console.error("Room operation failed:", e.message);
    return json({ error: e instanceof GameError ? e.message : "The game server is temporarily unavailable. Please retry." }, e instanceof GameError ? e.status : 503);
  }
}

// worker.mjs
var assets = { "/": { "body": `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Global \u2014 Play with friends</title><meta name="description" content="Create a room, invite friends with a code, and find the impostor."><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23b9f569'/%3E%3Cpath d='M9 10h14v12H9z' fill='%23101620'/%3E%3Cpath d='M12 13h8v4h-8z' fill='%23b9f569'/%3E%3C/svg%3E"><style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
:root{color-scheme:dark;--bg:#0c1016;--panel:#131922;--line:#29313c;--lime:#b9f569;--muted:#929caa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#eef1ed;font:16px 'Space Grotesk',sans-serif}button{font:inherit;cursor:pointer;color:inherit}button:focus-visible{outline:3px solid #fff;outline-offset:4px}button:disabled{opacity:.45;cursor:default}header{height:88px;max-width:1440px;margin:auto;padding:0 42px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-size:25px;font-weight:700;letter-spacing:-1px}.brand span{color:var(--lime)}.mono{font:12px 'Space Mono',monospace;letter-spacing:1.5px}.tag{padding:8px 12px;border:1px solid var(--line);border-radius:5px;color:#b8c0cb}main{max-width:1440px;margin:auto;padding:32px 42px}.top{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{font-size:32px;letter-spacing:-1.3px;margin:7px 0}.eyebrow{color:var(--lime)}.sub{color:var(--muted);margin:0}.controls{display:flex;gap:10px}.quiet{background:#1b232e;border:1px solid #35404e;padding:10px 16px;border-radius:7px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:24px}.game{position:relative;background:#080d16;border:1px solid #35404e;border-radius:12px;overflow:hidden}.hud{display:flex;align-items:center;gap:16px;background:#131a24;padding:17px 22px;border-bottom:1px solid var(--line)}.meter{height:7px;background:#303947;flex:1;border-radius:20px;overflow:hidden}.meter div{height:100%;background:var(--lime);width:0;transition:width .4s}.hud .mono{color:#c2c9d1;white-space:nowrap}.canvas-wrap{position:relative;aspect-ratio:900/600}canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-items:center;background:#080d1690;backdrop-filter:blur(4px);padding:20px}.overlay.hidden{display:none}.modal{max-width:410px;text-align:center;background:#141d29;border:1px solid #465269;padding:32px;border-radius:16px;box-shadow:0 24px 80px #0008}.modal h2{font-size:36px;letter-spacing:-1px;margin:12px 0}.modal p{color:#b4becc;line-height:1.6}.primary{border:0;background:var(--lime);color:#152017;font-weight:700;padding:14px 28px;border-radius:7px;box-shadow:0 3px 0 #6c9f32}.primary:hover{background:#cbff88}.modal .primary{width:100%;margin-top:10px}.status{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#111a27e8;padding:10px 17px;border:1px solid #40516a;border-radius:8px;text-align:center;font-size:14px;white-space:nowrap;pointer-events:none}.foot{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}kbd{font:12px 'Space Mono',monospace;background:#252f3c;border:1px solid #445060;border-bottom-width:3px;border-radius:4px;padding:3px 6px;color:#e8edf4}.card{border:1px solid var(--line);border-radius:10px;padding:22px;background:var(--panel);margin-bottom:16px}.card h2{font-size:16px;margin:0 0 20px}.role{display:flex;gap:14px;align-items:center}.role-icon{font-size:32px;color:var(--lime)}.role strong{display:block;font-size:19px}.role small{color:var(--muted);display:block;margin-top:5px;font-size:14px}.tasks{list-style:none;padding:0;margin:0}.tasks li{display:flex;gap:12px;align-items:center;margin:22px 0}.tasks li:last-child{margin-bottom:0}.check{width:22px;height:22px;border:1px solid #505c6c;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.tasks strong{font-size:14px;font-weight:500;display:block}.tasks small{font-size:12px;color:var(--muted);display:block;margin-top:4px}.tasks .done .check{background:var(--lime);color:#142013;border-color:var(--lime)}.tasks .done strong{text-decoration:line-through;color:var(--muted)}.hint{font-size:14px;line-height:1.65;color:#aeb9c7}.hint b{color:#e8edf4;font-weight:500}.legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:20px}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}.bottom{display:flex;justify-content:space-between;margin-top:24px;color:#6e7b8c;font-size:12px}.touch{display:none;padding:16px;justify-content:space-between;align-items:center}.dpad{display:grid;grid-template-columns:repeat(3,43px);gap:4px}.dpad button{height:43px;border:1px solid #425064;background:#202d40;border-radius:8px;touch-action:none}.action{padding:18px 20px;touch-action:none}.sequence{display:flex;gap:9px;justify-content:center;margin:20px 0}.sequence button{width:60px;height:60px;border:1px solid #566b83;background:#253348;border-radius:9px;font-size:22px;font-weight:700}.sequence button.hit{background:var(--lime);color:#182514}.danger{color:#ff8787!important}@media(max-width:1050px){header{padding:0 24px}main{padding:26px 24px}.layout{grid-template-columns:minmax(0,1fr) 235px}.card{padding:18px}.foot{gap:15px;flex-wrap:wrap}}@media(max-width:760px){header{height:68px;padding:0 18px}.tag{font-size:10px}main{padding:22px 14px}.layout{grid-template-columns:1fr}.top{align-items:center}h1{font-size:26px}.sub{font-size:14px}.controls{gap:5px}.quiet{padding:9px 11px;font-size:14px}.hud{padding:14px 12px;gap:9px}.hud .mono{font-size:10px}.touch{display:flex}.foot{display:none}aside{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{margin:0}.role-card{display:none}.hint-card{grid-column:2;grid-row:1}.tasks li{margin:16px 0}.card h2{margin-bottom:12px}.bottom{line-height:1.6;gap:20px}.modal{padding:22px}.modal h2{font-size:28px}.modal p{font-size:14px}.status{font-size:11px;bottom:8px;max-width:96%;white-space:normal;width:max-content}.legend{gap:10px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}

input{width:100%;background:#0b1320;border:1px solid #536175;border-radius:7px;padding:12px;color:#fff;font:inherit;margin:7px 0 14px}label{display:block;text-align:left;font-size:14px;color:#bac6d5}.room-code{font:700 32px 'Space Mono',monospace;letter-spacing:5px;color:var(--lime);margin:15px 0}.roster{list-style:none;text-align:left;padding:0;margin:15px 0}.roster li{display:flex;align-items:center;gap:10px;margin:10px 0}.roster small{margin-left:auto;color:#aebac9}.modal{max-height:96%;overflow:auto;width:440px;max-width:100%}.modal h2{font-size:28px}.modal p{margin:12px 0}.modal .quiet{margin-top:8px}.action-bar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--line)}.action-bar .quiet{font-size:14px}.kill{border-color:#a25060;color:#ff9ea8}#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:20;max-width:90%;padding:12px 20px;border-radius:8px;background:#323b4d;color:white;display:none;box-shadow:0 5px 30px #0008}.meeting-modal{width:510px}.chat-log{height:120px;overflow:auto;background:#0b121d;text-align:left;padding:10px;border-radius:6px;font-size:14px}.chat-log p{margin:4px 0;line-height:1.4;overflow-wrap:anywhere}.chat-form{display:flex;gap:6px}.chat-form input{margin:8px 0}.chat-form button{margin:8px 0!important}.votes{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px}.votes button{font-size:14px}.entry-hint{font-size:13px!important}.role-card strong{font-size:18px}#connection{color:#8796a9;font-size:12px;margin-left:auto}.overlay{z-index:2}.game{min-width:0}@media(max-width:760px){.overlay{position:fixed;z-index:10;inset:0;padding:16px}.modal{max-height:90vh}.controls a{display:none}.role-card{display:block;grid-column:1/-1}.hint-card{grid-column:2;grid-row:2}.top h1{font-size:24px}.canvas-wrap{min-height:240px}.hud{flex-wrap:wrap}.meter{min-width:30px}.touch{padding-top:8px}}
.overlay{grid-template-columns:minmax(0,1fr)}.modal{min-width:0;justify-self:center}.top>div:first-child{min-width:0}.top{gap:12px}.controls{flex-shrink:0}@media(max-width:760px){.top{align-items:flex-start}.top h1{font-size:22px}.top .sub{line-height:1.5}}
.objective{padding:12px 18px;background:#192433;display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #344355}.objective strong{font-size:15px;display:block}.objective span{display:block;font-size:13px;color:#acb9cc;margin-top:5px}.objective b{font-size:14px;align-self:center;white-space:nowrap}.action-bar #interact{background:#253445;font-weight:700;min-width:230px;border-color:#527085}.action-bar #interact.ready,.touch .action.ready{background:var(--lime);color:#142015;border-color:var(--lime)}.action-bar #interact.kill.ready{background:#ef828c;border-color:#ef828c}.status{white-space:normal;width:max-content;max-width:90%;font-size:14px}.status.action-ready{border-color:var(--lime);color:var(--lime);background:#142019f5}.sequence .next-switch{background:var(--lime);color:#142015;outline:3px solid #b9f56955;outline-offset:4px}.sequence button:disabled{opacity:.45}.sequence button.hit{opacity:1}.touch .action{max-width:53%;font-size:14px;min-height:54px}.canvas-wrap canvas{touch-action:none}@media(max-width:760px){.objective{padding:12px;flex-wrap:wrap;gap:6px}.objective strong{font-size:14px}.objective span{font-size:12px}.action-bar #interact{display:none}.action-bar{padding:9px 12px}.action-bar #report,.action-bar #meeting{padding:9px;font-size:12px}.status{font-size:12px;bottom:5px;max-width:92%;padding:7px 10px}.canvas-wrap{aspect-ratio:900/660}.touch{border-top:1px solid var(--line)}.dpad{grid-template-columns:repeat(3,46px)}.dpad button{height:46px}.top{margin-bottom:15px}header{height:58px}main{padding-top:16px}}
@media(min-width:761px){.canvas-wrap{height:clamp(280px,calc(100dvh - 480px),610px);aspect-ratio:auto}.canvas-wrap canvas{object-fit:contain}.status{bottom:10px}}#toast{top:16px;bottom:auto}.controls a{color:inherit}
</style></head><body><header><div class="brand">global<span style="font-size:14px;margin-left:5px">\u2726</span><span style="font-size:14px;color:#697588;margin-left:13px">/</span></div><div class="tag mono">MULTIPLAYER \xB7 2\u20139 PLAYERS</div></header><main><div class="top"><div><div class="eyebrow mono">THE LAST SHIFT</div><h1>Something\u2019s off on board.</h1><p class="sub">One ship. One impostor. Bring your crew.</p></div><div class="controls"><a class="quiet" href="/solo.html" style="text-decoration:none">Solo game</a><button class="quiet" id="leave">Leave room</button></div></div><div class="layout"><section class="game" aria-label="Space survival game"><div class="hud"><span class="mono">SHIP SYSTEMS</span><div class="meter"><div id="progress"></div></div><span class="mono" id="count">0 / 4</span><span class="mono" id="timer">04:00</span></div><div class="objective"><div><strong id="objectiveTitle">Create a room or join your friends</strong><span id="objectiveDetail">2\u20139 players \xB7 One secret impostor</span></div><b id="identity"></b></div><div class="canvas-wrap"><canvas id="canvas" width="900" height="600" aria-label="Ship map. Use WASD or arrow keys to move and E to interact."></canvas><div class="status" id="status">Ready for your shift?</div><div class="overlay" id="overlay"><div class="modal" id="modal"></div></div></div><div class="action-bar"><button class="quiet" id="interact">Repair [E]</button><button class="quiet" id="report">Report [R]</button><button class="quiet" id="meeting">Emergency meeting</button><button class="quiet kill" id="kill" hidden>Eliminate</button><span id="connection">Not connected</span></div><div class="foot"><span><kbd>W A S D</kbd> or <kbd>\u2191 \u2190 \u2193 \u2192</kbd> Move</span><span><kbd>E</kbd> Nearby action &nbsp; <kbd>R</kbd> Report</span></div><div class="touch"><div class="dpad"><span></span><button data-key="ArrowUp" aria-label="Move up">\u2191</button><span></span><button data-key="ArrowLeft" aria-label="Move left">\u2190</button><button data-key="ArrowDown" aria-label="Move down">\u2193</button><button data-key="ArrowRight" aria-label="Move right">\u2192</button></div><button class="primary action" id="use">Interact</button></div></section><aside><div class="card role-card"><div class="role"><div class="role-icon">\u2726</div><div><strong>Crewmate</strong><small>That\u2019s you. Stay sharp.</small></div></div></div><div class="card"><h2>Ship repairs <span style="color:#8e9bab;float:right;font-weight:400" id="taskNum">0/4</span></h2><ul class="tasks" id="tasks"></ul></div><div class="card hint-card"><h2>A friendly heads-up</h2><p class="hint">One player is secretly the <b>impostor</b>. Everyone has a different color\u2014color does not reveal their role.</p><p class="hint">Crew: finish all four repairs or vote out the impostor. Report a body or call a meeting in <b>Commons</b>.</p><p class="hint">Discuss in meeting chat. Dead players can watch, but cannot vote.</p></div></aside></div><div class="bottom mono"><span>VESSEL 09 / DEEP SPACE</span><span>2\u20139 PLAYERS \xB7 PRIVATE ROOM CODES</span></div></main><div id="toast" role="status" aria-live="polite"></div><script type="module" src="/client.js"><\/script></body></html>
`, "type": "text/html; charset=utf-8" }, "/index.html": { "body": `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Global \u2014 Play with friends</title><meta name="description" content="Create a room, invite friends with a code, and find the impostor."><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23b9f569'/%3E%3Cpath d='M9 10h14v12H9z' fill='%23101620'/%3E%3Cpath d='M12 13h8v4h-8z' fill='%23b9f569'/%3E%3C/svg%3E"><style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
:root{color-scheme:dark;--bg:#0c1016;--panel:#131922;--line:#29313c;--lime:#b9f569;--muted:#929caa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#eef1ed;font:16px 'Space Grotesk',sans-serif}button{font:inherit;cursor:pointer;color:inherit}button:focus-visible{outline:3px solid #fff;outline-offset:4px}button:disabled{opacity:.45;cursor:default}header{height:88px;max-width:1440px;margin:auto;padding:0 42px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-size:25px;font-weight:700;letter-spacing:-1px}.brand span{color:var(--lime)}.mono{font:12px 'Space Mono',monospace;letter-spacing:1.5px}.tag{padding:8px 12px;border:1px solid var(--line);border-radius:5px;color:#b8c0cb}main{max-width:1440px;margin:auto;padding:32px 42px}.top{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{font-size:32px;letter-spacing:-1.3px;margin:7px 0}.eyebrow{color:var(--lime)}.sub{color:var(--muted);margin:0}.controls{display:flex;gap:10px}.quiet{background:#1b232e;border:1px solid #35404e;padding:10px 16px;border-radius:7px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:24px}.game{position:relative;background:#080d16;border:1px solid #35404e;border-radius:12px;overflow:hidden}.hud{display:flex;align-items:center;gap:16px;background:#131a24;padding:17px 22px;border-bottom:1px solid var(--line)}.meter{height:7px;background:#303947;flex:1;border-radius:20px;overflow:hidden}.meter div{height:100%;background:var(--lime);width:0;transition:width .4s}.hud .mono{color:#c2c9d1;white-space:nowrap}.canvas-wrap{position:relative;aspect-ratio:900/600}canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-items:center;background:#080d1690;backdrop-filter:blur(4px);padding:20px}.overlay.hidden{display:none}.modal{max-width:410px;text-align:center;background:#141d29;border:1px solid #465269;padding:32px;border-radius:16px;box-shadow:0 24px 80px #0008}.modal h2{font-size:36px;letter-spacing:-1px;margin:12px 0}.modal p{color:#b4becc;line-height:1.6}.primary{border:0;background:var(--lime);color:#152017;font-weight:700;padding:14px 28px;border-radius:7px;box-shadow:0 3px 0 #6c9f32}.primary:hover{background:#cbff88}.modal .primary{width:100%;margin-top:10px}.status{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#111a27e8;padding:10px 17px;border:1px solid #40516a;border-radius:8px;text-align:center;font-size:14px;white-space:nowrap;pointer-events:none}.foot{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}kbd{font:12px 'Space Mono',monospace;background:#252f3c;border:1px solid #445060;border-bottom-width:3px;border-radius:4px;padding:3px 6px;color:#e8edf4}.card{border:1px solid var(--line);border-radius:10px;padding:22px;background:var(--panel);margin-bottom:16px}.card h2{font-size:16px;margin:0 0 20px}.role{display:flex;gap:14px;align-items:center}.role-icon{font-size:32px;color:var(--lime)}.role strong{display:block;font-size:19px}.role small{color:var(--muted);display:block;margin-top:5px;font-size:14px}.tasks{list-style:none;padding:0;margin:0}.tasks li{display:flex;gap:12px;align-items:center;margin:22px 0}.tasks li:last-child{margin-bottom:0}.check{width:22px;height:22px;border:1px solid #505c6c;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.tasks strong{font-size:14px;font-weight:500;display:block}.tasks small{font-size:12px;color:var(--muted);display:block;margin-top:4px}.tasks .done .check{background:var(--lime);color:#142013;border-color:var(--lime)}.tasks .done strong{text-decoration:line-through;color:var(--muted)}.hint{font-size:14px;line-height:1.65;color:#aeb9c7}.hint b{color:#e8edf4;font-weight:500}.legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:20px}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}.bottom{display:flex;justify-content:space-between;margin-top:24px;color:#6e7b8c;font-size:12px}.touch{display:none;padding:16px;justify-content:space-between;align-items:center}.dpad{display:grid;grid-template-columns:repeat(3,43px);gap:4px}.dpad button{height:43px;border:1px solid #425064;background:#202d40;border-radius:8px;touch-action:none}.action{padding:18px 20px;touch-action:none}.sequence{display:flex;gap:9px;justify-content:center;margin:20px 0}.sequence button{width:60px;height:60px;border:1px solid #566b83;background:#253348;border-radius:9px;font-size:22px;font-weight:700}.sequence button.hit{background:var(--lime);color:#182514}.danger{color:#ff8787!important}@media(max-width:1050px){header{padding:0 24px}main{padding:26px 24px}.layout{grid-template-columns:minmax(0,1fr) 235px}.card{padding:18px}.foot{gap:15px;flex-wrap:wrap}}@media(max-width:760px){header{height:68px;padding:0 18px}.tag{font-size:10px}main{padding:22px 14px}.layout{grid-template-columns:1fr}.top{align-items:center}h1{font-size:26px}.sub{font-size:14px}.controls{gap:5px}.quiet{padding:9px 11px;font-size:14px}.hud{padding:14px 12px;gap:9px}.hud .mono{font-size:10px}.touch{display:flex}.foot{display:none}aside{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{margin:0}.role-card{display:none}.hint-card{grid-column:2;grid-row:1}.tasks li{margin:16px 0}.card h2{margin-bottom:12px}.bottom{line-height:1.6;gap:20px}.modal{padding:22px}.modal h2{font-size:28px}.modal p{font-size:14px}.status{font-size:11px;bottom:8px;max-width:96%;white-space:normal;width:max-content}.legend{gap:10px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}

input{width:100%;background:#0b1320;border:1px solid #536175;border-radius:7px;padding:12px;color:#fff;font:inherit;margin:7px 0 14px}label{display:block;text-align:left;font-size:14px;color:#bac6d5}.room-code{font:700 32px 'Space Mono',monospace;letter-spacing:5px;color:var(--lime);margin:15px 0}.roster{list-style:none;text-align:left;padding:0;margin:15px 0}.roster li{display:flex;align-items:center;gap:10px;margin:10px 0}.roster small{margin-left:auto;color:#aebac9}.modal{max-height:96%;overflow:auto;width:440px;max-width:100%}.modal h2{font-size:28px}.modal p{margin:12px 0}.modal .quiet{margin-top:8px}.action-bar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--line)}.action-bar .quiet{font-size:14px}.kill{border-color:#a25060;color:#ff9ea8}#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:20;max-width:90%;padding:12px 20px;border-radius:8px;background:#323b4d;color:white;display:none;box-shadow:0 5px 30px #0008}.meeting-modal{width:510px}.chat-log{height:120px;overflow:auto;background:#0b121d;text-align:left;padding:10px;border-radius:6px;font-size:14px}.chat-log p{margin:4px 0;line-height:1.4;overflow-wrap:anywhere}.chat-form{display:flex;gap:6px}.chat-form input{margin:8px 0}.chat-form button{margin:8px 0!important}.votes{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px}.votes button{font-size:14px}.entry-hint{font-size:13px!important}.role-card strong{font-size:18px}#connection{color:#8796a9;font-size:12px;margin-left:auto}.overlay{z-index:2}.game{min-width:0}@media(max-width:760px){.overlay{position:fixed;z-index:10;inset:0;padding:16px}.modal{max-height:90vh}.controls a{display:none}.role-card{display:block;grid-column:1/-1}.hint-card{grid-column:2;grid-row:2}.top h1{font-size:24px}.canvas-wrap{min-height:240px}.hud{flex-wrap:wrap}.meter{min-width:30px}.touch{padding-top:8px}}
.overlay{grid-template-columns:minmax(0,1fr)}.modal{min-width:0;justify-self:center}.top>div:first-child{min-width:0}.top{gap:12px}.controls{flex-shrink:0}@media(max-width:760px){.top{align-items:flex-start}.top h1{font-size:22px}.top .sub{line-height:1.5}}
.objective{padding:12px 18px;background:#192433;display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #344355}.objective strong{font-size:15px;display:block}.objective span{display:block;font-size:13px;color:#acb9cc;margin-top:5px}.objective b{font-size:14px;align-self:center;white-space:nowrap}.action-bar #interact{background:#253445;font-weight:700;min-width:230px;border-color:#527085}.action-bar #interact.ready,.touch .action.ready{background:var(--lime);color:#142015;border-color:var(--lime)}.action-bar #interact.kill.ready{background:#ef828c;border-color:#ef828c}.status{white-space:normal;width:max-content;max-width:90%;font-size:14px}.status.action-ready{border-color:var(--lime);color:var(--lime);background:#142019f5}.sequence .next-switch{background:var(--lime);color:#142015;outline:3px solid #b9f56955;outline-offset:4px}.sequence button:disabled{opacity:.45}.sequence button.hit{opacity:1}.touch .action{max-width:53%;font-size:14px;min-height:54px}.canvas-wrap canvas{touch-action:none}@media(max-width:760px){.objective{padding:12px;flex-wrap:wrap;gap:6px}.objective strong{font-size:14px}.objective span{font-size:12px}.action-bar #interact{display:none}.action-bar{padding:9px 12px}.action-bar #report,.action-bar #meeting{padding:9px;font-size:12px}.status{font-size:12px;bottom:5px;max-width:92%;padding:7px 10px}.canvas-wrap{aspect-ratio:900/660}.touch{border-top:1px solid var(--line)}.dpad{grid-template-columns:repeat(3,46px)}.dpad button{height:46px}.top{margin-bottom:15px}header{height:58px}main{padding-top:16px}}
@media(min-width:761px){.canvas-wrap{height:clamp(280px,calc(100dvh - 480px),610px);aspect-ratio:auto}.canvas-wrap canvas{object-fit:contain}.status{bottom:10px}}#toast{top:16px;bottom:auto}.controls a{color:inherit}
</style></head><body><header><div class="brand">global<span style="font-size:14px;margin-left:5px">\u2726</span><span style="font-size:14px;color:#697588;margin-left:13px">/</span></div><div class="tag mono">MULTIPLAYER \xB7 2\u20139 PLAYERS</div></header><main><div class="top"><div><div class="eyebrow mono">THE LAST SHIFT</div><h1>Something\u2019s off on board.</h1><p class="sub">One ship. One impostor. Bring your crew.</p></div><div class="controls"><a class="quiet" href="/solo.html" style="text-decoration:none">Solo game</a><button class="quiet" id="leave">Leave room</button></div></div><div class="layout"><section class="game" aria-label="Space survival game"><div class="hud"><span class="mono">SHIP SYSTEMS</span><div class="meter"><div id="progress"></div></div><span class="mono" id="count">0 / 4</span><span class="mono" id="timer">04:00</span></div><div class="objective"><div><strong id="objectiveTitle">Create a room or join your friends</strong><span id="objectiveDetail">2\u20139 players \xB7 One secret impostor</span></div><b id="identity"></b></div><div class="canvas-wrap"><canvas id="canvas" width="900" height="600" aria-label="Ship map. Use WASD or arrow keys to move and E to interact."></canvas><div class="status" id="status">Ready for your shift?</div><div class="overlay" id="overlay"><div class="modal" id="modal"></div></div></div><div class="action-bar"><button class="quiet" id="interact">Repair [E]</button><button class="quiet" id="report">Report [R]</button><button class="quiet" id="meeting">Emergency meeting</button><button class="quiet kill" id="kill" hidden>Eliminate</button><span id="connection">Not connected</span></div><div class="foot"><span><kbd>W A S D</kbd> or <kbd>\u2191 \u2190 \u2193 \u2192</kbd> Move</span><span><kbd>E</kbd> Nearby action &nbsp; <kbd>R</kbd> Report</span></div><div class="touch"><div class="dpad"><span></span><button data-key="ArrowUp" aria-label="Move up">\u2191</button><span></span><button data-key="ArrowLeft" aria-label="Move left">\u2190</button><button data-key="ArrowDown" aria-label="Move down">\u2193</button><button data-key="ArrowRight" aria-label="Move right">\u2192</button></div><button class="primary action" id="use">Interact</button></div></section><aside><div class="card role-card"><div class="role"><div class="role-icon">\u2726</div><div><strong>Crewmate</strong><small>That\u2019s you. Stay sharp.</small></div></div></div><div class="card"><h2>Ship repairs <span style="color:#8e9bab;float:right;font-weight:400" id="taskNum">0/4</span></h2><ul class="tasks" id="tasks"></ul></div><div class="card hint-card"><h2>A friendly heads-up</h2><p class="hint">One player is secretly the <b>impostor</b>. Everyone has a different color\u2014color does not reveal their role.</p><p class="hint">Crew: finish all four repairs or vote out the impostor. Report a body or call a meeting in <b>Commons</b>.</p><p class="hint">Discuss in meeting chat. Dead players can watch, but cannot vote.</p></div></aside></div><div class="bottom mono"><span>VESSEL 09 / DEEP SPACE</span><span>2\u20139 PLAYERS \xB7 PRIVATE ROOM CODES</span></div></main><div id="toast" role="status" aria-live="polite"></div><script type="module" src="/client.js"><\/script></body></html>
`, "type": "text/html; charset=utf-8" }, "/client.js": { "body": `import {MovementPrediction} from './prediction.js';
import {rooms,floors,stations,colors,distance,visible} from './map.js';
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');
let state=null,session=null,keys={},queue=[],inFlight=false,seq=0,screen='',switches=0,repairId=null,last=0,elapsed=0,toastTimer,failures=0,leaving=false;
const prediction=new MovementPrediction();let syncTimer=null,receivedAt=0,contextAction=null,uiAt=0,lastChat='',lastVotes='',joinBusy=false;
const positions=new Map(),stars=Array.from({length:85},(_,i)=>({x:(i*137.3)%900,y:(i*79.7)%600,r:i%3===0?1.5:.7}));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4500)}
function modal(html){$('overlay').classList.remove('hidden');$('modal').innerHTML=html;keys={}}
function home(){screen='home';modal(\`<div class="mono eyebrow">BRING YOUR CREW</div><h2>Who can you trust?</h2><p>Create a room for 2\u20139 players, then share the code with your friends.</p><label for="name">Your name</label><input id="name" maxlength="16" placeholder="Space explorer" autocomplete="nickname"><button class="primary" id="create">Create a room</button><p class="entry-hint">Already have a code?</p><form id="joinForm"><label for="code">Room code</label><input id="code" maxlength="6" placeholder="ABC123" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:3px"><button class="quiet" type="submit">Join room</button></form><p class="entry-hint">Keep this tab open during the game.</p>\`);$('create').onclick=()=>enter('create');$('joinForm').onsubmit=e=>{e.preventDefault();enter('join')};$('leave').disabled=true;$('name').focus()}
async function request(path,body){const res=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});let data;try{data=await res.json()}catch{throw new Error('The game server is not available. Open the hosted game link.')}if(!res.ok){const e=new Error(data.error||'Unable to connect.');e.status=res.status;throw e}return data}
async function enter(type){const name=$('name').value.trim(),code=$('code').value.trim().toUpperCase();if(!name){toast('Enter your name first.');$('name').focus();return}if(type==='join'&&code.length!==6){toast('Enter a six-character room code.');return}if(joinBusy)return;joinBusy=true;$('create').disabled=true;$('create').textContent=type==='create'?'Creating room\u2026':'Joining room\u2026';document.querySelector('#joinForm button').disabled=true;try{const data=await request(type,{name,code});session={code:data.state.code,token:data.token};try{sessionStorage.setItem('crew-session',JSON.stringify(session))}catch{}seq=data.state.seq;screen='';failures=0;acceptState(data.state);pump()}catch(e){toast(e.message)}finally{joinBusy=false;if($('create')){$('create').disabled=false;$('create').textContent='Create a room';document.querySelector('#joinForm button').disabled=false}}}
function acceptState(next){
 const previous=state;state=next;receivedAt=performance.now();
 const me=state.players.find(p=>p.id===state.you);
 if(me)prediction.reconcile(me,state.motionAck||0,state.motionEpoch||0,state.phase==='playing'&&state.alive&&!state.repair);
 if(previous?.phase==='lobby'&&state.phase==='playing')toast(state.role==='impostor'?'You are the IMPOSTOR. Blend in and eliminate the crew.':'You are a CREWMATE. Repair the four glowing terminals.');
 if(previous&&state.tasks.length>previous.tasks.length)toast('System repaired! '+state.tasks.length+' of 4 complete.');
 if(previous?.alive&&!state.alive)toast('You are out this round. You can watch the remaining players.');
 render();
}
function action(type,extra={}){
 if(!session||queue.length)return;
 queue.push({type,seq:++seq,...extra});
 if(['repair','report','meeting','complete','cancel','vote'].includes(type))keys={};
 refreshActions();updatePending();pump();
}
function updatePending(){
 const busy=queue.length>0;
 for(const id of ['start','again','cancel','finishRepair'])if($(id))$(id).disabled=busy||(id==='start'&&state?.players.length<2);
 if($('start'))$('start').textContent=queue[0]?.type==='start'?'Starting mission\u2026':'Start mission';
 document.querySelectorAll('[data-switch]').forEach(b=>b.disabled=busy||Number(b.dataset.switch)!==switches+1);
 if($('repairHint')&&queue[0]?.type==='complete')$('repairHint').textContent='Saving repair\u2026';
 if($('finishRepair')){$('finishRepair').hidden=busy||switches!==4;$('finishRepair').textContent='Retry saving repair'}
 document.querySelectorAll('[data-vote]').forEach(b=>b.disabled=busy||!state.alive||state.voted||state.meeting.discussion>0);
}
async function pump(){
 clearTimeout(syncTimer);if(!session||inFlight||leaving)return;
 inFlight=true;const started=performance.now(),currentSession=session;
 const queued=queue[0];const outgoing={...(queued||{type:'input'}),inputs:prediction.batch(),epoch:state?.motionEpoch||0};
 try{
  const result=await request('sync',{...session,action:outgoing});if(session!==currentSession)return;
  if(queue[0]===queued&&queued)queue.shift();seq=Math.max(seq,result.state.seq);failures=0;
  $('connection').textContent='Connected';acceptState(result.state);
 }catch(e){
  if(session!==currentSession)return;
  if(e.status&&e.status!==409&&e.status!==503){if(queue[0]===queued&&queued)queue.shift();toast(e.message);if(e.status===401||e.status===404){clearSession();return}updatePending()}
  else {failures++;$('connection').textContent='Reconnecting\u2026';keys={};if(failures===2)toast('Connection interrupted. Reconnecting to your room\u2026')}
 }finally{
  inFlight=false;
  if(session){const rate=failures?1000:queue.length?0:state?.phase==='playing'?(prediction.pending.length?120:300):600;syncTimer=setTimeout(pump,Math.max(0,rate-(performance.now()-started)))}
 }
}
function clearSession(){session=null;state=null;queue=[];keys={};positions.clear();prediction.reset();clearTimeout(syncTimer);try{sessionStorage.removeItem('crew-session')}catch{}$('connection').textContent='Not connected';home()}
function render(){if(!state)return;$('leave').disabled=false;const me=state.players.find(p=>p.id===state.you),isHost=state.host===state.you;let next=state.phase+(state.repair?':repair:'+state.repair.station:'');if(next!==screen){screen=next;keys={};lastChat='';lastVotes='';if(state.phase==='lobby'){modal(\`<div class="mono eyebrow">PRIVATE ROOM</div><h2>Assemble your crew.</h2><div class="room-code" id="roomCode"></div><button class="quiet" id="copy">Copy room code</button><ul class="roster" id="roster"></ul><p id="lobbyNote"></p><button class="primary" id="start">Start mission</button><p class="entry-hint">Everyone opens this game link and enters the code. Room expires after 2 hours.</p>\`);$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.code);toast('Room code copied.')}catch{toast('Room code: '+state.code)}};$('start').onclick=()=>action('start')}
 else if(state.phase==='meeting'){modal(\`<div class="mono eyebrow">CREW MEETING</div><h2 id="meetingTitle"></h2><p id="meetingInfo"></p><div class="chat-log" id="chatLog" aria-live="polite"></div><form class="chat-form" id="chatForm"><input id="message" maxlength="160" placeholder="What did you see?" aria-label="Meeting message"><button class="quiet">Send</button></form><div class="votes" id="votes"></div><p class="entry-hint" id="voteInfo"></p>\`);$('chatForm').onsubmit=e=>{e.preventDefault();const text=$('message').value.trim();if(text){action('chat',{text});$('message').value=''}}}
 else if(state.phase==='ended'){modal(\`<div class="mono eyebrow">MISSION COMPLETE</div><h2>\${state.winner==='crew'?'Crewmates win!':'Impostor wins!'}</h2><p>\${escape(state.message)}</p><ul class="roster" id="results"></ul><button class="primary" id="again">Back to lobby</button><p class="entry-hint" id="endNote"></p>\`);$('again').onclick=()=>action('rematch')}
 else if(state.repair){switches=0;repairId=state.repair.station;modal(\`<div class="mono eyebrow">\${stations[repairId].room.toUpperCase()} / TERMINAL</div><h2>\${stations[repairId].title}</h2><p>Tap the highlighted switch, from 1 to 4.<br>The repair saves automatically.</p><div class="sequence">\${[3,1,4,2].map(n=>\`<button data-switch="\${n}" \${n===1?'class="next-switch"':'disabled'} aria-label="Switch \${n}">\${n}</button>\`).join('')}</div><p id="repairHint">Waiting for switch 1</p><button class="primary" id="finishRepair" hidden>Finish repair</button><button class="quiet" id="cancel">Back to ship</button>\`);document.querySelectorAll('[data-switch]').forEach(b=>b.onclick=()=>{if(Number(b.dataset.switch)!==switches+1){toast('Tap switch '+(switches+1)+' next.');return}switches++;b.classList.add('hit');b.disabled=true;$('repairHint').textContent=switches===4?'All switches connected.':'Waiting for switch '+(switches+1);document.querySelectorAll('[data-switch]').forEach(s=>{s.disabled=Number(s.dataset.switch)!==switches+1;s.classList.toggle('next-switch',Number(s.dataset.switch)===switches+1)});if(switches===4)action('complete',{order:[1,2,3,4]})});$('finishRepair').onclick=()=>action('complete',{order:[1,2,3,4]});$('cancel').onclick=()=>action('cancel')}
 else $('overlay').classList.add('hidden');}
 if(state.phase==='lobby'){$('roomCode').textContent=state.code;$('roster').innerHTML=state.players.map(p=>\`<li><i class="dot" style="background:\${colors[p.color]}"></i>\${escape(p.name)}\${p.id===state.you?' (you)':''}<small>\${p.id===state.host?'Host':p.connected?'Ready':'Reconnecting'}</small></li>\`).join('');$('start').hidden=!isHost;$('start').disabled=state.players.length<2;$('lobbyNote').textContent=isHost?\`\${state.players.length}/9 players \xB7 \${state.players.length<2?'Need at least 2 to start.':'Ready when you are.'}\`:\`\${state.players.length}/9 players \xB7 Waiting for the host.\`}
 if(state.phase==='ended'){$('results').innerHTML=state.players.map(p=>\`<li><i class="dot" style="background:\${colors[p.color]}"></i>\${escape(p.name)}<small>\${p.role==='impostor'?'Impostor':'Crewmate'}</small></li>\`).join('');$('again').hidden=!isHost;$('endNote').textContent=isHost?'Same room. A new impostor each round.':'Waiting for the host to open the lobby.'}
 if(state.phase==='meeting'){$('meetingTitle').textContent=state.meeting.reason;$('meetingInfo').textContent=\`Called by \${state.meeting.caller} \xB7 \${Math.ceil(state.meeting.remaining)}s left\`;const chatKey=JSON.stringify(state.chat);if(chatKey!==lastChat){lastChat=chatKey;$('chatLog').innerHTML=state.chat.map(m=>\`<p><b style="color:\${colors[m.color]}">\${escape(m.name)}:</b> \${escape(m.text)}</p>\`).join('');$('chatLog').scrollTop=$('chatLog').scrollHeight}$('chatForm').hidden=!state.alive;const voteKey=state.players.filter(p=>p.alive).map(p=>p.id).join(',');if(voteKey!==lastVotes){lastVotes=voteKey;$('votes').innerHTML=state.players.filter(p=>p.alive).map(p=>\`<button class="quiet" data-vote="\${p.id}">\${escape(p.name)}</button>\`).join('')+'<button class="quiet" data-vote="skip">Skip</button>';document.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>action('vote',{target:b.dataset.vote}))}document.querySelectorAll('[data-vote]').forEach(b=>b.disabled=!state.alive||state.voted||state.meeting.discussion>0||queue.length>0);$('voteInfo').textContent=!state.alive?'Spectating. You cannot chat or vote.':state.meeting.discussion>0?\`Discuss first. Voting opens in \${Math.ceil(state.meeting.discussion)}s.\`:state.voted?'Vote submitted. Waiting for the crew.':\`\${state.votesCast} votes cast. Ties eject no one.\`}
 $('tasks').innerHTML=stations.map((s,i)=>\`<li class="\${state.tasks.includes(i)?'done':''}"><span class="check">\${state.tasks.includes(i)?'\u2713':''}</span><div><strong>\${s.title}</strong><small>\${s.room}</small></div></li>\`).join('');$('progress').style.width=state.tasks.length*25+'%';$('count').textContent=state.tasks.length+' / 4';$('taskNum').textContent=state.tasks.length+'/4';$('timer').textContent=String(Math.floor(state.remaining/60)).padStart(2,'0')+':'+String(Math.floor(state.remaining%60)).padStart(2,'0');document.querySelector('.role strong').textContent=state.phase==='lobby'?'Awaiting your role':!state.alive?'Spectator':state.role==='impostor'?'You\u2019re the impostor':'You\u2019re a crewmate';document.querySelector('.role small').textContent='Room '+state.code;document.querySelector('.role-icon').style.color=state.role==='impostor'?'#ff8a91':colors[me?.color||0];
 refreshActions();updatePending();
}
function myPosition(){const me=state?.players.find(p=>p.id===state.you);return me&&{...me,...prediction.position}}
function refreshActions(){
 if(!state)return;const me=myPosition();if(!me)return;
 const active=state.phase==='playing'&&state.alive&&!state.repair;
 const cooldown=Math.max(0,state.cooldown-(performance.now()-receivedAt)/1000);
 const near=stations.findIndex((s,i)=>!state.tasks.includes(i)&&distance(me,s)<68&&visible(me,s));
 const body=state.bodies.find(b=>distance(me,b)<70&&visible(me,b));
 const target=state.players.find(p=>p.alive&&p.id!==state.you&&distance(me,p)<48&&visible(me,p));
 const atTable=distance(me,{x:450,y:270})<70&&!state.called;
 contextAction=null;let label='Find a glowing terminal',hint='Move with WASD, arrow keys, or the touch pad.';
 if(!state.alive){label='Spectating';hint='You are out this round. Watch the remaining crew.'}
 else if(state.role==='impostor'){label=cooldown>0?\`Eliminate ready in \${Math.ceil(cooldown)}s\`:'Get closer to a crewmate';hint='Your role: IMPOSTOR. Blend in, then eliminate a nearby player.';if(target&&cooldown<=0){contextAction={type:'kill',target:target.id};label='Eliminate '+target.name;hint='E or the action button eliminates this player.'}}
 else if(near>=0){contextAction={type:'repair',station:near};label=stations[near].title;hint='Press E or tap \u201C'+stations[near].title+'\u201D to repair this system.'}
 else {const nearest=stations.map((s,i)=>({...s,i})).filter(s=>!state.tasks.includes(s.i)).sort((a,b)=>distance(me,a)-distance(me,b))[0];if(nearest){label='Go to '+nearest.room;hint='Follow the corridors to a yellow TASK terminal. Press E when close.'}}
 if(atTable&&!contextAction){contextAction={type:'meeting'};label='Call emergency meeting';hint='E opens a meeting so the crew can discuss and vote.'}
 if(body){contextAction={type:'report'};label='Report downed crewmate';hint='Press E or R to report and start a crew meeting.'}
 const busy=queue.length>0;const pendingLabels={repair:'Opening terminal\u2026',complete:'Saving repair\u2026',kill:'Eliminating\u2026',report:'Reporting\u2026',meeting:'Calling meeting\u2026',vote:'Submitting vote\u2026',cancel:'Closing terminal\u2026'};
 if(busy){label=pendingLabels[queue[0].type]||'Please wait\u2026';hint='Your action is being confirmed.'}
 for(const id of ['interact','use']){const b=$(id);b.disabled=!active||!contextAction||busy;b.textContent=(id==='interact'&&contextAction&&!busy?'[E] ':'')+label;b.classList.toggle('ready',!!contextAction&&active&&!busy);b.classList.toggle('kill',contextAction?.type==='kill')}
 $('report').disabled=!(active&&body&&!busy);$('meeting').disabled=!(active&&atTable&&!busy);$('kill').hidden=true;
 $('status').textContent=hint;$('status').classList.toggle('action-ready',active&&!!contextAction&&!busy);
 $('objectiveTitle').textContent=state.phase==='lobby'?'Waiting for your crew':!state.alive?'Spectating':state.role==='impostor'?'IMPOSTOR \xB7 Keep your role secret':'CREWMATE \xB7 Repair the ship';
 $('objectiveDetail').textContent=state.role==='impostor'?'Eliminate the crew. Avoid being voted out.':\`\${state.tasks.length}/4 systems repaired \xB7 Finish tasks or vote out the impostor.\`;
 $('identity').textContent=me.name+' \xB7 YOU';$('identity').style.color=colors[me.color];
 if(state.phase==='playing'){$('status').setAttribute('aria-label',hint)}
}
function interact(){refreshActions();if(contextAction&&state?.phase==='playing'&&state.alive&&!state.repair&&!queue.length){const {type,...extra}=contextAction;action(type,extra)}else toast($('status').textContent)}
$('interact').onclick=$('use').onclick=interact;$('report').onclick=()=>action('report');$('meeting').onclick=()=>action('meeting');
$('leave').onclick=()=>{if(session){leaving=true;const body={...session,action:{type:'leave',seq:++seq}};fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});clearSession();leaving=false}};
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(e.target.tagName)||!$('overlay').classList.contains('hidden'))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();keys[e.key.length===1?e.key.toLowerCase():e.key]=true;if(e.repeat)return;if(e.key.toLowerCase()==='e')interact();if(e.key.toLowerCase()==='r'&&!$('report').disabled)action('report')});window.addEventListener('keyup',e=>keys[e.key.length===1?e.key.toLowerCase():e.key]=false);window.addEventListener('blur',()=>keys={});document.addEventListener('visibilitychange',()=>{keys={}});document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys[b.dataset.key]=true;b.setPointerCapture(e.pointerId)};b.onpointerup=b.onpointercancel=()=>keys[b.dataset.key]=false});
function round(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}}
function text(t,x,y,size=12,color='#77899e'){ctx.font=\`500 \${size}px 'Space Mono',monospace\`;ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(t,x,y)}
function character(x,y,color,label,alive=true){ctx.globalAlpha=alive?1:.35;const bob=alive?Math.sin(elapsed*7)*1.2:0;ctx.fillStyle='#0006';ctx.beginPath();ctx.ellipse(x,y+15,19,7,0,0,Math.PI*2);ctx.fill();round(x-15,y-15+bob,30,31,10,color,'#0c1320');round(x-19,y-7+bob,8,18,3,color,'#0c1320');round(x-11,y+10+bob,8,11,3,color,'#0c1320');round(x+3,y+10-bob,8,11,3,color,'#0c1320');round(x-8,y-11+bob,24,13,6,'#b8e6f0','#253e50');round(x-4,y-9+bob,14,4,2,'#efffff');text(label,x,y-25,11,color);ctx.globalAlpha=1}
function draw(t){const dt=Math.min((t-last)/1000,.05)||0;last=t;elapsed+=dt;if(state?.phase==='playing'&&state.alive&&!state.repair&&!queue.length&&!document.hidden){prediction.step((keys.ArrowRight||keys.d?1:0)-(keys.ArrowLeft||keys.a?1:0),(keys.ArrowDown||keys.s?1:0)-(keys.ArrowUp||keys.w?1:0),dt)}if(t-uiAt>70){uiAt=t;refreshActions()}ctx.clearRect(0,0,900,600);ctx.fillStyle='#080e18';ctx.fillRect(0,0,900,600);stars.forEach(s=>{ctx.fillStyle='#526786';ctx.globalAlpha=.45;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill()});ctx.globalAlpha=1;floors.forEach(r=>round(r.x-5,r.y-5,r.w+10,r.h+10,9,'#354255','#09101b'));floors.forEach(r=>round(r.x,r.y,r.w,r.h,5,'#1e2b3b'));ctx.save();ctx.beginPath();floors.forEach(r=>ctx.rect(r.x,r.y,r.w,r.h));ctx.clip();ctx.strokeStyle='#2a3748';ctx.lineWidth=1;for(let x=0;x<900;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,600);ctx.stroke()}for(let y=0;y<600;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke()}ctx.restore();rooms.forEach(r=>{round(r.x+15,r.y+8,r.w-30,3,1,r.name==='REACTOR'?'#947ee7':'#567486');text(r.name,r.x+r.w/2,r.y+r.h-18,13,'#72859c')});text('BOARDING BAY',450,550,11);round(412,245,76,49,18,'#34465b','#53677d');round(434,254,32,26,9,'#ad5660');text('!',450,273,17,'#fff');stations.forEach((s,i)=>{const complete=state?.tasks.includes(i);ctx.shadowColor='#e2d67a';ctx.shadowBlur=complete?0:12;round(s.x-23,s.y-19,46,37,7,complete?'#21473f':'#4d4934',complete?'#69cdb1':'#e2d67a');ctx.shadowBlur=0;text(complete?'\u2713':'\u26A1',s.x,s.y+6,23,complete?'#8ff7d9':'#ffee9b');if(!complete){const near=state?.role==='crew'&&prediction.position&&distance(prediction.position,s)<68;ctx.strokeStyle=near?'#b9f569':'#746c43';ctx.lineWidth=near?3:1;ctx.beginPath();ctx.arc(s.x,s.y,43,0,Math.PI*2);ctx.stroke();text(near?'[E] REPAIR':'TASK',s.x,s.y-51,near?14:11,near?'#b9f569':'#ddcf8a')}});state?.bodies.forEach(b=>{round(b.x-18,b.y-8,36,20,8,colors[b.color]);text('\xD7',b.x,b.y+7,22,'#172030')});state?.players.forEach(p=>{if(!p.alive&&state.phase!=='lobby')return;let pos=positions.get(p.id);if(!pos){pos={x:p.x,y:p.y};positions.set(p.id,pos)}const lerp=Math.min(1,dt*12);if(p.id===state.you&&prediction.position){pos.x=prediction.position.x;pos.y=prediction.position.y;ctx.strokeStyle=colors[p.color];ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(pos.x,pos.y+15,23,10,0,0,Math.PI*2);ctx.stroke()}else{pos.x+=(p.x-pos.x)*lerp;pos.y+=(p.y-pos.y)*lerp}character(pos.x,pos.y,colors[p.color],p.name+(p.id===state.you?' \xB7 YOU':''))});requestAnimationFrame(draw)}
try{const saved=JSON.parse(sessionStorage.getItem('crew-session'));if(saved?.code&&saved?.token)session=saved}catch{}if(session){modal('<h2>Rejoining your crew\u2026</h2><p id="reconnectInfo">Connecting to your room.</p><button class="quiet" id="forget">Join another room</button>');$('forget').onclick=clearSession;pump()}else home();requestAnimationFrame(draw);
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'get_mission_status',description:'Read your room and public mission status without exposing other players\u2019 secret roles.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>state?{room:state.code,phase:state.phase,players:state.players.length,tasksComplete:state.tasks.length}:{phase:'home'}})).catch(()=>{})}catch{}}
`, "type": "text/javascript; charset=utf-8" }, "/prediction.js": { "body": "import {move} from './map.js';\nexport class MovementPrediction {\n  constructor(){this.reset()}\n  reset(){this.position=null;this.pending=[];this.nextId=0;this.lastSent=0;this.epoch=null}\n  reconcile(position,ack,epoch,active){\n    if(this.epoch!==epoch||!active)this.pending=[];\n    else this.pending=this.pending.filter(f=>f.id>ack);\n    this.epoch=epoch;this.nextId=Math.max(this.nextId,ack);this.position={x:position.x,y:position.y};\n    if(active)for(const f of this.pending)this.apply(f);\n  }\n  apply(f){const len=Math.max(1,Math.hypot(f.dx,f.dy));move(this.position,f.dx/len*165*f.dt,f.dy/len*165*f.dt)}\n  step(dx,dy,dt){\n    if(!this.position||(!dx&&!dy)||this.pending.reduce((n,f)=>n+f.dt,0)>1.2)return;\n    const f={id:0,dx,dy,dt:Math.min(dt,.05)};if(f.dt<=0)return;\n    this.apply(f);const tail=this.pending.at(-1);\n    if(tail&&tail.id>this.lastSent&&tail.dx===dx&&tail.dy===dy&&tail.dt+f.dt<=.099)tail.dt+=f.dt;\n    else {f.id=++this.nextId;this.pending.push(f)}\n  }\n  batch(){const frames=this.pending.slice(0,48).map(f=>({...f}));if(frames.length)this.lastSent=frames.at(-1).id;return frames}\n}\n", "type": "text/javascript; charset=utf-8" }, "/map.js": { "body": "export const rooms=[{x:65,y:65,w:245,h:180,name:'ELECTRICAL'},{x:590,y:65,w:245,h:180,name:'OXYGEN'},{x:65,y:365,w:245,h:170,name:'NAVIGATION'},{x:590,y:365,w:245,h:170,name:'REACTOR'},{x:355,y:215,w:190,h:180,name:'COMMONS'}];\nexport const floors=[...rooms,{x:180,y:270,w:540,h:60},{x:165,y:220,w:65,h:180},{x:670,y:220,w:65,h:180},{x:420,y:320,w:60,h:220},{x:370,y:475,w:160,h:85}];\nexport const stations=[{x:120,y:125,title:'Restore power',room:'Electrical'},{x:775,y:125,title:'Refresh oxygen',room:'Oxygen'},{x:120,y:465,title:'Set coordinates',room:'Navigation'},{x:775,y:465,title:'Stabilize reactor',room:'Reactor'}];\nexport const colors=['#b9f569','#8c9ce1','#e8ac68','#6dcbe8','#f38bb7','#e5dd76','#ff956e','#cf9bff','#e3eefb'];\nexport function canWalk(x,y){return [[-11,-11],[11,-11],[-11,11],[11,11]].every(([a,b])=>floors.some(r=>x+a>=r.x&&x+a<=r.x+r.w&&y+b>=r.y&&y+b<=r.y+r.h))}\nexport function move(p,dx,dy){const steps=Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/5)||1;for(let i=0;i<steps;i++){if(canWalk(p.x+dx/steps,p.y))p.x+=dx/steps;if(canWalk(p.x,p.y+dy/steps))p.y+=dy/steps}}\nexport function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}\nexport function visible(a,b){for(let t=0;t<=1;t+=.04)if(!canWalk(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))return false;return true}\n", "type": "text/javascript; charset=utf-8" }, "/solo.html": { "body": `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Global \u2014 A little space mystery</title><meta name="description" content="Repair the ship, dodge the impostor, and escape. A quick solo space game."><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23b9f569'/%3E%3Cpath d='M9 10h14v12H9z' fill='%23101620'/%3E%3Cpath d='M12 13h8v4h-8z' fill='%23b9f569'/%3E%3C/svg%3E"><style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
:root{color-scheme:dark;--bg:#0c1016;--panel:#131922;--line:#29313c;--lime:#b9f569;--muted:#929caa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#eef1ed;font:16px 'Space Grotesk',sans-serif}button{font:inherit;cursor:pointer;color:inherit}button:focus-visible{outline:3px solid #fff;outline-offset:4px}button:disabled{opacity:.45;cursor:default}header{height:88px;max-width:1440px;margin:auto;padding:0 42px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-size:25px;font-weight:700;letter-spacing:-1px}.brand span{color:var(--lime)}.mono{font:12px 'Space Mono',monospace;letter-spacing:1.5px}.tag{padding:8px 12px;border:1px solid var(--line);border-radius:5px;color:#b8c0cb}main{max-width:1440px;margin:auto;padding:32px 42px}.top{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{font-size:32px;letter-spacing:-1.3px;margin:7px 0}.eyebrow{color:var(--lime)}.sub{color:var(--muted);margin:0}.controls{display:flex;gap:10px}.quiet{background:#1b232e;border:1px solid #35404e;padding:10px 16px;border-radius:7px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:24px}.game{position:relative;background:#080d16;border:1px solid #35404e;border-radius:12px;overflow:hidden}.hud{display:flex;align-items:center;gap:16px;background:#131a24;padding:17px 22px;border-bottom:1px solid var(--line)}.meter{height:7px;background:#303947;flex:1;border-radius:20px;overflow:hidden}.meter div{height:100%;background:var(--lime);width:0;transition:width .4s}.hud .mono{color:#c2c9d1;white-space:nowrap}.canvas-wrap{position:relative;aspect-ratio:900/600}canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-items:center;background:#080d1690;backdrop-filter:blur(4px);padding:20px}.overlay.hidden{display:none}.modal{max-width:410px;text-align:center;background:#141d29;border:1px solid #465269;padding:32px;border-radius:16px;box-shadow:0 24px 80px #0008}.modal h2{font-size:36px;letter-spacing:-1px;margin:12px 0}.modal p{color:#b4becc;line-height:1.6}.primary{border:0;background:var(--lime);color:#152017;font-weight:700;padding:14px 28px;border-radius:7px;box-shadow:0 3px 0 #6c9f32}.primary:hover{background:#cbff88}.modal .primary{width:100%;margin-top:10px}.status{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#111a27e8;padding:10px 17px;border:1px solid #40516a;border-radius:8px;text-align:center;font-size:14px;white-space:nowrap;pointer-events:none}.foot{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}kbd{font:12px 'Space Mono',monospace;background:#252f3c;border:1px solid #445060;border-bottom-width:3px;border-radius:4px;padding:3px 6px;color:#e8edf4}.card{border:1px solid var(--line);border-radius:10px;padding:22px;background:var(--panel);margin-bottom:16px}.card h2{font-size:16px;margin:0 0 20px}.role{display:flex;gap:14px;align-items:center}.role-icon{font-size:32px;color:var(--lime)}.role strong{display:block;font-size:19px}.role small{color:var(--muted);display:block;margin-top:5px;font-size:14px}.tasks{list-style:none;padding:0;margin:0}.tasks li{display:flex;gap:12px;align-items:center;margin:22px 0}.tasks li:last-child{margin-bottom:0}.check{width:22px;height:22px;border:1px solid #505c6c;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.tasks strong{font-size:14px;font-weight:500;display:block}.tasks small{font-size:12px;color:var(--muted);display:block;margin-top:4px}.tasks .done .check{background:var(--lime);color:#142013;border-color:var(--lime)}.tasks .done strong{text-decoration:line-through;color:var(--muted)}.hint{font-size:14px;line-height:1.65;color:#aeb9c7}.hint b{color:#e8edf4;font-weight:500}.legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:20px}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}.bottom{display:flex;justify-content:space-between;margin-top:24px;color:#6e7b8c;font-size:12px}.touch{display:none;padding:16px;justify-content:space-between;align-items:center}.dpad{display:grid;grid-template-columns:repeat(3,43px);gap:4px}.dpad button{height:43px;border:1px solid #425064;background:#202d40;border-radius:8px;touch-action:none}.action{padding:18px 20px;touch-action:none}.sequence{display:flex;gap:9px;justify-content:center;margin:20px 0}.sequence button{width:60px;height:60px;border:1px solid #566b83;background:#253348;border-radius:9px;font-size:22px;font-weight:700}.sequence button.hit{background:var(--lime);color:#182514}.danger{color:#ff8787!important}@media(max-width:1050px){header{padding:0 24px}main{padding:26px 24px}.layout{grid-template-columns:minmax(0,1fr) 235px}.card{padding:18px}.foot{gap:15px;flex-wrap:wrap}}@media(max-width:760px){header{height:68px;padding:0 18px}.tag{font-size:10px}main{padding:22px 14px}.layout{grid-template-columns:1fr}.top{align-items:center}h1{font-size:26px}.sub{font-size:14px}.controls{gap:5px}.quiet{padding:9px 11px;font-size:14px}.hud{padding:14px 12px;gap:9px}.hud .mono{font-size:10px}.touch{display:flex}.foot{display:none}aside{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{margin:0}.role-card{display:none}.hint-card{grid-column:2;grid-row:1}.tasks li{margin:16px 0}.card h2{margin-bottom:12px}.bottom{line-height:1.6;gap:20px}.modal{padding:22px}.modal h2{font-size:28px}.modal p{font-size:14px}.status{font-size:11px;bottom:8px;max-width:96%;white-space:normal;width:max-content}.legend{gap:10px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><header><div class="brand">global<span>\u25CF</span><span style="font-size:14px;color:#697588;margin-left:13px">/</span></div><div class="tag mono">SOLO MISSION \xB7 EASY MODE</div></header><main><div class="top"><div><div class="eyebrow mono">THE LAST SHIFT</div><h1>Something\u2019s off on board.</h1><p class="sub">Finish your tasks. Keep your distance. Get out.</p></div><div class="controls"><button class="quiet" id="pause" aria-label="Pause game">Pause</button><button class="quiet" id="restart" aria-label="Restart game">Restart</button></div></div><div class="layout"><section class="game" aria-label="Space survival game"><div class="hud"><span class="mono">SHIP SYSTEMS</span><div class="meter"><div id="progress"></div></div><span class="mono" id="count">0 / 4</span><span class="mono" id="timer">02:30</span></div><div class="canvas-wrap"><canvas id="canvas" width="900" height="600" aria-label="Ship map. Use WASD or arrow keys to move and E to interact."></canvas><div class="status" id="status">Ready for your shift?</div><div class="overlay" id="overlay"><div class="modal" id="modal"></div></div></div><div class="foot"><span><kbd>W A S D</kbd> or <kbd>\u2191 \u2190 \u2193 \u2192</kbd> Move</span><span><kbd>E</kbd> Interact &nbsp; <kbd>Esc</kbd> Pause</span></div><div class="touch"><div class="dpad"><span></span><button data-key="ArrowUp" aria-label="Move up">\u2191</button><span></span><button data-key="ArrowLeft" aria-label="Move left">\u2190</button><button data-key="ArrowDown" aria-label="Move down">\u2193</button><button data-key="ArrowRight" aria-label="Move right">\u2192</button></div><button class="primary action" id="use">Interact</button></div></section><aside><div class="card role-card"><div class="role"><div class="role-icon">\u2726</div><div><strong>Crewmate</strong><small>That\u2019s you. Stay sharp.</small></div></div></div><div class="card"><h2>Your assignment <span style="color:#8e9bab;float:right;font-weight:400" id="taskNum">0/4</span></h2><ul class="tasks" id="tasks"></ul></div><div class="card hint-card"><h2>A friendly heads-up</h2><p class="hint">The <b>red impostor</b> will chase you when you get close. You\u2019re faster, so keep moving.</p><p class="hint">Visit the <b>glowing terminals</b> to repair systems. Then return to the escape pod.</p><div class="legend"><span><i class="dot" style="background:#b9f569"></i>You</span><span><i class="dot" style="background:#ff696c"></i>Impostor</span></div></div></aside></div><div class="bottom mono"><span>VESSEL 09 / DEEP SPACE</span><span>1 PLAYER \xB7 4 TASKS \xB7 ONE WAY HOME</span></div></main><script>'use strict';
const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d'),$=id=>document.getElementById(id);
const rooms=[{x:65,y:65,w:245,h:180,name:'ELECTRICAL'},{x:590,y:65,w:245,h:180,name:'OXYGEN'},{x:65,y:365,w:245,h:170,name:'NAVIGATION'},{x:590,y:365,w:245,h:170,name:'REACTOR'},{x:355,y:215,w:190,h:180,name:'COMMONS'}];
const floors=[...rooms,{x:180,y:270,w:540,h:60},{x:165,y:220,w:65,h:180},{x:670,y:220,w:65,h:180},{x:420,y:320,w:60,h:220},{x:370,y:475,w:160,h:85}];
const stations=[{x:120,y:125,title:'Restore power',room:'Electrical'},{x:775,y:125,title:'Refresh oxygen',room:'Oxygen'},{x:120,y:465,title:'Set coordinates',room:'Navigation'},{x:775,y:465,title:'Stabilize reactor',room:'Reactor'}];
let mode='intro',player,enemy,remaining,done,keys={},last=0,elapsed=0,shield=0,repair=null,step=0,route=0;
const patrol=[{x:700,y:300},{x:700,y:435},{x:700,y:300},{x:450,y:300},{x:200,y:300},{x:200,y:435},{x:200,y:300},{x:700,y:300},{x:700,y:150}];
const stars=Array.from({length:85},(_,i)=>({x:(i*137.3)%900,y:(i*79.7)%600,r:i%3===0?1.5:.7}));
function reset(){player={x:450,y:515};enemy={x:710,y:180};remaining=150;done=[];elapsed=0;shield=5;repair=null;step=0;route=0;keys={};updateUI()}
function show(title,body,label,fn,kicker='GLOBAL'){const modal=$('modal');modal.innerHTML=\`<div class="mono eyebrow">\${kicker}</div><h2>\${title}</h2><p>\${body}</p><button class="primary" id="modalAction">\${label}</button>\`;$('overlay').classList.remove('hidden');$('modalAction').onclick=fn;$('modalAction').focus()}
function start(){reset();mode='playing';$('overlay').classList.add('hidden');$('pause').textContent='Pause'}
function updateUI(){ $('tasks').innerHTML=stations.map((s,i)=>\`<li class="\${done.includes(i)?'done':''}"><span class="check">\${done.includes(i)?'\u2713':''}</span><div><strong>\${s.title}</strong><small>\${s.room}</small></div></li>\`).join('');$('progress').style.width=done.length*25+'%';$('count').textContent=done.length+' / 4';$('taskNum').textContent=done.length+'/4'}
function pause(){if(mode==='playing'){mode='paused';keys={};show('Take a breather.','Your mission is paused. The ship can wait.','Resume mission',()=>{mode='playing';$('overlay').classList.add('hidden');$('pause').textContent='Pause'},'MISSION PAUSED');$('pause').textContent='Resume'}else if(mode==='paused'){$('modalAction').click()}}
function end(won){mode='ended';keys={};show(won?'You made it out.':'Shift cut short.',won?\`All four systems repaired. You escaped with \${Math.ceil(remaining)} seconds to spare.\`:remaining<=0?'The ship ran out of time. Try a quicker route on your next shift.':'The impostor caught up. Keep your distance from red and use the corridors to get away.', 'Play again',start,won?'MISSION COMPLETE':'MISSION FAILED')}
function interact(){if(mode!=='playing')return;if(done.length===4&&Math.hypot(player.x-450,player.y-515)<55){end(true);return}let i=stations.findIndex((s,i)=>!done.includes(i)&&Math.hypot(s.x-player.x,s.y-player.y)<68);if(i<0)return;repair=i;step=0;mode='repair';keys={};$('overlay').classList.remove('hidden');$('modal').innerHTML=\`<div class="mono eyebrow">\${stations[i].room.toUpperCase()} / TERMINAL</div><h2>\${stations[i].title}</h2><p>Tap the switches in order: <b>1, 2, 3, 4</b>.<br>You're safe while repairing.</p><div class="sequence">\${[3,1,4,2].map(n=>\`<button data-switch="\${n}" aria-label="Switch \${n}">\${n}</button>\`).join('')}</div><p id="repairHint" aria-live="polite">Waiting for switch 1</p><button class="quiet" id="cancel">Back to ship</button>\`;document.querySelectorAll('[data-switch]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.switch);if(n!==step+1){$('repairHint').textContent=\`Try switch \${step+1} next.\`;return}step++;b.classList.add('hit');b.disabled=true;$('repairHint').textContent=\`Waiting for switch \${step+1}\`;if(step===4){done.push(repair);updateUI();mode='playing';shield=3;$('overlay').classList.add('hidden');repair=null}});$('cancel').onclick=()=>{repair=null;mode='playing';shield=2;$('overlay').classList.add('hidden')};document.querySelector('[data-switch="1"]').focus()}
function canWalk(x,y){return [[-11,-11],[11,-11],[-11,11],[11,11]].every(([a,b])=>floors.some(r=>x+a>=r.x&&x+a<=r.x+r.w&&y+b>=r.y&&y+b<=r.y+r.h))}
function move(who,dx,dy){if(canWalk(who.x+dx,who.y))who.x+=dx;if(canWalk(who.x,who.y+dy))who.y+=dy}
function visible(a,b){for(let t=0;t<=1;t+=.04)if(!canWalk(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))return false;return true}
function round(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}}
function text(t,x,y,size=12,color='#77899e'){ctx.font=\`500 \${size}px 'Space Mono',monospace\`;ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(t,x,y)}
function character(x,y,color,label){const bob=mode==='playing'?Math.sin(elapsed*7)*1.4:0;ctx.fillStyle='#0006';ctx.beginPath();ctx.ellipse(x,y+15,19,7,0,0,Math.PI*2);ctx.fill();round(x-15,y-15+bob,30,31,10,color,'#0c1320');round(x-19,y-7+bob,8,18,3,color,'#0c1320');round(x-11,y+10+bob,8,11,3,color,'#0c1320');round(x+3,y+10-bob,8,11,3,color,'#0c1320');round(x-8,y-11+bob,24,13,6,'#b8e6f0','#253e50');round(x-4,y-9+bob,14,4,2,'#efffff');if(label)text(label,x,y-25,11,color)}
function draw(){ctx.clearRect(0,0,900,600);ctx.fillStyle='#080e18';ctx.fillRect(0,0,900,600);stars.forEach(s=>{ctx.fillStyle='#526786';ctx.globalAlpha=.45;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill()});ctx.globalAlpha=1;floors.forEach(r=>round(r.x-5,r.y-5,r.w+10,r.h+10,9,'#354255','#09101b'));floors.forEach(r=>round(r.x,r.y,r.w,r.h,5,'#1e2b3b'));ctx.save();ctx.beginPath();floors.forEach(r=>ctx.rect(r.x,r.y,r.w,r.h));ctx.clip();ctx.strokeStyle='#2a3748';ctx.lineWidth=1;for(let x=0;x<900;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,600);ctx.stroke()}for(let y=0;y<600;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke()}ctx.restore();rooms.forEach(r=>{round(r.x+15,r.y+8,r.w-30,3,1,r.name==='REACTOR'?'#947ee7':'#567486');text(r.name,r.x+r.w/2,r.y+r.h-18,13,'#72859c')});text('ESCAPE POD',450,550,11,done.length===4?'#b9f569':'#718196');round(418,484,64,43,9,done.length===4?'#405b2c':'#273947',done.length===4?'#b9f569':'#53687a');text('EXIT',450,511,13,done.length===4?'#d9ffae':'#9baaba');round(412,245,76,49,18,'#34465b','#53677d');round(429,255,42,26,9,'#253446');text('09',450,274,15,'#7f97ad');stations.forEach((s,i)=>{let complete=done.includes(i);ctx.shadowColor=complete?'#72e5c3':'#e2d67a';ctx.shadowBlur=complete?0:15;round(s.x-23,s.y-19,46,37,7,complete?'#21473f':'#4d4934',complete?'#69cdb1':'#e2d67a');ctx.shadowBlur=0;text(complete?'\u2713':'\u26A1',s.x,s.y+6,23,complete?'#8ff7d9':'#ffee9b');if(!complete)text('TASK',s.x,s.y-30,11,'#ddcf8a')});character(265,155,'#8c9ce1','NOVA');character(635,425,'#e8ac68','SOL');character(enemy.x,enemy.y,'#ef646e','IMPOSTOR');if(shield>0&&mode==='playing'){ctx.strokeStyle='#b9f56966';ctx.lineWidth=2;ctx.beginPath();ctx.arc(player.x,player.y,29,0,Math.PI*2);ctx.stroke()}character(player.x,player.y,'#b9f569','YOU');}
function tick(t){const dt=Math.min((t-last)/1000,.04)||0;last=t;if(mode==='playing'){elapsed+=dt;remaining=Math.max(0,remaining-dt);shield=Math.max(0,shield-dt);let dx=(keys.ArrowRight||keys.d?1:0)-(keys.ArrowLeft||keys.a?1:0),dy=(keys.ArrowDown||keys.s?1:0)-(keys.ArrowUp||keys.w?1:0),len=Math.hypot(dx,dy);if(len)move(player,dx/len*165*dt,dy/len*165*dt);let dist=Math.hypot(player.x-enemy.x,player.y-enemy.y),chasing=dist<245&&visible(enemy,player)&&shield===0;let target=chasing?player:patrol[route];let ex=target.x-enemy.x,ey=target.y-enemy.y,el=Math.hypot(ex,ey);if(el>5)move(enemy,ex/el*(chasing?105:68)*dt,ey/el*(chasing?105:68)*dt);else if(!chasing)route=(route+1)%patrol.length;if(dist<25&&shield===0)end(false);if(remaining<=0)end(false);let near=stations.findIndex((s,i)=>!done.includes(i)&&Math.hypot(s.x-player.x,s.y-player.y)<68);$('status').textContent=near>=0?'Press E or Interact to '+stations[near].title.toLowerCase():done.length===4?(Math.hypot(player.x-450,player.y-515)<55?'Press E or Interact to escape!':'All systems online. Return to the escape pod!'):chasing?'Impostor nearby \u2014 keep moving!':shield>0?'Safety shield active. Get moving!':'Find a glowing terminal to start a task.';$('status').classList.toggle('danger',chasing);$('timer').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(Math.floor(remaining%60)).padStart(2,'0')}draw();requestAnimationFrame(tick)}
window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();keys[e.key.length===1?e.key.toLowerCase():e.key]=true;if(e.repeat)return;if(e.key.toLowerCase()==='e')interact();if(e.key==='Escape')pause()});window.addEventListener('keyup',e=>keys[e.key.length===1?e.key.toLowerCase():e.key]=false);window.addEventListener('blur',()=>{keys={};if(mode==='playing')pause()});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='playing')pause()});document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys[b.dataset.key]=true;b.setPointerCapture(e.pointerId)};b.onpointerup=b.onpointercancel=()=>keys[b.dataset.key]=false});$('use').onclick=interact;$('pause').onclick=pause;$('restart').onclick=start;
reset();show('Trust your footsteps.','You\u2019re the green crewmate. Repair 4 systems, avoid the red impostor, and return to the escape pod before time runs out.','Start mission',start,'YOUR ROLE: CREWMATE');requestAnimationFrame(tick);
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'get_mission_status',description:'Read current mission status and completed tasks.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode,secondsRemaining:Math.ceil(remaining),completedTasks:done.map(i=>stations[i].title)})})).catch(()=>{})}catch{}}
<\/script></body></html>
`, "type": "text/html; charset=utf-8" } };
var worker_default = { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) return api(request, env.DB);
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const asset = assets[path];
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : asset.body, { headers: { "Content-Type": asset.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
} };
export {
  worker_default as default
};
