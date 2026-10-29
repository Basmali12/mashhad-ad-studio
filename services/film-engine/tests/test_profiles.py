"""CPU-only tests. Modal and engine classes are isolated stubs; no real SDK calls."""
import ast
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

RUNTIME=Path(__file__).resolve().parents[1]/'engine'/'runtime'
sys.path.insert(0,str(RUNTIME))

class Profiles(unittest.TestCase):
    def test_standalone_rpc_preserves_authored_prompt_without_synthetic_timeline(self):
        from story import window_instructions
        authored='A wallet falls. A young man picks it up, then calls in Arabic. Preserve the exact authored spoken line.'
        plan={'standalone_scene':True,'duration_seconds':10,'frames':241,'window_seconds':10,
              'scene':authored,'events':[{'id':'scene','start_frame':0,'end_frame':241,
              'before':'Opening state','action':'Specific authored action','after':'Final state','dialogue':[],'completed_before':[]}]}
        result=window_instructions(plan)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['prompt'],authored)
        self.assertNotIn('At +0.00s',result[0]['prompt'])
        self.assertNotIn('carried prefix',result[0]['prompt'])
        plan['events'][0]['dialogue']=[{'speaker':'The young man','text':'عمي، لحظة!'}]
        with self.assertRaisesRegex(ValueError,'embedded dialogue contract'):window_instructions(plan)

    def test_configuration_validates_profile(self):
        for value,success in [('conv-stable',True),('dfr-main',True),('dfr-candidate',True),('typo',False)]:
            result=subprocess.run([sys.executable,'-c','import settings; print(settings.INFERENCE_PROFILE)'],cwd=RUNTIME,env={**os.environ,'LTX_INFERENCE_PROFILE':value},capture_output=True,text=True)
            self.assertEqual(result.returncode==0,success)
            if success:self.assertEqual(result.stdout.strip(),'dfr-main' if value=='dfr-candidate' else value)

    def test_default_manifest_is_dfr_main_and_legacy_manifest_is_unchanged(self):
        import json
        env={k:v for k,v in os.environ.items() if k!='LTX_INFERENCE_PROFILE'}
        result=subprocess.run([sys.executable,'-c','import settings,json;print(json.dumps([settings.INFERENCE_PROFILE,settings.PROFILE_MANIFEST["pipeline"],len(settings.PROFILE_MANIFEST["files"]),len(settings.MANIFEST["files"])]))'],cwd=RUNTIME,env=env,capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout),['dfr-main','DFRPipeline',6,5])

    def test_gpu_selects_dfr_main_and_explicit_conv_rollback(self):
        import settings
        modal=types.SimpleNamespace(enter=lambda:lambda fn:fn,exit=lambda:lambda fn:fn,method=lambda **kwargs:lambda fn:fn)
        conv=type('ConvFixture',(),{});dfr=type('DfrFixture',(),{})
        with patch.dict(sys.modules,{'modal':modal,'engine':types.SimpleNamespace(StoryEngine=conv),'dfr_engine':types.SimpleNamespace(DfrStoryEngine=dfr)}):
            import gpu_service
            with patch.object(settings,'INFERENCE_PROFILE','conv-stable'):self.assertIs(gpu_service.selected_engine_class(),conv)
            with patch.object(settings,'INFERENCE_PROFILE','dfr-main'):self.assertIs(gpu_service.selected_engine_class(),dfr)

    def test_metadata_discovery_uses_same_selected_manifest(self):
        tree=ast.parse((RUNTIME.parent/'modal_bridge.py').read_text())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='quality_discover')
        shared=next(n for n in fn.body if isinstance(n,ast.ImportFrom) and n.module=='runtime.inference_profile')
        self.assertEqual(shared.names[0].name,'PROFILE_MANIFEST')

    def test_missing_cpu_detector_fails_without_model_fetch(self):
        # model_path fails before detector construction; no RapidOCR/SDK import.
        import importlib.util
        spec=importlib.util.spec_from_file_location('isolated_video_text',RUNTIME.parent/'video_text.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with patch.object(module.importlib.util,'find_spec',return_value=None):
            with self.assertRaisesRegex(RuntimeError,'TEXT_DETECTOR_NOT_INSTALLED'):module.model_path()

    def test_image_profile_is_pinned_and_conv_code_is_included(self):
        tree=ast.parse((RUNTIME/'benchmark_image.py').read_text())
        static=next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STATIC_ENV' for t in n.targets))
        env=dict(zip([k.value for k in static.keys],static.values))
        self.assertEqual(env['LTX_INFERENCE_PROFILE'].id,'INFERENCE_PROFILE')
        add=next(n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='add_local_dir')
        ignored=next(k.value for k in add.keywords if k.arg=='ignore')
        self.assertNotIn('engine.py',ast.literal_eval(ignored))

if __name__=='__main__':unittest.main()
