import test from 'node:test';
import assert from 'node:assert/strict';
import Arabic from '../engine/arabic-dialogue.cjs';
import {applyGenerationRules,FIXED_RULES_VERSION} from '../engine/generation-rules.mjs';

test('render prompt keeps exact Arabic speaker lines once without script headings',()=>{
 const contract={language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'حيدر بالقميص الأزرق',text:'عمي، لحظة! محفظتك طاحت.'},{speaker:'أبو علي بالقميص البيج',text:'الله يرضى عليك.'}]};
 const script=Arabic.compile(contract);
 const prompt=applyGenerationRules('The wallet falls first. Haider picks it up, then calls. Abu Ali turns only after the call.',script);
 assert.equal(FIXED_RULES_VERSION,'native-av-clean-v5');
 for(const line of contract.lines){assert.equal(prompt.split(line.text).length-1,1);assert.ok(prompt.includes(line.speaker));}
 for(const meta of ['[Locked Arabic audio contract','Spoken turn 1','[Permanent production directions'])assert.ok(!prompt.includes(meta));
 assert.ok(prompt.includes('The cause visibly happens before the reaction'));
 assert.ok(prompt.includes('without robotic doubling'));
 assert.equal(applyGenerationRules(prompt,script),prompt,'Recompiling a current prompt must not duplicate dialogue or directions');
 assert.deepEqual(contract.lines.map(l=>l.text),['عمي، لحظة! محفظتك طاحت.','الله يرضى عليك.']);
});

test('fixed positive instructions avoid repeating visual typography terms beside the spoken script',()=>{
 const script=Arabic.compile({language:'ar',dialect:'iraqi',lines:[{speaker:'الرجل بالقميص الأبيض',text:'هلا بيكم، هذا اختبار للصورة والصوت.'}]});
 const prompt=applyGenerationRules('A man walks through a courtyard with plain walls.',script);
 assert.doesNotMatch(prompt,/subtitles|captions|watermarks|written dialogue|credits/iu);
 assert.match(prompt,/plain.*surfaces/iu);
 assert.match(prompt,/soundtrack/iu);
 assert.equal(prompt.split('هلا بيكم، هذا اختبار للصورة والصوت.').length-1,1);
 assert.equal(applyGenerationRules(prompt,script),prompt);
});

test('silent scene remains explicitly silent and does not acquire dialogue or an external voice path',()=>{
 const script=Arabic.compile({language:'ar',dialect:'iraqi',mode:'silent',silenceRequested:true,lines:[]});
 assert.ok(script.includes('characters remain silent throughout'));
 assert.ok(!script.includes('says aloud'));
 assert.ok(applyGenerationRules('An empty alley at dusk.',script).includes('Preserve configured engine synchronized audio'));
 assert.throws(()=>Arabic.compile({mode:'dialogue',lines:[{speaker:'حيدر',text:'hello'}]}),/ARABIC_DIALOGUE_REQUIRED/);
});
