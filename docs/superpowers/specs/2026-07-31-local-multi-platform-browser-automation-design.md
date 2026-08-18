# Local Multi-Platform Browser Automation — Tài liệu thiết kế

**Ngày:** 2026-07-31  
**Trạng thái:** Đã duyệt thiết kế tổng thể  
**Tên làm việc:** Local Social Workspace  
**Môi trường chạy:** Máy Windows local  
**Nền tảng mục tiêu:** Facebook, TikTok, YouTube  
**Công nghệ cốt lõi:** Next.js, Node.js, Playwright, MongoDB/Mongoose, Gemini

---

## 1. Mục tiêu

Xây dựng một ứng dụng mới, tách biệt khỏi `tool-farm-twitter`, nhưng tái sử dụng các kinh nghiệm và module phù hợp của ứng dụng hiện tại. Ứng dụng cho phép:

1. Tạo và quản lý nhiều browser profile độc lập.
2. Mở từng browser profile để người dùng đăng nhập Google, Facebook, TikTok và YouTube bằng tay.
3. Duy trì phiên đăng nhập giữa các lần chạy mà không lưu mật khẩu.
4. Gán một proxy cố định cho từng browser profile.
5. Tạo workflow chạy ngay hoặc theo lịch.
6. Tự động mở và xem nội dung theo URL, kênh, trang hoặc từ khóa.
7. Cho phép like, comment và reply tự động với giới hạn an toàn.
8. Sử dụng Gemini để tạo comment/reply phù hợp ngữ cảnh.
9. Lưu cấu hình, trạng thái, lịch sử và session backup đã mã hóa trong MongoDB.
10. Chạy hoàn toàn trên máy local, có dashboard để quản lý.

Ứng dụng không được thiết kế để cày view, tạo tương tác giả hàng loạt, vượt CAPTCHA, né checkpoint, xoay IP để vượt hạn chế hoặc tự động tạo tài khoản.

---

## 2. Phạm vi

### 2.1 Trong phạm vi

- Dashboard web chỉ chạy local.
- Browser profile dùng Chromium/Chrome persistent context.
- Đăng nhập tài khoản bằng tay.
- Lưu trạng thái đăng nhập trong thư mục profile local.
- Sao lưu phần session có thể xuất được vào MongoDB sau khi mã hóa.
- Proxy HTTP, HTTPS và SOCKS5 theo từng profile.
- Kiểm tra proxy trước khi chạy.
- Workflow xem nội dung, like, comment và reply.
- Gemini tạo nội dung theo caption, tiêu đề hoặc comment gốc.
- Scheduler, job queue, giới hạn chạy và kill switch.
- Adapter độc lập cho Facebook, TikTok và YouTube.
- Nhật ký, screenshot lỗi và thống kê.
- Health check session/proxy không tạo tương tác.
- Khả năng cấu hình số profile động theo tài nguyên máy.

### 2.2 Ngoài phạm vi

- Tự động tạo tài khoản Google hoặc tài khoản mạng xã hội.
- Lưu username/password hoặc mã 2FA.
- Giải CAPTCHA tự động.
- Né checkpoint, device verification hoặc account restriction.
- Thay đổi fingerprint ngẫu nhiên để che giấu automation.
- Proxy rotation nhằm vượt rate limit hoặc lệnh chặn.
- Cày view hoặc bảo đảm view được nền tảng tính.
- Tạo tương tác phối hợp hàng loạt.
- Chạy trên Vercel/cloud trong phiên bản đầu.
- Ứng dụng mobile.
- Điều khiển máy khác từ Internet.
- Cơ chế thanh toán, phân quyền nhiều tổ chức hoặc SaaS.

### 2.3 Nguyên tắc tuân thủ

- Chỉ dùng tài khoản và nội dung mà người vận hành có quyền quản lý.
- Người vận hành chịu trách nhiệm kiểm tra điều khoản của từng nền tảng.
- Automation không được cố tiếp tục khi nền tảng yêu cầu xác minh.
- Mọi giới hạn có một mức trần toàn hệ thống mà workflow không thể vượt.
- Proxy dùng để định tuyến kết nối ổn định và bảo vệ riêng tư, không dùng để né biện pháp chống lạm dụng.
- Hệ thống phải có chế độ `draft-only`, cho phép Gemini chỉ soạn nội dung mà không gửi.

---

## 3. Kiến trúc được chọn

### 3.1 Mô hình

Chọn kiến trúc **Local Web Dashboard + Local Worker**:

```text
┌──────────────────────────────────────────────────────────────┐
│ Next.js Dashboard — 127.0.0.1                               │
│ Profiles · Proxies · Accounts · Workflows · Jobs · Settings │
└─────────────────────────────┬────────────────────────────────┘
                              │ Local HTTP + Socket.IO/SSE
┌─────────────────────────────▼────────────────────────────────┐
│ Local API / Control Plane                                    │
│ Authentication · Validation · Scheduler · Job Queue          │
└─────────────────────────────┬────────────────────────────────┘
                              │ MongoDB lease-based jobs
┌─────────────────────────────▼────────────────────────────────┐
│ Node.js Worker                                               │
│ Profile lock · Playwright · Limits · Screenshots · Heartbeat │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
┌───────────────▼──────────────┐  ┌─────▼──────────────────────┐
│ Platform Adapters           │  │ Gemini Service             │
│ YouTube · Facebook · TikTok │  │ Prompt · moderation · cache│
└───────────────┬──────────────┘  └────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Browser Profiles trên ổ đĩa local + proxy cố định/profile   │
└──────────────────────────────────────────────────────────────┘

MongoDB lưu metadata, queue, logs, interactions và session backup mã hóa.
```

### 3.2 Lý do chọn

- Gần với mô hình dashboard + worker của ứng dụng hiện tại.
- UI và browser worker có thể khởi động/dừng độc lập.
- Worker bị lỗi không làm mất dashboard.
- Dễ thêm adapter nền tảng mới.
- Job lease trong MongoDB giúp chống chạy trùng.
- Có thể tăng số worker local sau này mà không đổi giao diện.
- Next.js phù hợp với dashboard nhiều màn hình hơn HTML SPA hiện tại.

### 3.3 Monorepo đề xuất

```text
local-social-workspace/
├─ apps/
│  ├─ dashboard/              # Next.js UI và local API
│  └─ worker/                 # Playwright worker
├─ packages/
│  ├─ database/               # Mongoose schemas và repositories
│  ├─ browser/                # Profile, proxy, session, profile lock
│  ├─ job-engine/             # Scheduler, lease, state machine, limits
│  ├─ platforms/
│  │  ├─ core/                # Interface và lỗi dùng chung
│  │  ├─ youtube/
│  │  ├─ facebook/
│  │  └─ tiktok/
│  ├─ ai/                     # Gemini, prompt, moderation, key pool
│  ├─ security/               # AES-256-GCM, secret redaction
│  └─ shared/                 # Types, validation, constants
├─ profiles/                  # Chromium userDataDir; gitignored
├─ artifacts/                 # Screenshot, report; gitignored
├─ logs/                      # Log local; gitignored
├─ scripts/
├─ docs/
├─ .env.example
├─ package.json
└─ pnpm-workspace.yaml
```

### 3.4 Process local

Phiên bản đầu gồm ba process:

1. `dashboard`: Next.js bind mặc định vào `127.0.0.1`.
2. `worker`: nhận job từ MongoDB và điều khiển browser.
3. `mongodb`: MongoDB local hoặc MongoDB Atlas do người dùng cấu hình.

Lệnh dev dự kiến:

```bash
pnpm install
pnpm dev
```

Lệnh production local dự kiến:

```bash
pnpm build
pnpm start
```

`pnpm start` phải khởi động dashboard và worker, theo dõi trạng thái process, xử lý `SIGINT/SIGTERM` và đóng browser an toàn.

