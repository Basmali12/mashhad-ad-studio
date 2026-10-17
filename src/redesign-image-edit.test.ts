import {it,expect,vi} from 'vitest';
import {addVisualProposal,approvePrompt,generateVisual} from './redesign-visual';
import type {SeriesProject} from './redesign-data';
it('edits the source image without adding new-character formatting and retains both versions',async()=>{
 let project:SeriesProject={id:'chat',name:'عامة',characters:[]};
 project=addVisualProposal(project,{kind:'character',name:'علي',description:'علي',prompt:'شخصية',count:1,sourceRequestId:null});
 const source={...project.visualRequests![0],status:'ready' as const,file:new File(['source'],'source.jpg'),jobId:'source-job'};
 project=addVisualProposal({...project,visualRequests:[source]},{kind:'character',name:'تعديل',description:'خلفية خضراء',prompt:'Edit background only, preserve the person',count:1,sourceRequestId:source.id},'reply-edit');
 const id=project.visualRequests![1].id;
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({jobId:'edited-job'}))).mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',type:'image/jpeg',data:'aGVsbG8='})));
 vi.stubGlobal('fetch',fetcher);
 try{
  const result=await generateVisual(approvePrompt(project,id),id,async()=>{});
  const payload=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(payload.sourceJobId).toBe('source-job');expect(payload.prompt).not.toContain('Single isolated full-body character');
  expect(result.visualRequests![0]).toEqual(source);expect(result.visualRequests![1]).toMatchObject({status:'ready',messageId:'reply-edit',sourceRequestId:source.id});
  expect(result.visualRequests![1].file).toBeInstanceOf(File);
 }finally{vi.unstubAllGlobals();}
});
