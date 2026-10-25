# Backend — Gây Quỹ Cộng Đồng + AI

API Express 5 dùng PostgreSQL thật (Neon hoặc Postgres local), truy vấn bằng `pg` + SQL thuần. Không dùng ORM, không dùng mock data.

## 1. Thành phần

- **Node.js 20+** (đã kiểm thử với Node 24), Express 5, `pg`, JWT, bcrypt, Zod.
- **16 bảng** bám theo `Usecase Database.docx`:
  `users`, `categories`, `projects`, `project_collaborators`, `rewards`, `pledges`, `transactions`, `project_updates`, `comments`, `user_interests`, `ai_recommendations`, `ai_predictions`, `fraud_flags`, `reports`, `notifications`, `follows`.
- Trigger `pledges_refresh_aggregates` tự cộng lại `projects.current_amount` và `rewards.quantity_claimed` mỗi khi pledge đổi trạng thái.
- Trigger cập nhật `updated_at` cho các bảng có cột này.
- AI là **heuristic rule-based** (dự đoán thành công, chấm rủi ro gian lận, gợi ý dự án), lưu kết quả vào `ai_predictions` / `ai_recommendations` — không phải mô hình ML thật.

## 2. Cấu trúc

```text
backend/
├── db/
│   ├── schema.sql        # DROP + CREATE 16 bảng, index, trigger
│   └── seed.sql          # 10 dự án + users/rewards/pledges/... mẫu
├── scripts/
│   ├── db-check.js       # kiểm tra kết nối + bảng + số dòng
│   ├── setup-db.js       # chạy schema + seed (hoặc chỉ seed)
│   └── smoke.js          # 67 kiểm tra API end-to-end
├── src/
│   ├── server.js         # khởi động Express, CORS, error handler
│   ├── db.js             # pool pg + withTransaction
│   ├── middleware/auth.js
│   ├── routes/           # auth, me, projects, categories, admin
│   ├── services/         # ai, permissions, notifications
│   └── lib/              # errors, validate, mappers
├── .env.example
└── package.json
```

## 3. Kết nối Neon (khuyến nghị)

Bạn tự tạo project và tự dán connection string vào `.env`; không cần gửi mật khẩu cho ai.

1. Vào <https://neon.tech>, đăng ký/đăng nhập.
2. **Create project**:
   - Name: `dacntt-crowdfunding`
   - Postgres: phiên bản mặc định (15+)
   - Region: **AWS ap-southeast-1 (Singapore)** để gần Việt Nam.
3. Trong project, bấm **Connect**:
   - Bật **Connection pooling** → copy chuỗi có host dạng `ep-xxx-pooler.ap-southeast-1.aws.neon.tech`.
   - Dán vào `DATABASE_URL`.
   - (Tuỳ chọn) Tắt pooling → copy chuỗi direct vào `DIRECT_URL`. Nếu mạng không hỗ trợ IPv6, cứ để trống `DIRECT_URL`; script sẽ dùng `DATABASE_URL`.
