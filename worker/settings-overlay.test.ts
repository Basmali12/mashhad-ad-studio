import {it,expect,vi} from 'vitest';
import type {Page} from 'playwright';
vi.mock('./browser',()=>({workspace:vi.fn(),screenshot:vi.fn()}));
vi.mock('./runtime',()=>({sleep:vi.fn(),persist:vi.fn()}));
import {openSettings} from './flow';
it('dismisses the leftover menu backdrop before clicking the settings trigger',async()=>{
 let covered=true,open=false;
 const dismiss=vi.fn(async()=>{covered=false;});
 const control={count:async()=>1,click:vi.fn(async()=>{if(covered)throw Error('intercepted');open=true;})};
 const video={isVisible:async()=>open,waitFor:vi.fn()};
 const backdrop={count:async()=>covered?1:0,isVisible:async()=>covered,click:dismiss,filter:()=>backdrop,last:()=>backdrop};
 const page={getByRole:(role:string)=>role==='button'?control:{filter:()=>video},locator:()=>backdrop,keyboard:{press:vi.fn()}} as unknown as Page;
 await openSettings(page);
 expect(dismiss).toHaveBeenCalledOnce();expect(control.click).toHaveBeenCalledOnce();expect(open).toBe(true);
});
