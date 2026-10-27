"""Offline release-control tests. Every docker/git command is a strict local fake."""
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT/'scripts/deploy.sh'
MIGRATE = ROOT/'scripts/apply-migrations.sh'

FAKE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['FAKE_ROOT'])
config = json.loads((root/'fake.json').read_text())
a = sys.argv[1:]
kind = Path(sys.argv[0]).name
with (root/'calls.jsonl').open('a') as f:
    f.write(json.dumps([kind, *a])+'\n')
if kind == 'git':
    repo = Path(a[1])
    if a[2:] == ['rev-parse', 'HEAD']:
        print(config['repositories'][repo.name] if not config.get('wrong_commit') else '0'*40)
    elif a[2:] == ['rev-parse', '--show-toplevel']:
        print(repo.resolve())
    elif a[2:] == ['status', '--porcelain', '--untracked-files=all']:
        print(' M changed.py' if config.get('dirty') else '')
    else:
        sys.exit(90)
elif a[:2] == ['image', 'inspect']:
    image = a[-1]
    if config.get('missing_image'):
        sys.exit(1)
    if a[3] == '{{.Id}}':
        print(image)
    else:
        service = next(s for s, i in config['images'].items() if i == image)
        repo = {'backend':'webapp', 'frontend':'webapp', 'drafting':'drafting-assistant', 'voice':'voice_intake_agent'}[service]
        print('0'*40 if config.get('wrong_label') else config['repositories'][repo])
elif a[0] == 'inspect':
    field, service = a[2], a[-1].removeprefix('insafdaar-')
    if field == '{{.State.Status}}':
        print('running' if config.get('writers_running') else 'exited')
    elif field == '{{.Image}}':
        print('sha256:'+'0'*64 if config.get('wrong_installed_image') and service != 'legal-rag' else config['images'][service])
    elif field == '{{.State.Health.Status}}':
        print('unhealthy' if config.get('unhealthy') else 'healthy')
    elif field == '{{index .Config.Labels "com.docker.compose.project"}}':
        print('other' if config.get('wrong_project') and service == 'voice' else 'existing-project')
    else:
        sys.exit(91)
elif a[:2] == ['exec', '-i']:
    (root/'generated.sql').write_text(sys.stdin.read())
    if config.get('psql_failure'):
        print('synthetic-private-diagnostic-not-for-public-output', file=sys.stderr)
        sys.exit(3)
elif a[0] == 'compose':
    override = Path(a[a.index('-f', a.index('-f')+1)+1])
    (root/'override.json').write_text(override.read_text())
    if 'config' in a:
        resolved = json.loads(override.read_text())
        resolved['services']['backend']['environment'].update({'DB_USER': 'wrong' if config.get('wrong_runtime_role') else 'fictional_runtime', 'DB_DATABASE': 'fictional_db', 'DB_HOST': 'db', 'DB_PORT': '5432'})
        print(json.dumps(resolved))
    elif config.get('compose_failure'):
        sys.exit(1)
else:
    sys.exit(92)
