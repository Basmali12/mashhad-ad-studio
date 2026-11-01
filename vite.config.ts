import {backgroundRemovalSecurity} from './scripts/background-removal-security';
import {choosePublicChunks} from './shared/public-ui-warmup';
import { defineConfig,loadEnv } from 'vite';
import {readFileSync} from 'node:fs';
import {publishingPlugin} from './scripts/publishing-server';
const release=JSON.parse(readFileSync(new URL('./public/version.json',import.meta.url),'utf8')).version as string;
export default defineConfig(({command,mode})=>{const env=loadEnv(mode,process.cwd(),'');const version=command==='serve'?release:`${release}-${Date.now()}`;return {base:'./',define:{__APP_VERSION__:JSON.stringify(version)},plugins:[backgroundRemovalSecurity(),publishingPlugin(env.PUBLISHING_LOCAL_SAAS==='true'),{name:'mashhad-version',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/version.json'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version}));return}next()})},generateBundle(_options,bundle){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({version})});const files=Object.values(bundle).map(f=>({fileName:f.fileName,bytes:f.type==='chunk'?new TextEncoder().encode(f.code).byteLength:typeof f.source==='string'?new TextEncoder().encode(f.source).byteLength:f.source.byteLength}));this.emitFile({type:'asset',fileName:'ui-warmup.json',source:JSON.stringify({version,assets:choosePublicChunks(files)})});}}], build: { rollupOptions: { output: { manualChunks(id) {
  if(id.includes('node_modules/@clerk/localizations')) return 'auth-arabic';
  if(id.includes('node_modules/@clerk/')) return 'auth';
  if(id.includes('node_modules/convex/')) return 'convex';
} } } } }});
