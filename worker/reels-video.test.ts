import {it,expect} from 'vitest';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {reelProbeDuration,probeReelFile,probeBannerImage} from './reels-video';
it('checks the container plus every video/audio stream and rejects unknown metadata',()=>{
 expect(reelProbeDuration({format:{duration:'180'},streams:[{codec_type:'video',duration:'180'}]})).toBe(180);
 for(const probe of [null,{}, {format:{duration:'10'},streams:[]},{format:{duration:'180'},streams:[{codec_type:'video',duration:'181'}]},{format:{duration:'10'},streams:[{codec_type:'video',duration:'10'},{codec_type:'audio',duration:'181'}]},{format:{duration:'N/A'},streams:[{codec_type:'video',duration:'10'}]}])expect(()=>reelProbeDuration(probe)).toThrow();
});
it('uses real FFprobe on local 180s and 180.25s MP4s and rejects a renamed invalid file',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'reels-duration-'));try{
 for(const seconds of [180,180.25]){const path=join(directory,seconds+'.mp4');await promisify(execFile)(ffmpeg!,['-v','error','-f','lavfi','-i','color=c=black:s=16x16:r=4','-t',String(seconds),'-c:v','libx264','-pix_fmt','yuv420p',path],{timeout:15000,windowsHide:true});
 if(seconds===180)await expect(probeReelFile(path,ffprobe.path)).resolves.toBe(180);else await expect(probeReelFile(path,ffprobe.path)).rejects.toThrow('3 دقائق');}
 const invalid=join(directory,'invalid.mp4');await writeFile(invalid,Buffer.from([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8]));await expect(probeReelFile(invalid,ffprobe.path)).rejects.toThrow('تعذر');
 await expect(probeReelFile(invalid,join(directory,'missing-ffprobe'))).rejects.toThrow('تعذر');
 }finally{await rm(directory,{recursive:true,force:true});}
},30000);

it('probes actual banner images and rejects portrait or unsupported animated formats',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'banner-probe-'));try{
 for(const [name,size,accepted] of [['wide.png','160x50',true],['portrait.png','50x160',false],['animated.gif','160x50',false]] as const){const path=join(directory,name);await promisify(execFile)(ffmpeg!,['-v','error','-f','lavfi','-i','color=c=black:s='+size,'-frames:v','1',path],{timeout:15000,windowsHide:true});if(accepted)await expect(probeBannerImage(path,ffprobe.path)).resolves.toBeUndefined();else await expect(probeBannerImage(path,ffprobe.path)).rejects.toThrow();}
 }finally{await rm(directory,{recursive:true,force:true});}
},30000);
