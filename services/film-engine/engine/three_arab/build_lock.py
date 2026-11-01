"""Repair publisher's stale workspace label without resolving dependencies.

All versions, dependency edges and package hashes remain byte-for-byte unchanged.
Reject any upstream lock other than the reviewed revision.
"""
import hashlib
from pathlib import Path

EXPECTED='636b6c536a0a35acc4a31b7571a53f3ca86a409801e5fb6363f65376a9705e2f'
OLD=b'name = "irodori-tts"'
NEW=b'name = "arabic-tts"'

def repair(data):
 if hashlib.sha256(data).hexdigest()!=EXPECTED or data.count(OLD)!=1:
  raise RuntimeError('THREE_ARAB_UPSTREAM_LOCK_CHANGED')
 return data.replace(OLD,NEW,1)

if __name__=='__main__':
 import sys
 if len(sys.argv)!=2:raise ValueError('LOCK_PATH_REQUIRED')
 p=Path(sys.argv[1]);p.write_bytes(repair(p.read_bytes()))
