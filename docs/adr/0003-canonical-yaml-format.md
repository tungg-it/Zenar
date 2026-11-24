# Format file: YAML dạng chuẩn cố định, mỗi Request một file, id nằm trong file

Mỗi Request là một file YAML đặt tên theo tên Request (`users/get-user-by-id.yaml`). Trong file có id cố định của Request, id của từng header/param/biến, và trường `order` dạng số thập phân thưa. Thư mục gốc có `collection.yaml` chứa `formatVersion`. App luôn ghi lại theo đúng một dạng chuẩn: thứ tự key cố định, body viết bằng block `|`, không dùng anchor hay alias. Khi đọc gặp trường lạ thì giữ nguyên lúc ghi. Lý do: tên file đọc được giúp review trên GitHub dễ hơn. Id nằm trong file giúp nhận ra đổi tên, di chuyển và xóa (ADR 0002). Thứ tự đặt trong từng file giúp hai người cùng thêm Request vào một Folder mà không đụng nhau.

## Considered Options

- Dùng lại OpenCollection YAML của Bruno: bị loại vì format do đối thủ kiểm soát, và cần id ổn định cho merge theo Field. Thay vào đó app có import/export.
- Đặt tên file theo id: bị loại vì không đọc được khi xem trên GitHub.
- Giữ danh sách thứ tự trong `folder.yaml`: bị loại vì hai người cùng thêm Request vào một Folder sẽ luôn xung đột.
