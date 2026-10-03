import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import { validateFile,validateSignature } from '../shared/validation';
const exec=promisify(execFile);
export async function probe(path:string){
 const bytes=await readFile(path);validateFile('video/mp4',bytes.length,'video');validateSignature(bytes.subarray(0,32),'video/mp4');
 const executable=process.env.MASHHAD_FFMPEG_PATH??ffmpeg;if(!executable)throw new Error('FFmpeg unavailable. Run npm install --prefix worker.');
 let output:string;try{const result=await exec(executable,['-v','info','-i',path,'-map','0:v:0','-f','null','-'],{maxBuffer:2*1024*1024,timeout:120000});output=result.stderr;}catch{throw new Error('VIDEO_INVALID: FFmpeg could not decode this MP4.');}
 const duration=output.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/),dimensions=output.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);if(!duration||!dimensions)throw new Error('VIDEO_INVALID: metadata missing');
 return {size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),duration:Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]),width:Number(dimensions[1]),height:Number(dimensions[2])};
}
