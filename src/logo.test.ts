import {describe,it,expect} from 'vitest';
import {clearLogoBackground} from './logo';
function fixture(background:number){const data=new Uint8ClampedArray(20*20*4);for(let p=0;p<400;p++)data.set([background,background,background,255],p*4);for(let y=4;y<16;y++)for(let x=4;x<16;x++)data.set([120,50,220,255],(y*20+x)*4);data.set([255,255,255,255],(10*20+10)*4);return data;}
describe('logo background',()=>{
 for(const color of [255,0])it(`removes edge ${color} but preserves enclosed white`,()=>{const data=fixture(color);expect(clearLogoBackground(data,20,20)).toEqual({changed:true,transparent:true});expect(data[3]).toBe(0);expect(Array.from(data.slice(840,844))).toEqual([255,255,255,255]);expect(data[(5*20+5)*4+3]).toBe(255);});
 it('keeps a transparent image unchanged',()=>{const data=fixture(255);data[3]=0;const before=data.slice();expect(clearLogoBackground(data,20,20).changed).toBe(false);expect(data).toEqual(before);});
 it('refuses inconsistent borders without modifying pixels',()=>{const data=fixture(255);for(let x=0;x<20;x++)data.set([x*10,30,90,255],x*4);const before=data.slice();expect(clearLogoBackground(data,20,20).transparent).toBe(false);expect(data).toEqual(before);});
 it('does not erase a plain white image',()=>{const data=new Uint8ClampedArray(400*4).fill(255);expect(clearLogoBackground(data,20,20).transparent).toBe(false);expect(data[3]).toBe(255);});
});