---

## 4. Thành phần hệ thống

### 4.1 Dashboard

Trách nhiệm:

- Xác thực người dùng local.
- CRUD browser profile, proxy, workflow và AI template.
- Mở browser để đăng nhập thủ công.
- Tạo job chạy ngay.
- Hiển thị trạng thái worker và job theo thời gian thực.
- Dừng profile, dừng workflow hoặc dừng toàn hệ thống.
- Không bao giờ trả cookies, proxy password, khóa mã hóa hoặc Gemini key về trình duyệt.

Dashboard không trực tiếp chạy Playwright. Mọi lệnh điều khiển browser phải đi qua command/job queue.

### 4.2 Local API / Control Plane

Trách nhiệm:

- Validate request bằng schema dùng chung.
- Kiểm tra hard limit trước khi tạo job.
- Quản lý scheduler.
- Cấp command cho worker.
- Tổng hợp dashboard statistics.
- Redact dữ liệu nhạy cảm.
- Ghi audit log cho hành động quản trị.

### 4.3 Worker

Trách nhiệm:

- Gửi heartbeat.
- Lease một job phù hợp với capacity.
- Lock browser profile.
- Kiểm tra kill switch, proxy, session và limits.
- Mở persistent browser context.
- Gọi platform adapter.
- Gọi Gemini khi cần.
- Cập nhật tiến độ, interaction và artifact.
- Đóng browser và giải phóng lock trong `finally`.

### 4.4 Browser package

Trách nhiệm:

- Chuẩn hóa đường dẫn `userDataDir`.
- Tạo profile directory.
- Quản lý file lock.
- Khởi chạy Playwright persistent context.
- Cấu hình proxy trước khi launch.
- Kiểm tra profile đang bị process khác sử dụng.
- Xuất session backup trong giới hạn Playwright hỗ trợ.
- Không sửa trực tiếp file nội bộ của Chromium khi browser đang chạy.

### 4.5 Platform adapters

Mỗi nền tảng triển khai cùng một contract:

```ts
interface PlatformAdapter {
  readonly platform: 'youtube' | 'facebook' | 'tiktok';
  validateSession(context: AdapterContext): Promise<SessionCheckResult>;
  discoverContent(input: ContentSource, context: AdapterContext): Promise<ContentItem[]>;
  openContent(item: ContentItem, context: AdapterContext): Promise<OpenedContent>;
  watch(item: OpenedContent, options: WatchOptions, context: AdapterContext): Promise<ActionResult>;
  like(item: OpenedContent, context: AdapterContext): Promise<ActionResult>;
  comment(item: OpenedContent, text: string, context: AdapterContext): Promise<ActionResult>;
  reply(target: ReplyTarget, text: string, context: AdapterContext): Promise<ActionResult>;
  detectRestriction(context: AdapterContext): Promise<RestrictionResult>;
  captureEvidence(context: AdapterContext): Promise<ArtifactRef>;
}
```

Quy tắc:

- Adapter không tự chọn hạn mức.
- Adapter không tự retry restriction.
- Adapter không truy cập trực tiếp MongoDB; dùng service/repository được truyền vào.
- Selector và logic riêng nền tảng không được đưa vào worker core.
- Mọi action phải trả kết quả có mã lỗi chuẩn hóa.

### 4.6 AI package

Trách nhiệm:

- Quản lý Gemini key pool.
- Chọn model chính và model fallback.
- Xây prompt từ template và context đã làm sạch.
- Giới hạn độ dài input/output.
- Kiểm tra duplicate, từ cấm, link, mention và ngôn ngữ.
- Hỗ trợ `draft-only`, `auto-approved` và `manual-review`.
- Cache theo hash để tránh gọi Gemini lại cho cùng context.
- Lưu usage metadata, không lưu API key.

### 4.7 Job engine

Trách nhiệm:

- Scheduler.
- Job state machine.
- Lease và heartbeat.
- Retry policy.
- Profile lock.
- Global/profile/workflow limits.
- Circuit breaker theo adapter.
- Kill switch.

---

## 5. Browser profile và session

### 5.1 Nguồn dữ liệu session

Mỗi profile có một thư mục Chromium riêng:

```text
profiles/<profile-id>/
```

Thư mục này là nguồn dữ liệu chính cho phiên đăng nhập. Không dùng chung `userDataDir` giữa hai profile.

MongoDB chỉ lưu:

- Metadata profile.
- Trạng thái đăng nhập gần nhất.
- Bản sao cookies/storage state có thể xuất được sau khi mã hóa.
- Thông tin phiên bản backup.

MongoDB không lưu toàn bộ thư mục Chromium vì:

- Kích thước lớn.
- Nhiều file lock và file nhị phân thay đổi liên tục.
- Khôi phục giữa các phiên bản Chrome không bảo đảm.
- Một số Google session có thể gắn với thiết bị hoặc browser state ngoài cookies.

Session backup không được cam kết khôi phục hoàn toàn Google login. Khi Google yêu cầu xác minh, hệ thống phải yêu cầu đăng nhập thủ công.

### 5.2 Luồng tạo profile

1. Người dùng nhập tên profile.
2. API tạo bản ghi `BrowserProfile`.
3. Worker tạo thư mục `profiles/<id>`.
4. Có thể gán proxy trước khi mở lần đầu.
5. Người dùng nhấn **Mở để đăng nhập**.
6. Worker lock profile và mở browser có giao diện.
7. Người dùng tự đăng nhập Google và các nền tảng.
8. Người dùng đóng browser hoặc nhấn **Hoàn tất đăng nhập**.
9. Worker kiểm tra các domain đã đăng nhập.
10. Worker cập nhật `PlatformAccount`.
11. Worker xuất session backup, mã hóa và ghi MongoDB.

### 5.3 Luồng mở profile

Trước khi launch:

1. Kiểm tra kill switch.
2. Kiểm tra profile không bị khóa.
3. Kiểm tra thư mục profile tồn tại và thuộc đúng profile ID.
4. Kiểm tra proxy health.
5. Tạo lock có PID, worker ID và thời gian hết hạn.
6. Launch persistent context.
7. Xác nhận browser process hoạt động.

Khi đóng:

1. Chờ action hiện tại kết thúc trong thời gian giới hạn.
2. Đóng page/context/browser.
3. Xuất session backup nếu profile không ở trạng thái restriction.
4. Cập nhật `lastClosedAt`.
5. Giải phóng lock.

### 5.4 Profile lock

Lock phải tồn tại ở hai lớp:

- MongoDB lease: chống hai worker lease job cùng profile.
- Local file lock: chống hai process local mở cùng `userDataDir`.

Nếu một process chết:

- Mongo lease hết hạn nếu heartbeat không được gia hạn.
- File lock chỉ được dọn nếu PID không còn tồn tại và lock đã quá thời gian an toàn.
- Không được xóa lock chỉ vì người dùng nhấn retry.

### 5.5 Cấu hình browser

Cấu hình cho mỗi profile:

- Browser channel: Chromium mặc định; có thể chọn Chrome cài trên máy.
- Headless: mặc định `false`.
- Locale.
- Timezone theo khu vực thật của proxy/người dùng.
- Viewport.
- Download directory riêng.
- Permission allowlist.
- Proxy ID.

Không thay đổi ngẫu nhiên user agent, canvas, WebGL hoặc fingerprint. Không dùng stealth/evasion plugin trong phạm vi thiết kế này.

### 5.6 Đăng nhập và 2FA

- Luôn đăng nhập bằng tay.
- 2FA do người dùng nhập trực tiếp trong browser.
- Dashboard không được đọc hoặc lưu mã 2FA.
- Nếu phát hiện trang xác minh, job chuyển `blocked`.
- Người dùng có thể mở profile để xử lý rồi chạy health check lại.

