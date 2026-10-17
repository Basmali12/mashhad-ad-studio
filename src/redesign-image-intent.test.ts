import {it,expect} from 'vitest';
import {requestsImageGeneration,requestsImageEdit} from './redesign-image-intent';
it('executes explicit image requests but preserves prompt review and negation',()=>{
 expect(requestsImageGeneration('ولد لي صورة فيها شخصيتين')).toBe(true);
 expect(requestsImageGeneration('صمم لي أربعة خيارات شخصية')).toBe(true);
 expect(requestsImageGeneration('لا تولّد الصورة، اكتب برومبت فقط')).toBe(false);
 expect(requestsImageGeneration('راجع البرومبت حتى نولد صورة')).toBe(false);
 expect(requestsImageGeneration('شلون تقسم القصة؟')).toBe(false);
});
it('recognizes image edits without treating prompt review or ordinary chat as editing',()=>{
 expect(requestsImageEdit('غير الخلفية إلى حديقة')).toBe(true);
 expect(requestsImageEdit('غيّر الخلفية إلى حديقة، لا تغير أي تفصيل ثاني')).toBe(true);
 expect(requestsImageEdit('عدّل لون الملابس')).toBe(true);
 expect(requestsImageEdit('خليها بإضاءة ليلية')).toBe(true);
 expect(requestsImageEdit('لا تغير الخلفية')).toBe(false);
 expect(requestsImageEdit('عدل البرومبت فقط')).toBe(false);
 expect(requestsImageEdit('خلي النقاش طبيعي')).toBe(false);
 expect(requestsImageEdit('اذا تغير الخلفية شنو يصير؟')).toBe(false);
});
