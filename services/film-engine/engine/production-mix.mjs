/** FFmpeg audio graph only: original tracks remain immutable, no synthesis. */
export function appendProductionMix({filters,tracks,usedAudio,inputCount,replaceAudio,durationMs,silenceWindows=[]}){
 const silence=label=>silenceWindows.length?label+silenceWindows.map(w=>`,volume=0:enable='between(t,${w.startMs/1000},${w.endMs/1000})'`).join(''):label;
 const speech=[],background=[],labels=[];
 if(!replaceAudio){filters.push(silence('[base]anull')+'[baselevel]');labels.push('[baselevel]');}
 for(const [index,asset] of usedAudio.entries()){
  const slices=tracks.map((track,i)=>({track,i})).filter(t=>t.track.assetId===asset.id);
  if(slices.length>1)filters.push(`[${inputCount+index}:a:0]asplit=${slices.length}`+slices.map(s=>`[split${s.i}]`).join(''));
  for(const {track,i} of slices){const source=slices.length>1?`[split${i}]`:`[${inputCount+index}:a:0]`,spoken=['narration','dialogue','vocal_event'].includes(track.layer??(track.kind==='narration'?'narration':'foley')),gain=track.gainDb??(spoken?-3:-12);
   let graph=source+`atrim=start=${(track.sourceOffsetMs/1000).toFixed(6)}:duration=${(track.durationMs/1000).toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gain}dB,adelay=${track.startMs}:all=1,apad,atrim=duration=${(durationMs/1000).toFixed(6)}`;
   if(!spoken)graph=silence(graph);filters.push(graph+`[track${i}]`);if(spoken)speech.push(`[track${i}]`);else background.push({label:`[track${i}]`,duck:track.duckingRequested!==false});
  }
 }
 if(speech.length){filters.push(speech.join('')+`amix=inputs=${speech.length}:duration=longest:dropout_transition=0:normalize=0[voicebus]`);const duck=background.filter(b=>b.duck);if(duck.length){filters.push(`[voicebus]asplit=${duck.length+1}[speech]`+duck.map((_,i)=>`[key${i}]`).join(''));labels.push('[speech]');let i=0;for(const [n,b] of background.entries()){if(b.duck){filters.push(b.label+`[key${i++}]sidechaincompress=threshold=0.025:ratio=8:attack=10:release=250[duck${n}]`);labels.push(`[duck${n}]`);}else labels.push(b.label);}}else{labels.push('[voicebus]');labels.push(...background.map(b=>b.label));}}
 else labels.push(...background.map(b=>b.label));
 filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${(durationMs/1000).toFixed(6)},asetpts=PTS-STARTPTS[silence]`);labels.push('[silence]');
 filters.push(labels.join('')+`amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,aresample=192000,alimiter=limit=0.63:level=0:latency=1,aresample=48000,atrim=duration=${(durationMs/1000).toFixed(6)}[a]`);
}
