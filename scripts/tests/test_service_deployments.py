import copy
import importlib.util
import ipaddress
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ServiceDeployments(unittest.TestCase):
    def test_changed_paths_select_only_relevant_services(self):
        select = load('deploy-changes').changed_services
        cases = [(['frontend/src/App.tsx'], ['frontend']),
                 (['backend/server.js'], ['backend']),
                 (['backend/server.js', 'frontend/package.json'], ['backend', 'frontend']),
                 (['README.md', 'docs/setup.md', 'frontend/README.md'], []),
                 (['.github/workflows/deploy.yml', 'scripts/package-release.py'], []),
                 (['docker-compose.yml'], ['backend', 'frontend'])]
        for paths, expected in cases:
            with self.subTest(paths=paths):
                self.assertEqual(select(paths), expected)

    def exercise(self, service, *, bad_schema=False, live=False, unhealthy=False):
        module = load('deploy-from-github')
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            module.BASE = base
            revision = 'a'*40
            release = base/(revision+'-1-1')
            release.mkdir()
            (release/'images.tar.gz').write_bytes(b'fictional-image-archive')
            (release/'compose.yml').write_text('services: {}\n')
            active = base/'active-compose.yml'
            active.write_text('services: {}\n')
            image = 'sha256:'+'f'*64
            metadata = {'service': service, 'revision': revision, 'image': image,
                        'images_sha256': module.digest(release/'images.tar.gz'),
                        'compose_sha256': module.digest(release/'compose.yml'),
                        'migrations': {'001.sql': 'b'*64}}
            (release/'release.json').write_text(json.dumps(metadata))
            containers = {}
            for i, name in enumerate(module.CONTAINERS):
                containers[name] = {'Id': 'original-'+name, 'Image': 'sha256:'+str(i)*64,
                                    'State': {'Health': {'Status': 'healthy'}},
                                    'Config': {'Labels': {'com.docker.compose.project': 'webapp',
                                                         'com.docker.compose.project.config_files': str(active)+',override.json'},
                                               'Env': []}}
            containers['backend']['Config']['Env'] = ['INTAKE_V2_ENABLED='+str(live).lower(), 'BACKGROUND_JOBS_ENABLED=false', 'DB_USER=fixture_runtime', 'DB_DATABASE=fixture_data']
            containers['voice']['Config']['Env'] = ['LIVE_ENABLED='+str(live).lower()]
            containers['db']['Config']['Env'] = ['POSTGRES_USER=fixture_admin', 'POSTGRES_DB=fixture_data']
            calls = []
            started = False

            def inspect(name):
                result = copy.deepcopy(containers[name])
                if name == service and started:
                    result['Id'] = 'replacement-'+name
                    result['Image'] = image
                    result['State']['Health']['Status'] = 'unhealthy' if unhealthy else 'healthy'
                return result

            def run(*args, **kwargs):
                nonlocal started
                calls.append(args)
                if args[:3] == ('docker', 'image', 'inspect'):
                    return json.dumps([{'Id': image, 'Architecture': 'amd64', 'Os': 'linux',
                                        'Config': {'Labels': {'org.opencontainers.image.revision': revision}}}])
                if 'psql' in args:
                    return json.dumps({'migrations': {} if bad_schema else metadata['migrations'], 'runtime_safe': True})
                if 'config' in args:
                    override = json.loads((release/'compose.images.json').read_text())
                    override['services']['backend']['environment'].update(
                        DB_USER='fixture_runtime', DB_DATABASE='fixture_data', DB_HOST='db', DB_PORT='5432')
                    return json.dumps(override)
                if 'up' in args:
                    started = True
                return ''

            with patch.object(module, 'inspect', side_effect=inspect), patch.object(module, 'run', side_effect=run), patch('builtins.open', wraps=open) as opened:
                if bad_schema or unhealthy or (live and service in ['backend', 'voice']):
                    with self.assertRaises(RuntimeError):
                        module.deploy(service, release)
                    self.assertFalse((release/'installed.json').exists())
                else:
                    module.deploy(service, release)
                    receipt = json.loads((release/'installed.json').read_text())
                    for name in module.SERVICES:
                        self.assertEqual(receipt['images'][name], image if name == service else containers[name]['Image'])
                    override = json.loads((release/'compose.images.json').read_text())
                    self.assertEqual(override['services']['voice']['environment']['LIVE_ENABLED'], str(live).lower())
                self.assertTrue(any(call.args[0] == '/tmp/insafdaar-deploy.lock' for call in opened.call_args_list))
            up = [call for call in calls if 'up' in call]
            for call in up:
                self.assertEqual(call[-1], service)
                self.assertIn('--no-deps', call)
                self.assertIn('--no-build', call)
            self.assertFalse(any('stop' in call or 'down' in call for call in calls))
            if service != 'backend':
                self.assertFalse(any('psql' in call for call in calls))
            if bad_schema or (live and service in ['backend', 'voice']):
                self.assertEqual(up, [])
            else:
                self.assertEqual(len(up), 1)

    def test_each_service_replaces_only_itself(self):
        for service in ['frontend', 'backend', 'voice', 'drafting', 'legal-rag']:
            with self.subTest(service=service):
                self.exercise(service)

    def test_pending_migration_never_replaces_backend(self):
        self.exercise('backend', bad_schema=True)

    def test_active_voice_cannot_be_abruptly_replaced(self):
        self.exercise('voice', live=True)

    def test_frontend_preserves_enabled_voice_without_restarting_it(self):
        self.exercise('frontend', live=True)

    def test_failed_health_never_records_success(self):
        self.exercise('drafting', unhealthy=True)

    def test_public_workflows_have_no_deployment_address_or_account_literals(self):
        paths = list((ROOT/'.github').rglob('*.yml'))
        for path in paths:
            source = path.read_text()
            for value in re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', source):
                self.assertFalse(ipaddress.ip_address(value).is_global, str(path))
            self.assertNotRegex(source, r'/home/[a-z_][a-z0-9_-]*/')
            self.assertNotRegex(source, r'[a-z_][a-z0-9_-]*@\$\{?DEPLOY_HOST')
        self.assertIn('env.FRONTEND_API_BASE_URL', (ROOT/'.github/actions/deploy-service/action.yml').read_text())


if __name__ == '__main__':
    unittest.main()
