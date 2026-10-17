import {v} from 'convex/values';
import type {AnalysisReport} from './video-analysis';
export const trendSlot=v.object({key:v.string(),label:v.string(),description:v.string()});
export const trendRecipe=v.object({slots:v.array(trendSlot),fixed:v.string(),variable:v.string(),prompt:v.string()});
export type TrendRecipe={slots:{key:string;label:string;description:string}[];fixed:string;variable:string;prompt:string};
export function validateTrend(recipe:TrendRecipe){
 if(recipe.slots.length<1||recipe.slots.length>4||new Set(recipe.slots.map(s=>s.key)).size!==recipe.slots.length||recipe.slots.some(s=>!s.key.trim()||s.key.length>80||!s.label.trim()||s.label.length>120||!s.description.trim()||s.description.length>1500)||!recipe.fixed.trim()||recipe.fixed.length>5000||!recipe.variable.trim()||recipe.variable.length>5000||!recipe.prompt.trim()||recipe.prompt.length>10000)throw new Error('القالب يحتاج من صورة إلى أربع صور بأدوار واضحة وتعليمات توليد.');
 return recipe;
}
export function trendFromReport(report:AnalysisReport){
 const recipe=(report as AnalysisReport&{trend?:TrendRecipe}).trend;
 if(!recipe)throw new Error('هذا تحليل قصة؛ ارفع الفيديو من تحليل الترند حتى تُحدد الصور والتغييرات المطلوبة.');
 return validateTrend(recipe);
}
export const TREND_INSTRUCTIONS=`Additionally analyze this as a reusable AI video trend, not a rural story. Preserve the actual source's visual style and era. Return a trend object with slots [{key,label,description}], fixed, variable, prompt. Slots are ONLY the input images the customer must replace: identify people, pets, products or other subject images actually necessary. Choose 1 through 4 slots based on visual evidence, stable keys and Arabic role labels; do not fabricate four roles when one suffices. If more than four or the replacement mechanism is uncertain, record uncertainty and propose the closest feasible draft, never claim exact replication. fixed describes choreography, scene, camera and timing to keep. variable describes what the uploaded images replace. prompt is a complete original English generation instruction referring to each numbered input image in slots order, preserving identities, source style, camera and sequence, without copying copyrighted dialogue, watermarks or brands. Keep normal analysis fields including audiovisual shots. This is a draft for human review, not proof of trend provenance.`;
export function trendPrompt(recipe:TrendRecipe){validateTrend(recipe);const prompt=`${recipe.prompt}\nInput image roles in exact order:\n${recipe.slots.map((s,i)=>`Image ${i+1}: ${s.label} — ${s.description}`).join('\n')}\nKeep: ${recipe.fixed}\nChange only: ${recipe.variable}\nUse these customer-provided images for the assigned roles; do not swap identities.`;if(prompt.length>8500)throw new Error('اختصر تعليمات القالب حتى تتسع لتفاصيل المقاطع.');return prompt;}
