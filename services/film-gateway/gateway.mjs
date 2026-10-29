import {requestFilm} from './film-bridge.mjs';
import {providerFetch,withNetwork} from './network.mjs';
import {FILM_OPERATIONS} from '../../shared/film-contracts.ts';
const operations=new Set(FILM_OPERATIONS),limit=262144;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(value));};
class Rejection extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const deny=(condition,code,status)=>{if(!condition)throw new Rejection(code,status);};
export function gatewaySettings(env){
 const origin=new URL(env.MASHHAD_FILM_ORIGIN||'https://unconfigured.invalid');
 deny(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'INVALID_ORIGIN',503);
 const convex=new URL(env.MASHHAD_CONVEX_URL||'https://unconfigured.invalid');
 deny(/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(convex.origin)&&convex.href===convex.origin+'/','INVALID_MEMBERSHIP_ORIGIN',503);
 if(env.MASHHAD_FILM_LEGACY_OWNER_ID)deny(id(env.MASHHAD_FILM_LEGACY_OWNER_ID),'INVALID_OWNER_MAPPING',503);
 const ownerEmail=env.MASHHAD_FILM_LEGACY_OWNER_EMAIL||'';deny(!ownerEmail||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)&&ownerEmail.length<=254,'INVALID_OWNER_MAPPING',503);
 return {origin:origin.origin,convex:convex.origin,enabled:env.MASHHAD_FILM_ENABLED==='YES',legacyOwner:env.MASHHAD_FILM_LEGACY_OWNER_ID||null,ownerEmail};
}
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;deny(size<=limit,'REQUEST_TOO_LARGE',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Rejection('INVALID_INPUT',400);}}
async function actorFromMembership(token,config){
 let value;
 try{
  const response=await providerFetch(config.convex+'/api/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({path:'publishingUsers:profile',args:{},format:'json'}),signal:AbortSignal.timeout(10000)});
  const text=await response.text();deny(text.length<=16384,'AUTH_UNAVAILABLE',503);
  const data=JSON.parse(text);deny(response.ok&&data.status==='success'&&object(data.value),'UNAUTHENTICATED',401);value=data.value;
 }catch(error){if(error instanceof Rejection)throw error;throw new Rejection('AUTH_UNAVAILABLE',503);}
 deny(id(value.id)&&typeof value.subject==='string'&&value.subject.length<=256&&typeof value.name==='string'&&['customer','super-admin'].includes(value.role),'UNAUTHENTICATED',401);
 const isAdmin=value.role==='super-admin';
 // Convex's existing profile query checks the signed issuer, membership/ban and
 // OWNER_SUBJECT. A client cannot supply this role or select the old owner ID.
 return {id:isAdmin&&config.legacyOwner?config.legacyOwner:'mashhad-'+value.id,name:value.name.slice(0,120),email:isAdmin&&config.legacyOwner?config.ownerEmail:'',isAdmin};
}
export function createFilmGateway({env=process.env,fetchImpl}={}){
 const config=gatewaySettings(env);let inFlight=0;
 return async(req,res)=>{
  const route=req.url?.split('?')[0];
  if(route==='/health'&&req.method==='GET')return reply(res,200,{status:'ok'});
  if(!['/api/mashhad-film','/api/mashhad-film/access'].includes(route))return reply(res,404,{error:'NOT_FOUND'});
  try{
   deny(req.method==='POST','METHOD_NOT_ALLOWED',405);
   deny(req.headers.origin===config.origin,'ORIGIN_DENIED',403);
   deny(req.headers['content-type']?.split(';')[0].trim()==='application/json','INVALID_CONTENT_TYPE',415);
   deny(config.enabled,'FILM_NOT_CONFIGURED',503);
   const authorization=req.headers.authorization;
   deny(typeof authorization==='string'&&/^Bearer [A-Za-z0-9._~-]{8,8192}$/.test(authorization),'UNAUTHENTICATED',401);
   deny(inFlight<16,'BUSY',429);inFlight++;
   try{await withNetwork({fetchImpl},async()=>{
    const input=await body(req);deny(object(input),'INVALID_INPUT',400);
    if(route.endsWith('/access'))deny(Object.keys(input).length===0,'INVALID_INPUT',400);
    else deny(Object.keys(input).every(k=>['operation','input','requestId'].includes(k))&&operations.has(input.operation)&&id(input.requestId)&&object(input.input),'INVALID_INPUT',400);
    const actor=await actorFromMembership(authorization.slice(7),config);
    if(route.endsWith('/access'))return reply(res,200,{id:actor.id,isAdmin:actor.isAdmin});
    deny(!input.operation.startsWith('admin.')||actor.isAdmin,'FORBIDDEN',403);
    // One attempt only. Preserve request IDs and backend uncertainty semantics.
    const result=await requestFilm(actor,input,env);
    return reply(res,result?.error==='INVALID_INPUT'?400:200,result);
   });}finally{inFlight--;}
  }catch(error){
   const known=error instanceof Rejection;
   if(!res.headersSent)reply(res,known?error.status:503,{error:known?error.code:'SERVICE_UNAVAILABLE',message:'تعذر إتمام الطلب بأمان. لم تُعَد المحاولة تلقائياً.'});
  }
 };
}
