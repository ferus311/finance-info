# ARCHITECTURE.md — Quy tắc kiến trúc & refactor

> **Đối tượng đọc:** AI agent (và chính chủ dự án).
> **Phạm vi:** toàn bộ codebase Next.js + SQLite chạy cá nhân qua Tailscale.
> **Mức ưu tiên:** Khi quy tắc ở đây mâu thuẫn với thói quen/gợi ý chung của bạn, **làm theo file này**. Nếu một tình huống chưa được định nghĩa, chọn phương án đơn giản nhất thỏa các nguyên tắc ở mục 1, rồi ghi lại quyết định vào `docs/decisions.md`.

---

## 0. Bối cảnh dự án

- Hiện tại là ứng dụng cá nhân, chạy trên một server riêng, truy cập qua một port Tailscale, chủ yếu một người dùng.
- **Định hướng:** có thể **mở rộng** sau này (đổi sang DB "chuẩn" như Postgres, tăng số người dùng). Ứng dụng đã có tính năng login/auth ở mức sơ khai và sẽ được củng cố, không viết bỏ.
- Vì vậy thiết kế theo hướng **"scale-ready bằng đường nối (seam)"**: làm sẵn những ranh giới rẻ để về sau lên scale không phải viết lại, nhưng **chưa dựng hạ tầng** khi chưa cần (xem P8 và mục 4.9–4.12).
- Stack: Next.js (App Router) + TypeScript, SQLite (file; có thể đổi sang Postgres sau), gọi LLM qua API, auth session-based.
- Mỗi tính năng (mindmap, tra từ vựng bằng AI, flashcards, …) là một trang riêng + API riêng.
- Các tính năng có liên quan dữ liệu với nhau (vd: node mindmap hoặc từ vựng → thẻ flashcard).
- Code được bảo trì chủ yếu **cùng AI agent**, nên **chi phí đọc ngữ cảnh (token)** và **độ rõ ràng của ranh giới** là tiêu chí thiết kế hạng nhất.

---

## 1. Nguyên tắc cốt lõi

| # | Nguyên tắc | Nghĩa là |
|---|---|---|
| P1 | **Vertical slice** | Chia code theo *tính năng*, không chia theo loại kỹ thuật toàn cục. Mọi thứ của một tính năng nằm trong một thư mục. |
| P2 | **Low coupling, explicit boundary** | Feature chỉ giao tiếp với feature khác qua `index.ts` (public API). Không import file nội bộ, không query bảng của feature khác. |
| P3 | **File nhỏ, một vai trò** | Mỗi file một trách nhiệm. Agent chỉ cần đọc đúng file cần sửa. |
| P4 | **Thin shared core** | Chỉ rút ra shared những thứ thật sự dùng chung (mục 4.8). Trùng lặp nhỏ tốt hơn abstraction sớm. |
| P5 | **Hành vi không đổi khi refactor** | Refactor = di chuyển + tách file. Không đổi logic, không đổi UI, không đổi schema DB trừ khi được yêu cầu rõ. |
| P6 | **Đơn giản trước** | Không event bus, microservice, DI container, CQRS, repository interface thừa. Chỉ thêm khi có vấn đề thực tế đã xảy ra. (Ngoại lệ: các "seam" ở P8–P10 rẻ và được làm ngay.) |
| P7 | **Dễ đọc cho máy** | Tên rõ nghĩa, kiểu tường minh, comment giải thích *vì sao* (không giải thích *cái gì*). |
| P8 | **Seam trước, hạ tầng sau** | Làm ngay những đường nối rẻ giúp lên scale về sau (`user_id`, repo async, ID tự sinh, auth tập trung). **Không** dựng hạ tầng (Postgres, queue, Redis, nhiều instance) khi chưa có nhu cầu thật. |
| P9 | **Không giả định một người dùng** | Mọi dữ liệu, hàm nghiệp vụ, cache key đều thuộc về một `userId`. Không biến global giữ "người dùng hiện tại". |
| P10 | **Đổi DB chỉ sửa một chỗ** | Toàn bộ khác biệt giữa các DB bị nhốt trong `core/db/` và `repo.ts`. Tầng trên không biết DB nào đang chạy. |

