export const rooms=[{x:65,y:65,w:245,h:180,name:'ELECTRICAL'},{x:590,y:65,w:245,h:180,name:'OXYGEN'},{x:65,y:365,w:245,h:170,name:'NAVIGATION'},{x:590,y:365,w:245,h:170,name:'REACTOR'},{x:355,y:215,w:190,h:180,name:'COMMONS'}];
export const floors=[...rooms,{x:180,y:270,w:540,h:60},{x:165,y:220,w:65,h:180},{x:670,y:220,w:65,h:180},{x:420,y:320,w:60,h:220},{x:370,y:475,w:160,h:85}];
export const stations=[{x:120,y:125,title:'Restore power',room:'Electrical'},{x:775,y:125,title:'Refresh oxygen',room:'Oxygen'},{x:120,y:465,title:'Set coordinates',room:'Navigation'},{x:775,y:465,title:'Stabilize reactor',room:'Reactor'}];
export const colors=['#b9f569','#8c9ce1','#e8ac68','#6dcbe8','#f38bb7','#e5dd76','#ff956e','#cf9bff','#e3eefb'];
export function canWalk(x,y){return [[-11,-11],[11,-11],[-11,11],[11,11]].every(([a,b])=>floors.some(r=>x+a>=r.x&&x+a<=r.x+r.w&&y+b>=r.y&&y+b<=r.y+r.h))}
export function move(p,dx,dy){const steps=Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/5)||1;for(let i=0;i<steps;i++){if(canWalk(p.x+dx/steps,p.y))p.x+=dx/steps;if(canWalk(p.x,p.y+dy/steps))p.y+=dy/steps}}
export function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
export function visible(a,b){for(let t=0;t<=1;t+=.04)if(!canWalk(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))return false;return true}
