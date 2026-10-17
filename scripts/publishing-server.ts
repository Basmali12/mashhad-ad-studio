import type {Plugin} from 'vite';
import {libraryPublishingOperation} from './library-publishing-bridge';
import {seriesConnectionsOperation} from './series-connections-bridge';
import {bunnyPreviewRequest} from './bunny-preview-server';
import {bunnyUploadRequest} from './bunny-upload-server';
export function publishingPlugin(saas=false):Plugin{return {name:'private-publishing',apply:'serve',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const route=req.url?.split('?')[0];if(['/api/series-chat','/api/series-image','/api/series-video'].includes(route??'')){res.statusCode=410;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'خدمات التوليد والدردشة غير متاحة في منصة الريلز.'}));return;}
 const address=server.httpServer?.address(),host=typeof address==='object'&&address?`127.0.0.1:${address.port}`:'';
 if(await bunnyUploadRequest(req,res,host,saas)||await bunnyPreviewRequest(req,res,host,saas))return;if(!['/api/library-publishing','/api/series-connections'].includes(route??''))return next();
 if(saas){res.statusCode=410;res.end(JSON.stringify({error:'خدمات المالك غير متاحة في بيئة الزبائن.'}));return;}
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(req.headers.host!==host||req.headers.origin!==`http://${host}`||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.statusCode=403;res.end(JSON.stringify({error:'الخدمة متاحة من المعاينة المحلية فقط.'}));return;}
 if(req.method!=='POST'||req.headers['content-type']!=='application/json'){res.statusCode=405;res.end(JSON.stringify({error:'طلب غير صالح.'}));return;}
 try{const chunks:Buffer[]=[];let size=0;for await(const part of req){size+=part.length;if(size>65536)throw Error('حجم الطلب كبير.');chunks.push(part);}const data=JSON.parse(Buffer.concat(chunks).toString());const result=route==='/api/library-publishing'?await libraryPublishingOperation(data):await seriesConnectionsOperation(data);res.end(JSON.stringify(result));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:(e as Error).message}));}
 });}};}
