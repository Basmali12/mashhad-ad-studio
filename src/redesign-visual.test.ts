import {it,expect,vi} from 'vitest';
import {addVisualProposal,approvePrompt,approveVisual,selectCandidate,generateVisual,visualRecovery,checkVisualConnection} from './redesign-visual';
import type {SeriesProject} from './redesign-data';
const original:SeriesProject={id:'test',name:'مسلسل',characters:[],instructions:'بغداد 1995'};
it('sends four casting identities rather than four poses of the same actor',async()=>{
 const draft=addVisualProposal(original,{kind:'character',name:'رجل فقير',description:'عراقي في الخمسين',prompt:'رجل فقير واقعي',count:4,sourceRequestId:null});
 const id=draft.visualRequests![0].id,project=approvePrompt(draft,id);
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({jobId:'casting-job'}))).mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',type:'image/png',data:'aW1hZ2U='})));
 vi.stubGlobal('fetch',fetch);
 try{await generateVisual(project,id,async()=>{});const payload=JSON.parse(fetch.mock.calls[0][1].body);expect(payload.prompt).toContain('4 different people with distinctly different faces');expect(payload.prompt).toContain('NOT 4 poses');expect(payload.prompt).toContain('2 by 2');expect(payload.sourceJobId).toBeUndefined();}finally{vi.unstubAllGlobals();}
});
it('stops repeating generation when the service is not deployed and checks connection without resubmitting',async()=>{
 const draft=addVisualProposal(original,{kind:'character',name:'علي',description:'بطل',prompt:'واقعي',count:4,sourceRequestId:null});
 const id=draft.visualRequests![0].id,project=approvePrompt(draft,id);
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'خدمة الصور الخاصة لم تتفعّل بعد.',code:'SERVICE_NOT_ACTIVE'}),{status:503}));vi.stubGlobal('fetch',fetch);
 try{
  const failed=await generateVisual(project,id,async()=>{});expect(failed.visualRequests![0].status).toBe('failed');expect(visualRecovery(failed.visualRequests![0])).toBe('check_connection');
  await expect(generateVisual(failed,id,async()=>{})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(new Response(JSON.stringify({ready:false,message:'خدمة الصور الخاصة لم تتفعّل بعد.'})));
  const checked=await checkVisualConnection(failed,id,async()=>{});expect(checked.visualRequests![0].status).toBe('failed');expect(JSON.parse(fetch.mock.calls[1][1].body).op).toBe('check');
  fetch.mockResolvedValue(new Response(JSON.stringify({ready:true})));
  const connected=await checkVisualConnection(checked,id,async()=>{});expect(connected.visualRequests![0]).toMatchObject({status:'failed',recovery:'resume',prompt:'واقعي'});expect(fetch).toHaveBeenCalledTimes(3);
 }finally{vi.unstubAllGlobals();}
});
it('recovers existing failed cards without offering generation for missing service or terminal jobs',()=>{
 const r=addVisualProposal(original,{kind:'character',name:'علي',description:'',prompt:'رجل',count:1,sourceRequestId:null}).visualRequests![0];
 expect(visualRecovery({...r,status:'failed',error:'ربط صور Flow الخاص يحتاج تفعيل الخدمة أو تحديث اتصال الحساب. لم يُستخدم توليد مدفوع.'})).toBe('check_connection');
 expect(visualRecovery({...r,status:'failed',jobId:'job-id',recovery:'review'})).toBe('review');
});
it('requires prompt approval before any generation request',async()=>{
 const project=addVisualProposal(original,{kind:'character',name:'علي',description:'بطل',prompt:'واقعي',count:6,sourceRequestId:null});
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 try{await expect(generateVisual(project,project.visualRequests![0].id,async()=>{})).rejects.toThrow('وافق');expect(fetch).not.toHaveBeenCalled();expect(approvePrompt(project,project.visualRequests![0].id).visualRequests![0].status).toBe('awaiting_generation');}finally{vi.unstubAllGlobals();}
});
it('extracts only a valid selected candidate and blocks opaque character approval',()=>{
 let project=addVisualProposal(original,{kind:'character',name:'خيارات',description:'عراقي',prompt:'شخصيات',count:6,sourceRequestId:null});
 const source=project.visualRequests![0];project={...project,visualRequests:[{...source,status:'ready',file:new File(['image'],'sheet.jpg'),jobId:'source-job'}]};
 expect(()=>selectCandidate(project,source.id,7)).toThrow();
 const selected=selectCandidate(project,source.id,3);expect(selected.visualRequests![1]).toMatchObject({count:1,sourceRequestId:source.id,status:'draft'});expect(selected.visualRequests![1].prompt).toContain('number 3');
 const portrait={...selected.visualRequests![1],status:'ready' as const,file:new File(['image'],'portrait.png')};
 const ready={...selected,visualRequests:[portrait]};expect(()=>approveVisual(ready,portrait.id)).toThrow('الخلفية');expect(approveVisual({...ready,visualRequests:[{...portrait,transparent:true}]},portrait.id).characters).toHaveLength(1);expect(original.characters).toHaveLength(0);
});
