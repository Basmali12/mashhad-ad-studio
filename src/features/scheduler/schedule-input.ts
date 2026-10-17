export function clockParts(time:string){const [hour,minute]=time.split(':').map(Number);return {hour:hour%12||12,minute:String(minute).padStart(2,'0'),period:hour>=12?'pm':'am'};}
export function clockTime(hour:number,minute:string,period:string){return `${String(hour%12+(period==='pm'?12:0)).padStart(2,'0')}:${minute}`;}
export function requireVideoText(title:string,description:string){if(!title.trim()||!description.trim())throw Error('اكتب عنوان ووصف لكل فيديو قبل الرفع.');if(title.trim().length>100||description.trim().length>4500)throw Error('العنوان حتى 100 حرف والوصف حتى 4500 حرف.');}
