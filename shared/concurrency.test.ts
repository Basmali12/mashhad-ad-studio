import {it,expect} from 'vitest';
import {flowConcurrency,SerialStage} from './concurrency';
it('requires an explicit rollout setting for two lanes and rejects unverified scaling',()=>{expect(flowConcurrency(undefined)).toBe(1);expect(flowConcurrency('2')).toBe(2);for(const s of ['0','3','5','7','NaN'])expect(()=>flowConcurrency(s)).toThrow();});
it('serializes montage while independent generation lanes may continue',async()=>{const stage=new SerialStage(),release=await stage.enter();let entered=false;const waiting=stage.enter().then(unlock=>{entered=true;unlock();});await Promise.resolve();expect(entered).toBe(false);release();await waiting;expect(entered).toBe(true);});
