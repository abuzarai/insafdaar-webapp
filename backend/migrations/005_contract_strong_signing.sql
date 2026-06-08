-- Stronger in-house contract signing foundations

CREATE TABLE IF NOT EXISTS public.case_contract_attachments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  uploaded_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_contract_attachments_case_version
  ON public.case_contract_attachments(case_id, version_no, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_case_contract_otps_lookup
  ON public.case_contract_otps(case_id, contract_id, signer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.case_contract_artifacts (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  canonical_text_sha256 TEXT NOT NULL,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_case_contract_artifacts_case_version
  ON public.case_contract_artifacts(case_id, version_no, generated_at DESC);

ALTER TABLE public.case_contract_signatures
  ADD COLUMN IF NOT EXISTS contract_version_no INTEGER,
  ADD COLUMN IF NOT EXISTS canonical_text_sha256_at_sign TEXT,
  ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_session_id TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_read_understood BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_voluntary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_typed_signature BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_reviewed_attachments BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT;