4. Tạo file `.env`:

   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```

5. Mở `backend/.env` và điền:

   ```dotenv
   PORT=4000
   CORS_ORIGIN=http://localhost:5173
   JWT_SECRET=<chuỗi bí mật dài>
   DATABASE_URL=postgresql://neondb_owner:MAT_KHAU@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   DIRECT_URL=
   PGSSL=require
   PG_POOL_MAX=5
   ```

   Tạo `JWT_SECRET` bằng:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. Cài dependency và kiểm tra:

   ```powershell
   npm install
   npm run db:check
   ```

   Kết quả đúng: kết nối thành công, báo thiếu bảng (lần đầu) → chạy bước 7.

7. Tạo schema + nạp 10 dự án mẫu:

   ```powershell
   npm run db:setup
   ```

   > ⚠️ `db:setup` **DROP toàn bộ 16 bảng** trong schema `public` rồi tạo lại. Chỉ chạy trên database demo, không chạy trên dữ liệu thật.

8. Chạy API:

   ```powershell
   npm run dev
   ```

   - API: <http://localhost:4000/api>
   - Health: <http://localhost:4000/api/health>

9. Mở terminal khác, chạy frontend theo `frontend/README.md`.

### Dùng Postgres local thay Neon

```dotenv
DATABASE_URL=postgresql://postgres:matkhau@localhost:5432/crowdfunding
DIRECT_URL=
PGSSL=disable
```

Sau đó vẫn chạy `npm run db:check` → `npm run db:setup` → `npm run dev`.

## 4. Biến môi trường

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Chuỗi kết nối Postgres/Neon (nên dùng pooler) |
| `DIRECT_URL` | — | rỗng | Dùng cho `db:setup`/`db:check` nếu có; fallback `DATABASE_URL` |
| `JWT_SECRET` | ✅ | — | Tối thiểu 20 ký tự; server từ chối khởi động nếu thiếu |
| `PORT` | — | `4000` | Cổng API |
| `CORS_ORIGIN` | — | `http://localhost:5173` | Nhiều origin cách nhau bởi dấu phẩy |
| `APP_URL` | — | lấy `CORS_ORIGIN` | URL frontend dùng trong liên kết email |
| `PGSSL` | — | `require` | `disable` với Postgres local |
| `PG_POOL_MAX` | — | `5` | Giữ thấp với Neon free |
| `SMTP_HOST` | — | rỗng | Để trống = in liên kết email ra console (dev) |
| `SMTP_PORT` | — | `587` | Dùng `465` nếu SSL |
| `SMTP_SECURE` | — | `false` | `true` với cổng 465 |
| `SMTP_USER` | — | rỗng | Tài khoản SMTP / `resend` |
| `SMTP_PASS` | — | rỗng | App Password hoặc API key |
| `SMTP_FROM` | — | rỗng | VD `GayQuy+ <no-reply@ten-mien>` |
| `EMAIL_VERIFICATION_TTL_MINUTES` | — | `1440` | Hạn liên kết xác thực email |
| `PASSWORD_RESET_TTL_MINUTES` | — | `60` | Hạn liên kết đặt lại mật khẩu |

### 4.1 Email xác thực & đặt lại mật khẩu

- Đăng ký mới tạo tài khoản **chưa xác thực**; backend gửi liên kết `${APP_URL}/xac-thuc-email?token=...`.
- Chưa xác thực email thì `POST /auth/login` trả `403` với `details.code = EMAIL_NOT_VERIFIED`.
- Quên mật khẩu gửi liên kết `${APP_URL}/dat-lai-mat-khau?token=...`, hết hạn sau 60 phút.
- Token chỉ lưu dạng SHA-256, dùng một lần. Đặt lại mật khẩu tăng `users.token_version` nên mọi JWT cũ bị từ chối.
- Chưa cấu hình SMTP: nội dung email + liên kết được in ra console backend; API trả thêm `dev_verification_url` / `dev_reset_url` khi `NODE_ENV !== 'production'`.

**Gmail**

1. Bật xác thực 2 bước cho tài khoản Google.
2. Vào <https://myaccount.google.com/apppasswords> tạo App Password 16 ký tự.
3. Điền `backend/.env`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@gmail.com
SMTP_PASS=app-password-16-ky-tu
SMTP_FROM=GayQuy+ <your.email@gmail.com>
```

**Resend** (gửi từ tên miền đã xác minh):

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxx
SMTP_FROM=GayQuy+ <no-reply@ten-mien-cua-ban>
```

Sau khi sửa `.env`, khởi động lại backend. Database cũ chưa có cột auth thì chạy `npm run db:migrate-auth` (không xoá dữ liệu).

## 5. Script

| Lệnh | Việc làm |
|---|---|
| `npm run dev` | Chạy API với `node --watch` |
| `npm start` | Chạy API production |
| `npm run db:check` | Kiểm tra kết nối, đủ 16 bảng, số dòng, trigger, danh sách dự án |
| `npm run db:migrate-auth` | Thêm cột xác thực email / reset mật khẩu vào DB cũ (không xoá dữ liệu) |
| `npm run db:setup` | DROP + CREATE schema rồi seed 10 dự án |
| `npm run db:seed` | Chỉ nạp lại seed (không DROP bảng) |
| `npm run smoke` | 69 kiểm tra API; đặt `API_URL` nếu API không ở cổng 4000 |

Ví dụ smoke test với API cổng 4100:

