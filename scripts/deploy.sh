#!/usr/bin/env bash
# Install a pre-staged, reviewed release; never fetch sources or open admissions.
# Layout: ~/insafdaar/releases/<id>/{manifest.json,webapp,drafting-assistant,
# voice_intake_agent,legal-rag-assistant}; repositories must be clean, pinned clones.
# Manifest v1: release_id, status=approved-for-paused-install, repositories
# (directory -> full commit SHA), images (service -> sha256 image ID), migrations
# (filename -> SHA256), database (container/name/migration_user/runtime_role), and
# cutover (automatic_deploy_frozen/maintenance_fenced/drained/restore_verified=true,
# backup={path,sha256}). Attestations require operator evidence; they are not probes.
# Images must already be loaded; changed images need an OCI source-revision label.
# Retain compose.paused.json; installed.json records the reusable Compose argv
# (project, bind-path base, env-file path and release files), never resolved secrets.
set -euo pipefail
exec python3 - "$@" <<'PY'
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, **options):
    result = subprocess.run(args, text=True, capture_output=True, **options)
    require(result.returncode == 0, 'Command failed; release remains unaccepted')
    return result.stdout.strip()


def digest(path):
    with path.open('rb') as handle:
        value = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate manifest key')
        result[key] = value
    return result


