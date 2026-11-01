"""Offline deployment guards. No network, services, PostgreSQL or provider use."""
from pathlib import Path
import importlib.util
import io
import tarfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('site_update', Path(__file__).resolve().parents[3] / 'scripts/deploy-site-update.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def archive(entries):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as tar:
        for name, body, symlink in entries:
            info = tarfile.TarInfo('release/' + name)
            info.size = len(body)
            if symlink:
                info.type = tarfile.SYMTYPE
                info.linkname = '/etc/passwd'
            tar.addfile(info, io.BytesIO(body))
    return data.getvalue()


class SiteUpdateGuards(unittest.TestCase):
    def test_exact_payload_and_hashes_required(self):
        body = b'export const tested=true;'
        row = {'path': 'shared/file.mjs', 'bytes': len(body), 'sha256': deploy.sha(body)}
        self.assertEqual(deploy.checked_payload(archive([(row['path'], body, False)]), [row]), {row['path']: body})
        with self.assertRaisesRegex(RuntimeError, 'SOURCE_HASH_MISMATCH'):
            deploy.checked_payload(archive([(row['path'], b'X' * len(body), False)]), [row])
        with self.assertRaisesRegex(RuntimeError, 'SOURCE_FILES_MISSING'):
            deploy.checked_payload(archive([]), [row])

    def test_archive_traversal_links_and_duplicates_rejected(self):
        row = {'path': 'shared/file', 'bytes': 1, 'sha256': deploy.sha(b'x')}
        for entries in [[('../escape', b'x', False)], [('shared/file', b'x', True)],
                        [('shared/file', b'x', False), ('shared/file', b'x', False)]]:
            with self.assertRaisesRegex(RuntimeError, 'UNSAFE_ARCHIVE'):
                deploy.checked_payload(archive(entries), [row])
        for path in ['/root/key', '../secret', 'a/../../b', 'a\\b', 'a;touch-b']:
            with self.assertRaises(RuntimeError):
                deploy.relative(path)

    def test_paid_flags_are_not_enabled_or_silently_changed(self):
        original = {'ENGINE_ALLOW_PAID_ACTIONS': 'NO', 'FILM_WAN_PAID_ENABLED': 'NO'}
        self.assertTrue(deploy.paid_execution_closed(original))
        self.assertFalse(deploy.paid_execution_closed({**original, 'FILM_FLUX_PAID_ENABLED': 'YES'}))
        self.assertFalse(deploy.paid_execution_closed({'ENGINE_ALLOW_PAID_ACTIONS': 'YES'}))
        self.assertFalse(deploy.paid_execution_closed({}))
        self.assertEqual(original, {'ENGINE_ALLOW_PAID_ACTIONS': 'NO', 'FILM_WAN_PAID_ENABLED': 'NO'})

    def test_untrusted_download_and_database_names_block_before_io(self):
        with patch.object(deploy.urllib.request, 'urlopen') as network:
            with self.assertRaisesRegex(RuntimeError, 'UNTRUSTED_SOURCE'):
                deploy.get('https://example.invalid/source')
            network.assert_not_called()
        with patch.object(deploy, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, 'WRONG_DATABASE'):
                deploy.sql({'ENGINE_DATABASE_NAME': 'postgres;DROP DATABASE'}, 'select 1')
            command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