---

## 2. Cấu trúc thư mục chuẩn

```
├─ AGENTS.md                  # (tùy chọn) trỏ về ARCHITECTURE.md + lệnh build/test
├─ ARCHITECTURE.md            # file này
├─ docs/
│  └─ decisions.md            # nhật ký quyết định kiến trúc (ngắn, append-only)
├─ migrations/
│  ├─ 001_init.sql
│  └─ 002_xxx.sql
├─ src/
│  ├─ app/                    # CHỈ chứa routing của Next (mỏng, xem mục 4.5)
│  │  ├─ mindmap/page.tsx
│  │  ├─ vocab/page.tsx
│  │  ├─ flashcards/page.tsx
│  │  └─ api/
│  │     ├─ mindmap/[...route]/route.ts
│  │     ├─ vocab/route.ts
│  │     └─ flashcards/route.ts
│  ├─ features/
│  │  ├─ mindmap/
│  │  │  ├─ README.md         # mục 6
│  │  │  ├─ index.ts          # PUBLIC API duy nhất
│  │  │  ├─ types.ts          # type + zod schema của feature
│  │  │  ├─ api.ts            # handler: parse -> service -> response
│  │  │  ├─ service.ts        # logic nghiệp vụ
│  │  │  ├─ repo.ts           # TOÀN BỘ SQL của feature
│  │  │  └─ ui/               # component, hook của trang
│  │  ├─ auth/                # login, session, người dùng (mục 4.10)
│  │  ├─ vocab/               # (cùng cấu trúc)
│  │  └─ flashcards/          # (cùng cấu trúc)
│  ├─ middleware.ts           # deny-by-default: chặn mọi route chưa đăng nhập
│  └─ core/
│     ├─ db/
│     │  ├─ index.ts          # API async duy nhất repo được dùng (query, withTransaction)
│     │  ├─ migrate.ts        # chạy migration
│     │  └─ driver-sqlite.ts  # driver hiện tại (sau này thêm driver-postgres.ts)
│     ├─ auth.ts              # requireUser(), kiểu Ctx — đọc session
│     ├─ ai.ts                # wrapper gọi LLM
│     ├─ http.ts              # helper response/error chuẩn
│     ├─ config.ts            # đọc + validate env, hằng số toàn cục
│     ├─ ids.ts               # sinh ID (ULID/UUID)
│     └─ log.ts               # log có cấu trúc
└─ data/                      # file .sqlite, backup (đưa vào .gitignore)
```

**Quy tắc đặt tên:** thư mục feature dùng `kebab-case`, số ít/nhiều nhất quán, trùng với tên route (`/vocab` ↔ `features/vocab`).

---

## 3. Phân tầng trong một feature

Luồng phụ thuộc **một chiều**:

```
ui  ──►  api (HTTP)  ──►  service  ──►  repo  ──►  core/db
                              │
                              └──►  other-feature/index.ts   (chỉ qua public API)
                              └──►  core/ai
```

| Tầng | Trách nhiệm | **Được** | **Không được** |
|---|---|---|---|
| `ui/` | Component, hook, state của trang | Gọi API của chính feature (fetch) | Import `repo`, `service`, `core/db` |
| `api.ts` | Parse + validate input, lấy người dùng, gọi service, map lỗi → HTTP | Dùng zod, `core/http`, `requireUser()` | Chứa logic nghiệp vụ, viết SQL |
| `service.ts` | Logic nghiệp vụ, điều phối repo/AI/feature khác | Gọi `repo`, `core/ai`, `index.ts` của feature khác | Biết về `Request/Response`, viết SQL |
| `repo.ts` | Toàn bộ SQL, map row ↔ object; hàm **async**, nhận `userId` | Gọi `core/db` | Chứa logic nghiệp vụ, gọi AI, gọi feature khác, import driver DB |
| `types.ts` | Type, zod schema, hằng số của feature | — | Import từ tầng khác (chỉ được import zod/type thuần) |
| `index.ts` | Public API cho feature khác | Re-export hàm/type được phép | Export `repo`, hàm nội bộ |

### Quy tắc kích thước (để tiết kiệm token)

