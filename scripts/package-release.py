#!/usr/bin/env python3
"""Package one GitHub-built image without runtime credentials or data."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

SERVICES = {'backend', 'frontend', 'drafting', 'voice', 'legal-rag'}


def sha256(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    service, revision = sys.argv[1:]
    if service not in SERVICES or not re.fullmatch('[a-f0-9]{40}', revision):
        raise RuntimeError('Invalid service or source revision')
    tag = f'insafdaar-ci/{service}:{revision}'
    out = Path('release')
    out.mkdir()
    archive = out/'images.tar.gz'
    with archive.open('wb') as target, gzip.GzipFile(fileobj=target, mode='wb', compresslevel=1, mtime=0) as compressed:
        child = subprocess.Popen(['docker', 'save', tag], stdout=subprocess.PIPE)
        for chunk in iter(lambda: child.stdout.read(1024 * 1024), b''):
            compressed.write(chunk)
        if child.wait():
            raise RuntimeError('Image export failed')
    with tarfile.open(archive, mode='r|gz') as handle:
        for member in handle:
            if member.name == 'manifest.json':
                entries = json.load(handle.extractfile(member))
                break
        else:
            raise RuntimeError('Image manifest missing')
    if len(entries) != 1 or entries[0]['RepoTags'] != [tag]:
        raise RuntimeError('Expected exactly one image')
    config = Path(entries[0]['Config']).name.removesuffix('.json')
    if not re.fullmatch('[a-f0-9]{64}', config):
        raise RuntimeError('Invalid image configuration digest')
    metadata = {'service': service, 'revision': revision, 'image': 'sha256:'+config,
                'images_sha256': sha256(archive)}
    if service in ['backend', 'frontend']:
        shutil.copyfile('docker-compose.yml', out/'compose.yml')
        metadata['compose_sha256'] = sha256(out/'compose.yml')
    if service == 'backend':
        metadata['migrations'] = {p.name: sha256(p) for p in Path('backend/migrations').glob('*.sql')}
    (out/'release.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print('Packaged '+service+' only; no runtime configuration included.')


if __name__ == '__main__':
    main()
