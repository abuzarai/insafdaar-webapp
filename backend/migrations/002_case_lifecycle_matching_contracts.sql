-- Case lifecycle, matching, and contract foundations

-- 1) Lifecycle event log for every meaningful case status transition
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

-- 2) Matching engine snapshots and scored candidates
CREATE TABLE IF NOT EXISTS public.case_matching_runs (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  triggered_by INTEGER REFERENCES public.users(id),
  shortlist_size INTEGER NOT NULL DEFAULT 5,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_matching_runs_case_created
  ON public.case_matching_runs(case_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_case_match_candidates_case_score
  ON public.case_match_candidates(case_id, total_score DESC);

ALTER TABLE public.client_cases
  ADD COLUMN IF NOT EXISTS preferred_advocate_id INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS preferred_advocate_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preferred_match_run_id BIGINT REFERENCES public.case_matching_runs(id);

-- 3) Contract lifecycle base tables (typed name + checkbox signatures)
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
  UNIQUE (case_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_case_contracts_case_updated
  ON public.case_contracts(case_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.case_contract_signatures (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  signer_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL,
  typed_full_name TEXT NOT NULL,
  consent_checked BOOLEAN NOT NULL DEFAULT FALSE,
  signature_note TEXT,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, signer_role)
);

CREATE INDEX IF NOT EXISTS idx_case_contract_signatures_case
  ON public.case_contract_signatures(case_id, signed_at DESC);

CREATE TABLE IF NOT EXISTS public.case_contract_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES public.users(id),
  actor_role TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_contract_audit_case
  ON public.case_contract_audit_logs(case_id, created_at DESC);
