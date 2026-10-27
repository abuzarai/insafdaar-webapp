-- Stage B: reviewed v2 intake. Write-only migration file; apply only with approval.
BEGIN;
ALTER TABLE public.client_cases
  ADD COLUMN intake_protocol TEXT NOT NULL DEFAULT 'legacy'
    CHECK (intake_protocol IN ('legacy', 'live_v2')),
  ADD COLUMN intake_version BIGINT NOT NULL DEFAULT 0 CHECK (intake_version >= 0),
  ADD COLUMN selected_intake_revision_id UUID,
  ADD COLUMN submitted_intake_revision_id UUID,
  ADD CHECK (intake_protocol='live_v2' OR (selected_intake_revision_id IS NULL AND submitted_intake_revision_id IS NULL)),
  ADD CHECK (submitted_intake_revision_id IS NULL OR (selected_intake_revision_id IS NOT NULL AND selected_intake_revision_id=submitted_intake_revision_id));

CREATE TABLE public.case_intake_revisions (
  id UUID PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  parent_id UUID,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  source_session_id TEXT NOT NULL,
  source_proposal JSONB NOT NULL CHECK (jsonb_typeof(source_proposal)='object'),
  reviewed_data JSONB NOT NULL CHECK (jsonb_typeof(reviewed_data)='object'),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, id),
  UNIQUE (case_id, id, content_hash),
  FOREIGN KEY (case_id, parent_id) REFERENCES public.case_intake_revisions(case_id, id)
);
ALTER TABLE public.client_cases
  ADD FOREIGN KEY (id, selected_intake_revision_id)
    REFERENCES public.case_intake_revisions(case_id, id),
  ADD FOREIGN KEY (id, submitted_intake_revision_id)
    REFERENCES public.case_intake_revisions(case_id, id);

