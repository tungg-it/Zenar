# Lõi bằng Rust, UI bằng TypeScript + React trên Tauri

Mọi logic nghiệp vụ nằm trong các crate Rust thuần, không phụ thuộc Tauri: format (`zenar-format`), merge (`zenar-merge`), Git qua tiến trình `git` của hệ thống (`zenar-git`, ADR 0007), chạy request qua `reqwest` (`zenar-http`). UI viết bằng TypeScript + React và chỉ hiển thị, gọi lõi qua Tauri commands với kiểu dữ liệu sinh tự động từ Rust. Lý do: format và merge là phần khó đảo ngược nhất nên phải test được mà không cần UI, và lõi tách riêng thì sau này dùng lại được cho CLI chạy Collection trong CI. Git, HTTP và kho Secret trên máy đằng nào cũng phải chạy ngoài webview (CORS, credential, file).

## Considered Options

- Electron + Node: bị loại vì app nặng hơn nhiều, và hệ sinh thái libgit2 phía Node kém hơn.
- Svelte/Solid cho UI: nhẹ hơn, nhưng React có nhiều component sẵn hơn (cây kéo thả, editor, diff) và nhiều người đóng góp biết React hơn.
