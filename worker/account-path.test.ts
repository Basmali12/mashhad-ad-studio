import {describe,it,expect,vi} from 'vitest';
import type {Page} from 'playwright';
import {workspace} from './browser';
import {readFlowBalance} from './flow-balance';

describe('Flow account-scoped project routes',()=>{
 it.each(['/project/abc-123','/u/0/project/abc-123','/u/2/project/abc-123'])('accepts the real workspace at %s',async path=>{
  const prompt={first(){return this},waitFor:vi.fn(),count:async()=>1};
  const page={url:()=>`https://flow.google.com${path}`,getByText:()=>({all:async()=>[]}),locator:(selector:string)=>selector==='body'?{innerText:async()=>''}:prompt} as unknown as Page;
  expect(await workspace(page)).toBe(prompt);
 });
 it.each(['https://flow.google.com.evil.test/u/0/project/abc','https://flow.google.com/u/evil/project/abc','https://flow.google.com/u/0/'])('rejects a non-workspace %s',async url=>{
  await expect(workspace({url:()=>url} as Page)).rejects.toThrow('LOGIN_REQUIRED');
 });
 it('preserves the Google account selector when reading balance from an editor',async()=>{
  const goto=vi.fn();const row={count:async()=>1,first(){return this},waitFor:async()=>{},allTextContents:async()=>['50 وحدة من الرصيد في Google Flow']};
  const page={url:()=> 'https://flow.google.com/u/2/project/abc-123/edit/clip-1',goto,getByRole:(role:string)=>role==='button'?{click:async()=>{}}:{locator:()=>({filter:()=>({count:async()=>0})})},getByText:()=>({filter:()=>row}),keyboard:{press:async()=>{}}} as unknown as Page;
  expect((await readFlowBalance(page)).credits).toBe(50);
  expect(goto).toHaveBeenCalledWith('https://flow.google.com/u/2/project/abc-123',{waitUntil:'domcontentloaded',timeout:20000});
 });
});
