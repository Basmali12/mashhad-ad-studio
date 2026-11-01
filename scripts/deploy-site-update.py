"""Owner-authorized, hash-verified existing-site update. No backup, GPU or DNS.

Run `inspect` before `apply`. Uses only the exact committed source/static files
in the reviewed manifest, preserving configuration, dependencies and user data.
"""
from pathlib import Path, PurePosixPath
import hashlib
import hmac
import io
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid

REPOSITORY = 'Basmali12/mashhad-ad-studio'
FILM_ROOT = Path('/srv/iraq-ai-studio-staging/current')
GATEWAY_ROOT = Path('/srv/mashhad-film/current')
ADMIN_ROOT = Path('/srv/mashhad-admin/current')
ENV_FILES = [Path('/etc/iraq-ai-film-platform-staging/film.env'),
             Path('/etc/mashhad-film/gateway.env')]
UNITS = ['iraq-ai-film-platform-staging', 'mashhad-film-gateway']
PROTECTED_KINDS = ['account', 'film-credit', 'film-customer', 'film-project',
                   'production-project', 'production-asset', 'film-file',
                   'film-library-file', 'production-charge', 'film-charge', 'rental']


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args, timeout=60):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    require(result.returncode == 0, 'LOCAL_COMMAND_FAILED')
    return result.stdout.decode('utf-8').strip()


def envread(path):
    values = {}
    for line in path.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            name, value = line.split('=', 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def relative(name):
    require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', name), 'INVALID_PATH')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and '.' not in p.parts, 'INVALID_PATH')
    return p


def get(url, maximum=32 * 1024 * 1024):
    require(url.startswith(('https://raw.githubusercontent.com/' + REPOSITORY + '/',
                            'https://codeload.github.com/' + REPOSITORY + '/')), 'UNTRUSTED_SOURCE')
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(maximum + 1)
    require(len(data) <= maximum, 'SOURCE_TOO_LARGE')
    return data


def checked_payload(archive_bytes, rows):
    require(isinstance(rows, list) and len(rows) <= 1000, 'INVALID_MANIFEST')
    wanted = {}
    for row in rows:
        name = str(relative(row['path']))
        require(name not in wanted and 0 <= row['bytes'] <= 8 * 1024 * 1024
                and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'INVALID_MANIFEST')
        wanted[name] = row
    found = {}
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            require(parts and '..' not in parts and not member.name.startswith('/'), 'UNSAFE_ARCHIVE')
            name = '/'.join(parts[1:])
            if name not in wanted:
                continue
            require(member.isfile() and not member.issym() and not member.islnk()
                    and member.size == wanted[name]['bytes'] and name not in found, 'UNSAFE_ARCHIVE')
            data = archive.extractfile(member).read()
            require(sha(data) == wanted[name]['sha256'], 'SOURCE_HASH_MISMATCH')
            found[name] = data
    require(set(found) == set(wanted), 'SOURCE_FILES_MISSING')
    return found


def sql(env, query):
    database = env.get('ENGINE_DATABASE_NAME', '')
    require(re.fullmatch('film_platform_[a-z0-9_]+', database), 'WRONG_DATABASE')
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-d', database, '-Atc', query])


def data_digest(env):
    names = ','.join("'" + k + "'" for k in PROTECTED_KINDS)
    value = sql(env, "select kind,count(*),md5(string_agg((case when kind='film-customer' then data-'updatedAt' else data end)::text,'' order by id)) "
                "from iff_records where kind in (" + names + ') group by kind order by kind')
    return sha(value.encode())


def paid_execution_closed(env):
    return env.get('ENGINE_ALLOW_PAID_ACTIONS') == 'NO' and not any(
        k.startswith('FILM_') and k.endswith('_PAID_ENABLED') and v == 'YES'
        for k, v in env.items())


def inspect():
    require(os.geteuid() == 0 and socket.gethostname() == 'muhtaj-app', 'WRONG_SERVER')
    film, gateway = [envread(p) for p in ENV_FILES]
    for root in [FILM_ROOT, GATEWAY_ROOT, ADMIN_ROOT]:
        require(root.is_dir() and root.resolve().is_relative_to('/srv'), 'UNEXPECTED_LAYOUT')
    require((FILM_ROOT / 'services/film-engine/service.mjs').is_file()
            and (GATEWAY_ROOT / 'services/film-gateway/server.mjs').is_file()
            and (ADMIN_ROOT / 'index.html').is_file(), 'UNEXPECTED_LAYOUT')
    require(run(['systemctl', 'show', UNITS[1], '-p', 'WorkingDirectory', '--value'])
            == str(GATEWAY_ROOT), 'UNEXPECTED_SERVICE_ROOT')
    states = {u: run(['systemctl', 'is-active', u]) for u in UNITS}
    require(all(v == 'active' for v in states.values()), 'SERVICE_ALREADY_UNHEALTHY')
    require(paid_execution_closed(film), 'PAID_GATE_NOT_CLOSED')
    active = int(sql(film, "select count(*) from iff_records where "
        "(kind='job' and coalesce(data->>'cloudStopped','false')!='true' "
        "and data->>'action' in ('start','generate','prepare')) or "
        "(kind='rental' and data->>'state'!='closed') or "
        "(kind='production-attempt' and data->>'status' in ('running','submitted','uncertain')) or "
        "(kind='engine-runtime' and coalesce(data->>'cloudStopped','false')!='true')"))
    require(active == 0, 'ACTIVE_WORK_NO_RESTART')
    require(film.get('FILM_BRIDGE_SECRET') == gateway.get('FILM_BRIDGE_SECRET')
            and len(film.get('FILM_BRIDGE_SECRET', '')) >= 32, 'BRIDGE_CONFIG_MISMATCH')
    return film, gateway, {'activeWork': active, 'paidGateClosed': True,
                            'services': states, 'configurationHashes': {str(p): sha(p.read_bytes()) for p in ENV_FILES},
                            'protectedDataDigest': data_digest(film)}


def write_verified(root, name, data):
    target = root / str(relative(name))
    require(not target.is_symlink() and target.resolve().is_relative_to(root.resolve()), 'UNSAFE_DESTINATION')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    temporary = target.with_name(target.name + '.codex-site-pending')
    require(not temporary.exists() and not temporary.is_symlink(), 'PENDING_FILE_EXISTS')
    with temporary.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o644)
    os.chown(temporary, 0, 0)
    temporary.replace(target)
    require(sha(target.read_bytes()) == sha(data), 'INSTALLED_HASH_MISMATCH')


