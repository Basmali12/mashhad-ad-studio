/** Project only observed events. Never convert diffusion steps to playable video seconds. */
export function observedProgress(events=[]){
 const history=new Map();let phase=null;
 for(const e of events){if(!/^[a-z0-9_]{1,80}$/.test(e.phase||'')||!['phase_start','phase_end','phase_error','phase_aborted','progress','app_created','ready'].includes(e.kind))continue;
  phase=e.phase;history.set(phase,{phase,state:['phase_error','phase_aborted'].includes(e.kind)?'failed':['phase_end','ready','app_created'].includes(e.kind)?'completed':'running'});
 }
 const latest=events.filter(e=>e.kind==='progress'&&e.phase===phase).at(-1),valid=Number.isFinite(latest?.completed)&&Number.isFinite(latest?.total)&&latest.completed>=0&&latest.total>0&&latest.completed<=latest.total;
 return {phase,completed:valid?latest.completed:null,total:valid?latest.total:null,stages:[...history.values()].slice(-24)};
}
export function verifiedVideoSeconds(job){
 if(!job?.result?.videoVerified)return null;
 const seconds=Number(job.result.metadata?.duration_seconds??job.result.metadata?.ffprobe?.format?.duration);
 return Number.isFinite(seconds)&&seconds>0&&seconds<=300?seconds:null;
}