- **Mục tiêu:** mỗi file ≤ **250 dòng**. **Cứng:** > **400 dòng** thì phải tách.
- Component UI > 200 dòng: tách thành component con / hook (`useXxx.ts`) trong `ui/`.
- Một hàm > ~50 dòng: xem xét tách. Không tách nếu làm mất mạch đọc.
- Không tạo file chỉ để chứa 1 hàm 5 dòng. Cân bằng giữa "file nhỏ" và "quá nhiều file".

---

## 4. Quy tắc chi tiết

### 4.1 Ranh giới giữa feature (QUAN TRỌNG NHẤT)

1. Feature A **chỉ** import từ `features/B/index.ts`. Cấm `import ... from "@/features/B/repo"` hoặc bất kỳ file nội bộ nào.
2. Feature A **không** viết SQL đụng bảng của B (kể cả `JOIN`). Cần dữ liệu của B → gọi hàm public của B.
3. `index.ts` chỉ export thứ feature khác **thực sự cần**. Mặc định là không export gì.
4. Không import vòng (A → B → A). Nếu xảy ra: tách phần chung thành feature mới hoặc đảo hướng phụ thuộc.
5. Hướng phụ thuộc ưu tiên: các feature "nguồn" (mindmap, vocab) → gọi feature "đích" (flashcards). `flashcards` **không** import ngược về mindmap/vocab; nó chỉ lưu `source_type` + `source_id`.

### 4.2 Liên kết dữ liệu giữa feature (mindmap/vocab → flashcards)

- `flashcards` cung cấp trong `index.ts`:
  ```ts
  createCard(ctx: Ctx, input: { front: string; back: string; sourceType: SourceType; sourceId: string }): Promise<Card>
  ```
- Bảng `flashcards_cards` có cột `user_id`, `source_type` (TEXT, enum cố định trong `flashcards/types.ts`) và `source_id` (TEXT). Không dùng foreign key chéo feature. `Ctx` (chứa `userId`) lấy từ `core/auth.ts`, luôn là tham số đầu tiên của hàm public.
- Muốn nhảy ngược về nguồn: UI dựng link theo `source_type` → route tương ứng (map cấu hình ở UI, không đặt trong repo).
- **Kích hoạt thủ công qua UI** ("Gửi sang flashcard" → gọi API flashcards). Không tự động hóa ngầm / không event bus, trừ khi mục 9 cho phép.
- Chống trùng: `UNIQUE(user_id, source_type, source_id)` hoặc kiểm tra trong service khi tạo. Quyết định theo từng trường hợp, ghi vào `docs/decisions.md`.

### 4.3 Database (SQLite)

- Hiện tại là một file SQLite, mở qua **một** module `core/db/` (singleton; quy tắc di động DB ở mục 4.11). Bật `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout`.
- **Migration có đánh số** trong `/migrations` (`NNN_ten_ngan.sql`), chạy tuần tự, đánh dấu bảng `schema_migrations`. **Cấm** sửa schema thủ công hoặc sửa file migration đã chạy; muốn đổi thì thêm migration mới.
- **Tiền tố bảng theo feature**: `mindmap_nodes`, `vocab_entries`, `flashcards_cards`. Mỗi feature chỉ đọc/ghi bảng của mình.
- Chỉ dùng **prepared statement** có tham số (`?`). Cấm nối chuỗi SQL từ input.
- SQL chỉ tồn tại trong `repo.ts`. Hàm repo trả về object đã map (camelCase), không lộ row thô ra ngoài.
- Thao tác nhiều bước cần nhất quán → bọc trong transaction ở `repo.ts` (hoặc helper `withTransaction` trong `core/db.ts`).
- **Backup:** cron copy file `.sqlite` (dùng `VACUUM INTO` hoặc `.backup`, không copy thô khi đang ghi) vào `data/backups/`, giữ N bản gần nhất.

### 4.4 Gọi AI

