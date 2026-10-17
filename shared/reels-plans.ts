export const reelsPlans=[
 {code:'reels-15-3',name:'الباقة الأولى',priceCents:500,videoLimit:15,platformLimit:3,platforms:['tiktok','facebook','instagram'],enabled:true},
 {code:'reels-60-3',name:'الباقة الثانية',priceCents:1000,videoLimit:60,platformLimit:3,platforms:['tiktok','facebook','instagram'],enabled:true},
 {code:'reels-60-4',name:'الباقة الثالثة',priceCents:1500,videoLimit:60,platformLimit:4,platforms:['tiktok','facebook','instagram','youtube'],enabled:true},
] as const;
export const subscriptionWhatsApp='https://wa.me/9647729373260';
export const subscriptionDay=(at:number)=>new Date(at+3*3600000).toISOString().slice(0,10);
export function subscriptionDays(startsAt:number){const first=subscriptionDay(startsAt);return Array.from({length:30},(_,i)=>({number:i+1,date:new Date(Date.parse(first+'T00:00:00Z')+i*86400000).toISOString().slice(0,10)}));}
