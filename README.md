# FLASH ROUTER

**Maintainer:** [@hnam1204](https://github.com/hnam1204) · **Zalo:** [0379052767](https://zalo.me/0379052767)

## Tình trạng

MVP local đã được triển khai: Fastify + SQLite API, React/Vite dashboard, SSE console, queue cơ bản, profile supervisor bằng Playwright và deletion coordinator. Luồng đăng nhập vẫn yêu cầu người dùng hoàn tất các challenge chính thức trong Chrome; không có CAPTCHA/MFA bypass.

## Nền tảng

- Node.js 24.x, npm 11.x, Windows 11 host cho V1.
- React + TypeScript + Vite ở `apps/web`.
- Fastify + SQLite ở `apps/server`.
- Playwright + Chrome Stable cho Chrome profiles tách biệt.
- npm workspaces, **duy nhất nhánh `Main`**.

## Cấu trúc

- `apps/web` — giao diện một trang (responsive), bảng tài khoản, form, Console.
- `apps/server` — HTTP API + SSE + browser/session/deletion modules.
- `packages/shared` — hợp đồng dữ liệu dùng chung.
- `tests` — mã test lâu dài; không xóa khi cleanup.
- `docs` — kiến trúc, hợp đồng, công việc agent và acceptance.
- `.tmp/test-runs` — output kiểm thử tạm, không commit.

## Kiểm tra ứng dụng

```powershell
npm ci
npm run check
```

`npm run check` chạy structural checks, strict typecheck, unit tests và API integration tests. Browser/profile acceptance được chạy riêng vì cần Chrome thật.

## Nơi lưu dữ liệu người dùng

Không lưu profiles, database và bí mật trong thư mục Git. Với máy có ổ D: có thể chọn `D:\FLASH-ROUTER-DATA`; nếu không, dùng một thư mục app data thuộc tài khoản OS. Chỉ lưu đường dẫn trong cấu hình cục bộ không được commit.

## Bắt buộc trước khi phát hành

1. App server, UI, CRUD, browser runtime, monitoring và delete coordinator hoạt động thật.
2. Các tests và E2E có kết quả, không mock ở runtime production.
3. `npm ci && npm run build && npm test` PASS trên clean clone Windows sau khi agents bổ sung đầy đủ scripts và `package-lock.json`.
4. Kiểm tra profile isolation, dữ liệu nhạy cảm, restart, crash recovery và deletion.
5. Push lên `Main` chỉ sau khi chủ repository cho phép.

Xem [docs/AGENT_PLAN.md](docs/AGENT_PLAN.md) và [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
