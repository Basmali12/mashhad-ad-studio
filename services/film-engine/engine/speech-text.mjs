import {hash} from './store.mjs';
import {narrationStyle} from './narration-styles.mjs';
/** Keep original wording/diacritics in the story; normalize only a synthesis copy. */
export function prepareNarrationText(original,{policy='preserve'}={}){
 if(typeof original!=='string'||!original.trim()||!['plain','preserve'].includes(policy)||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/u.test(original))throw Error('NARRATION_TEXT_INVALID');
 let text=original.normalize('NFC').replace(/[\u0640\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu,'').replace(/،/gu,',').replace(/؛/gu,';').replace(/؟/gu,'?').replace(/[…]/gu,'.').replace(/\.{2,}/gu,'.').replace(/\s+/gu,' ').trim();
 if(policy==='plain')text=text.replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu,'');
 if(!/[\p{L}]/u.test(text))throw Error('NARRATION_TEXT_INVALID');
 const warnings=[];if(/[0-9٠-٩۰-۹]/u.test(text))warnings.push('NUMBERS_REQUIRE_PRONUNCIATION_REVIEW');if(/[\u06d6-\u06ed﷽]/u.test(original))warnings.push('RELIGIOUS_ORTHOGRAPHY_REQUIRES_REVIEW');if(policy==='plain'&&/[\u064b-\u065f]/u.test(original))warnings.push('DIACRITICS_REMOVED_FROM_SYNTHESIS_COPY_REVIEW_REQUIRED');
 return {original,text,policy,version:'arabic-narration-v1',originalSHA256:hash(original),synthesisSHA256:hash(text),warnings,pronunciationVerified:false};
}
/** Pauses are explicit timeline silence, never spoken tags or time stretching. */
export function narrationPauses(text,styleId){const s=narrationStyle(styleId),out=[];for(const m of text.matchAll(/[،,؛;:.!?؟…]+(?:\s+|$)/gu)){const offset=m.index+m[0].length;if(offset<text.length)out.push({afterOffset:offset,durationMs:/[.!?؟…]/u.test(m[0])?s.sentenceMs:s.commaMs});}return out;}
