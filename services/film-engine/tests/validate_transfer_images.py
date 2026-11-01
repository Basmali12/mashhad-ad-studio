"""Pinned SDK structural validation, no hydration, cloud RPCs or model reads."""
import inspect
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
os.environ['IFF_DEFINE_TRANSFER_WORKER']='YES'
from modal._utils.async_utils import synchronizer
from modal._image import _Image

def validate_image(image):
    # Replay only the SDK's mount bookkeeping and its own build-layer guard.
    # Never call a loader/resolver, which could contact Modal.
    seen=set()
    def check(node):
        if id(node) in seen:return
        seen.add(id(node))
        if callable(getattr(node,'_deps',None)):
            for dependency in node._deps():check(dependency)
        if not isinstance(node,_Image):return
        scope=inspect.getclosurevars(node._load).nonlocals
        if 'base_image' in scope and 'mount' in scope:
            node._deferred_mounts=[*scope['base_image']._mount_layers,scope['mount']]
        if scope.get('_do_assert_no_mount_layers'):
            for base in scope.get('base_images',{}).values():base._assert_no_mount_layers()
    check(synchronizer._translate_in(image))

if __name__=='__main__':
    import modal
    broken=modal.Image.debian_slim(python_version='3.12').add_local_file(__file__,'/root/fixture.py').env({'FIXTURE':'YES'})
    try:validate_image(broken)
    except modal.exception.InvalidError:pass
    else:raise AssertionError('Regression guard did not detect the original build-order error')
    # Structural validation uses a synthetic profile only and never hydration.
    import transfer_contract
    transfer_contract.require_model=lambda: {'fixture':True}
    from transfer_worker import image
    from destination_verifier_app import create_verifier_app
    validate_image(image)
    app,fn,_=create_verifier_app('mashhad-model-1234abcd',create_volume=False)
    # This SDK exposes registered function specs locally; no function is invoked.
    validate_image(synchronizer._translate_in(fn)._spec.image)
    print('SOURCE_AND_DESTINATION_IMAGE_ORDER_VALID_NO_CLOUD')
