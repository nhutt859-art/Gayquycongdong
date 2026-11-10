# GâyQuỹ+ Mobile (Expo)

App di động dùng **chung backend production** với website, giao diện và chức năng tương tự bản web, không dùng WebView.

- Frontend web: <https://dacntt-web.vercel.app>
- Backend API: <https://gayquy-backend.onrender.com/api>

## Công nghệ

- Expo SDK 58, React Native 0.88, React 19
- React Navigation (native stack + bottom tabs)
- `expo-secure-store` (native) / AsyncStorage (web) để lưu JWT
- Theme emerald đồng bộ website

## Chạy local

```bash
cd mobile
npm install
cp .env.example .env
npm start
```

Sau đó chọn:

- `a` — Android emulator/thiết bị
- `i` — iOS simulator (macOS)
- `w` — bản web để kiểm tra nhanh giao diện

Mặc định app gọi backend production. Khi phát triển backend local, sửa `EXPO_PUBLIC_API_URL`:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api
```

Không dùng `localhost` trên điện thoại thật vì điện thoại không trỏ về máy tính.

## Màn hình chính

- **Trang chủ**: chiến dịch sắp kết thúc, gợi ý AI, chủ đề quan tâm
- **Khám phá**: tìm kiếm, lọc danh mục/trạng thái, sắp xếp, phân trang
- **Chi tiết dự án**: câu chuyện, bản tin, bình luận/trả lời, gói tri ân, dự đoán AI có giải thích, điểm rủi ro gian lận
- **Tài trợ**: chọn số tiền/gói, ẩn danh, phương thức thanh toán mô phỏng, kiểm tra rủi ro
- **Đăng nhập / Đăng ký**: mật khẩu tối thiểu 8 ký tự, phản hồi đăng ký trung tính
- **Quên mật khẩu**: gửi OTP qua email, đặt lại mật khẩu
- **Chọn chủ đề**: lưu sở thích để AI cá nhân hoá gợi ý
- **Cá nhân**: hồ sơ, KYC mô phỏng, lịch sử tài trợ/giao dịch, quản lý sở thích
- **Thông báo**: lọc chưa đọc, đánh dấu đã đọc, xoá
- **Dự án của tôi**: dự án sở hữu, cộng tác, lời mời
- **Tạo dự án**: 3 bước, AI ước tính thành công, gửi duyệt
- **Quản lý dự án**: sửa thông tin, bản tin, gói tri ân, cộng tác viên, giải ngân, nhà tài trợ, kết thúc chiến dịch
- **Quản trị**: tổng quan, duyệt dự án, giải ngân, cảnh báo gian lận/báo cáo, người dùng, danh mục

## Tài khoản thử nghiệm

Mật khẩu chung: `12345678`

- `minhanh.nguyen@gayquy.vn` — nhà tài trợ
- `thu.ha.le@gayquy.vn` — cộng tác viên
- `hoang.nam.tran@gayquy.vn` — chủ dự án

Tài khoản admin production dùng email thật, không lưu mật khẩu trong repository.

## Build

Kiểm tra bản web:

```bash
npm run export:web
```

Build native bằng EAS (cần tài khoản Expo):

```bash
npx eas-cli build --platform android
npx eas-cli build --platform ios
```

`app.json` đã đặt:

- name: `GâyQuỹ+`
- slug/scheme: `gayquy`
- Android package / iOS bundle id: `vn.gayquy.app`

Trước khi phát hành, thay icon/splash mặc định trong `mobile/assets/` bằng bộ nhận diện GâyQuỹ+.

## Lưu ý bảo mật

- JWT lưu trong SecureStore trên native; trên web dùng AsyncStorage (giống localStorage) nên chỉ dùng bản web để kiểm thử.
- API production dùng CORS; app native không bị giới hạn CORS như trình duyệt.
- Không đưa `.env` hoặc khoá bí mật vào repository.
