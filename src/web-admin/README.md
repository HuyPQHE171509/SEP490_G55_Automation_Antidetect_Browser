# 🚀 Web Admin Dashboard & API

Dự án này gồm 2 phần: Frontend (Vite/React) và Backend (Express/Node.js). 
Toàn bộ hệ thống được thiết kế để **Deploy trực tiếp lên Vercel**.

## 🌍 HƯỚNG DẪN DEPLOY LÊN VERCEL

Vì hệ thống chia làm 2 phần rõ rệt, cách an toàn và chuẩn xác nhất trên Vercel là **Deploy thành 2 Project riêng biệt**, sau đó liên kết chúng lại với nhau.

### BƯỚC 1: TẠO FIRESTORE DATABASE (CỰC KỲ QUAN TRỌNG)
Vercel là môi trường Serverless, ổ cứng của nó sẽ bị xoá liên tục. Do đó, bạn bắt buộc phải dùng Firestore để lưu trữ Đơn hàng (Orders) và Thống kê.
1. Truy cập **[Firebase Console](https://console.firebase.google.com/)** -> Vào dự án `huymck-98553`.
2. Ở cột menu trái, chọn **Build** -> **Firestore Database**.
3. Bấm **Create database** -> Chọn **Start in production mode** -> Chọn Location (Ví dụ: `asia-southeast1`) -> Bấm **Create**.

---

### BƯỚC 2: DEPLOY BACKEND (API SERVER)
1. Truy cập [Vercel Dashboard](https://vercel.com/dashboard) và bấm **Add New... -> Project**.
2. Import Repository Github của bạn chứa code này.
3. Trong màn hình cấu hình (Configure Project), chỉnh sửa như sau:
   - **Project Name:** `hl-mck-api` (hoặc tên tuỳ ý).
   - **Framework Preset:** Chọn `Other`.
   - **Root Directory:** Bấm nút *Edit*, chọn thư mục `src/web-admin/backend`.
   - **Build Command:** Để trống.
   - **Install Command:** `npm install`
4. Mở phần **Environment Variables** và dán chính xác các biến trong file `.env` local của bạn vào:
   - `USE_FIRESTORE=true`
   - `ADMIN_EMAILS=huyrongbaoto@gmail.com,xuankien090103@gmail.com`
   - `FIREBASE_SERVICE_ACCOUNT` (Lưu ý copy cẩn thận toàn bộ chuỗi JSON, không xuống dòng).
   - `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.
5. Bấm **Deploy** và chờ Vercel chạy xong.
6. Sau khi Deploy thành công, Vercel sẽ cấp cho bạn một đường link (Ví dụ: `https://hl-mck-api.vercel.app`). **Hãy copy lại đường link này để dùng cho Bước 3.**

---

### BƯỚC 3: CẤU HÌNH LIÊN KẾT CHO FRONTEND
Frontend cần biết phải gọi API tới đâu. Thư mục Frontend đã có sẵn file `vercel.json` để thực hiện việc này.

1. Trên máy tính của bạn, mở file `src/web-admin/frontend/vercel.json`.
2. Tìm dòng có ghi `<BACKEND_URL_CUA_BAN>`.
3. Thay thế bằng cái link Vercel Backend bạn vừa copy ở Bước 2.
   *(Ví dụ: `"destination": "https://hl-mck-api.vercel.app/api/$1"`)*
4. Lưu file lại và **Commit / Push** code này lên Github.

---

### BƯỚC 4: DEPLOY FRONTEND (WEB GIAO DIỆN)
1. Quay lại Vercel Dashboard, tiếp tục bấm **Add New... -> Project**.
2. Import lại Repository Github của bạn một lần nữa.
3. Trong màn hình cấu hình:
   - **Project Name:** `hl-mck-web` (hoặc tên tuỳ ý).
   - **Framework Preset:** Chọn `Vite`.
   - **Root Directory:** Bấm nút *Edit*, chọn thư mục `src/web-admin/frontend`.
   - **Build Command:** `npm run build`
4. Ở phần **Environment Variables**, bạn không cần thêm gì cả (hoặc nếu có dùng biến nào bên Vite thì thêm vào).
5. Bấm **Deploy**.

🎉 **HOÀN TẤT!** 
Khi Vercel báo thành công, bạn sẽ nhận được một đường link cho Frontend (Ví dụ: `https://hl-mck-web.vercel.app`). 

> **Lưu ý cuối cùng:** Đừng quên vào lại Vercel của Backend (Bước 2), sửa biến môi trường `VITE_WEB_URL` thành link Frontend thực tế của bạn (Ví dụ: `https://hl-mck-web.vercel.app`) để cổng thanh toán PayOS biết đường quay lại Web sau khi khách chuyển khoản xong nhé!
