import {afterEach,expect,it,vi} from 'vitest';
const {connect}=vi.hoisted(()=>({connect:vi.fn().mockResolvedValue({connected:true})}));
vi.mock('playwright',()=>({chromium:{connectOverCDP:connect}}));
import {connectFlow} from './chrome-connection';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
it('uses the tested native owner connection with multiple tabs without querying their content',async()=>{
 vi.stubEnv('MASHHAD_OWNER_ONLY','true');const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify([{id:'flow',type:'page',url:'https://flow.google.com/project/owner'},{id:'other',type:'page',url:'https://chatgpt.com/'}])));vi.stubGlobal('fetch',fetch);
 await connectFlow('http://127.0.0.1:9432');expect(connect).toHaveBeenCalledWith('http://127.0.0.1:9432',{timeout:20000,noDefaults:true});expect(fetch).toHaveBeenCalledTimes(1);
});
