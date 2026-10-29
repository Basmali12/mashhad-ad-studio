import {createServer} from 'node:http';
import {createFilmGateway} from './gateway.mjs';
if(process.env.MASHHAD_FILM_GATEWAY_START!=='YES')throw Error('FILM_GATEWAY_START_NOT_APPROVED');
const port=Number(process.env.MASHHAD_FILM_PORT||3480);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');
const server=createServer(createFilmGateway());server.requestTimeout=45000;server.headersTimeout=10000;
server.listen(port,'127.0.0.1',()=>console.log('Mashhad film gateway ready on loopback; no GPU started'));
