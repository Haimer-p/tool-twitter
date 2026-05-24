# Twitter/X Auto Engagement Tool

Tool tự động tương tác Twitter/X qua Puppeteer: tìm bài viết theo keyword, like / retweet / reply / follow, hoặc chế độ **Airdrop Hunter** (tự comment địa chỉ ví). Hỗ trợ **nhiều tài khoản chạy song song**, mỗi account có **mode và keyword riêng**, AI **Gemini + DeepSeek** (fallback).

---

## Tính năng chính

| Tính năng | Mô tả |
|-----------|--------|
| **Engage** | Like, retweet, reply (AI), follow ngẫu nhiên theo tỷ lệ |
| **Airdrop Hunter** | Tìm bài yêu cầu ví → like + RT + comment địa chỉ EVM/Solana |
| **Multi-account** | Chạy song song nhiều account (mỗi account = 1 browser) |
| **Profile riêng** | Mỗi account: `mode`, `keywords`, `useAi`, `engageOnReply` |
| **AI kép** | Gemini hoặc DeepSeek; lỗi thì tự chuyển sang provider còn lại |
| **Dashboard** | Theo dõi stats, activity log, start/stop bot |

---

## Yêu cầu

- **Node.js 18+**
- **MongoDB Atlas** (M0 free): [cloud.mongodb.com](https://cloud.mongodb.com)
- **Ít nhất một AI key** (khi dùng chế độ AI):
  - [Gemini API](https://aistudio.google.com/app/apikey)
  - [DeepSeek API](https://platform.deepseek.com/api_keys)
- Tài khoản Twitter/X (đăng nhập thủ công lần đầu, lưu cookies)

---

## Cài đặt

```bash
git clone <repo-url>
cd tool-twitter
npm install
cp .env.example .env
```

Chỉnh file `.env` (xem mục [Cấu hình](#cấu-hình-env) bên dưới).

**MongoDB Atlas:** vào **Network Access** → thêm IP máy bạn (hoặc `0.0.0.0/0` khi dev).

---

## Chạy nhanh

```bash
npm start
```

1. Nhập tên account: `account1,account2` hoặc `all`
2. Chọn chế độ mặc định (nếu chưa có `accounts.config.json`)
3. Chọn lịch: chạy ngay / cron / một lần
4. Mở dashboard: **http://localhost:3000** (user/pass trong `.env`)

**Lần đầu mỗi account:** browser mở → đăng nhập Twitter/X thủ công → nhấn Enter trong terminal → cookies lưu vào `accounts/<tên>.json`.

---

## Hai chế độ bot

### 1. Engage (cũ)

- Search keyword → random **like / retweet / reply / follow**
- Reply dùng AI (Gemini/DeepSeek)
- Có unfollow sau vài ngày nếu không follow-back

### 2. Airdrop Hunter

- Search keyword (mặc định: `airdrop`, `crypto airdrop`, …)
- Đọc nội dung tweet → phát hiện yêu cầu ví:
  - **EVM** (`evm address`, `env address`, `metamask`, …)
  - **Solana** (`phantom wallet`, `sol wallet`, …)
  - **Mơ hồ** (chỉ nói "drop wallet") → xử lý cả hai loại
- Trên mỗi bài (nếu bật engage):
  1. Like
  2. Retweet
  3. Follow author (nếu `followOnReply`)
  4. Comment địa chỉ ví

**Phương án comment Airdrop:**

| Phương án | Hành vi |
|-----------|---------|
| **Rule** | Comment thẳng địa chỉ ví (ngắn, ≤100 ký tự) |
| **AI** | Gemini/DeepSeek viết comment ngắn có kèm ví |

**Rule mode — số comment:**

| Phát hiện | Comment |
|-----------|---------|
| Chỉ EVM | 1 comment địa chỉ EVM |
| Chỉ Solana | 1 comment địa chỉ Solana |
| Mơ hồ (`both`) | **2 comment riêng**: EVM → delay → Solana |

**Cả Rule lẫn AI — `both`:** **2 comment riêng** (EVM → chờ ~3–8 giây → Solana).

---

## Nhiều account + cấu hình riêng

### Cookies (bắt buộc)

Mỗi account một file:

```
accounts/
  account1.json      ← cookies sau khi login
  account2.json
  accounts.config.json   ← cấu hình mode/keywords (khuyến nghị)
```

### File `accounts/accounts.config.json`

Copy từ mẫu:

```bash
cp accounts/accounts.config.example.json accounts/accounts.config.json
```

Ví dụ:

```json
{
  "maxParallel": 3,
  "accounts": [
    {
      "name": "account1",
      "enabled": true,
      "mode": "airdrop",
      "useAi": false,
      "engageOnReply": true,
      "keywords": ["airdrop", "crypto airdrop"]
    },
    {
      "name": "account2",
      "enabled": true,
      "mode": "engage",
      "useAi": true,
      "keywords": ["web3", "defi"]
    }
  ]
}
```

| Field | Ý nghĩa |
|-------|---------|
| `name` | Trùng tên file cookie (không `.json`) |
| `enabled` | `false` = bỏ qua account |
| `mode` | `engage` hoặc `airdrop` |
| `useAi` | `true` = dùng AI cho reply (Airdrop/Engage) |
| `engageOnReply` | Airdrop: like + RT trước khi comment (`true`/`false`) |
| `followOnReply` | Airdrop: follow author bài viết (`true`/`false`) |
| `minFollowersToFollow` | Chỉ follow khi author có **>=** số followers này (mặc định `1000`, `0` = tắt lọc) |
| `keywords` | Keyword search riêng cho account |
| `maxParallel` | Số account chạy song song tối đa |

Khi chạy CLI, nhập `all` để chạy tất cả account `enabled` trong file config.

---

## Cấu hình `.env`

```env
# AI — cần ít nhất 1 key nếu dùng chế độ AI
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
AI_PRIMARY=gemini          # gemini | deepseek (thử trước, lỗi thì fallback)

# MongoDB
MONGODB_URI=mongodb+srv://...

# Dashboard
DASHBOARD_PORT=3000
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=admin123

# Browser
BROWSER_HEADLESS=false
# PROXY_SERVER=host:port

# Multi-account
MAX_PARALLEL_ACCOUNTS=3

# Airdrop
AIRDROP_ENGAGE_ON_REPLY=true    # like + RT trước comment
AIRDROP_FOLLOW_ON_REPLY=true    # follow author
MIN_FOLLOWERS_TO_FOLLOW=1000   # chỉ follow author có >= số followers này
EVM_WALLET_ADDRESS=0x...
SOLANA_WALLET_ADDRESS=...
```

**Lưu ý AI:**

- `AI_PRIMARY=gemini` → thử Gemini trước, lỗi thì DeepSeek
- `AI_PRIMARY=deepseek` → ưu tiên DeepSeek
- Chế độ **Rule** (Airdrop) không cần AI key

---

## Dashboard

URL: `http://localhost:<DASHBOARD_PORT>`

- Xem likes, retweets, replies, follows
- Activity log theo account
- **Tải profiles** — đọc `accounts.config.json`
- **Chạy tất cả (song song)** — start bot theo config
- **Dừng bot** — dừng mọi account đang chạy

Đăng nhập Basic Auth: `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.

---

## Scripts

| Lệnh | Mô tả |
|------|--------|
| `npm start` | Chạy bot + dashboard |
| `npm run dev` | Chạy với nodemon (tự reload) |
| `npm test` | Unit test |
| `npm run verify` | Kiểm tra cấu hình |
| `npm run check-stats` | Xem thống kê DB |
| `npm run repair-stats` | Sửa stats từ activity log |
| `npm run kill-ports` | Giải phóng port dashboard (Windows) |

---

## Cấu trúc thư mục

```
tool-twitter/
├── accounts/              # Cookies + accounts.config.json
├── config.js              # Delay, ratio, keywords, airdrop rules
├── src/
│   ├── index.js           # Entry, CLI, orchestration
│   ├── engage.js          # Like, RT, reply, follow
│   ├── airdropBot.js      # Airdrop Hunter
│   ├── accountRunner.js   # Chạy parallel multi-account
│   ├── accountProfiles.js # Đọc accounts.config.json
│   ├── walletMatcher.js   # Phân loại EVM / Solana / both
│   ├── ai.js              # Gemini + DeepSeek fallback
│   ├── browser.js         # Puppeteer stealth
│   ├── auth.js            # Cookies đa tài khoản
│   ├── database.js        # MongoDB
│   └── dashboard.js       # Web UI
├── public/dashboard.html
└── logs/bot.log
```

---

## Giới hạn & delay mặc định

Chỉnh trong `config.js`:

- `maxPerDay` — tối đa tương tác/ngày/account
- `maxPerAccountPerRun` — tối đa mỗi lần chạy
- `betweenActions` — delay giữa các hành động (~90–180s)
- `betweenAccounts` — delay khi chạy tuần tự (parallel thì không dùng)

Khuyến nghị: `MAX_PARALLEL_ACCOUNTS=2` hoặc `3` trên máy thường.

---

## Luồng hoạt động (Airdrop)

```
Search keyword
    → Mở từng tweet
    → Phân loại ví (EVM / Solana / both / skip)
    → Like + Retweet + Follow author (1 lần/bài)
    → Comment ví (Rule hoặc AI)
    → Lưu MongoDB (tránh comment trùng)
```

---

## Xử lý lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| MongoDB `ECONNREFUSED` / SSL | Whitelist IP trên Atlas, kiểm tra `MONGODB_URI` |
| Gemini model không tồn tại | Dùng `GEMINI_MODEL=gemini-2.5-flash` |
| DeepSeek auth fail | Kiểm tra key tại platform.deepseek.com |
| Port 3000 đã dùng | Đổi `DASHBOARD_PORT` hoặc `npm run kill-ports` |
| Cookies hết hạn | Xóa `accounts/<name>.json`, chạy lại và login lại |
| Comment trùng bị skip | Bình thường — DB dedup theo tweet + account + loại ví |

---

## Lưu ý quan trọng

- Tool dùng automation trình duyệt, **có rủi ro** bị Twitter/X giới hạn hoặc khóa tài khoản.
- Không chạy 24/7; giữ delay hợp lý.
- Tuân thủ [Điều khoản X/Twitter](https://x.com/en/tos).
- **Không commit** file `.env` hoặc `accounts/*.json` (chứa key/cookies).

---

## License

MIT
