import {it,expect} from 'vitest';
import {subscriptionDays,reelsPlans} from './reels-plans';
it('counts thirty Baghdad dates from activation across months, not the calendar month',()=>{
 const days=subscriptionDays(Date.parse('2026-10-21T22:00:00Z'));expect(days).toHaveLength(30);expect(days[0]).toEqual({number:1,date:'2026-10-22'});expect(days[9]).toEqual({number:10,date:'2026-10-31'});expect(days[29]).toEqual({number:30,date:'2026-11-20'});
});
it('includes YouTube only in the four-platform offer',()=>{expect(reelsPlans.filter(p=>(p.platforms as readonly string[]).includes('youtube')).map(p=>p.priceCents)).toEqual([1500]);});