def main():
    require(len(sys.argv) == 4, 'Expected release ID, manifest SHA256 and migration-runner SHA256')
    release_id, manifest_hash, runner_hash = sys.argv[1:]
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', release_id), 'Invalid release ID')
    require(all(re.fullmatch(r'[a-f0-9]{64}', x) for x in [manifest_hash, runner_hash]), 'Invalid checksum')
    base = Path(os.environ.get('DEPLOY_BASE', str(Path.home()/'insafdaar'))).resolve()
    release = base/'releases'/release_id
    manifest_path = release/'manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    require(hashlib.sha256(manifest_bytes).hexdigest() == manifest_hash, 'Manifest checksum mismatch')
    manifest = json.loads(manifest_bytes.decode('utf-8'), object_pairs_hook=unique_object)
    require(manifest['schema_version'] == 1, 'Unsupported manifest version')
    require(manifest['release_id'] == release_id, 'Release ID mismatch')
    require(manifest['status'] == 'approved-for-paused-install', 'Release is not approved for paused install')
    for gate in ['automatic_deploy_frozen', 'maintenance_fenced', 'drained', 'restore_verified']:
        require(manifest['cutover'][gate] is True, 'Missing approved cutover prerequisite: '+gate)
    backup = Path(manifest['cutover']['backup']['path'])
    require(backup.is_absolute() and backup.is_file() and backup.stat().st_size > 0, 'Backup artifact missing')
    require(digest(backup) == manifest['cutover']['backup']['sha256'], 'Backup checksum mismatch')

    lock_path = os.environ.get('DEPLOY_LOCK_FILE', '/tmp/insafdaar-deploy.lock')
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not (release/'installed.json').exists(), 'Release already installed; inspect state before another operation')
        repos = ['webapp', 'drafting-assistant', 'voice_intake_agent', 'legal-rag-assistant']
        require(set(manifest['repositories']) == set(repos), 'Incomplete repository pin set')
        for repo in repos:
            sha = manifest['repositories'][repo]
            require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Invalid source commit')
            require(run('git', '-C', str(release/repo), 'rev-parse', '--show-toplevel') == str((release/repo).resolve()), 'Staged repository root mismatch')
            require(run('git', '-C', str(release/repo), 'rev-parse', 'HEAD') == sha, 'Staged source commit mismatch')
            require(not run('git', '-C', str(release/repo), 'status', '--porcelain', '--untracked-files=all'), 'Staged source is dirty')
        web = release/'webapp'
        require(digest(web/'scripts/apply-migrations.sh') == runner_hash, 'Migration runner differs from approved workflow')
        files = {p.name: digest(p) for p in sorted((web/'backend/migrations').glob('*.sql'))}
        require(files and manifest['migrations'] == files, 'Migration inventory/checksum mismatch')
        services = ['backend', 'frontend', 'drafting', 'voice', 'legal-rag']
        require(set(manifest['images']) == set(services), 'Incomplete image pin set')
        for service in services:
            image = manifest['images'][service]
            require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'Expected immutable image ID')
            require(run('docker', 'image', 'inspect', '--format', '{{.Id}}', image) == image, 'Missing or mismatched image')
            if service != 'legal-rag':
                repo = {'backend': 'webapp', 'frontend': 'webapp', 'drafting': 'drafting-assistant', 'voice': 'voice_intake_agent'}[service]
                revision = run('docker', 'image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', image)
                require(revision == manifest['repositories'][repo], 'Image source revision mismatch')
        project = run('docker', 'inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', 'insafdaar-backend')
        require(re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project), 'Existing Compose project is unknown')
        for service in ['db', 'frontend', 'backend', 'drafting', 'voice', 'legal-rag', 'weaviate']:
            name = 'insafdaar-'+service
            require(run('docker', 'inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', name) == project, 'Compose project mismatch')
        for service in ['backend', 'drafting', 'voice']:
            state = run('docker', 'inspect', '--format', '{{.State.Status}}', 'insafdaar-'+service)
            require(state in ['exited', 'created'], 'Old application writers must already be stopped')
        require(run('docker', 'inspect', '--format', '{{.Image}}', 'insafdaar-legal-rag') == manifest['images']['legal-rag'], 'Unchanged RAG artifact mismatch')
        require((base/'webapp/.env').is_file(), 'Existing runtime configuration missing')

        override = {'services': {s: {'image': manifest['images'][s], 'pull_policy': 'never'} for s in services}}
        override['services']['backend']['environment'] = {'INTAKE_V2_ENABLED': 'false', 'BACKGROUND_JOBS_ENABLED': 'false'}
        override['services']['voice']['environment'] = {'LIVE_ENABLED': 'false'}
        config = release/'compose.paused.json'
        temporary = release/'compose.paused.json.tmp'
        temporary.write_text(json.dumps(override, indent=2)+'\n')
        temporary.chmod(0o600)
        temporary.replace(config)
        compose = ['docker', 'compose', '--project-name', project, '--project-directory', str(base/'webapp'),
                   '--env-file', str(base/'webapp/.env'), '-f', str(web/'docker-compose.yml'), '-f', str(config)]
        resolved = json.loads(run(*compose, 'config', '--format', 'json'))
        settings = resolved['services']['backend']['environment']
        require(settings['DB_USER'] == manifest['database']['runtime_role'] and
                settings['DB_DATABASE'] == manifest['database']['name'] and
                settings['DB_HOST'] in ['db', 'insafdaar-db'] and str(settings['DB_PORT']) == '5432',
                'Runtime database target/role does not match the reviewed manifest')
        for service in services:
            require(resolved['services'][service]['image'] == manifest['images'][service], 'Resolved image pin mismatch')
        run('bash', str(web/'scripts/apply-migrations.sh'), str(manifest_path), manifest_hash,
            env={**os.environ, 'DEPLOY_LOCK_FD': str(lock.fileno())}, pass_fds=(lock.fileno(),))
        run(*compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180',
            'backend', 'voice', 'drafting', 'frontend')
        for service in ['backend', 'voice', 'drafting', 'frontend']:
            name = 'insafdaar-'+service
            require(run('docker', 'inspect', '--format', '{{.Image}}', name) == manifest['images'][service], 'Installed image mismatch')
            require(run('docker', 'inspect', '--format', '{{.State.Health.Status}}', name) == 'healthy', 'Installed service is not healthy')
        receipt = {'release_id': release_id, 'manifest_sha256': manifest_hash, 'status': 'installed-paused-not-accepted',
                   'repositories': manifest['repositories'], 'images': manifest['images'], 'migrations': manifest['migrations'],
                   'compose': compose}
        temporary = release/'installed.json.tmp'
        temporary.write_text(json.dumps(receipt, indent=2)+'\n')
        temporary.replace(release/'installed.json')
        print('Installed exact artifacts with admissions and background jobs disabled. Keep external maintenance fenced; acceptance and reopening are separate.')


try:
    main()
except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
    message = str(error) if isinstance(error, RuntimeError) else 'Invalid release inputs or unavailable prerequisites'
    print('[deploy] STOP: '+message, file=sys.stderr)
    sys.exit(1)
PY