- Mọi lời gọi LLM đi qua `core/ai.ts`. Feature **không** tự gọi SDK/HTTP của nhà cung cấp.
- `core/ai.ts` chịu trách nhiệm: chọn model (một chỗ duy nhất), timeout, retry có giới hạn, log (model, token, thời gian, lỗi), chuẩn hóa lỗi. Hàm nhận `userId` để log và giới hạn chi phí theo người dùng về sau.
- Prompt của feature để trong file riêng của feature (`prompts.ts`) hoặc hằng số trong `service.ts`; **không** hardcode rải rác trong UI.
- Output cần cấu trúc → yêu cầu JSON + validate bằng zod, có xử lý khi parse lỗi. Không tin output LLM.
- API key chỉ đọc từ env qua `core/config.ts`, không bao giờ xuống client.

### 4.5 Next.js routing — giữ mỏng

- File trong `src/app/**` chỉ là **adapter**: re-export/mount từ `features/*`. Mục tiêu mỗi file vài dòng.
  ```ts
  // src/app/api/vocab/route.ts
  export { GET, POST } from "@/features/vocab/api";
  ```
  ```tsx
  // src/app/vocab/page.tsx
  export { default } from "@/features/vocab/ui/VocabPage";
  ```
- Trang dùng state/hook phía client → khai báo `"use client"` ở component trong `features/*/ui`, không phải ở file `app/`.
- Truy cập DB / đọc env chỉ ở server (route handler, server component). Component client không import `core/db`, `core/ai`, `core/config`.

### 4.6 Validation & xử lý lỗi

- Mọi input từ ngoài (body, query, params) **phải** parse bằng zod ở `api.ts`; schema định nghĩa trong `types.ts`.
- Định dạng response API thống nhất (qua `core/http.ts`):
  ```ts
  // thành công
  { ok: true, data: T }
  // thất bại
  { ok: false, error: { code: string, message: string } }
  ```
- Lỗi nghiệp vụ dùng class lỗi có `code` (vd `NotFoundError`, `ValidationError`); `api.ts` map sang HTTP status. Không `throw` chuỗi thô; không nuốt lỗi im lặng.
- Log lỗi ở server kèm ngữ cảnh (feature, hành động). Không log secret/dữ liệu nhạy cảm.

### 4.7 TypeScript

- `strict: true`. Cấm `any` (dùng `unknown` + zod). Ngoại lệ phải có comment lý do.
- Type suy ra từ zod schema (`z.infer`) để một nguồn sự thật.
- Dùng alias `@/` cho import; không dùng đường dẫn tương đối vượt quá một cấp (`../../..`).
- Không `export default` trong `service/repo/types` (dùng named export để agent grep dễ). `default` chỉ cho page/component theo yêu cầu của Next.

### 4.8 Phần Shared (`core/`) — danh sách đóng

1. `db/` — kết nối, migration, driver (mục 4.11)
2. `auth.ts` — `requireUser()`, kiểu `Ctx` (mục 4.10)
3. `ai.ts` — wrapper LLM
4. `http.ts` — helper response/error
5. `config.ts` — env + hằng số
6. `ids.ts`, `log.ts` — sinh ID, log có cấu trúc
7. (tùy chọn) schema/type dùng chung giữa **từ 2 feature trở lên**

Thêm mục mới vào danh sách này cần ghi `docs/decisions.md`.

**Cấm** tạo `utils.ts`, `helpers.ts`, `common/` chứa đồ linh tinh. Một hàm tiện ích chỉ một feature dùng → để trong feature đó. Chỉ chuyển lên `core/` khi **đã có ≥ 3 nơi dùng** và ý nghĩa rõ ràng.

### 4.9 Đa người dùng & quyền sở hữu dữ liệu

Hôm nay chủ yếu một người dùng, nhưng mô hình dữ liệu và code **không được giả định điều đó**.

| Làm ngay (seam rẻ) | Chờ tới khi cần (hạ tầng đắt) |
|---|---|
| `user_id` trên mọi bảng dữ liệu người dùng, `Ctx` truyền xuống mọi tầng | Quota/billing, tổ chức/nhóm, chia sẻ dữ liệu giữa người dùng |
| Repo async, ID tự sinh, auth tập trung | Postgres, Redis, queue, nhiều instance |
| Cache key và đường dẫn file có `userId` | RBAC phức tạp, SSO |

