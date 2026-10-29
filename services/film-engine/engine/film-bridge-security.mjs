import {createHmac,timingSafeEqual} from 'node:crypto';
export const signBridge=(secret,timestamp,nonce,body)=>createHmac('sha256',secret).update(timestamp+'\n'+nonce+'\n'+body).digest('hex');
export function verifyBridge(secret,headers,body,now=Date.now()){
 const time=headers['x-film-time'],nonce=headers['x-film-nonce'],signature=headers['x-film-signature'];
 if(!secret||secret.length<32||!/^\d{13}$/.test(time||'')||Math.abs(now-Number(time))>60000||!/^[-a-zA-Z0-9]{20,80}$/.test(nonce||'')||! /^[a-f0-9]{64}$/.test(signature||''))throw Error('BRIDGE_UNAUTHORIZED');
 const expected=signBridge(secret,time,nonce,body);if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error('BRIDGE_UNAUTHORIZED');return nonce;
}
export const mediaSignature=(secret,id,expires)=>createHmac('sha256',secret).update('film-media\n'+id+'\n'+expires).digest('hex');
export function validMediaSignature(secret,id,expires,signature,now=Date.now()){
 if(!/^\d{13}$/.test(String(expires))||Number(expires)<now||Number(expires)>now+300000||! /^[a-f0-9]{64}$/.test(signature||''))return false;
 return timingSafeEqual(Buffer.from(signature),Buffer.from(mediaSignature(secret,id,expires)));
}
