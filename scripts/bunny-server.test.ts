import {it,expect} from 'vitest';
import type {IncomingMessage} from 'node:http';
import {localMediaRequest} from './bunny-preview-server';
import {mediaSignature} from './bunny-upload-server';
it('denies non-loopback clients, hostile hosts, origins and cross-site previews',()=>{
 const req={headers:{host:'127.0.0.1:43130',origin:'http://127.0.0.1:43130','sec-fetch-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'}} as unknown as IncomingMessage;
 expect(localMediaRequest(req,'127.0.0.1:43130')).toBe(true);
 for(const patch of [{host:'attacker.example'},{origin:'https://attacker.example'},{'sec-fetch-site':'cross-site'}])expect(localMediaRequest({...req,headers:{...req.headers,...patch}} as IncomingMessage,'127.0.0.1:43130')).toBe(false);
 expect(localMediaRequest({...req,socket:{remoteAddress:'192.168.1.10'}} as IncomingMessage,'127.0.0.1:43130')).toBe(false);
});
it('checks media bytes independently of filename or declared MIME',()=>{
 const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]);expect(mediaSignature('video/mp4',mp4)).toBe(true);expect(mediaSignature('image/jpeg',mp4)).toBe(false);expect(mediaSignature('video/mp4',Buffer.from('<html>not a video'))).toBe(false);
 expect(mediaSignature('image/png',Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);expect(mediaSignature('image/jpeg',Buffer.from([255,216,255]))).toBe(true);
});
