import {describe,it,expect,vi} from 'vitest';
import {validateChatRequest,callSeriesAssistant,FREE_CHAT_MODEL,FREE_CHAT_FALLBACK,FREE_IRAQI_CHAT_MODEL} from './series-chat-server';
const request={projectId:'one',turnId:'turn',memory:{projectId:'one',name:'قرية'},messages:[{role:'user' as const,content:[{type:'input_text' as const,text:'قسّم القصة'}]}]};
describe('private chat boundary',()=>{
 it('understands the reported greeting typo without generating tools or interpreting it as wind',async()=>{
  const fetcher=vi.fn();
  const input={...request,memory:{...request.memory,contextMode:'general',conversationSummary:'سياق محفوظ'},messages:[{role:'user' as const,content:[{type:'input_text' as const,text:'هبو'}]}]};
  const result=await callSeriesAssistant(input,'key',fetcher,'openrouter');
  expect(result.reply).toBe('هلا بيك 😊 شلونك؟');expect(result.memorySummary).toContain('المستخدم: هبو');
  expect(result.memorySummary).toContain('سياق محفوظ');expect(result.imageRequest).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 });
 it('keeps contextual typo interpretation in the model without silently rewriting names, numbers or negation',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'واضح، خلينا نناقش طلبك.'}}]})));
  const text='هلو لا تغير اسم علي ولا الرقم 1998، بس ناقش الفكرة';
  await callSeriesAssistant({...request,memory:{...request.memory,contextMode:'general'},messages:[{role:'user',content:[{type:'input_text',text}]}]},'key',fetcher,'openrouter');
  const messages=JSON.parse(fetcher.mock.calls[0][1].body).messages;
  expect(messages[0].content).toContain('أخطاء الكتابة');expect(messages.at(-1).content[0].text).toBe(text);
 });
 it('attributes the Mashhad assistant to its developer without calling the model provider',async()=>{
  const fetcher=vi.fn();
  for(const text of ['من الذي صممك؟','منو برمجك','من صممك وبرمجك']){
   const result=await callSeriesAssistant({...request,messages:[{role:'user',content:[{type:'input_text',text}]}]},'key',fetcher,'openrouter');
   expect(result.reply).toBe('أنا مساعد مشهد، صممني وبرمجني الشاب العراقي باسم علي.');
   expect(result.imageRequest).toBeNull();
  }
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('keeps underlying model questions with the provider and includes the application identity instructions',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'النموذج من مزوده.'}}]})));
  await callSeriesAssistant({...request,memory:{...request.memory,contextMode:'general'},messages:[{role:'user',content:[{type:'input_text',text:'من صمم النموذج الأساسي؟'}]}]},'key',fetcher,'openrouter');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain('الشاب العراقي باسم علي');
 });
 it('sends earlier assistant replies as output_text so later conversation turns are accepted',async()=>{
  const conversation={...request,messages:[...request.messages,{role:'assistant' as const,content:[{type:'input_text' as const,text:'أنا مساعد المشروع'}]},...request.messages]};
  const answer={reply:'المتابعة',memorySummary:'ذاكرة',imageDetails:null,ticket:null};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(answer)}]}]})));
  await callSeriesAssistant(validateChatRequest(conversation),'test-private-key',fetcher);
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.input[2]).toEqual({role:'assistant',content:[{type:'output_text',text:'أنا مساعد المشروع'}]});
  expect(body.input[3].content[0].type).toBe('input_text');
 });
 it('rejects cross-project memory, role injection and external image URLs',()=>{
  expect(()=>validateChatRequest({...request,memory:{projectId:'two'}})).toThrow();
  expect(()=>validateChatRequest({...request,messages:[{role:'system',content:[]}]})).toThrow();
  expect(()=>validateChatRequest({...request,messages:[{role:'user',content:[{type:'input_image',image_url:'https://private.example/image',detail:'auto'}]}]})).toThrow();
  expect(validateChatRequest(request)).toEqual(request);
 });
 it('passes memory and vision to OpenAI but never returns credentials, including provider errors',async()=>{
  const answer={reply:'رد',memorySummary:'ذاكرة',imageDetails:null,ticket:null};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(answer)}]}],usage:{input_tokens:10,output_tokens:20}})));
  const result=await callSeriesAssistant(request,'test-private-key',fetcher);
  expect(result.reply).toBe('رد');expect(JSON.stringify(result)).not.toContain('test-private-key');
  const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.store).toBe(false);expect(body.input[0].content[0].text).toContain('قرية');expect(body.tools).toBeUndefined();
  const rejected=vi.fn().mockResolvedValue(new Response('test-private-key',{status:429}));
  await expect(callSeriesAssistant(request,'test-private-key',rejected)).rejects.toThrow('رصيد API');
 });
});

