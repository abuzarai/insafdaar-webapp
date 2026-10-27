#!/usr/bin/env python3
"""Select webapp containers from changed source paths."""
import json
import os
import subprocess


def changed_services(paths):
    selected = set()
    for path in paths:
        if path.endswith('.md') or path.startswith('docs/'):
            continue
        if path.startswith('frontend/'):
            selected.add('frontend')
        elif path.startswith('backend/'):
            selected.add('backend')
        elif path == 'docker-compose.yml':
            selected.update(['frontend', 'backend'])
    return sorted(selected)


def main():
    requested = os.environ.get('REQUESTED', '')
    if requested:
        if requested not in ['frontend', 'backend', 'both']:
            raise RuntimeError('Invalid requested service')
        selected = ['backend', 'frontend'] if requested == 'both' else [requested]
    else:
        before = os.environ['BEFORE']
        after = os.environ['AFTER']
        if before and set(before) != {'0'}:
            command = ['git', 'diff', '--name-only', '--no-renames', before, after]
        else:
            command = ['git', 'ls-tree', '-r', '--name-only', after]
        paths = subprocess.check_output(command, text=True).splitlines()
        selected = changed_services(paths)
    print('services='+json.dumps(selected))


if __name__ == '__main__':
    main()
