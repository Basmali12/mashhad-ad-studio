import type {PublishingCollection} from '../library/collection-store';
import {libraryOperation,uploadLibraryFile} from './library-api';
import type {LibraryVideo} from '../scheduler/schedule-model';
import {validatePublishMetadata} from '../../../shared/library-publishing';
export async function prepareLibraryPublication(project:PublishingCollection,video:LibraryVideo,onCheckpoint:(p:PublishingCollection)=>Promise<void>){
 const task=project.publishTasks?.find(t=>t.id===video.taskId);if(!task?.automaticPublishing||!task.targets?.length)return project;
 let current=project,item=video;
 async function save(patch:Partial<LibraryVideo>){item={...item,...patch};current={...current,libraryVideos:current.libraryVideos?.map(v=>v.id===item.id?item:v)};await onCheckpoint(current);}
 try{const key=project.id+':'+video.id,old=await libraryOperation({op:'find',key});if(old&&old.status!=='cancelled'){await save({publicationId:old.id,metadata:old.metadata,publishingError:undefined});return current;}
 if(item.bunnyAssetId&&!item.storageId)throw Error('ملف Bunny محفوظ. تفعيل النشر الجديد ينتظر اختبار محرك الجدولة؛ لم يُرسل منشور.');
 if(!item.metadata||!item.metadataReviewed)throw Error('راجع حقول النشر واحفظها أولًا.');const metadata=validatePublishMetadata({...item.metadata,...task.audience});
 if(!item.storageId){const storageId=item.file?await uploadLibraryFile(item.file):item.legacySourceJobId?(await libraryOperation({op:'resolveVideo',jobId:item.legacySourceJobId})).storageId:null;if(!storageId)throw Error('ملف الفيديو غير متاح؛ أعد رفع الأصل.');await save({storageId});}
 const publicationId=await libraryOperation({op:'activate',key,projectId:project.id,videoId:video.id,taskId:task.id,storageId:item.storageId,dueAt:Date.parse(item.publishAt),metadata,targets:task.targets,confirmed:true});await save({publicationId,publishingError:undefined});
 }catch(e){await save({publishingError:(e as Error).message});}return current;
}
