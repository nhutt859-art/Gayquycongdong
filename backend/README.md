# Backend — Gây Quỹ Cộng Đồng + AI

API Express 5 dùng PostgreSQL thật (Neon hoặc Postgres local), truy vấn bằng `pg` + SQL thuần. Không dùng ORM, không dùng mock data.

## 1. Thành phần

- **Node.js 20+** (đã kiểm thử với Node 24), Express 5, `pg`, JWT, bcrypt, Zod.
- **17 bảng** bám theo `Usecase Database.docx`:
  `users`, `categories`, `projects`, `project_collaborators`, `rewards`, `pledges`, `transactions`, `project_updates`, `comments`, `user_interests`, `ai_recommendations`, `ai_predictions`, `ai_model_versions`, `fraud_flags`, `reports`, `notifications`, `follows`.
- Trigger `pledges_refresh_aggregates` tự cộng lại `projects.current_amount` và `rewards.quantity_claimed` mỗi khi pledge đổi trạng thái.
- Trigger cập nhật `updated_at` cho các bảng có cột này.
- AI gồm **logistic regression thật** cho dự đoán thành công (huấn luyện trên lịch sử dự án, kiểm định chéo 5 fold, giải thích từng tín hiệu), **gợi ý dự án** dựa trên sở thích + lịch sử tài trợ + lọc cộng tác, và **kiểm chứng gian lận** dựa trên bằng chứng độc lập. Kết quả lưu vào `ai_predictions` / `ai_recommendations` / `fraud_flags`.

## 2. Cấu trúc