def bridge_probe(gateway):
    origin = gateway['FILM_BACKEND_ORIGIN'].rstrip('/')
    require(origin.startswith('https://'), 'HTTPS_REQUIRED')
    body = json.dumps({'requestId': str(uuid.uuid4()), 'actor': {'id': 'deployment-verification', 'isAdmin': True},
                       'operation': None, 'input': {}}, separators=(',', ':')).encode()
    timestamp, nonce = str(int(time.time() * 1000)), str(uuid.uuid4())
    signature = hmac.new(gateway['FILM_BRIDGE_SECRET'].encode(), timestamp.encode() + b'\n' +
                         nonce.encode() + b'\n' + body, hashlib.sha256).hexdigest()
    context = ssl.create_default_context(cafile=gateway.get('NODE_EXTRA_CA_CERTS'))
    request = urllib.request.Request(origin + '/api/film-bridge', data=body,
        headers={'Content-Type': 'application/json', 'x-film-time': timestamp,
                 'x-film-nonce': nonce, 'x-film-signature': signature})
    # Invalid operation is rejected after HMAC/store checks and before customer writes.
    # A deployment probe must not create a synthetic user or alter customer timestamps.
    try:
        with urllib.request.urlopen(request, context=context, timeout=30):
            raise RuntimeError('BRIDGE_PROBE_FAILED')
    except urllib.error.HTTPError as error:
        value = json.loads(error.read(4096))
        require(error.code == 400 and value.get('error') == 'INVALID_INPUT', 'BRIDGE_PROBE_FAILED')
    return {'signedBackendContract': True, 'probeCreatedCustomer': False}



