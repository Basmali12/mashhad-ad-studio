export const isOrientation=value=>value==='portrait'||value==='landscape';
export function initialOrientation(value,old,preference){
 if(value!==null&&!isOrientation(value))throw Error('INVALID_INPUT');
 if(isOrientation(value))return {orientation:value,orientationConfirmed:true};
 if(old)return {orientation:old.orientation,orientationConfirmed:old.orientationConfirmed!==false};
 return {orientation:isOrientation(preference)?preference:'portrait',orientationConfirmed:isOrientation(preference)};
}
export function applyDiscussionOrientation(project,discussion,message){
 const selected=discussion?.orientation;
 // A model default cannot silently override a preference or answer for a user.
 const explicit=isOrientation(selected)&&(selected==='portrait'?/عمودي|portrait|9\s*[:：]\s*16/i:/[اأ]فقي|landscape|16\s*[:：]\s*9/i).test(message);
 if(explicit){project.orientation=selected;project.orientationConfirmed=true;}
 if(project.orientationConfirmed===false){
  discussion.ready_to_write=false;
  if(!/عمودي/.test(discussion.reply||'')||!/[اأ]فقي/.test(discussion.reply||''))discussion.reply=String(discussion.reply||'')+'\n\nتريده عمودي 9:16 لو أفقي 16:9؟';
 }
}
