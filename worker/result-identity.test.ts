import {expect,it,vi} from 'vitest';
import type {Page} from 'playwright';
vi.mock('./runtime',()=>({sleep:async()=>{},persist:async()=>{}}));
vi.mock('./browser',()=>({workspace:async()=>{},screenshot:async()=>{}}));
import {selectedResultId,waitAssets} from './flow';

it('binds a selected result only to the saved project and exact Google account route',()=>{
 const before='https://flow.google.com/u/2/project/abc';
 expect(selectedResultId(before,before+'/edit/def','/u/2/project/abc')).toBe('def');
 for(const after of ['https://flow.google.com/u/0/project/abc/edit/def','https://flow.google.com/project/other/edit/def','https://flow.google.com.evil.test/u/2/project/abc/edit/def'])expect(selectedResultId(before,after,'/u/2/project/abc')).toBeUndefined();
 expect(selectedResultId(before,before+'/edit/def',undefined)).toBeUndefined();
});
function fixture(initialEditor=false,wrongProject=false){
 let url='https://flow.google.com/project/abc';if(initialEditor)url+='/edit/def';
 const tiles={count:async()=>1,getByText:()=>({count:async()=>1}),click:vi.fn(async()=>{url='https://flow.google.com/project/'+(wrongProject?'eee':'abc')+'/edit/def';})};
 const page={url:()=>url,locator:(selector:string)=>selector==='body'?{innerText:async()=> 'يرجى وصف كيفية تعديل هذا الفيديو'}:selector==='video'?{evaluateAll:async()=>[]}:tiles,getByRole:()=>({count:async()=>1,isEnabled:async()=>true})} as unknown as Page;
 return {page,tiles};
}
it('follows the sole result from the saved project even when the editor hides the source prompt',async()=>{
 const {page,tiles}=fixture();
 expect(await waitAssets(page,[],[],1,()=>false,'معرّف المشهد: job-1',undefined,'/project/abc')).toMatchObject([{id:'def'}]);
 expect(tiles.click).toHaveBeenCalledOnce();
});
it('still rejects an unrelated editor or a click that lands in another project',async()=>{
 for(const f of [fixture(true),fixture(false,true)])await expect(waitAssets(f.page,[],[],1,()=>false,'معرّف المشهد: job-1',undefined,'/project/abc')).rejects.toThrow('IDENTITY_AMBIGUOUS');
});
