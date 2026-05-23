# Twitter/X Auto Engagement Tool

Tool tự động tương tác Twitter/X: **like, retweet, reply (AI), follow**, hỗ trợ **nhiều account chạy song song**, **combo hành động**, AI **Gemini + DeepSeek** luân phiên, dashboard theo dõi qua MongoDB Atlas.

---

## Mục lục

1. [Yêu cầu](#yêu-cầu)
2. [Cài đặt lần đầu](#cài-đặt-lần-đầu)
3. [Cấu hình `.env`](#cấu-hình-env)
4. [Thêm account Twitter mới](#thêm-account-twitter-mới)
5. [Cấu hình `accounts.config.json`](#cấu-hình-accountsconfigjson)
6. [Chạy bot](#chạy-bot)
7. [Combo actions](#combo-actions)
8. [AI (Gemini / DeepSeek)](#ai-gemini--deepseek)
9. [Dashboard](#dashboard)
10. [Lệnh npm hữu ích](#lệnh-npm-hữu-ích)
11. [Cấu trúc thư mục](#cấu-trúc-thư-mục)
12. [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)
13. [Lưu ý an toàn](#lưu-ý-an-toàn)

---

## Yêu cầu

- **Node.js** 18+ (khuyến nghị 20+)
- **Google Chrome** (Puppeteer dùng Chrome hệ thống)
- **Gemini API key** và/hoặc **DeepSeek API key** (ít nhất một cái)
- **MongoDB Atlas** cluster M0 (free): [cloud.mongodb.com](https://cloud.mongodb.com)

---

## Cài đặt lần đầu

```bash
# Clone / mở project, rồi:
npm install

# Tạo file môi trường
copy .env.example .env
```

Chỉnh file `.env` (xem mục dưới).

**MongoDB Atlas — bắt buộc:**

1. Tạo cluster → Database → Connect → Drivers → copy connection string.
2. **Network Access** → Add IP Address → thêm IP máy bạn (hoặc `0.0.0.0/0` khi dev).
3. Dán vào `MONGODB_URI` trong `.env`.

**Tạo file cấu hình account:**

```bash
copy accounts.config.example.json accounts.config.json
```

Chỉnh `accounts.config.json` theo account của bạn (mục [Cấu hình accounts.config.json](#cấu-hình-accountsconfigjson)).

---

## Cấu hình `.env`

| Biến | Mô tả |
|------|--------|
| `GEMINI_API_KEY` | Key Gemini: [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| `GEMINI_MODEL` | Mặc định `gemini-2.5-flash` |
| `DEEPSEEK_API_KEY` | Key DeepSeek: [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| `DEEPSEEK_MODEL` | Mặc định `deepseek-chat` |
| `AI_STRATEGY` | `alternate` \| `gemini` \| `deepseek` |
| `MONGODB_URI` | Connection string Atlas |
| `DASHBOARD_PORT` | Cổng dashboard (vd: `3001`) |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Đăng nhập dashboard |
| `BROWSER_HEADLESS` | `false` = thấy Chrome (khuyến nghị khi login) |
| `MAX_PARALLEL_ACCOUNTS` | Ghi đè `maxConcurrent` trong JSON (tùy chọn) |

**AI:** Cần **ít nhất một** trong `GEMINI_API_KEY` hoặc `DEEPSEEK_API_KEY`.

**`AI_STRATEGY=alternate`:** Reply lẻ dùng Gemini, reply chẵn dùng DeepSeek (và ngược lại nếu một bên lỗi).

---

## Thêm account Twitter mới

Mỗi account = **1 file cookies** trong `accounts/` + **1 block** trong `accounts.config.json`.

### Bước 1 — Đăng nhập và lưu cookies

```bash
npm run login -- ten_account
```

Ví dụ:

```bash
npm run login -- acc2
```

Hoặc:

```bash
npm run login
```

(rồi nhập tên khi được hỏi)

**Trong cửa sổ Chrome:**

1. Đăng nhập X/Twitter bình thường (mật khẩu, 2FA…).
2. Đợi vào trang Home.
3. Quay terminal → nhấn **Enter** khi thấy: `Press Enter after login is complete`.

Cookies lưu tại: `accounts/ten_account.json`

> Tên account có **dấu cách** vẫn được (vd: `acc nhattan` → file `accounts/acc nhattan.json`).

### Bước 2 — Khai báo trong `accounts.config.json`

Mở `accounts.config.json`, thêm vào mảng `"accounts"`:

```json
{
  "name": "acc2",
  "enabled": true,
  "keywords": ["crypto", "bitcoin", "defi"]
}
```

- **`name`** phải **trùng** tên lúc `npm run login`.
- **`enabled: false`** → bot bỏ qua account đó.

### Cookie hết hạn

Chạy lại:

```bash
npm run login -- ten_account
```

---

## Cấu hình `accounts.config.json`

File chính điều khiển **account nào chạy**, **keyword**, **delay**, **giới hạn**, **combo**.

```json
{
  "parallel": {
    "maxConcurrent": 2
  },
  "defaults": {
    "keywords": ["crypto", "web3", "..."],
    "delays": {
      "betweenActions": { "min": 90000, "max": 180000 },
      "betweenSearchRounds": { "min": 600000, "max": 900000 }
    },
    "interactions": {
      "maxPerDay": 50,
      "maxPerAccountPerRun": 15,
      "keywordsPerRun": 6,
      "tweetsPerKeyword": 8,
      "comboRatios": { ... }
    }
  },
  "accounts": [
    {
      "name": "acctest1",
      "enabled": true,
      "keywords": ["solana", "memecoin"],
      "delays": {
        "betweenActions": { "min": 60000, "max": 120000 }
      },
      "interactions": {
        "maxPerDay": 30,
        "maxPerAccountPerRun": 10
      }
    }
  ]
}
```

### Giải thích các trường

| Trường | Ý nghĩa |
|--------|---------|
| `parallel.maxConcurrent` | Số Chrome chạy **cùng lúc** (mỗi account 1 Chrome) |
| `defaults` | Giá trị mặc định cho mọi account (account có thể ghi đè) |
| `accounts[].name` | Tên account = tên file `accounts/{name}.json` |
| `accounts[].enabled` | `true` mới chạy |
| `accounts[].keywords` | Từ khóa search riêng cho account |
| `delays.betweenActions` | Chờ giữa mỗi tweet (ms): min–max random |
| `delays.betweenSearchRounds` | Chờ giữa các vòng search keyword (ms) |
| `interactions.maxPerDay` | Tối đa tương tác/ngày/account |
| `interactions.maxPerAccountPerRun` | Tối đa mỗi lần chạy bot |
| `interactions.keywordsPerRun` | Số keyword random mỗi lần chạy |
| `interactions.tweetsPerKeyword` | Số tweet tối đa mỗi keyword |
| `interactions.followMinFollowers` | Follow chỉ khi user đủ followers (0 = tắt) |
| `interactions.followMaxFollowers` | Bỏ qua user quá nhiều followers (0 = không giới hạn) |

**Delay (ms):** `90000` = 90 giây, `600000` = 10 phút.

Mẫu đầy đủ: `accounts.config.example.json`.

---

## Chạy bot

### 1. Test AI (khuyến nghị trước khi chạy)

```bash
npm run test:ai
```

### 2. Khởi động bot

```bash
npm start
```

hoặc dev (tự restart khi sửa code):

```bash
npm run dev
```

Bot đọc `accounts.config.json` → in số account và `maxConcurrent`.

**Chọn lịch:**

| Lựa chọn | Ý nghĩa |
|----------|---------|
| `1` | Chạy ngay một lần |
| `2` | Cron (vd `0 */6 * * *` = 6 giờ/lần) + chạy ngay lần đầu |
| `3` | Chạy một lần rồi thoát vòng bot (dashboard vẫn chạy) |

### Chạy song song nhiều account

- `maxConcurrent: 2` → tối đa **2 Chrome** cùng lúc.
- Account thứ 3+ xếp hàng, chạy khi có slot trống.
- Mỗi account dùng **keyword / delay riêng** trong JSON.

**RAM:** Mỗi Chrome ~300–500MB. Máy yếu → đặt `maxConcurrent: 1`.

### Không có `accounts.config.json`

Bot hỏi tên account qua CLI (cách cũ). Nên dùng file JSON để quản lý nhiều account.

---

## Combo actions

Mỗi tweet bot chọn **một combo** theo tỷ lệ `comboRatios`:

| Key | Hành vi |
|-----|---------|
| `like` | Chỉ like |
| `retweet` | Chỉ retweet |
| `reply` | Chỉ comment (AI) |
| `follow` | Chỉ follow |
| `like_retweet` | Like → Retweet |
| `like_reply` | Like → Comment AI |
| `like_retweet_reply` | Like → Retweet → Comment AI |
| `like_follow` | Like → Follow (có lọc follower) |
| `like_retweet_follow` | Like → RT → Follow |

Tổng các giá trị trong `comboRatios` nên = **1.0**.

Combo chạy trên **cùng một trang tweet** (không reload lại). Mỗi action thành công = +1 vào thống kê (like+RT = 2). **Follow** luôn chạy sau các action trên tweet, bot mở profile author để kiểm tra follower.

Chỉnh trong `defaults.interactions.comboRatios` hoặc ghi đè trong từng account.

### Lọc follow theo số followers

Trong `interactions` (defaults hoặc từng account):

```json
"followMinFollowers": 500,
"followMaxFollowers": 0
```

| Trường | Ý nghĩa |
|--------|---------|
| `followMinFollowers` | Chỉ follow nếu user có **≥** số followers này (`0` = tắt lọc) |
| `followMaxFollowers` | Bỏ qua nếu user có **>** số này (`0` = không giới hạn trên) |

Hoặc trong `.env` (áp dụng global qua `config.js`):

```env
FOLLOW_MIN_FOLLOWERS=500
FOLLOW_MAX_FOLLOWERS=0
```

Account có thể ghi đè riêng, ví dụ account farm meme chỉ follow người có ≥ 1000 followers:

```json
"interactions": {
  "followMinFollowers": 1000,
  "maxPerDay": 30
}
```

Log khi bỏ qua: `Skip follow @user: 120 followers < min 500`

---

## AI (Gemini / DeepSeek)

- Reply tự động dùng AI khi combo có `reply` hoặc `like_reply`, `like_retweet_reply`.
- `AI_STRATEGY=alternate`: luân phiên Gemini ↔ DeepSeek mỗi reply.
- Nếu provider chính lỗi → thử provider còn lại → cuối cùng dùng câu fallback.

Log khi chạy:

```text
AI providers this reply: gemini → deepseek
AI reply via Gemini (gemini-2.5-flash)
```

---

## Dashboard

Sau khi `npm start`, mở:

```text
http://localhost:<DASHBOARD_PORT>
```

Mặc định trong `.env.example` là `3000`; nếu bạn đặt `DASHBOARD_PORT=3001` thì dùng cổng đó.

**Đăng nhập:** user/pass trong `.env` (`DASHBOARD_USER` / `DASHBOARD_PASSWORD`).

**Thao tác:**

1. Nhập user/pass → **「Lưu đăng nhập & tải dữ liệu」**
2. Xem thống kê like / RT / reply / follow
3. **「Chạy bot」** / **「Dừng bot」** (gửi lệnh start/stop qua API)

**API (Basic Auth):**

| Endpoint | Mô tả |
|----------|--------|
| `GET /api/stats` | Thống kê |
| `GET /api/activities` | Log hoạt động |
| `GET /api/accounts` | Danh sách file cookies |
| `GET /api/account-config` | Nội dung `accounts.config.json` |
| `POST /api/control/start` | Bắt đầu bot (body: `{ "accountNames": ["acc1"] }` tùy chọn) |
| `POST /api/control/stop` | Dừng bot |

### Port bị chiếm

```bash
npm run kill-ports
```

---

## Lệnh npm hữu ích

| Lệnh | Mô tả |
|------|--------|
| `npm start` | Chạy bot + dashboard |
| `npm run dev` | Chạy với nodemon (watch `src/`) |
| `npm run login -- <tên>` | Đăng nhập account mới / refresh cookie |
| `npm run test:ai` | Test Gemini + DeepSeek |
| `npm test` | Unit test |
| `npm run verify` | Kiểm tra module load |
| `npm run check-stats` | Xem stats MongoDB |
| `npm run repair-stats` | Sửa stats bị lệch |
| `npm run kill-ports` | Giải phóng port dashboard (Windows) |

---

## Cấu trúc thư mục

```text
tool-farm-twitter/
├── accounts/                 # Cookies từng account (*.json) — không commit
├── accounts.config.json      # Cấu hình account, keyword, delay (của bạn)
├── accounts.config.example.json
├── .env                      # API keys, MongoDB — không commit
├── config.js                 # Default global
├── src/
│   ├── index.js              # Entry, schedule, orchestration
│   ├── accountConfig.js      # Đọc accounts.config.json
│   ├── engage.js             # Bot: search, combo, parallel
│   ├── auth.js               # Login / cookies
│   ├── ai.js                 # Gemini + DeepSeek
│   ├── browser.js            # Puppeteer
│   ├── database.js           # MongoDB
│   └── dashboard.js          # Web UI + API
├── public/dashboard.html
└── scripts/
    ├── login-account.js      # npm run login
    └── test-ai.js            # npm run test:ai
```

---

## Xử lý lỗi thường gặp

| Triệu chứng | Cách xử lý |
|-------------|------------|
| `GEMINI_API_KEY` / `DEEPSEEK` required | Thêm ít nhất một key vào `.env` |
| MongoDB SSL / timeout | Kiểm tra IP whitelist Atlas, `MONGODB_URI` đúng |
| Login failed / cookie expired | `npm run login -- ten_account` |
| Chrome đóng giữa chừng (dev) | Nodemon chỉ watch `src/`; không sửa file trong `accounts/` khi đang chạy |
| Port `EADDRINUSE` | `npm run kill-ports` hoặc đổi `DASHBOARD_PORT` |
| Stats dashboard = 0 | Bấm **Lưu đăng nhập & tải dữ liệu**; hoặc `npm run repair-stats` |
| Gemini 404 model | Dùng `GEMINI_MODEL=gemini-2.5-flash` trong `.env` |
| Account không chạy | Kiểm tra `enabled: true` và có file `accounts/{name}.json` |

---

## Lưu ý an toàn

- Dùng **delay** hợp lý; tránh spam quá nhanh.
- Không chạy 24/7 liên tục nếu không cần — giảm rủi ro khóa account.
- Tuân thủ **Điều khoản dịch vụ** của X/Twitter.
- **Không commit** `.env`, `accounts/*.json` (đã có trong `.gitignore`).
- Đổi password/API key nếu từng lộ trong chat hoặc log.

---

## Quy trình nhanh (cheat sheet)

```bash
# Lần đầu
npm install
copy .env.example .env          # chỉnh key + MongoDB
copy accounts.config.example.json accounts.config.json

# Thêm account mới
npm run login -- acc_moi
# → sửa accounts.config.json thêm block account

# Test & chạy
npm run test:ai
npm start
# → chọn 1 / 2 / 3
# → mở http://localhost:<DASHBOARD_PORT>
```
