"""Reproduce the SDK version failure without building any cloud image."""
import os
import unittest
from unittest.mock import patch
from modal._image import _get_image_builder_version
from modal.exception import VersionError


class BuilderCompatibilityTests(unittest.TestCase):
    def test_new_workspace_builder_reproduces_pinned_sdk_failure(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('MODAL_IMAGE_BUILDER_VERSION', None)
            with self.assertRaises(VersionError):
                _get_image_builder_version('2026.01')

    def test_supported_local_override_uses_tested_builder_without_workspace_mutation(self):
        with patch.dict(os.environ, {'MODAL_IMAGE_BUILDER_VERSION':'2025.06'}):
            self.assertEqual(_get_image_builder_version('2026.01'), '2025.06')


if __name__ == '__main__':
    unittest.main()
