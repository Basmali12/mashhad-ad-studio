import {episodeDuration} from './film-experience';
export type StorySettings={model:'Omni Flash'|'Veo 3.1 Fast';dialect:'العراقية'|'الفصحى';requestedSeconds:number;aspect:'9:16'|'16:9'};
export const defaultStorySettings:StorySettings={model:'Omni Flash',dialect:'العراقية',requestedSeconds:60,aspect:'9:16'};
export function storySegments(settings:StorySettings){if(!['Omni Flash','Veo 3.1 Fast'].includes(settings.model)||!['العراقية','الفصحى'].includes(settings.dialect)||!['9:16','16:9'].includes(settings.aspect)||settings.requestedSeconds>180)throw new Error('تحقق من الموديل واللهجة والمقاس والمدة (حتى 3 دقائق).');const unit=settings.model==='Omni Flash'?10:8,total=episodeDuration(settings.requestedSeconds,unit);return {unit,total,count:total/unit};}
