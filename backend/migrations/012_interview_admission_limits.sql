BEGIN;
CREATE TABLE public.interview_admission_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  paused BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO public.interview_admission_policy(singleton) VALUES (true);
-- Deliberately no case/user foreign keys: deleting a case must not erase usage.
CREATE TABLE public.interview_admissions (
  actor_user_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  intent_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reserved','accepted','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  active_until TIMESTAMPTZ NOT NULL,
  session_id TEXT,
  PRIMARY KEY (actor_user_id,case_id,intent_key)
);
CREATE INDEX interview_admissions_account_window ON public.interview_admissions(actor_user_id,created_at) WHERE outcome<>'refunded';
CREATE INDEX interview_admissions_global_window ON public.interview_admissions(created_at) WHERE outcome<>'refunded';
CREATE INDEX interview_admissions_active ON public.interview_admissions(actor_user_id,active_until) WHERE outcome<>'refunded';
CREATE INDEX case_intake_live_sessions_actor_expiry ON public.case_intake_live_sessions(actor_user_id,expires_at);
INSERT INTO public.interview_admissions(actor_user_id,case_id,intent_key,request_hash,outcome,created_at,active_until,session_id)
SELECT actor_user_id,case_id,intent_key,request_hash,
  CASE WHEN response->>'rejected'='true' THEN 'refunded' WHEN response->>'sessionId' IS NOT NULL THEN 'accepted' ELSE 'reserved' END,
  created_at,
  CASE WHEN response->>'sessionId' IS NOT NULL THEN (response->>'expiresAt')::timestamptz ELSE created_at+INTERVAL '10 minutes' END,
  response->>'sessionId'
FROM public.case_intake_receipts WHERE operation='admit';
COMMIT;
