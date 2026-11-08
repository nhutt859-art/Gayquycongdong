-- ============================================================
--  MIGRATION: AI dựa trên dữ liệu lịch sử
--  Chạy: npm run db:migrate-ai
--  An toàn để chạy nhiều lần (IF NOT EXISTS).
-- ============================================================

BEGIN;

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_predictions
  ADD COLUMN IF NOT EXISTS label VARCHAR(20),
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS model_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN model_version SET DEFAULT 'logreg-v3.1';

ALTER TABLE fraud_flags
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_version VARCHAR(30) NOT NULL DEFAULT 'fraud-v2.0';

CREATE TABLE IF NOT EXISTS ai_model_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key      VARCHAR(40) NOT NULL,
  version        VARCHAR(40) NOT NULL,
  algorithm      VARCHAR(120) NOT NULL,
  trained_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_size    INTEGER NOT NULL DEFAULT 0,
  positive_count INTEGER NOT NULL DEFAULT 0,
  metrics        JSONB NOT NULL DEFAULT '{}'::jsonb,
  coefficients   JSONB NOT NULL DEFAULT '{}'::jsonb,
  feature_stats  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (model_key, version)
);

CREATE INDEX IF NOT EXISTS ai_model_versions_active_idx ON ai_model_versions (model_key, is_active);
CREATE INDEX IF NOT EXISTS ai_recommendations_user_idx ON ai_recommendations (user_id, score DESC);

COMMIT;
