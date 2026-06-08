-- Interview persistence hardening for production reliability

ALTER TABLE public.case_intake_sessions
  ADD COLUMN IF NOT EXISTS completion_source TEXT,
  ADD COLUMN IF NOT EXISTS result_hash TEXT,
  ADD COLUMN IF NOT EXISTS webhook_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fallback_received_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_case_intake_sessions_result_hash
  ON public.case_intake_sessions(result_hash);
