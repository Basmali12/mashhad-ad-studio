import {backgroundRemovalSecurity} from './scripts/background-removal-security';
import {defineConfig} from 'vite';
import fs from 'node:fs';
const localSample={name:'local-film-sample',configureServer(server:import('vite').ViteDevServer){server.middlewares.use((req,res,next)=>{
 if(req.url?.split('?')[0]!=='/__local-film-sample.mp4')return next();
 const file=process.env.MASHHAD_PREVIEW_VIDEO;if(!file||!['GET','HEAD'].includes(req.method||'')){res.statusCode=404;res.end();return;}
 void fs.promises.stat(file).then(stat=>{
  if(!stat.isFile())throw Error();let start=0,end=stat.size-1;
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.statusCode=416;res.end();return;}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(start>end||start>=stat.size){res.statusCode=416;res.end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);}
  res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);res.setHeader('Cache-Control','no-store');if(req.method==='HEAD'){res.end();return;}const stream=fs.createReadStream(file,{start,end});res.once('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
 }).catch(()=>{res.statusCode=404;res.end();});
 });}};
// Dedicated local view: no project env files or publishing/server plugins.
export default defineConfig({envDir:false,server:{host:'127.0.0.1',port:43148,strictPort:true},define:{__APP_VERSION__:JSON.stringify('معاينة محلية')},plugins:[backgroundRemovalSecurity(),localSample,{name:'local-preview-entry',configureServer(server){server.middlewares.use((req,_res,next)=>{if(req.url?.split('?')[0]==='/')req.url='/preview.html';next();});}}]});
