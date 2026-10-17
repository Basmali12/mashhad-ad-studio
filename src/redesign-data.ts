import type {EpisodePolicy} from './redesign-director';
import type {EndingVideo} from './legacy-media-types';
import type {SeriesPlace,SceneSnapshot} from './redesign-continuity';
import type {VisualRequest} from './redesign-visual';
import type {VideoRequest} from './legacy-media-types';
import type {PublishSchedule,PublishTask,LibraryVideo} from './features/scheduler/schedule-model';
export interface SeriesCharacter {id:string;name:string;description?:string;image:File;updatedAt:number}
export interface SeriesModel {model:string;actualModel:string;seconds:number;resolution:string;cost:number;observedAt:number}
export interface SeriesMessage {id:string;role:'user'|'assistant';text:string;createdAt:number;replyTo?:string;model?:string;image?:File;imageApproved?:boolean;imageDetails?:{kind:'scene'|'character';name:string;description:string}}
export interface SeriesTicket {story:string;episodes:{id:string;summary:string;durationSeconds:number;completed:boolean;sceneIds?:string[]}[];activeEpisodeId?:string}
export interface SeriesProject {id:string;name:string;kind?:'conversation'|'library';updatedAt?:number;characters:SeriesCharacter[];publishSchedule?:PublishSchedule;publishTasks?:PublishTask[];libraryVideos?:LibraryVideo[];model?:SeriesModel;messages?:SeriesMessage[];instructions?:string;places?:SeriesPlace[];sceneHistory?:SceneSnapshot[];visualRequests?:VisualRequest[];videoRequests?:VideoRequest[];aiMemory?:string;ticket?:SeriesTicket;episodePolicy?:EpisodePolicy;endingVideo?:EndingVideo;sceneImages?:(SeriesCharacter & {description:string})[]}
export function newConversation():SeriesProject{return {id:crypto.randomUUID(),kind:'conversation',name:'محادثة جديدة',characters:[],messages:[]};}
export function conversationTitle(p:SeriesProject){return p.kind==='conversation'?(p.messages?.find(m=>m.role==='user')?.text.trim().slice(0,55)||'مناقشة صورة'):p.name;}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('mashhad-redesign',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function loadSeriesProjects(){const db=await database();try{return await new Promise<SeriesProject[]>((resolve,reject)=>{const tx=db.transaction('projects','readonly'),r=tx.objectStore('projects').getAll();tx.oncomplete=()=>resolve(r.result as SeriesProject[]);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export async function saveSeriesProject(project:SeriesProject){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(project);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export async function deleteSeriesProject(id:string){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}






