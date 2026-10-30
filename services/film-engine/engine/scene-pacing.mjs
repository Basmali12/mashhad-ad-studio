// Editorial timing is separate from GPU inference and from the locked spoken script.
export const PACING_VERSION='native-audio-pacing-v1';
export function scenePacing(scene,index=0){
 const supplied=scene.pacing,beats=supplied?.beats;
 if(beats!==undefined&&(!Array.isArray(beats)||beats.length<1||beats.length>8))throw Error('INVALID_SCENE_PACING');
 let end=0;
 const checked=(beats||[]).map(b=>{
  if(!Number.isFinite(b.start)||!Number.isFinite(b.end)||Math.abs(b.start-end)>.05||b.start<0||b.end<=b.start||b.end>10||typeof b.action!=='string'||!b.action.trim()||b.action.length>1200||/[\x00-\x1f<>«»"]/.test(b.action))throw Error('INVALID_SCENE_PACING');
  end=b.end;return {start:b.start,end:b.end,action:b.action.trim()};
 });
 if(checked.length&&Math.abs(end-10)>.05)throw Error('INVALID_SCENE_PACING');
 if(supplied?.tailPolicy!==undefined&&!['keep','trim_idle'].includes(supplied.tailPolicy))throw Error('INVALID_SCENE_PACING');
 return {version:PACING_VERSION,filmStartSeconds:index*10,renderSeconds:10,beats:checked,
  tailPolicy:scene.audioContract?.mode==='silent'?'keep':supplied?.tailPolicy||'trim_idle',
  timingSource:checked.length?'authored_beats':'untimed_legacy_response'};
}
export function pacingPrompt(prompt,pacing){
 const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
 return [prompt,...(pacing.beats.length?['Timing clarification of the SAME actions above, not another performance or extra repetitions:',...pacing.beats.map(b=>`Beginning around ${words[Math.round(b.start)]} seconds into the shot and lasting ${b.end-b.start<.75?"a brief moment":"about "+words[Math.round(b.end-b.start)]+" seconds"}, ${b.action}`)]:[]),
  'Perform this as part of the ongoing story, not a self-contained ending. Keep the exact dialogue at a natural conversational pace; do not slow, repeat or stretch words to fill the shot. Continue the specifically described physical action and reactions between lines. Avoid idle waiting, a frozen pose, a fade-out, or a repeated establishing pause before the next event. Do not invent extra speech. Timing directions are never visible lettering.'].join(' ');
}
export const PACING_PLAN_INSTRUCTION='For each scene also return pacing:{tailPolicy:"trim_idle" or "keep",beats:[{start:0,end:3,action:"specific visible action"},{start:3,end:8,action:"next event and speaker handoff"},{start:8,end:10,action:"specific consequence leading directly into the next scene"}]}. These are chronological local-second performance targets, not exact model guarantees. Adapt beat boundaries to the real amount of dialogue and action; do not invent speech or slow short dialogue to fill ten seconds. Plan the whole requested story before splitting it, preserving cause before reaction, ongoing prop state, and the next scene opening. Use keep when a quiet ending or deliberate held reaction is meaningful. Visual prompt is a flowing chronological English paragraph, with no quoted dialogue, timecode labels, captions or a reset at each boundary. Preserve the requested era and setting; never infer an old or modern setting merely from Iraqi Arabic.';
