import {it,expect} from 'vitest';
import {nextDayTime,assertVideoChannels,futureDayTime,emptyDayDraft,defaultDayTimes,rememberDayTimes} from './day-editor-model';
it('uses the last saved first and second times including AM/PM on empty future days',()=>{
 const now=Date.parse('2026-10-17T13:00:00+03:00'),channels=[{id:'t',name:'T',service:'tiktok'}],times=rememberDayTimes(['08:40','20:15'],[]);
 expect(emptyDayDraft('2026-10-18',channels,[],now,times[0]).time).toBe('08:40');
 expect(emptyDayDraft('2026-10-18',channels,['08:40'],now,times[1]).time).toBe('20:15');
 expect(rememberDayTimes(['10:30'],times)).toEqual(['10:30','20:15']);
 expect(defaultDayTimes({id:'a',name:'A',publishSchedule:{timezone:'Asia/Baghdad',times}})).toEqual(times);
 expect(defaultDayTimes({id:'b',name:'B'})).toEqual([]);
});
it('never copies a preferred time into yesterday, the past today or an occupied slot',()=>{
 const now=Date.parse('2026-10-17T13:00:00+03:00');
 expect(futureDayTime('2026-10-17',emptyDayDraft('2026-10-17',[],[],now,'08:40').time,now)).toBe(true);
 expect(emptyDayDraft('2026-10-18',[],['20:15'],now,'20:15').time).not.toBe('20:15');
 expect(()=>emptyDayDraft('2026-10-16',[],[],now,'20:15')).toThrow('انتهى');
});
it('derives initial defaults from the last saved day without mutating historical videos',()=>{
 const videos=[{id:'old',title:'Old',createdAt:1,publishAt:'2026-10-20T15:00:00+03:00'},{id:'a',title:'A',createdAt:2,publishAt:'2026-10-18T20:15:00+03:00'},{id:'b',title:'B',createdAt:3,publishAt:'2026-10-18T08:40:00+03:00'}],before=JSON.stringify(videos);
 expect(defaultDayTimes({id:'a',name:'A',libraryVideos:videos})).toEqual(['20:15','08:40']);expect(JSON.stringify(videos)).toBe(before);
});
it('rejects yesterday, noon and the current minute at 1pm Baghdad, but accepts later times',()=>{
 const now=Date.parse('2026-10-17T13:00:30+03:00');
 for(const [day,time] of [['2026-10-16','23:59'],['2026-10-17','12:00'],['2026-10-17','13:00']])expect(futureDayTime(day,time,now)).toBe(false);
 expect(futureDayTime('2026-10-17','13:01',now)).toBe(true);
 expect(futureDayTime('2026-10-18','00:00',now)).toBe(true);
 expect(futureDayTime('2026-10-17','13:01',Date.parse('2026-10-17T13:01:00+03:00'))).toBe(false);
 expect(futureDayTime('2026-10-17','23:59',Date.parse('2026-10-18T00:00:00+03:00'))).toBe(false);
});
it('defaults today to a future Baghdad time instead of the past 9am slot',()=>{const now=Date.parse('2026-10-17T08:12:00Z');const time=nextDayTime('2026-10-17',[],now);expect(Date.parse('2026-10-17T'+time+':00+03:00')).toBeGreaterThan(now);expect(nextDayTime('2026-10-17',[time],now)).not.toBe(time);});
it('uses a future day without moving it to another calendar date',()=>{expect(nextDayTime('2026-10-22',[],Date.parse('2026-10-17T08:00:00Z'))).toBe('09:00');expect(()=>nextDayTime('2026-10-16',[],Date.parse('2026-10-17T08:00:00Z'))).toThrow('انتهى');});
it('permits one opted-in platform and rejects empty, duplicate or foreign account IDs',()=>{const rows=[{id:'t',service:'tiktok',name:'T'},{id:'f',service:'facebook',name:'F'}];expect(()=>assertVideoChannels(['t'],rows)).not.toThrow();for(const ids of [[],['t','t'],['other']])expect(()=>assertVideoChannels(ids,rows)).toThrow();});

it('creates an immediate blank upload form with a future time and preserves saved video identity',async()=>{
 const {emptyDayDraft,dayDraft}=await import('./day-editor-model'),channels=[{id:'t',name:'TikTok',service:'tiktok'}],now=Date.parse('2026-10-17T13:00:00+03:00');
 const draft=emptyDayDraft('2026-10-17',channels,[],now);expect(draft.title).toBe('');expect(draft.channelIds).toEqual(['t']);expect(draft.original).toBeUndefined();expect(futureDayTime('2026-10-17',draft.time,now)).toBe(true);
 const video={id:'saved',title:'Saved',createdAt:1,publishAt:'2026-10-18T11:00:00+03:00'};expect(dayDraft(video,channels).original).toBe(video);expect(dayDraft(video,channels).time).toBe('11:00');
});
