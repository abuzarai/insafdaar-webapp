-- Automatic source text is separate from reviewed facts. Purging does not erase backups;
-- backup expiry must be managed by the deployment's independent retention policy.
BEGIN;
CREATE TABLE public.case_live_transcripts (
  session_id TEXT PRIMARY KEY REFERENCES public.case_intake_live_sessions(session_id),
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  issued_at TIMESTAMPTZ NOT NULL,
  session_expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  retention_ends_at TIMESTAMPTZ NOT NULL,
  notice_version TEXT NOT NULL CHECK (notice_version='live-transcript-v1'),
  acknowledged_at TIMESTAMPTZ NOT NULL,
  saved_through INTEGER NOT NULL DEFAULT 0 CHECK (saved_through BETWEEN 0 AND 256),
  text_bytes INTEGER NOT NULL DEFAULT 0 CHECK (text_bytes BETWEEN 0 AND 262144),
  last_captured_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_captured_sequence BETWEEN 0 AND 256),
  sealed BOOLEAN NOT NULL DEFAULT FALSE,
  seal_reason TEXT CHECK (seal_reason IN ('prepare','stopped','disconnected','timeout','provider_error','limit','capture_error')),
  sealed_at TIMESTAMPTZ,
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  collection_state TEXT NOT NULL DEFAULT 'collecting' CHECK (collection_state IN ('collecting','saved','partial')),
  CHECK (issued_at <= session_expires_at),
  CHECK (ended_at IS NULL OR ended_at BETWEEN issued_at AND session_expires_at),
  CHECK (saved_through <= last_captured_sequence),
  CHECK ((sealed AND seal_reason IS NOT NULL AND sealed_at IS NOT NULL) OR (NOT sealed AND seal_reason IS NULL AND sealed_at IS NULL)),
  CHECK (truncated = (sealed AND seal_reason IN ('limit','capture_error'))),
  CHECK (retention_ends_at = COALESCE(ended_at,session_expires_at) + INTERVAL '2160 hours')
);
CREATE INDEX live_transcripts_owner ON public.case_live_transcripts(case_id,issued_at DESC,session_id DESC);
CREATE INDEX live_transcripts_expiry ON public.case_live_transcripts(retention_ends_at);
CREATE TABLE public.case_live_transcript_entries (
  session_id TEXT NOT NULL REFERENCES public.case_live_transcripts(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 256),
  speaker TEXT NOT NULL CHECK (speaker IN ('user','assistant')),
  -- UTF8 bytes preserve source NUL, which PostgreSQL TEXT cannot represent.
  -- The trusted ingest validator enforces the 4096 Unicode-codepoint limit.
  text_utf8 BYTEA NOT NULL CHECK (octet_length(text_utf8) BETWEEN 1 AND 16384),
  -- Canonical UTC ISO text preserves Python microseconds through the JS pg driver.
  observed_at TEXT NOT NULL CHECK (observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'),
  interrupted BOOLEAN NOT NULL,
  PRIMARY KEY(session_id,sequence)
);
CREATE FUNCTION public.reject_live_transcript_entry_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Source entries are immutable'; END;
$$;
CREATE TRIGGER live_transcript_entry_immutable BEFORE UPDATE ON public.case_live_transcript_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_live_transcript_entry_update();
COMMIT;