---

## 6. Proxy

### 6.1 Mô hình gán proxy

- Một profile có tối đa một proxy đang hoạt động.
- Một proxy có thể được gán nhiều profile nhưng dashboard phải cảnh báo.
- Proxy không được tự đổi trong khi profile đang mở.
- Thay proxy yêu cầu xác nhận vì có thể kích hoạt kiểm tra đăng nhập.
- Khi proxy được yêu cầu, worker không được fallback sang IP thật.

### 6.2 Protocol

Hỗ trợ:

- HTTP
- HTTPS
- SOCKS5

Thuộc tính:

- Host
- Port
- Username tùy chọn
- Password tùy chọn
- Country/region do người dùng khai báo
- Last resolved IP
- Latency
- Health status

### 6.3 Proxy health check

Health check gồm:

1. Kiểm tra định dạng và DNS.
2. Kết nối qua proxy đến endpoint kiểm tra IP đã cấu hình.
3. Ghi public IP trả về.
4. Đo latency.
5. Phân loại `healthy`, `degraded`, `unreachable`, `auth_failed`.

Không log username/password. Endpoint kiểm tra IP phải có timeout và có thể cấu hình.

### 6.4 Hành vi khi proxy lỗi

- `auth_failed`: block job, không retry tự động.
- `unreachable`: retry kỹ thuật có backoff trong giới hạn.
- `degraded`: cho phép chạy nếu latency dưới hard threshold.
- IP thay đổi ngoài dự kiến: cảnh báo và yêu cầu xác nhận nếu cấu hình `requireStableIp=true`.
- Tuyệt đối không bỏ proxy để chạy bằng kết nối thật.

---

## 7. Workflow và job

### 7.1 Workflow

Workflow là cấu hình có thể tái sử dụng, gồm:

- Tên và mô tả.
- Platform.
- Danh sách profile.
- Content source.
- Action policy.
- Lịch.
- AI template.
- Limit policy.
- Error policy.
- Enabled/disabled.

### 7.2 Content source

Các loại nguồn:

- `urls`: danh sách URL cụ thể.
- `channel`: kênh/trang/profile do người dùng chỉ định.
- `keywords`: tìm kiếm theo từ khóa.
- `feed`: feed của profile, chỉ khi adapter hỗ trợ ổn định.

Content source phải có:

- Allowlist domain.
- Giới hạn số item mỗi lần khám phá.
- Tuổi tối đa của nội dung.
- Ngôn ngữ tùy chọn.
- Deduplication key.

### 7.3 Action policy

Các action:

- `watch`
- `like`
- `comment`
- `reply`

Mỗi action có:

- Enabled.
- Xác suất sau khi qua mọi limit.
- Số lượng tối đa theo phiên.
- Số lượng tối đa theo ngày.
- Khoảng nghỉ tối thiểu giữa hai action cùng loại.
- Điều kiện nội dung.

`watch` chỉ có nghĩa browser mở nội dung và phát/xem trong khoảng thời gian hợp lý. Hệ thống không cam kết nền tảng ghi nhận view.

### 7.4 Chế độ AI

- `draft-only`: tạo draft, không gửi.
- `manual-review`: chờ người dùng duyệt trên dashboard.
- `auto-approved`: tự gửi nếu moderation pass và còn hạn mức.

Mặc định ban đầu: `manual-review`. Người dùng có thể chọn `auto-approved` riêng từng workflow.

### 7.5 Lịch

Hỗ trợ:

- Chạy ngay.
- Chạy một lần tại thời điểm cụ thể.
- Chạy theo cron.
- Chạy trong time window.
- Chọn ngày trong tuần.

Scheduler dùng timezone được cấu hình rõ ràng. Mọi thời điểm lưu DB dưới UTC.

### 7.6 State machine

```text
queued
  ├─> leased
  │     ├─> running
  │     │     ├─> waiting_review
  │     │     │     ├─> running
  │     │     │     └─> cancelled
  │     │     ├─> completed
  │     │     ├─> failed
  │     │     ├─> blocked
  │     │     └─> cancelled
  │     └─> queued       (lease hết hạn trước khi bắt đầu)
  └─> cancelled
```

Ý nghĩa:

- `queued`: chờ worker.
- `leased`: worker đã nhận nhưng chưa mở browser.
- `running`: đang thực thi.
- `waiting_review`: chờ duyệt AI draft.
- `completed`: hoàn tất thành công.
- `failed`: lỗi kỹ thuật hoặc logic.
- `blocked`: cần người dùng xử lý, ví dụ CAPTCHA/session/proxy auth.
- `cancelled`: bị người dùng hoặc kill switch dừng.

### 7.7 Lease

Job lease gồm:

- `workerId`
- `leaseToken`
- `leasedAt`
- `leaseExpiresAt`
- `heartbeatAt`

Worker chỉ được cập nhật job nếu `leaseToken` còn hợp lệ. Gia hạn lease theo heartbeat. MongoDB update phải atomic để không có hai worker cùng nhận một job.

### 7.8 Retry

Chỉ retry tự động:

- Navigation timeout tạm thời.
- Proxy mất kết nối tạm thời.
- MongoDB transient error.
- Browser process crash trước khi action được gửi.

Không retry tự động:

- CAPTCHA.
- Checkpoint.
- Account restricted/suspended.
- Session hết hạn.
- Proxy authentication failed.
- Action bị nền tảng từ chối.
- Không chắc action trước đã được gửi hay chưa.

Retry dùng exponential backoff có jitter và số lần tối đa nhỏ. Trước retry phải kiểm tra interaction record để tránh gửi trùng.

### 7.9 Hủy job

Hủy mềm:

1. Đặt `cancelRequestedAt`.
2. Worker kiểm tra giữa các bước.
3. Không bắt đầu action mới.
4. Đóng browser an toàn.
5. Chuyển `cancelled`.

Kill switch:

- Chặn tạo job mới.
- Đánh dấu hủy mọi job đang queued/leased/running.
- Worker đóng browser trong grace period.
- Có thể bật theo toàn hệ thống, platform, workflow hoặc profile.

---

## 8. Giới hạn và chống lặp

### 8.1 Các lớp giới hạn

Giới hạn được kiểm tra theo thứ tự:

1. Global hard limit.
2. Platform hard limit.
3. Profile limit.
4. Workflow limit.
5. Session limit.
6. Cooldown theo action.
7. Deduplication.

Workflow chỉ được giảm giới hạn, không được tăng vượt hard limit.

### 8.2 Cấu hình mặc định bảo thủ

Giá trị mặc định cho phiên bản đầu:

- Một profile chỉ chạy một job tại một thời điểm.
- Tổng concurrency mặc định: 2 browser.
- Concurrency có thể tăng theo cấu hình máy nhưng phải có hard cap.
- Comment và reply có cooldown dài hơn like.
- Sau nhiều lỗi liên tiếp, profile tự chuyển `paused`.
- Sau một restriction, profile không được tự chạy lại.

Giới hạn số lượng cụ thể phải nằm trong `AppSetting`, hiển thị rõ trên dashboard và được xác nhận khi bật `auto-approved`. Cấu hình mặc định phải ưu tiên tương tác ít, liên quan và có khoảng nghỉ; không tối ưu cho số lượng.

### 8.3 Deduplication

Khóa chống lặp:

```text
platform + profileId + contentExternalId + actionType
```

Comment/reply bổ sung:

```text
normalizedTextHash
```

Không thực hiện lại nếu:

- Interaction đã `succeeded`.
- Interaction đang `pending` và chưa hết idempotency window.
- Nội dung AI trùng với một nội dung gần đây của cùng profile.
- Nội dung AI trùng trên nhiều profile trong cửa sổ chống lặp.

