import {it,expect} from 'vitest';
import {approveLatestImage} from './redesign-image-approval';
import type {SeriesProject} from './redesign-data';
it('approves only the latest pending image with its agreed character details and does not duplicate approval',()=>{
 const image=new File(['image'],'portrait.png',{type:'image/png'});
 const project:SeriesProject={id:'p',name:'project',characters:[],messages:[{id:'old',role:'user',text:'',createdAt:1,image},{id:'latest',role:'user',text:'',createdAt:2,image,imageDetails:{kind:'character',name:'علي',description:'بطل القصة'}}]};
 const approved=approveLatestImage(project);
 expect(approved.characters.map(c=>c.name)).toEqual(['علي']);
 expect(approved.messages?.[0].imageApproved).toBeUndefined();
 expect(approved.messages?.[1].imageApproved).toBe(true);
 expect(approveLatestImage(approved).characters).toHaveLength(1);
 expect(project.characters).toHaveLength(0);
});

