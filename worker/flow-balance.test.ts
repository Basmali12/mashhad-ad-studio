import {expect,it,vi} from 'vitest';
import type {Page} from 'playwright';
import {readFlowBalance} from './flow-balance';
function fixture(open:boolean){const click=vi.fn(async()=>{open=!open;});const row={count:async()=>open?1:0,first(){return this;},waitFor:async()=>{if(!open)throw Error('closed');},allTextContents:async()=>['50 AI credits']};const page={url:()=> 'https://flow.google.com/',reload:vi.fn(),getByText:()=>({filter:()=>row}),getByRole:(role:string)=>role==='dialog'?{locator:()=>({filter:()=>({count:async()=>0})})}:{click},keyboard:{press:async()=>{}}} as unknown as Page;return {page,click};}
it('reads an already-open account menu without toggling it closed',async()=>{const {page,click}=fixture(true);expect(await readFlowBalance(page)).toMatchObject({credits:50});expect(click).not.toHaveBeenCalled();});
it('opens the menu when needed and reads the actual credits',async()=>{const {page,click}=fixture(false);expect(await readFlowBalance(page)).toMatchObject({credits:50});expect(click).toHaveBeenCalledOnce();});
it('refreshes cached credits before reading the provider balance',async()=>{
 const {page}=fixture(true);let credits=50;
 page.reload=vi.fn(async()=>{credits=30;return null;});
 const row={count:async()=>1,first(){return this;},waitFor:async()=>{},allTextContents:async()=>[`${credits} AI credits`]};
 page.getByText=(()=>({filter:()=>row})) as unknown as Page['getByText'];
 expect((await readFlowBalance(page)).credits).toBe(30);
 expect(page.reload).toHaveBeenCalledOnce();
});
