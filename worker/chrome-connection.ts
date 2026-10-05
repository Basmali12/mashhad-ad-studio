import {chromium,type ConnectOverCDPTransport} from 'playwright';
// Attach to one dedicated Flow tab. A suspended unrelated tab must not block
// initialization; other tabs keep running and are never read or closed.
export async function connectFlow(endpoint:string){
 const targets=await (await fetch(`${endpoint}/json/list`)).json() as {id:string;type:string;url:string}[];
 const pages=targets.filter(t=>t.type==='page'&&/^https:\/\/(?:flow\.google\.com|labs\.google)\//.test(t.url));
 const selected=pages.find(t=>new URL(t.url).pathname.includes('/project/'))??pages[0];
 if(!selected)throw new Error('LOGIN_REQUIRED: افتح Flow في Chrome المخصص ثم افتح مشروعًا.');
 // The dedicated VPS has one page. Use Playwright's native transport there;
 // selective attachment is needed only when unrelated pages could suspend it.
 if(targets.filter(t=>t.type==='page').length===1)return chromium.connectOverCDP(endpoint,{timeout:20000});
 const version=await (await fetch(`${endpoint}/json/version`)).json() as {webSocketDebuggerUrl:string};
 if(!version.webSocketDebuggerUrl.startsWith('ws://127.0.0.1:9431/'))throw new Error('Invalid local Chrome endpoint');
 const ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('Local Chrome connection failed'));});
 let ignoredId=1000000000;const ignoredSessions=new Set<string>();
 const transport:ConnectOverCDPTransport={send(message){ws.send(JSON.stringify(message));},close(){ws.close();}};
 ws.onmessage=e=>{
  const m=JSON.parse(String(e.data)) as {id?:number;sessionId?:string;method?:string;params?:{sessionId:string;waitingForDebugger?:boolean;targetInfo:{targetId:string;type:string}}};
  if(m.id&&m.id>=1000000000)return;
  if(m.method==='Target.attachedToTarget'&&!m.sessionId&&m.params?.targetInfo.type==='page'&&m.params.targetInfo.targetId!==selected.id){
   const sessionId=m.params.sessionId;ignoredSessions.add(sessionId);
   if(m.params.waitingForDebugger)ws.send(JSON.stringify({id:ignoredId++,sessionId,method:'Runtime.runIfWaitingForDebugger'}));
   ws.send(JSON.stringify({id:ignoredId++,method:'Target.detachFromTarget',params:{sessionId}}));return;
  }
  if(m.sessionId&&ignoredSessions.has(m.sessionId))return;transport.onmessage?.(m);
 };
 ws.onclose=()=>transport.onclose?.();
 try{return await chromium.connectOverCDP(transport,{timeout:20000});}catch(e){ws.close();throw e;}
}
