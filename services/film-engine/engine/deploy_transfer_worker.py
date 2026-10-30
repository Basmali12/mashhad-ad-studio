"""A separate explicitly approved deployment; never invoked by setup/import/tests."""
import argparse
import os
import json
import sys
PHASE='arguments'


def main():
    global PHASE
    parser=argparse.ArgumentParser()
    parser.add_argument('--approve-worker-deploy',action='store_true')
    parser.add_argument('--credentials-stdin',action='store_true')
    args=parser.parse_args()
    if not args.approve_worker_deploy:raise SystemExit('Deployment can incur image/resource costs. Separate approval required.')
    import modal
    from transfer_contract import APP_NAME,DICT_NAME,FUNCTION_NAME,FINGERPRINT,SOURCE_WORKSPACE
    PHASE='identity'
    if args.credentials_stdin:
        from modal_bridge import client
        c,name=client(json.loads(sys.stdin.readline()))
        if name!=SOURCE_WORKSPACE:raise SystemExit('TRUSTED_PRIMARY_WORKSPACE_REQUIRED')
    else:
        c=modal.Client.from_env()
    workspace=modal.Workspace.from_context(client=c);workspace.hydrate()
    if workspace.name!=SOURCE_WORKSPACE:raise SystemExit('Use the trusted primary workspace. No profile was changed.')
    PHASE='registry'
    try:
        prior=modal.Dict.from_name(DICT_NAME,client=c,create_if_missing=False,environment_name='main')
        if prior.get('active'):raise SystemExit('Reconcile the existing transfer before changing the worker deployment.')
    except modal.exception.NotFoundError:pass
    PHASE='definition'
    os.environ['IFF_DEFINE_TRANSFER_WORKER']='YES'
    from transfer_worker import app
    PHASE='deployment'
    app.deploy(name=APP_NAME,environment_name='main',client=c)
    PHASE='record'
    fn=modal.Function.from_name(APP_NAME,FUNCTION_NAME,environment_name='main',client=c);fn.hydrate()
    # Named Dict references in a deployed function remain lazy until execution.
    # Create its control-plane registry during this explicitly approved deploy.
    state=modal.Dict.from_name(DICT_NAME,client=c,create_if_missing=True,environment_name='main')
    state.put('deployment',{'fingerprint':FINGERPRINT,'functionId':fn.object_id,'appId':app.app_id})
    print('CPU_WORKER_DEPLOYED_NO_TRANSFER_NO_GPU')


if __name__=='__main__':
    try:main()
    except BaseException as error:
        # Structured diagnostics only. Never print SDK messages or credentials.
        print(json.dumps({'type':'worker_deploy_diagnostic','stage':PHASE,'errorClass':type(error).__name__}),flush=True)
        sys.exit(1)
