# Gộp theo Field của mô hình, không dùng merge text của Git

Khi có thay đổi chồng nhau trên cùng một Request, app tự đọc 3 bản (base, ours, theirs) và gộp theo từng Field (method, URL, từng header/param/biến theo id, auth, script; body là một Field). Kết quả merge theo dòng của Git không bao giờ được dùng. Lý do: merge text trên YAML có thể ra file hợp lệ nhưng sai nghĩa, ví dụ hai header `Authorization` trùng nhau, và người dùng không bao giờ thấy conflict marker. Overwrite chỉ ghi đè những Field đang xung đột, và luôn tạo commit mới lên trên, không bao giờ force push.

## Consequences

- Thuật toán merge là hàm thuần `(base, ours, theirs) → merged | conflicts`, phải viết và test trước UI.
- Format file phải có id ổn định cho từng phần tử trong danh sách (xem ADR 0003).
