"""Explicit CPU-only preparation of pinned new-engine weights. Import is inert.

Uses existing preparers and their integrity receipts. No inference, financial
ledger mutation, customer publication, credentials or arbitrary repositories.
"""
import importlib
import json
from pathlib import Path
import re
import time
from flux.storage import canonical_mount, scoped_directory

MODELS = {'qwen-image-edit-2511':'qwen', 'wan22-i2v-a14b':'wan',
          'hunyuanvideo15':'hunyuan', 'habibi-irq':'speech',
          'habibi-egy':'speech', 'habibi-msa':'speech', 'audar-tts-v1-flash':'speech'}
ID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')


def model_profile(model_id):
    package = MODELS[model_id]
    runtime = importlib.import_module(package+'.runtime')
    manifest = runtime.manifest_for(model_id) if package=='speech' else runtime.MANIFEST
    fingerprint = runtime.manifest_fingerprint(model_id) if package=='speech' else runtime.manifest_fingerprint()
    return manifest, fingerprint


def validate_plan(plan):
    if not isinstance(plan,dict) or plan.get('approved') is not True or plan.get('workspace')!='basm1998ali' or not ID.fullmatch(plan.get('accountId','')):
        raise ValueError('WEIGHTS_APPROVAL_REQUIRED')
    name=plan.get('appName','')
    storage_id=plan.get('storageId',name[-12:])
    if not re.fullmatch(r'mashhad-weights-[a-f0-9]{12}',name) or not re.fullmatch(r'[a-f0-9]{12}',storage_id) or plan.get('modelVolume')!='mashhad-models-'+storage_id or plan.get('resultsVolume')!='mashhad-preparations-'+storage_id:raise ValueError('WEIGHTS_INVALID_PLAN')
    if plan.get('receiptPath','batch.json') not in ('batch.json','batch-'+name[-12:]+'.json'):raise ValueError('WEIGHTS_INVALID_PLAN')
    rows=plan.get('models')
    if not isinstance(rows,list) or not rows or len(rows)>len(MODELS):raise ValueError('WEIGHTS_INVALID_PLAN')
    seen=set()
    for row in rows:
        model_id=row.get('modelId')
        if model_id not in MODELS or model_id in seen or not ID.fullmatch(row.get('engineId','')):raise ValueError('WEIGHTS_INVALID_PLAN')
        seen.add(model_id);manifest,fingerprint=model_profile(model_id)
        if row.get('revision')!=manifest['revision'] or row.get('manifestFingerprint')!=fingerprint:raise ValueError('WEIGHTS_MANIFEST_CHANGED')
        if model_id=='hunyuanvideo15' and plan.get('hunyuanLicenseAccepted') is not True:raise ValueError('WEIGHTS_LICENSE_REQUIRED')
        if model_id=='audar-tts-v1-flash' and (plan.get('audarLicenseAccepted') is not True or plan.get('codecLicenseAccepted') is not True):raise ValueError('WEIGHTS_LICENSE_REQUIRED')
    return rows


