#!/usr/bin/env python3
"""Package GitHub-built images and the matching webapp source for the VM."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def sha256(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    web, drafting, voice = sys.argv[1:]
    revisions = {'backend': web, 'frontend': web, 'drafting': drafting, 'voice': voice}
    tags = {service: f'insafdaar-ci/{service}:{web}' for service in revisions}
    out = Path('release')
    out.mkdir()
    archive = out/'images.tar.gz'
    with archive.open('wb') as target, gzip.GzipFile(fileobj=target, mode='wb', compresslevel=1, mtime=0) as compressed:
        child = subprocess.Popen(['docker', 'save', *tags.values()], stdout=subprocess.PIPE)
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
    images = {}
    for entry in entries:
        config = Path(entry['Config']).name.removesuffix('.json')
        for service, tag in tags.items():
            if tag in entry['RepoTags']:
                images[service] = 'sha256:'+config
    if set(images) != set(revisions):
        raise RuntimeError('Incomplete image export')
    source = out/'webapp.tar.gz'
    with source.open('wb') as target:
        subprocess.run(['git', 'archive', '--format=tar.gz', web], stdout=target, check=True)
    metadata = {'commit': web, 'revisions': revisions, 'images': images,
                'images_sha256': sha256(archive), 'source_sha256': sha256(source)}
    (out/'release.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print('Packaged four images and matching source; no runtime configuration included.')


if __name__ == '__main__':
    main()
