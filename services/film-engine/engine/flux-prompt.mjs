import {hash} from './store.mjs';

export const FLUX_MODEL_ID='flux2-klein-4b';
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
const text=(v,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('INVALID_FLUX_REQUEST');return v.trim();};
const optional=v=>v==null?null:text(v);
const ANGLES={main_face:'A close face portrait, neutral unobstructed facial features.',face:'A close face portrait.',full_body:'Full body from head to feet, outfit and accessories clearly visible.',front:'Front-facing view.',side:'Side profile view.',three_quarter:'Three-quarter facial and body view.'};
/** Structured director input, not a translation service or generated OCR claim. */
export function buildFluxRequest({scope,subject,scene,camera,style,expression,pose,orientation='portrait',referenceIds=[],seed=42,allowText=false,requestedText=null,mode}){
 if(!scope||!['customerId','projectId','attemptId'].every(k=>ID.test(scope[k]||'')))throw Error('INVALID_FLUX_REQUEST');
 if(!['portrait','landscape'].includes(orientation)||!Number.isSafeInteger(seed)||seed<0||seed>4294967295||typeof allowText!=='boolean'||!Array.isArray(referenceIds)||referenceIds.length>4||new Set(referenceIds).size!==referenceIds.length||referenceIds.some(r=>!ID.test(r)))throw Error('INVALID_FLUX_REQUEST');
 const s=subject?{id:text(subject.id,100),name:text(subject.name,120),description:text(subject.description),age:subject.age,face:text(subject.face),body:text(subject.body),wardrobe:text(subject.wardrobe),props:(subject.props??[]).map(p=>({id:text(p.id,100),description:text(p.description)})),angle:optional(subject.angle)}:null;
 if(s&&(!ID.test(s.id)||s.age!==null&&(!Number.isSafeInteger(s.age)||s.age<0||s.age>120)))throw Error('INVALID_FLUX_REQUEST');
 const location={place:text(scene?.place??'Unspecified location'),description:optional(scene?.description),time:optional(scene?.time),era:optional(scene?.era)},c={framing:optional(camera?.framing),angle:optional(camera?.angle),lighting:optional(camera?.lighting)},visualStyle=text(style??'Photorealistic cinematic photography'),facialExpression=optional(expression),bodyPose=optional(pose);
 if(!allowText&&requestedText!=null||allowText&&(!requestedText||!String(requestedText).trim()))throw Error('FLUX_TEXT_CONSENT_REQUIRED');
 const selectedMode=mode??(referenceIds.length>1?'multi_reference':referenceIds.length?'edit':'text_to_image');if(!['text_to_image','edit','multi_reference'].includes(selectedMode)||selectedMode==='text_to_image'&&referenceIds.length||selectedMode==='edit'&&referenceIds.length!==1||selectedMode==='multi_reference'&&referenceIds.length<2)throw Error('INVALID_FLUX_REQUEST');
 const lines=[visualStyle+'.',s?`${s.name}: ${s.description}. Age ${s.age??'unspecified'}. Face: ${s.face}. Body: ${s.body}. Outfit: ${s.wardrobe}. Props: ${s.props.map(p=>p.description).join('; ')||'none specified'}.`:null,s?.angle?(ANGLES[s.angle]??s.angle):null,`Place: ${location.place}.`,location.time?'Time: '+location.time+'.':null,location.era?'Era: '+location.era+'.':null,c.framing?'Framing: '+c.framing+'.':null,c.angle?'Camera: '+c.angle+'.':null,c.lighting?'Lighting: '+c.lighting+'.':null,facialExpression?'Facial expression: '+facialExpression+'.':null,bodyPose?'Body pose/action: '+bodyPose+'.':null,referenceIds.length?'Preserve the referenced people, their facial features, clothing and specified props while applying the requested view and setting.':null,allowText?'Requested visible text: '+text(requestedText,1000):'A clean photographed scene with plain, unmarked surfaces.'];
 if(location.description)lines.splice(3,0,'Scene and event: '+location.description+'.');
 const prompt=lines.filter(Boolean).join('\n');if(prompt.length>12000)throw Error('INVALID_FLUX_REQUEST');
 const settings={width:orientation==='portrait'?720:1280,height:orientation==='portrait'?1280:720,seed,num_inference_steps:4,guidance_scale:1,dtype:'bfloat16'};
 return {modelId:FLUX_MODEL_ID,mode:selectedMode,prompt,settings,referenceIds:[...referenceIds],structured:{subject:s,scene:location,camera:c,style:visualStyle,expression:facialExpression,pose:bodyPose,allowText,requestedText:allowText?text(requestedText,1000):null},fingerprint:hash(JSON.stringify({scope,prompt,settings,referenceIds,mode:selectedMode}))};
}
