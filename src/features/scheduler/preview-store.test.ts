import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {previewRead,previewUpload,previewSaveCollection,previewSaveSettings} from './preview-store';
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
afterEach(()=>vi.unstubAllGlobals());
const file=()=>new File([new Uint8Array([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8])],'fixture.mp4',{type:'video/mp4'});
it('persists file bytes and schedule together across independent reads without a cloud upload',async()=>{
 const uploaded=await previewUpload(file(),15),at='2026-10-17T18:00:00+03:00';
 await previewSaveCollection({id:'preview',name:'عرض',libraryVideos:[{id:'v',title:'فيديو محفوظ',bunnyAssetId:uploaded.id,createdAt:1,publishAt:at}]});
 const result=await previewRead();expect(result.collection?.libraryVideos?.[0].title).toBe('فيديو محفوظ');expect(result.collection?.libraryVideos?.[0].file).toBeTruthy();expect(await result.collection!.libraryVideos![0].file!.arrayBuffer()).toEqual(await file().arrayBuffer());expect(result.files).toHaveLength(1);
 await previewUpload(file(),15);expect((await previewRead()).files).toHaveLength(1);
});
it('keeps theme and selected plan across reloads, without storing credentials',async()=>{
 await previewSaveSettings({theme:'light',plan:'reels-15-3',startsAt:1});expect((await previewRead()).settings).toEqual({theme:'light',plan:'reels-15-3',startsAt:1});
});
it('does not display a saved schedule if its file was never accepted',async()=>{
 await expect(previewSaveCollection({id:'p',name:'P',libraryVideos:[{id:'v',title:'missing',bunnyAssetId:'missing',createdAt:1,publishAt:'2026-10-17'}]})).rejects.toThrow('غير موجودة');expect((await previewRead()).collection).toBeUndefined();
});
