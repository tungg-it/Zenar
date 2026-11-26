# Zenar: ứng dụng gọi API lưu bằng Git, thay thế Postman và Bruno

[English](README.md) · **Tiếng Việt** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

**Zenar là ứng dụng desktop miễn phí, gọn nhẹ để gọi API (thay thế Postman, Bruno). Zenar lưu Collection trong một repo Git thường và tự gộp thay đổi của đồng đội, nên cả người không rành Git vẫn cộng tác được qua Git.**

Gửi request REST và GraphQL, chia sẻ một Collection cho cả đội qua GitHub hoặc GitLab (kể cả tự host) mà không bao giờ thấy dấu xung đột merge. Git chạy ngầm; bạn chỉ thấy **Lưu** và **Xung đột**.

> Zenar là app desktop native (Tauri + Rust), không phải Electron. Không cần tài khoản, không có workspace trên cloud, không telemetry. Chạy được offline.

Từ khoá: API client, REST client, GraphQL client, thay thế Postman, thay thế Bruno, test API offline, collection API lưu bằng Git, công cụ test API cho đội nhóm.

## Vì sao chọn Zenar

- **Git là lớp đồng bộ.** Một Collection là một repo Git. Mỗi Request là một file YAML riêng nên diff và pull request dễ đọc.
- **Xung đột do app tự xử lý.** Zenar gộp theo từng Field (method, URL, từng header, từng query param, auth, body, script) chứ không theo dòng văn bản. Hai người sửa hai header khác nhau của cùng một request sẽ không xung đột, và bạn không bao giờ thấy `<<<<<<<`. Không bao giờ force push.
- **Dành cho người không rành Git.** Clone, commit, pull, push được ẩn sau nút Lưu và màn hình xung đột.
- **Secret ở lại trên máy bạn.** Giá trị Secret nằm trong một file trong thư mục dữ liệu của Zenar trên máy bạn, không vào repo. Đồng đội chỉ thấy tên biến và tự điền giá trị của mình.
- **Nhập collection từ Postman.** Script viết cho `pm.*` vẫn chạy (API riêng của Zenar là `zn.*`).
- **Không có server của chúng tôi.** App chỉ nói chuyện với host Git và API của bạn. Lời gọi mạng riêng duy nhất là kiểm tra cập nhật.
- **Nhẹ và nhanh.** Lõi Rust, giao diện sáng/tối.

## Zenar so với Postman và Bruno

|  | **Zenar** | **Postman** | **Bruno** |
| --- | --- | --- | --- |
| Collection nằm ở đâu | Repo Git của bạn, mỗi request một file YAML | Workspace trên cloud của Postman (có thể export) | Thư mục file `.bru`, thường commit vào Git |
| Cần tài khoản | Không | Có (đa số tính năng cần đăng nhập) | Không |
| Dùng hoàn toàn offline | Có | Hạn chế (chế độ Scratch Pad) | Có |
| Cộng tác nhóm | Qua mọi host Git bằng HTTPS (GitHub, GitLab, tự host) | Cloud của Postman, gói tính theo người dùng | Qua Git, bạn tự dùng công cụ Git |
| App tự lo Git | **Có**: Lưu, pull, push tự động, Git bị ẩn | Một phần, tuỳ gói | Không, bạn tự chạy Git |
| Xử lý xung đột | **Tự gộp theo Field**, chỉ hỏi khi thật sự trùng | Versioning và fork trên cloud | Merge văn bản thông thường của Git |
| Secret | File trên máy bạn, không vào repo | Lưu trong tài khoản Postman | Giữ ngoài Git theo quy ước (file secret và `.env`) |
| Nhập collection Postman | Có, script `pm.*` vẫn chạy | Gốc | Có |
| Telemetry | Không | Dịch vụ cloud gắn tài khoản | Có thể tắt |
| Nền tảng app | Native (Tauri + Rust) | Electron | Electron |
| Giá | Miễn phí | Có gói miễn phí, gói nhóm tính phí | Miễn phí, bản Golden Edition tính phí |

Thông tin về đối thủ tóm tắt từ tài liệu công khai của họ và có thể thay đổi. Hãy xem trang chủ của từng hãng trước khi quyết định. Cần sửa gì, xin mở issue.

## Tải và cài đặt

**Phiên bản mới nhất: 0.1.1**

