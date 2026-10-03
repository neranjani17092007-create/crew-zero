import {MovementPrediction} from '../public/prediction.js';
import {sqliteAdapter} from '../src/sqlite-adapter.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {newRoom,addPlayer,apply,advance,view,applyInputs} from '../src/engine.mjs';import {api} from '../src/api.mjs';
function fixture(n=4){let now=1000;const r=newRoom('ABC234',now);const players=Array.from({length:n},(_,i)=>addPlayer(r,'Player '+i,now));const doAction=(i,type,extra={},time=now)=>{now=time;apply(r,players[i],{type,seq:players[i].seq+1,...extra},now,()=>0)};return {r,players,doAction}}
test('host, minimum players, full room, roles and secret redaction',()=>{const {r,players:p,doAction:a}=fixture(1);assert.throws(()=>a(0,'start'),/2 players/);for(let i=1;i<9;i++)addPlayer(r,'P'+i,1000);assert.throws(()=>apply(r,r.players[1],{type:'start',seq:1},1000),/host/);assert.throws(()=>addPlayer(r,'Extra',1000),/full/);a(0,'start');assert.equal(r.players.filter(p=>p.role==='impostor').length,1);const v=view(r,r.players[1],1000);assert.equal(v.role,'crew');assert.ok(v.players.every(q=>!('role'in q)&&!('token'in q)));assert.throws(()=>addPlayer(r,'Late',1000),/started/)});
test('movement respects walls, speed and server role checks',()=>{const {r,players:p,doAction:a}=fixture();a(0,'start');p[1].x=180;p[1].y=275;apply(r,p[1],{type:'input',dx:1,dy:0},1200);assert.ok(p[1].x<=213.001);assert.throws(()=>apply(r,p[1],{type:'input',dx:Infinity,dy:0},1300),/movement/);assert.throws(()=>a(1,'kill',{target:p[2].id},22000),/impostor/);assert.throws(()=>a(0,'repair',{station:0}),/cannot repair/);assert.throws(()=>a(1,'complete'),/Start a repair/)});
test('shared tasks and task win',()=>{const {r,players:p,doAction:a}=fixture();a(0,'start');const pts=[[120,125],[775,125],[120,465],[775,465]];pts.forEach(([x,y],station)=>{Object.assign(p[1],{x,y});a(1,'repair',{station},2000+station*2000);assert.throws(()=>a(1,'complete',{},2100+station*2000),/switches/);a(1,'complete',{},3000+station*2000)});assert.equal(r.phase,'ended');assert.equal(r.winner,'crew')});
test('kill cooldown, reporting, discussion, voting and rematch',()=>{const {r,players:p,doAction:a}=fixture();a(0,'start');assert.throws(()=>a(0,'kill',{target:p[1].id}),/cooling/);a(0,'kill',{target:p[1].id},22000);assert.equal(p[1].alive,false);assert.equal(r.bodies.length,1);assert.equal(r.phase,'playing');assert.throws(()=>a(1,'meeting'),/spectating/);a(2,'report',{},23000);assert.equal(r.phase,'meeting');assert.throws(()=>a(2,'vote',{target:p[0].id},23500),/Discuss/);a(2,'chat',{text:'I saw Player 0.'},24000);a(0,'vote',{target:'skip'},36000);a(2,'vote',{target:p[0].id},36000);a(3,'vote',{target:p[0].id},36000);assert.equal(r.winner,'crew');a(0,'rematch',{},37000);assert.equal(r.phase,'lobby');assert.ok(r.players.every(p=>p.alive))});
test('tie skips; timeout and disconnect produce shared outcomes',()=>{let {r,players:p,doAction:a}=fixture();a(0,'start');p[2].x=450;p[2].y=270;a(2,'meeting',{},5000);a(0,'vote',{target:p[1].id},18000);a(1,'vote',{target:p[0].id},18000);a(2,'vote',{target:'skip'},18000);a(3,'vote',{target:'skip'},18000);assert.equal(r.phase,'playing');assert.ok(p.every(q=>q.alive));p.forEach(q=>q.seen=300000);advance(r,300000);assert.equal(r.winner,'impostor');({r,players:p,doAction:a}=fixture());a(0,'start');p.slice(1).forEach(q=>q.seen=32000);advance(r,32000);assert.equal(r.winner,'crew');assert.equal(r.host,p[1].id)});
test('API independent clients, concurrent joins, authentication and idempotency',async()=>{const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_cool_shard.sql',import.meta.url),'utf8'));const db=sqliteAdapter(sql);const call=async(path,body)=>{const res=await api(new Request('https://game.test/api/'+path,{method:'POST',body:JSON.stringify(body)}),db);return {status:res.status,...await res.json()}};const host=await call('create',{name:'Host'});assert.equal(host.status,200);const code=host.state.code;const joins=await Promise.all(['A','B','C','D','E','F','G','H'].map(name=>call('join',{code,name})));assert.ok(joins.every(j=>j.status===200));assert.equal((await call('join',{code,name:'Full'})).status,400);assert.equal((await call('sync',{code,token:'wrong',action:{type:'input',dx:0,dy:0}})).status,401);const start={code,token:host.token,action:{type:'start',seq:1}};const started=await call('sync',start);assert.equal(started.state.players.length,9);assert.equal(started.state.phase,'playing');const duplicate=await call('sync',start);assert.equal(duplicate.status,200);const states=await Promise.all(joins.map(j=>call('sync',{code,token:j.token,action:{type:'input',dx:0,dy:0}})));assert.ok(states.every(s=>s.state.phase==='playing'));assert.equal([started,...states].filter(s=>s.state.role==='impostor').length,1);assert.ok(states.every(s=>s.state.players.every(p=>!p.token&&!p.role)));sql.close()});

test('predicted movement starts instantly, reconciles delayed acknowledgments and stops on release',()=>{
 const m=new MovementPrediction();m.reconcile({x:450,y:515},0,1,true);
 m.step(0,-1,.05);assert.ok(m.position.y<510);const sent=m.batch();
 m.step(0,-1,.05);const before=m.position.y;
 m.reconcile({x:450,y:506.75},sent.at(-1).id,1,true);assert.ok(Math.abs(m.position.y-before)<.001);
 m.step(0,0,.05);assert.equal(m.position.y,before);
 m.reconcile({x:450,y:500},100,2,false);assert.equal(m.pending.length,0);assert.equal(m.position.y,500);
});
test('batched movement tolerates latency, is idempotent, caps speed and respects epochs',()=>{
 const {r,players:p,doAction:a}=fixture();a(0,'start');Object.assign(p[1],{x:450,y:515});
 const frames=Array.from({length:8},(_,i)=>({id:i+1,dx:0,dy:-1,dt:.05}));
 applyInputs(r,p[1],frames,r.motionEpoch,1500);assert.ok(Math.abs(p[1].y-449)<.001);
 const before=p[1].y;applyInputs(r,p[1],frames,r.motionEpoch,1500);assert.equal(p[1].y,before);
 applyInputs(r,p[1],[{id:9,dx:0,dy:-1,dt:.05}],r.motionEpoch-1,1600);assert.equal(p[1].y,before);
 assert.throws(()=>applyInputs(r,p[1],[{id:9,dx:0,dy:-1,dt:20}],r.motionEpoch,1600),/Invalid/);
 // A flood of 4.8s worth of frames at the same timestamp can only consume remaining server-time credit.
 const flood=Array.from({length:48},(_,i)=>({id:20+i,dx:0,dy:-1,dt:.1}));applyInputs(r,p[1],flood,r.motionEpoch,1500);assert.ok(before-p[1].y<=36.301);
});
test('repair order is checked and saves without an extra confirmation delay',()=>{
 const {r,players:p,doAction:a}=fixture();a(0,'start');Object.assign(p[1],{x:120,y:125});a(1,'repair',{station:0},2000);
 assert.throws(()=>a(1,'complete',{order:[1,3,2,4]},2200),/order/);
 a(1,'complete',{order:[1,2,3,4]},2200);assert.deepEqual(r.tasks,[0]);
});
test('idle synchronization avoids unnecessary database writes',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_cool_shard.sql',import.meta.url),'utf8'));const db=sqliteAdapter(sql);
 const call=async(path,body)=>(await api(new Request('https://game.test/api/'+path,{method:'POST',body:JSON.stringify(body)}),db)).json();
 const host=await call('create',{name:'Host'}),code=host.state.code;const before=sql.prepare('SELECT revision FROM rooms WHERE code=?').get(code).revision;
 await call('sync',{code,token:host.token,action:{type:'input',inputs:[],epoch:0}});
 const after=sql.prepare('SELECT revision FROM rooms WHERE code=?').get(code).revision;assert.equal(after,before);sql.close();
});

test('two-player rounds stay playable until a repair win, elimination, vote or timeout',()=>{
 const {r,players:p,doAction:a}=fixture(2);a(0,'start');advance(r,1100);assert.equal(r.phase,'playing');
 assert.equal(r.players[0].role,'impostor');assert.equal(r.players[1].role,'crew');
 Object.assign(p[0],{x:450,y:500});Object.assign(p[1],{x:450,y:515});a(0,'kill',{target:p[1].id},22000);assert.equal(r.winner,'impostor');
});
