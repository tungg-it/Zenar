# Zenar

App desktop gọi API, lưu Collection trong một repo Git, dành cho cả người không rành Git. Git chạy ngầm; người dùng chỉ thấy Lưu và Xung đột.

## Language

### Nội dung

**Collection**:
Toàn bộ request mà một đội dùng chung. Mỗi Collection ứng với đúng một repo, và mỗi repo chỉ chứa một Collection.
_Avoid_: Workspace, Project

**Folder**:
Một nhóm Request trong Collection. Folder có thể lồng nhau.
_Avoid_: Group, Directory

**Request**:
Một yêu cầu HTTP đã được lưu, là đơn vị nhỏ nhất được lưu và có thể xung đột. Mỗi Request là một file riêng.
_Avoid_: Endpoint, API, Call

**Field**:
Một phần của Request có thể sửa độc lập, như method, URL, từng header, từng query param, auth hoặc body. Field là đơn vị app dùng để tự gộp và phát hiện Conflict.
_Avoid_: Trường, part, line

**Environment**:
Một bộ giá trị cho các biến được đặt tên (ví dụ dev, staging), dùng chung cho cả Collection. Environment nào đang được chọn là lựa chọn riêng của từng người.
_Avoid_: Env profile, Config

**Secret**:
Biến của Environment có giá trị chỉ nằm trên máy từng người, không bao giờ vào repo. Member chỉ thấy tên biến; mỗi người tự điền giá trị của mình (lưu trong thư mục dữ liệu của app trên máy đó, xem và sửa được trong tab của Environment), hoặc nhận giá trị từ một Member khác qua file export của Environment (chuyền tay, ngoài repo).
_Avoid_: Private variable, Credential

**Captured Variable**:
Biến lấy từ response của một Request để dùng trong các Request sau. Biến này chỉ sống trên máy của người chạy.
_Avoid_: Runtime variable, Extracted value

**Script**:
Đoạn JavaScript của một Request, chạy trước khi gửi (Before request) hoặc sau khi có response (After response), với API `zn` (giống `pm` của Postman; `pm` vẫn dùng được để script import từ Postman chạy nguyên). `zn.environment.set` sửa hoặc thêm biến vào Environment đang chọn (dùng chung với team; Secret thì chỉ lưu trên máy mình). `zn.variables`, `zn.globals`, `zn.collectionVariables` ghi thành Captured Variable, chỉ trên máy mình. Khi chưa chọn Environment, `zn.environment` cũng ghi thành Captured Variable.
_Avoid_: Test script, Hook

### Cộng tác

**Save**:
Hành động lưu một Request. Bấm Save là chia sẻ Request đó với mọi Member; không có bước đồng bộ riêng.
_Avoid_: Sync, Commit, Push, Đồng bộ

Trong code, `sync` (`syncCollection`, `useAutoSync`, `SyncReport`) chỉ là việc tự lấy thay đổi của Member khác về máy, chạy ngầm; nó không phải một hành động của người dùng và không bao giờ hiện ra trong giao diện như một bước riêng.

**Needs Attention**:
Danh sách các Request đang có Conflict chưa xử lý trên máy của một người.
_Avoid_: Conflict queue, Inbox

**Member**:
Người có quyền truy cập repo của một Collection, nhờ đó dùng chung Collection đó.
_Avoid_: Collaborator, User, Teammate

**Viewer**:
Member chỉ có quyền đọc repo: chạy Request được nhưng không Save được.
_Avoid_: Read-only user, Guest

**Conflict**:
Tình huống khi lưu một Request mà một Member khác đã sửa cùng một Field của Request đó kể từ lần mình lấy về. Nếu hai người sửa các Field khác nhau thì app tự gộp, không tính là Conflict. Request bị người này xóa hoặc chuyển đi trong lúc người kia sửa cũng là Conflict.
_Avoid_: Merge conflict

**Overwrite**:
Quyết định của người dùng khi có Conflict: những Field đang xung đột lấy bản của mình. Các thay đổi khác của Member kia vẫn được giữ.
_Avoid_: Force push

**Draft**:
Những thay đổi chưa lưu của một Request, chỉ có trên máy của một người. Khi người dùng không chọn Overwrite, phần thay đổi của họ trở lại thành Draft.
_Avoid_: Bản tạm, unsaved changes

### Ứng dụng

**Update**:
Phiên bản mới hơn của chính app Zenar, do người dùng chủ động chọn cài. Update không liên quan đến nội dung Collection và không phải việc lấy thay đổi của Member khác về máy. Khi Collection cần app mới hơn mới sửa được, Collection đó chỉ đọc cho đến khi người dùng cài Update.
_Avoid_: Upgrade, Patch, Sync, Đồng bộ
