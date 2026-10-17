import {it,expect,vi} from 'vitest';
import type {Page} from 'playwright';
import {screenshot} from './browser';
it('bounds screenshot capture without creating a second CDP session that can hang detach',async()=>{
 const capture=vi.fn().mockResolvedValue(Buffer.from('image'));
 const page={url:()=> 'https://flow.google.com/project/example',screenshot:capture} as unknown as Page;
 await screenshot(page,'options-before-generation.jpg');
 expect(capture).toHaveBeenCalledWith(expect.objectContaining({type:'jpeg',timeout:10000}));
});