### 8.4 Nội dung không được gửi

- Chuỗi rỗng.
- Chỉ emoji.
- Quá ngắn hoặc quá dài so với policy.
- Lặp lại nội dung đã dùng.
- Có URL khi workflow không cho phép.
- Có từ khóa cấm.
- Có yêu cầu lừa đảo, mạo danh hoặc thông tin nhạy cảm.
- Không liên quan context theo moderation result.
- Gemini trả lỗi hoặc output không hợp lệ.

---

## 9. Gemini

### 9.1 Use cases

- Viết comment theo tiêu đề/caption.
- Reply theo comment gốc và context nội dung.
- Viết lại draft theo tone.
- Phát hiện ngôn ngữ.
- Đánh giá sơ bộ độ liên quan.
- Tạo nhiều draft để người dùng chọn trong `manual-review`.

### 9.2 Prompt pipeline

```text
Raw page context
  -> sanitize
  -> truncate
  -> structured prompt
  -> Gemini
  -> parse
  -> normalize
  -> moderation
  -> duplicate check
  -> draft/approved/rejected
```

Prompt phải:

- Nêu rõ platform.
- Nêu ngôn ngữ và tone.
- Chỉ cung cấp context cần thiết.
- Yêu cầu một output duy nhất, không kèm giải thích.
- Giới hạn số ký tự.
- Cấm bịa dữ kiện không có trong context.
- Cấm tự thêm link/hashtag/mention nếu chưa cho phép.

### 9.3 Key pool

Có thể tái sử dụng ý tưởng từ `src/geminiKeyPool.js` của ứng dụng hiện tại:

- Nhiều API key.
- Key bị quota/rate limit được tạm ngưng.
- Fallback sang key khác.
- Daily reset.
- Không log toàn bộ key.

Khác biệt:

- Trạng thái key pool lưu MongoDB hoặc file mã hóa local.
- Dashboard chỉ hiển thị key label và bốn ký tự cuối.
- API key được đọc từ env/secret store, không trả về client.

### 9.4 AI generation record

Mỗi lần tạo lưu:

- Provider/model.
- Template version.
- Input hash.
- Context character count.
- Output đã normalize.
- Moderation result.
- Duplicate result.
- Token/usage metadata nếu API trả về.
- Latency.
- Error code.

Không lưu dữ liệu browser session trong prompt hoặc log AI.

### 9.5 Fallback

Nếu Gemini lỗi:

- `draft-only`/`manual-review`: hiển thị lỗi và cho phép tạo lại.
- `auto-approved`: bỏ qua action comment/reply; không dùng câu fallback chung.
- Watch/like có thể tiếp tục nếu không phụ thuộc AI và còn hạn mức.

Không dùng static fallback comment vì dễ gây nội dung trùng lặp.

---

## 10. Thiết kế MongoDB

### 10.1 `BrowserProfile`

```ts
{
  _id: ObjectId,
  name: string,
  slug: string,
  enabled: boolean,
  status: 'new' | 'ready' | 'running' | 'paused' | 'blocked' | 'error',
  userDataDir: string,
  browserChannel: 'chromium' | 'chrome',
  headless: boolean,
  locale: string,
  timezoneId: string,
  viewport: { width: number, height: number },
  proxyId: ObjectId | null,
  limits: {
    maxSessionMinutes: number,
    maxJobsPerDay: number
  },
  lock: {
    workerId: string | null,
    jobId: ObjectId | null,
    acquiredAt: Date | null,
    expiresAt: Date | null
  },
  lastOpenedAt: Date | null,
  lastClosedAt: Date | null,
  lastHealthCheckAt: Date | null,
  lastHealthStatus: 'healthy' | 'partial' | 'login_required' | 'blocked' | 'error' | null,
  consecutiveErrors: number,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique `slug`.
- `status + enabled`.
- `lock.expiresAt`.

### 10.2 `PlatformAccount`

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  platform: 'google' | 'youtube' | 'facebook' | 'tiktok',
  externalId: string | null,
  displayName: string | null,
  handle: string | null,
  avatarUrl: string | null,
  loginStatus: 'unknown' | 'logged_in' | 'logged_out' | 'verification_required' | 'restricted',
  lastValidatedAt: Date | null,
  lastLoginAt: Date | null,
  lastErrorCode: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

Index unique:

```text
profileId + platform
```

Không có trường password, recovery email, access token hoặc 2FA secret.

### 10.3 `SessionBackup`

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  version: number,
  encryptionVersion: number,
  encryptedPayload: string,
  iv: string,
  authTag: string,
  payloadChecksum: string,
  browserVersion: string,
  createdAt: Date,
  expiresAt: Date | null,
  restoredAt: Date | null
}
```

Indexes:

- Unique `profileId + version`.
- `profileId + createdAt desc`.

Chỉ giữ số phiên bản backup giới hạn. Backup cũ được xóa bằng cleanup job.

### 10.4 `Proxy`

```ts
{
  _id: ObjectId,
  name: string,
  protocol: 'http' | 'https' | 'socks5',
  host: string,
  port: number,
  usernameEncrypted: EncryptedField | null,
  passwordEncrypted: EncryptedField | null,
  declaredRegion: string | null,
  requireStableIp: boolean,
  enabled: boolean,
  health: {
    status: 'unknown' | 'healthy' | 'degraded' | 'unreachable' | 'auth_failed',
    resolvedIp: string | null,
    latencyMs: number | null,
    checkedAt: Date | null,
    errorCode: string | null
  },
  createdAt: Date,
  updatedAt: Date
}
```

Không đặt unique trên `host + port` vì có thể có nhiều credential trên cùng endpoint.

### 10.5 `Workflow`

