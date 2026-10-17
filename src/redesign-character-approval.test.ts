import {it,expect} from 'vitest';
import {approveChatCharacter} from './redesign-character-approval';
import {requestsCharacterApproval} from './redesign-image-intent';
import type {SeriesProject} from './redesign-data';
it('accepts contextual character approval but preserves negation',()=>{expect(requestsCharacterApproval('اسمها زينب، اعتمدها')).toBe(true);expect(requestsCharacterApproval('مو موافق')).toBe(false);});
it('saves the named generated character exactly once and never modifies general chat',async()=>{const image=new File(['fixture'],'portrait.png',{type:'image/png'});const p:SeriesProject={id:'p',name:'Story',characters:[],visualRequests:[{id:'v',kind:'character',name:'علي',description:'الأب',prompt:'portrait',count:1,sourceRequestId:null,instructions:'',status:'ready',file:image,transparent:true,createdAt:1}]};const next=await approveChatCharacter(p);expect(next.characters[0]).toMatchObject({name:'علي',description:'الأب',image});expect((await approveChatCharacter(next)).characters).toHaveLength(1);expect(await approveChatCharacter({...p,kind:'conversation'})).toEqual({...p,kind:'conversation'});});
