# Zenar: Git-native API client for Postman collections

**English** · [Tiếng Việt](README.vi.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://updates-zenar.tungit.io.vn/index.html)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#download-and-install)
![Built with Tauri + Rust](https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-orange)
![No telemetry](https://img.shields.io/badge/telemetry-none-green)

**Zenar is a free, lightweight desktop API client (a Postman and Bruno alternative) that stores your API collection in a plain Git repository and merges teammates' changes for you, so people who do not know Git can still collaborate through Git.**

Send REST and GraphQL requests, share one collection with your team through GitHub or GitLab (including self-hosted), and never see a merge-conflict marker. Git runs quietly in the background. You only see **Save** and **Conflict**.

> Zenar is a native desktop app (Tauri + Rust), not an Electron app. No account, no cloud workspace, no telemetry. Works offline.

Keywords: API client, REST client, GraphQL client, Postman alternative, Bruno alternative, Insomnia alternative, offline API testing, Git-based API collection, open collection format, API testing tool for teams, HTTP client desktop app.

## Why Zenar

- **Git is the sync layer.** A Collection is one Git repo. Every Request is its own YAML file, so diffs and pull requests are readable.
- **Conflicts the app can resolve.** Zenar merges per field (method, URL, each header, each query param, auth, body, script) instead of per text line. Two people editing different headers of the same request never conflict, and you never see `<<<<<<<` markers. It never force-pushes.
- **For people who do not know Git.** Clone, commit, pull and push are hidden behind Save and a conflict screen.
- **Secrets stay on your machine.** Secret values live in your OS keychain and never enter the repo. Teammates see the variable name and fill in their own value.
- **Bring your Postman collections.** Import Postman collections, and scripts written for `pm.*` keep running (Zenar's own API is `zn.*`).
- **No server of ours.** The app talks to your Git host and your APIs, nothing else. The only network call of its own is checking for updates.
- **Light and fast.** Rust core, small native app, light and dark themes.

## Zenar vs Postman vs Bruno

| | **Zenar** | **Postman** | **Bruno** |
| --- | --- | --- | --- |
| Where collections live | A Git repo you own, one YAML file per request | Postman cloud workspaces (local export possible) | Local folders of `.bru` files, usually committed to Git |
| Account required | No | Yes (sign-in needed for most features) | No |
| Works fully offline | Yes | Limited (Scratch Pad mode) | Yes |
| Team collaboration | Through any Git host over HTTPS (GitHub, GitLab, self-hosted) | Postman cloud, per-seat plans | Through Git, using your own Git tools |
| Git handled by the app | **Yes**: Save, pull and push are automatic, Git is hidden | Partial, on supported plans | No, you run Git yourself |
| Conflict handling | **Field-level automatic merge**, you only pick on a true clash | Cloud versioning and forks | Normal Git text merge |
| Secrets | OS keychain, never in the repo | Stored in your Postman account | Kept out of Git by convention (secret and `.env` files) |
| Import Postman collections | Yes, `pm.*` scripts still run | Native | Yes |
| Telemetry | None | Account-based cloud service | Opt-out |
| App runtime | Native (Tauri + Rust) | Electron | Electron |
| Price | Free | Free tier, paid team plans | Free, paid Golden Edition |

Competitor details are summarized from their public documentation and change over time. Check the vendors' sites for current plans before you decide. Corrections welcome: open an issue.

## Download and install

**Latest version: 0.1.0** → [updates-zenar.tungit.io.vn](https://updates-zenar.tungit.io.vn/index.html)

| OS | File to download | How to install |
| --- | --- | --- |
| **macOS** (Apple Silicon and Intel) | `Zenar_0.1.0_universal.dmg` | Open the `.dmg`, drag **Zenar** to **Applications**. If macOS says the app is from an unidentified developer, right-click the app, choose **Open**, then **Open** again. Or run `xattr -dr com.apple.quarantine /Applications/Zenar.app`. |
| **Windows** 10 / 11 (x64) | `Zenar_0.1.0_x64-setup.exe` | Run the installer. The build is not code-signed yet, so SmartScreen may warn: click **More info**, then **Run anyway**. Windows support is experimental. |
| **Linux**: any distro | `Zenar_0.1.0_amd64.AppImage` | `chmod +x Zenar_0.1.0_amd64.AppImage && ./Zenar_0.1.0_amd64.AppImage`. This one updates itself. |
| **Linux**: Debian / Ubuntu | `Zenar_0.1.0_amd64.deb` | `sudo apt install ./Zenar_0.1.0_amd64.deb` |
| **Linux**: Fedora / RHEL / openSUSE | `Zenar-0.1.0-1.x86_64.rpm` | `sudo dnf install ./Zenar-0.1.0-1.x86_64.rpm` |

Requirements: **Git must be installed** (Zenar uses your system `git` and its credential helper). Linux also needs WebKitGTK 4.1 (`libwebkit2gtk-4.1`).

**Updates.** The macOS app and the Linux AppImage check for new versions, verify a signature, then install and relaunch. A signature mismatch is never installed. `.deb`, `.rpm` and Windows installers: download the new file by hand.

## Quick start

1. Open Zenar and sign in to Git through your normal Git credentials (HTTPS).
2. **Open a Collection** from a Git repo URL, or create a new one. Zenar clones it to your machine.
3. Create requests and folders, pick an **Environment** (dev, staging, ...), and press **Send**.
4. Press **Save**. Teammates get your change on their next sync. If you both edited the same field, Zenar asks which one to keep.

## Features

- REST requests: methods, query params, headers, auth, JSON / form-data / urlencoded / raw / binary bodies
- GraphQL with variables
- Folders, nested folders, drag and drop
- Environments, Secrets and Captured Variables
- Before-request and after-response JavaScript scripts (`zn.*`, `pm.*` compatible)
- Postman collection import
- Field-level three-way merge, conflict screen, no force push
- Light / dark theme, native macOS, Windows and Linux builds, signed auto-update

## FAQ

**Is Zenar a Postman alternative?** Yes. Zenar is a free desktop API client for sending HTTP, REST and GraphQL requests, and it imports Postman collections.

**How is Zenar different from Bruno?** Both keep collections as files you can put in Git. With Bruno you run Git yourself. Zenar runs Git for you and merges conflicting edits per field, which suits teams that include testers, PMs or support staff who do not use Git.

**Does Zenar need an account or a server?** No. It works with the Git host you already use, including self-hosted GitLab, and has no telemetry.

**Where are my secrets stored?** In your operating system's keychain, on your machine only.

**Does it work offline?** Yes. The collection is a local clone. Sync when you are back online.

## Tiếng Việt

Zenar là ứng dụng desktop miễn phí để gọi API (thay thế Postman, Bruno), lưu Collection trong một repo Git và tự gộp thay đổi của đồng đội theo từng Field, dành cho cả người không rành Git. Tải bản mới nhất ở [Releases](https://updates-zenar.tungit.io.vn/index.html).
