import hashlib
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import wave
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from latentsync import runtime,prepare,modal_app,deploy,image,alignment
from latentsync.backend import SingleFaceDetector,NativeLatentSyncBackend
import flux_modal_bridge as bridge

ENGINE='12345678-1234-1234-1234-123456789abc'
SCOPE={'engineId':ENGINE,'accountId':'account-one','runId':'run-one','requestId':'request-one'}


def wav(rate=24000,seconds=1):
    out=io.BytesIO()
    with wave.open(out,'wb') as stream:stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(rate);stream.writeframes(b'\0\0'*int(rate*seconds))
    return out.getvalue()


def emissions(tokens,width=4):
    return [[math.log(.99 if i==token else .01/(width-1)) for i in range(width)] for token in tokens]


class AlignmentTests(unittest.TestCase):
    def test_word_times_follow_actual_ctc_emissions_and_preserve_silent_frames(self):
        result=alignment.align_ctc(emissions([0,1,1,2,0,3,0,1,0]),'اب ا',900,{'ا':1,'ب':2,'|':3})
        self.assertEqual(result['status'],'aligned');self.assertEqual([(w['startMs'],w['endMs']) for w in result['words']],[(100,400),(700,800)]);self.assertFalse(result['transcriptVerified'])
        repeated=alignment.align_ctc(emissions([1,0,1]),'اا',300,{'ا':1,'|':3});self.assertEqual(repeated['status'],'aligned');self.assertEqual(repeated['words'][0]['endMs'],300)

    def test_equal_length_words_can_have_unequal_measured_durations(self):
        result=alignment.align_ctc(emissions([1,2,0,0,0,3,0,1,1,1,2,2]),'اب اب',1200,{'ا':1,'ب':2,'|':3});words=result['words'];self.assertEqual(words[0]['endMs']-words[0]['startMs'],200);self.assertEqual(words[1]['endMs']-words[1]['startMs'],500)

    def test_arabic_diacritics_and_punctuation_do_not_replace_source_words(self):
        result=alignment.align_ctc(emissions([1,2,0,3,0,1]),'اَب؟ ا.',600,{'ا':1,'ب':2,'|':3});self.assertEqual(result['status'],'aligned');self.assertEqual([w['text'] for w in result['words']],['اَب؟','ا.']);self.assertEqual(len(result['sentences']),2)

    def test_missing_unknown_impossible_and_low_confidence_have_no_fabricated_times(self):
        for rows,text in [(emissions([1]),'اب'),(emissions([1]),'گ'),([[math.log(.25)]*4]*3,'اب'),([[float('nan')]*4],'اب')]:
            result=alignment.align_ctc(rows,text,1000,{'ا':1,'ب':2,'|':3});self.assertEqual(result['status'],'needs_review');self.assertIsNone(result['words']);self.assertIsNone(result['sentences'])


