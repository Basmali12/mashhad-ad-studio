"""Local mount-alias regression; no Modal requests or model downloads."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from flux.storage import canonical_mount, scoped_directory


class StorageTests(unittest.TestCase):
    def test_resolves_only_platform_mount_anchor(self):
        with tempfile.TemporaryDirectory() as folder:
            canonical = Path(folder).resolve()
            with patch('flux.storage.Path') as path:
                path.return_value.resolve.return_value = canonical
                self.assertEqual(canonical_mount('/models'), canonical)
                path.return_value.resolve.assert_called_once_with(strict=True)
            self.assertEqual(scoped_directory(canonical, 'models/flux/engine'), canonical/'models/flux/engine')

    def test_untrusted_mount_cannot_be_resolved(self):
        with patch('flux.storage.Path') as path:
            for name in ('/tmp', '/models/../results', '/models/child'):
                with self.assertRaisesRegex(ValueError, 'FLUX_UNSAFE_STORAGE'):
                    canonical_mount(name)
            path.assert_not_called()

    def test_missing_or_non_directory_mount_rejected(self):
        with patch('flux.storage.Path') as path:
            path.return_value.resolve.side_effect = FileNotFoundError()
            with self.assertRaises(FileNotFoundError):
                canonical_mount('/results')
            path.return_value.resolve.side_effect = None
            path.return_value.resolve.return_value.is_dir.return_value = False
            with self.assertRaisesRegex(ValueError, 'FLUX_UNSAFE_STORAGE'):
                canonical_mount('/results')

    def test_child_traversal_and_symlink_rejected_before_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for relative in ('../escape', '/absolute', 'a/../../escape', 'a\\escape', 'C:/escape'):
                with self.assertRaisesRegex(ValueError, 'FLUX_UNSAFE_STORAGE'):
                    scoped_directory(root, relative)
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaisesRegex(ValueError, 'FLUX_UNSAFE_STORAGE'):
                    scoped_directory(root, 'models/flux/engine')
            self.assertEqual(list(root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