```text
backend/
├── db/
│   ├── schema.sql        # DROP + CREATE 17 bảng, index, trigger
│   ├── seed.sql          # seed cơ bản cho môi trường dev
│   └── migrate-ai.sql    # cột/bảng phục vụ AI có thể giải thích
├── scripts/
│   ├── db-check.js       # kiểm tra kết nối + bảng + số dòng
│   ├── setup-db.js       # chạy schema + seed (hoặc chỉ seed)
│   ├── seed-realistic.js # sinh dữ liệu lịch sử thực tế hơn (--dry-run / --apply)
│   ├── migrate-ai.js     # áp migration AI
│   ├── train-ai.js       # huấn luyện mô hình dự đoán thành công
│   ├── refresh-ai.js     # huấn luyện lại + tạo lại dự báo/gợi ý
│   ├── verify-ai.mjs     # kiểm tra model/dự báo/gợi ý/cảnh báo đã lưu
│   └── smoke.js          # kiểm tra API end-to-end
├── src/
│   ├── server.js         # khởi động Express, CORS, error handler
│   ├── db.js             # pool pg + withTransaction
│   ├── middleware/auth.js
│   ├── routes/           # auth, me, projects, categories, admin, ai
│   ├── services/         # ai, ai-model, permissions, notifications
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

7. Tạo schema, nạp dữ liệu lịch sử và huấn luyện mô hình:

   ```powershell
   npm run db:setup
   npm run db:migrate-ai
   npm run db:seed:realistic -- --dry-run
   npm run db:seed:realistic -- --apply
   npm run ai:refresh
   ```

   `db:seed:realistic -- --apply` nạp 200 dự án, ~1.240 người dùng và hàng nghìn giao dịch; giữ lại tài khoản admin thật. `--dry-run` chỉ kiểm tra tính nhất quán, không ghi database.

   > ⚠️ `db:setup` **DROP toàn bộ 17 bảng** trong schema `public` rồi tạo lại. Chỉ chạy trên database đồ án, không chạy trên dữ liệu thật.

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
| `MAIL_FROM` | — | lấy `SMTP_FROM` | Địa chỉ gửi, VD `GayQuy+ <no-reply@ten-mien>` |
| `MAIL_PROVIDER` | — | tự phát hiện | Chọn cứng: `brevo`, `resend`, `sendgrid`, `smtp`, `console` |
| `BREVO_API_KEY` | — | rỗng | Gửi qua Brevo HTTP API — 300 email/ngày |
| `RESEND_API_KEY` | — | rỗng | Gửi qua Resend HTTP API |
| `SENDGRID_API_KEY` | — | rỗng | Gửi qua SendGrid HTTP API |
| `SMTP_HOST` | — | rỗng | Để trống = in email ra console (dev); Render free chặn SMTP |
| `SMTP_PORT` | — | `587` | Dùng `465` nếu SSL |
| `SMTP_SECURE` | — | `false` | `true` với cổng 465 |
| `SMTP_USER` | — | rỗng | Tài khoản SMTP |
| `SMTP_PASS` | — | rỗng | App Password hoặc API key |
| `SMTP_FROM` | — | rỗng | Fallback nếu không có `MAIL_FROM` |
| `EMAIL_VERIFICATION_TTL_MINUTES` | — | `1440` | Hạn liên kết xác thực email |
| `PASSWORD_RESET_TTL_MINUTES` | — | `60` | Hạn mã OTP đặt lại mật khẩu |
| `DEV_SHOW_OTP` | — | `false` | Chỉ local: trả OTP khi chưa cấu hình email |

### 4.1 Email xác thực & đặt lại mật khẩu

- Đăng ký mới tạo tài khoản **chưa xác thực**; backend gửi liên kết `${APP_URL}/xac-thuc-email?token=...`.
- Chưa xác thực email thì `POST /auth/login` trả `403` với `details.code = EMAIL_NOT_VERIFIED`.
- Quên mật khẩu gửi **mã OTP 6 chữ số** qua email; người dùng nhập OTP trên trang web. Mã hết hạn sau 60 phút.
- Token chỉ lưu dạng SHA-256, dùng một lần. Đặt lại mật khẩu tăng `users.token_version` nên mọi JWT cũ bị từ chối.
- Chưa cấu hình email: nội dung email + OTP được in ra console backend; API chỉ trả `dev_otp` khi chạy local (không phải Render) và chưa cấu hình email.
- Kiểm tra nhanh cấu hình trên server: `GET /api/health/mail` → `{ ok, provider, from }`.
- Kiểm tra API key + sender Brevo đã xác minh chưa: `GET /api/health/mail?verify=1` → `{ verify: { sender_found, sender_verified, ... } }`.

> **Quan trọng khi deploy Render:** từ 26/09/2025, Render **free** chặn outbound SMTP cổng 25/465/587. Gmail SMTP sẽ timeout dù cấu hình đúng. Hãy dùng HTTP API (Brevo/Resend/SendGrid) — các dịch vụ này gửi qua HTTPS cổng 443.

**Brevo — khuyên dùng (300 email/ngày, xác minh 1 địa chỉ gửi)**

1. Tạo tài khoản tại <https://www.brevo.com>.
2. **Senders & IP → Senders** → thêm địa chỉ gửi (có thể dùng Gmail của bạn) và bấm xác minh trong email.
3. **SMTP & API → API Keys** → tạo key.
4. Điền `backend/.env` (local) và **Render → Environment** (production):

```dotenv
BREVO_API_KEY=xkeysib-xxxxxxxx
MAIL_FROM=GayQuy+ <email-da-xac-minh@gmail.com>
```

**Resend**

```dotenv
RESEND_API_KEY=re_xxxxxxxx
MAIL_FROM=GayQuy+ <no-reply@ten-mien-cua-ban>
```

Lưu ý: Resend yêu cầu xác minh tên miền nếu gửi cho người khác; chưa xác minh thì chỉ gửi được tới email chủ tài khoản.

**SendGrid — không cần tên miền, chỉ cần xác minh Single Sender**

1. Tạo tài khoản tại <https://signup.sendgrid.com>.
2. Vào **Settings → Sender Authentication → Single Sender Verification** → **Create New Sender**.
3. Điền From Name (`GayQuy+`), From Email (Gmail của bạn), Reply To, thông tin công ty/địa chỉ → **Create**.
4. Mở email SendGrid gửi tới hộp thư đó, bấm **Verify Single Sender**.
5. Vào **Settings → API Keys → Create API Key**:
   - Chọn **Restricted Access**.
   - Mục **Mail Send** chọn **Full Access**.
   - Copy key `SG....` (chỉ hiện một lần).
6. Điền `backend/.env` (local) và **Render → Environment** (production):

```dotenv
MAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxx
MAIL_FROM=GayQuy+ <email-da-xac-minh@gmail.com>
```

`MAIL_FROM` phải trùng đúng email đã xác minh ở bước 3. Nếu đã có `BREVO_API_KEY`/`RESEND_API_KEY` từ trước, `MAIL_PROVIDER=sendgrid` sẽ ép dùng SendGrid; hoặc xoá các key kia.

> SendGrid free hiện là **trial 100 email/ngày trong 60 ngày**; hết trial cần nâng cấp. Nếu cần miễn phí lâu dài, dùng Brevo (300 email/ngày) hoặc Resend + tên miền riêng.
>
> SendGrid có thể tạm chặn tài khoản mới trong lúc review. Nếu đăng ký gặp lỗi “You are not authorized to access this account”, hãy chuyển sang Brevo — không nên tạo nhiều tài khoản SendGrid liên tiếp.

**Gmail SMTP — chỉ dùng local/VPS hoặc Render trả phí**

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

Thứ tự ưu tiên khi không đặt `MAIL_PROVIDER`: `BREVO_API_KEY` → `RESEND_API_KEY` → `SENDGRID_API_KEY` → SMTP. Nếu đã đặt API key thì không cần xoá SMTP. Sau khi sửa biến môi trường, **redeploy/restart** backend. Database cũ chưa có cột auth thì chạy `npm run db:migrate-auth` (không xoá dữ liệu).

## 5. Script

| Lệnh | Việc làm |
|---|---|
| `npm run dev` | Chạy API với `node --watch` |
| `npm start` | Chạy API production |
| `npm run db:check` | Kiểm tra kết nối, đủ 17 bảng, số dòng, trigger, danh sách dự án |
| `npm run db:migrate-auth` | Thêm cột xác thực email / reset mật khẩu vào DB cũ (không xoá dữ liệu) |
| `npm run db:migrate-ai` | Thêm cột/bảng AI (predictions, recommendations, fraud evidence, model versions) vào DB cũ |
| `npm run db:setup` | DROP + CREATE schema rồi seed cơ bản |
| `npm run db:seed` | Chỉ nạp lại seed cơ bản (không DROP bảng) |
| `npm run db:seed:realistic -- --dry-run` | Kiểm tra bộ dữ liệu 200 dự án trước khi ghi |
| `npm run db:seed:realistic -- --apply` | Nạp lại dữ liệu lịch sử thực tế hơn |
| `npm run ai:train` | Huấn luyện mô hình dự đoán thành công và lưu version |
| `npm run ai:refresh` | Huấn luyện lại + tạo lại toàn bộ dự báo/gợi ý |
| `npm run ai:verify` | Kiểm tra model đang active, dự báo, gợi ý và cảnh báo gian lận đã lưu |
| `npm run mail:test -- email@example.com` | Gửi email test qua dịch vụ đang cấu hình |
| `npm run smoke` | Kiểm tra API end-to-end; đặt `API_URL` nếu API không ở cổng 4000 |
| `npm run smoke` + `SMOKE_REGISTER_EMAIL` | Kiểm tra đầy đủ đăng ký + xác thực email bằng hộp thư thật do bạn kiểm soát |

Ví dụ smoke test với API cổng 4100:

```powershell
$env:API_URL='http://localhost:4100/api'
node scripts/smoke.js
```

Mặc định smoke test tạo tài khoản kiểm thử **trực tiếp trong DB** (đã xác thực email) để không gửi email ra ngoài. Nếu muốn kiểm tra đầy đủ luồng đăng ký + xác thực email, đặt `SMOKE_REGISTER_EMAIL` thành một hộp thư thật:

```powershell
$env:SMOKE_REGISTER_EMAIL='ban+smoke@example.com'
npm run smoke
```

Script sẽ dùng email đó để đăng ký, gửi email xác thực thật và dọn tài khoản sau khi chạy. Không dùng địa chỉ giả kiểu `@gayquy.vn` vì sẽ bị bounce về hộp thư gửi.

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

## 7. Tài khoản thử nghiệm

Mật khẩu chung: **`123456`**

| Email | Vai trò |
|---|---|
| `minhanh.nguyen@gayquy.vn` | Nhà tài trợ, KYC đã xác thực |
| `thu.ha.le@gayquy.vn` | Nhà tài trợ, KYC đã xác thực |
| `hoang.nam.tran@gayquy.vn` | Chủ dự án, KYC đã xác thực |

Bộ dữ liệu `db:seed:realistic -- --apply` tạo 200 dự án với đủ trạng thái (thành công, thất bại, đang gây quỹ, chờ duyệt, đã dừng), 523 gói tri ân, 6.629 pledge và 7.178 giao dịch. Ngày tháng được tính ngược từ thời điểm chạy để lịch sử luôn nhất quán. Tài khoản admin thật đang dùng trên production được giữ nguyên, không nằm trong danh sách mật khẩu chung.

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
- KYC mô phỏng tự xác thực ngay; không có OCR/giấy tờ thật.
- Dữ liệu lịch sử là dữ liệu tổng hợp có kiểm soát, không phải người dùng thật. Mô hình logistic regression học trên dữ liệu này (AUC 0.704, kiểm định chéo 5 fold) chỉ dùng để minh hoạ quy trình ra quyết định.
- Mô hình gian lận dựa trên bằng chứng độc lập và ngưỡng cảnh báo 60%; admin vẫn phải xác minh từng trường hợp, hệ thống không tự kết luận.
- JWT lưu `localStorage`; đăng xuất chỉ xoá token phía client.
- Không commit `.env` (đã có trong `.gitignore`).
