import {createServer} from 'node:http';
import {storageHandler,storageSettings} from '../worker/reels-storage';
if(process.env.REELS_STORAGE_START!=='true')throw Error('Storage service disabled');
const server=createServer(storageHandler(storageSettings(process.env)));server.requestTimeout=900000;server.headersTimeout=30000;server.listen(43452,'127.0.0.1',()=>console.log('Reels storage HTTPS upstream ready'));
