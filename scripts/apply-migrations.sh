#!/usr/bin/env bash
# Approved, checksum-bound migrations only; application writers must be stopped.
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
    require(len(sys.argv) == 3, 'Expected approved manifest path and SHA256')
    path = Path(sys.argv[1]).resolve()
    manifest_bytes = path.read_bytes()
    require(re.fullmatch(r'[a-f0-9]{64}', sys.argv[2]) and hashlib.sha256(manifest_bytes).hexdigest() == sys.argv[2], 'Manifest checksum mismatch')
    manifest = json.loads(manifest_bytes.decode('utf-8'), object_pairs_hook=unique_object)
    require(manifest['schema_version'] == 1, 'Unsupported manifest version')
    require(os.environ.get('DEPLOY_LOCK_FD', '').isdigit(), 'Migration requires the deploy process lock')
    lock_fd = int(os.environ['DEPLOY_LOCK_FD'])
    lock = os.stat(os.environ.get('DEPLOY_LOCK_FILE', '/tmp/insafdaar-deploy.lock'))
    inherited = os.fstat(lock_fd)
    require((lock.st_dev, lock.st_ino) == (inherited.st_dev, inherited.st_ino), 'Wrong migration lock')
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require(manifest['status'] == 'approved-for-paused-install', 'Migration is not approved')
    for gate in ['automatic_deploy_frozen', 'maintenance_fenced', 'drained', 'restore_verified']:
        require(manifest['cutover'][gate] is True, 'Missing approved cutover prerequisite: '+gate)
    backup = Path(manifest['cutover']['backup']['path'])
    require(backup.is_absolute() and backup.is_file() and backup.stat().st_size > 0, 'Backup artifact missing')
    require(digest(backup) == manifest['cutover']['backup']['sha256'], 'Backup checksum mismatch')
    root = path.parent/'webapp'
    files = {f: f.read_bytes() for f in sorted((root/'backend/migrations').glob('*.sql'))}
    require(files and manifest['migrations'] == {f.name: hashlib.sha256(data).hexdigest() for f, data in files.items()}, 'Migration inventory/checksum mismatch')
    db = manifest['database']
    for key in ['name', 'migration_user', 'runtime_role']:
        require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', db[key]), 'Invalid database identity')
    require(db['container'] == 'insafdaar-db', 'Unexpected database container')
    for service in ['backend', 'drafting', 'voice']:
        state = subprocess.run(['docker', 'inspect', '--format', '{{.State.Status}}', 'insafdaar-'+service], text=True, capture_output=True)
        require(state.returncode == 0 and state.stdout.strip() in ['exited', 'created'], 'Old application writers must already be stopped')

    wrapped = {'010_reviewed_voice_intake.sql', '011_live_transcripts.sql', '012_interview_admission_limits.sql'}
    sql = []
    expected = []
    for file, data in files.items():
        require(re.fullmatch(r'[0-9]{3}_[a-z0-9_]+\.sql', file.name), 'Invalid migration filename')
        expected.append("('%s','%s')" % (file.name, manifest['migrations'][file.name]))
        text = data.decode('utf-8')
        require(not re.search(r'^\s*\\', text, re.M), 'Migration contains psql commands')
        if file.name in wrapped:
            require(re.match(r'\A(?:\s|--[^\n]*\n)*BEGIN;\s', text) and re.search(r'\nCOMMIT;\s*\Z', text), 'Reviewed transaction boundary changed')
            body = re.sub(r'\nCOMMIT;\s*\Z', '\n', text)
        else:
            # Older migrations are transaction-free; new transaction forms need review.
            require(not re.search(r'^\s*(BEGIN|COMMIT|ROLLBACK|END|START TRANSACTION)\s*;', text, re.M | re.I), 'Unreviewed migration transaction control')
            body = 'BEGIN;\n'+text+'\n'
        if file.name == '012_interview_admission_limits.sql':
            body += 'UPDATE public.interview_admission_policy SET paused=true WHERE singleton=true;\n'
        marker = "INSERT INTO public.schema_migrations(name,sha256) VALUES ('%s','%s');\nCOMMIT;\n" % (file.name, manifest['migrations'][file.name])
        sql.append("SELECT NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='%s') AS pending \\gset\n\\if :pending\n%s%s\\endif\n" % (file.name, body, marker))
    require(wrapped.issubset({f.name for f in files}), 'Reviewed intake migration set is incomplete')
    tables = {
        'users': ['SELECT', 'UPDATE'], 'client_cases': ['SELECT', 'INSERT', 'UPDATE'],
        'case_intake_revisions': ['SELECT', 'INSERT'], 'case_intake_confirmations': ['SELECT', 'INSERT'],
        'case_intake_submissions': ['SELECT', 'INSERT'], 'case_intake_receipts': ['SELECT', 'INSERT', 'UPDATE'],
        'case_intake_live_sessions': ['SELECT', 'INSERT', 'UPDATE'], 'interview_admissions': ['SELECT', 'INSERT', 'UPDATE'],
        'interview_admission_policy': ['SELECT', 'UPDATE'],
        'case_live_transcripts': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        'case_live_transcript_entries': ['SELECT', 'INSERT'], 'case_lifecycle_events': ['SELECT', 'INSERT'],
    }
    privileges = ','.join("('public.%s','%s')" % (table, privilege) for table, values in tables.items() for privilege in values)
    role = db['runtime_role']
    owned_tables = ','.join("'%s'" % table for table in tables)
    preflight = """SET lock_timeout='5s';
SET statement_timeout='120s';
SELECT pg_advisory_lock(485923017);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')
 OR EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
 RAISE EXCEPTION 'Database writers/connections are not fenced'; END IF;
END $$;
BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), sha256 text);
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS sha256 text;
COMMIT;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.schema_migrations m LEFT JOIN (VALUES %s) e(name,sha256) ON e.name=m.name
 WHERE e.name IS NULL OR m.sha256 IS NULL OR m.sha256<>e.sha256) THEN
 RAISE EXCEPTION 'Migration baseline/checksum requires audit; no automatic marker repair'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.interview_admission_policy') IS NOT NULL THEN
 UPDATE public.interview_admission_policy SET paused=true WHERE singleton=true;
 END IF;
END $$;
""" % ','.join(expected)
    grants = """BEGIN;
UPDATE public.interview_admission_policy SET paused=true WHERE singleton=true;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='%s' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR NOT has_schema_privilege('%s','public','USAGE')
 OR EXISTS (SELECT 1 FROM (VALUES %s) p(relation,privilege) WHERE NOT has_table_privilege('%s',p.relation,p.privilege))
 OR NOT has_sequence_privilege('%s','public.case_lifecycle_events_id_seq','USAGE')
 OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND r.rolname='%s' AND c.relname IN (%s))
 THEN RAISE EXCEPTION 'Runtime role/grants require review'; END IF;
 IF (SELECT count(*) FROM public.interview_admission_policy WHERE singleton=true AND paused=true)<>1 THEN
 RAISE EXCEPTION 'Admission policy must remain paused'; END IF;
END $$;
COMMIT;
""" % (role, role, privileges, role, role, role, owned_tables)
    command = ['docker', 'exec', '-i', db['container'], 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-U', db['migration_user'], '-d', db['name']]
    result = subprocess.run(command, input=preflight+''.join(sql)+grants, text=True, capture_output=True)
    if result.returncode:
        log = path.parent/'migration-error.log'
        # SQL diagnostics may contain data; retain privately, never echo them.
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(result.stdout+result.stderr)
        raise RuntimeError('Migration/grant check failed; protected migration-error.log retained; keep maintenance fenced')
    print('Migration checksums, transactional markers and runtime grants checked; admissions remain paused.')


try:
    main()
except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
    message = str(error) if isinstance(error, RuntimeError) else 'Invalid migration inputs or unavailable prerequisites'
    print('[migrate] STOP: '+message, file=sys.stderr)
    sys.exit(1)
PY
