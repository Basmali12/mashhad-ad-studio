import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {command,tools,probe,decode,hashFile} from './montage-media';
export type FilmSource={path:string;start:number;duration:number};
export async function renderFilm(sources:FilmSource[],aspect:'9:16'|'16:9',dir:string,progress:(percent:number)=>void,signal?:AbortSignal){
 await mkdir(dir,{recursive:true});const width=aspect==='9:16'?720:1280,height=aspect==='9:16'?1280:720,total=sources.reduce((n,s)=>n+s.duration,0);
 if(!sources.length||sources.length>80||total>300)throw new Error('Invalid film duration');
 const metadata=await Promise.all(sources.map(s=>probe(s.path))),audio=metadata.some(m=>m.audio),normalized:string[]=[];let elapsed=0;
 for(const [i,s] of sources.entries()){
  if(!Number.isFinite(s.start)||s.start<0||!Number.isFinite(s.duration)||s.duration<.04||s.start+s.duration>metadata[i].duration+.04)throw new Error('Source is too short; no repeat or slowdown');
  const output=resolve(dir,`normalized-${i}.mp4`),signature=JSON.stringify({hash:await hashFile(s.path),start:s.start,duration:s.duration,width,height,audio,version:1});let cached:boolean;
  try{const saved=JSON.parse(await readFile(output+'.json','utf8')) as {signature:string;hash:string};cached=saved.signature===signature&&saved.hash===await hashFile(output);if(cached){const m=await probe(output);if(Math.abs(m.duration-s.duration)>=.12)throw new Error('Cached duration mismatch');await decode(output,signal);}}catch{cached=false;}
  if(!cached){const args=['-v','error','-ss',String(s.start),'-i',s.path];if(audio&&!metadata[i].audio)args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000');args.push('-t',String(s.duration),'-map','0:v:0','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p');if(audio)args.push('-map',metadata[i].audio?'0:a:0':'1:a:0','-af','apad','-c:a','aac','-ar','48000','-ac','2');else args.push('-an');args.push('-movflags','+faststart','-progress','pipe:1','-nostats','-y',output+'.part.mp4');await command(tools.ffmpeg,args,undefined,t=>progress(Math.min(89,Math.floor((elapsed+Math.min(t,s.duration))/total*90))),signal);await decode(output+'.part.mp4',signal);await rename(output+'.part.mp4',output);await writeFile(output+'.json',JSON.stringify({signature,hash:await hashFile(output)}),{mode:0o600});}
  normalized.push(output);elapsed+=s.duration;progress(Math.min(89,Math.floor(elapsed/total*90)));
 }
 const list=resolve(dir,'concat.txt'),final=resolve(dir,'final.mp4');await writeFile(list,normalized.map(p=>`file '${p.replace(/\\/g,'/').replace(/'/g,"'\\''")}'`).join('\n'),{mode:0o600});
 await command(tools.ffmpeg,['-v','error','-f','concat','-safe','0','-i',list,'-t',String(total),'-c','copy','-movflags','+faststart','-progress','pipe:1','-nostats','-y',final+'.part.mp4'],undefined,t=>progress(Math.min(99,90+Math.floor(t/total*9))),signal);
 const m=await probe(final+'.part.mp4');if(Math.abs(m.duration-total)>.1||m.width!==width||m.height!==height||m.codec!=='h264'||audio&&m.audioCodec!=='aac')throw new Error('Final film validation failed');await decode(final+'.part.mp4',signal);await rename(final+'.part.mp4',final);return {path:final,hash:await hashFile(final),media:m};
}
