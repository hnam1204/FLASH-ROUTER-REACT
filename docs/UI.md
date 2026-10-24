# UX contract

Single page: header/status -> account import -> searchable/paginated account list + detail -> Live Console -> resource monitor. On mobile use cards and a collapsible console, not horizontal overflow for critical controls.

- Title: FLASH ROUTER. Footer/credits: **by @hnam1204**, click `https://zalo.me/0379052767`.
- Official logo is pending. Do not invent an official logo or imply a placeholder is product-ready.
- Copy uses natural Vietnamese: `Phiên đăng nhập đã hết hạn`, `Cần bạn xác minh`, `Chưa xác định`, `Đang chờ đến lượt`, `Trình duyệt đang chạy`.
- Name/plan auto detection requires trustworthy supported source; otherwise `Chưa xác định`, with last observed time.
- No credentials, TOTP secrets, token values or raw URL challenges shown in UI or Console.
- Every button has a real action, loading, disabled states and a clear error/recovery message.
- Deleting account has a confirmation dialog and exact scope; do not silently delete local/remote content.
