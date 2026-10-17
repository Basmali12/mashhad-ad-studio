import {it,expect} from 'vitest';
import {chatTimeline} from './redesign-chat-timeline';
import type {SeriesProject} from './redesign-data';
import type {VisualRequest} from './redesign-visual';
const image:VisualRequest={id:'image',kind:'scene',name:'صورة',description:'',prompt:'بيت',count:1,sourceRequestId:null,instructions:'',status:'ready',file:new File(['image'],'result.jpg')};
const conversation:SeriesProject={id:'chat',name:'عامة',kind:'conversation',characters:[],messages:[{id:'request',role:'user',text:'ولد لي صورة بيت',createdAt:1},{id:'answer',role:'assistant',text:'الصورة جاهزة',replyTo:'request',createdAt:2},{id:'followup',role:'user',text:'خلينا نناقش تفاصيل البيت',createdAt:3},{id:'discussion',role:'assistant',text:'نناقشها',createdAt:4}]};
const ids=(project:SeriesProject)=>chatTimeline(project).map(e=>e.kind==='message'?e.message.id:e.request.id);
it('keeps later conversation below the image, even when generation completes later',()=>{
 expect(ids({...conversation,visualRequests:[{...image,messageId:'answer',createdAt:10}]})).toEqual(['request','answer','image','followup','discussion']);
});
it('places old saved images at their generation turn without changing saved data',()=>{
 const project={...conversation,visualRequests:[image]};
 expect(ids(project)).toEqual(['request','answer','image','followup','discussion']);
 expect(project.visualRequests[0].messageId).toBeUndefined();expect(project.messages).toHaveLength(4);
});
it('preserves image-only conversations and places timestamped images before later messages',()=>{
 expect(ids({...conversation,messages:[],visualRequests:[image]})).toEqual(['image']);
 expect(ids({...conversation,visualRequests:[{...image,createdAt:2}]})).toEqual(['request','answer','image','followup','discussion']);
});