Quy tắc:

1. Mọi bảng chứa dữ liệu của người dùng có `user_id TEXT NOT NULL` và index (thường composite `(user_id, ...)`). Bảng cấu hình toàn hệ thống thì không cần, nhưng README của feature phải ghi rõ "global".
2. Hàm public của feature, `service` và `repo` nhận `ctx: Ctx` (hoặc `userId`) làm tham số **đầu tiên**. Cấm biến global/singleton giữ "người dùng hiện tại".
3. Mọi query đọc/ghi dữ liệu người dùng **bắt buộc** có `WHERE user_id = ?`, kể cả `UPDATE`/`DELETE`. Không tin ID từ client để xác định quyền sở hữu.
4. Truy cập tài nguyên của người khác trả `NotFoundError` (không tiết lộ sự tồn tại).
5. Ràng buộc duy nhất tính theo người dùng: `UNIQUE(user_id, ...)`.
6. Cache key, tên file, key lưu trữ phía client đều gắn `userId`.
7. Dữ liệu hiện có: migration thêm `user_id` phải **backfill** bằng ID của chủ ứng dụng (owner), không để NULL.

### 4.10 Xác thực & phân quyền

- Auth là một feature (`features/auth`) cộng helper `core/auth.ts`. Code login hiện có (sơ khai) được gom vào đây khi refactor. **Không viết lại cơ chế** trừ khi có lỗi bảo mật; chỉ củng cố.
- **Deny-by-default:** `middleware.ts` chặn mọi route trừ allowlist công khai (`/login`, `/api/auth/*`, tài nguyên tĩnh, `/api/health`). Route mới tự động được bảo vệ.
- Mọi `api.ts` lấy người dùng qua `requireUser()` rồi truyền `ctx` xuống service. Service/repo **không** đọc cookie/header.
- Session: cookie `httpOnly`, `secure`, `sameSite=lax`, có hạn và gia hạn. Ưu tiên session lưu DB (`auth_sessions`) vì thu hồi được. Nếu chọn JWT thì ghi lý do vào `docs/decisions.md`.
- Mật khẩu: hash bằng argon2id (hoặc bcrypt), không lưu thô, không log. Giới hạn tần suất đăng nhập sai.
- Phân quyền tối thiểu: cột `role` (`owner` | `user`). Chỉ thêm RBAC khi có nhu cầu thật.
- Mạng riêng Tailscale **không thay thế** auth ứng dụng; auth vẫn bắt buộc.
- Không tự chế crypto. Nếu đổi sang thư viện auth phổ biến, chỉ đổi bên trong `core/auth.ts` và `features/auth`, không rải ra feature khác.

### 4.11 Tính di động của DB (SQLite → Postgres hoặc DB khác)

Mục tiêu: đổi DB chỉ phải sửa `core/db/` và `repo.ts`, không đụng `service`, `api`, `ui`.

1. `repo` là biên duy nhất với DB. Ngoài `core/db/` không import driver (`better-sqlite3`, `pg`, …).
2. Mọi hàm `repo` và `core/db` là **async** (trả `Promise`), kể cả khi driver hiện tại đồng bộ. Nhờ vậy đổi sang DB mạng không phải sửa nơi gọi.
3. Viết SQL chuẩn. Tránh tính năng riêng SQLite: `INSERT OR REPLACE`, `rowid`, `AUTOINCREMENT`, `strftime`, `GLOB`, kiểu động. Dùng `INSERT ... ON CONFLICT` và `RETURNING` (cả hai DB hỗ trợ). Nếu bắt buộc dùng cú pháp riêng, gom vào một hàm repo riêng và comment `-- DB-SPECIFIC`.
4. Kiểu dữ liệu: ID là `TEXT` (ULID/UUID sinh ở app qua `core/ids.ts`), không dựa vào auto-increment/rowid. Thời gian lưu một định dạng thống nhất (ISO-8601 UTC hoặc epoch ms). Boolean map trong repo. JSON lưu dạng text, serialize/parse trong repo và validate bằng zod.
5. Placeholder và transaction đi qua helper của `core/db/` (`query`, `withTransaction`). Repo không tự nối chuỗi SQL, không tự gọi `BEGIN`/`COMMIT`.
6. Migration: file SQL đánh số, viết chung nhất có thể. Khi chuyển DB: thêm thư mục theo dialect, chạy migrate từ đầu trên DB trống, rồi di chuyển dữ liệu bằng script export/import một lần có kiểm đếm số dòng từng bảng.
7. Nếu viết SQL thô thấy đau, có thể dùng query builder/ORM (Kysely, Drizzle). Khi dùng: đóng gói trong `repo.ts`, repo vẫn trả **domain type**, không để type của ORM rò ra ngoài.

