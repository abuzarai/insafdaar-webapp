#!/usr/bin/env python3
"""Deploy GitHub-built application images to the existing, provisioned VM.

Never recreates data services, changes schema/grants or opens admissions.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

BASE = Path.home()/'insafdaar'
SERVICES = ['backend', 'frontend', 'drafting', 'voice']


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'Command failed: '+args[0]+'; maintenance stays closed')
    return result.stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def main():
    require(len(sys.argv) == 2 and re.fullmatch('[a-f0-9]{40}', sys.argv[1]), 'Expected a full commit SHA')
    commit = sys.argv[1]
    release = BASE/'github-releases'/commit
    metadata = json.loads((release/'release.json').read_text())
    require(metadata['commit'] == commit, 'Release commit mismatch')
    require(set(metadata['images']) == set(SERVICES) and set(metadata['revisions']) == set(SERVICES), 'Incomplete release')
    for service in SERVICES:
        require(re.fullmatch('sha256:[a-f0-9]{64}', metadata['images'][service]), 'Invalid image identity')
        require(re.fullmatch('[a-f0-9]{40}', metadata['revisions'][service]), 'Invalid source revision')
    for name, key in [('images.tar.gz', 'images_sha256'), ('webapp.tar.gz', 'source_sha256')]:
        require(digest(release/name) == metadata[key], 'Artifact checksum mismatch: '+name)
    with open('/tmp/insafdaar-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not (release/'installed.json').exists(), 'Commit already installed; inspect its receipt')
        source = release/'webapp'
        source.mkdir(exist_ok=True)
        with tarfile.open(release/'webapp.tar.gz') as handle:
            handle.extractall(source, filter='data')
        # Preserve the existing bind-path base, credentials and named volumes.
        environment = BASE/'webapp/.env'
        require(environment.is_file(), 'Existing runtime configuration missing')
        unchanged = {name: inspect('insafdaar-'+name) for name in ['db', 'legal-rag', 'weaviate']}
        print('Loading GitHub-built images (no VM builds).', flush=True)
        run('docker', 'load', '--input', str(release/'images.tar.gz'), timeout=1800)
        for service in SERVICES:
            image = json.loads(run('docker', 'image', 'inspect', metadata['images'][service]))[0]
            require(image['Architecture'] == 'amd64' and image['Os'] == 'linux', 'Wrong image platform')
            require(image['Config']['Labels']['org.opencontainers.image.revision'] == metadata['revisions'][service], 'Image revision mismatch')
        # This application-only path requires migrations to have been applied
        # separately. Refuse missing, changed or extra SQL instead of guessing.
        sql = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('migrations',(SELECT json_object_agg(name,sha256) FROM public.schema_migrations),'paused',(SELECT paused FROM public.interview_admission_policy WHERE singleton)); ROLLBACK;"
        db = json.loads(run('docker', 'exec', 'insafdaar-db', 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'insafdaar_db', '-c', sql))
        expected = {p.name: digest(p) for p in (source/'backend/migrations').glob('*.sql')}
        require(expected and db['migrations'] == expected, 'Database migrations differ; explicit schema preparation required')
        require(db['paused'] is True, 'Voice admission policy must remain paused')
        rag_image = unchanged['legal-rag']['Image']
        override = {'services': {s: {'image': metadata['images'][s], 'pull_policy': 'never'} for s in SERVICES}}
        override['services']['legal-rag'] = {'image': rag_image, 'pull_policy': 'never'}
        override['services']['backend']['environment'] = {'INTAKE_V2_ENABLED': 'false', 'BACKGROUND_JOBS_ENABLED': 'false'}
        override['services']['voice']['environment'] = {'LIVE_ENABLED': 'false'}
        config = release/'compose.paused.json'
        config.write_text(json.dumps(override, indent=2)+'\n')
        config.chmod(0o600)
        compose = ['docker', 'compose', '--project-name', 'webapp', '--project-directory', str(BASE/'webapp'),
                   '--env-file', str(environment), '-f', str(source/'docker-compose.yml'), '-f', str(config)]
        resolved = json.loads(run(*compose, 'config', '--format', 'json'))
        settings = resolved['services']['backend']['environment']
        require(settings['DB_USER'] == 'insafdaar_runtime' and settings['DB_DATABASE'] == 'insafdaar_db' and
                settings['DB_HOST'] in ['db', 'insafdaar-db'] and str(settings['DB_PORT']) == '5432', 'Restricted database target changed')
        for service in SERVICES:
            require(resolved['services'][service]['image'] == metadata['images'][service], 'Compose image changed')
        # This VM's maintenance include was installed during the approved window.
        gate = Path('/etc/nginx/snippets/insafdaar-release-maintenance.conf')
        require(gate.is_file(), 'Maintenance include missing; provision it before deployment')
        result = subprocess.run(['sudo', '-n', 'tee', str(gate)], input='add_header Retry-After 120 always;\nreturn 503;\n', text=True, capture_output=True)
        require(result.returncode == 0, 'Cannot close maintenance gate')
        run('sudo', '-n', 'nginx', '-t')
        run('sudo', '-n', 'systemctl', 'reload', 'nginx')
        print('Maintenance closed; replacing only application containers.', flush=True)
        run('docker', 'stop', '--time', '50', *['insafdaar-'+s for s in ['voice', 'drafting', 'backend']], timeout=180)
        run(*compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '240', *SERVICES, timeout=300)
        for service in SERVICES:
            container = inspect('insafdaar-'+service)
            require(container['Image'] == metadata['images'][service] and container['State']['Health']['Status'] == 'healthy', 'Application health/image check failed: '+service)
        for name, old in unchanged.items():
            current = inspect('insafdaar-'+name)
            require(current['Id'] == old['Id'] and current['Image'] == old['Image'], 'Data/RAG service unexpectedly replaced')
        probe = "Promise.all(['/test-db','/api/webhooks/health'].map(async p=>(await fetch('http://127.0.0.1:5000'+p)).status)).then(s=>process.exit(s.every(x=>x===200)?0:1)).catch(()=>process.exit(1))"
        run('docker', 'exec', 'insafdaar-backend', 'node', '-e', probe, timeout=20)
        receipt = {**metadata, 'status': 'installed-paused-not-accepted', 'compose': compose, 'maintenance_closed': True}
        (release/'installed.json').write_text(json.dumps(receipt, indent=2)+'\n')
        print('Installed: four healthy application images. Database, uploads and RAG preserved. Maintenance, voice admissions and jobs remain closed.', flush=True)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired, tarfile.TarError) as error:
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('DEPLOY STOPPED: '+message+'; no automatic reopening or database rollback.', file=sys.stderr)
        sys.exit(1)
