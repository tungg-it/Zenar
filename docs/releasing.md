# Releasing Zenar (Updates)

Zenar updates itself from a static Cloudflare R2 bucket served at `https://updates-zenar.tungit.io.vn/stable/` (ADR 0004). The app reads `stable/latest.json`, downloads the bundle for its platform, checks the minisign signature against the public key embedded in `src-tauri/tauri.conf.json`, installs, and relaunches. A signature mismatch is never installed.

## The updater key (do this once, keep it forever)

The public key is already in `tauri.conf.json`. The **private key and its password** sign every Update. **If either is lost, no installed copy of Zenar can ever be updated again** (users would have to download a new copy by hand), so:

1. Keep a copy of both in a password manager (offline, with a password).
2. Keep a copy in protected, masked CI variables `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Never commit them. To generate a new pair (only before the first public release, since it changes the embedded public key): `pnpm tauri signer generate -w ~/.tauri/zenar-updater.key`.

## Manual release (until CI does it, see the release CI issue)

```sh
node scripts/check-version.mjs                       # package.json, tauri.conf.json, Cargo.toml agree
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/zenar-updater.key   # a path or the key text
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'
pnpm tauri build                                     # makes the bundle plus its .sig (createUpdaterArtifacts)
```

Bundles land in `target/release/bundle/`; the updater file for macOS is `macos/Zenar.app.tar.gz` (+ `.sig`).

```sh
V=0.2.0
node scripts/make-latest-json.mjs $V https://updates-zenar.tungit.io.vn/stable/$V "Release notes" \
  darwin-aarch64=target/release/bundle/macos/Zenar.app.tar.gz > latest.json

# Upload the bundle and its .sig first, latest.json LAST (it is what makes the Update visible).
npx wrangler r2 object put zenar-updates/stable/$V/Zenar.app.tar.gz --file target/release/bundle/macos/Zenar.app.tar.gz
npx wrangler r2 object put zenar-updates/stable/latest.json --file latest.json --content-type application/json
```

(`zenar-updates` is the bucket name; use the real one.) Bump the version in all three places before building: `package.json`, `src-tauri/tauri.conf.json`, `[workspace.package]` in `Cargo.toml`.

## Trying an Update locally

Build twice (e.g. 0.1.0 and 0.1.1) with `--config` pointing the endpoint at a local server, serve the folder holding `latest.json` and the newer bundle, and open the older build:

```sh
pnpm tauri build --config '{"plugins":{"updater":{"endpoints":["http://localhost:8099/latest.json"],"dangerousInsecureTransportProtocol":true}}}'
```

Never ship a build made with that override.

## Release by CI

- **`dev`**: every push builds (macOS, Linux, Windows) without the Update signing key and publishes nothing. It only proves the app still builds.
- **`main`**: a push that changes the version (`package.json`, `src-tauri/tauri.conf.json` or `Cargo.toml`; bump all three, `scripts/check-version.mjs` enforces it) builds, signs and publishes. A push to `main` that leaves the version alone builds nothing. You can also run the pipeline by hand on `main`. A version already live at `stable/latest.json` is never overwritten: the publish job stops and says to bump the version.

| Job | Runner | Output |
| --- | --- | --- |
| `build-macos` | `tungit-macos-runner` | universal `.app.tar.gz` (+ `.sig`) and `.dmg`; signed and notarized once the Apple variables are set |
| `build-linux` | `tungit-runner` (Docker) | `.AppImage` (+ `.sig`, self-updating), `.deb`, `.rpm` (manual download) |
| `build-windows` | `tungit-runner` (Docker, cargo-xwin) | unsigned NSIS `*-setup.exe` (+ `.sig`); allowed to fail |
| `publish` (`main` only) | `tungit-runner` | uploads bundles, `index.html`, then `stable/latest.json` to R2 |

The secrets are protected, masked CI/CD variables (the list is at the top of `.gitlab-ci.yml`); they are set on the `tungit-product/zenar` group. `main` is a protected branch, so they reach its jobs and never `dev`. The macOS runner needs Xcode command line tools, Rust, Node 22 and pnpm installed. Without the `APPLE_*` variables the macOS build is not signed or notarized (fine for testing, not for a public release).

`index.html` at the bucket root is the page "Download" opens for `.deb` / `.rpm` installs (they cannot update themselves).

### Windows

Windows is built unsigned (users see a SmartScreen warning: "More info" then "Run anyway") and cross-compiled with `cargo-xwin`, which is experimental and has never been run on a real Windows machine for this project. So the pipeline builds it but leaves it **out of `latest.json`**. After a release build on `main`, download the `*-setup.exe` from the job artifacts, install and run it on real Windows, and only then set the CI/CD variable `PUBLISH_WINDOWS=1` for the next release. If `build-windows` fails and cannot be fixed, use the gitlab.com shared Windows runner instead.