'''


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class DeploymentSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='offline-release-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.release = self.base/'releases/fictional-release'
        self.release.mkdir(parents=True)
        (self.base/'webapp').mkdir()
        (self.base/'webapp/.env').write_text('# fictional offline configuration\n')
        self.bin = self.base/'bin'
        self.bin.mkdir()
        for name in ['docker', 'git']:
            path = self.bin/name
            path.write_text(FAKE)
            path.chmod(0o700)
        self.repos = {name: str(i)*40 for i, name in enumerate(['webapp', 'drafting-assistant', 'voice_intake_agent', 'legal-rag-assistant'], 1)}
        for name in self.repos:
            (self.release/name).mkdir()
        scripts = self.release/'webapp/scripts'
        scripts.mkdir()
        shutil.copy(MIGRATE, scripts/'apply-migrations.sh')
        migrations = self.release/'webapp/backend/migrations'
        migrations.mkdir(parents=True)
        for source in (ROOT/'backend/migrations').glob('*.sql'):
            shutil.copy(source, migrations/source.name)
        (self.release/'webapp/docker-compose.yml').write_text('services: {}\n')
        backup = self.base/'fictional-backup.dump'
        backup.write_bytes(b'fictional backup artifact; not a real database')
        images = {name: 'sha256:'+str(i)*64 for i, name in enumerate(['backend', 'frontend', 'drafting', 'voice', 'legal-rag'], 1)}
        self.manifest = {'schema_version': 1, 'release_id': 'fictional-release', 'status': 'approved-for-paused-install',
                         'repositories': self.repos, 'images': images,
                         'migrations': {p.name: sha(p) for p in migrations.glob('*.sql')},
                         'database': {'container': 'insafdaar-db', 'name': 'fictional_db', 'migration_user': 'postgres', 'runtime_role': 'fictional_runtime'},
                         'cutover': {**dict.fromkeys(['automatic_deploy_frozen', 'maintenance_fenced', 'drained', 'restore_verified'], True),
                                     'backup': {'path': str(backup), 'sha256': sha(backup)}}}
        self.config = {'repositories': self.repos, 'images': images}
        self.env = {'PATH': str(self.bin)+':'+os.defpath, 'HOME': str(self.base), 'FAKE_ROOT': str(self.base),
                    'DEPLOY_BASE': str(self.base), 'DEPLOY_LOCK_FILE': str(self.base/'deploy.lock'),
                    'PYTHONDONTWRITEBYTECODE': '1', 'GIT_OPTIONAL_LOCKS': '0'}

    def invoke(self, migrate=False, checksum=None, runner=None):
        path = self.release/'manifest.json'
        path.write_text(json.dumps(self.manifest))
        (self.base/'fake.json').write_text(json.dumps(self.config))
        command = ['bash', str(MIGRATE if migrate else DEPLOY)]
        command += [str(path) if migrate else 'fictional-release', checksum or sha(path)]
        if not migrate:
            command.append(runner or sha(MIGRATE))
        if migrate:
            with (self.base/'deploy.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                env = {**self.env, 'DEPLOY_LOCK_FD': str(lock.fileno())}
                return subprocess.run(command, env=env, pass_fds=(lock.fileno(),), text=True, capture_output=True, timeout=10)
        return subprocess.run(command, env=self.env, text=True, capture_output=True, timeout=10)

    def invoke_with_input_mutation(self, script, relative_path, replacement):
        path = self.release/'manifest.json'
        path.write_text(json.dumps(self.manifest))
        (self.base/'fake.json').write_text(json.dumps(self.config))
        target = self.release/relative_path
        original = target.read_bytes()
        manifest_hash = sha(path)
        runner_hash = sha(MIGRATE)
        source = script.read_text().split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        tree = ast.parse(source)
        self.assertIsInstance(tree.body[-1], ast.Try)
        tree.body.pop()  # Load definitions without invoking the CLI entry point.
        namespace = {}
        exec(compile(tree, str(script), 'exec'), namespace)
        real_sha256 = hashlib.sha256
        mutated = False

        def swapping_sha256(data=b''):
            value = real_sha256(data)
            consumed = bytearray(data)

            def update(chunk):
                consumed.extend(chunk)
                value.update(chunk)

            def hexdigest():
                nonlocal mutated
                result = value.hexdigest()
                if not mutated and bytes(consumed) == original:
                    mutated = True
                    target.write_bytes(replacement)
                return result

            return SimpleNamespace(update=update, hexdigest=hexdigest)

        argv = [str(script), str(path), manifest_hash] if script == MIGRATE else [str(script), 'fictional-release', manifest_hash, runner_hash]
        error = None
        with (self.base/'deploy.lock').open('a') as lock:
            env = self.env
            if script == MIGRATE:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                env = {**env, 'DEPLOY_LOCK_FD': str(lock.fileno())}
            with patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', argv), patch.object(hashlib, 'sha256', swapping_sha256):
                try:
                    namespace['main']()
                except RuntimeError as caught:
                    error = caught
        self.assertTrue(mutated, 'The controlled input replacement must actually occur')
        return error

    def calls(self):
        path = self.base/'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_missing_arguments_never_reach_external_commands(self):
        for script in [DEPLOY, MIGRATE]:
            result = subprocess.run(['bash', str(script)], env=self.env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_manifest_checksum_rejected_before_commands(self):
        for migrate in [False, True]:
            self.assertNotEqual(self.invoke(migrate=migrate, checksum='0'*64).returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_deploy_never_selects_images_from_a_manifest_changed_after_hashing(self):
        changed = json.loads(json.dumps(self.manifest))
        changed['images']['backend'] = 'sha256:'+'9'*64
        error = self.invoke_with_input_mutation(DEPLOY, 'manifest.json', json.dumps(changed).encode())
        self.assertIsNotNone(error)  # The child rejects the changed on-disk manifest.
        inspected = [call[-1] for call in self.calls() if call[1:3] == ['image', 'inspect']]
        self.assertTrue(inspected)
        self.assertNotIn(changed['images']['backend'], inspected)
        self.assertTrue(set(inspected).issubset(set(self.manifest['images'].values())))
        self.assertFalse((self.release/'installed.json').exists())
        self.assertFalse(any(call[1:3] == ['exec', '-i'] for call in self.calls()))
        self.assertFalse(any(call[1:2] == ['compose'] and 'up' in call for call in self.calls()))

    def test_migration_uses_the_manifest_bytes_whose_hash_was_checked(self):
        changed = json.loads(json.dumps(self.manifest))
        changed['database']['runtime_role'] = 'unapproved_runtime'
        error = self.invoke_with_input_mutation(MIGRATE, 'manifest.json', json.dumps(changed).encode())
        self.assertIsNone(error)
        sql = (self.base/'generated.sql').read_text()
        self.assertIn("has_table_privilege('fictional_runtime'", sql)
        self.assertNotIn('unapproved_runtime', sql)

    def test_migration_uses_the_sql_bytes_whose_hash_was_checked(self):
        replacement = b"SELECT 'unapproved-replacement';\n"
        error = self.invoke_with_input_mutation(MIGRATE, 'webapp/backend/migrations/009_runtime_schema_consolidation.sql', replacement)
        self.assertIsNone(error)
        sql = (self.base/'generated.sql').read_text()
        self.assertNotIn('unapproved-replacement', sql)
        name = '009_runtime_schema_consolidation.sql'
        original = (ROOT/'backend/migrations'/name).read_text()
        self.assertIn(original, sql)
        self.assertIn("VALUES ('%s','%s');" % (name, self.manifest['migrations'][name]), sql)

    def test_missing_approval_or_backup_is_rejected(self):
        for gate in ['automatic_deploy_frozen', 'maintenance_fenced', 'drained', 'restore_verified']:
            with self.subTest(gate=gate):
                self.manifest['cutover'][gate] = False
                self.assertNotEqual(self.invoke().returncode, 0)
                self.manifest['cutover'][gate] = True
        self.manifest['cutover']['backup']['sha256'] = '0'*64
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_lock_contention_is_rejected(self):
        with (self.base/'deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertNotEqual(self.invoke().returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_source_and_artifact_failures_never_migrate(self):
        for flag in ['dirty', 'wrong_commit', 'missing_image', 'wrong_label', 'wrong_project', 'writers_running']:
            with self.subTest(flag=flag):
                self.config[flag] = True
                self.assertNotEqual(self.invoke().returncode, 0)
                self.config[flag] = False
        self.assertFalse(any(call[1:3] == ['exec', '-i'] for call in self.calls()))

    def test_unapproved_runner_or_migration_bytes_never_migrate(self):
        self.assertNotEqual(self.invoke(runner='0'*64).returncode, 0)
        file = self.release/'webapp/backend/migrations/012_interview_admission_limits.sql'
        file.write_text(file.read_text()+'\n-- changed\n')
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertFalse(any(call[1:3] == ['exec', '-i'] for call in self.calls()))

    def test_direct_migration_without_deploy_lock_is_rejected(self):
        path = self.release/'manifest.json'
        path.write_text(json.dumps(self.manifest))
        result = subprocess.run(['bash', str(MIGRATE), str(path), sha(path)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_mutable_image_rejected(self):
        self.manifest['images']['voice'] = 'webapp-voice:latest'
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertFalse(any(call[1:3] == ['exec', '-i'] for call in self.calls()))

    def test_migration_failure_is_private_and_never_starts_services(self):
        self.config['psql_failure'] = True
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('synthetic-private-diagnostic', result.stdout+result.stderr)
        log = self.release/'migration-error.log'
        self.assertEqual(log.stat().st_mode & 0o777, 0o600)
        self.assertIn('synthetic-private-diagnostic', log.read_text())
        self.assertFalse(any(call[1:2] == ['compose'] and 'up' in call for call in self.calls()))
        self.assertFalse((self.release/'installed.json').exists())

    def test_success_is_exact_paused_install_not_acceptance(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        override = json.loads((self.base/'override.json').read_text())['services']
        for name, image in self.manifest['images'].items():
            self.assertEqual(override[name]['image'], image)
            self.assertEqual(override[name]['pull_policy'], 'never')
        self.assertEqual(override['backend']['environment']['INTAKE_V2_ENABLED'], 'false')
        self.assertEqual(override['backend']['environment']['BACKGROUND_JOBS_ENABLED'], 'false')
        self.assertEqual(override['voice']['environment']['LIVE_ENABLED'], 'false')
        calls = self.calls()
        sql_at = next(i for i, call in enumerate(calls) if call[1:3] == ['exec', '-i'])
        compose_at = next(i for i, call in enumerate(calls) if call[1:2] == ['compose'] and 'up' in call)
        self.assertLess(sql_at, compose_at)
        compose = calls[compose_at]
        self.assertIn('--no-build', compose)
        self.assertIn('--no-deps', compose)
        self.assertEqual(compose[-4:], ['backend', 'voice', 'drafting', 'frontend'])
        self.assertEqual(compose[compose.index('--project-directory')+1], str(self.base/'webapp'))
        receipt = json.loads((self.release/'installed.json').read_text())
        self.assertEqual(receipt['status'], 'installed-paused-not-accepted')
        self.assertEqual(receipt['compose'], compose[:compose.index('up')])
        config = Path(receipt['compose'][-1])
        self.assertEqual(config, self.release/'compose.paused.json')
        self.assertTrue(config.is_file())
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(config.read_text())['services'], override)
        self.assertEqual(set(override['backend']['environment']), {'INTAKE_V2_ENABLED', 'BACKGROUND_JOBS_ENABLED'})
        self.assertNotIn('fictional_runtime', (self.release/'installed.json').read_text())
        resolved = subprocess.run([*receipt['compose'], 'config', '--format', 'json'], env=self.env, text=True, capture_output=True)
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        self.assertEqual(json.loads(resolved.stdout)['services']['voice']['environment']['LIVE_ENABLED'], 'false')

    def test_runtime_role_mismatch_stops_before_migration(self):
        self.config['wrong_runtime_role'] = True
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[1:3] == ['exec', '-i'] for call in self.calls()))
        self.assertFalse(any(call[1:2] == ['compose'] and 'up' in call for call in self.calls()))

    def test_already_installed_release_is_not_reapplied(self):
        self.assertEqual(self.invoke().returncode, 0)
        count = len(self.calls())
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertEqual(len(self.calls()), count)

    def test_failed_start_or_wrong_image_never_writes_success_receipt(self):
        for flag in ['compose_failure', 'unhealthy', 'wrong_installed_image']:
            with self.subTest(flag=flag):
                self.config[flag] = True
                self.assertNotEqual(self.invoke().returncode, 0)
                self.config[flag] = False
        self.assertFalse((self.release/'installed.json').exists())

    def test_failed_install_keeps_only_the_pinned_paused_override(self):
        for flag in ['psql_failure', 'compose_failure', 'unhealthy', 'wrong_installed_image']:
            with self.subTest(flag=flag):
                self.config[flag] = True
                self.assertNotEqual(self.invoke().returncode, 0)
                self.config[flag] = False
                config = self.release/'compose.paused.json'
                self.assertTrue(config.is_file())
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                services = json.loads(config.read_text())['services']
                self.assertEqual(set(services), set(self.manifest['images']))
                for service, image in self.manifest['images'].items():
                    self.assertEqual(services[service]['image'], image)
                self.assertEqual(services['backend']['environment'], {'INTAKE_V2_ENABLED': 'false', 'BACKGROUND_JOBS_ENABLED': 'false'})
                self.assertEqual(services['voice']['environment'], {'LIVE_ENABLED': 'false'})
                self.assertNotIn('fictional_runtime', config.read_text())
                self.assertFalse((self.release/'installed.json').exists())

    def test_sql_retains_transactions_and_places_markers_before_commit(self):
        self.assertEqual(self.invoke(migrate=True).returncode, 0)
        sql = (self.base/'generated.sql').read_text()
        self.assertIn('pg_advisory_lock', sql)
        self.assertLess(sql.index('pg_stat_activity'), sql.index('CREATE TABLE IF NOT EXISTS public.schema_migrations'))
        self.assertLess(sql.index('m.sha256 IS NULL'), sql.index('AS pending'))
        self.assertIn('pg_prepared_xacts', sql)
        self.assertIn("has_table_privilege('fictional_runtime',p.relation,p.privilege)", sql)
        self.assertNotIn('GRANT ALL', sql)
        for name, checksum in self.manifest['migrations'].items():
            block = sql.split("WHERE name='%s') AS pending" % name)[1].split('\\endif')[0]
            self.assertIn('BEGIN;', block)
            self.assertTrue(block.rstrip().endswith('COMMIT;'))
            self.assertIn("VALUES ('%s','%s');\nCOMMIT;" % (name, checksum), block)
            if name == '012_interview_admission_limits.sql':
                self.assertLess(block.index('SET paused=true'), block.index('INSERT INTO public.schema_migrations'))
        self.assertNotIn('SET paused=false', sql)

    def test_standalone_migration_rejects_running_writers_and_transaction_changes(self):
        self.config['writers_running'] = True
        self.assertNotEqual(self.invoke(migrate=True).returncode, 0)
        self.config['writers_running'] = False
        file = self.release/'webapp/backend/migrations/009_runtime_schema_consolidation.sql'
        file.write_text('BEGIN;\n'+file.read_text()+'\nCOMMIT;\n')
        self.manifest['migrations'][file.name] = sha(file)
        self.assertNotEqual(self.invoke(migrate=True).returncode, 0)
        self.assertFalse((self.base/'generated.sql').exists())

    def test_workflow_builds_pinned_sources_on_main_for_solo_owner(self):
        source = (ROOT/'.github/workflows/deploy.yml').read_text()
        triggers = source.split('\npermissions:')[0]
        self.assertIn('workflow_dispatch:', triggers)
        self.assertIn('\n  push:\n    branches: [main]', triggers)
        self.assertIn('if: github.actor == github.repository_owner && github.triggering_actor == github.repository_owner', source)
        self.assertIn('test "$GITHUB_REF" = refs/heads/main', source)
        self.assertIn('ref: ${{ github.sha }}', source)
        self.assertIn('--provenance=false --platform linux/amd64', source)
        self.assertIn('--network none --read-only', source)
        self.assertIn('scripts/deploy-from-github.py', source)
        self.assertIn('rsync --recursive --partial --append-verify', source)
        self.assertNotIn('VOICE_REVISION_PENDING', source)
        self.assertNotIn(':latest', source)
        self.assertNotIn('GH_TOKEN', source)

    def test_application_deploy_preserves_database_and_keeps_admissions_closed(self):
        source = (ROOT/'scripts/deploy-from-github.py').read_text()
        self.assertIn('BEGIN READ ONLY', source)
        self.assertIn("db['migrations'] == expected", source)
        self.assertIn("db['paused'] is True", source)
        self.assertIn("settings['DB_USER'] == 'insafdaar_runtime'", source)
        self.assertIn("'INTAKE_V2_ENABLED': 'false'", source)
        self.assertIn("'BACKGROUND_JOBS_ENABLED': 'false'", source)
        self.assertIn("'LIVE_ENABLED': 'false'", source)
        self.assertIn("'--no-deps', '--no-build'", source)
        self.assertIn("current['Id'] == old['Id']", source)
        self.assertNotIn('compose down', source)
        self.assertNotIn('docker build', source)
        self.assertNotIn('DROP DATABASE', source)
        self.assertNotIn('ALTER ROLE', source)


if __name__ == '__main__':
    unittest.main()
