// Descriptive conditioning only: no resource selection, adapters, downloads or claims of identity locking.
export const VISUAL_WORLD_VERSION='story-visual-world-v1';
const eras=['heritage','contemporary','futuristic','unspecified'];
const text=(v,max=500)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f<>«»"]/.test(v))throw Error('INVALID_VISUAL_WORLD');return v.trim();};
const key=v=>{if(typeof v!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(v))throw Error('INVALID_VISUAL_WORLD');return v;};
function rows(input,max,convert){if(!Array.isArray(input)||input.length>max)throw Error('INVALID_VISUAL_WORLD');const result=input.map(convert);if(new Set(result.map(r=>r.id)).size!==result.length)throw Error('INVALID_VISUAL_WORLD');return result;}
export function visualWorld(input){
 if(input==null)return null;
 if(typeof input!=='object'||Array.isArray(input))throw Error('INVALID_VISUAL_WORLD');
 return {version:VISUAL_WORLD_VERSION,style:text(input.style,300),settings:rows(input.settings,12,s=>{
  if(!s||!eras.includes(s.era))throw Error('INVALID_VISUAL_WORLD');
  return {id:key(s.id),era:s.era,location:text(s.location),architecture:text(s.architecture),wardrobe:text(s.wardrobe),lighting:text(s.lighting),palette:text(s.palette,200)};
 }),characters:rows(input.characters||[],8,c=>({id:key(c.id),description:text(c.description)})),props:rows(input.props||[],12,p=>({id:key(p.id),description:text(p.description)}))};
}
export function mergeVisualWorld(previous,input){
 const candidate=visualWorld(input);if(!previous)return candidate;if(!candidate)return previous;
 // Later scene batches may introduce locations, but cannot silently rewrite established ones.
 const extend=(old,added,max)=>{const next=[...old,...added.filter(v=>!old.some(p=>p.id===v.id))];if(next.length>max)throw Error('INVALID_VISUAL_WORLD');return next;};
 return {...previous,settings:extend(previous.settings,candidate.settings,12),characters:extend(previous.characters,candidate.characters,8),props:extend(previous.props,candidate.props,12)};
}
export function visualScene(scene,world){
 if(!world)return {prompt:scene.prompt,visualContext:null}; // Historical plans remain unchanged.
 const setting=scene.settingId?world.settings.find(s=>s.id===scene.settingId):world.settings.length===1?world.settings[0]:null;
 if(!setting)throw Error('VISUAL_SETTING_REQUIRED');
 const select=(name,available)=>{const ids=scene[name]||[];if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length)throw Error('INVALID_VISUAL_WORLD');return ids.map(id=>{const item=available.find(v=>v.id===id);if(!item)throw Error('INVALID_VISUAL_WORLD');return item;});};
 const characters=select('characterIds',world.characters),props=select('propIds',world.props);
 const continuity=scene.continuity==null?null:{before:text(scene.continuity.before),after:text(scene.continuity.after)};
 const directions=[`Agreed visual style: ${world.style}. Setting: ${setting.location}. Architecture and materials: ${setting.architecture}. Wardrobe: ${setting.wardrobe}. Motivated lighting: ${setting.lighting}. Color palette: ${setting.palette}.`,
  setting.era==='heritage'?'This is the requested historical or heritage setting. Preserve period-appropriate details; do not modernize it.':setting.era==='contemporary'?'This is the requested present-day setting. Do not age the whole environment into an old period merely because the dialogue is Iraqi. An explicitly old building can still exist in the present day.':setting.era==='futuristic'?'Preserve the requested future-world design rather than replacing it with historical Baghdad.':'The historical period is unspecified. Follow the user-approved setting and reference; Iraqi Arabic alone does not imply an old city or a modern city.',
  ...characters.map(c=>'Visible recurring character: '+c.description+'. Keep these identifying features; do not substitute another face or wardrobe.'),
  ...props.map(p=>'Visible recurring prop: '+p.description+'. Keep its size, material and type, without transforming it into a different object.'),
  ...(continuity?[`Opening state for this event: ${continuity.before}. By its end: ${continuity.after}. Show that change once, with cause before reaction.`]:[]),
  'Only the listed characters and props for this shot are required. These are descriptive visual directions, never spoken words or visible captions. The actual opening-frame reference, when present, also guides appearance; this is not a guarantee of identity or voice consistency.'];
 return {prompt:[...directions,scene.prompt].join(' '),visualContext:{version:VISUAL_WORLD_VERSION,settingId:setting.id,era:setting.era,characterIds:characters.map(c=>c.id),propIds:props.map(p=>p.id),continuity}};
}
export const VISUAL_WORLD_INSTRUCTION=`Also return visualWorld:{style:"agreed live action, animation or other visual style",settings:[{id:"location_id",era:"heritage|contemporary|futuristic|unspecified",location:"specific place",architecture:"physical materials and architecture",wardrobe:"era-appropriate clothing",lighting:"motivated light",palette:"consistent palette"}],characters:[{id:"character_id",description:"stable visible face, hair, age and wardrobe"}],props:[{id:"prop_id",description:"exact object type, size and material"}]}. All visualWorld descriptions are English visual directions, not spoken Arabic. Each scene includes settingId, characterIds, propIds, and continuity:{before:"the opening physical state",after:"the changed physical state"}. Include only subjects actually visible in that scene. Agree the world from the user's story and discussion, not from a stereotype about Arabic speech. Preserve requested heritage, period streets and old architecture; preserve modern offices, current streets, fashion and technology when requested; future and fantasy styles are equally valid. An old house today does not automatically imply a historical film. When the user leaves the period unspecified, use unspecified rather than assigning a historical date. Keep heritage as a supported creative choice, never remove it globally. Plan all locations and recurring subjects for the whole story. Reuse supplied established IDs and descriptions between batches; add a new setting only for a story-driven transition. Describe new visible consequences rather than resetting the scene or repeating the same walk. Do not claim a style LoRA is loaded, select weights, return download URLs or change inference resources. Only configured runtime adapters exist. If a supplied opening image conflicts with the requested era or architecture, explain that conflict and offer an appropriate new composed opening image rather than claiming the old image was changed or silently overriding the user. For a requested preview, offer the existing image-preview path separately; do not claim a new image was generated or require a paid preview just to plan.`;
