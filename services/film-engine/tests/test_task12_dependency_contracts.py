"""Offline regressions from official PyPI version metadata checked 2026-10-31.

This checks known direct constraints, not a successful Linux/CUDA image build.
https://pypi.org/pypi/tokenizers/0.23.1/json: huggingface-hub >=0.16.4,<2.0
https://pypi.org/pypi/diffusers/0.42.1/json: huggingface-hub >=1.32.0,<3.0
https://pypi.org/pypi/transformers/5.22.1/json: huggingface-hub >=1.31.0,<3.0
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]/'engine'
MODELS=('flux','qwen','wan','hunyuan')

def pins(file):
    return dict(re.findall(r'^([A-Za-z0-9_-]+)==([^\s#]+)',file.read_text(encoding='utf-8'),re.M))

def satisfies_hub_constraints(version):
    numbers=tuple(int(v) for v in version.split('.'))
    return (1,32,0)<=numbers<(2,0,0)

class DependencyContracts(unittest.TestCase):
    def test_gpu_profiles_satisfy_official_direct_hub_intersection(self):
        for model in MODELS:
            with self.subTest(model=model):
                p=pins(ROOT/model/'requirements-gpu.lock')
                self.assertEqual(p['tokenizers'],'0.23.1')
                self.assertEqual(p['diffusers'],'0.42.1')
                self.assertEqual(p['transformers'],'5.22.1')
                self.assertTrue(satisfies_hub_constraints(p['huggingface-hub']))

    def test_preparation_remains_cpu_only_and_matches_selected_hub(self):
        for model in MODELS:
            with self.subTest(model=model):
                cpu=pins(ROOT/model/'requirements-cpu.lock')
                gpu=pins(ROOT/model/'requirements-gpu.lock')
                self.assertEqual(cpu['huggingface-hub'],gpu['huggingface-hub'])
                self.assertNotIn('torch',cpu)
                self.assertNotIn('diffusers',cpu)

    def test_previous_pin_is_demonstrably_incompatible(self):
        self.assertFalse(satisfies_hub_constraints('2.4.0'))
        self.assertTrue(satisfies_hub_constraints('1.32.0'))

if __name__=='__main__':unittest.main()