| Hệ điều hành | File cần tải | Cách cài |
| --- | --- | --- |
| **macOS** (Apple Silicon và Intel) | [`Zenar_0.1.1_universal.dmg`](https://updates-zenar.tungit.io.vn/stable/0.1.1/Zenar_0.1.1_universal.dmg) | Mở `.dmg`, kéo **Zenar** vào **Applications**. Nếu macOS báo app từ nhà phát triển không xác định, bấm chuột phải vào app, chọn **Open**, rồi **Open** lần nữa. Hoặc chạy `xattr -dr com.apple.quarantine /Applications/Zenar.app`. |
| **Windows** 10 / 11 (x64) | [`Zenar_0.1.1_x64-setup.exe`](https://updates-zenar.tungit.io.vn/stable/0.1.1/Zenar_0.1.1_x64-setup.exe) | Chạy bộ cài. Bản build chưa được ký số nên SmartScreen có thể cảnh báo: bấm **More info**, rồi **Run anyway**. Trên Windows 11 đang bật **Smart App Control**, bộ cài bị chặn hẳn (không có nút Run anyway): tắt Smart App Control trong **Windows Security → App & browser control → Smart App Control settings**, rồi chạy lại. Trên một số bản Windows, đã tắt Smart App Control thì không bật lại được nếu không cài lại Windows, nên hãy cân nhắc trước, hoặc chờ bản đã ký số. Hỗ trợ Windows còn đang thử nghiệm. |
| **Linux**: mọi bản phân phối | [`Zenar_0.1.1_amd64.AppImage`](https://updates-zenar.tungit.io.vn/stable/0.1.1/Zenar_0.1.1_amd64.AppImage) | `chmod +x Zenar_0.1.1_amd64.AppImage && ./Zenar_0.1.1_amd64.AppImage`. Bản này tự cập nhật. |
| **Linux**: Debian / Ubuntu | [`Zenar_0.1.1_amd64.deb`](https://updates-zenar.tungit.io.vn/stable/0.1.1/Zenar_0.1.1_amd64.deb) | `sudo apt install ./Zenar_0.1.1_amd64.deb` |
| **Linux**: Fedora / RHEL / openSUSE | [`Zenar-0.1.1-1.x86_64.rpm`](https://updates-zenar.tungit.io.vn/stable/0.1.1/Zenar-0.1.1-1.x86_64.rpm) | `sudo dnf install ./Zenar-0.1.1-1.x86_64.rpm` |

Yêu cầu: **phải cài Git** (Zenar dùng lệnh `git` và credential helper của hệ thống). Linux cần thêm WebKitGTK 4.1 (`libwebkit2gtk-4.1`).

**Cập nhật.** App macOS và AppImage trên Linux tự kiểm tra bản mới, xác minh chữ ký rồi cài và mở lại. Chữ ký sai sẽ không bao giờ được cài. Với `.deb`, `.rpm` và bộ cài Windows, bạn tải file mới về tay.

## Bắt đầu nhanh

1. Mở Zenar và đăng nhập Git bằng thông tin xác thực Git quen thuộc (HTTPS).
2. **Mở một Collection** từ URL repo Git, hoặc tạo mới. Zenar clone về máy bạn.
3. Tạo request và folder, chọn **Environment** (dev, staging, ...), rồi bấm **Send**.
4. Bấm **Lưu**. Đồng đội nhận thay đổi ở lần đồng bộ tiếp theo. Nếu hai người sửa cùng một Field, Zenar sẽ hỏi giữ bản nào.

## Tính năng

- Request REST: method, query param, header, auth, body JSON / form-data / urlencoded / raw / binary
- GraphQL có biến
- Folder, folder lồng nhau, kéo thả
- Environment, Secret và Captured Variable
- Script JavaScript trước khi gửi và sau khi có response (`zn.*`, tương thích `pm.*`)
- Nhập collection Postman
- Gộp 3 bản theo Field, màn hình xung đột, không force push
- Giao diện sáng/tối, bản native cho macOS, Windows, Linux, tự cập nhật có chữ ký

## Câu hỏi thường gặp

**Zenar có phải bản thay thế Postman không?** Có. Zenar là app desktop miễn phí để gửi request HTTP, REST và GraphQL, và nhập được collection Postman.

**Zenar khác Bruno thế nào?** Cả hai đều lưu collection thành file để đưa vào Git. Với Bruno bạn tự chạy Git. Zenar chạy Git giúp bạn và gộp các sửa đổi trùng nhau theo từng Field, phù hợp với đội có tester, PM hay CSKH không dùng Git.

**Zenar có cần tài khoản hay server không?** Không. Zenar làm việc với host Git bạn đang dùng, kể cả GitLab tự host, và không có telemetry.

**Secret được lưu ở đâu?** Trong file `secrets.json` ở thư mục dữ liệu của Zenar, chỉ trên máy bạn:

- macOS: `~/Library/Application Support/app.zenar.desktop/secrets.json`
- Windows: `%APPDATA%\app.zenar.desktop\secrets.json`
- Linux: `~/.local/share/app.zenar.desktop/secrets.json` (hoặc `$XDG_DATA_HOME/app.zenar.desktop/secrets.json`)

File ở dạng văn bản thường (trên macOS và Linux chỉ tài khoản của bạn đọc được) và không bao giờ vào repo. Bản 0.1.0 lưu Secret trong keychain của hệ điều hành và không được chuyển sang, nên sau khi cập nhật từ 0.1.0 hãy điền lại giá trị Secret.

**Có chạy offline được không?** Có. Collection là bản clone trên máy. Đồng bộ khi có mạng lại.