class NativeFaceAdmissionTests(unittest.TestCase):
    def test_actual_detector_never_selects_largest_from_multiple_faces(self):
        detector=SingleFaceDetector.__new__(SingleFaceDetector)
        for boxes in [[],[[0,0,10,20,.9],[0,0,100,200,.8]]]:
            detector.detector=SimpleNamespace(detect=lambda *args,**kwargs:(boxes,None));detector.landmark=SimpleNamespace(get=lambda *args:self.fail('landmark selection must not run'))
            with patch.dict(sys.modules,{'numpy':SimpleNamespace(),'insightface.app.common':SimpleNamespace(Face=object)}):
                with self.assertRaisesRegex(RuntimeError,'FACE_REVIEW_REQUIRED'):detector(object())

    def test_native_backend_reviews_all_frames_before_loading_diffusion_pipeline(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);audio=root/'audio.wav';audio.write_bytes(wav());native=NativeLatentSyncBackend(root,'cuda')
            def reject(_):raise RuntimeError('LATENTSYNC_FACE_REVIEW_REQUIRED')
            native.detector=SimpleNamespace(check_video=reject)
            with patch.dict(sys.modules,{'torch':SimpleNamespace()}),patch('latentsync.backend.probe_video',return_value={'fps':25,'numFrames':25,'durationMs':1000}),patch.object(native,'_load') as load:
                with self.assertRaisesRegex(RuntimeError,'FACE_REVIEW_REQUIRED'):native.sync(root/'source.mp4',audio,audio,root/'out.mp4',{}, {},42,lambda _:None)
                load.assert_not_called()


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.model=self.root/'models';self.model.mkdir();archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w') as z:z.writestr('buffalo_m/det_2.5g.onnx',b'detector-fixture-not-real');z.writestr('buffalo_m/2d106det.onnx',b'landmark-fixture-not-real');z.writestr('buffalo_m/w600k_r50.onnx',b'not-needed-recognition')
        self.bytes={'model.bin':b'not-real-model','face/buffalo_m.zip':archive.getvalue()};real=runtime.manifest_for();self.manifest={**real,'files':[{'path':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'repoId':'fixture/not-real','revision':real['revision'],'filename':name} for name,data in self.bytes.items()],'totalBytes':sum(map(len,self.bytes.values()))}
        self.addCleanup(patch.stopall);patch.object(runtime,'manifest_for',return_value=self.manifest).start();patch.object(prepare,'manifest_for',return_value=self.manifest).start()
        for name,data in self.bytes.items():p=self.model/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        self.faces=prepare.extract_faces(self.model);self.mark();self.loads=[];self.backend_calls=[]

    def mark(self,**extra):
        value={'modelId':'latentsync16','revision':self.manifest['revision'],'manifestFingerprint':runtime.manifest_fingerprint(),'engineId':ENGINE,'accountId':'account-one','files':self.manifest['files'],'faceFiles':self.faces,'licenses':{'usageMode':'noncommercial_research','researchOnly':True,'licenseAccepted':True,'faceModelRightsApproved':True,'rightsEvidence':'synthetic-local-test-only-not-a-commercial-grant'},**extra};(self.model/'READY.json').write_text(json.dumps(value),encoding='utf-8')

    def request(self,**extra):
        data=wav();return {'operation':'align','speakerId':'speaker-one','characterId':None,'voiceProfileId':'voice-one','utteranceId':'line-one','locale':'ar-IQ','text':'اب ا','seed':42,'audio':{'assetId':'audio-one','mime':'audio/wav','sha256':hashlib.sha256(data).hexdigest()},'audio_bytes':data,**extra}

    def lip(self,**extra):
        data=b'\x00\x00\x00\x18ftypisom'+b'\0'*24;sha=hashlib.sha256(data).hexdigest();base=self.request();base={k:v for k,v in base.items() if k not in ('text','utteranceId','locale')};return {**base,'operation':'lip_sync','characterId':'character-one','shotId':'shot-one','faceBindingId':'face-binding','video':{'assetId':'video-one','mime':'video/mp4','sha256':sha},'video_bytes':data,'targetFace':{'trackId':'track-one','faceCount':1,'characterId':'character-one','reviewed':True,'sourceVideoSHA256':sha},'settings':{'numInferenceSteps':20,'guidanceScale':1.5,'fps':25},**extra}

    def engine(self):
        owner=self
        class Backend:
            def align(self,path,text,duration):owner.backend_calls.append(('align',text));return alignment.align_ctc(emissions([0,1,1,2,0,3,0,1,0]),text,duration,{'ا':1,'ب':2,'|':3})
            def sync(self,video,conditioning,original,out,target,settings,seed,on_progress):owner.backend_calls.append(('lip_sync',target['trackId']));out.write_bytes(b'\0\0\0\x18ftypisom'+b'\0'*24);return {'width':1280,'height':720,'fps':25,'numFrames':25,'durationMs':1000,'hasAudio':True,'faceCheck':{'singleFaceEveryFrame':True,'identityVerified':False}}
            def close(self):owner.backend_calls.append(('close',))
        def factory(root,operation,device):owner.loads.append(operation);return Backend()
        def resample(source,target):
            with wave.open(str(source),'rb') as s:duration=s.getnframes()/s.getframerate()
            target.write_bytes(wav(rate=16000,seconds=duration))
        return runtime.LatentSyncRuntime(self.model,backend_factory=factory,device='cpu',resampler=resample,expected_scope={'engineId':ENGINE,'accountId':'account-one'})

    def packet(self,**extra):return {'paidApproved':True,'usageMode':'noncommercial_research','researchOnly':True,'licenseAccepted':True,'faceModelRightsApproved':True,'rightsEvidence':'synthetic-local-test-only-not-a-commercial-grant','modelId':'latentsync16','modelRevision':self.manifest['revision'],'manifestFingerprint':runtime.manifest_fingerprint(),'scope':SCOPE,**extra}

    def bridge_packet(self,request):
        config=DefinitionTests().config();manifest=json.loads((Path(runtime.__file__).parent/'manifest.json').read_text(encoding='utf-8'));return {'definition':{'id':ENGINE,'accountId':'account-one','modelId':'latentsync16','version':'1.6','volume':'model-volume','weightPath':config['weightPath'],'gpu':'L40S','cpu':4,'ramGiB':32},'manifest':manifest,'manifestFingerprint':bridge.fingerprint(manifest),'appName':'mashhad-latentsync-'+ENGINE.replace('-','')[:12],'resultsVolume':config['resultsVolume'],'action':'generate','runId':'run-one','requestId':'request-one','paidApproved':True,'usageMode':'noncommercial_research','researchOnly':True,'licenseAccepted':True,'faceModelRightsApproved':True,'rightsEvidence':'synthetic-local-test-only-not-a-commercial-grant','request':{k:v for k,v in request.items() if not isinstance(v,bytes)}}

    def test_runtime_echoes_exact_audio_profile_speaker_and_measured_alignment(self):
        engine=self.engine();self.assertFalse(engine.prepare()['runtimeLoaded']);events=[];out=engine.generate(self.request(),self.root/'out',events.append);a=out['alignment'];self.assertEqual(a['utteranceId'],'line-one');self.assertEqual(a['voiceProfileId'],'voice-one');self.assertEqual(a['audioSHA256'],self.request()['audio']['sha256']);self.assertEqual(a['textSHA256'],hashlib.sha256('اب ا'.encode()).hexdigest());self.assertEqual(a['durationMs'],1000);self.assertFalse(a['needsReview']);self.assertEqual([e['completed'] for e in events],[1,3]);self.assertEqual((self.root/'out/original.wav').read_bytes(),self.request()['audio_bytes'])

    def test_models_unload_between_alignment_and_lip_sync_and_outputs_are_separate(self):
        engine=self.engine();engine.generate(self.request(),self.root/'align');lip=engine.generate(self.lip(),self.root/'lip');self.assertEqual(self.loads,['align','lip_sync']);self.assertIn(('close',),self.backend_calls);self.assertEqual(lip['operation'],'lip_sync');self.assertTrue(lip['metadata']['needsReview']);self.assertFalse(lip['metadata']['qualityVerified']);self.assertEqual(lip['metadata']['videoSHA256'],self.lip()['video']['sha256']);self.assertNotEqual(Path(lip['videoPath']),self.root/'lip/original.mp4')

    def test_face_binding_and_multiple_faces_fail_before_backend_loading(self):
        engine=self.engine()
        for field,value in [('faceCount',2),('faceCount',0),('reviewed',False),('characterId','wrong'),('sourceVideoSHA256','f'*64)]:
            request=self.lip();request['targetFace'][field]=value
            with self.assertRaisesRegex(ValueError,'FACE_REVIEW'):engine.generate(request,self.root/'blocked')
        self.assertEqual(self.loads,[]);self.assertEqual(self.backend_calls,[])

    def test_audio_tamper_wrong_locale_video_tamper_and_long_chunks_reject(self):
        for request in [self.request(audio_bytes=wav(seconds=2)),self.request(locale='en'),self.request(audio_bytes=wav(rate=16000)),self.lip(video_bytes=b'bad'),self.request(audio_bytes=wav(seconds=121))]:
            with self.assertRaises(ValueError):runtime.validate_request(request)

    def test_ready_scope_and_rights_are_not_assumed_from_files(self):
        self.mark(accountId='foreign')
        with self.assertRaisesRegex(RuntimeError,'WEIGHTS_NOT_READY'):self.engine().prepare()
        self.mark(licenses={'licenseAccepted':True,'faceModelRightsApproved':False})
        with self.assertRaisesRegex(RuntimeError,'COMMERCIAL_RIGHTS'):self.engine().prepare()
        self.mark();(self.model/self.faces[0]['path']).write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError,'WEIGHTS_NOT_READY'):self.engine().prepare()

    def test_explicit_preparation_hashes_files_and_extracts_only_face_components(self):
        folder=self.root/'prepared';downloads=[]
        def download(spec,target):downloads.append(spec['path']);target.write_bytes(self.bytes[spec['path']])
        value=prepare.prepare_models(self.packet(),model_dir=folder,results_dir=self.root/'results',engine_id=ENGINE,account_id='account-one',downloader=download);self.assertTrue(value['ready']);self.assertFalse(value['gpuUsed']);self.assertEqual(len(downloads),2);self.assertEqual(len(list((folder/'face/extracted').glob('*.onnx'))),2);self.assertFalse((folder/'face/extracted/w600k_r50.onnx').exists());self.assertTrue(runtime.verify_local_model(folder,{'engineId':ENGINE,'accountId':'account-one'}));again=prepare.prepare_models(self.packet(),model_dir=folder,results_dir=self.root/'results',engine_id=ENGINE,account_id='account-one',downloader=download);self.assertEqual(again,value);self.assertEqual(len(downloads),2)

    def test_no_acknowledgement_can_silently_authorize_preparation_or_deployment(self):
        for extra in [{'paidApproved':False},{'licenseAccepted':False},{'faceModelRightsApproved':False},{'rightsEvidence':''}]:
            with self.assertRaises(ValueError):prepare.prepare_models(self.packet(**extra),model_dir=self.root/'never',results_dir=self.root/'results',engine_id=ENGINE,account_id='account-one',downloader=lambda *_:self.fail('no download'))
        with self.assertRaisesRegex(ValueError,'APPROVAL_REQUIRED'):deploy.deploy_latentsync_app({},client=object())
        with self.assertRaisesRegex(ValueError,'COMMERCIAL_RIGHTS'):deploy.deploy_latentsync_app({'paidApproved':True},client=object(),paid_approved=True,license_accepted=True)
        self.assertFalse((self.root/'never').exists())

    def test_unsafe_face_archive_paths_do_not_escape_scoped_storage(self):
        archive=self.model/'face/buffalo_m.zip'
        with zipfile.ZipFile(archive,'w') as z:z.writestr('../det_2.5g.onnx',b'unsafe');z.writestr('2d106det.onnx',b'unsafe')
        with self.assertRaisesRegex(ValueError,'UNSAFE_ARCHIVE'):prepare.extract_faces(self.model)

    def test_shared_bridge_accepts_native_alignment_contract_and_rejects_provenance_changes(self):
        request=self.request();native=self.engine().generate(request,self.root/'bridge-align');packet=self.bridge_packet(request);bridge.validate(packet);value={'scope':SCOPE,'status':'completed','operation':'align','modelRevision':self.manifest['revision'],'metadata':native};result=bridge.shape_output(value,packet);self.assertEqual(result['operation'],'align');self.assertEqual(result['alignment']['voiceProfileId'],'voice-one');self.assertEqual(result['alignment']['sentences'],native['alignment']['sentences'])
        changed={**value,'metadata':{**native,'speakerId':'other'}}
        with self.assertRaisesRegex(ValueError,'SCOPE_INVALID'):bridge.shape_output(changed,packet)
        with self.assertRaisesRegex(ValueError,'COMMERCIAL_RIGHTS'):bridge.validate({**packet,'faceModelRightsApproved':False})

    def test_shared_bridge_accepts_separate_lip_output_only_with_audio_and_review_marker(self):
        request=self.lip();native=self.engine().generate(request,self.root/'bridge-lip');data=Path(native.pop('videoPath')).read_bytes();packet=self.bridge_packet(request);value={'scope':SCOPE,'status':'completed','operation':'lip_sync','modelRevision':self.manifest['revision'],'metadata':{**native['metadata'],'sha256':hashlib.sha256(data).hexdigest(),'inferenceSeconds':native['inferenceSeconds']},'videoBytes':data};result=bridge.shape_output(value,packet);self.assertEqual(result['operation'],'lip_sync');self.assertEqual(result['sha256'],hashlib.sha256(data).hexdigest());self.assertTrue(result['metadata']['needsReview'])
        with self.assertRaisesRegex(ValueError,'UNCONFIRMED'):bridge.shape_output({**value,'metadata':{**value['metadata'],'hasAudio':False}},packet)