```ts
{
  _id: ObjectId,
  name: string,
  description: string,
  platform: 'youtube' | 'facebook' | 'tiktok',
  enabled: boolean,
  profileIds: ObjectId[],
  source: {
    type: 'urls' | 'channel' | 'keywords' | 'feed',
    urls: string[],
    value: string | null,
    keywords: string[],
    maxItemsPerRun: number,
    maxContentAgeHours: number | null,
    language: string | null
  },
  actions: {
    watch: ActionPolicy,
    like: ActionPolicy,
    comment: ActionPolicy,
    reply: ActionPolicy
  },
  ai: {
    mode: 'draft-only' | 'manual-review' | 'auto-approved',
    templateId: ObjectId | null,
    language: string,
    tone: string
  },
  schedule: {
    type: 'manual' | 'once' | 'cron',
    runAt: Date | null,
    cron: string | null,
    timezone: string,
    windowStart: string | null,
    windowEnd: string | null
  },
  nextRunAt: Date | null,
  lastRunAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

### 10.6 `Job`

```ts
{
  _id: ObjectId,
  workflowId: ObjectId | null,
  profileId: ObjectId,
  platform: 'youtube' | 'facebook' | 'tiktok',
  type: 'login' | 'health_check' | 'workflow_run' | 'session_backup' | 'proxy_check',
  priority: number,
  status: JobStatus,
  scheduledAt: Date,
  startedAt: Date | null,
  finishedAt: Date | null,
  lease: {
    workerId: string | null,
    tokenHash: string | null,
    leasedAt: Date | null,
    expiresAt: Date | null,
    heartbeatAt: Date | null
  },
  progress: {
    step: string | null,
    current: number,
    total: number,
    message: string | null
  },
  attempt: number,
  maxAttempts: number,
  cancelRequestedAt: Date | null,
  input: object,
  result: object | null,
  error: {
    code: string,
    message: string,
    retryable: boolean,
    artifactIds: ObjectId[]
  } | null,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `status + scheduledAt + priority`.
- `profileId + status`.
- `lease.expiresAt`.
- `workflowId + createdAt`.

### 10.7 `Interaction`

```ts
{
  _id: ObjectId,
  jobId: ObjectId,
  workflowId: ObjectId | null,
  profileId: ObjectId,
  platform: 'youtube' | 'facebook' | 'tiktok',
  contentExternalId: string,
  contentUrl: string,
  actionType: 'watch' | 'like' | 'comment' | 'reply',
  targetExternalId: string | null,
  status: 'pending' | 'succeeded' | 'failed' | 'unknown',
  text: string | null,
  normalizedTextHash: string | null,
  idempotencyKey: string,
  performedAt: Date | null,
  errorCode: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

Unique index trên `idempotencyKey`.

### 10.8 `AiTemplate`

```ts
{
  _id: ObjectId,
  name: string,
  platform: 'youtube' | 'facebook' | 'tiktok' | 'all',
  version: number,
  systemInstruction: string,
  language: string,
  tone: string,
  minLength: number,
  maxLength: number,
  blockedTerms: string[],
  allowLinks: boolean,
  allowMentions: boolean,
  enabled: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### 10.9 `AiGeneration`

```ts
{
  _id: ObjectId,
  jobId: ObjectId,
  profileId: ObjectId,
  templateId: ObjectId,
  templateVersion: number,
  provider: 'gemini',
  model: string,
  inputHash: string,
  contextLength: number,
  output: string | null,
  outputHash: string | null,
  status: 'generated' | 'approved' | 'rejected' | 'sent' | 'failed',
  moderation: {
    passed: boolean,
    reasons: string[]
  },
  usage: {
    promptTokens: number | null,
    outputTokens: number | null
  },
  latencyMs: number,
  errorCode: string | null,
  createdAt: Date,
  reviewedAt: Date | null
}
```

### 10.10 `ActivityLog`

```ts
{
  _id: ObjectId,
  level: 'debug' | 'info' | 'warn' | 'error',
  category: 'auth' | 'profile' | 'proxy' | 'job' | 'browser' | 'platform' | 'ai' | 'security',
  event: string,
  profileId: ObjectId | null,
  workflowId: ObjectId | null,
  jobId: ObjectId | null,
  platform: string | null,
  message: string,
  metadata: object,
  createdAt: Date,
  expiresAt: Date
}
```

TTL index trên `expiresAt`.

### 10.11 `WorkerRuntime`

```ts
{
  _id: ObjectId,
  workerId: string,
  hostname: string,
  pid: number,
  version: string,
  status: 'starting' | 'idle' | 'busy' | 'draining' | 'offline' | 'error',
  capacity: number,
  activeJobIds: ObjectId[],
  startedAt: Date,
  heartbeatAt: Date,
  metrics: {
    memoryMb: number,
    cpuPercent: number | null,
    openBrowsers: number
  }
}
```

Unique index `workerId`; TTL/cleanup dựa trên `heartbeatAt`.

### 10.12 `AppSetting`

Chỉ có một document active:

```ts
{
  _id: ObjectId,
  killSwitch: {
    global: boolean,
    platforms: string[],
    profileIds: ObjectId[],
    workflowIds: ObjectId[]
  },
  concurrency: {
    default: number,
    hardMax: number
  },
  hardLimits: object,
  retention: {
    activityLogDays: number,
    artifactDays: number,
    sessionBackupVersions: number
  },
  security: {
    sessionTimeoutMinutes: number,
    requireLocalhost: boolean
  },
  updatedAt: Date
}
```

---

## 11. API thiết kế

Base path: `/api/v1`

### 11.1 Authentication

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`

Dashboard dùng HTTP-only, SameSite strict cookie. Không lưu password dashboard trong localStorage.

### 11.2 Profiles

- `GET /profiles`
- `POST /profiles`
- `GET /profiles/:id`
- `PATCH /profiles/:id`
- `DELETE /profiles/:id`
- `POST /profiles/:id/open`
- `POST /profiles/:id/close`
- `POST /profiles/:id/health-check`
- `POST /profiles/:id/backup-session`
- `POST /profiles/:id/restore-session`
- `POST /profiles/:id/pause`
- `POST /profiles/:id/resume`

Xóa profile:

- Không cho xóa nếu đang lock.
- Mặc định soft delete.
- Xóa thư mục local là hành động riêng, yêu cầu xác nhận tên profile.

### 11.3 Proxies

- `GET /proxies`
- `POST /proxies`
- `GET /proxies/:id`
- `PATCH /proxies/:id`
- `DELETE /proxies/:id`
- `POST /proxies/:id/check`
- `POST /profiles/:profileId/assign-proxy`
- `DELETE /profiles/:profileId/proxy`

Response chỉ trả `hasUsername`, `hasPassword`; không trả credential.

### 11.4 Accounts

- `GET /accounts`
- `GET /accounts/:id`
- `POST /profiles/:profileId/validate-accounts`

Không có API đặt password.

### 11.5 Workflows

- `GET /workflows`
- `POST /workflows`
- `GET /workflows/:id`
- `PATCH /workflows/:id`
- `DELETE /workflows/:id`
- `POST /workflows/:id/run`
- `POST /workflows/:id/enable`
- `POST /workflows/:id/disable`
- `POST /workflows/:id/validate`

### 11.6 Jobs

- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/retry`
- `GET /jobs/:id/artifacts`
- `GET /jobs/:id/events`

Retry endpoint phải tạo job mới liên kết `retryOfJobId`; không sửa job cũ thành queued.

### 11.7 AI

- `GET /ai/templates`
- `POST /ai/templates`
- `PATCH /ai/templates/:id`
- `DELETE /ai/templates/:id`
- `POST /ai/templates/:id/test`
- `GET /ai/generations`
- `POST /ai/generations/:id/approve`
- `POST /ai/generations/:id/reject`
- `POST /ai/generations/:id/regenerate`

### 11.8 Settings và runtime

- `GET /settings`
- `PATCH /settings`
- `GET /runtime/workers`
- `GET /runtime/status`
- `POST /runtime/kill-switch/enable`
- `POST /runtime/kill-switch/disable`

Tắt kill switch yêu cầu xác nhận và ghi audit log.

### 11.9 Statistics

- `GET /stats/overview`
- `GET /stats/actions`
- `GET /stats/errors`
- `GET /stats/profiles`
- `GET /activity`

### 11.10 Realtime

Dùng Socket.IO hoặc Server-Sent Events cho:

- Worker heartbeat.
- Job progress.
- Profile status.
- AI draft waiting review.
- Restriction alert.
- Kill switch.

Mọi realtime connection phải xác thực cùng session dashboard.

---

## 12. Màn hình dashboard

### 12.1 Login

- Username/password local.
- Rate limit login.
- Session timeout.
- Không hiển thị credential mặc định trong UI.

### 12.2 Overview

Hiển thị:

- Worker online/offline.
- Số browser đang mở/capacity.
- Profile ready/running/blocked.
- Job queued/running/waiting review/failed.
- Kill switch.
- Lỗi gần nhất.
- Action theo ngày và platform.

Quick actions:

- Tạo profile.
- Chạy workflow.
- Mở profile cần đăng nhập.
- Dừng tất cả.

### 12.3 Browser Profiles

Danh sách:

- Tên.
- Proxy/IP.
- Google/Facebook/TikTok/YouTube login status.
- Trạng thái.
- Job hiện tại.
- Lần health check.

Chi tiết:

- Mở/đóng browser.
- Gán proxy.
- Cấu hình locale/timezone/viewport.
- Backup/restore.
- Pause/resume.
- Lịch sử lỗi và artifact.

### 12.4 Proxies

- Thêm/sửa/xóa.
- Test kết nối.
- Health status.
- Resolved IP.
- Latency.
- Danh sách profile đang dùng.
- Cảnh báo dùng chung.

### 12.5 Accounts

Matrix:

```text
Profile | Google | YouTube | Facebook | TikTok | Last validated
```

Action:

- Validate.
- Mở browser đăng nhập.
- Xem lỗi gần nhất.

### 12.6 Workflows

Wizard:

1. Chọn platform.
2. Chọn profiles.
3. Chọn content source.
4. Chọn action.
5. Chọn AI mode/template.
6. Đặt limits.
7. Đặt schedule.
8. Review và validate.

Trước khi bật:

- Kiểm tra profile có proxy/session.
- Kiểm tra source hợp lệ.
- Kiểm tra action không vượt hard limit.
- Kiểm tra Gemini nếu có comment/reply.

### 12.7 AI Templates

- Prompt instruction.
- Ngôn ngữ.
- Tone.
- Min/max length.
- Blocked terms.
- Link/mention policy.
- Test với context mẫu.
- Version history.

### 12.8 Jobs

- Filter theo trạng thái/profile/platform/workflow.
- Progress theo bước.
- Cancel.
- Retry nếu được phép.
- Xem timeline.
- Xem screenshot.
- Xem error code và hướng xử lý.

### 12.9 Review Queue

Dành cho `manual-review`:

- Context nguồn.
- Draft.
- Sửa draft.
- Approve.
- Reject.
- Regenerate.
- Thời gian job sẽ hết hạn.

### 12.10 Activity và History

- Bộ lọc.
- Export JSON/CSV không chứa secrets.
- Retention.
- Liên kết tới profile/job/workflow.

### 12.11 Settings

- MongoDB status.
- Worker capacity.
- Global hard limits.
- Retention.
- Gemini model/key labels.
- Artifact/profile directories.
- Dashboard auth.
- Kill switch.

---

## 13. Đặc tả adapter theo nền tảng

### 13.1 Thứ tự triển khai

1. YouTube.
2. Facebook.
3. TikTok.

YouTube được làm trước vì dùng Google session và phù hợp nhất để xác nhận kiến trúc profile/session.

### 13.2 YouTube

Session check:

- Xác nhận không ở trang sign-in.
- Xác nhận avatar/account menu tồn tại.
- Không cần mở hoặc đọc dữ liệu Google nhạy cảm.

Content:

- Video URL.
- Channel URL.
- Keyword search.

Actions:

- Mở video.
- Xem trong thời lượng cấu hình.
- Like nếu chưa like.
- Comment.
- Reply một comment được workflow chọn.

Restriction:

- Sign-in required.
- CAPTCHA/unusual traffic.
- Comment disabled.
- Video unavailable/age restriction.
- Action rejected.

### 13.3 Facebook

Session check:

- Xác nhận feed hoặc account navigation.
- Phát hiện login/checkpoint page.

Content:

- Post URL.
- Page/profile URL trong phạm vi người dùng quản lý.
- Keyword/search chỉ khi UI hỗ trợ ổn định.

Actions:

- Mở post/video.
- Xem.
- Like.
- Comment.
- Reply.

Restriction:

- Login required.
- Checkpoint.
- Temporary block.
- Comment permission denied.
- Content unavailable.

### 13.4 TikTok

Session check:

- Xác nhận profile/account navigation.
- Phát hiện login challenge.

Content:

- Video URL.
- Creator URL.
- Keyword search.

Actions:

- Mở video.
- Xem.
- Like.
- Comment.
- Reply nếu UI/account hỗ trợ.

Restriction:

- CAPTCHA.
- Login required.
- Too many attempts.
- Comment disabled.
- Content unavailable.

### 13.5 Selector strategy

Ưu tiên:

1. Accessibility role/name ổn định.
2. Thuộc tính semantic.
3. Test ID nếu nền tảng cung cấp.
4. Text được locale-aware.
5. CSS selector cấu trúc chỉ là phương án cuối.

Không dùng XPath dài hoặc class name được generate nếu có lựa chọn khác.

Mỗi adapter có:

- Selector registry theo version.
- Fixture HTML.
- Contract tests.
- Feature flags để tắt action riêng.
- Circuit breaker khi selector lỗi hàng loạt.

---

## 14. Error handling

### 14.1 Mã lỗi chuẩn

Nhóm:

- `AUTH_*`
- `PROXY_*`
- `BROWSER_*`
- `PLATFORM_*`
- `AI_*`
- `JOB_*`
- `DB_*`
- `SECURITY_*`
- `VALIDATION_*`

Ví dụ:

- `AUTH_LOGIN_REQUIRED`
- `AUTH_VERIFICATION_REQUIRED`
- `PROXY_UNREACHABLE`
- `PROXY_AUTH_FAILED`
- `BROWSER_PROFILE_LOCKED`
- `BROWSER_CRASHED`
- `PLATFORM_CAPTCHA_DETECTED`
- `PLATFORM_ACTION_REJECTED`
- `PLATFORM_SELECTOR_MISSING`
- `AI_QUOTA_EXCEEDED`
- `AI_OUTPUT_REJECTED`
- `JOB_CANCELLED`
- `DB_UNAVAILABLE`

### 14.2 Restriction

Khi phát hiện CAPTCHA/checkpoint/restriction:

1. Dừng action ngay.
2. Không retry.
3. Chụp screenshot nếu không chứa dữ liệu nhạy cảm.
4. Ghi error code.
5. Chuyển job `blocked`.
6. Chuyển profile `blocked`.
7. Phát cảnh báo realtime.
8. Yêu cầu người dùng mở profile xử lý.

### 14.3 Selector failure

- Một lỗi: fail action/job theo policy.
- Nhiều lỗi cùng adapter trong cửa sổ ngắn: mở circuit breaker.
- Circuit breaker chặn job mới của adapter.
- Dashboard hiển thị adapter degraded.
- Không tự thử click theo tọa độ đoán.

### 14.4 Database failure

- Worker không nhận job mới.
- Job đang chạy chỉ hoàn tất bước an toàn hiện tại.
- Không gửi action mới nếu không thể ghi idempotency record.
- Đóng browser và chuyển trạng thái sau khi DB phục hồi.
- Không lưu session/plaintext tạm vào log.

### 14.5 Browser crash

- Kiểm tra interaction đã được ghi `pending` hay chưa.
- Nếu không chắc action đã xảy ra, đặt `unknown`.
- Không tự gửi lại comment/reply.
- Thu thập browser stderr và crash metadata đã redact.
- Giải phóng lock sau khi xác nhận PID chết.

---

## 15. Bảo mật

### 15.1 Dữ liệu không được lưu

- Google password.
- Mật khẩu mạng xã hội.
- 2FA secret/code.
- Recovery code.
- Full Gemini key trong MongoDB/log/UI.
- Cookies plaintext trong MongoDB.
- Proxy password plaintext.

### 15.2 Mã hóa

Dùng AES-256-GCM:

- Khóa 32 byte từ `DATA_ENCRYPTION_KEY`.
- IV ngẫu nhiên cho mỗi payload.
- Lưu auth tag.
- Có `encryptionVersion` để hỗ trợ rotate key.
- Additional authenticated data chứa record type và record ID.

Không có fallback plaintext nếu thiếu key. Ứng dụng phải từ chối khởi động phần session/proxy nếu key không hợp lệ.

### 15.3 Secret redaction

Logger phải redact:

- Cookie header.
- Authorization header.
- Proxy URL có credential.
- API key.
- Session payload.
- Set-Cookie.
- Query parameter nhạy cảm.

### 15.4 Dashboard

- Bind `127.0.0.1` mặc định.
- HTTP-only session cookie.
- CSRF protection cho mutation.
- Rate limit login và mutation nhạy cảm.
- Password dashboard lưu hash Argon2id/bcrypt.
- Không dùng mặc định `admin/admin123`.
- Nếu bind ngoài localhost, bắt buộc cảnh báo và HTTPS reverse proxy.

### 15.5 File system

- `profiles/`, `artifacts/`, `logs/` và `.env` phải gitignored.
- Kiểm tra path traversal.
- Profile path phải nằm dưới root đã cấu hình.
- Artifact download chỉ qua ID, không nhận absolute path từ client.
- Screenshot có retention và quyền truy cập dashboard.

### 15.6 MongoDB

- User DB chỉ có quyền trên database ứng dụng.
- Không khuyến nghị whitelist `0.0.0.0/0` cho Atlas.
- TLS khi dùng Atlas.
- Unique/index/validation ở cả Mongoose và database khi phù hợp.
- Không expose MongoDB trực tiếp ra dashboard client.

---

## 16. Logging, audit và artifacts

### 16.1 Structured log

JSON log fields:

- Timestamp.
- Level.
- Category.
- Event.
- Worker ID.
- Job/profile/workflow ID.
- Platform.
- Error code.
- Duration.
- Metadata đã redact.

### 16.2 Audit events

Ghi audit khi:

- Login/logout dashboard.
- Tạo/sửa/xóa profile/proxy/workflow.
- Gán hoặc đổi proxy.
- Mở browser login.
- Restore session.
- Approve AI draft.
- Bật `auto-approved`.
- Bật/tắt kill switch.
- Thay hard limits.

### 16.3 Artifacts

Loại:

- Screenshot lỗi.
- HTML snapshot đã sanitize khi cần debug.
- Health report.
- Browser stderr.

Artifact metadata lưu DB; file lưu local. Cleanup job xóa file theo retention.

Không chụp screenshot định kỳ khi không có lỗi để giảm rò rỉ dữ liệu.

---

## 17. Health check và monitoring

### 17.1 Profile health check

Health check không tạo tương tác:

1. Kiểm tra profile directory.
2. Kiểm tra lock.
3. Kiểm tra proxy.
4. Mở browser.
5. Validate session các platform đã liên kết.
6. Đóng browser.
7. Ghi report.

Kết quả:

- `healthy`
- `partial`
- `login_required`
- `blocked`
- `error`

### 17.2 Worker health

Dashboard coi worker offline nếu quá heartbeat threshold.

Metrics:

- Open browsers.
- Active jobs.
- Queue depth.
- Memory.
- CPU nếu lấy được.
- Job success/failure.
- Adapter circuit status.

### 17.3 Resource guard

Trước khi mở browser:

- Kiểm tra capacity.
- Kiểm tra memory threshold.
- Kiểm tra disk free cho profile/artifact.
- Nếu không đủ tài nguyên, giữ job queued hoặc fail bằng lỗi rõ ràng.

Số profile lưu trữ không bị giới hạn cứng; số profile chạy đồng thời phụ thuộc `capacity` và tài nguyên máy.

---

## 18. Environment variables

```dotenv
# Runtime
NODE_ENV=development
APP_HOST=127.0.0.1
APP_PORT=3000
APP_TIMEZONE=Asia/Ho_Chi_Minh

# MongoDB
MONGODB_URI=
MONGODB_DB_NAME=local_social_workspace

# Security
DATA_ENCRYPTION_KEY=
DASHBOARD_USERNAME=
DASHBOARD_PASSWORD_HASH=
SESSION_SECRET=

# Browser
PROFILE_ROOT=./profiles
ARTIFACT_ROOT=./artifacts
BROWSER_CHANNEL=chromium
BROWSER_HEADLESS=false
BROWSER_LAUNCH_TIMEOUT_MS=60000
NAVIGATION_TIMEOUT_MS=45000

# Worker
WORKER_ID=
WORKER_CAPACITY=2
WORKER_HEARTBEAT_MS=5000
JOB_LEASE_MS=30000

# Gemini
GEMINI_API_KEYS=
GEMINI_MODEL=
GEMINI_FALLBACK_MODELS=
GEMINI_TIMEOUT_MS=30000

# Logging
LOG_LEVEL=info
LOG_RETENTION_DAYS=30
ARTIFACT_RETENTION_DAYS=14

# Proxy check
PROXY_CHECK_URL=
PROXY_CHECK_TIMEOUT_MS=15000
```

`.env.example` chỉ chứa tên biến và giá trị mẫu không nhạy cảm.

---

## 19. Tái sử dụng từ ứng dụng hiện tại

### 19.1 Có thể tái sử dụng ý tưởng hoặc refactor

- `src/geminiKeyPool.js`: key pool, fallback, daily reset.
- `src/ai.js`: provider abstraction và prompt pipeline.
- `src/crypto.js`: AES-256-GCM, nhưng phải bỏ fallback plaintext.
- `src/logger.js`: Winston file + console, nâng cấp structured/redaction.
- `src/database.js`: Mongoose connection retry và repository patterns.
- `src/worker.js`: heartbeat và command polling.
- `src/accountConfig.js`: config merge pattern.
- `src/auth.js`: manual login lifecycle và session validation pattern.
- `src/browser.js`: timeout/retry configuration; không tái sử dụng stealth/evasion.

### 19.2 Không sao chép nguyên trạng

- `src/engage.js` vì đang gắn chặt với X/Twitter và file quá lớn.
- Proxy global `PROXY_SERVER`; app mới cần proxy per-profile.
- Cookies plaintext trong `accounts/`.
- HTTP Basic Auth mặc định.
- `maxPerDay` bị vô hiệu hóa.
- Selector/action logic trộn chung với orchestration.
- Socket.IO control event thiếu authorization riêng.

### 19.3 Chiến lược chia sẻ code

Ứng dụng mới là project riêng. Có hai cách:

1. Sao chép có chọn lọc rồi refactor, không phụ thuộc repo cũ.
2. Tách package dùng chung sau khi ứng dụng mới ổn định.

Khuyến nghị giai đoạn đầu: cách 1 để tránh làm hỏng ứng dụng hiện tại.

---

## 20. Kiểm thử

### 20.1 Unit tests

- Encryption roundtrip và tamper detection.
- Secret redaction.
- Profile path validation.
- Proxy URL construction không log credential.
- Job state transitions.
- Lease acquisition/renewal/expiry.
- Limit precedence.
- Deduplication/idempotency.
- Scheduler timezone.
- AI normalize/moderation/duplicate.
- Retry classification.
- Kill switch.

### 20.2 Database integration tests

Dùng MongoDB test database:

- Unique profile slug.
- Atomic job lease.
- Không lease hai job cùng profile.
- TTL activity log.
- Session backup versioning.
- Retry tạo job mới.
- Interaction idempotency.
- Worker heartbeat.

### 20.3 Adapter contract tests

Mọi adapter phải pass:

- `validateSession` trả kiểu chuẩn.
- Không action nếu context cancelled.
- Không action khi limit denied.
- Restriction luôn trả error không retry.
- `comment/reply` không nhận text rỗng.
- Evidence không chứa secret.

### 20.4 Fixture tests

Lưu HTML fixture đã loại dữ liệu cá nhân:

- Logged in.
- Logged out.
- Content page.
- Comment panel.
- CAPTCHA/checkpoint.
- Content unavailable.
- Action disabled.

Không phụ thuộc live platform trong unit/CI.

### 20.5 End-to-end local

Dùng profile test thuộc quyền sở hữu:

- Tạo profile.
- Gán proxy test.
- Đăng nhập bằng tay.
- Health check.
- Chạy workflow `draft-only`.
- Duyệt draft.
- Hủy job.
- Kill switch.
- Khôi phục sau worker crash.

Không chạy E2E tài khoản thật trong CI.

### 20.6 Security tests

- Không có secrets trong API response.
- Không có secrets trong logs.
- Path traversal bị chặn.
- CSRF mutation bị chặn.
- Unauthorized realtime connection bị chặn.
- Encryption key sai không giải mã được.
- Thiếu encryption key làm startup fail.

### 20.7 Performance tests

- Queue 1.000 job không làm dashboard treo.
- Nhiều profile metadata không ảnh hưởng đáng kể API list.
- Capacity guard không mở quá số browser.
- Memory được giải phóng sau khi browser đóng.

---

## 21. Tiêu chí nghiệm thu

### 21.1 Profile và session

- Tạo được nhiều profile độc lập.
- Mỗi profile dùng thư mục riêng.
- Người dùng đăng nhập thủ công.
- Mở lại profile vẫn giữ session khi nền tảng cho phép.
- Không lưu password/2FA.
- Không mở cùng profile hai lần.
- Session backup được mã hóa.

### 21.2 Proxy

- Gán proxy riêng cho profile.
- Hỗ trợ HTTP/HTTPS/SOCKS5.
- Credential được mã hóa và redact.
- Proxy lỗi không fallback IP thật.
- Đổi proxy khi profile đang đóng và có xác nhận.

### 21.3 Workflow

- Chạy ngay và theo lịch.
- Chọn profile/source/action.
- Có hard limits.
- Có deduplication.
- Có cancel và kill switch.
- CAPTCHA/checkpoint làm job `blocked`.

### 21.4 AI

- Gemini tạo draft theo context.
- Có moderation.
- Có duplicate check.
- Có `draft-only`, `manual-review`, `auto-approved`.
- Gemini lỗi không gửi fallback comment chung.
- API key không xuất hiện trong UI/log.

### 21.5 Nền tảng

- YouTube adapter hoàn thành trước.
- Facebook/TikTok triển khai theo cùng contract.
- Adapter có contract tests và circuit breaker.
- Selector lỗi không dẫn đến click đoán.

### 21.6 Vận hành

- Dashboard chỉ bind localhost mặc định.
- Worker heartbeat hiển thị realtime.
- Job crash có thể phục hồi an toàn.
- MongoDB mất kết nối không tạo action mới.
- Log/artifact có retention.
- Có health check không tương tác.

---

## 22. Lộ trình triển khai

### Giai đoạn 1 — Foundation

- Tạo monorepo.
- Shared types/validation.
- MongoDB connection/repositories.
- Dashboard auth.
- Worker runtime/heartbeat.
- Structured logging/redaction.
- Encryption package.

Kết quả: dashboard và worker chạy local, kết nối DB an toàn.

### Giai đoạn 2 — Browser profiles và proxy

- Profile CRUD.
- Local profile directory.
- Profile lock.
- Persistent context.
- Manual login flow.
- Proxy CRUD/health/assignment.
- Session backup mã hóa.
- Account validation.

Kết quả: tạo, đăng nhập, đóng và mở lại profile độc lập.

### Giai đoạn 3 — Job engine

- Job state machine.
- Atomic lease.
- Scheduler.
- Limits.
- Deduplication.
- Cancel.
- Kill switch.
- Artifact storage.

Kết quả: worker chạy job giả lập an toàn, không chạy trùng.

### Giai đoạn 4 — YouTube

- Session validation.
- URL/channel/keyword source.
- Watch.
- Like.
- Comment/reply.
- Restriction detection.
- Fixtures và contract tests.

Kết quả: workflow YouTube end-to-end.

### Giai đoạn 5 — Gemini

- Key pool.
- Templates.
- Prompt pipeline.
- Moderation.
- Review queue.
- Draft-only/manual/auto modes.

Kết quả: comment/reply có AI và kiểm duyệt.

### Giai đoạn 6 — Facebook

- Adapter.
- Restriction detection.
- Fixtures/tests.
- Feature flags.

### Giai đoạn 7 — TikTok

- Adapter.
- Restriction detection.
- Fixtures/tests.
- Feature flags.

### Giai đoạn 8 — Hardening

- Resource guard.
- Circuit breaker.
- Security tests.
- Crash recovery.
- Backup/restore test.
- Local production build.
- User documentation.

---

## 23. Rủi ro và giảm thiểu

### UI nền tảng thay đổi

Rủi ro: selector hỏng.

Giảm thiểu:

- Adapter độc lập.
- Selector registry.
- Fixtures.
- Circuit breaker.
- Feature flag tắt action.

### Session hết hạn hoặc device verification

Rủi ro: phải đăng nhập lại.

Giảm thiểu:

- Persistent profile.
- Health check.
- Session backup best-effort.
- Manual intervention rõ ràng.

### Profile corruption

Rủi ro: Chromium crash hoặc mở trùng.

Giảm thiểu:

- Hai lớp lock.
- Đóng browser có kiểm soát.
- Không sửa file profile khi đang chạy.
- Backup best-effort.

### Proxy không ổn định

Rủi ro: timeout hoặc thay IP.

Giảm thiểu:

- Preflight health check.
- Stable IP warning.
- Không fallback IP thật.
- Block trên auth failure.

### Duplicate comment/reply

Rủi ro: crash sau click nhưng trước khi ghi DB.

Giảm thiểu:

- Pending interaction trước action.
- Idempotency key.
- Trạng thái `unknown`.
- Không auto retry comment/reply khi không chắc chắn.

### Gemini output không phù hợp

Rủi ro: nội dung sai ngữ cảnh hoặc lặp.

Giảm thiểu:

- Context sanitize.
- Strict prompt.
- Moderation.
- Duplicate hash.
- Manual review mặc định.

### Tài nguyên máy

Rủi ro: nhiều Chromium dùng nhiều RAM.

Giảm thiểu:

- Dynamic capacity.
- Memory/disk guard.
- Queue thay vì mở tất cả.
- Một profile một job.

### Điều khoản nền tảng

Rủi ro: automation có thể bị hạn chế.

Giảm thiểu:

- Tài khoản thuộc quyền quản lý.
- Giới hạn bảo thủ.
- Dừng khi restriction.
- Không bypass.
- Có draft/manual mode.
- Người vận hành kiểm tra chính sách nền tảng.

---

## 24. Quyết định thiết kế đã chốt

1. Tạo project mới, không mở rộng trực tiếp repo hiện tại.
2. Dùng Local Web Dashboard + Worker.
3. Chạy trên máy local.
4. MongoDB và Gemini tương tự ứng dụng hiện tại.
5. Browser automation cho cả ba nền tảng.
6. Người dùng tự tạo và đăng nhập tài khoản.
7. Không lưu mật khẩu.
8. Profile local là nguồn session chính.
9. Session backup MongoDB phải mã hóa.
10. Proxy cố định theo profile.
11. Không proxy rotation để né chặn.
12. Không cày view; chỉ mở/xem nội dung.
13. Like/comment/reply có thể tự động nhưng phải có hard limits.
14. Gemini có thể tự tạo và gửi sau moderation khi workflow bật `auto-approved`.
15. CAPTCHA/checkpoint luôn yêu cầu người dùng xử lý.
16. Quy mô profile cấu hình động theo tài nguyên máy.
17. YouTube được triển khai trước Facebook và TikTok.

---

## 25. Điều kiện trước khi lập kế hoạch implementation

Tài liệu implementation plan tiếp theo phải:

- Chia thành các giai đoạn độc lập, mỗi giai đoạn có thể kiểm thử.
- Xác định chính xác file tạo mới.
- Dùng TDD cho state machine, encryption, lease, limits và adapters.
- Không triển khai đồng thời ba platform trong một task.
- Chốt package manager và phiên bản Node.js.
- Chốt MongoDB local hay Atlas cho môi trường development.
- Chốt Chrome channel mặc định.
- Xác định hard limit mặc định bằng cấu hình rõ ràng.
- Có migration/index initialization.
- Có threat-model checklist cho session và proxy credentials.
- Có hướng dẫn chạy local trên Windows.

