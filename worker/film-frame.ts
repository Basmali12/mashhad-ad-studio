import {stat} from 'node:fs/promises';
import {command,tools} from './montage-media';
// Decode and reverse the final second: a 24fps clip has no frame at 8-1/30.
// This selects its actual last frame before the requested cut, without guessing fps.
export async function filmEndFrame(source:string,end:number,output:string,filter?:string,signal?:AbortSignal){
 if(!Number.isFinite(end)||end<=0)throw new Error('Invalid frame boundary');
 const start=Math.max(0,end-1),window=end-start;
 await command(tools.ffmpeg,['-v','error','-ss',String(start),'-i',source,'-vf',`trim=duration=${window},reverse${filter?','+filter:''}`,'-frames:v','1','-q:v','7','-y',output],undefined,undefined,signal);
 if(!(await stat(output)).size)throw new Error('End frame extraction failed');
}
