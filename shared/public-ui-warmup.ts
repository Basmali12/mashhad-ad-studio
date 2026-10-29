export type WarmAsset={url:string;kind:'script'|'style'|'image';bytes:number};
export const WARMUP_LIMIT=96*1024;
export const PUBLIC_LOGOS:WarmAsset[]=[{url:'./mashhad-logo-128.webp',kind:'image',bytes:10388},{url:'./mashhad-logo-192.webp',kind:'image',bytes:16712}];
const publicChunk=/^\.\/assets\/(?:FilmEntry-|FilmFiles-|calendar-|film-)[A-Za-z0-9_-]+\.(?:js|css)$/;
export function allowPublicWarmup(connection?:{saveData?:boolean;effectiveType?:string}){return !connection?.saveData&&!['slow-2g','2g'].includes(connection?.effectiveType||'');}
export function choosePublicChunks(files:Array<{fileName:string;bytes:number}>):WarmAsset[]{
 let total=0;
 return files.filter(f=>publicChunk.test('./'+f.fileName)).sort((a,b)=>a.fileName.localeCompare(b.fileName)).flatMap(f=>{
  if(!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>65536||total+f.bytes>WARMUP_LIMIT)return [];
  total+=f.bytes;return [{url:'./'+f.fileName,kind:f.fileName.endsWith('.css')?'style' as const:'script' as const,bytes:f.bytes}];
 }).slice(0,6);
}
export function readPublicManifest(value:unknown,version:string):WarmAsset[]{
 if(!value||typeof value!=='object')return [];
 const v=value as {version?:unknown;assets?:unknown};if(v.version!==version||!Array.isArray(v.assets)||v.assets.length>6)return [];
 let total=0;const urls=new Set<string>(),out:WarmAsset[]=[];
 for(const row of v.assets){
  if(!row||typeof row!=='object')return [];
  const r=row as WarmAsset;
  if(typeof r.url!=='string'||!publicChunk.test(r.url)||!['script','style'].includes(r.kind)||r.kind!==(r.url.endsWith('.css')?'style':'script')||!Number.isSafeInteger(r.bytes)||r.bytes<=0||r.bytes>65536||urls.has(r.url))return [];
  total+=r.bytes;if(total>WARMUP_LIMIT)return [];urls.add(r.url);out.push({url:r.url,kind:r.kind,bytes:r.bytes});
 }
 return out;
}
export async function warmPublicUi({version,idle,prefetch,manifest,stop}:{version:string;idle:()=>Promise<void>;prefetch:(a:WarmAsset)=>Promise<void>;manifest:()=>Promise<unknown>;stop:()=>boolean}){
 for(const asset of PUBLIC_LOGOS){await idle();if(stop())return;await prefetch(asset);}
 await idle();if(stop())return;
 let assets:WarmAsset[];try{assets=readPublicManifest(await manifest(),version);}catch{return;}
 for(const asset of assets){await idle();if(stop())return;await prefetch(asset);}
}
