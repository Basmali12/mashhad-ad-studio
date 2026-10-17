import {it,expect} from 'vitest';
import {strongestFreeImageOption} from './free-image-model';
it('prefers free Pro, falls back only to free observed alternatives, and refuses paid or unknown models',()=>{
 const lite={model:'Nano Banana 2 Lite',aspect:'1:1',cost:0},pro={model:'Nano Banana Pro',aspect:'1:1',cost:0};
 expect(strongestFreeImageOption([lite,pro])).toEqual(pro);
 expect(strongestFreeImageOption([lite,{...pro,cost:1}])).toEqual(lite);
 expect(strongestFreeImageOption([{...pro,cost:1}])).toBeUndefined();
 expect(strongestFreeImageOption([{...pro,model:'unknown'}])).toBeUndefined();
});
