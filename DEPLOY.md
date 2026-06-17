# Deploy Dashboard lên Vercel + Bot chạy local

## Kiến trúc

- **Dashboard (Vercel):** repo `control-spam-web` — quản lý account, campaign, gửi lệnh start/stop
- **MongoDB Atlas:** dữ liệu chung (accounts, campaigns, commands, stats)
- **Worker local:** `npm run worker` trong repo bot — poll lệnh từ DB, chạy Puppeteer

## Bước 1 — Migrate dữ liệu lên DB

```bash
npm run migrate-db
```

Import `accounts/*.json` và `configs/*.json` vào MongoDB.

## Bước 2 — Deploy Vercel

1. Push repo **control-spam-web** lên GitHub
2. [vercel.com](https://vercel.com) → New Project → import repo `control-spam-web`
3. Root Directory = project root (không cần subdirectory)
4. Thêm Environment Variables:
   - `MONGODB_URI`
   - `GEMINI_API_KEY` / `DEEPSEEK_API_KEY`
   - `COOKIE_ENCRYPTION_KEY`
   - `DASHBOARD_USER` / `DASHBOARD_PASSWORD`

## Bước 3 — Chạy worker trên máy local

```bash
# .env cần cùng MONGODB_URI + COOKIE_ENCRYPTION_KEY
npm run worker
```

Worker poll lệnh mỗi 4 giây. Trên dashboard Vercel → **Control** → chọn campaign/config → **Start**.

## Dev dashboard local

```bash
cd control-spam-web && npm install && npm run dev
```

Mở http://localhost:3000 — đăng nhập bằng `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.

## Luồng tạo token mới

1. Dashboard → **New Token** → paste link DexScreener
2. Chọn accounts (ưu tiên `alive` từ health check)
3. Chỉnh combo ratios → **Generate & Save**
4. **Control** → chọn campaign/config → Start (worker local phải đang chạy)
