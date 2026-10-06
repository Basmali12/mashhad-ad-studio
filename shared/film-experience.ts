import type {FlowOption} from './pipeline';
export function filmOptions(options:FlowOption[]){return options.filter(o=>o.model==='Omni Flash'&&o.seconds===10||o.model==='Veo 3.1 Fast'&&o.seconds===8);}
export function episodeDuration(seconds:number,unit:number){if(!Number.isInteger(seconds)||seconds<10||seconds>300||![8,10].includes(unit))throw new Error('مدة الحلقة غير صالحة.');const actual=Math.ceil(seconds/unit)*unit;if(actual>300)throw new Error('المدة النهائية تتجاوز 300 ثانية.');return actual;}
