-- ============================================================
--  MIGRATION: hoàn thành sớm + giải ngân + trạng thái đang triển khai
--  Chạy: npm run db:migrate-disbursement
--  An toàn để chạy nhiều lần (IF NOT EXISTS).
-- ============================================================

-- PostgreSQL không cho dùng giá trị enum mới trong cùng transaction vừa thêm.
BEGIN;
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'in_progress';
COMMIT;

BEGIN;

-- Ngày chiến dịch được xác nhận hoàn thành (đạt mục tiêu hoặc chủ dự án đóng thành công).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Người duyệt giải ngân + thời điểm giải ngân thực tế.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS transactions_processed_by_idx
  ON transactions (processed_by)
  WHERE processed_by IS NOT NULL;

-- Dự án đã có giao dịch giải ngân thành công thì chuyển sang "Đang triển khai".
UPDATE projects p
   SET status = 'in_progress'
 WHERE p.status = 'successful'
   AND EXISTS (
     SELECT 1 FROM transactions t
      WHERE t.project_id = p.id
        AND t.type = 'payout'
        AND t.status = 'success'
   );

-- Bổ sung ngày hoàn thành cho dữ liệu cũ.
UPDATE projects
   SET completed_at = COALESCE(completed_at, updated_at, now())
 WHERE status IN ('successful', 'in_progress')
   AND completed_at IS NULL;

-- Dự án đang gây quỹ nhưng đã đạt/ vượt mục tiêu thì hoàn thành ngay.
UPDATE projects
   SET status = 'successful',
       completed_at = COALESCE(completed_at, now())
 WHERE status = 'active'
   AND current_amount >= goal_amount;

-- Dự án vừa hoàn thành nhưng chưa có yêu cầu giải ngân: tạo yêu cầu chờ duyệt.
INSERT INTO transactions (project_id, type, amount, method, gateway_ref, status)
SELECT p.id, 'payout', p.current_amount, 'bank_transfer',
       'PAYOUT-AUTO-' || upper(substring(p.id::text, 1, 8)), 'pending'
  FROM projects p
 WHERE p.status = 'successful'
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
