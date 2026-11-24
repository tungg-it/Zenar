# Clone repo thật về máy và làm việc trên đó bằng Git

Mỗi máy clone repo của Collection về và làm việc trên đó bằng lệnh `git` của hệ thống (ADR 0007), không dùng API của nhà cung cấp để đọc hay ghi file. Lý do chọn: app chạy được offline, không bị rate limit, giữ được lịch sử đầy đủ, và chạy với mọi host Git qua HTTPS mà không cần lớp tích hợp riêng.

## Considered Options

- Chỉ gọi Contents/Commits API của nhà cung cấp, không có repo local: bị loại vì không chạy được offline, bị rate limit, và phải viết lại toàn bộ logic đồng bộ cho mỗi nhà cung cấp, kể cả GitLab tự host.
- Git nhúng bằng libgit2 (`git2-rs`) để người dùng không cần cài Git: từng được chọn, nhưng bị bỏ ở ADR 0007 vì cần credential helper của Git và để dùng đúng proxy/CA của máy.
