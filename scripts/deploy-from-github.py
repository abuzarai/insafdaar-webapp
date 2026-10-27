#!/usr/bin/env python3
"""Replace one application container, preserving all other containers and data."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

BASE = Path.home()/'insafdaar'
SERVICES = ['backend', 'frontend', 'drafting', 'voice', 'legal-rag']
CONTAINERS = SERVICES+['db', 'weaviate']


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'Command failed: '+args[0])
    return result.stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', 'insafdaar-'+name))[0]


def environment(container):
    return dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def deploy(service, release):
    metadata = json.loads((release/'release.json').read_text())
    require(metadata['service'] == service, 'Service mismatch')
    require(metadata['revision'] == release.name.split('-')[0], 'Source revision mismatch')
    require(re.fullmatch('sha256:[a-f0-9]{64}', metadata['image']), 'Invalid immutable image ID')
    require(digest(release/'images.tar.gz') == metadata['images_sha256'], 'Image archive checksum mismatch')
    if service in ['backend', 'frontend']:
        compose_file = release/'compose.yml'
        require(digest(compose_file) == metadata['compose_sha256'], 'Compose checksum mismatch')
    print('Waiting for the shared VM deployment lock.', flush=True)
    with open('/tmp/insafdaar-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        before = {name: inspect(name) for name in CONTAINERS}
        require(all(c['Config']['Labels']['com.docker.compose.project'] == 'webapp' for c in before.values()), 'Compose project changed')
        backend_env = environment(before['backend'])
        voice_env = environment(before['voice'])
        if service in ['backend', 'voice']:
            require(backend_env.get('INTAKE_V2_ENABLED', 'false') == 'false' and voice_env.get('LIVE_ENABLED', 'false') == 'false',
                    'Pause and drain voice before replacing its runtime or collector')
        state_path = BASE/'service-deployment.json'
        if service not in ['backend', 'frontend']:
            if state_path.is_file():
                compose_file = Path(json.loads(state_path.read_text())['compose_file'])
            else:
                compose_file = Path(before['backend']['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[0])
        require(compose_file.is_file(), 'Active Compose configuration missing')
        if service == 'backend':
            db_env = environment(before['db'])
            runtime_role = backend_env['DB_USER']
            require(re.fullmatch('[a-zA-Z_][a-zA-Z0-9_]*', runtime_role), 'Invalid runtime role')
            sql = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('migrations',(SELECT json_object_agg(name,sha256) FROM public.schema_migrations),'runtime_safe',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+runtime_role+"' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole)); ROLLBACK;"
            db = json.loads(run('docker', 'exec', 'insafdaar-db', 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-c', sql))
            require(metadata['migrations'] and db['migrations'] == metadata['migrations'], 'Database migrations differ; separate schema preparation required')
            require(db['runtime_safe'] is True, 'Runtime role has elevated privileges')
        print('Loading '+service+' image.', flush=True)
        run('docker', 'load', '--input', str(release/'images.tar.gz'), timeout=1800)
        image = json.loads(run('docker', 'image', 'inspect', metadata['image']))[0]
        require(image['Id'] == metadata['image'] and image['Architecture'] == 'amd64' and image['Os'] == 'linux', 'Image/platform mismatch')
        require(image['Config']['Labels']['org.opencontainers.image.revision'] == metadata['revision'], 'Image source mismatch')
        images = {name: before[name]['Image'] for name in SERVICES}
        images[service] = metadata['image']
        override = {'services': {name: {'image': value, 'pull_policy': 'never'} for name, value in images.items()}}
        override['services']['backend']['environment'] = {
            'INTAKE_V2_ENABLED': backend_env.get('INTAKE_V2_ENABLED', 'false'),
            'BACKGROUND_JOBS_ENABLED': backend_env.get('BACKGROUND_JOBS_ENABLED', 'false')}
        override['services']['voice']['environment'] = {'LIVE_ENABLED': voice_env.get('LIVE_ENABLED', 'false')}
        config = release/'compose.images.json'
        atomic_json(config, override)
        compose = ['docker', 'compose', '--project-name', 'webapp', '--project-directory', str(BASE/'webapp'),
                   '--env-file', str(BASE/'webapp/.env'), '-f', str(compose_file), '-f', str(config)]
        resolved = json.loads(run(*compose, 'config', '--format', 'json'))
        require(all(resolved['services'][name]['image'] == images[name] for name in SERVICES), 'Compose image mismatch')
        if service == 'backend':
            settings = resolved['services']['backend']['environment']
            require(settings['DB_USER'] == backend_env['DB_USER'] and settings['DB_DATABASE'] == backend_env['DB_DATABASE'] and
                    settings['DB_HOST'] in ['db', 'insafdaar-db'] and str(settings['DB_PORT']) == '5432', 'Restricted database target changed')
        print('Replacing only '+service+'.', flush=True)
        run(*compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait', '--wait-timeout', '240', service, timeout=300)
        current = inspect(service)
        require(current['Image'] == metadata['image'] and current['State']['Health']['Status'] == 'healthy', 'Selected service failed health/image checks')
        for name, old in before.items():
            if name != service:
                other = inspect(name)
                require(other['Id'] == old['Id'] and other['Image'] == old['Image'], 'Unselected container changed: '+name)
        if service == 'backend':
            probe = "fetch('http://127.0.0.1:5000/test-db').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
            run('docker', 'exec', 'insafdaar-backend', 'node', '-e', probe, timeout=20)
        receipt = {**metadata, 'status': 'installed', 'compose': compose, 'compose_file': str(compose_file), 'images': images}
        atomic_json(release/'installed.json', receipt)
        atomic_json(state_path, receipt)
        print('Healthy: '+service+'. All other containers and admission flags preserved.', flush=True)


def main():
    require(len(sys.argv) == 3, 'Expected service and release ID')
    service, release_id = sys.argv[1:]
    require(service in SERVICES and re.fullmatch('[a-f0-9]{40}-[0-9]+-[0-9]+', release_id), 'Invalid service/release')
    deploy(service, BASE/'service-releases'/service/release_id)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired) as error:
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('DEPLOY STOPPED: '+message+'; no automatic rollback or traffic reopening.', file=sys.stderr)
        sys.exit(1)
