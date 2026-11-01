import {Buffer} from 'node:buffer';
const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const short=(v,n)=>typeof v==='string'?v.slice(0,n):v;
const speaker=c=>({id:c.id,name:short(c.name,120),age:c.age??null,voice:c.voice});
/** HTTP projections only; full durable plans remain on the server. */
export function customerProductionResult(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||size(result)<=190000)return result;
 if(Object.hasOwn(result,'planReady')&&Object.hasOwn(result,'originalText')){
  const next={...result,originalText:short(result.originalText,4000),originalTextTruncated:result.originalTextTruncated||result.originalText.length>4000,summary:short(result.summary,4000),missing:(result.missing??[]).slice(0,20).map(v=>short(v,1000)),outlineTruncated:true,proposedTimeline:null,proposedTimelineTruncated:true,sceneStates:(result.sceneStates??[]).slice(0,100)};
  if(result.pendingRevision)next.pendingRevision={...result.pendingRevision,summary:short(result.pendingRevision.summary,2000)};
  if(result.outline)next.outline={title:short(result.outline.title,200),summary:short(result.outline.summary,4000),durationMs:result.outline.durationMs,characters:result.outline.characters.map(speaker),narrators:result.outline.narrators.map(speaker),chapters:result.outline.chapters.map(c=>({id:c.id,title:short(c.title,120),startMs:c.startMs,endMs:c.endMs})),warnings:result.outline.warnings.slice(0,20).map(v=>short(v,1000))};
  next.researchResults=(result.researchResults??[]).slice(-2).map(r=>({id:r.id,query:short(r.query,2000),summary:short(r.summary,4000),originalScenario:short(r.originalScenario,4000),sources:(r.sources??[]).slice(0,10).map(s=>({url:s.url,title:short(s.title,200)})),rightsNotes:typeof r.rightsNotes==='string'?short(r.rightsNotes,1000):r.rightsNotes?.slice(0,10).map(v=>short(v,500))}));
  if(size(next)>230000){next.sceneStates=[];next.messages=(next.messages??[]).slice(-10);next.researchResults=next.researchResults.map(r=>({...r,sources:r.sources.slice(0,3),originalScenario:short(r.originalScenario,1000)}));}
  return next;
 }
 if(!Array.isArray(result.stages)||!Object.hasOwn(result,'timeline'))return result;
 const next={...result,story:result.story?.slice(0,4000),storyTruncated:result.storyTruncated||result.story?.length>4000,characters:result.characters?.map(speaker),narrators:result.narrators?.map(speaker),timelineCounts:result.timeline?{chapters:result.timeline.chapters.length,scenes:result.timeline.scenes.length,shots:result.timeline.shots.length,utterances:result.timeline.utterances.length}:null,stageCounts:{total:result.stages.length,completed:result.stages.filter(s=>s.state==='completed').length}};
 next.timeline=result.timeline?{chapters:result.timeline.chapters.map(v=>({id:v.id,title:short(v.title,120),startMs:v.startMs,endMs:v.endMs})),scenes:[],shots:[],utterances:[],truncated:true}:null;
 next.stages=result.stages.filter(s=>s.state!=='completed').slice(0,100);
 return next;
}
