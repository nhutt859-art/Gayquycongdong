-- ============================================================
--  MIGRATION: thanh toán VNPay
--  Chạy: npm run db:migrate-vnpay
--  An toàn để chạy nhiều lần (IF NOT EXISTS).
-- ============================================================

BEGIN;

-- Lưu nguyên payload Return/IPN để đối soát sau này.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gateway_payload JSONB;

-- Mỗi giao dịch thanh toán có một mã tham chiếu duy nhất.
-- Index một phần nên không ảnh hưởng giao dịch payout/refund.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_gateway_ref_payment_uidx
  ON transactions (gateway_ref)
  WHERE type = 'payment' AND gateway_ref IS NOT NULL;

COMMIT;
