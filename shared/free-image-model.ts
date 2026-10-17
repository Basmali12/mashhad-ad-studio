import type {ImageOption} from './images';
export function strongestFreeImageOption(options:ImageOption[]=[],aspect='1:1'){
 for(const model of ['Nano Banana Pro','Nano Banana 2.1','Nano Banana 2','Nano Banana 2 Lite']){
  const option=options.find(o=>o.model===model&&o.cost===0&&o.aspect===aspect);if(option)return option;
 }
}
