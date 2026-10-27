-- Fictional contract fixture, NOT a production bootstrap or full schema dump.
-- Only load into the explicitly isolated reviewed_intake_disposable database.
DO $$ BEGIN
  IF current_database()<>'reviewed_intake_disposable' OR current_setting('listen_addresses')<>'' THEN
    RAISE EXCEPTION 'Disposable socket-only database required';
  END IF;
END $$;
CREATE TABLE public.reviewed_intake_test_guard (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  purpose TEXT NOT NULL,
  migration_sha256 TEXT,
  baseline TEXT NOT NULL DEFAULT 'reduced' CHECK (baseline='reduced')
);
INSERT INTO public.reviewed_intake_test_guard (singleton,purpose,migration_sha256)
VALUES (true,'fictional-disposable-only',NULL);
CREATE TABLE public.users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL
);
INSERT INTO public.users VALUES
  (42,'Fictional owning client','client'),
  (43,'Fictional other client','client'),
  (77,'Fictional advocate','advocate'),
  (88,'Fictional administrator','admin');
CREATE TABLE public.client_cases (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  title TEXT,
  description TEXT NOT NULL,
  language TEXT,
  legal_domain TEXT,
  source TEXT,
  interview_completed BOOLEAN NOT NULL DEFAULT false,
  assigned_advocate_id INTEGER REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.case_intake_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT UNIQUE,
  case_id INTEGER REFERENCES public.client_cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES public.users(id),
  status TEXT NOT NULL DEFAULT 'STARTED',
  transcript TEXT,
  analysis JSONB,
  mode TEXT,
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.case_voice_notes (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  language TEXT,
  audio_url TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Existing historical data must retain its legacy status during migration.
INSERT INTO public.client_cases (id,user_id,status,description,interview_completed)
VALUES (900,42,'MATCHING_REVIEW','Fictional historical issue',true);
INSERT INTO public.case_intake_sessions (session_id,case_id,user_id,status,analysis)
VALUES ('historical-fictional',900,42,'COMPLETED','{"issue_summary":"Fictional historical issue"}');
