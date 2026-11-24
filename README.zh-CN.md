# Zenar：基于 Git 的 API 客户端，Postman 与 Bruno 的替代品

[English](README.md) · [Tiếng Việt](README.vi.md) · **简体中文** · [日本語](README.ja.md)

**Zenar 是一款免费、轻量的桌面 API 客户端（Postman、Bruno 替代品）。它把 API 集合（Collection）存放在普通的 Git 仓库中，并自动合并队友的改动，因此不懂 Git 的人也能通过 Git 协作。**

发送 REST 和 GraphQL 请求，通过 GitHub 或 GitLab（包括自建）与团队共享同一个 Collection，永远不会看到合并冲突标记。Git 在后台静默运行，你只会看到**保存**和**冲突**。

> Zenar 是原生桌面应用（Tauri + Rust），不是 Electron 应用。无需账号，没有云端工作区，没有遥测，可离线使用。

关键词：API 客户端、REST 客户端、GraphQL 客户端、Postman 替代品、Bruno 替代品、离线 API 测试、基于 Git 的 API 集合、团队 API 测试工具、HTTP 客户端桌面应用。

## 为什么选择 Zenar

- **Git 就是同步层。** 一个 Collection 对应一个 Git 仓库，每个 Request 是一个独立的 YAML 文件，差异和 Pull Request 一目了然。
- **应用自动解决冲突。** Zenar 按字段（方法、URL、每个 Header、每个查询参数、认证、Body、脚本）合并，而不是按文本行。两个人修改同一请求的不同 Header 不会冲突，你也不会看到 `<<<<<<<`。从不强制推送。
- **为不懂 Git 的人设计。** Clone、commit、pull、push 都隐藏在“保存”和冲突界面之后。
- **机密留在你的电脑上。** Secret 的值存放在操作系统钥匙串中，不会进入仓库。队友只能看到变量名，并填写自己的值。
- **导入 Postman 集合。** 为 `pm.*` 编写的脚本照常运行（Zenar 自己的 API 是 `zn.*`）。
- **没有我们自己的服务器。** 应用只与你的 Git 托管和你的 API 通信，唯一自己发起的网络请求是检查更新。
- **轻量快速。** Rust 内核，支持浅色和深色主题。

## Zenar、Postman 与 Bruno 对比

|  | **Zenar** | **Postman** | **Bruno** |
| --- | --- | --- | --- |
| 集合存放位置 | 你自己的 Git 仓库，每个请求一个 YAML 文件 | Postman 云端工作区（可导出到本地） | `.bru` 文件夹，通常提交到 Git |
| 是否需要账号 | 否 | 是（多数功能需要登录） | 否 |
| 完全离线可用 | 是 | 有限（Scratch Pad 模式） | 是 |
| 团队协作 | 通过任意 Git 托管的 HTTPS（GitHub、GitLab、自建） | Postman 云，按席位付费 | 通过 Git，由你自己使用 Git 工具 |
| 由应用处理 Git | **是**：保存、pull、push 自动完成，Git 被隐藏 | 部分，取决于套餐 | 否，需要自己运行 Git |
| 冲突处理 | **按字段自动合并**，仅在真正冲突时询问 | 云端版本管理与 Fork | 普通 Git 文本合并 |
| 机密信息 | 操作系统钥匙串，不进入仓库 | 保存在 Postman 账号中 | 按约定排除在 Git 之外（secret 和 `.env` 文件） |
| 导入 Postman 集合 | 是，`pm.*` 脚本照常运行 | 原生 | 是 |
| 遥测 | 无 | 基于账号的云服务 | 可选择关闭 |
| 应用运行时 | 原生（Tauri + Rust） | Electron | Electron |
| 价格 | 免费 | 有免费版，团队版收费 | 免费，Golden Edition 收费 |

竞品信息根据其公开文档整理，可能随时间变化。决定前请查看各厂商官网的最新方案。欢迎提 issue 指正。

## 下载与安装

**最新版本：0.1.0** → [updates-zenar.tungit.io.vn](https://updates-zenar.tungit.io.vn/index.html)

| 操作系统 | 下载文件 | 安装方法 |
| --- | --- | --- |
| **macOS**（Apple Silicon 和 Intel） | `Zenar_0.1.0_universal.dmg` | 打开 `.dmg`，将 **Zenar** 拖入**应用程序**。如果 macOS 提示来自身份不明的开发者，请右键点击应用，选择**打开**，再点一次**打开**。或运行 `xattr -dr com.apple.quarantine /Applications/Zenar.app`。 |
| **Windows** 10 / 11（x64） | `Zenar_0.1.0_x64-setup.exe` | 运行安装程序。当前构建尚未代码签名，SmartScreen 可能会警告：点击**更多信息**，再点**仍要运行**。Windows 支持仍属实验性质。 |
| **Linux**：任意发行版 | `Zenar_0.1.0_amd64.AppImage` | `chmod +x Zenar_0.1.0_amd64.AppImage && ./Zenar_0.1.0_amd64.AppImage`。此版本可自动更新。 |
| **Linux**：Debian / Ubuntu | `Zenar_0.1.0_amd64.deb` | `sudo apt install ./Zenar_0.1.0_amd64.deb` |
| **Linux**：Fedora / RHEL / openSUSE | `Zenar-0.1.0-1.x86_64.rpm` | `sudo dnf install ./Zenar-0.1.0-1.x86_64.rpm` |

系统要求：**必须安装 Git**（Zenar 使用系统的 `git` 及其凭据助手）。Linux 还需要 WebKitGTK 4.1（`libwebkit2gtk-4.1`）。

**更新。** macOS 应用和 Linux AppImage 会检查新版本、验证签名，然后安装并重启。签名不匹配的更新绝不会被安装。`.deb`、`.rpm` 和 Windows 安装程序需手动下载新文件。

## 快速开始

1. 打开 Zenar，使用你平时的 Git 凭据（HTTPS）登录 Git。
2. 通过 Git 仓库 URL **打开 Collection**，或新建一个。Zenar 会把它克隆到本机。
3. 创建请求和文件夹，选择一个 **Environment**（dev、staging 等），点击 **Send**。
4. 点击**保存**。队友会在下次同步时收到你的改动。如果你们改了同一个字段，Zenar 会询问保留哪一个。

## 功能

- REST 请求：方法、查询参数、Header、认证，以及 JSON / form-data / urlencoded / raw / binary Body
- 带变量的 GraphQL
- 文件夹、嵌套文件夹、拖放
- Environment、Secret 与 Captured Variable
- 请求前和响应后的 JavaScript 脚本（`zn.*`，兼容 `pm.*`）
- 导入 Postman 集合
- 按字段三方合并、冲突界面、不强制推送
- 浅色/深色主题，macOS、Windows、Linux 原生构建，带签名的自动更新

## 常见问题

**Zenar 是 Postman 的替代品吗？** 是。Zenar 是免费的桌面 API 客户端，可发送 HTTP、REST 和 GraphQL 请求，并能导入 Postman 集合。

**Zenar 和 Bruno 有什么不同？** 两者都把集合保存为可放入 Git 的文件。使用 Bruno 时需要你自己运行 Git；Zenar 替你运行 Git，并按字段合并冲突的修改，更适合团队里不使用 Git 的测试、产品或客服人员。

**Zenar 需要账号或服务器吗？** 不需要。它使用你现有的 Git 托管（包括自建 GitLab），没有遥测。

**机密信息存放在哪里？** 存放在操作系统的钥匙串中，仅在你的电脑上。

**可以离线使用吗？** 可以。集合是本地克隆，恢复联网后再同步。
