-- ============================================================
--  MIGRATION: tách trạng thái “Chờ giải ngân” và “Đã giải ngân”
--  Chạy: npm run db:migrate-disbursement-statuses
--  An toàn để chạy nhiều lần (IF NOT EXISTS).
-- ============================================================

-- PostgreSQL không cho dùng giá trị enum mới trong cùng transaction vừa thêm.
BEGIN;
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'awaiting_disbursement';
COMMIT;

BEGIN;
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'disbursed';
COMMIT;

BEGIN;

-- Bổ sung cột cho dữ liệu cũ (idempotent).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Dự án “successful” đã có giao dịch giải ngân thành công → “Đã giải ngân”.
UPDATE projects p
   SET status = 'disbursed',
       completed_at = COALESCE(p.completed_at, p.updated_at, now()),
       updated_at = now()
 WHERE p.status = 'successful'
   AND EXISTS (
     SELECT 1 FROM transactions t
      WHERE t.project_id = p.id
        AND t.type = 'payout'
        AND t.status = 'success'
   );

-- Dự án “successful” chưa giải ngân → “Chờ giải ngân”.
UPDATE projects
   SET status = 'awaiting_disbursement',
       completed_at = COALESCE(completed_at, updated_at, now()),
       updated_at = now()
 WHERE status = 'successful';

-- Dự án đang gây quỹ nhưng đã đạt/vượt mục tiêu → “Chờ giải ngân”.
UPDATE projects
   SET status = 'awaiting_disbursement',
       completed_at = COALESCE(completed_at, now()),
       updated_at = now()
 WHERE status = 'active'
   AND current_amount >= goal_amount;

-- Dự án chờ giải ngân chưa có yêu cầu giải ngân: tạo yêu cầu chờ duyệt.
INSERT INTO transactions (project_id, type, amount, method, gateway_ref, status)
SELECT p.id, 'payout', p.current_amount, 'bank_transfer',
       'PAYOUT-AUTO-' || upper(substring(p.id::text, 1, 8)), 'pending'
  FROM projects p
 WHERE p.status = 'awaiting_disbursement'
   AND p.current_amount > 0
   AND NOT EXISTS (
     SELECT 1 FROM transactions t
      WHERE t.project_id = p.id
        AND t.type = 'payout'
        AND t.status IN ('pending', 'success')
   );

-- Giao dịch giải ngân thành công cũ chưa có ngày xử lý: lấy ngày tạo.
UPDATE transactions
   SET processed_at = created_at
 WHERE type = 'payout'
   AND status = 'success'
   AND processed_at IS NULL;

COMMIT;