Tín hiệu nên cân nhắc chuyển DB (ghi `docs/decisions.md` trước khi làm): lỗi `SQLITE_BUSY` do ghi đồng thời, cần chạy nhiều instance, cần replica/HA, nhu cầu truy vấn/index/JSON/full-text phức tạp, hoặc dữ liệu lớn vượt khả năng quản lý bằng một file.

### 4.12 Sẵn sàng vận hành khi scale

- **Stateless:** không giữ state nghiệp vụ trong biến module/bộ nhớ. Cache chỉ là tối ưu; mất cache vẫn phải đúng. State thật nằm trong DB.
- **Cấu hình qua env:** đọc và validate bằng zod trong `core/config.ts`, fail fast khi thiếu. Không hardcode URL, port, đường dẫn tuyệt đối, tên model.
- **File/upload:** truy cập qua `core/storage.ts` (hiện ghi đĩa cục bộ, sau có thể đổi sang object storage). Tạo module này khi có file đầu tiên cần lưu, không ghi file rải rác với đường dẫn tự do.
- **Tác vụ nền/cron:** đặt trong `features/<x>/jobs.ts`, gọi qua một điểm vào duy nhất có bảo vệ; phải **idempotent**. Chưa dựng queue; thêm khi job chạy lâu hoặc cần retry (mục 9).
- **Log có cấu trúc:** một dòng JSON, kèm `userId`, feature, `requestId`. Có endpoint `/api/health`.
- **Danh sách có thể lớn:** luôn phân trang (`limit` + `cursor`), không tải toàn bộ bảng.

---

## 5. Quy tắc cho AI agent khi làm việc

### 5.1 Trước khi sửa

1. Đọc `ARCHITECTURE.md` (file này) và `README.md` của feature liên quan.
2. Chỉ đọc file trong feature cần sửa + `index.ts` của feature phụ thuộc. **Không** quét toàn bộ repo nếu không cần.
3. Nếu thay đổi chạm nhiều feature, liệt kê file sẽ sửa trước, rồi mới làm.

### 5.2 Khi sửa

- Thay đổi **nhỏ nhất** đáp ứng yêu cầu. Không tiện tay đổi style, đổi tên, "dọn dẹp" ngoài phạm vi.
- Không thêm thư viện mới khi chưa có lý do rõ; nếu thêm, dùng `pnpm add` và nêu lý do.
- Không xóa/đổi tên thứ đang được export qua `index.ts` mà chưa cập nhật mọi nơi dùng (grep trước).
- Sau khi sửa: chạy typecheck + lint + build (lệnh trong `AGENTS.md` / `package.json`). Báo rõ nếu không chạy được.
- Thay đổi schema DB → thêm file migration mới, cập nhật `repo.ts`, `types.ts`, và README của feature.

### 5.3 Những việc **không được tự ý làm**

- Đổi hành vi/UI người dùng thấy trong lúc refactor.
- Sửa hoặc xóa dữ liệu trong file SQLite thật; đổi/xóa migration đã có.
- Thêm abstraction "cho tương lai" (interface, factory, event bus, plugin system) khi chưa có hai chỗ dùng thật sự.
- Gộp nhiều feature vào một file để "cho gọn".
- Tạo bảng/dữ liệu người dùng mà không có `user_id`, hoặc viết query dữ liệu người dùng thiếu `WHERE user_id = ?`.
- Viết SQL/kiểu dữ liệu chỉ chạy trên SQLite ngoài khối `-- DB-SPECIFIC`; import driver DB ngoài `core/db/`.
- Bỏ qua, nới lỏng hoặc "tạm tắt" auth/middleware để cho tiện test.
- Dựng hạ tầng chưa cần (Postgres, Redis, queue, container hóa) khi không được yêu cầu.
- Commit secret, file `.sqlite`, hoặc `.env`.

