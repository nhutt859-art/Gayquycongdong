# Gây Quỹ Cộng Đồng + AI

Đồ án nền tảng crowdfunding tiếng Việt, gồm **frontend React** và **backend Express + PostgreSQL thật** (Neon cloud hoặc Postgres local). Hệ thống có đủ 3 nhóm người dùng — nhà tài trợ, chủ dự án, quản trị viên — cùng 3 bài toán AI được triển khai bằng mô hình thống kê và bằng chứng dữ liệu:

- **Dự đoán thành công** bằng logistic regression huấn luyện trên lịch sử các chiến dịch đã kết thúc.
- **Gợi ý dự án** dựa trên sở thích, lịch sử tài trợ, lọc cộng tác và chất lượng chiến dịch.
- **Kiểm chứng gian lận** dựa trên các tín hiệu độc lập, lưu lại bằng chứng để quản trị viên xác minh.

## Kiến trúc

```text
┌─────────────────────────┐        /api (Vite proxy khi dev)        ┌──────────────────────────┐
│  frontend (React 19)    │ ──────────────────────────────────────▶ │  backend (Express 5)     │
│  Vite 8 · Router 7      │                                         │  JWT · Zod · pg          │
│  Tailwind 3             │ ◀────────────────────────────────────── │  SQL thuần               │
└─────────────────────────┘              JSON + JWT                 └────────────┬─────────────┘
                                                                                  │
                                                                        ┌─────────▼─────────┐
                                                                        │ PostgreSQL (Neon) │
                                                                        │ 17 bảng + trigger │
                                                                        └───────────────────┘
```

```text
DACNTT/
├── backend/     # API, schema.sql, seed.sql, scripts, README hướng dẫn Neon
├── frontend/    # React app, README, README-UC-TRACE.md
└── Usecase Database.docx
```

## Chạy nhanh

Yêu cầu: Node.js 20+ và một database PostgreSQL (Neon hoặc local).

### 1. Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
# Mở .env, điền DATABASE_URL + JWT_SECRET (hướng dẫn chi tiết trong backend/README.md)
npm run db:check
npm run db:setup
npm run db:migrate-ai
npm run dev
```

API chạy tại <http://localhost:4000/api>.

Để nạp bộ dữ liệu lịch sử thực tế hơn (200 dự án, ~1.240 người dùng, hàng nghìn giao dịch):

```powershell
# Xem trước và kiểm tra tính nhất quán, chưa ghi database
npm run db:seed:realistic -- --dry-run

# Xoá dữ liệu cũ và nạp lại (giữ tài khoản admin thật)
npm run db:seed:realistic -- --apply

