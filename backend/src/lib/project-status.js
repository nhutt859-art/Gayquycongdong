/**
 * Trạng thái dự án sau khi đã đạt mục tiêu gây quỹ.
 *
 * Luồng vòng đời:
 *   active → awaiting_disbursement (Chờ giải ngân)
 *          → disbursed (Đã giải ngân)
 *          → in_progress (Đang triển khai)
 *
 * `successful` được giữ lại cho dữ liệu cũ trước khi tách trạng thái giải ngân.
 */
export const SUCCESS_STATUSES = ['successful', 'awaiting_disbursement', 'disbursed', 'in_progress'];

export const DECIDED_STATUSES = [...SUCCESS_STATUSES, 'failed'];

export const SUCCESS_STATUS_SQL = SUCCESS_STATUSES.map((status) => `'${status}'`).join(', ');

export const DECIDED_STATUS_SQL = DECIDED_STATUSES.map((status) => `'${status}'`).join(', ');

export const isSuccessStatus = (status) => SUCCESS_STATUSES.includes(status);
