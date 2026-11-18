-- ============================================================
--  MIGRATION: điểm tín nhiệm theo bằng chứng
--  Chạy: npm run db:migrate-trust
--  An toàn khi chạy lại nhiều lần.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS trust_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     VARCHAR(20) NOT NULL,
  delta        NUMERIC(5,2) NOT NULL CHECK (delta BETWEEN -50 AND 50 AND delta <> 0),
  reason       VARCHAR(40) NOT NULL,
  reference_id VARCHAR(100) NOT NULL DEFAULT 'once',
  note         TEXT,
  source       VARCHAR(20) NOT NULL DEFAULT 'system',
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'trust_events_user_id_reason_reference_id_key'
       AND conrelid = 'trust_events'::regclass
  ) THEN
    ALTER TABLE trust_events
      ADD CONSTRAINT trust_events_user_id_reason_reference_id_key
      UNIQUE (user_id, reason, reference_id);
  END IF;
END $$;

-- Sự kiện legacy có thể chênh lệch lớn khi bảo toàn điểm cũ.
ALTER TABLE trust_events DROP CONSTRAINT IF EXISTS trust_events_delta_check;
ALTER TABLE trust_events
  ADD CONSTRAINT trust_events_delta_check
  CHECK (delta BETWEEN -100 AND 100 AND delta <> 0);

CREATE INDEX IF NOT EXISTS trust_events_user_idx   ON trust_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trust_events_reason_idx ON trust_events (reason);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS penalty_points INTEGER;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reports_penalty_points_check'
       AND conrelid = 'reports'::regclass
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_penalty_points_check
      CHECK (penalty_points IS NULL OR penalty_points IN (0, 10, 20, 30));
  END IF;
END $$;

COMMIT;
