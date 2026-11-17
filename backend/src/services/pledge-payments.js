import { withTransaction } from '../db.js';
import { notify } from './notifications.js';
import { completeProjectIfFunded } from './project-completion.js';

const amountInVnpayUnits = (amount) => Math.round(Number(amount)) * 100;

async function loadPayment(client, txnRef) {
  const { rows } = await client.query(
    `select t.*,
            pl.status as pledge_status,
            pl.backer_id,
            pl.project_id as pledge_project_id,
            p.owner_id,
            p.title as project_title
       from transactions t
       join pledges pl on pl.id = t.pledge_id
       join projects p on p.id = t.project_id
      where t.gateway_ref = $1 and t.type = 'payment'
      for update of t, pl`,
    [txnRef],
  );
  return rows[0] || null;
}

/**
 * Xác nhận thanh toán thành công. Idempotent: gọi lại nhiều lần (Return + IPN)
 * cũng chỉ cộng tiền một lần nhờ khoá dòng transaction + pledge.
 */
export async function finalizeVnpayPayment(txnRef, payload = {}) {
  return withTransaction(async (client) => {
    const payment = await loadPayment(client, txnRef);
    if (!payment) return { status: 'not_found' };

    if (payment.status === 'success' || payment.pledge_status === 'paid') {
      return { status: 'already', payment };
    }

    if (payload.vnp_Amount !== undefined && Number(payload.vnp_Amount) !== amountInVnpayUnits(payment.amount)) {
      return { status: 'amount_mismatch', payment };
    }

    await client.query(
      `update pledges set status = 'paid' where id = $1 and status <> 'paid'`,
      [payment.pledge_id],
    );

    await client.query(
      `update transactions
          set status = 'success',
              gateway_payload = $2::jsonb,
              processed_at = now()
        where id = $1 and status <> 'success'`,
      [payment.id, JSON.stringify(payload)],
    );

    await notify(client, payment.owner_id, {
      type: 'pledge',
      content: `Bạn vừa nhận được khoản tài trợ ${Number(payment.amount).toLocaleString('vi-VN')}đ cho “${payment.project_title}”.`,
      link: `/du-an/${payment.project_id}`,
    });

    const completion = await completeProjectIfFunded(client, payment.project_id, {
      actorId: payment.backer_id,
    });

    return {
      status: 'ok',
      payment: { ...payment, status: 'success' },
      completion,
    };
  });
}

/** Đánh dấu giao dịch thất bại/huỷ; chỉ tác động giao dịch còn pending. */
export async function failVnpayPayment(txnRef, payload = {}) {
  return withTransaction(async (client) => {
    const payment = await loadPayment(client, txnRef);
    if (!payment) return { status: 'not_found' };
    if (payment.status === 'success' || payment.pledge_status === 'paid') {
      return { status: 'already', payment };
    }

    await client.query(
      `update transactions
          set status = 'failed',
              gateway_payload = $2::jsonb
        where id = $1 and status = 'pending'`,
      [payment.id, JSON.stringify(payload)],
    );

    await client.query(
      `update pledges set status = 'failed' where id = $1 and status = 'pending'`,
      [payment.pledge_id],
    );

    return { status: 'ok', payment };
  });
}

export { amountInVnpayUnits };
