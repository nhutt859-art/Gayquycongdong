# Gây Quỹ Cộng Đồng + AI

Đồ án nền tảng crowdfunding tiếng Việt, gồm **frontend React** và **backend Express + PostgreSQL thật** (Neon cloud hoặc Postgres local). Hệ thống có đủ 3 nhóm người dùng — nhà tài trợ, chủ dự án, quản trị viên — cùng các tính năng AI mô phỏng (dự đoán thành công, gợi ý dự án, cảnh báo gian lận).

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
                                                                       │ 16 bảng + trigger │
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
npm run dev
```

API chạy tại <http://localhost:4000/api>. `db:setup` tạo 16 bảng và nạp **10 dự án mẫu** cùng users, rewards, pledges, transactions, comments, thông báo, cảnh báo gian lận…

> ⚠️ `db:setup` DROP và tạo lại toàn bộ bảng trong schema `public`. Chỉ dùng cho database demo.

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

## Tài khoản demo

Mật khẩu chung: **`123456`**

| Email | Vai trò |
|---|---|
| `admin@demo.vn` | Quản trị viên |
| `backer@demo.vn` | Nhà tài trợ |
| `owner@demo.vn` | Chủ dự án |
| `collab@demo.vn` | Cộng tác viên |
| `quy@demo.vn`, `yte@demo.vn` | Chủ dự án khác |
| `lan@demo.vn`, `hung@demo.vn`, `thao@demo.vn` | Nhà tài trợ khác |

Trang đăng nhập có nút đăng nhập nhanh 4 vai trò chính.

## Chức năng chính

**Khách / Nhà tài trợ**
- Đăng ký tài khoản thật, xác thực email, quên/đặt lại mật khẩu qua email.
- Trang chủ, khám phá, tìm kiếm/lọc/sắp xếp dự án.
- Xem chi tiết, cập nhật, bình luận & trả lời, theo dõi, báo cáo vi phạm.
- Tài trợ mô phỏng (thành công/thất bại), nhận gói tri ân, xem lịch sử đóng góp và giao dịch.
- Hồ sơ, KYC demo, chọn sở thích, nhận gợi ý AI, thông báo.

**Chủ dự án / Cộng tác viên**
- Tạo dự án 3 bước sau KYC; tự động nâng backer → owner.
- Quản lý thông tin, đóng chiến dịch, đăng bản tin, CRUD gói tri ân.
- Mời/chấp nhận cộng tác viên; xem nhà tài trợ; gửi yêu cầu giải ngân.

**Quản trị viên**
- Thống kê tổng quan; duyệt/từ chối dự án kèm lý do; hoàn tiền.
- Duyệt/từ chối giải ngân; xử lý báo cáo và cảnh báo gian lận.
- Khóa/mở khóa người dùng; CRUD danh mục.

**AI (heuristic, không phải ML thật)**
- Dự đoán khả năng thành công khi tạo/xem dự án.
- Gợi ý dự án theo sở thích và hành vi.
- Chấm rủi ro giao dịch/dự án, tạo cảnh báo cho admin.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 3, Oxlint |
| Backend | Node.js, Express 5, `pg`, Zod, JWT (`jsonwebtoken`), bcrypt, Nodemailer (SMTP) |
| Database | PostgreSQL 15+ (Neon), 16 bảng, trigger đồng bộ số tiền |
| Kiểm thử | `scripts/smoke.js` (69 check API), Puppeteer (luồng UI chính) |

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

Kết quả hiện tại: **69/69 API check pass**, build thành công, lint chỉ còn cảnh báo khuyến nghị. Đã kiểm thử API các luồng: đăng ký → xác thực email → đăng nhập, quên mật khẩu → đặt lại → JWT cũ bị vô hiệu hoá, khách xem/lọc, đăng ký → sở thích → KYC → tạo dự án → admin duyệt, tài trợ thành công/thất bại, bình luận/trả lời/báo cáo/theo dõi, quản lý dự án, giải ngân, admin duyệt/xử lý, thông báo.

## Phạm vi & lưu ý

- Thanh toán, KYC, AI đều **mô phỏng** phục vụ đồ án; không kết nối cổng thanh toán/OCR/mô hình ML thật.
- Email xác thực / đặt lại mật khẩu dùng SMTP thật (Nodemailer). Khi chưa điền SMTP trong `backend/.env`, liên kết được in ra console backend để test.
- JWT lưu `localStorage`; logout xoá token phía client. Đặt lại mật khẩu sẽ tăng `token_version` và vô hiệu hoá mọi JWT cũ.
- Không commit `backend/.env`.
- Nếu dùng OneDrive, nên tạm dừng sync khi `npm install` để tránh lock file.

Truy vết 30 use case → màn hình → bảng dữ liệu: [`frontend/README-UC-TRACE.md`](frontend/README-UC-TRACE.md).