class DefinitionTests(unittest.TestCase):
    def config(self):return {'modelId':'latentsync16','engineId':ENGINE,'accountId':'account-one','modelVolume':'model-volume','resultsVolume':'mashhad-latentsync-results-'+hashlib.sha256(ENGINE.encode()).hexdigest()[:16],'weightPath':'models/latentsync16/'+ENGINE,'gpu':'L40S','cpu':4,'ramGiB':32}

    def test_only_named_scoped_resource_config_is_accepted(self):
        value=modal_app.deployment_config(self.config());self.assertEqual(value['gpu'],'L40S')
        for extra in [{'gpu':'RTX-PRO-6000'},{'cpu':8},{'ramGiB':96},{'weightPath':'../outside'},{'resultsVolume':'shared-volume'}]:
            with self.assertRaises(ValueError):modal_app.deployment_config({**self.config(),**extra})

    def test_real_sdk_definitions_register_offline_and_cloud_wrapper_avoids_upstream_name_collision(self):
        from modal._utils.async_utils import synchronizer
        app,_=modal_app.build_latentsync_app(self.config());self.assertEqual(set(app.registered_functions),{'prepare_models','LatentSyncEngine.*'})
        for function in app.registered_functions.values():self.assertFalse(synchronizer._translate_in(function)._get_source_info().is_serialized())
        module=sys.modules['latentsync_runtime.modal_app'];self.assertEqual(module.LatentSyncEngine.__module__,'latentsync_runtime.modal_app');self.assertFalse(runtime.manifest_for()['commercialReady']);self.assertIn('TORCH_FORCE_WEIGHTS_ONLY_LOAD',(Path(image.__file__).read_text(encoding='utf-8')))


class ResearchLicenseBoundaryTests(unittest.TestCase):
    def test_commercial_booleans_cannot_prepare_or_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with self.assertRaisesRegex(ValueError,'COMMERCIAL_RIGHTS'):
                prepare.prepare_models({'paidApproved':True,'licenseAccepted':True,'faceModelRightsApproved':True,'rightsEvidence':'arbitrary-not-a-commercial-grant'},model_dir=root/'models',results_dir=root/'results',engine_id=ENGINE,account_id='account-one',downloader=lambda *_:self.fail('must not download'))
            self.assertFalse((root/'models').exists())
    def test_commercial_booleans_cannot_deploy_or_build(self):
        with self.assertRaisesRegex(ValueError,'COMMERCIAL_RIGHTS'):
            deploy.deploy_latentsync_app({'paidApproved':True},paid_approved=True,license_accepted=True,face_model_rights_approved=True,rights_evidence='arbitrary-not-a-commercial-grant',sdk=SimpleNamespace())


if __name__=='__main__':unittest.main()
