-- Document extraction metadata + async extraction queue

ALTER TABLE public.case_documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS extracted_text_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS extraction_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_updated_at TIMESTAMPTZ;

ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS extracted_text_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS extraction_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.document_extraction_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  document_id BIGINT NOT NULL,
  file_url TEXT NOT NULL,
  case_id BIGINT,
  user_id BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_extraction_jobs_source_table_check
    CHECK (source_table IN ('case_documents', 'client_documents')),
  CONSTRAINT document_extraction_jobs_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  CONSTRAINT document_extraction_jobs_unique_doc UNIQUE (source_table, document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_extraction_jobs_poll
  ON public.document_extraction_jobs(status, next_run_at, created_at);

CREATE INDEX IF NOT EXISTS idx_case_documents_extraction_status
  ON public.case_documents(extraction_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_documents_extraction_status
  ON public.client_documents(extraction_status, updated_at DESC);
