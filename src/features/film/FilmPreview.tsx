import FilmWorkspace from './FilmWorkspace';
import type {FilmRequest} from './filmClient';
const request:FilmRequest=async operation=>{
 if(operation==='session')return {wallet:{balanceMicroUSD:0,expiresAt:null,reservedMicroUSD:0,activeRentalId:null,lots:[]},servers:[],enabled:false,planningEnabled:false,capabilities:{referenceUpload:false}};
 if(operation==='projects.list')return [];
 throw Error('معاينة تصميم محلية فقط؛ لا حساب مربوط أو تشغيل GPU.');
};
export function FilmPreview(){return <section data-subscription-exempt><FilmWorkspace request={request} preview/></section>;}
