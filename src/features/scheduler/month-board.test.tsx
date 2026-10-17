import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MonthBoardView} from './month-board';
it('renders exactly thirty selectable numbered dates and the real allowance, with no old cadence form',()=>{
 const html=renderToStaticMarkup(<MonthBoardView collection={{id:'q',name:'Q'}} collections={[]} busy={false} onSave={async()=>{}} subscription={{startsAt:Date.parse('2026-10-22T06:00:00Z'),expiresAt:Date.parse('2026-11-21T06:00:00Z'),videoLimit:15}} remaining={13} uploading={1}/>);
 expect(html.match(/class="month-day/g)).toHaveLength(30);expect(html).toContain('اليوم 10 — 2026-10-31');expect(html).toContain('13');expect(html).toContain(' / 15');expect(html).not.toContain('تكرار النشر');expect(html).not.toContain('مهام الجدولة');
});
it('shows the same thirty-day layout before activation without inventing video allowance',()=>{
 const html=renderToStaticMarkup(<MonthBoardView inactive collection={{id:'q',name:'Q'}} collections={[]} busy={false} onSave={async()=>{}} subscription={{startsAt:Date.parse('2026-10-22T00:00:00+03:00'),expiresAt:Date.parse('2026-11-21T00:00:00+03:00'),videoLimit:0}} remaining={0} uploading={0}/>);
 expect(html.match(/class="month-day/g)).toHaveLength(30);expect(html).toContain('اشتراك غير مفعّل');expect(html).not.toContain('فيديو متبقٍ');expect(html).not.toContain('58');
});

it('shows gold VIP for an active subscription even at zero quota, but not for inactive, expired or future subscriptions',()=>{
 const now=Date.parse('2026-10-22T13:00:00+03:00');vi.spyOn(Date,'now').mockReturnValue(now);
 try{for(const state of [{startsAt:now-1000,expiresAt:now+86400000,inactive:false,vip:true},{startsAt:now-1000,expiresAt:now+86400000,inactive:true,vip:false},{startsAt:now-86400000,expiresAt:now,inactive:false,vip:false},{startsAt:now+1000,expiresAt:now+86400000,inactive:false,vip:false}]){
 const html=renderToStaticMarkup(<MonthBoardView collection={{id:'q',name:'Q'}} collections={[]} busy={false} onSave={async()=>{}} inactive={state.inactive} subscription={{startsAt:state.startsAt,expiresAt:state.expiresAt,videoLimit:15}} remaining={0} uploading={0}/>);
 expect(html.includes('اشتراك فعّال VIP')).toBe(state.vip);
 }}finally{vi.restoreAllMocks();}
});
