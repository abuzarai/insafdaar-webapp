-- Case payment rollups + manual override support

ALTER TABLE public.client_cases
  ADD COLUMN IF NOT EXISTS payment_required_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_verified_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status_computed TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS payment_manual_override_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_manual_override_note TEXT,
  ADD COLUMN IF NOT EXISTS payment_manual_override_by INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS payment_manual_override_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_cases_payment_status
  ON public.client_cases(payment_status);

ALTER TABLE public.client_billing
  ADD COLUMN IF NOT EXISTS is_installment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS issued_by_admin_id INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by_admin_id INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_admin_id INTEGER REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_note TEXT;

CREATE INDEX IF NOT EXISTS idx_client_billing_case_status
  ON public.client_billing(case_id, status, created_at DESC);

ALTER TABLE public.client_payment_proofs
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

CREATE TABLE IF NOT EXISTS public.case_payment_events (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  billing_id INTEGER REFERENCES public.client_billing(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES public.users(id),
  actor_role TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_payment_events_case_created
  ON public.case_payment_events(case_id, created_at DESC);
