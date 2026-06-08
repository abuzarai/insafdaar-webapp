ALTER TABLE public.case_documents
  ADD COLUMN IF NOT EXISTS note TEXT;
