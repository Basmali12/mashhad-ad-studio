import {it,expect,vi} from 'vitest';
import {removeCharacterBackground} from './redesign-visual';
import {removeBackground} from '@imgly/background-removal';
vi.mock('@imgly/background-removal',()=>({removeBackground:vi.fn()}));
it('keeps CPU PNG removal and transparency verification through the existing character operation',async()=>{
 const bytes=new Uint8ClampedArray(20*20*4);for(let n=0;n<200;n++)bytes[n*4+3]=255;
 const close=vi.fn();const bitmap={width:20,height:20,close};
 vi.mocked(removeBackground).mockResolvedValue(new Blob(['png-result'],{type:'image/png'}));
 vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue(bitmap));
 vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:bytes})})})});
 try{
  const input=new File(['source'],'character.jpg',{type:'image/jpeg'});
  const result=await removeCharacterBackground(input);
  expect(result.type).toBe('image/png');expect(result.size).toBe(10);expect(close).toHaveBeenCalledOnce();
  expect(removeBackground).toHaveBeenCalledWith(input,{device:'cpu',model:'isnet_quint8',output:{format:'image/png'},proxyToWorker:false});
 }finally{vi.unstubAllGlobals();}
});
