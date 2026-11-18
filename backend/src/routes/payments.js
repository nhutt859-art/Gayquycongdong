import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  isVnpayConfigured,
  isVnpayMock,
  verifyMockToken,
  verifyVnpayQuery,
  vnpayDate,
} from '../services/vnpay.js';
import { amountInVnpayUnits, failVnpayPayment, finalizeVnpayPayment } from '../services/pledge-payments.js';

const router = Router();

const RESULT_PATH = '/thanh-toan/ket-qua';

function appUrl() {
  return String(process.env.APP_URL || 'https://dacntt-web.vercel.app').replace(/\/+$/, '');
}

function resultUrl(txnRef, result) {
  const url = new URL(`${appUrl()}${RESULT_PATH}`);
  if (txnRef) url.searchParams.set('txn_ref', txnRef);
  if (result) url.searchParams.set('result', result);
  return url.toString();
}

function requestBaseUrl(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  if (!host) return String(process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
  return `${protocol}://${host}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

function isSuccessResponse(input) {
  return String(input.vnp_ResponseCode || '') === '00' && String(input.vnp_TransactionStatus || '') === '00';
}

// ============================================================
// GET /api/payments/config — cho frontend biết đang dùng cổng thật hay mô phỏng
// ============================================================
router.get('/config', (_req, res) => {
  res.json({
    mode: isVnpayMock() ? 'mock' : 'vnpay',
    configured: isVnpayConfigured(),
    provider: 'VNPay',
  });
});

// ============================================================
// GET /api/payments/vnpay/return — trình duyệt quay về sau khi thanh toán
// ============================================================
router.get(
  '/vnpay/return',
  asyncHandler(async (req, res) => {
    const txnRef = String(req.query.vnp_TxnRef || '');

    if (!verifyVnpayQuery(req.query)) {
      return res.redirect(resultUrl(txnRef, 'invalid'));
    }

    const { rows } = await query(
      `select id, amount, status from transactions where gateway_ref = $1 and type = 'payment'`,
      [txnRef],
    );
    if (!rows.length) return res.redirect(resultUrl(txnRef, 'not_found'));

    const transaction = rows[0];
    if (Number(req.query.vnp_Amount) !== amountInVnpayUnits(transaction.amount)) {
      return res.redirect(resultUrl(txnRef, 'invalid_amount'));
    }

    if (!isSuccessResponse(req.query)) {
      const outcome = await failVnpayPayment(txnRef, req.query);
      return res.redirect(resultUrl(txnRef, outcome.status === 'already' ? 'success' : 'failed'));
    }

    // Return URL có thể đến trước IPN: xác nhận luôn, IPN gọi lại sẽ idempotent.
    const outcome = await finalizeVnpayPayment(txnRef, req.query);
    const result = outcome.status === 'ok' || outcome.status === 'already' ? 'success' : 'pending';
    return res.redirect(resultUrl(txnRef, result));
  }),
);

// ============================================================
// GET /api/payments/vnpay/ipn — VNPay gọi server-to-server (nguồn xác nhận chính)
// ============================================================
router.get('/vnpay/ipn', async (req, res) => {
  try {
    if (!verifyVnpayQuery(req.query)) {
      return res.json({ RspCode: '97', Message: 'Invalid Checksum' });
    }

    const txnRef = String(req.query.vnp_TxnRef || '');
    const { rows } = await query(
      `select id, amount, status from transactions where gateway_ref = $1 and type = 'payment'`,
      [txnRef],
    );
    if (!rows.length) {
      return res.json({ RspCode: '01', Message: 'Order not found' });
    }

    const transaction = rows[0];
    if (Number(req.query.vnp_Amount) !== amountInVnpayUnits(transaction.amount)) {
      return res.json({ RspCode: '04', Message: 'Invalid amount' });
    }
    if (transaction.status === 'success') {
      return res.json({ RspCode: '02', Message: 'Order already confirmed' });
    }

    if (!isSuccessResponse(req.query)) {
      await failVnpayPayment(txnRef, req.query);
      return res.json({ RspCode: '00', Message: 'Confirm Success' });
    }

    const outcome = await finalizeVnpayPayment(txnRef, req.query);
    if (outcome.status === 'ok' || outcome.status === 'already') {
      return res.json({ RspCode: '00', Message: 'Confirm Success' });
    }
    if (outcome.status === 'amount_mismatch') {
      return res.json({ RspCode: '04', Message: 'Invalid amount' });
    }
    return res.json({ RspCode: '01', Message: 'Order not found' });
  } catch (err) {
    console.error('[vnpay] Lỗi xử lý IPN:', err);
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// ============================================================
// GET /api/payments/status/:txnRef — trang kết quả hỏi trạng thái
// ============================================================
router.get(
  '/status/:txnRef',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select t.gateway_ref, t.amount, t.status as transaction_status, t.method,
              t.created_at, t.processed_at,
              pl.id as pledge_id, pl.status as pledge_status, pl.project_id,
              pl.backer_id, p.title as project_title
         from transactions t
         join pledges pl on pl.id = t.pledge_id
         join projects p on p.id = pl.project_id
        where t.gateway_ref = $1 and t.type = 'payment'`,
      [req.params.txnRef],
    );

    if (!rows.length) throw new ApiError(404, 'Không tìm thấy giao dịch thanh toán.');

    const row = rows[0];
    if (row.backer_id !== req.user.id && req.user.role !== 'admin') {
      throw new ApiError(403, 'Bạn không có quyền xem giao dịch này.');
    }

    const result =
      row.transaction_status === 'success'
        ? 'success'
        : row.transaction_status === 'failed'
          ? 'failed'
          : 'pending';

    res.json({
      txn_ref: row.gateway_ref,
      amount: Number(row.amount),
      method: row.method,
      result,
      transaction_status: row.transaction_status,
      pledge_status: row.pledge_status,
      created_at: row.created_at,
      paid_at: row.processed_at,
      project: { id: row.project_id, title: row.project_title },
      message:
        result === 'success'
          ? 'Thanh toán đã được xác nhận.'
          : result === 'failed'
            ? 'Giao dịch chưa hoàn tất hoặc đã bị huỷ.'
            : 'Đang chờ VNPay xác nhận giao dịch.',
    });
  }),
);

