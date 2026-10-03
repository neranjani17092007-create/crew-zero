import {move} from './map.js';
export class MovementPrediction {
  constructor(){this.reset()}
  reset(){this.position=null;this.pending=[];this.nextId=0;this.lastSent=0;this.epoch=null}
  reconcile(position,ack,epoch,active){
    if(this.epoch!==epoch||!active)this.pending=[];
    else this.pending=this.pending.filter(f=>f.id>ack);
    this.epoch=epoch;this.nextId=Math.max(this.nextId,ack);this.position={x:position.x,y:position.y};
    if(active)for(const f of this.pending)this.apply(f);
  }
  apply(f){const len=Math.max(1,Math.hypot(f.dx,f.dy));move(this.position,f.dx/len*165*f.dt,f.dy/len*165*f.dt)}
  step(dx,dy,dt){
    if(!this.position||(!dx&&!dy)||this.pending.reduce((n,f)=>n+f.dt,0)>1.2)return;
    const f={id:0,dx,dy,dt:Math.min(dt,.05)};if(f.dt<=0)return;
    this.apply(f);const tail=this.pending.at(-1);
    if(tail&&tail.id>this.lastSent&&tail.dx===dx&&tail.dy===dy&&tail.dt+f.dt<=.099)tail.dt+=f.dt;
    else {f.id=++this.nextId;this.pending.push(f)}
  }
  batch(){const frames=this.pending.slice(0,48).map(f=>({...f}));if(frames.length)this.lastSent=frames.at(-1).id;return frames}
}
