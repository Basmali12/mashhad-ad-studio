import {defineConfig} from 'vite';
// Dedicated local view: no project env files or publishing/server plugins.
export default defineConfig({envDir:false,server:{host:'127.0.0.1',port:43148,strictPort:true},define:{__APP_VERSION__:JSON.stringify('معاينة محلية')},plugins:[{name:'local-preview-entry',configureServer(server){server.middlewares.use((req,_res,next)=>{if(req.url?.split('?')[0]==='/')req.url='/preview.html';next();});}}]});
