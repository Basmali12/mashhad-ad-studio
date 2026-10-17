import {afterEach,expect,it,vi} from 'vitest';
import {withPersonalFlow,withCustomerFlow,personalFlowEndpoint,withInspectionFlow} from './personal-flow';
afterEach(()=>vi.unstubAllEnvs());
it('inspects the owner browser in personal studio mode without changing explicit job routing',async()=>{
 vi.stubEnv('MASHHAD_OWNER_ONLY','true');vi.stubEnv('OWNER_FLOW_ENDPOINT','http://127.0.0.1:9432');
 expect(await withInspectionFlow(async()=>personalFlowEndpoint())).toBe('http://127.0.0.1:9432');
 expect(await withPersonalFlow(false,async()=>personalFlowEndpoint())).toBeUndefined();
 vi.stubEnv('MASHHAD_OWNER_ONLY','false');expect(await withInspectionFlow(async()=>personalFlowEndpoint())).toBeUndefined();
});
it('isolates simultaneous owner and customer jobs and refuses fallback for a missing owner browser',async()=>{
 vi.stubEnv('OWNER_FLOW_ENDPOINT','http://127.0.0.1:9432');const results=await Promise.all([withPersonalFlow(true,async()=>{await Promise.resolve();return personalFlowEndpoint();}),withPersonalFlow(false,async()=>{await Promise.resolve();return personalFlowEndpoint();})]);expect(results).toEqual(['http://127.0.0.1:9432',undefined]);expect(personalFlowEndpoint()).toBeUndefined();vi.stubEnv('OWNER_FLOW_ENDPOINT','');await expect(withPersonalFlow(true,async()=>personalFlowEndpoint())).rejects.toThrow('لا نستخدم حساب المنصة');
});

it('customer routing rejects foreign endpoints and expired leases',async()=>{let valid=true;await withCustomerFlow('http://127.0.0.1:9433',async()=>{expect(personalFlowEndpoint()).toBe('http://127.0.0.1:9433');valid=false;expect(()=>personalFlowEndpoint()).toThrow('انتهى');},()=>valid);expect(()=>withCustomerFlow('http://127.0.0.1:9432',async()=>undefined)).toThrow('Invalid');expect(personalFlowEndpoint()).toBeUndefined();});
