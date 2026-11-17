import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { AIBox, Spinner } from '../components/ui';
import { formatDateTime, vnd } from '../lib/format';

const RESULT_COPY = {
  success: {
    icon: '✅',
    title: 'Thanh toán thành công',
    tone: 'success',
    description: 'VNPay đã xác nhận giao dịch và khoản tài trợ đã được ghi nhận vào dự án.',
  },
  pending: {
    icon: '⏳',
    title: 'Đang xác nhận thanh toán',
    tone: 'info',
    description: 'VNPay có thể mất vài giây để gửi kết quả về hệ thống. Trang sẽ tự kiểm tra lại.',
  },
  failed: {
    icon: '⚠️',
    title: 'Thanh toán chưa hoàn tất',
    tone: 'warn',
    description: 'Giao dịch đã bị huỷ hoặc không thành công. Bạn chưa bị trừ tiền cho khoản tài trợ này.',
  },
  invalid: {
    icon: '⛔',
    title: 'Không xác minh được giao dịch',
    tone: 'warn',
    description: 'Chữ ký của VNPay không hợp lệ. Hệ thống không ghi nhận khoản tài trợ.',
  },
  invalid_amount: {
    icon: '⛔',
    title: 'Số tiền không khớp',
    tone: 'warn',
    description: 'Số tiền VNPay trả về không khớp với giao dịch đã tạo. Hệ thống không ghi nhận khoản tài trợ.',
  },
  not_found: {
    icon: '🔎',
    title: 'Không tìm thấy giao dịch',
    tone: 'warn',
    description: 'Mã giao dịch không tồn tại hoặc không thuộc tài khoản đang đăng nhập.',
  },
  missing: {
    icon: '🔎',
    title: 'Thiếu mã giao dịch',
    tone: 'warn',
    description: 'Đường dẫn không có mã giao dịch. Hãy kiểm tra lại từ trang tài trợ.',
  },
  auth: {
    icon: '🔐',
    title: 'Cần đăng nhập',
    tone: 'info',
    description: 'Bạn cần đăng nhập bằng tài khoản đã tài trợ để xem trạng thái giao dịch.',
  },
  error: {
    icon: '⚠️',
    title: 'Chưa kiểm tra được giao dịch',
    tone: 'warn',
    description: 'Không kết nối được máy chủ. Bạn có thể bấm “Kiểm tra lại” sau vài giây.',
  },
};

export default function PaymentResult() {
  const [sp] = useSearchParams();
  const txnRef = sp.get('txn_ref') || '';
  const queryResult = sp.get('result') || '';

  const [data, setData] = useState(null);
  const [status, setStatus] = useState(txnRef ? 'pending' : queryResult || 'missing');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(Boolean(txnRef));
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef(null);

  const check = useCallback(
    async ({ silent = false } = {}) => {
      if (!txnRef) return 'missing';
      if (!silent) setChecking(true);
      try {
        const result = await api.get(`/payments/status/${encodeURIComponent(txnRef)}`);
        setData(result);
        setStatus(result.result);
        setError('');
        return result.result;
      } catch (err) {
        if (err.status === 401) {
          setStatus('auth');
          setError('Bạn cần đăng nhập để xem trạng thái giao dịch.');
        } else if (err.status === 404) {
          setStatus('not_found');
          setError(err.message);
        } else {
          setStatus('error');
          setError(err.message);
        }
        return 'error';
      } finally {
        setChecking(false);
      }
    },
    [txnRef],
  );

  useEffect(() => {
    if (!txnRef) {
      setStatus(queryResult || 'missing');
      return undefined;
    }

    let cancelled = false;
    let attempt = 0;

    const poll = async () => {
      if (cancelled) return;
      const result = await check({ silent: attempt > 0 });
      if (cancelled) return;
      attempt += 1;

      if (result === 'pending' && attempt < 6) {
        timerRef.current = setTimeout(poll, 1800);
      } else if (result === 'pending') {
        setTimedOut(true);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [check, queryResult, txnRef]);

  const copy = useMemo(() => {
    const key = status === 'success' || status === 'failed' || status === 'pending' ? status : status;
    if (RESULT_COPY[key]) return RESULT_COPY[key];
    if (queryResult === 'success') return RESULT_COPY.pending;
    if (queryResult === 'failed') return RESULT_COPY.failed;
    return RESULT_COPY[queryResult] || RESULT_COPY.error;
  }, [queryResult, status]);

  const paid = status === 'success';
  const pending = status === 'pending';
  const projectId = data?.project?.id;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="card p-8 text-center">
        <div className="text-5xl">{copy.icon}</div>
        <h1 className="mt-3 text-xl font-bold">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.description}</p>

        {pending && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
            <Spinner className="h-3 w-3" />
            {timedOut ? 'Chưa nhận được xác nhận từ VNPay' : 'Đang chờ VNPay xác nhận…'}
          </div>
        )}

        {data && (
          <div className="mx-auto mt-5 max-w-sm rounded-xl bg-slate-50 p-3 text-left text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Số tiền</span>
              <b>{vnd(data.amount)}</b>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-slate-500">Dự án</span>
              <b className="text-right">{data.project?.title || '—'}</b>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-slate-500">Phương thức</span>
              <b>{data.method || 'VNPay'}</b>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-slate-500">Mã giao dịch</span>
              <b className="break-all text-right text-xs">{data.txn_ref || txnRef}</b>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-slate-500">Trạng thái</span>
              <b className={paid ? 'text-emerald-700' : pending ? 'text-amber-700' : 'text-red-700'}>
                {paid ? 'Đã thanh toán' : pending ? 'Chờ xác nhận' : 'Chưa thanh toán'}
              </b>
            </div>
            {paid && data.paid_at && (
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-500">Xác nhận lúc</span>
                <b>{formatDateTime(data.paid_at)}</b>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {projectId && (
            <Link to={`/du-an/${projectId}`} className="btn-ghost text-sm">
              Về trang dự án
            </Link>
          )}
          <Link to="/ca-nhan" className="btn-ghost text-sm">
            Lịch sử đóng góp
          </Link>
          {txnRef && (
            <button className="btn-primary text-sm disabled:opacity-60" onClick={() => check()} disabled={checking}>
              {checking ? <><Spinner className="mr-1 h-3 w-3" /> Đang kiểm tra…</> : 'Kiểm tra lại'}
            </button>
          )}
        </div>
      </div>

      {paid ? (
        <AIBox variant="success" title="Khoản tài trợ đã được ghi nhận">
          Hệ thống đã cập nhật số tiền của dự án và gửi thông báo cho chủ dự án. Cảm ơn bạn đã ủng hộ!
        </AIBox>
      ) : pending ? (
        <AIBox variant="info" title="Vì sao chưa thấy cập nhật?">
          Nếu bạn đã thanh toán thành công, hãy giữ trang này mở thêm vài giây hoặc bấm “Kiểm tra lại”.
          Hệ thống chỉ cộng tiền sau khi nhận được xác nhận chính thức từ VNPay.
        </AIBox>
      ) : (
        <AIBox variant="warn" title="Bạn chưa bị trừ tiền">
          Không có khoản tài trợ nào được ghi nhận. Bạn có thể quay lại dự án và thực hiện thanh toán lại.
        </AIBox>
      )}
    </div>
  );
}
