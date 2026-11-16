-- ============================================================
--  MIGRATION: KYC giấy tờ thật + tạm ngưng dự án khi chủ bị khóa
--  Chạy: npm run db:migrate-kyc-suspension
--  An toàn để chạy nhiều lần (IF NOT EXISTS).
-- ============================================================

-- PostgreSQL không cho dùng giá trị enum mới trong cùng transaction vừa thêm.
BEGIN;
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'suspended';
COMMIT;

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS suspended_from_status project_status;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kyc_document_type VARCHAR(12),
  ADD COLUMN IF NOT EXISTS kyc_document_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS kyc_full_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS kyc_dob DATE,
  ADD COLUMN IF NOT EXISTS kyc_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS kyc_contact_email VARCHAR(160),
  ADD COLUMN IF NOT EXISTS kyc_address TEXT,
  ADD COLUMN IF NOT EXISTS kyc_document_front_url TEXT,
  ADD COLUMN IF NOT EXISTS kyc_document_back_url TEXT,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS kyc_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS kyc_token_expires_at TIMESTAMPTZ;

ALTER TABLE project_updates
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ai_predictions
  ALTER COLUMN model_version SET DEFAULT 'success-model-v4.0';

CREATE INDEX IF NOT EXISTS users_kyc_token_idx ON users (kyc_token_hash)
  WHERE kyc_token_hash IS NOT NULL;

-- Một giấy tờ chỉ được gắn với một tài khoản đang chờ hoặc đã xác thực.
CREATE UNIQUE INDEX IF NOT EXISTS users_kyc_document_uidx
  ON users (kyc_document_type, upper(kyc_document_number))
  WHERE kyc_document_number IS NOT NULL AND kyc_status IN ('pending', 'verified');

COMMIT;