### 5.4 Khi không chắc

Dừng lại, nêu 2–3 phương án kèm đánh đổi, đề xuất một cái. Không đoán mò ở chỗ ảnh hưởng dữ liệu hoặc ranh giới giữa feature.

---

## 6. README cho từng feature (bắt buộc, ngắn)

Mỗi `features/<name>/README.md` ≤ ~60 dòng, đúng khuôn:

```md
# <Tên feature>

**Mục đích:** 1–2 câu.
**Route UI:** /xxx        **Route API:** /api/xxx

## Bảng DB sở hữu
- `xxx_table` — mô tả ngắn, cột quan trọng

## Public API (index.ts)
- `hamA(input): Output` — làm gì

## Phụ thuộc
- Gọi: `flashcards.createCard`, `core/ai`
- Được gọi bởi: (feature nào)

## Quy tắc / lưu ý riêng
- Các bẫy, ràng buộc, quyết định đặc biệt của feature
```

Quy tắc: **README là hợp đồng**. Đổi public API, bảng DB hay phụ thuộc → cập nhật README trong cùng thay đổi. README lỗi thời tệ hơn không có README.

---

## 7. Kế hoạch refactor (thực hiện tuần tự, KHÔNG đập đi làm lại)

> Mỗi bước phải để app **chạy được và hành vi không đổi** trước khi sang bước tiếp. Commit riêng cho từng bước.

**Bước 0 — Chuẩn bị**
- Chốt baseline: app build được, ghi lại danh sách route + bảng DB hiện có (đưa vào `docs/decisions.md`).
- Backup file SQLite.

**Bước 1 — Dựng `core/`**
- Tách kết nối DB, wrapper AI, helper response/error, config từ code hiện có.
- Thêm hệ thống migration; biến schema hiện tại thành `001_init.sql` (đúng với DB đang chạy, **không** làm mất dữ liệu).
- Dựng `core/db/` với API **async** (bọc better-sqlite3 hiện tại), `core/ids.ts`, `core/log.ts`, `core/config.ts` có validate env.

**Bước 1b — Nền tảng auth & đa người dùng**
- Gom code login hiện có vào `features/auth` + `core/auth.ts` (`requireUser()`, `Ctx`), **giữ nguyên hành vi đăng nhập**. Thêm `middleware.ts` deny-by-default với allowlist.
- Thêm migration: bảng users (nếu chưa có), cột `user_id` cho các bảng dữ liệu người dùng, **backfill** bằng ID của owner, thêm index.
- Cập nhật `repo`/`service` nhận `ctx` và thêm `WHERE user_id = ?`. Làm theo từng feature ở Bước 2 thay vì sửa cả app một lần.

**Bước 2 — Refactor từng feature, từng route một**
Với mỗi route (ưu tiên route hay sửa/file dài nhất trước):
1. Tạo `features/<name>/` theo cấu trúc mục 2.
2. Tách file lớn thành `types.ts` → `repo.ts` → `service.ts` → `api.ts` → `ui/`, **di chuyển code nguyên văn**, chỉ đổi chỗ + import.
3. Biến file trong `src/app/**` thành adapter mỏng (mục 4.5).
4. Viết `README.md` + `index.ts` (ban đầu có thể rỗng).
5. Kiểm tra: typecheck, build, thử tay các thao tác chính của trang đó.

**Bước 3 — Nối các feature**
- Thêm `flashcards.createCard` + cột `source_type/source_id`.
- Thêm nút "Gửi sang flashcard" ở mindmap và vocab (gọi qua API flashcards).

**Bước 4 — Dọn dẹp**
- Xóa code chết, kiểm tra import vi phạm ranh giới (mục 8), cập nhật README.

**Về sau:** mỗi lần chạm vào một route chưa refactor để sửa lỗi/thêm tính năng, tách luôn theo mục 2 (boy-scout rule).

