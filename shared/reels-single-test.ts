export const SINGLE_TEST = {
 subject:'user_3KBVI7A6M8vq8ntVl2diIzrbqao',accountId:'69c1fffd8918cc081adc0a5e',
 channelId:'6acc88f8778b240e2fe3be78',sha256:'4616ffc31ec318ea3f47741fa61329ed7e5f03f7c8dec6bb1b3040928f435d35',
 fileName:'kg2a70ga19zwj387a2atzyrr118g0d8y.mp4',operationId:'youtube-test-a44f4815-a151-45ae-80fc-ede8c47e6286',
 title:'اختبار مشهد — لقطة جرّة فخارية #Shorts',description:'هذا فيديو تجريبي مدته 8 ثوانٍ للتحقق من نشر YouTube Shorts عبر Buffer من حساب باسم علي. اختبار تقني واحد فقط.',
 ttlMs:48*3600000,
} as const;
export const singleTestMetadata={title:SINGLE_TEST.title,description:SINGLE_TEST.description,hashtags:[],categoryId:'22',madeForKids:false,privacy:'unlisted' as const,isAiGenerated:true};
export function matchesSingleTestMetadata(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))return false;const keys=Object.keys(singleTestMetadata) as (keyof typeof singleTestMetadata)[];return Object.keys(value).length===keys.length&&keys.every(key=>JSON.stringify((value as Record<string,unknown>)[key])===JSON.stringify(singleTestMetadata[key]));}
