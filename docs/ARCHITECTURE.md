# Kiến trúc FLASH ROUTER V1

## Quyết định

- Modular monolith, TypeScript/npm workspaces; React + Vite (web), Fastify (API), SQLite (metadata), Playwright Chrome Stable (browser runtime).
- Windows runtime là host. Giao diện responsive có thể được mở ở thiết bị khác qua kết nối riêng bảo mật; không mở public API hoặc DevTools endpoint.
- Browser context dùng thư mục tách biệt do ứng dụng quản lý theo account ID; dữ liệu profile nằm ngoài source Git. Headed/headless là launch option, phải restart process khi đổi chế độ.
- SQLite giữ metadata, session observations, job/events; **không giữ plaintext password/TOTP, cookies hoặc token**.
- Backend không phụ thuộc việc Dashboard đang mở; UI nhận trạng thái theo REST + SSE.
- Chỉ lưu tên/gói nếu đọc được từ nguồn hợp lệ. Kèm `source`, `verified_at`; chưa biết hiện "Chưa xác định".

## Modules

| Module | Trách nhiệm | Agent |
| --- | --- | --- |
| `accounts` | account registry, validation, metadata | A1 |
| `database` | SQLite schema, migrations, transactions | A1 |
| `browser` | Chrome launch/close, profile mapping, locking | A2 |
| `sessions` | observations, state transitions, session reuse | A2 |
| `jobs` | admission control, worker queue, cancellation | A4 |
| `events` | SSE, sanitization, correlation IDs | A4 |
| `deletion` | coordinated local account/profile/artifact purge | A5 |
| `web` | responsive single dashboard + working commands | A3 |

## State machines (independent)

- `auth_status`: `UNKNOWN`, `LOGIN_REQUIRED`, `AUTHENTICATING`, `ACTION_REQUIRED`, `ACTIVE`, `EXPIRED`.
- `browser_status`: `STOPPED`, `STARTING`, `RUNNING`, `STOPPING`, `CRASHED`.
- `job_status`: `QUEUED`, `RUNNING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `CANCELLED`.
- A stopped Chrome **does not prove an expired session**; a browser start **does not prove login success**.

## Security boundaries

- API binds loopback; add CSRF/origin/admin access protections for mutation routes and remote access. No unrestricted debug socket.
- Protect local runtime data by OS filesystem permissions; no secret printouts in diagnostics.
- Source path is user-selected; Windows install defaults must not be hardcoded on other developer machines.
- User confirms destructive operations; deletion is resumable across crash and never follows symlinks/junctions outside owned root.

## Performance

1,000 registry records are acceptable design target but must be tested. On i7-13620H/15.71 GB RAM begin at 3 browsers, then tune based on measured free RAM/CPU, no unproven 20+ claim. Browser job launch must be rate-limited and resource-aware.

## Explicitly out of scope for V1 acceptance

- Guaranteed unattended email/password/TOTP login for every account/provider, defeating challenges or rate limits.
- An undocumented endpoint for reading any plan or transferring web cookies into separate requests clients.
- Cross-platform native browser runtime (the web frontend is cross-platform; the host runtime starts on Windows).
