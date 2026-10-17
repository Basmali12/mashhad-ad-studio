import {it,expect} from 'vitest';
import {prepareGeneralEdit} from './redesign-general-edit';
import {confirmsImageEdit,requestsImageEdit} from './redesign-image-intent';
import {buildAssistantRequest} from './redesign-assistant';
import type {SeriesProject} from './redesign-data';
const file=new File(['image'],'reference.jpg',{type:'image/jpeg'});
it('recognizes the reported request and waits for approval with the uploaded image instead of a story role',async()=>{
 const text='ضيف معهم شخص ثالث وعد ارسال الصورة';
 expect(requestsImageEdit(text)).toBe(true);
 const project:SeriesProject={id:'chat',kind:'conversation',name:'عامة',characters:[],messages:[{id:'upload',role:'user',text:'',image:file,createdAt:10}]};
 const next=prepareGeneralEdit(project,'edit',text)!;
 expect(next.visualRequests?.[0]).toMatchObject({status:'draft',editConfirmation:true,referenceFile:file,sourceRequestId:null,count:1,kind:'scene'});
 expect(next.messages?.at(-1)?.text).toContain('هل تقصد');expect(next.characters).toEqual([]);
 expect(confirmsImageEdit('ولد')).toBe(true);expect(confirmsImageEdit('لا، ضيف شخصين')).toBe(false);
 const payload=await buildAssistantRequest(project,'upload',async()=> 'data:image/jpeg;base64,YQ==');
 expect(JSON.stringify(payload.messages)).not.toContain('اقترح الاسم والدور');
});
it('uses the last completed edit as the source and does not reuse an older upload',()=>{
 const source={id:'latest',name:'صورة',kind:'scene' as const,description:'',prompt:'',count:1,sourceRequestId:null,instructions:'',status:'ready' as const,file,jobId:'job',createdAt:20};
 const next=prepareGeneralEdit({id:'chat',kind:'conversation',name:'عامة',characters:[],messages:[{id:'old-upload',role:'user',text:'',image:file,createdAt:10}],visualRequests:[source]},'edit','غير الخلفية')!;
 expect(next.visualRequests?.at(-1)).toMatchObject({sourceRequestId:'latest',status:'draft',editConfirmation:true});
 expect(next.visualRequests?.[0]).toEqual(source);
});
