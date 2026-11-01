/** Performance targets, NOT fabricated speakers or Habibi emotion tokens. */
const style=(id,label,rate,commaMs,sentenceMs,words)=>Object.freeze({id,label,speakingRate:rate,commaMs,sentenceMs,words:Object.freeze(words),expression:'neutral',textPolicy:'plain',mastering:'narration-warm-v1',referenceRequired:true,qualityVerified:false});
export const NARRATION_STYLES=Object.freeze([
 style('deep-majestic','عميق ومهيب',0.97,140,280,['عميق','مهيب','قوي','رجولي']),
 style('rough-moving','خشن ومؤثر',0.98,130,260,['خشن','مؤثر','خشونة']),
 style('calm-reverent','هادئ وخاشع',0.94,180,350,['هادئ','خاشع','خشوع','ديني']),
 style('documentary','وثائقي رصين',1,100,230,['وثائقي','رصين','تاريخي']),
 style('epic-story','سرد ملحمي',0.98,140,300,['ملحمي','ملحمة','بطولي']),
]);
export function narrationStyle(id){const s=NARRATION_STYLES.find(v=>v.id===id);if(!s)throw Error('NARRATION_STYLE_INVALID');return s;}
const arabic=v=>v.normalize('NFC').replace(/[\u064b-\u065f\u0670\u0640]/gu,'').replace(/[أإآ]/gu,'ا');
export function matchNarrationStyle(description){
 if(typeof description!=='string'||description.length>2000)throw Error('NARRATION_DESCRIPTION_INVALID');
 const text=arabic(description),rank=NARRATION_STYLES.map(s=>({s,score:s.words.reduce((n,w)=>n+(text.includes(arabic(w))?1:0),0)})).sort((a,b)=>b.score-a.score);
 return {style:rank[0].score?rank[0].s:narrationStyle('documentary'),matched:rank[0].score>0,needsReferenceAudition:true};
}
export const NARRATION_COMPARISON_TEXT='في يوم من الأيام، كان هناك رجل اسمه علي. عرف أن الكلمة الطيبة تبقى، وأن الخير لا يضيع.';
export function narrationComparisonPlan(){return {version:'narration-comparison-v1',paidApproved:false,dispatch:false,text:NARRATION_COMPARISON_TEXT,samples:NARRATION_STYLES.map(s=>({styleId:s.id,text:NARRATION_COMPARISON_TEXT,modelId:'habibi-msa',locale:'ar-MSA',seed:42,speakingRate:s.speakingRate,expression:'neutral',referenceAssetId:null,state:'awaiting_licensed_auditioned_reference'})),reviewCriteria:['word_accuracy','natural_pauses','pace','speaker_similarity','clarity','clipping','roughness_without_distortion'],listeningApproved:false};}
