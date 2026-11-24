# Dán URL HTTPS của repo, xác thực bằng credential của Git trên máy, không OAuth

Người dùng mở Collection bằng cách dán URL HTTPS của repo. App không đăng nhập vào nhà cung cấp, không giữ token và không gọi API của host; mọi thao tác Git chạy qua lệnh `git` của hệ thống, nên credential helper, proxy và chứng chỉ CA của máy tự có hiệu lực. Lý do: OAuth buộc phải có một lớp tích hợp riêng cho mỗi host và không dùng được với GitLab tự host của doanh nghiệp. Dán URL thì host nào nói được Git qua HTTPS cũng chạy, kể cả GitHub, GitLab.com, GitLab tự host, Gitea, Bitbucket. Đổi lại, người dùng phải cài sẵn Git và đã đăng nhập vào host qua credential helper (ví dụ Git Credential Manager); app chỉ kiểm tra và hướng dẫn, không thay họ làm việc đó.

Hệ quả:

- Tác giả commit lấy từ `user.name`/`user.email` trong git config của máy; thiếu thì app hỏi một lần.
- Không có API nên không biết trước quyền của người dùng. Viewer chỉ lộ ra khi push bị từ chối: app đánh dấu Collection là chỉ xem trên máy đó và giữ nguyên Draft.
- Không có danh sách repo. Mở Collection chỉ nhận URL HTTPS (URL SSH bị từ chối kèm gợi ý link HTTPS tương ứng), và phân loại theo nội dung sau khi clone: repo rỗng thì app tạo `collection.yaml` và `.gitignore` rồi push; repo đã có `collection.yaml` thì mở như bình thường; repo có file khác thì từ chối và hướng dẫn tạo repo mới trống. App không bao giờ tự ghi `collection.yaml` vào repo đã có nội dung.
- Không có "đăng xuất". Thay bằng "Gỡ Collection khỏi máy này": xóa bản clone, Draft, cookie, Secret của Collection đó, cảnh báo nếu còn Save chưa push. App không xóa credential của helper vì chúng dùng chung với công cụ Git khác.
- Mở repo trong trình duyệt chỉ là mở lại chính URL đã dán; app không biết trang quản lý Member của từng host.

## Considered Options

- GitHub App (Device Flow) + OAuth cho GitLab (ADR 0005): bị loại vì mỗi host một lớp tích hợp, org admin phải cài app, và GitLab tự host không dùng được.
- Giữ `git2-rs` và gọi helper bằng `Cred::credential_helper`: vẫn cần `git` trong PATH để chạy helper, nên không còn lợi ích "không cần cài Git" mà còn mất proxy/CA/cấu hình `http.*` của người dùng.
- Dán Personal Access Token vào app và lưu trong keychain riêng của app: không cần Git đã cấu hình, nhưng phải tự giữ kho credential và dạy QA/BA tạo token.
