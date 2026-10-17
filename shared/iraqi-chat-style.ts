export function iraqiChatReply(reply:string,userText:string){
 if(/ترجم|ترجمة|فصحى|فصيح|بالإنجليزي|بالانجليزي|بالإنكليزي|بالانكليزي|بالفرنسي|بالتركي|بالكردي|in English|translate/i.test(userText))return reply;
 const phrases:[string,string][]=[['شكو بدك','شتريد'],['هيك','بهالطريقة'],['عشان','حتى'],['إليك','هاي'],['ثم','وبعدين'],['للتالية','للي بعدها'],['لا تشتغل متعدد المهام','لا تشتغل على أكثر من شغلة بنفس الوقت'],['هل تريد','تريد'],['يمكنك','تگدر'],['بإمكانك','تگدر'],['سأساعدك','راح أساعدك'],['سأقوم','راح أسوي'],['من أين','منين'],['ما الذي','شنو اللي'],['معاك','وياك'],['معك','وياك'],['بدك','تريد'],['إيش','شنو'],['عايز','تريد'],['رح','راح'],['تلاقي','تلكه'],['بتخزن','تنحفظ']];
 // Leave code, inline literals and links intact. Only normalize recognizable prose phrases.
 return reply.split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s)]+|\[[^\]]*\]\([^)]*\))/g).map((part,index)=>{
  if(index%2)return part;
  for(const [from,to] of phrases)part=part.replace(new RegExp('(^|[^\\p{L}\\p{N}_])'+from+'(?=$|[^\\p{L}\\p{N}_])','gu'),(_,prefix:string)=>prefix+to);
  return part;
 }).join('');
}
