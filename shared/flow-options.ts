import type {FlowOption} from './pipeline';
export function flowDurations(labels:string[],header:string){
 const clean=(text:string)=>text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
 const durations=[...new Set(labels.flatMap(text=>[...clean(text).matchAll(/(?:^|\s)(\d+)\s*ث(?:\s|$)/g)].map(m=>Number(m[1]))))];
 if(!durations.length){const fixed=clean(header).match(/(\d+)\s*ث/);if(fixed)durations.push(Number(fixed[1]));}
 return durations.filter(n=>Number.isSafeInteger(n)&&n>=1&&n<=30);
}
export function defaultFlowOption(options:FlowOption[],economy=false){return (economy?options.find(o=>o.model==='Omni Flash'&&o.seconds===10&&o.resolution==='360p'):undefined)?? options.find(o=>o.model==='Omni Flash'&&o.seconds===10)??options[0];}
export function preferredFlowDurations(model:string,durations:number[]){return model==='Omni Flash'?[...durations].sort((a,b)=>Number(b===10)-Number(a===10)):durations;}
