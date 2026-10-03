import {newRoom,addPlayer,advance,apply,view,GameError} from './engine.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function api(request,db){
 try{
  if(request.method!=='POST')return json({error:'Use POST.'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin not allowed.'},403);
  const raw=await request.text();if(raw.length>4096)return json({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
  const path=new URL(request.url).pathname,now=Date.now();
  if(path==='/api/create'){
   const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%alphabet.length]).join('');const r=newRoom(code,now);const p=addPlayer(r,input.name,now);
   await db.prepare('DELETE FROM rooms WHERE expires < ?').bind(now).run();
   const result=await db.prepare('INSERT OR IGNORE INTO rooms (code,state,revision,expires) VALUES (?,?,0,?)').bind(code,JSON.stringify(r),r.expires).run();if(!result.meta.changes)throw new GameError('Please try creating the room again.',409);return json({token:p.token,state:view(r,p,now)});
  }
  if(!/^\/api\/(join|sync)$/.test(path))return json({error:'Not found.'},404);
  if(typeof input.code!=='string'||! /^[A-Z2-9]{6}$/.test(input.code))throw new GameError('Enter a six-character room code.');
  for(let attempt=0;attempt<16;attempt++){
   const row=await db.prepare('SELECT state,revision FROM rooms WHERE code = ? AND expires > ?').bind(input.code,now).first();if(!row)throw new GameError('Room not found or expired.',404);const r=JSON.parse(row.state);let p;
   // A valid heartbeat revives the session before disconnect cleanup, never its eliminated avatar.
   if(path==='/api/sync'){p=r.players.find(q=>q.token===input.token);if(!p)throw new GameError('Your session has ended. Please join again.',401);p.seen=now;}
   advance(r,now);
   if(path==='/api/join')p=addPlayer(r,input.name,now);else apply(r,p,input.action,now);
   const updated=await db.prepare('UPDATE rooms SET state = ?, revision = revision + 1 WHERE code = ? AND revision = ?').bind(JSON.stringify(r),r.code,row.revision).run();
   if(updated.meta.changes)return json({...(path==='/api/join'?{token:p.token}:{}),state:view(r,p,now)});
  }
  throw new GameError('Room is busy. Please retry.',409);
 }catch(e){if(!(e instanceof GameError))console.error('Room operation failed:',e.message);return json({error:e instanceof GameError?e.message:'The game server is temporarily unavailable. Please retry.'},e instanceof GameError?e.status:503)}
}
