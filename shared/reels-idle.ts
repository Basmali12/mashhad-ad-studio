// Convex queue polling, separate from Buffer's six delayed receipt observations.
export function queueIdleDelay(idleRounds:number,worked:boolean){return worked?10000:Math.min(60000,10000*Math.max(1,idleRounds+1));}
