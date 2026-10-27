-- Fictional seeds ONLY, after the actual tracked schema and migrations 001-009.
-- Never load into an operational database; this is not a schema replacement.
DO $$ BEGIN
  IF current_database()<>'reviewed_intake_disposable' OR current_setting('listen_addresses')<>'' THEN
    RAISE EXCEPTION 'Disposable socket-only database required';
  END IF;
  IF to_regclass('public.case_payment_events') IS NULL OR
     to_regclass('public.case_lifecycle_events') IS NULL OR
     to_regclass('public.legal_assistant_conversations') IS NULL OR
     to_regclass('public.case_intake_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'Fresh repository baseline through 009 required';
  END IF;
END $$;
CREATE TABLE public.reviewed_intake_test_guard (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  purpose TEXT NOT NULL,
  migration_sha256 TEXT,
  baseline TEXT NOT NULL CHECK (baseline='repository'),
  baseline_schema_sha256 TEXT NOT NULL
);
INSERT INTO public.reviewed_intake_test_guard VALUES
  (true,'fictional-disposable-only',NULL,'repository',
   '6013c36e770d3b8ee97ba3d5cead45b9c5014c51bdb36ade13869a96483be064');
-- Independent application connection: no owner/superuser/DDL privileges.
-- Socket-only trust authentication; this is not an operational account.
CREATE ROLE reviewed_intake_fixture_runtime LOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
INSERT INTO public.users (id,name,email,password,role) VALUES
  (42,'Fictional owning client','owning@example.invalid','fixture-not-a-login-hash','client'),
  (43,'Fictional other client','other@example.invalid','fixture-not-a-login-hash','client'),
  (77,'Fictional advocate','advocate@example.invalid','fixture-not-a-login-hash','advocate'),
  (88,'Fictional administrator','admin@example.invalid','fixture-not-a-login-hash','admin');
INSERT INTO public.client_cases (id,user_id,status,description,interview_completed)
VALUES (900,42,'MATCHING_REVIEW','Fictional historical issue',true);
INSERT INTO public.case_intake_sessions (session_id,case_id,user_id,status,analysis)
VALUES ('historical-fictional',900,42,'COMPLETED','{"issue_summary":"Fictional historical issue"}');
