# FPT Play Goals – Vercel + Neon Postgres

Bản chuyển hoàn toàn tool **FPT Play Goals** (Apps Script + Google Sheet) sang **Vercel (HTML/JS + Node Functions) + Neon Postgres + SMTP noreply**.
Giữ nguyên công thức **MSC_V2** (Must 8 · Should 1,5 · Could 0,5; chia đều trong nhóm; Hoàn thành/Không hoàn thành; xếp hạng A+…E + hệ số KPI) và toàn bộ lời văn email.

| Trang | URL | Ai dùng |
|---|---|---|
| Cổng Manager – đăng ký mục tiêu / báo cáo kết quả | `/` | Users có `Role = Manager` |
| Trang HR – tổng hợp, BĐH duyệt, xin sửa KH, Users, Kỳ KPI | `/hr` | Users có `isHR` |

## Đối chiếu với bản Apps Script

| Apps Script | Vercel |
|---|---|
| `requestManagerOtp / verifyManagerOtp / checkMyAccess / logoutManager` | `/api/auth` – ChallengeID, OTP 5 phút, 5 lần thử, chờ 60 giây, thông báo chung không lộ email; phiên 8 giờ lưu **cookie HttpOnly** (thay sessionStorage) |
| `getManagerWorkspace` | `GET /api/manager?action=workspace` |
| `saveManagerPlan / saveManagerResults` | `POST plan-save / result-save` – giữ **RequestID** (bấm lại không tạo bản trùng) + **baseVersionId** (chặn 2 nơi sửa đè), mỗi lần lưu = 1 dòng phiên bản mới |
| `LockService` | khóa dòng Postgres (`SELECT … FOR UPDATE`) + unique index (1 bản SUBMITTED / người / kỳ) |
| `sendMscMail_` (PENDING → PROCESSING → SENT/FAILED) | giữ nguyên cơ chế; lỗi mail không hủy bản nộp |
| `getManagerCcEmails_` (cột N) | `users.cc_emails` |
| `syncManagerSubmitStatus_` (SttSubPlan/SttSubResult) | không cần – trạng thái tính trực tiếp từ DB |
| `getHRManagerOverview` (+ cảnh báo đối soát) | `GET /api/hr?action=overview` |
| `exportManagerReportExcel` | `GET /api/hr?action=export` – XLSX 2 sheet **TongHop**, **ChiTietMucTieu** (chỉ kỳ RESULT hoặc CLOSED); thêm cột xếp hạng/hệ số và BĐH ở cuối |

**Tính năng mới:** BĐH duyệt từng mục tiêu (điểm BĐH tính lại theo MSC, email kết quả cho Manager), Manager xin sửa kế hoạch đã nộp → HR chấp thuận/từ chối, HR mở lại KH/BC, gửi lại email lỗi, quản trị Users & Kỳ KPI trên web, giao diện điện thoại.

## Cấu trúc
```
api/        auth.js · manager.js · hr.js · cron.js     (4 Vercel Functions)
lib/        msc.js (công thức) · goals.js (nghiệp vụ) · mail.js (mẫu email) · excel.js · auth.js · db.js · http.js
public/     index.html (Manager) · hr.html (HR) · assets/goals.js, hr.js, common.js, app.css
db/         schema.sql
scripts/    migrate · import-sheets · test-e2e (50 bước) · dev-local
```
Sửa người liên hệ FHR cuối email: đầu file `lib/mail.js` (`SUPPORT_PLAN`, `SUPPORT_RESULT`).

---

## Triển khai

1. **GitHub**: tạo repo private, push thư mục này.
2. **Vercel** → Add New → Project → chọn repo → Framework Preset **Other** → Deploy.
3. **Neon**: Project → Storage → Create Database → **Neon**, region **Singapore** → Connect (tự thêm `DATABASE_URL`).
4. **Environment Variables** (xem `.env.example`): `AUTH_SECRET`, `CRON_SECRET`, `ALLOWED_EMAIL_DOMAIN=fpt.com`, `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `APP_URL`, (tuỳ chọn) `HR_NOTIFY_EMAILS`.
5. **Tạo bảng + Admin** (máy có Node 20+):
   ```bash
   npm i -g vercel && vercel link && vercel env pull .env
   npm install
   npm run db:migrate -- --admin ten@fpt.com "Họ tên"
   ```
6. **Chuyển dữ liệu từ Sheet**: tải 4 tab thành CSV (File → Download → .csv), rồi:
   ```bash
   npm run import -- --periods KPIPeriods.csv --users Users.csv \
     --plans ManagerPlanVersions.csv --results ManagerResultVersions.csv --dry-run   # kiểm tra trước
   npm run import -- --periods KPIPeriods.csv --users Users.csv \
     --plans ManagerPlanVersions.csv --results ManagerResultVersions.csv
   ```
   Script đọc đúng tên cột như Code.gs, CC lấy cột N, giữ nguyên VersionID/RequestID, cảnh báo các dòng cần đối soát (JSON lỗi, nhiều bản SUBMITTED, email không có trong Users…).
7. **Redeploy**, mở `/hr` bằng email Admin → kiểm tra Users, Kỳ KPI → cho 1 Manager thử nộp.
8. Chạy song song với bản Apps Script 1 kỳ, đối chiếu file Excel, rồi tắt bản cũ.

## Chạy thử trên máy (không cần Neon / SMTP)
```bash
npm install
npm run dev:local    # http://localhost:3000 (Manager) · /hr (HR) – mã OTP in ra console
npm test             # 50 bước kiểm thử toàn luồng
```
Tài khoản mẫu: `mgr1@fpt.com`, `mgr2@fpt.com` (Manager), `admin@fpt.com` (isHR + Admin), `mgrhr@fpt.com` (Manager + isHR).

## Lưu ý
- **SMTP phải truy cập được từ Internet** (port 587/465 có xác thực). SMTP relay nội bộ chỉ mở trong mạng FPT sẽ không gửi được → toàn bộ OTP hỏng. Kiểm tra với IT trước khi chuyển.
- Vercel gói Hobby không dành cho mục đích thương mại → dùng gói **Pro** cho công cụ nội bộ công ty.
- Dữ liệu nhân sự lưu ở Neon (Singapore) – nên xin xác nhận IT/pháp chế (Nghị định 13/2023/NĐ-CP).
