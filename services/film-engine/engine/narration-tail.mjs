import {Buffer} from 'node:buffer';
import {hash} from './store.mjs';
import {inspectSpeechWav} from './voice-profiles.mjs';

function pcm(bytes){
 const info=inspectSpeechWav(bytes,{maxDurationMs:120000});
 if(info.channels!==1)throw Error('NARRATION_TAIL_MONO_REQUIRED');
 for(let o=12;o+8<=bytes.length;){const n=bytes.readUInt32LE(o+4);if(bytes.toString('ascii',o,o+4)==='data')return {...info,offset:o+8,length:n};o+=8+n+(n%2);}
 throw Error('NARRATION_TAIL_PCM_INVALID');
}

/** Signal-only review candidate, never a speech recognizer or automatic trim.
 * Sustained stable activity after a substantial quiet gap can be a codec tail
 * or intentional speech/music. Preserve it until an explicit reviewed repair.
 */
export function inspectNarrationTail(bytes){
 const m=pcm(bytes),size=Math.round(m.sampleRate*.02),frames=[];
 for(let start=0;start<m.samples;start+=size){let sum=0,crossings=0,previous=0;const end=Math.min(m.samples,start+size);
  for(let i=start;i<end;i++){const x=bytes.readInt16LE(m.offset+i*2)/32768;sum+=x*x;if(i>start&&(x>=0)!==(previous>=0))crossings++;previous=x;}
  frames.push({startMs:start/m.sampleRate*1000,endMs:end/m.sampleRate*1000,db:20*Math.log10(Math.max(1e-9,Math.sqrt(sum/(end-start)))),zcr:crossings/(end-start)});
 }
 const gaps=[];let start=null;
 for(let i=0;i<=frames.length;i++){if(i<frames.length&&frames[i].db< -55){if(start===null)start=i;}else if(start!==null){if(i-start>=15)gaps.push({startMs:frames[start].startMs,endMs:frames[i-1].endMs});start=null;}}
 for(const gap of gaps.reverse()){
  const tail=frames.filter(f=>f.startMs>=gap.endMs+120&&f.endMs<=m.durationMs-60);
  if(m.durationMs-gap.endMs<900||tail.length<30)continue;
  const db=tail.map(f=>f.db),z=tail.map(f=>f.zcr),mean=z.reduce((a,b)=>a+b,0)/z.length;
  const deviation=Math.sqrt(z.reduce((a,b)=>a+(b-mean)**2,0)/z.length);
  if(Math.min(...db)> -45&&Math.max(...db)-Math.min(...db)<5&&deviation<.012){
   return {version:'narration-tail-review-v1',sourceSHA256:hash(bytes),durationMs:m.durationMs,requiresReview:true,reason:'stationary_terminal_activity_after_quiet_gap',quietGap:gap,candidateStartMs:gap.endMs,proposedMuteMs:Math.round((gap.startMs+gap.endMs)/2),tailMeanDB:db.reduce((a,b)=>a+b,0)/db.length,speechBoundaryVerified:false};
  }
 }
 return {version:'narration-tail-review-v1',sourceSHA256:hash(bytes),durationMs:m.durationMs,requiresReview:false,speechBoundaryVerified:false};
}

/** Explicit editor-approved local repair only, within a measured quiet gap.
 * Keep duration, sample count, original source and all earlier PCM unchanged.
 */
export function repairReviewedNarrationTail(bytes,{approved=false,muteFromMs,fadeMs=10}={}){
 const review=inspectNarrationTail(bytes),m=pcm(bytes);
 if(approved!==true||!review.requiresReview||!Number.isSafeInteger(muteFromMs)||!Number.isSafeInteger(fadeMs)||fadeMs<5||fadeMs>30||muteFromMs-fadeMs<review.quietGap.startMs+20||muteFromMs>review.quietGap.endMs-20)throw Error('NARRATION_TAIL_REVIEW_APPROVAL_REQUIRED');
 const out=Buffer.from(bytes),mute=Math.round(muteFromMs*m.sampleRate/1000),fade=Math.round(fadeMs*m.sampleRate/1000);
 for(let i=mute-fade;i<mute;i++){const x=bytes.readInt16LE(m.offset+i*2);out.writeInt16LE(Math.round(x*(mute-i-1)/fade),m.offset+i*2);}
 out.fill(0,m.offset+mute*2,m.offset+m.length);
 return {bytes:out,evidence:{version:'reviewed-tail-mute-v1',sourceSHA256:hash(bytes),outputSHA256:hash(out),muteFromMs,fadeMs,samplesUnchanged:m.samples,earlierPCMUnchangedThroughMs:muteFromMs-fadeMs,speedChanged:false,pitchChanged:false,reviewApproved:true,originalPreserved:true,sourceReview:review,pronunciationVerified:false}};
}
