import {it,expect} from 'vitest';
import {assertReelDuration} from './reels-video';
it('allows up to 180 seconds inclusive and rejects longer or unreadable duration',()=>{
 for(const seconds of [.01,60,179.99,180])expect(assertReelDuration(seconds)).toBe(seconds);
 for(const seconds of [180.001,181,0,-1,NaN,Infinity])expect(()=>assertReelDuration(seconds)).toThrow();
});
