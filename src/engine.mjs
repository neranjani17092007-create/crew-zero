import {stations,move,distance,visible} from '../public/map.js';
export class GameError extends Error {constructor(message,status=400){super(message);this.status=status}}
const requireThat=(ok,msg,status)=>{if(!ok)throw new GameError(msg,status)};
export const newRoom=(code,now)=>({code,phase:'lobby',players:[],host:null,tasks:[],bodies:[],votes:{},chat:[],meeting:null,winner:null,message:'Waiting for the crew.',created:now,expires:now+7200000});
export function addPlayer(r,name,now,id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID()){
 requireThat(r.phase==='lobby','This mission has already started. Join the next round.');requireThat(r.players.length<9,'This room is full.');requireThat(typeof name==='string'&&name.trim().length>=1&&name.trim().length<=16&&!/[\x00-\x1f<>]/.test(name),'Use a name of 1–16 characters.');
 const taken=new Set(r.players.map(p=>p.color));let color=0;while(taken.has(color))color++;
 const p={id,token,name:name.trim(),color,x:435+(color%3)*15,y:490+Math.floor(color/3)*25,alive:true,role:'crew',seen:now,moved:now,seq:0,called:false,repair:null,cooldown:0};r.players.push(p);r.host??=p.id;return p;
}
function finish(r,winner,message){r.motionEpoch=(r.motionEpoch||0)+1;r.phase='ended';r.winner=winner;r.message=message;r.players.forEach(p=>p.repair=null)}
function checkWin(r){if(r.phase!=='playing'&&r.phase!=='meeting')return;const alive=r.players.filter(p=>p.alive),imp=alive.filter(p=>p.role==='impostor');if(!imp.length)finish(r,'crew','The impostor is out. The crew wins!');else if(r.players.length===2?alive.length-imp.length===0:alive.length-imp.length<=imp.length)finish(r,'impostor','The impostor has taken over the ship.');else if(r.tasks.length===4)finish(r,'crew','All systems repaired. The crew escapes!')}
function resolveVote(r,now){const counts={};Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);const scores=Object.entries(counts).sort((a,b)=>b[1]-a[1]);let ejected=null;if(scores.length&&scores[0][0]!=='skip'&&(!scores[1]||scores[0][1]>scores[1][1]))ejected=r.players.find(p=>p.id===scores[0][0]&&p.alive);if(ejected){ejected.alive=false;r.message=`${ejected.name} was ejected.`}else r.message='No one was ejected.';r.motionEpoch=(r.motionEpoch||0)+1;r.phase='playing';r.deadline+=now-r.meeting.started;r.meeting=null;r.bodies=[];r.players.forEach(p=>{p.repair=null;p.cooldown=now+12000;p.moved=now});checkWin(r)}
export function advance(r,now){
 const gone=r.players.filter(p=>now-p.seen>30000);if(r.phase==='lobby')r.players=r.players.filter(p=>now-p.seen<=30000);else gone.forEach(p=>{p.alive=false;p.repair=null});
 if(!r.players.some(p=>p.id===r.host&&now-p.seen<=30000))r.host=r.players.find(p=>now-p.seen<=30000)?.id??null;
 checkWin(r);if(r.phase==='meeting'&&now>=r.meeting.ends)resolveVote(r,now);if(r.phase==='playing'&&now>=r.deadline)finish(r,'impostor','Time ran out before the repairs were finished.');
}
export function applyInputs(r,p,inputs,epoch,now){
 requireThat(Array.isArray(inputs)&&inputs.length<=48,'Invalid movement batch.');
 for(const f of inputs)requireThat(Number.isSafeInteger(f.id)&&f.id>0&&Number.isFinite(f.dx)&&Number.isFinite(f.dy)&&Math.abs(f.dx)<=1&&Math.abs(f.dy)<=1&&Number.isFinite(f.dt)&&f.dt>0&&f.dt<=0.1,'Invalid movement frame.');
 if(epoch!==(r.motionEpoch||0))return;
 if(!inputs.length)return;
 p.motionSeq??=0;
 // Accumulate server-time credit so network latency does not reduce walking speed.
 let budget=Math.min(1.5,(p.motionBudget??0.12)+Math.max(0,(now-(p.motionAt??now))/1000));
 for(const f of inputs){
  if(f.id<=p.motionSeq)continue;
  const dt=Math.min(f.dt,budget);budget-=dt;p.motionSeq=f.id;
  if(r.phase==='playing'&&p.alive&&!p.repair){const len=Math.max(1,Math.hypot(f.dx,f.dy));move(p,f.dx/len*165*dt,f.dy/len*165*dt)}
 }
 p.motionAt=now;p.motionBudget=budget;
}
export function apply(r,p,a,now,random=Math.random){
 requireThat(a&&typeof a.type==='string','Invalid action.');if(now-p.seen>=3000)p.seen=now;
 if(a.inputs!==undefined){applyInputs(r,p,a.inputs,a.epoch,now);if(a.type==='input')return;}
 if(a.type==='input'){
  requireThat(Number.isFinite(a.dx)&&Number.isFinite(a.dy)&&Math.abs(a.dx)<=1&&Math.abs(a.dy)<=1,'Invalid movement.');
  const dt=Math.max(0,Math.min((now-p.moved)/1000,.3));p.moved=now;
  if(r.phase==='playing'&&p.alive&&!p.repair){let len=Math.hypot(a.dx,a.dy)||1;move(p,a.dx/Math.max(1,len)*165*dt,a.dy/Math.max(1,len)*165*dt)}return;
 }
 requireThat(Number.isSafeInteger(a.seq)&&a.seq>0,'Invalid action sequence.');if(a.seq<=p.seq)return;
 const host=()=>requireThat(r.host===p.id,'Only the host can do this.',403);
 if(a.type==='start'){
  host();requireThat(r.phase==='lobby','The mission has already started.');requireThat(r.players.length>=2,'You need at least 2 players.');r.motionEpoch=(r.motionEpoch||0)+1;r.phase='playing';r.deadline=now+240000;r.tasks=[];r.bodies=[];r.chat=[];r.votes={};r.winner=null;r.message='Repair the ship. One of you is the impostor.';
  const imp=Math.floor(random()*r.players.length);r.players.forEach((q,i)=>Object.assign(q,{alive:true,role:i===imp?'impostor':'crew',x:435+(i%3)*15,y:490+Math.floor(i/3)*25,moved:now,motionAt:now,motionBudget:0.12,called:false,repair:null,cooldown:now+20000}));
 }else if(a.type==='rematch'){
  host();requireThat(r.phase==='ended','Finish this round first.');r.phase='lobby';r.tasks=[];r.bodies=[];r.meeting=null;r.votes={};r.chat=[];r.winner=null;r.message='Ready for another shift?';r.players=r.players.filter(q=>now-q.seen<=30000);r.players.forEach(q=>Object.assign(q,{alive:true,role:'crew',repair:null}));
 }else if(a.type==='leave'){
  if(r.phase==='lobby')r.players=r.players.filter(q=>q.id!==p.id);else {p.alive=false;p.seen=now-31000;}if(r.host===p.id)r.host=r.players.find(q=>q.id!==p.id&&now-q.seen<=30000)?.id??null;checkWin(r);
 }else{
  requireThat(p.alive,'You are spectating this round.');
  if(a.type==='vote'){
   requireThat(r.phase==='meeting','There is no meeting.');requireThat(now>=r.meeting.discussUntil,'Discuss before voting.');requireThat(!r.votes[p.id],'You already voted.');requireThat(a.target==='skip'||r.players.some(q=>q.id===a.target&&q.alive),'Choose a living player or skip.');r.votes[p.id]=a.target;
   if(r.players.filter(q=>q.alive).every(q=>r.votes[q.id]))resolveVote(r,now);
  }else if(a.type==='chat'){
   requireThat(r.phase==='meeting','Chat is available during meetings.');requireThat(typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=160,'Use 1–160 characters.');requireThat(!p.chatted||now-p.chatted>=700,'Please wait a moment.');p.chatted=now;r.chat.push({id:crypto.randomUUID(),name:p.name,color:p.color,text:a.text.trim()});r.chat=r.chat.slice(-40);
  }else{
   requireThat(r.phase==='playing','The mission is not running.');
   if(a.type==='repair'){
    requireThat(p.role==='crew','Impostors cannot repair systems.');requireThat(Number.isInteger(a.station)&&stations[a.station]&&!r.tasks.includes(a.station),'Choose an unfinished task.');requireThat(distance(p,stations[a.station])<68,'Move closer to the terminal.');p.repair={station:a.station,started:now};
   }else if(a.type==='complete'){
    requireThat(p.role==='crew'&&p.repair,'Start a repair first.');if(a.order!==undefined)requireThat(Array.isArray(a.order)&&a.order.length===4&&a.order.every((v,i)=>v===i+1),'Finish the switches in order.');else requireThat(now-p.repair.started>=800,'Finish the switches first.');requireThat(distance(p,stations[p.repair.station])<68,'Move closer to the terminal.');if(!r.tasks.includes(p.repair.station))r.tasks.push(p.repair.station);p.repair=null;checkWin(r);
   }else if(a.type==='cancel')p.repair=null;
   else if(a.type==='kill'){
    requireThat(p.role==='impostor','Only the impostor can eliminate players.',403);requireThat(now>=p.cooldown,'Eliminate is still cooling down.');const q=r.players.find(q=>q.id===a.target&&q.alive&&q.id!==p.id);requireThat(q&&distance(p,q)<48&&visible(p,q),'Move closer to a crewmate.');q.alive=false;q.repair=null;r.bodies.push({id:q.id,x:q.x,y:q.y,color:q.color});p.cooldown=now+20000;checkWin(r);
   }else if(a.type==='report'||a.type==='meeting'){
    if(a.type==='report')requireThat(r.bodies.some(b=>distance(p,b)<70&&visible(p,b)),'Move closer to a downed crewmate.');
    else {requireThat(!p.called,'You already called your emergency meeting.');requireThat(distance(p,{x:450,y:270})<70,'Visit the table in Commons.');p.called=true;}
    r.motionEpoch=(r.motionEpoch||0)+1;r.phase='meeting';r.meeting={started:now,discussUntil:now+12000,ends:now+45000,caller:p.name,reason:a.type==='report'?'A crewmate was found.':'Emergency meeting.'};r.votes={};r.chat=[];r.players.forEach(q=>q.repair=null);
   }else throw new GameError('Unknown action.');
  }
 }
 p.seq=a.seq;
}
export function view(r,p,now){return {motionAck:p.motionSeq||0,motionEpoch:r.motionEpoch||0,code:r.code,phase:r.phase,host:r.host,you:p.id,role:r.phase==='lobby'?null:p.role,alive:p.alive,seq:p.seq,tasks:r.tasks,bodies:r.bodies,winner:r.winner,message:r.message,remaining:r.phase==='meeting'?Math.max(0,(r.deadline-r.meeting.started)/1000):Math.max(0,((r.deadline||now)-now)/1000),cooldown:Math.max(0,(p.cooldown-now)/1000),repair:p.repair,called:p.called,meeting:r.meeting?{...r.meeting,remaining:Math.max(0,(r.meeting.ends-now)/1000),discussion:Math.max(0,(r.meeting.discussUntil-now)/1000)}:null,chat:r.chat,voted:!!r.votes[p.id],votesCast:Object.keys(r.votes).length,players:r.players.map(q=>({id:q.id,name:q.name,color:q.color,x:q.x,y:q.y,alive:q.alive,connected:now-q.seen<10000,...(r.phase==='ended'?{role:q.role}:{})}))}}
