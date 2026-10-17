import 'fake-indexeddb/auto';
import {it,expect,vi} from 'vitest';
// This suite verifies local IndexedDB migration regardless of the selected app environment.
vi.mock('../../shared/api/publishing-session',()=>({publishingSaasMode:false}));
vi.mock('./collection-cloud',()=>({cloudCollections:vi.fn(()=>{throw Error('Unexpected cloud call in local migration');}),cloudSaveCollection:vi.fn(()=>{throw Error('Unexpected cloud save in local migration');})}));
import {migratePublishingData,loadPublishingCollections,savePublishingCollection} from './collection-store';
import {saveSeriesProject,loadSeriesProjects} from '../../redesign-data';
it('preserves IDs, schedules and publication receipts while detaching stories and generated video requests',()=>{
 const rows=[{id:'story',name:'حافظتي',publishTasks:[{id:'task',name:'يومي',times:['08:00'],timezone:'Asia/Baghdad' as const,createdAt:1}],libraryVideos:[{id:'video',title:'ريل',publishAt:'2026-10-20T05:00:00Z',publicationId:'receipt',createdAt:1,videoRequestId:'r'}],videoRequests:[{id:'r',status:'ready',url:'https://example.com/v.mp4',jobId:'legacy',prompt:'old'}]}];
 const original=JSON.stringify(rows),next=migratePublishingData(rows);expect(JSON.stringify(rows)).toBe(original);expect(next[0].id).toBe('story');expect(next[0].publishTasks?.[0].id).toBe('task');expect(next[0].libraryVideos?.[0]).toMatchObject({id:'video',publicationId:'receipt',legacySourceJobId:'legacy',url:'https://example.com/v.mp4',publishAt:'2026-10-20T05:00:00Z'});expect(next[0]).not.toHaveProperty('videoRequests');expect(next[0]).not.toHaveProperty('characters');expect(next.find(p=>p.id==='__general')?.libraryVideos).toHaveLength(0);
});
it('copies local data once without changing the original database or overwriting later collection edits',async()=>{
 await saveSeriesProject({id:'migration-story',name:'قديم',characters:[],messages:[{id:'m',role:'user',text:'حوار محفوظ',createdAt:1}],libraryVideos:[{id:'v',title:'فيديو',file:new File(['original'],'v.mp4',{type:'video/mp4'}),publishAt:'',createdAt:1}]});
 const original=await loadSeriesProjects(),first=await loadPublishingCollections(),target=first.find(p=>p.id==='migration-story')!;await savePublishingCollection({...target,name:'حافظة معدلة'});
 const reopened=await loadPublishingCollections();expect(reopened.find(p=>p.id===target.id)?.name).toBe('حافظة معدلة');expect(await loadSeriesProjects()).toEqual(original);expect(reopened.filter(p=>p.id===target.id)).toHaveLength(1);
});
