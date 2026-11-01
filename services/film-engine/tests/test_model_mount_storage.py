"""Cross-package mount safety; offline, with no SDK hydration or model downloads."""
import ast
import importlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / 'engine'
sys.path.insert(0, str(ROOT))
PACKAGES = ('qwen', 'wan', 'hunyuan', 'speech')


class CrossModelStorageTests(unittest.TestCase):
    def test_independent_packages_include_exact_tested_helper(self):
        expected = (ROOT / 'flux/storage.py').read_bytes()
        for name in PACKAGES:
            with self.subTest(package=name):
                self.assertEqual((ROOT / name / 'storage.py').read_bytes(), expected)

    def test_only_known_mount_anchors_resolve_platform_alias(self):
        with tempfile.TemporaryDirectory() as folder:
            canonical = Path(folder).resolve()
            for name in PACKAGES:
                module = importlib.import_module(name + '.storage')
                for anchor in ('/models', '/results'):
                    with self.subTest(package=name, anchor=anchor), patch.object(module, 'Path') as path:
                        path.return_value.resolve.return_value = canonical
                        self.assertEqual(module.canonical_mount(anchor), canonical)
                        path.assert_called_once_with(anchor)
                        path.return_value.resolve.assert_called_once_with(strict=True)
                with patch.object(module, 'Path') as path:
                    for anchor in ('/tmp', '/models/child', '/models/../results'):
                        with self.assertRaises(ValueError):
                            module.canonical_mount(anchor)
                    path.assert_not_called()

    def test_untrusted_descendants_rejected_before_any_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for name in PACKAGES:
                module = importlib.import_module(name + '.storage')
                with self.subTest(package=name):
                    self.assertEqual(module.scoped_directory(root, 'runs/run/results'), root / 'runs/run/results')
                    for relative in ('../escape', '/absolute', 'runs/../../escape', 'runs\\escape', 'C:/escape', 'runs//escape'):
                        with self.assertRaises(ValueError):
                            module.scoped_directory(root, relative)
                    with patch.object(Path, 'is_symlink', return_value=True):
                        with self.assertRaises(ValueError):
                            module.scoped_directory(root, 'runs/run/results')
                    self.assertEqual(list(root.iterdir()), [])

    def test_model_factories_canonicalize_roots_and_guard_all_output_directories(self):
        for name in PACKAGES:
            with self.subTest(package=name):
                source = (ROOT / name / 'modal_app.py').read_text(encoding='utf-8')
                tree = ast.parse(source)
                self.assertNotIn("Path('/models')", source)
                self.assertNotIn("Path('/results')", source)
                prepare = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'prepare_models')
                text = ast.get_source_segment(source, prepare)
                self.assertIn("model_dir=scoped_directory(canonical_mount('/models'),config['weightPath'])", text)
                self.assertIn("results_dir=canonical_mount('/results')", text)
                self.assertIn("scoped_directory(results_dir,'preparations')", text)
                self.assertIn('results_dir=results_dir', text)
                self.assertLess(text.index("scoped_directory(results_dir,'preparations')"), text.index('modal.Volume.from_name'))
                self.assertIn("self.results_root=canonical_mount('/results')", source)
                for relative in ("'runs/'+self.runtime_id", "'runs/'+self.runtime_id+'/results'", "'runs/'+self.runtime_id+'/progress'"):
                    self.assertIn('scoped_directory(self.results_root,' + relative + ')', source)


if __name__ == '__main__':
    unittest.main()