def run_batch(plan, *, model_root=None, result_root=None, commit=lambda:None, preparers=None, access_check=None):
    rows=validate_plan(plan)
    model_root=model_root or canonical_mount('/models')
    result_root=result_root or canonical_mount('/results')
    index=scoped_directory(result_root,plan.get('receiptPath','batch.json'))
    if index.exists():raise ValueError('WEIGHTS_BATCH_ALREADY_DISPATCHED')
    results=[]
    def checkpoint(status):
        value={'status':status,'weightsOnly':True,'gpuUsed':False,'inferenceVerified':False,
               'accountId':plan['accountId'],'results':results,'updatedAt':int(time.time()*1000)}
        temporary=index.with_suffix('.pending');temporary.write_text(json.dumps(value,sort_keys=True));temporary.replace(index);commit()
        return value
    checkpoint('running')
    for row in rows:
        model_id=row['modelId'];manifest,_=model_profile(model_id)
        result={'modelId':model_id,'engineId':row['engineId'],'revision':row['revision'],'status':'running'}
        results.append(result);checkpoint('running')
        try:
            if model_id=='audar-tts-v1-flash':
                # Check *all* gated components before downloading any public part.
                if access_check is None:
                    from speech.access import verify_component_access
                    import os
                    check=lambda spec:verify_component_access(spec,os.environ.get('HF_TOKEN'))
                else:check=access_check
                for spec in manifest['files']:
                    if spec.get('gated'):check(spec)
            root=scoped_directory(model_root,'models/'+model_id+'/'+row['engineId'])
            output=scoped_directory(result_root,'models/'+row['engineId']);output.mkdir(parents=True,exist_ok=True)
            scoped_directory(output,'preparations')
            operation='prepare-'+model_id+('-'+plan['appName'][-12:] if plan.get('resume') else '')
            scope={'engineId':row['engineId'],'accountId':plan['accountId'],'runId':operation,'requestId':operation}
            request={'paidApproved':True,'modelId':model_id,'modelRevision':row['revision'],
                     'manifestFingerprint':row['manifestFingerprint'],'scope':scope,
                     'licenseAccepted':True,'codecLicenseAccepted':True}
            prepare=(preparers or {}).get(model_id) or importlib.import_module(MODELS[model_id]+'.prepare').prepare_models
            receipt=prepare(request,model_dir=root,results_dir=output,engine_id=row['engineId'],account_id=plan['accountId'],commit=commit)
            if receipt.get('status')!='completed' or receipt.get('ready') is not True:raise RuntimeError('WEIGHTS_PREPARATION_UNCONFIRMED')
            result.update(status='completed',weightPath=str(root.relative_to(model_root)),bytes=manifest['totalBytes'],files=len(manifest['files']))
        except Exception as error:
            from speech.access import ACCESS_ERRORS
            code=str(error) if type(error) is RuntimeError and str(error) in ACCESS_ERRORS else 'WEIGHTS_PREPARATION_FAILED'
            result.update(status='blocked' if code in ACCESS_ERRORS else 'failed',error=code)
            checkpoint('running' if code in ACCESS_ERRORS else 'failed')
            if code not in ACCESS_ERRORS:raise RuntimeError(code) from None
        checkpoint('running')
    return checkpoint('completed_with_blockers' if any(r['status']=='blocked' for r in results) else 'completed')


def prepare_batch(plan):
    import modal
    weights=modal.Volume.from_name(plan['modelVolume'],create_if_missing=False)
    results=modal.Volume.from_name(plan['resultsVolume'],create_if_missing=False)
    def commit():weights.commit();results.commit()
    return run_batch(plan,commit=commit)


def build_cpu_app(plan, sdk=None):
    validate_plan(plan)
    if sdk is None:import modal as sdk
    root=Path(__file__).resolve().parent
    image=sdk.Image.debian_slim(python_version='3.12').pip_install_from_requirements(str(root/'flux/requirements-cpu.lock'))
    for package in ('flux','qwen','wan','hunyuan','speech'):
        image=image.add_local_dir(root/package,'/root/'+package,ignore=['__pycache__','*.pyc'])
    image=image.add_local_file(__file__,'/root/weight_batch.py')
    weights=sdk.Volume.from_name(plan['modelVolume'],create_if_missing=False)
    results=sdk.Volume.from_name(plan['resultsVolume'],create_if_missing=False)
    app=sdk.App(plan['appName'])
    secrets=[sdk.Secret.from_name('mashhad-hf-read')] if plan.get('hfSecretPresent') is True else []
    app.function(name='prepare_batch',image=image,include_source=False,cpu=(2,2),memory=(8192,8192),
                 timeout=2400,startup_timeout=180,retries=0,max_containers=1,min_containers=0,
                 buffer_containers=0,scaledown_window=2,secrets=secrets,
                 volumes={'/models':weights,'/results':results})(prepare_batch)
    return app