```powershell
$env:API_URL='http://localhost:4100/api'
node scripts/smoke.js
```

## 6. API chính

Tất cả dưới tiền tố `/api`. Route cần đăng nhập dùng header `Authorization: Bearer <JWT>`.

| Nhóm | Endpoint |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/me`, `POST /auth/logout` |
| Danh mục | `GET /categories` |
| Dự án công khai | `GET /projects`, `GET /projects/:id`, `GET /projects/:id/pledges` |
| Tạo & quản lý dự án | `POST /projects`, `PATCH /projects/:id`, `POST /projects/:id/close` |
| Tương tác | `POST /projects/:id/comments`, `POST /projects/:id/follow`, `DELETE /projects/:id/follow`, `POST /projects/:id/reports` |
| Tài trợ | `POST /projects/:id/pledges` (mô phỏng thanh toán, ghi `transactions`) |
| Gói tri ân | `POST/PATCH/DELETE /projects/:id/rewards...` |
| Cộng tác viên | `GET/POST/PATCH/DELETE /projects/:id/collaborators...` |
| Giải ngân | `POST /projects/:id/payouts` |
| Cá nhân | `GET/PATCH /me`, `POST /me/kyc`, `PUT /me/interests`, `GET /me/projects`, `GET /me/pledges`, `GET /me/transactions`, `GET /me/notifications`, `GET /me/recommendations` |
| Lời mời | `POST /me/invitations/:projectId/accept`, `.../decline` |
| Admin | `GET /admin/stats`, duyệt/từ chối/hoàn tiền dự án, duyệt/từ chối giải ngân, cảnh báo gian lận, báo cáo, người dùng, CRUD danh mục |

## 7. Tài khoản demo

Mật khẩu chung: **`123456`**

| Email | Vai trò |
|---|---|
| `admin@demo.vn` | Quản trị viên |
| `backer@demo.vn` | Nhà tài trợ |
| `owner@demo.vn` | Chủ dự án (Nhóm Sông Sạch) |
| `quy@demo.vn` | Chủ dự án (Quỹ Học Bổng Vùng Cao) |
| `yte@demo.vn` | Chủ dự án (Mái Ấm Y Tế) |
| `collab@demo.vn` | Cộng tác viên |
| `lan@demo.vn`, `hung@demo.vn`, `thao@demo.vn` | Nhà tài trợ khác |

Seed có 10 dự án: 5 đang gây quỹ, 2 thành công, 1 thất bại, 1 chờ duyệt, 1 đã huỷ. Ngày tháng tính tương đối theo `CURRENT_DATE` nên chiến dịch luôn còn hạn khi demo.

## 8. Xử lý sự cố

| Lỗi | Cách xử lý |
|---|---|
| `ENOTFOUND` / `getaddrinfo` | Copy lại đúng host Neon, không thừa khoảng trắng/xuống dòng trong `.env` |
| `password authentication failed` | Kiểm tra mật khẩu trong URL; có thể reset password role trong Neon Console |
| `self-signed certificate` | Đặt `PGSSL=require` |
| `ENETUNREACH` / lỗi IPv6 | Dùng chuỗi **pooler** cho `DATABASE_URL`, để trống `DIRECT_URL` |
| `too many connections` | Dùng pooler + `PG_POOL_MAX=5` |
| Kết nối treo vài giây lần đầu | Neon cold start; thử lại sau 10–20 giây |
| `db:setup` báo thiếu bảng | Chạy đúng thư mục `backend`, kiểm tra `DATABASE_URL` đang trỏ đúng database |
| API báo thiếu `JWT_SECRET` | Điền chuỗi ≥ 20 ký tự vào `.env` |
| Frontend gọi API lỗi CORS | Thêm origin thực tế vào `CORS_ORIGIN`, ví dụ `http://127.0.0.1:5173` |

## 9. Lưu ý phạm vi đồ án

- Thanh toán chỉ **mô phỏng** (kể cả nút “giả lập thất bại”), không kết nối cổng thanh toán thật.
- KYC demo tự xác thực ngay; không có OCR/giấy tờ thật.
- AI là heuristic, không huấn luyện mô hình.
- JWT lưu `localStorage`; đăng xuất chỉ xoá token phía client.
- Không commit `.env` (đã có trong `.gitignore`).
