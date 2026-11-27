---
status: superseded by ADR-0007
---

# Đăng nhập GitHub bằng GitHub App, không dùng OAuth App

App dùng token user-to-server của một GitHub App, lấy qua Device Flow. Token chỉ truy cập được những repo mà người dùng hoặc org đã cấp cho app. Lý do: OAuth App phải xin scope `repo`, tức là đọc và ghi được mọi repo private, và một app miễn phí không rõ người làm mà xin quyền đó sẽ bị IT/security của doanh nghiệp chặn. Đổi lại, org admin phải cài app một lần. GitLab không có mô hình tương đương nên dùng OAuth với scope `write_repository`.

## Considered Options

- OAuth App với scope `repo`: đơn giản hơn và không cần org cài đặt, nhưng xin quá nhiều quyền.
