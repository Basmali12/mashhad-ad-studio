export const photoDirections=[
 'قف عند باب المحل أو الشركة، والتقط صورة للشارع الأمامي.',
 'التقط صورة للشارع من الجهة اليسرى.',
 'التقط صورة للشارع من الجهة اليمنى.',
 'ابتعد عن المحل أو الشركة، والتقط صورة كاملة للواجهة من الأمام.',
 'قف أمام الباب من الداخل، ووجّه الكاميرا نحو داخل المحل أو الشركة.',
 'وجّه الكاميرا من الجهة اليمنى إلى الجهة اليسرى.',
 'وجّه الكاميرا من الجهة اليسرى إلى الجهة اليمنى.',
 'قف في الخلف داخل المحل أو الشركة، ووجّه الكاميرا نحو الأمام أو الباب.',
];
export type PhotoAspect='9:16'|'16:9';
export type PhotoNotes={portrait:string;landscape:string};
type Reference={slot:number;aspect?:PhotoAspect};
export const forAspect=<T extends Reference>(references:T[],aspect:string)=>references.filter(r=>(r.aspect??'9:16')===aspect).sort((a,b)=>a.slot-b.slot);
export function imageGuide(references:Reference[],aspect:string,notes:PhotoNotes){const selected=forAspect(references,aspect);return selected.length?`مراجع المكان الحقيقي، بالترتيب نفسه للصور المرفقة (${aspect}):\n${selected.map((r,i)=>`الصورة ${i+1}: ${photoDirections[r.slot]}`).join('\n')}\nاستخدمها لفهم المكان والاتجاهات في المشاهد المناسبة، ولا تجمع الزوايا كشبكة داخل الإعلان.\n${aspect==='9:16'?notes.portrait:notes.landscape}`:'';}
