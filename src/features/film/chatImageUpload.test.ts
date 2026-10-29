import {describe,it,expect,vi} from 'vitest';
import type {FilmProject} from '../../../shared/film-contracts';
import {uploadChatImage,validateChatImage} from './chatImageUpload';
const project={id:'p',reference:null} as FilmProject;
const file=new File([new Uint8Array(50)],'portrait.png',{type:'image/png'});
describe('chat image staging/upload',()=>{
 it('rejects unsupported or oversized files before network activity',()=>{expect(()=>validateChatImage(new File(['x'],'a.heic',{type:'image/heic'}))).toThrow('JPEG');expect(()=>validateChatImage(new File([new Uint8Array(4000001)],'a.png',{type:'image/png'}))).toThrow('4MB');});
 it('one successful PUT followed by ownership-scoped read keeps the image in the project',async()=>{const latest={...project,reference:{uploadedAt:1}};const call=vi.fn(async(op:string)=>op==='project.reference.ticket'?{url:'https://media.example/api/film-reference/one'}:latest);const upload=vi.fn(async()=>Response.json({saved:true}));expect(await uploadChatImage(file,project,call,upload)).toBe(latest);expect(upload).toHaveBeenCalledTimes(1);expect(call.mock.calls.map(c=>c[0])).toEqual(['project.reference.ticket','project.get']);});
 it('an interrupted response is reconciled without a second upload',async()=>{const latest={...project,reference:{uploadedAt:2}};const call=vi.fn(async(op:string)=>op==='project.reference.ticket'?{url:'https://media.example/api/film-reference/one'}:latest);const upload=vi.fn(async()=>{throw Error('connection lost');});expect(await uploadChatImage(file,project,call,upload)).toBe(latest);expect(upload).toHaveBeenCalledTimes(1);});
 it('definitive upload error stays Arabic and does not invoke chat or generation',async()=>{const call=vi.fn(async(op:string)=>op==='project.reference.ticket'?{url:'https://media.example/api/film-reference/one'}:project);const upload=vi.fn(async()=>Response.json({error:'REFERENCE_DIMENSIONS'},{status:400}));await expect(uploadChatImage(file,project,call,upload)).rejects.toThrow('4096');expect(upload).toHaveBeenCalledTimes(1);expect(call.mock.calls.map(c=>c[0])).not.toContain('chat.submit');});
});
