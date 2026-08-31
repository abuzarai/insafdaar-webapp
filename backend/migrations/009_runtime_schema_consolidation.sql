-- 009_runtime_schema_consolidation.sql
-- Audit #26: move schema created on request paths into migrations.
-- Idempotent: every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.case_matching_runs (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  triggered_by INTEGER REFERENCES public.users(id),
  shortlist_size INTEGER NOT NULL DEFAULT 5,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.case_match_candidates (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES public.case_matching_runs(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  advocate_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rank_position INTEGER NOT NULL,
  total_score NUMERIC(6,2) NOT NULL,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, advocate_id),
  UNIQUE (run_id, rank_position)
);

ALTER TABLE public.client_cases
  ADD COLUMN IF NOT EXISTS preferred_advocate_id INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS preferred_advocate_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preferred_match_run_id BIGINT REFERENCES public.case_matching_runs(id);

CREATE TABLE IF NOT EXISTS public.case_contracts (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  contract_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  drafted_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by INTEGER REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  approval_note TEXT,
  rejection_note TEXT,
  UNIQUE (case_id, version_no)
);

CREATE TABLE IF NOT EXISTS public.case_contract_signatures (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  signer_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL,
  signature_type TEXT NOT NULL DEFAULT 'OTP',
  otp_hash TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE (contract_id, signer_user_id)
);

CREATE TABLE IF NOT EXISTS public.case_contract_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_role TEXT,
  actor_user_id INTEGER REFERENCES public.users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.case_contract_otps (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  signer_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'CONTRACT_SIGN',
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.case_contract_artifacts (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  created_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.case_contract_attachments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.draft_sessions (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  generation_id TEXT UNIQUE NOT NULL,
  draft_json JSONB NOT NULL,
  advocate_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_assistant_conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_assistant_conversations_owner_updated
  ON legal_assistant_conversations (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS legal_assistant_guest_usage (
  owner_id TEXT PRIMARY KEY,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_otps
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamp without time zone;

CREATE TABLE IF NOT EXISTS public.case_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES public.users(id),
  actor_role TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_lifecycle_events_case_created
  ON public.case_lifecycle_events(case_id, created_at DESC);