CREATE TABLE public.case_intake_confirmations (
  id UUID PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  case_version BIGINT NOT NULL CHECK (case_version>=0),
  acknowledgment_version TEXT NOT NULL CHECK (acknowledgment_version = 'review-v1'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, id, revision_id, content_hash, actor_user_id),
  FOREIGN KEY (case_id, revision_id, content_hash) REFERENCES public.case_intake_revisions(case_id, id, content_hash)
);
CREATE TABLE public.case_intake_submissions (
  case_id INTEGER PRIMARY KEY REFERENCES public.client_cases(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL,
  confirmation_id UUID NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (case_id, revision_id, content_hash) REFERENCES public.case_intake_revisions(case_id, id, content_hash),
  FOREIGN KEY (case_id, confirmation_id, revision_id, content_hash, actor_user_id)
    REFERENCES public.case_intake_confirmations(case_id, id, revision_id, content_hash, actor_user_id)
);
CREATE TABLE public.case_intake_receipts (
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  operation TEXT NOT NULL CHECK (operation IN ('admit', 'save', 'edit', 'confirm', 'submit')),
  intent_key TEXT NOT NULL CHECK (length(intent_key) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response JSONB CHECK (response IS NULL OR jsonb_typeof(response)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, actor_user_id, operation, intent_key)
);
CREATE TABLE public.case_intake_live_sessions (
  session_id TEXT PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX case_intake_revisions_case_created ON public.case_intake_revisions(case_id, created_at);
CREATE INDEX case_intake_live_sessions_case ON public.case_intake_live_sessions(case_id);

-- Revisions and confirmations are append-only. Controlled case deletion can cascade.
CREATE FUNCTION public.reject_intake_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Intake history is immutable';
END;
$$;
CREATE TRIGGER intake_revision_immutable BEFORE UPDATE ON public.case_intake_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_intake_history_update();
CREATE TRIGGER intake_confirmation_immutable BEFORE UPDATE ON public.case_intake_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.reject_intake_history_update();
CREATE TRIGGER intake_submission_immutable BEFORE UPDATE ON public.case_intake_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reject_intake_history_update();
-- Direct history deletion is forbidden; deletion of the owning case may cascade.
CREATE FUNCTION public.guard_intake_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_cases WHERE id=OLD.case_id) THEN
    RAISE EXCEPTION 'Intake history is immutable';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER intake_revision_delete_guard BEFORE DELETE ON public.case_intake_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_intake_history_delete();
CREATE TRIGGER intake_confirmation_delete_guard BEFORE DELETE ON public.case_intake_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.guard_intake_history_delete();
CREATE TRIGGER intake_submission_delete_guard BEFORE DELETE ON public.case_intake_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_intake_history_delete();
CREATE FUNCTION public.guard_reviewed_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.intake_protocol='live_v2' AND NEW.intake_protocol<>'live_v2' THEN
    RAISE EXCEPTION 'Reviewed intake cannot revert to legacy';
  END IF;
  IF NEW.intake_protocol='live_v2' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Reviewed case ownership is immutable';
    END IF;
    IF NEW.intake_version<OLD.intake_version OR
       (NEW.selected_intake_revision_id IS DISTINCT FROM OLD.selected_intake_revision_id AND NEW.intake_version<=OLD.intake_version) THEN
      RAISE EXCEPTION 'Reviewed revision selection must advance its version';
    END IF;
    IF NEW.interview_completed AND NEW.submitted_intake_revision_id IS NULL THEN
      RAISE EXCEPTION 'Reviewed submission required';
    END IF;
    IF (NEW.status NOT IN ('DRAFT','INTAKE_STARTED') OR NEW.assigned_advocate_id IS NOT NULL)
       AND NEW.submitted_intake_revision_id IS NULL THEN
      RAISE EXCEPTION 'Reviewed submission required before case progression';
    END IF;
    IF NEW.submitted_intake_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.case_intake_submissions s
      WHERE s.case_id=NEW.id AND s.revision_id=NEW.submitted_intake_revision_id
    ) THEN RAISE EXCEPTION 'Submission record required'; END IF;
    IF NEW.submitted_intake_revision_id IS DISTINCT FROM OLD.submitted_intake_revision_id
       AND NEW.submitted_intake_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.case_intake_submissions s
      JOIN public.case_intake_confirmations cf ON cf.id=s.confirmation_id
      WHERE s.case_id=NEW.id AND s.revision_id=NEW.selected_intake_revision_id
        AND s.actor_user_id=NEW.user_id AND cf.case_version=OLD.intake_version
    ) THEN RAISE EXCEPTION 'Current owning-client confirmation required'; END IF;
  END IF;
  IF OLD.intake_protocol='live_v2' AND OLD.submitted_intake_revision_id IS NOT NULL THEN
    IF ROW(NEW.selected_intake_revision_id,NEW.submitted_intake_revision_id,NEW.intake_version,
           NEW.description,NEW.language,NEW.legal_domain,NEW.interview_completed)
       IS DISTINCT FROM
       ROW(OLD.selected_intake_revision_id,OLD.submitted_intake_revision_id,OLD.intake_version,
           OLD.description,OLD.language,OLD.legal_domain,OLD.interview_completed)
       OR NEW.status IN ('DRAFT','INTAKE_STARTED') THEN
      RAISE EXCEPTION 'Submitted intake is frozen';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reviewed_case_guard BEFORE UPDATE ON public.client_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_case();
-- INSERT does not pass through the UPDATE guard. A reviewed case must begin as
-- an empty draft, not an apparently completed/assigned case without submission.
CREATE FUNCTION public.guard_initial_reviewed_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.intake_protocol='live_v2' AND
     (NEW.status<>'DRAFT' OR NEW.interview_completed OR NEW.intake_version<>0 OR
      NEW.selected_intake_revision_id IS NOT NULL OR NEW.submitted_intake_revision_id IS NOT NULL OR
      NEW.assigned_advocate_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Reviewed case must start as an empty unassigned draft';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reviewed_case_insert_guard BEFORE INSERT ON public.client_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_initial_reviewed_case();

-- Serialize old intake writers with admission's case-row lock. A pre-check or
-- INSERT SELECT alone does not close the protocol-switch race at READ COMMITTED.
CREATE FUNCTION public.guard_legacy_intake_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id IS NOT NULL THEN
    PERFORM 1 FROM public.client_cases WHERE id=NEW.case_id AND intake_protocol='legacy' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed case cannot accept legacy intake'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_intake_session_guard BEFORE INSERT OR UPDATE ON public.case_intake_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_intake_write();
CREATE TRIGGER legacy_intake_voice_guard BEFORE INSERT OR UPDATE ON public.case_voice_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_intake_write();
COMMIT;
