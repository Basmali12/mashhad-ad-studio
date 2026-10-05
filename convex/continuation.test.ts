import {it,expect} from 'vitest';
import {continuationEdit} from './continuation';
import {defaultTemplate} from '../shared/pipeline';
const form={name:'',address:'',phone:'',products:'',prompt:'',instructions:'',model:'Veo 3.1 Fast',aspect:'9:16',duration:8,dialect:'العراقية'};
it('exports 8+8 as 16 and 6+8 as 14, never repeats the original to fill a duration',()=>{
 for(const originalDuration of [8,6]){const settings=continuationEdit(defaultTemplate(form,true),[{storageId:'new',start:0,end:8}],8,{storageId:'original',duration:originalDuration,width:360,height:640});expect(settings.duration).toBe(originalDuration+8);expect(settings.clips.map(c=>c.storageId)).toEqual(['original','new']);expect(settings.logo.end).toBe(originalDuration+8);}
});
it('rejects a combined duration exceeding 180 before generation',()=>{expect(()=>continuationEdit(defaultTemplate(form),[{storageId:'new',start:0,end:8}],8,{storageId:'original',duration:180,width:360,height:640})).toThrow();});
