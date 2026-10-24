# Đề xuất API Contract V1 (chưa triển khai)

A0 chốt schemas trong `packages/shared` trước khi A1/A2/A3/A4 cùng sửa code. Tất cả mutation route yêu cầu local access controls; các route không có implementation không được trả dữ liệu giả.

| Method | Route | Meaning |
| --- | --- | --- |
| GET | `/api/health/live` | Liveness thực |
| GET | `/api/health/ready` | DB/storage/runtime readiness thực |
| GET | `/api/accounts?cursor=&limit=&q=` | Cursor pagination, 1,000 rows |
| POST | `/api/accounts` | Create metadata (không nhận/lưu raw creds trong database) |
| PATCH | `/api/accounts/:id` | Metadata/browse policy update |
| POST | `/api/accounts/:id/browser/open` | Queue real Chrome launch |
| POST | `/api/accounts/:id/browser/close` | Gracefully close account-owned Chrome |
| POST | `/api/accounts/:id/check` | Observation attempt, may return UNKNOWN |
| DELETE | `/api/accounts/:id` | Explicit confirmation plus exact `expectedEmail` + local deletion |
| GET | `/api/jobs/:id` | Actual job progress |
| GET | `/api/events/stream` | Redacted SSE events |
| GET | `/api/diagnostics/:jobId` | Redacted diagnostics |

### Event contract

`event_id`, `timestamp`, `account_id?`, `job_id?`, `type`, `severity`, `stage`, `duration_ms?`, `safe_message`, `error_code?`.

### Requests console

Only safe metadata for app-owned internal requests and approved browser events. Never print raw request bodies/response bodies, session cookies, URLs with sensitive query data, Authorization headers, passwords or OTP.

### Error semantics

- `409 PROFILE_BUSY` when a profile is locked.
- `202` with real job ID for accepted queued work.
- `400` schema validation errors (Vietnamese user-facing presentation).
- `UNKNOWN` rather than `EXPIRED` when session status cannot be confirmed.
