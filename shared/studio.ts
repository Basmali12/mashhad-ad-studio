import type {Doc} from '../convex/_generated/dataModel';
export function taskSteps(job:Doc<'pipelines'>|undefined,output:Doc<'exports'>|undefined){
 const final=job?.stage==='completed',clips=job?.clips??[];
 const generated=clips.filter(c=>['downloaded','uploaded'].includes(c.state)).length;
 const active=clips.find(c=>c.state==='submitted');
 const generationDone=clips.length>0&&generated===clips.length;
 const generationPercent=final||generationDone?100:active?.percent!==undefined?Math.floor((generated+active.percent/100)/clips.length*100):undefined;
 const phase=output?.status;
 const processingDone=!!phase&&['overlay','encoding','verifying','uploading','completed'].includes(phase);
 const designDone=!!phase&&['verifying','uploading','completed'].includes(phase);
 return [
  {name:'التوليد',done:final||generationDone,active:job?.stage==='generating',percent:generationPercent,detail:`${generated} من ${clips.length} مقاطع جاهزة`},
  {name:'المعالجة',done:final||processingDone,active:job?.stage==='downloading'||phase==='preparing'||phase==='merging',percent:phase==='merging'?output?.percent:undefined,detail:'تنزيل المقاطع وتجهيزها ودمجها'},
  {name:'التصميم',done:final||designDone,active:phase==='overlay'||phase==='encoding'||phase==='verifying',percent:phase==='encoding'||phase==='overlay'?output?.percent:undefined,detail:'الشعار والنصوص والتصدير والتحقق'},
  {name:'الحفظ والتحميل',done:final,active:phase==='uploading',percent:undefined,detail:'حفظ الإعلان النهائي وإتاحته للتنزيل'},
 ];
}
