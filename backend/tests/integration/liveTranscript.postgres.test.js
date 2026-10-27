// Opt-in, newly created fictional socket-only PostgreSQL. No operational db.js/dotenv.
import { jest, describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const enabled = process.env.LIVE_TRANSCRIPT_PG_TEST === 'disposable-only';
const socket = process.env.LIVE_TRANSCRIPT_TEST_SOCKET;
if (enabled && !/^\/tmp\/insafdaar-transcript-pg-[A-Za-z0-9]+\/socket$/.test(socket || '')) throw new Error('Owned disposable socket required');
const config = { host: socket, port: 5432, user: 'postgres', ssl: false, max: 6, connectionTimeoutMillis: 2000,
  options: '-c statement_timeout=10000 -c lock_timeout=5000' };
const admin = enabled ? new pg.Pool({ ...config, database: 'postgres' }) : null;
const pool = enabled ? new pg.Pool({ ...config, database: 'transcript_disposable' }) : null;
let service;
if (enabled) {
  jest.unstable_mockModule('../../db.js', () => ({ default: pool }));
  service = await import('../../services/liveTranscript.service.js');
}
const actor = { id: 42, role: 'client' };
const sql = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
let source;
async function register(age = 0, shortened = false, microseconds = false) {
  const issued = Date.now() - age;
  source = { sessionId: 'fictional-source', noticeVersion: 'live-transcript-v1', acknowledgedAt: new Date(issued).toISOString(),
    issuedAt: new Date(issued).toISOString(), originalExpiry: new Date(issued + 300000).toISOString() };
  if (microseconds) source.originalExpiry = source.originalExpiry.replace('Z', '456Z');
  await pool.query('INSERT INTO public.case_intake_live_sessions(session_id,case_id,actor_user_id,expires_at) VALUES($1,101,42,$2)',
    [source.sessionId, shortened ? source.issuedAt : source.originalExpiry]);
  return service.registerSource(actor, 101, source);
}
function batch(texts = ['Fictional اردو 😀'], sealed = false) {
  return { version: 1, session_id: source.sessionId, after_sequence: 0,
    entries: texts.map((text, i) => ({ sequence: i + 1, speaker: 'user', text, observed_at: '2026-01-01T00:00:00.123456Z', interrupted: false })),
    next_sequence: texts.length, last_captured_sequence: texts.length, earliest_available_sequence: 1,
    sealed, seal_reason: sealed ? 'stopped' : null, sealed_at: sealed ? new Date().toISOString() : null,
    truncated: false, input_tail_complete: false, has_more: false };
}
(enabled ? describe : describe.skip)('live transcript: real owned disposable PostgreSQL', () => {
  beforeAll(async () => {
    const identity = (await admin.query("SELECT current_setting('listen_addresses') AS listen,current_setting('insafdaar.fixture',true) AS marker")).rows[0];
    if (identity.listen !== '' || identity.marker !== 'fictional-transcript-only') throw new Error('Wrong fixture');
    await admin.query('CREATE DATABASE transcript_disposable');
    const fixture = await readFile(new URL('./reviewedIntake.postgres.fixture.sql', import.meta.url), 'utf8');
    await pool.query(fixture.replaceAll('reviewed_intake_disposable', 'transcript_disposable'));
    await pool.query(await sql('010_reviewed_voice_intake.sql'));
    await pool.query(await sql('011_live_transcripts.sql'));
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE public.client_cases CASCADE');
    await pool.query("UPDATE public.users SET role='client' WHERE id=42");
    await pool.query("INSERT INTO public.client_cases(id,user_id,description) VALUES(101,42,'Fictional fixture')");
  });
  afterAll(async () => { await pool?.end(); await admin?.end(); });
  test('migration, Stop-shortened registration, exact UTF8/NUL/microsecond immutable replay', async () => {
    const initial = await register(0, true);
    expect(initial.sessionExpiresAt).toBe(source.originalExpiry);
    const input = batch(['\0'.repeat(4096)]);
    expect((await service.saveBatch(actor, 101, source.sessionId, 0, input)).savedThrough).toBe(1);
    await service.saveBatch(actor, 101, source.sessionId, 0, input);
    const read = await service.ownerRead(actor, 101, source.sessionId);
    expect(read.entries[0]).toMatchObject({ text: input.entries[0].text, observedAt: '2026-01-01T00:00:00.123456Z' });
    await expect(pool.query("UPDATE public.case_live_transcript_entries SET text_utf8=decode('61','hex')")).rejects.toThrow('immutable');
  });
  test('real Python microsecond expiry registers without extending the original deadline', async () => {
    const result = await register(0, false, true);
    expect(result.sessionExpiresAt).toBe(new Date(source.originalExpiry).toISOString());
    expect(Date.parse(result.sessionExpiresAt)).toBeLessThanOrEqual(Date.parse(source.originalExpiry));
  });
  test('conflicting replay and future cursor cannot change original source/ACK', async () => {
    await register(); const input = batch();
    await service.saveBatch(actor, 101, source.sessionId, 0, input);
    const changed = batch(['different fictional source']);
    await expect(service.saveBatch(actor, 101, source.sessionId, 0, changed)).rejects.toMatchObject({ code: 'TRANSCRIPT_CONFLICT' });
    await expect(service.ownerRead(actor, 101, source.sessionId, { afterSequence: 2 })).rejects.toMatchObject({ code: 'INVALID_TRANSCRIPT' });
    expect((await service.ownerRead(actor, 101, source.sessionId)).entries[0].text).toBe(input.entries[0].text);
  });
  test('transaction failure rolls back earlier entry and saved-through ACK atomically', async () => {
    await register();
    await pool.query("CREATE FUNCTION public.reject_fixture_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sequence=2 THEN RAISE EXCEPTION 'fictional failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_second BEFORE INSERT ON public.case_live_transcript_entries FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_second()");
    try {
      await expect(service.saveBatch(actor, 101, source.sessionId, 0, batch(['one', 'two']))).rejects.toMatchObject({ code: 'TRANSCRIPT_UNAVAILABLE' });
      const result = await service.ownerRead(actor, 101, source.sessionId);
      expect(result.interview.savedThrough).toBe(0); expect(result.entries).toEqual([]);
    } finally { await pool.query('DROP TRIGGER fixture_second ON public.case_live_transcript_entries; DROP FUNCTION public.reject_fixture_second()'); }
  });
  test('concurrent identical batches serialize to one immutable entry', async () => {
    await register(); const input = batch();
    await Promise.all([service.saveBatch(actor, 101, source.sessionId, 0, input), service.saveBatch(actor, 101, source.sessionId, 0, input)]);
    expect((await service.ownerRead(actor, 101, source.sessionId)).entries).toHaveLength(1);
  });
  test('fresh role, owner and actor binding fail closed', async () => {
    await register();
    for (const foreign of [{ id: 43, role: 'client' }, { id: 77, role: 'advocate' }, { id: 88, role: 'admin' }]) {
      await expect(service.ownerList(foreign, 101)).rejects.toBeDefined();
    }
    await pool.query("UPDATE public.users SET role='advocate' WHERE id=42");
    await expect(service.ownerRead(actor, 101, source.sessionId)).rejects.toMatchObject({ code: 'TRANSCRIPT_NOT_FOUND' });
  });
  test('Stop/live expiry do not gate retained owner reads; first end fixes90days', async () => {
    await register(600000);
    const end = new Date(Date.parse(source.issuedAt) + 60000).toISOString();
    const first = await service.markEnded(actor, 101, source.sessionId, end);
    const second = await service.markEnded(actor, 101, source.sessionId, new Date().toISOString());
    expect(first.retentionEndsAt).toBe(new Date(Date.parse(end) + 90 * 86400000).toISOString());
    expect(second.retentionEndsAt).toBe(first.retentionEndsAt);
    expect((await service.ownerList(actor, 101)).interviews).toHaveLength(1);
  });
  test('expiry enforced before purge and cascade removes source bytes only', async () => {
    await register(89 * 86400000);
    await service.saveBatch(actor, 101, source.sessionId, 0, batch());
    await pool.query("UPDATE public.case_live_transcripts SET issued_at=issued_at-INTERVAL '48 hours',session_expires_at=session_expires_at-INTERVAL '48 hours',retention_ends_at=retention_ends_at-INTERVAL '48 hours'");
    expect((await service.ownerList(actor, 101)).interviews).toEqual([]);
    await expect(service.ownerRead(actor, 101, source.sessionId)).rejects.toMatchObject({ code: 'TRANSCRIPT_NOT_FOUND' });
    expect(await service.purgeExpired()).toBe(1);
    expect(Number((await pool.query('SELECT COUNT(*) AS n FROM public.case_live_transcript_entries')).rows[0].n)).toBe(0);
    expect((await pool.query('SELECT description FROM public.client_cases WHERE id=101')).rows[0].description).toBe('Fictional fixture');
  });
});
