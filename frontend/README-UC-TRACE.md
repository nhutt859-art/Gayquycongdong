# Truy vết 30 use case → màn hình → API → bảng DB

Ứng dụng demo **Gây Quỹ Cộng Đồng + AI** dùng React + Express + PostgreSQL thật (Neon hoặc local). Không còn mock data, không còn nút đổi vai — mỗi phiên đăng nhập là một JWT ứng với đúng user trong bảng `users`.

## Chạy

```powershell
# Terminal 1
cd backend
npm install
npm run db:setup
npm run dev

# Terminal 2
cd frontend
npm install
npm run dev
```

Mật khẩu demo chung: `123456`. Chi tiết cấu hình Neon xem `backend/README.md`.

## Bảng truy vết

| UC | Màn hình | API chính | Bảng |
|----|----------|-----------|------|
| UC01 Đăng ký | `/dang-nhap` (mode đăng ký) → `/chon-so-thich` | `POST /auth/register`, `PUT /me/interests` | users, user_interests |
| UC02 Đăng nhập/Đăng xuất | `/dang-nhap`; đăng xuất ở header | `POST /auth/login`; client xoá JWT | users |
| UC03 Hồ sơ & sở thích | `/ca-nhan`, `/chon-so-thich` | `GET/PATCH /me`, `PUT /me/interests` | users, user_interests |
| UC04 KYC | `/ca-nhan` (nút xác thực); admin xem trạng thái ở `/admin/nguoi-dung` | `POST /me/kyc` | users.kyc_status |
| UC05 Tạo dự án | `/tao-du-an` (wizard 3 bước) | `POST /projects` | projects, rewards |
| UC06 Mời cộng tác viên | `/quan-ly/:id` tab Cộng tác viên | `POST /projects/:id/collaborators` | project_collaborators |
| UC07 Chấp nhận/từ chối lời mời | `/du-an-cua-toi` (khối lời mời) | `POST /me/invitations/:projectId/accept`, `.../decline` | project_collaborators.accepted_at |
| UC08 Sửa/cập nhật tiến độ | `/quan-ly/:id` tab Thông tin, Bản tin | `PATCH /projects/:id`, `POST /projects/:id/updates` | projects, project_updates |
| UC09 Duyệt/từ chối dự án | `/admin/duyet-du-an` | `POST /admin/projects/:id/approve`, `.../reject` | projects.status, projects.reject_reason |
| UC10 Xem danh sách & chi tiết | `/`, `/kham-pha`, `/du-an/:id` | `GET /projects`, `GET /projects/:id` | projects, categories, rewards |
| UC11 Tìm kiếm & lọc | `/kham-pha` | `GET /projects?q=&category=&status=&sort=` | projects, categories |
| UC12 Đóng chiến dịch | `/quan-ly/:id` (nút Dừng/Đóng) | `POST /projects/:id/close` | projects.status |
| UC13 Tài trợ | `/du-an/:id` → `/tai-tro/:id` | `POST /projects/:id/pledges` | pledges, projects.current_amount |
| UC14 Thanh toán mô phỏng | `/tai-tro/:id` bước 2 | `POST /projects/:id/pledges` | transactions |
| UC15 Lịch sử đóng góp | `/ca-nhan` | `GET /me/pledges`, `GET /me/transactions` | pledges, transactions |
| UC16 Hoàn tiền all-or-nothing | `/ca-nhan` (badge hoàn tiền); `/admin/duyet-du-an` (admin hoàn tiền) | `POST /admin/projects/:id/refund` | pledges.status=refunded, transactions |
| UC17 Yêu cầu giải ngân | `/quan-ly/:id` tab Tài chính & nhà tài trợ | `POST /projects/:id/payouts` | transactions |
| UC18 Admin duyệt giải ngân | `/admin/giai-ngan` | `POST /admin/payouts/:id/approve`, `.../reject` | transactions |
| UC19 Bình luận | `/du-an/:id` tab Bình luận | `POST /projects/:id/comments` | comments |
| UC20 Bản tin tiến độ | `/du-an/:id` tab Cập nhật + `/quan-ly/:id` đăng bản tin | `POST /projects/:id/updates` | project_updates |
| UC21 Trả lời bình luận | `/du-an/:id` (nút Trả lời) | `POST /projects/:id/comments` với `parent_comment_id` | comments.parent_comment_id |
| UC22 Theo dõi dự án | Nút ★ ở `/du-an/:id` | `POST/DELETE /projects/:id/follow` | follows, notifications |
| UC23 Báo cáo vi phạm | `/du-an/:id` → modal báo cáo; admin xử lý ở `/admin/gian-lan` | `POST /projects/:id/reports`, `PATCH /admin/reports/:id` | reports |
| UC24 AI gợi ý dự án | Home “Dành cho bạn” | `GET /me/recommendations` | user_interests, ai_recommendations |
| UC25 AI dự đoán thành công | `/du-an/:id` AIBox, `/tao-du-an`, `/quan-ly/:id` | `GET /projects/:id`, `POST /projects` | ai_predictions, projects.ai_success_score |
| UC26 AI phát hiện gian lận | `/tai-tro/:id` (cảnh báo theo số tiền), `/admin/gian-lan` | `POST /projects/:id/pledges` | fraud_flags, users.trust_score |
| UC27 Admin xem rủi ro & duyệt cảnh báo | `/admin/gian-lan` | `GET /admin/fraud-flags`, `PATCH /admin/fraud-flags/:id` | fraud_flags.review_status |
| UC28 Quản lý danh mục | `/admin/danh-muc` | `GET/POST/PATCH/DELETE /admin/categories` | categories |
| UC29 Quản lý người dùng | `/admin/nguoi-dung` (khóa/mở) | `PATCH /admin/users/:id/status` | users.status |
| UC30 Thống kê tổng quan | `/admin` | `GET /admin/stats` | aggregate từ projects, pledges, users |

## Ghi chú

- **AI** trong đồ án là heuristic rule-based; kết quả được lưu vào `ai_predictions`/`ai_recommendations`, không phải mô hình học máy huấn luyện thật.
- **Thanh toán** chỉ mô phỏng: thành công tạo `pledges` + `transactions`; nút “giả lập thất bại” trả lỗi 402 và không cộng tiền.
- **KYC** demo tự xác thực ngay khi bấm; không tải giấy tờ thật.
- **JWT** lưu `localStorage`; logout chỉ xoá token phía client.
