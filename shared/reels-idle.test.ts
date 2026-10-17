import {it,expect} from 'vitest';import {queueIdleDelay} from './reels-idle';
it('backs off idle queue reads to one minute and returns to ten seconds when work is found',()=>{expect(queueIdleDelay(1,false)).toBe(20000);expect(queueIdleDelay(20,false)).toBe(60000);expect(queueIdleDelay(20,true)).toBe(10000);});