describe('free OpenRouter conversation',()=>{
 const general={...request,memory:{...request.memory,contextMode:'general'}};
 const answer={reply:'هلو',memorySummary:'حوار عام',conflict:null,imageDetails:null,imageRequest:null,ticket:null};
 it('discusses an attached photo naturally without entering image production or project fields',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:'أسماك مصطادة.'}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:'عاشت إيدك! وين صدتهن؟'}}]}));
  const result=await callSeriesAssistant({...general,messages:[{role:'user',content:[{type:'input_text',text:'شوف اليوم شنو صدت'},{type:'input_image',image_url:'data:image/png;base64,YQ==',detail:'auto'}]}]},'key',fetcher,'openrouter');
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.response_format).toBeUndefined();expect(body.model).toBe(FREE_CHAT_MODEL);
  expect(body.messages.at(-1).content[1].image_url.url).toBe('data:image/png;base64,YQ==');
  const conversation=JSON.parse(fetcher.mock.calls[1][1].body);
  expect(conversation.model).toBe(FREE_IRAQI_CHAT_MODEL);expect(JSON.stringify(conversation.messages)).not.toContain('data:image');
  expect(conversation.messages.at(-1).content[0].text).toBe('شوف اليوم شنو صدت');expect(conversation.messages.at(-2).content).toContain('أسماك مصطادة.');
  expect(conversation.response_format).toBeUndefined();expect(conversation.provider.max_price).toEqual({prompt:0,completion:0});
  expect(result.reply).toBe('عاشت إيدك! وين صدتهن؟');expect(result.imageRequest).toBeNull();expect(result.imageDetails).toBeNull();
 });
 it('gives general replies Iraqi dialect priority over old formal replies while preserving requested code and translations',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'هسه أگدر أوضحلك.'}}]}));
  await callSeriesAssistant({...general,messages:[{role:'assistant',content:[{type:'input_text',text:'يمكنك استخدام هذه الميزة.'}]},{role:'user',content:[{type:'input_text',text:'اشرحلي حفظ المحادثات'}]}]},'key',fetcher,'openrouter');
  const body=JSON.parse(fetcher.mock.calls[0][1].body),rules=body.messages[0].content;
  expect(rules).toContain('احچي باللهجة العراقية الطبيعية الخالصة');expect(rules).toContain('لا تقلد فصحاها');expect(rules).toContain('حافظ على الكود والروابط');expect(rules).toContain('إذا طلب المستخدم صراحة لغة ثانية');
  expect(body.messages[2].content[0].text).toBe('يمكنك استخدام هذه الميزة.');expect(body.response_format).toBeUndefined();
 });
 it('keeps the previous memory when a free provider omits it from an otherwise complete short reply',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...answer,memorySummary:null})}}]})));
  const result=await callSeriesAssistant({...general,memory:{...general.memory,contextMode:'project',conversationSummary:'اتفاقات محفوظة'}},'key',fetcher,'openrouter');
  expect(result.reply).toBe('هلو');expect(result.memorySummary).toBe('اتفاقات محفوظة');
 });
 it('discards unsolicited image proposals during ordinary greetings without replacing the real reply',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...answer,imageRequest:{kind:'scene',name:'صورة',description:'اقتراح غير مطلوب',prompt:'A garden',count:1,sourceRequestId:null}})}}]})));
  const result=await callSeriesAssistant({...general,messages:[{role:'user',content:[{type:'input_text',text:'هلو، جاوب باختصار.'}]}]},'key',fetcher,'openrouter');
  expect(result.imageRequest).toBeNull();expect(result.reply).toBe('هلو');
 });
 it('uses free routing with vision and separate general context',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({model:FREE_CHAT_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:20,completion_tokens:10}})));
  const result=await callSeriesAssistant({...general,messages:[{role:'user',content:[{type:'input_text',text:'اشرح الصورة'},{type:'input_image',image_url:'data:image/png;base64,YQ==',detail:'auto'}]}]},'private-test-key',fetcher,'openrouter');
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.model).toBe(FREE_CHAT_MODEL);expect(body.provider.max_price).toEqual({prompt:0,completion:0});
  expect(JSON.parse(fetcher.mock.calls[1][1].body).messages[0].content).toContain('مستقلة عن المشاريع');expect(body.messages[2].content[1].image_url.url).toBe('data:image/png;base64,YQ==');
  expect(result.usage).toEqual({inputTokens:20,outputTokens:10});expect(JSON.stringify(result)).not.toContain('private-test-key');
 });
 it('uses the free text model for ordinary chat after an old image without discarding the text history',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'هسه خلّينا نحچي عن شغلك.'}}]}));
  await callSeriesAssistant({...general,messages:[{role:'user',content:[{type:'input_text',text:'مرجع سابق'},{type:'input_image',image_url:'data:image/png;base64,YQ==',detail:'auto'}]},{role:'user',content:[{type:'input_text',text:'شلون أنظم يومي؟'}]}]},'key',fetcher,'openrouter');
  const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.model).toBe(FREE_IRAQI_CHAT_MODEL);expect(JSON.stringify(body.messages)).not.toContain('data:image');expect(JSON.stringify(body.messages)).toContain('مرجع سابق');
 });
 it('never falls back to a paid model when free quota is exhausted',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response('provider private details',{status:429}));
  await expect(callSeriesAssistant(general,'private-test-key',fetcher,'openrouter')).rejects.toThrow('لن نستخدم موديلًا مدفوعًا');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(c=>JSON.parse(c[1].body).model)).toEqual([FREE_IRAQI_CHAT_MODEL,FREE_CHAT_FALLBACK]);
 });
 it('rejects malformed image commands and incomplete replies before execution',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...answer,imageRequest:{kind:'scene',name:'صورة',description:'وصف',prompt:'صورة',count:100,sourceRequestId:null}})}}]})));
  await expect(callSeriesAssistant({...general,messages:[{role:'user',content:[{type:'input_text',text:'ولد صورة'}]}]},'key',fetcher,'openrouter')).rejects.toThrow('طلب الصورة غير صالح');
 });
});
