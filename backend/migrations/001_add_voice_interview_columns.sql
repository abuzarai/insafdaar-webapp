-- Voice Interview Integration Migration
-- Adds columns needed for voice interview sessions and results

-- 1. Add voice interview columns to case_intake_sessions
ALTER TABLE case_intake_sessions
  ADD COLUMN IF NOT EXISTS session_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS ws_url TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS analysis JSONB,
  ADD COLUMN IF NOT EXISTS audio_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_duration INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITHOUT TIME ZONE;

-- Make case_id nullable (sessions can be created before a case exists)
ALTER TABLE case_intake_sessions ALTER COLUMN case_id DROP NOT NULL;

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_intake_session_id ON case_intake_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_intake_user_id ON case_intake_sessions (user_id);

-- 2. Add voice-related columns to client_cases
ALTER TABLE client_cases
  ADD COLUMN IF NOT EXISTS legal_domain TEXT,
  ADD COLUMN IF NOT EXISTS interview_completed BOOLEAN DEFAULT false;