def apply(commit):
    film, gateway, before = inspect()
    manifest = json.loads(get('https://raw.githubusercontent.com/' + REPOSITORY + '/' + commit +
                              '/scripts/site-update-20261101.json', 500000))
    require(manifest.get('schema') == 'mashhad-site-update-v1' and manifest.get('gpuAllowed') is False
            and manifest.get('newBackups') is False, 'INVALID_MANIFEST')
    for key in ['sourceCommit', 'pagesCommit']:
        require(re.fullmatch('[a-f0-9]{40}', manifest[key]), 'INVALID_COMMIT')
    source = checked_payload(get('https://codeload.github.com/' + REPOSITORY + '/tar.gz/' + manifest['sourceCommit']),
                             manifest['backendFiles'])
    static_rows = [{**r, 'path': 'admin/' + r['path']} for r in manifest['adminFiles']]
    static = checked_payload(get('https://codeload.github.com/' + REPOSITORY + '/tar.gz/' + manifest['pagesCommit']), static_rows)
    node = '/opt/node-v24.14.1-linux-x64/bin/node'
    with tempfile.TemporaryDirectory(prefix='mashhad-new-source-') as folder:
        stage = Path(folder)
        for name, data in source.items():
            require(name.startswith(('services/film-engine/engine/', 'services/film-gateway/', 'shared/'))
                    or name == 'services/film-engine/service.mjs', 'UNEXPECTED_SOURCE_SCOPE')
            file = stage / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            if file.suffix == '.mjs':
                run([node, '--check', str(file)])
        for relative_dir in ['node_modules', 'services/film-engine/node_modules']:
            installed = FILM_ROOT / relative_dir
            target = stage / relative_dir
            if installed.is_dir():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(installed.resolve(), target_is_directory=True)
        run([node, '--input-type=module', '-e', 'await import(process.argv[1])',
             (stage / 'services/film-engine/engine/film-platform.mjs').as_uri()])
    print(json.dumps({'phase': 'payload_verified', 'sourceFiles': len(source), 'adminFiles': len(static)}), flush=True)
    inspect()
    stopped = []
    try:
        for unit in UNITS[::-1]:
            run(['systemctl', 'stop', unit])
            stopped.append(unit)
        for name, data in source.items():
            roots = [FILM_ROOT, GATEWAY_ROOT] if name.startswith('shared/') else [GATEWAY_ROOT] if name.startswith('services/film-gateway/') else [FILM_ROOT]
            for root in roots:
                write_verified(root, name, data)
    finally:
        for unit in stopped[::-1]:
            subprocess.run(['systemctl', 'start', unit], capture_output=True, timeout=60)
    for unit in UNITS:
        require(run(['systemctl', 'is-active', unit]) == 'active', 'SERVICE_START_FAILED')
    # A bounded read-only retry waits for the listener, never submits model work.
    for attempt in range(10):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3480/health', timeout=3) as response:
                require(json.load(response).get('status') == 'ok', 'GATEWAY_HEALTH_FAILED')
            break
        except (OSError, urllib.error.URLError):
            if attempt == 9:
                raise RuntimeError('GATEWAY_HEALTH_FAILED') from None
            time.sleep(1)
    probe = bridge_probe(gateway)
    require(data_digest(film) == before['protectedDataDigest'], 'PROTECTED_DATA_CHANGED')
    require(all(sha(p.read_bytes()) == before['configurationHashes'][str(p)] for p in ENV_FILES), 'CONFIGURATION_CHANGED')
    for name, data in static.items():
        write_verified(ADMIN_ROOT, name[len('admin/'):], data)
    require(json.loads((ADMIN_ROOT / 'version.json').read_text())['version'] == manifest['adminVersion'], 'ADMIN_VERSION_MISMATCH')
    result = {'installed': True, 'sourceCommit': manifest['sourceCommit'], 'pagesCandidate': manifest['pagesCommit'],
              'adminVersion': manifest['adminVersion'], **probe, 'protectedDataUnchanged': True,
              'configurationUnchanged': True, 'newBackups': 0, 'gpuStarted': False, 'dnsChanged': False,
              'customerPagesPromotionPending': True}
    Path('/root/codex-site-update-20261101-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


def main():
    require(len(sys.argv) == 3 and sys.argv[1] in ['inspect', 'apply']
            and re.fullmatch('[a-f0-9]{40}', sys.argv[2]), 'INVALID_COMMAND')
    if sys.argv[1] == 'inspect':
        _, _, value = inspect()
        print(json.dumps({'ready': True, 'activeWork': value['activeWork'], 'paidGateClosed': True,
                          'servicesHealthy': True, 'newBackups': 0}), flush=True)
    else:
        apply(sys.argv[2])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[A-Z_]{3,70}', str(error)) else type(error).__name__
        print(json.dumps({'installed': False, 'code': code, 'secretsPrinted': False}), flush=True)
        sys.exit(1)
