import {spawn} from 'node:child_process';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {editDimensions,type EditSettings} from '../shared/editing';
export const tools={ffmpeg:ffmpeg!,ffprobe:ffprobe.path};
export async function command(exe:string,args:string[],cwd?:string,progress?:(seconds:number)=>void,signal?:AbortSignal):Promise<Buffer>{
 return new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd,windowsHide:true,signal}),out:Buffer[]=[];let error='',pending='';p.stdout.on('data',(b:Buffer)=>{if(progress){pending+=b.toString();let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at).trim();pending=pending.slice(at+1);if(line.startsWith('out_time_us='))progress(Number(line.split('=')[1])/1e6);}}else out.push(b);});p.stderr.on('data',b=>{error=(error+b.toString()).slice(-6000)});p.on('error',reject);p.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(`Media command failed (${code}): ${error.replace(/https?:\/\/\S+/g,'[URL]').slice(-1800)}`)));});
}
export async function probe(path:string){
 const data=JSON.parse((await command(tools.ffprobe,['-v','error','-show_streams','-show_format','-of','json',path])).toString()) as {streams:{codec_type:string;codec_name:string;width?:number;height?:number;pix_fmt?:string}[];format:{duration?:string}};
 const v=data.streams.find(s=>s.codec_type==='video');if(!v?.width||!v.height)throw new Error('لا يوجد مسار فيديو صالح.');
 return {duration:Number(data.format.duration??0),width:v.width,height:v.height,size:(await stat(path)).size,audio:data.streams.some(s=>s.codec_type==='audio'),codec:v.codec_name,pixelFormat:v.pix_fmt??'',audioCodec:data.streams.find(s=>s.codec_type==='audio')?.codec_name};
}
export async function decode(path:string,signal?:AbortSignal){await command(tools.ffmpeg,['-v','error','-i',path,'-f','null','-'],undefined,undefined,signal);}
export async function hashFile(path:string){return createHash('sha256').update(await readFile(path)).digest('hex');}
export async function alpha(path:string){const m=await probe(path);if(m.width*m.height>4096*4096)throw new Error('الشعار كبير جدًا؛ استخدم نسخة لا تتجاوز 4096×4096.');const channel=/a|rgba|bgra/.test(m.pixelFormat)&&!['gray','gray16le'].includes(m.pixelFormat);const raw=await command(tools.ffmpeg,['-v','error','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1']);let transparent=0;for(let i=3;i<raw.length;i+=4)if(raw[i]<255)transparent++;return {channel,transparent,pixels:m.width*m.height,valid:channel&&transparent>0};}
const escape=(s:string)=>s.replace(/[\\{}]/g,'').replace(/[\r\n]+/g,' ').replace(/[\u202a-\u202e\u2066-\u2069]/g,'');
export function wrapped(s:string,max=34){const lines:string[]=[];let line='';for(const word of escape(s).split(/\s+/)){if(word.length>max)throw new Error('النص يحتوي كلمة طويلة جدًا؛ أضف مسافات أو اختصره.');if((line+' '+word).trim().length>max){lines.push(line);line=word;}else line=(line+' '+word).trim();}if(line)lines.push(line);return lines;}
export async function subtitles(path:string,s:EditSettings,texts:{name:string;address:string;phone:string}){
 const lines=[...(s.text.name?wrapped(texts.name).map(l=>'\u200f'+l):[]),...(s.text.address?wrapped(texts.address).map(l=>'\u200f'+l):[]),...(s.text.phone?wrapped(texts.phone).map(l=>'\u200e'+l):[])];if(lines.length>6)throw new Error('النص يتجاوز ستة أسطر؛ اختصر العنوان أو عطّل بعض الحقول.');
 const color=(c:string)=>'&H00'+c.slice(5,7)+c.slice(3,5)+c.slice(1,3);const {width:w,height:h}=editDimensions(s),margin=Math.round(s.width*.075),font=Math.round(s.width*.046);
 const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[ V4+ Styles ]\n`.replace('[ V4+ Styles ]','[V4+ Styles]')+`Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Main,Arial,${font},${color(s.text.color)},${color(s.text.color)},${color(s.text.background)},${color(s.text.background)},0,0,0,0,100,100,0,0,3,8,0,${s.text.position==='top'?8:2},${margin},${margin},${margin},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:03:00.00,Main,,0,0,0,,${lines.join('\\N')}\n`;
 await writeFile(path,ass,'utf8');return lines;
}
