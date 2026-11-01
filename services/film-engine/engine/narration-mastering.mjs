import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {inspectSpeechWav} from './voice-profiles.mjs';
const exec=promisify(execFile);
// Gentle static EQ + compression + capped gain. No denoiser, pitch shift,
// silence trimming, time stretching or invented roughness.
export const NARRATION_FILTER='highpass=f=65,equalizer=f=180:t=q:w=0.7:g=0.8,acompressor=threshold=0.125:ratio=1.5:attack=20:release=180:makeup=1,alimiter=limit=0.891:level=false:latency=true';
export function speechSignal(bytes){const info=inspectSpeechWav(bytes,{maxDurationMs:120000});let data;for(let o=12;o+8<=bytes.length;){const n=bytes.readUInt32LE(o+4);if(bytes.toString('ascii',o,o+4)==='data'){data=bytes.subarray(o+8,o+8+n);break;}o+=8+n+(n%2);}let peak=0,sum=0,clipped=0;for(let i=0;i<data.length;i+=2){const v=data.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;if(Math.abs(v)>=0.999)clipped++;}const rms=Math.sqrt(sum/(data.length/2));return {...info,peakDB:20*Math.log10(Math.max(peak,1e-9)),rmsDB:20*Math.log10(Math.max(rms,1e-9)),clippedSamples:clipped,silenceOrVeryQuiet:rms<0.0001,pronunciationVerified:false};}
export async function masterNarration(bytes,{preset='narration-warm-v1',ffmpeg=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg'}={}){
 if(preset!=='narration-warm-v1')throw Error('NARRATION_MASTERING_INVALID');const before=speechSignal(bytes);if(before.sampleRate!==24000||before.channels!==1||before.silenceOrVeryQuiet)throw Error('NARRATION_SIGNAL_REVIEW_REQUIRED');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'mashhad-narration-'));try{
  const source=path.join(folder,'native.wav'),filtered=path.join(folder,'filtered.wav'),target=path.join(folder,'audio.wav');await fs.writeFile(source,bytes,{flag:'wx',mode:0o600});
  const run=args=>exec(ffmpeg,['-nostdin','-hide_banner','-v','error','-threads','2',...args],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  await run(['-i',source,'-af',NARRATION_FILTER,'-ar','24000','-ac','1','-c:a','pcm_s16le','-n',filtered]);const middle=speechSignal(await fs.readFile(filtered)),gainDB=Math.min(6,-19-middle.rmsDB,-1.5-middle.peakDB);
  await run(['-i',filtered,'-af',`volume=${gainDB.toFixed(5)}dB`,'-ar','24000','-ac','1','-c:a','pcm_s16le','-n',target]);const result=await fs.readFile(target),after=speechSignal(result);
  if(after.samples!==before.samples||after.clippedSamples||after.peakDB>-1)throw Error('NARRATION_MASTERING_OUTPUT_INVALID');
  return {bytes:result,nativeBytes:bytes,evidence:{preset,sourceSHA256:hash(bytes),outputSHA256:hash(result),filter:NARRATION_FILTER,gainDB,before,after,pitchChanged:false,speedChanged:false,listeningApproved:false}};
 }finally{await fs.rm(folder,{recursive:true,force:true});}
}
