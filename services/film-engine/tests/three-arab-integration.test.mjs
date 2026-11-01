import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNarrationEngine,threeArabComparisonPlan,narrationDirectorOptions,THREE_ARAB_MANIFEST,THREE_ARAB_STYLES} from '../engine/three-arab-integration.mjs';
test('Habibi remains available by explicit request and preserves IRQ/EGY',()=>{for(const locale of ['ar-MSA','ar-IQ','ar-EG'])assert.ok(selectNarrationEngine({requestedEngine:'habibi',locale}).modelId.startsWith('habibi-'));assert.equal(selectNarrationEngine({locale:'ar-IQ'}).modelId,'habibi-irq');assert.equal(selectNarrationEngine({locale:'ar-EG'}).modelId,'habibi-egy');});
test('unprepared 3arab never silently falls back or looks ready',()=>{const r=selectNarrationEngine({style:'solemn'});assert.equal(r.available,false);assert.equal(r.automaticFallback,false);assert.equal(THREE_ARAB_MANIFEST.commercialReady,false);assert.throws(()=>selectNarrationEngine({style:'fast'}),/STYLE_INVALID/);});
test('two auditions use exact same text, seed and native steps without paid dispatch',()=>{const text='في ليلة ساد فيها السكون، جلس رجل يتأمل حياته.',p=threeArabComparisonPlan(text);assert.deepEqual(p.samples.map(s=>s.style),['solemn','calm']);assert.ok(p.samples.every(s=>s.text===text&&s.seed===42&&s.numSteps===40&&s.seconds===15));assert.equal(p.dispatch,false);assert.equal(p.approved,false);assert.equal(p.exactDemoRecreationGuaranteed,false);});

test('chosen preview voices retain pinned official provenance, not generated voice proof',()=>{assert.equal(THREE_ARAB_STYLES.solemn.demo,'005.wav');assert.equal(THREE_ARAB_STYLES.calm.demo,'003.wav');for(const s of Object.values(THREE_ARAB_STYLES)){assert.equal(s.previewOnly,true);assert.ok(s.previewUrl.includes(THREE_ARAB_MANIFEST.revisions['sherif1313/3arab-TTS-500M-v1-VoiceDesign']));}});

test('director receives candidate voices without admission or changing approved voices',()=>{const o=narrationDirectorOptions();assert.equal(o.canDispatch,false);assert.equal(o.preserveApprovedVoiceProfiles,true);assert.equal(o.existingEngine,'habibi');assert.ok(o.options.every(v=>v.productionReady===false&&v.requiresListeningApproval===true));});

test('a readiness boolean cannot bypass production voice admission',()=>{assert.equal(selectNarrationEngine({threeArabReady:true}).available,false);});
