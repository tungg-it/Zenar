// Fails unless package.json, src-tauri/tauri.conf.json and the Cargo workspace agree on one version.
// With an argument (a tag such as v0.2.0) it must match that too. Run before every release.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "Cargo.toml [workspace.package]": read("Cargo.toml").match(/\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/s)?.[1],
};
const tag = process.argv[2]?.replace(/^v/, "");
if (tag) versions["tag"] = tag;

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || unique.has(undefined)) {
  console.error("Version mismatch:", versions);
  process.exit(1);
}
console.log(`Version ${[...unique][0]} is consistent.`);
