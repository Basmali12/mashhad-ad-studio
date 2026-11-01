from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from flux_modal_bridge import private_cached_preparation
import flux_modal_bridge as bridge

class CachedPreparationTests(unittest.TestCase):
    def fixture(self):
        manifest={'revision':'pinned','files':[{'path':'weights.bin','size':123,'sha256':'a'*64}]}
        definition={'accountId':'primary','modelId':'wan22-i2v-a14b','volume':'private-weights','weightPath':'models/wan/private'}
        request={'action':'prepare','privateReuseVerifiedWeights':True,'paidApproved':True,'definition':definition,'missingFiles':[],
                 'credentials':{'expectedWorkspace':'basm1998ali'}}
        inspection={'ready':True,'deploymentReady':True,'accountId':'primary','volume':'private-weights','weightPath':'models/wan/private',
                    'revision':'pinned','files':[{**manifest['files'][0],'present':True,'verified':True}]}
        return request,inspection,manifest
    def test_exact_verified_scoped_cache_is_labeled_not_a_fresh_hash(self):
        r,i,m=self.fixture();out=private_cached_preparation(r,i,0,m)
        self.assertEqual(out['status'],'completed');self.assertTrue(out['cloudStopped']);self.assertFalse(out['gpuUsed'])
        self.assertEqual(out['progress']['completedBytes'],123)
        self.assertIn('not_fresh_full_file_hash',out['verification'])
        self.assertNotIn('functionCallId',out)
    def test_incomplete_foreign_or_unverified_cache_never_skips_verification(self):
        for target,key,value in [('r','privateReuseVerifiedWeights',False),('r','paidApproved',False),('r','missingFiles',[{}]),
                                 ('i','ready',False),('i','deploymentReady',False),('i','accountId','foreign'),
                                 ('i','volume','foreign'),('i','weightPath','foreign'),('i','revision','changed'),('i','files',[])]:
            with self.subTest(key=key):
                r,i,m=self.fixture();(r if target=='r' else i)[key]=value
                with self.assertRaisesRegex(ValueError,'CACHED_PREPARATION_NOT_READY'):private_cached_preparation(r,i,0,m)
        for field in ('present','verified','sha256','size'):
            r,i,m=self.fixture();i['files'][0][field]=False
            with self.assertRaises(ValueError):private_cached_preparation(r,i,0,m)
    def test_no_other_workspace_audar_latentsync_or_active_resources(self):
        for model in ['audar-tts-v1-flash','latentsync16','unknown']:
            r,i,m=self.fixture();r['definition']['modelId']=model
            with self.assertRaises(ValueError):private_cached_preparation(r,i,0,m)
        r,i,m=self.fixture();r['credentials']['expectedWorkspace']='another'
        with self.assertRaises(ValueError):private_cached_preparation(r,i,0,m)
        r,i,m=self.fixture()
        with self.assertRaises(ValueError):private_cached_preparation(r,i,1,m)
    def test_dispatch_denies_bad_private_scope_before_client_or_deploy(self):
        for mode in ('workspace','audar','latentsync','missing'):
            r,i,m=self.fixture()
            if mode=='workspace':r['credentials']['expectedWorkspace']='foreign'
            elif mode=='audar':r['definition']['modelId']='audar-tts-v1-flash'
            elif mode=='latentsync':r['definition']['modelId']='latentsync16'
            else:r['missingFiles']=[{'path':'missing'}]
            with patch.object(bridge,'validate',return_value=(r['definition'],m)),patch.object(bridge,'client') as client,patch.object(bridge,'metadata') as metadata:
                with self.assertRaisesRegex(ValueError,'CACHED_PREPARATION_NOT_READY'):bridge.dispatch(r)
                client.assert_not_called();metadata.assert_not_called()

if __name__=='__main__':unittest.main()