# Huấn luyện mô hình + tạo dự báo/gợi ý
npm run ai:refresh
```

> ⚠️ `db:setup` và `db:seed:realistic -- --apply` đều thay đổi mạnh dữ liệu. Chỉ dùng trên database đồ án, không chạy trên dữ liệu production thật.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Mở <http://localhost:5173>. Nếu backend chạy cổng khác 4000:

```powershell
$env:VITE_PROXY_TARGET='http://localhost:4100'
npm run dev
```

### Kết nối Neon

Tạo project Neon (region Singapore), bật **Connection pooling**, dán chuỗi kết nối vào `backend/.env`:

```dotenv
DATABASE_URL=postgresql://neondb_owner:MAT_KHAU@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=
PGSSL=require
JWT_SECRET=<chuỗi-ngẫu-nhiên-32-byte>
```

Các bước chi tiết + xử lý sự cố: [`backend/README.md`](backend/README.md).

## Dữ liệu lịch sử

Bộ dữ liệu được sinh có kiểm soát để mô phỏng hoạt động thực tế của một nền tảng crowdfunding Việt Nam, không phải vài bản ghi demo:

| Nhóm | Quy mô hiện tại |
|---|---|
| Người dùng | 1.240 tài khoản, có KYC/tín nhiệm/lịch sử hoạt động |
| Dự án | 200 dự án: 112 thành công, 64 thất bại, 16 đang gây quỹ, 5 chờ duyệt, 3 đã dừng |
| Gói tri ân | 523 gói |
| Tài trợ | 6.629 pledge, 7.178 giao dịch |
| Tương tác | 499 bản tin, 1.181 bình luận, 2.944 theo dõi, 24 cộng tác viên |
| Kiểm chứng | 9 cảnh báo gian lận, 13 báo cáo người dùng |

Dữ liệu có phân bố hợp lý theo thời gian: tài khoản mở trước dự án, dự án kết thúc trước hoặc đúng thời điểm hiện tại, giao dịch không vượt quá ngày hiện tại, số tiền huy động được tính lại từ pledge thay vì gán tay. Một số dự án được cố ý tạo tín hiệu xấu (KYC chưa xác thực, mô tả cam kết lợi nhuận, kêu gọi chuyển khoản ngoài nền tảng) để mô hình gian lận có bằng chứng thật.

Script kiểm tra `--dry-run` sẽ chặn các lỗi như pledge trước ngày tạo dự án, giao dịch trong tương lai, tổng tiền không khớp, cảnh báo gian lận dưới ngưỡng hoặc thiếu bằng chứng.

## AI dự đoán thành công

Mô hình hiện tại: **`logreg-v3.1`** — logistic regression chuẩn hoá, huấn luyện trên **176 dự án đã kết thúc** (112 thành công, 64 thất bại), kiểm định chéo **5 fold**.

| Chỉ số | Giá trị |
|---|---|
| AUC | 0.704 |
| Accuracy | 0.704 |
| Precision | 0.719 |
| Recall | 0.879 |
| F1 | 0.789 |
| Brier | 0.195 |
| Baseline (đoán theo đa số) | 0.636 |

6 tín hiệu đầu vào, đều có trước khi chiến dịch chạy:

| Tín hiệu | Hệ số | Ý nghĩa |
|---|---|---|
| `log_goal` — log mục tiêu | −0.2913 | Mục tiêu càng lớn càng khó đạt |
| `duration_days` — thời lượng | −0.3674 | Chiến dịch quá dài làm loãng đà tài trợ |
| `reward_count` — số gói tri ân | +0.7140 | Có gói tri ân giúp tăng chuyển đổi |
| `description_length` — độ dài mô tả | +0.2456 | Mô tả kỹ cho thấy mức độ chuẩn bị |
| `category_rate` — tỷ lệ thành công danh mục | +0.3298 | Danh mục có lịch sử tốt hơn thì dễ thành công hơn |
| `owner_trust` — điểm tín nhiệm chủ dự án | +0.2495 | Bao gồm KYC và lịch sử hoạt động |

Khi dự đoán, hệ thống lưu vào `ai_predictions`: xác suất, nhãn, độ tin cậy, **đóng góp của từng tín hiệu theo điểm phần trăm**, snapshot giá trị đầu vào và metrics của mô hình. Frontend hiển thị top tín hiệu tác động mạnh nhất kèm giải thích, không chỉ một con số phần trăm.

Các tín hiệu `owner_kyc`, `owner_prior_success`, `owner_prior_projects` đã được loại bỏ vì hệ số âm/nhiễu do đa cộng tuyến; KYC và lịch sử chủ dự án đã nằm trong `owner_trust`.

## AI gợi ý dự án

Điểm gợi ý là tổng có trọng số của các tín hiệu có dữ liệu:

| Tín hiệu | Trọng số | Cách tính |
|---|---|---|
| Sở thích đã chọn | 0.34 | Trọng số danh mục người dùng đã chọn |
| Lịch sử tài trợ cùng danh mục | 0.18 | Số dự án cùng danh mục đã tài trợ, chuẩn hoá |
| Người ủng hộ tương tự (collaborative filtering) | 0.28 | Những người từng ủng hộ dự án bạn tài trợ cũng ủng hộ dự án nào |
| Chất lượng & đà gây quỹ | 0.15 | Tiến độ, số nhà tài trợ, điểm dự đoán thành công |
| Độ mới của dự án | 0.05 | Giảm dần theo số ngày mở |

Mỗi gợi ý lưu `reason` (lý do bằng tiếng Việt) và `score_breakdown` (giá trị, trọng số, đóng góp từng thành phần). Giao diện hiển thị lý do và cho phép mở chi tiết cách tính. Tín hiệu chưa đủ dữ liệu (ví dụ người dùng chưa tài trợ dự án nào) được đánh dấu `available: false` và loại khỏi mẫu số thay vì tính là 0.

## AI kiểm chứng gian lận

Hai mô hình quy tắc có bằng chứng: **`fraud-project-v2.0`** và **`fraud-pledge-v2.0`**, ngưỡng tạo cảnh báo **60%**.

Mỗi cảnh báo lưu trong `fraud_flags.evidence` danh sách tín hiệu độc lập, mỗi tín hiệu gồm mã, nhãn, điểm cộng, mức độ và bằng chứng cụ thể:

- Chủ dự án chưa KYC hoặc có lịch sử thất bại/đã dừng.
- Mục tiêu quá lớn so với mặt bằng danh mục.
- Mô tả có cam kết lợi nhuận bất thường hoặc kêu gọi thanh toán ngoài nền tảng.
- Giao dịch tần suất cao, số tiền lệch chuẩn, nhiều tài khoản mới, hành vi ẩn danh.
- Dự án không có gói tri ân để đối chiếu.

Điểm rủi ro là tổng các tín hiệu, nhưng admin nhìn thấy **từng bằng chứng** và có thể xác nhận hoặc đánh dấu báo nhầm. Hệ thống không tự động kết luận gian lận chỉ từ một điểm số.

## Tài khoản thử nghiệm

Mật khẩu chung: **`123456`**

| Email | Vai trò |
|---|---|
| `minhanh.nguyen@gayquy.vn` | Nhà tài trợ, KYC đã xác thực |
| `thu.ha.le@gayquy.vn` | Nhà tài trợ, KYC đã xác thực |
| `hoang.nam.tran@gayquy.vn` | Chủ dự án, KYC đã xác thực |

Tài khoản quản trị production dùng tài khoản thật đã được giữ lại khi nạp lại dữ liệu; không đưa mật khẩu vào repository.

## Chức năng chính

**Khách / Nhà tài trợ**
- Đăng ký tài khoản thật, xác thực email, quên/đặt lại mật khẩu qua email.
- Trang chủ, khám phá, tìm kiếm/lọc/sắp xếp dự án.
- Xem chi tiết, cập nhật, bình luận & trả lời, theo dõi, báo cáo vi phạm.
- Tài trợ mô phỏng (thành công/thất bại), nhận gói tri ân, xem lịch sử đóng góp và giao dịch.
- Hồ sơ, KYC mô phỏng, chọn sở thích, nhận gợi ý có giải thích, thông báo.

**Chủ dự án / Cộng tác viên**
- Tạo dự án 3 bước sau KYC; tự động nâng backer → owner.
- Xem dự báo thành công kèm đóng góp tín hiệu và bằng chứng gian lận của dự án.
- Quản lý thông tin, đóng chiến dịch, đăng bản tin, CRUD gói tri ân.
- Mời/chấp nhận cộng tác viên; xem nhà tài trợ; gửi yêu cầu giải ngân.

**Quản trị viên**
- Thống kê tổng quan, model card của mô hình dự đoán và mô hình gian lận.
- Duyệt/từ chối dự án kèm lý do; hoàn tiền.
- Duyệt/từ chối giải ngân; xử lý báo cáo và cảnh báo gian lận kèm bằng chứng.
- Khóa/mở khóa người dùng; CRUD danh mục.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 3, Oxlint |
| Backend | Node.js, Express 5, `pg`, Zod, JWT (`jsonwebtoken`), bcrypt, Nodemailer (SMTP local) + Brevo/Resend/SendGrid HTTP API |
| Database | PostgreSQL 15+ (Neon), 17 bảng, trigger đồng bộ số tiền |
| AI | Logistic regression tự cài đặt, 5-fold cross-validation, giải thích theo đóng góp từng tín hiệu; không dùng thư viện ML nặng |
| Kiểm thử | `scripts/smoke.js` (API end-to-end), Puppeteer (luồng UI chính) |

## Kiểm thử

```powershell
# API — backend đang chạy
cd backend
npm run smoke

