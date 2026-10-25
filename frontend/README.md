# Frontend — Gây Quỹ Cộng Đồng + AI

Giao diện tiếng Việt cho nền tảng crowdfunding, xây bằng **React 19 + Vite 8 + React Router 7 + Tailwind CSS 3**. Toàn bộ dữ liệu lấy từ API Express/PostgreSQL trong thư mục `../backend`; không còn mock data hay chế độ đổi vai.

## 1. Chạy nhanh

```powershell
cd frontend
npm install
npm run dev
```

Mở <http://localhost:5173>.

Trước đó backend phải đang chạy ở <http://localhost:4000>. Nếu backend dùng cổng khác:

```powershell
$env:VITE_PROXY_TARGET='http://localhost:4100'
npm run dev
```

## 2. Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `VITE_PROXY_TARGET` | `http://localhost:4000` | Chỉ dùng khi dev; Vite proxy `/api` sang backend |
| `VITE_API_URL` | `/api` | Đặt khi build production trỏ thẳng tới API, ví dụ `https://api.example.com/api` |

Có thể tạo `frontend/.env.local`:

```dotenv
VITE_API_URL=/api
```

## 3. Tài khoản demo

Mật khẩu chung: **`123456`**

| Email | Vai trò |
|---|---|
| `admin@demo.vn` | Quản trị viên |
| `backer@demo.vn` | Nhà tài trợ |
| `owner@demo.vn` | Chủ dự án |
| `collab@demo.vn` | Cộng tác viên |
| `quy@demo.vn`, `yte@demo.vn` | Chủ dự án khác |
| `lan@demo.vn`, `hung@demo.vn`, `thao@demo.vn` | Nhà tài trợ khác |

Trang `/dang-nhap` có nút đăng nhập nhanh cho 4 vai trò chính. Tài khoản mới đăng ký sẽ được chuyển qua chọn sở thích; KYC demo tự xác thực trong trang cá nhân.

## 4. Cấu trúc

```text
frontend/
├── public/                 # favicon, icons
├── src/
│   ├── components/
│   │   ├── ui.jsx          # Button, Card, Modal, AIBox, ProjectCard, ...
│   │   └── RequireAuth.jsx # chặn route theo đăng nhập/vai trò
│   ├── context/AppContext.jsx
│   ├── lib/
│   │   ├── api.js          # fetch wrapper, JWT localStorage, lỗi API
│   │   └── format.js       # tiền VND, ngày, trạng thái, tiến độ
│   ├── pages/
│   │   ├── Home.jsx        # hero, dự án nổi bật, gợi ý AI
│   │   ├── Explore.jsx     # tìm kiếm, lọc danh mục/trạng thái, sắp xếp
│   │   ├── ProjectDetail.jsx
│   │   ├── Checkout.jsx    # tài trợ mô phỏng + kiểm tra rủi ro
│   │   ├── Auth.jsx        # đăng nhập/đăng ký + onboarding chọn sở thích
│   │   ├── Profile.jsx     # hồ sơ, KYC, lịch sử, giao dịch
│   │   ├── CreateProject.jsx
│   │   ├── Owner.jsx       # dự án của tôi + quản lý chiến dịch
│   │   ├── Admin.jsx       # tổng quan, duyệt, giải ngân, gian lận, users, categories
│   │   ├── Notifications.jsx
│   │   └── Forbidden.jsx
│   ├── App.jsx             # route + layout
│   ├── main.jsx
│   └── index.css
├── index.html
├── vite.config.js
└── tailwind.config.js
```

## 5. Route chính

| Route | Màn hình |
|---|---|
| `/` | Trang chủ |
| `/kham-pha` | Khám phá + tìm kiếm/lọc |
| `/du-an/:id` | Chi tiết dự án (tab câu chuyện/cập nhật, bình luận, gói tri ân) |
| `/dang-nhap` | Đăng nhập / đăng ký |
| `/chon-so-thich` | Onboarding sở thích |
| `/tai-tro/:id` | Tài trợ mô phỏng |
| `/ca-nhan` | Hồ sơ, KYC, lịch sử đóng góp, giao dịch |
| `/thong-bao` | Thông báo |
| `/tao-du-an` | Tạo dự án (3 bước) |
| `/du-an-cua-toi` | Dự án sở hữu/cộng tác + lời mời |
| `/quan-ly/:id` | Quản lý chiến dịch, bản tin, gói tri ân, cộng tác viên, giải ngân |
| `/admin` và `/admin/:tab` | Dashboard quản trị |

## 6. Ghi chú kỹ thuật

- API client tự gắn `Authorization: Bearer <token>`; token lưu ở `localStorage` với key `gq_token`.
- Gặp `401`, app xoá phiên và phát sự kiện để điều hướng về đăng nhập.
- Đăng xuất chỉ xoá token phía client (JWT stateless); API `/auth/logout` vẫn tồn tại nhưng không cần gọi.
- Sau khi tài trợ/KYC, app refresh lại session + thông báo để số liệu đúng ngay.
- Thanh toán, KYC và AI đều là mô phỏng phục vụ đồ án; xem `backend/README.md`.

## 7. Build & kiểm tra

```powershell
npm run build
npm run lint
npm run preview
```

- Build production nằm trong `dist/`.
- `npm run lint` dùng Oxlint; hiện còn cảnh báo `set-state-in-effect`/fast-refresh mang tính khuyến nghị, không chặn build.
- Khi deploy tĩnh, cấu hình rewrite mọi route về `index.html` và đặt `VITE_API_URL` trỏ tới backend.
