# Twitter/X Auto Engagement Tool

Tool tự động tương tác Twitter/X (like, retweet, reply, follow) với Gemini AI và MongoDB Atlas.

## Yêu cầu

- Node.js 18+
- [Gemini API key](https://aistudio.google.com/app/apikey)
- [MongoDB Atlas](https://cloud.mongodb.com) cluster M0 (free)

## Cài đặt

```bash
npm install
cp .env.example .env
```

Chỉnh `.env`:

- `GEMINI_API_KEY`
- `MONGODB_URI` (connection string Atlas)
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` (tùy chọn)

**Atlas:** Network Access → thêm IP máy bạn (hoặc `0.0.0.0/0` khi dev).

## Chạy

```bash
npm start
```

1. Nhập tên tài khoản (mỗi account một file cookies trong `accounts/`).
2. Lần đầu: đăng nhập Twitter thủ công trong browser, nhấn Enter.
3. Chọn lịch chạy (ngay / cron / một lần).

Dashboard: http://localhost:3000 (mặc định `admin` / `admin123`).

## Cấu trúc

- `src/browser.js` — Puppeteer + stealth
- `src/auth.js` — Cookies đa tài khoản
- `src/ai.js` — Gemini replies
- `src/engage.js` — Logic tương tác
- `src/database.js` — MongoDB
- `src/dashboard.js` — Express + Socket.IO

## Lưu ý

- Dùng delay hợp lý; tránh chạy 24/7 để giảm rủi ro khóa tài khoản.
- Tuân thủ điều khoản Twitter/X.