# Build + lint frontend
cd frontend
npm run build
npm run lint
```

Đã kiểm thử API các luồng: đăng ký → xác thực email → đăng nhập, quên mật khẩu → đặt lại → JWT cũ bị vô hiệu hoá, khách xem/lọc, đăng ký → sở thích → KYC → tạo dự án → admin duyệt, tài trợ thành công/thất bại, bình luận/trả lời/báo cáo/theo dõi, quản lý dự án, giải ngân, admin duyệt/xử lý, thông báo.

> Mặc định `npm run smoke` tạo tài khoản kiểm thử trực tiếp trong DB và **không gửi email ra ngoài**. Muốn kiểm tra đầy đủ đăng ký + xác thực email, đặt `SMOKE_REGISTER_EMAIL` thành hộp thư thật do bạn kiểm soát; không dùng địa chỉ giả kiểu `@gayquy.vn` vì email xác thực sẽ bị bounce.

## Phạm vi & lưu ý

- Thanh toán và KYC đều **mô phỏng** phục vụ đồ án; không kết nối cổng thanh toán/OCR thật.
- Dữ liệu lịch sử là **dữ liệu tổng hợp có kiểm soát**, không phải dữ liệu người dùng thật. Mô hình học trên dữ liệu này nên chỉ dùng để minh hoạ quy trình, không dùng để quyết định thật.
- Mô hình dự đoán có AUC 0.704 — tốt hơn baseline nhưng chưa đủ mạnh để thay thế đánh giá của con người. Kết quả hiển thị kèm độ tin cậy và lý do.
- Email xác thực / đặt lại mật khẩu dùng Brevo/Resend/SendGrid HTTP API hoặc SMTP (Nodemailer). Khi chưa cấu hình email trong `backend/.env`, nội dung được in ra console backend để test.
- **Deploy Render free:** Render chặn outbound SMTP 25/465/587, nên đặt `BREVO_API_KEY` + `MAIL_FROM` trong Render → Environment (xem `backend/README.md`).
- JWT lưu `localStorage`; logout xoá token phía client. Đặt lại mật khẩu sẽ tăng `token_version` và vô hiệu hoá mọi JWT cũ.
- Không commit `backend/.env`.
- Nếu dùng OneDrive, nên tạm dừng sync khi `npm install` để tránh lock file.

Truy vết 30 use case → màn hình → bảng dữ liệu: [`frontend/README-UC-TRACE.md`](frontend/README-UC-TRACE.md).
