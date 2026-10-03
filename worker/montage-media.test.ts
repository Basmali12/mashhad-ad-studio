import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {tools,command,alpha,probe,decode,subtitles,wrapped} from './montage-media';
import type {EditSettings} from '../shared/editing';
it('checks actual alpha pixels, output codecs, decoding and Arabic text files without generation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mashhad-montage-'));
 try{
  const pixels=Buffer.alloc(4*16*16,255);pixels[3]=0;await writeFile(join(dir,'pixels.rgba'),pixels);
  await command(tools.ffmpeg,['-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','16x16','-i','pixels.rgba','-frames:v','1','alpha.png'],dir);expect((await alpha(join(dir,'alpha.png'))).valid).toBe(true);
  await command(tools.ffmpeg,['-v','error','-y','-i','alpha.png','-vf','format=rgb24','-frames:v','1','opaque.png'],dir);expect((await alpha(join(dir,'opaque.png'))).valid).toBe(false);
  await command(tools.ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=navy:s=360x640:r=30','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','fixture.mp4'],dir);const m=await probe(join(dir,'fixture.mp4'));expect(m.width).toBe(360);expect(m.height).toBe(640);expect(m.duration).toBe(1);expect(m.audio).toBe(false);await decode(join(dir,'fixture.mp4'));
  const settings:EditSettings={clips:[{storageId:'fixture',start:0,end:1}],duration:1,transition:0,fit:'contain',width:720,logo:{enabled:false,position:'top-right',size:18,start:0,end:1},text:{name:true,address:true,phone:true,position:'bottom',color:'#ffffff',background:'#171523'}};
  await subtitles(join(dir,'titles.ass'),settings,{name:'قهوة بغداد',address:'بغداد الكرادة',phone:'07700000000'});const ass=await readFile(join(dir,'titles.ass'),'utf8');expect(ass).toContain('\u200fقهوة بغداد');expect(ass).toContain('\u200e07700000000');expect(wrapped('نص {\\pos(1,1)}')).not.toContain('{');expect(()=>wrapped('x'.repeat(100))).toThrow('طويلة');
 }finally{await rm(dir,{recursive:true,force:true});}
},20000);
