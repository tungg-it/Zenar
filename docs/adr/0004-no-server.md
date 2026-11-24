# Không có server của riêng app

App là client thuần. Không đăng nhập vào nhà cung cấp nên không có client secret hay token cần giữ (ADR 0007). Thay đổi của người khác được phát hiện bằng cách fetch định kỳ, không có push realtime. Không có telemetry.

Bản cập nhật app tải từ một bucket Cloudflare R2 tĩnh, đặt sau domain `updates-zenar.tungit.io.vn` do chủ dự án kiểm soát (`/stable/latest.json` cùng các bundle đã ký). Bucket chỉ phục vụ file tĩnh: không có compute, app không gửi dữ liệu nào lên đó ngoài việc tải manifest và bundle. Đây là chi phí hạ tầng duy nhất của dự án và được chấp nhận vì gần như bằng 0 (free tier, không tính phí egress). URL manifest bị nhúng cứng vào mọi bản app đã phát hành, nên phải là domain riêng chứ không phải `r2.dev`, để sau này đổi nhà cung cấp mà không phải phát hành lại app.

Lý do: một app miễn phí và mã nguồn mở chỉ bền vững khi gần như không có chi phí hạ tầng, và doanh nghiệp dùng GitLab tự host không muốn dữ liệu đi qua bên thứ ba. Ai muốn thêm tính năng cần backend có compute, ví dụ thông báo realtime hoặc mời Member, phải xem lại quyết định này trước.

## Considered Options

- GitHub Releases làm nơi phát hành (phương án ban đầu): bị thay vì repo nguồn ở GitLab, và không muốn phải dựng thêm repo GitHub chỉ để phát hành.
- GitLab Releases / Package Registry: bị loại vì URL gắn với dự án GitLab, khó đổi nhà cung cấp.
