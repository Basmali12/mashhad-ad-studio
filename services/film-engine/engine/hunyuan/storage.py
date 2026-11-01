"""Canonicalize only deployment-owned mount anchors, never user namespaces."""
from pathlib import Path


def canonical_mount(name):
    if name not in ('/models', '/results'):
        raise ValueError('FLUX_UNSAFE_STORAGE')
    # Modal can mount a Volume through a platform-owned alias. Resolve that
    # anchor once; child symlinks remain forbidden by scoped_directory/runtime.
    root = Path(name).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('FLUX_UNSAFE_STORAGE')
    return root


def scoped_directory(root, relative):
    root = Path(root)
    parts = relative.split('/')
    if not parts or any(part in ('', '.', '..') or '\\' in part or ':' in part for part in parts):
        raise ValueError('FLUX_UNSAFE_STORAGE')
    target = root
    for part in parts:
        target = target / part
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError('FLUX_UNSAFE_STORAGE')
    return target