// ============================================================
// Chế độ mô phỏng — chỉ dùng khi chưa có TmnCode/HashSecret
// ============================================================
router.get(
  '/vnpay/mock',
  asyncHandler(async (req, res) => {
    if (!isVnpayMock()) throw new ApiError(404, 'Không tìm thấy trang thanh toán.');
    const tokenData = verifyMockToken(req.query.token);
    if (!tokenData) throw new ApiError(400, 'Liên kết mô phỏng không hợp lệ hoặc đã hết hạn.');

    const { rows } = await query(
      `select t.amount, t.status, p.title as project_title
         from transactions t
         join projects p on p.id = t.project_id
        where t.gateway_ref = $1 and t.type = 'payment'`,
      [tokenData.txnRef],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy giao dịch.');
    const transaction = rows[0];

    const base = requestBaseUrl(req);
    const complete = (result) =>
      `${base}/api/payments/vnpay/mock/complete?token=${encodeURIComponent(req.query.token)}&result=${result}`;

    res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VNPay — Cổng thanh toán</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef2f7; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; padding: 20px; }
    .card { width: 100%; max-width: 430px; background: #fff; border-radius: 18px; box-shadow: 0 18px 50px rgba(15, 23, 42, .14); overflow: hidden; }
    .head { background: linear-gradient(135deg, #0b3b8c, #1565d8); color: #fff; padding: 22px 22px 18px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: .4px; }
    .brand span { color: #ffd34d; }
    .body { padding: 20px 22px 22px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
    .row:last-of-type { border-bottom: 0; }
    .row b { text-align: right; }
    .amount { font-size: 26px; font-weight: 800; color: #0b3b8c; padding: 14px 0 8px; }
    .actions { display: grid; gap: 9px; margin-top: 14px; }
    a.btn { display: block; text-align: center; text-decoration: none; border-radius: 11px; padding: 13px 14px; font-weight: 700; font-size: 14px; }
    a.ok { background: #0b7a4b; color: #fff; }
    a.cancel { background: #f1f5f9; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="brand">VNPAY<span>.</span></div>
    </div>
    <div class="body">
      <div class="amount">${escapeHtml(money(transaction.amount))}</div>
      <div class="row"><span>Dự án</span><b>${escapeHtml(transaction.project_title)}</b></div>
      <div class="row"><span>Mã giao dịch</span><b>${escapeHtml(tokenData.txnRef)}</b></div>
      <div class="actions">
        <a class="btn ok" href="${escapeHtml(complete('success'))}">Thanh toán thành công</a>
        <a class="btn cancel" href="${escapeHtml(complete('failed'))}">Huỷ thanh toán</a>
      </div>
    </div>
  </div>
</body>
</html>`);
  }),
);

router.get(
  '/vnpay/mock/complete',
  asyncHandler(async (req, res) => {
    if (!isVnpayMock()) throw new ApiError(404, 'Không tìm thấy trang thanh toán.');
    const tokenData = verifyMockToken(req.query.token);
    if (!tokenData) throw new ApiError(400, 'Liên kết mô phỏng không hợp lệ hoặc đã hết hạn.');

    if (String(req.query.result || '') !== 'success') {
      const outcome = await failVnpayPayment(tokenData.txnRef, { mock: true, result: 'failed' });
      return res.redirect(resultUrl(tokenData.txnRef, outcome.status === 'already' ? 'success' : 'failed'));
    }

    const outcome = await finalizeVnpayPayment(tokenData.txnRef, {
      vnp_TxnRef: tokenData.txnRef,
      vnp_Amount: String(amountInVnpayUnits(tokenData.amount)),
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_BankCode: 'MOCK',
      vnp_PayDate: vnpayDate(),
    });

    const result = outcome.status === 'ok' || outcome.status === 'already' ? 'success' : 'pending';
    return res.redirect(resultUrl(tokenData.txnRef, result));
  }),
);

export default router;
