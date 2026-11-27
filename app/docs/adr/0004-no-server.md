# Không có server của riêng app

App là client thuần. Không đăng nhập vào nhà cung cấp nên không có client secret hay token cần giữ (ADR 0007). Thay đổi của người khác được phát hiện bằng cách fetch định kỳ, không có push realtime. Không có telemetry.

Bản source này không có cơ chế Update: app không gọi tới địa chỉ nào ngoài remote Git của Collection và các URL mà Request gửi tới.

Lý do: một app miễn phí chỉ bền vững khi gần như không có chi phí hạ tầng, và doanh nghiệp dùng GitLab tự host không muốn dữ liệu đi qua bên thứ ba. Ai muốn thêm tính năng cần backend có compute, ví dụ thông báo realtime hoặc mời Member, phải xem lại quyết định này trước.

