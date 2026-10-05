// Initial rollout deliberately supports only one or two generation lanes.
// Increasing this ceiling requires a measured Flow-account capacity test.
export function flowConcurrency(value:string|undefined){if(value===undefined||value==='')return 1;const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>2)throw new Error('FLOW_CONCURRENCY must be 1 or 2 for this rollout');return n;}
export class SerialStage {
 private tail:Promise<void>=Promise.resolve();
 async enter(){const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});await previous;return release;}
}