---

## 8. Kiểm tra & ràng buộc tự động (khuyến nghị)

- **Lint import boundary**: dùng `eslint-plugin-boundaries` hoặc `no-restricted-imports` để cấm:
  - `features/*/(repo|service|api|ui)` bị import từ **feature khác** (chỉ cho `index.ts`).
  - `ui/**` import `repo`, `service`, `core/db`, `core/ai`.
  - `core/**` import từ `features/**`.
  - Import driver DB hoặc gọi `core/db` ngoài `repo.ts`; viết SQL ngoài `repo.ts`.
- Script đếm dòng: cảnh báo file > 250 dòng, lỗi nếu > 400.
- CI/local script: `typecheck`, `lint`, `build`.
- Test: ưu tiên test cho `service.ts` và `repo.ts` (SQLite in-memory). Không bắt buộc test UI.

---

## 9. Khi nào được phá quy tắc / nâng cấp kiến trúc

Chỉ cân nhắc khi **đã gặp vấn đề thực tế** và ghi vào `docs/decisions.md` (bối cảnh – quyết định – hệ quả):

| Tín hiệu | Hành động có thể |
|---|---|
| Một thao tác ở feature A phải kích hoạt ≥ 3 feature khác, nối trực tiếp thành rối | Cân nhắc event nội bộ đơn giản (in-process emitter) |
| `repo.ts` quá lớn (> 400 dòng) | Tách theo thực thể: `repo/nodes.ts`, `repo/maps.ts` |
| Hàm tiện ích bị copy ở ≥ 3 feature | Đưa lên `core/` |
| Cần type-safe query/schema phức tạp hơn | Cân nhắc Drizzle ORM (vẫn đóng gói trong `repo.ts`) |
| Một feature phình thành nhiều khái niệm độc lập | Tách thành feature mới |
| `SQLITE_BUSY` thường xuyên, cần nhiều instance, replica/HA | Chuyển Postgres theo mục 4.11 (chỉ sửa `core/db/` + `repo.ts`) |
| Số người dùng tăng, cần chặn lạm dụng AI/tài nguyên | Thêm rate limit và quota theo `userId` trong `core/ai.ts` / middleware |
| Job nền chạy lâu hoặc cần retry | Thêm hàng đợi (vd BullMQ/pg-boss); job vẫn idempotent |
| Cần cache dùng chung giữa nhiều instance | Thêm Redis phía sau một module `core/cache.ts` |
| Cần phân quyền theo vai trò/nhóm | Mở rộng cột `role` thành RBAC; giữ kiểm tra tập trung ở `core/auth.ts` |
| Cần triển khai nhiều môi trường | Thêm Dockerfile/CI; cấu hình hoàn toàn qua env

---

## 10. Checklist hoàn thành cho mỗi thay đổi

- [ ] Không file nào vượt 400 dòng (mục tiêu ≤ 250).
- [ ] Không import chéo vào file nội bộ của feature khác.
- [ ] SQL chỉ nằm trong `repo.ts`, dùng prepared statement.
- [ ] Input ngoài được validate bằng zod; response theo chuẩn `{ ok, data | error }`.
- [ ] Gọi AI qua `core/ai.ts`; không lộ key/secret ra client.
- [ ] Thay đổi schema có migration mới; không sửa migration cũ.
- [ ] `index.ts` và `README.md` của feature đã cập nhật nếu đổi public API / DB / phụ thuộc.
- [ ] Typecheck, lint, build đều qua; hành vi cũ không đổi (với refactor).
- [ ] Bảng dữ liệu người dùng có `user_id` + index; mọi query lọc theo `user_id`; hàm nhận `ctx`.
- [ ] Route/API mới nằm sau auth (middleware + `requireUser()`), không mở ngoại lệ ngoài allowlist.
- [ ] Repo async, không dùng cú pháp riêng SQLite ngoài khối `-- DB-SPECIFIC`; ID sinh từ `core/ids.ts`.
- [ ] Không thêm state trong bộ nhớ server; danh sách lớn có phân trang.
- [ ] Quyết định kiến trúc đáng nhớ đã ghi vào `docs/decisions.md`.
