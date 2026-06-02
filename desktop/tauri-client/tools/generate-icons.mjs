// Generate platform icons from src-tauri/icons/icon.png.
//
// `tauri build` runs `beforeBuildCommand` with CWD = src-tauri/, so a bare
// `tauri icon src-tauri/icons/icon.png` from package.json would resolve
// the source path against src-tauri/ and miss. This script uses absolute
// paths and sets cwd explicitly so the icon generator always runs in the
// project root and finds the source PNG.
//
// We invoke node_modules/.bin/tauri directly instead of `npx tauri icon`:
// on Windows `npx` is a .cmd shim, and Node's child_process.spawn does
// not auto-resolve PATHEXT, so `spawnSync("npx", ...)` fails with ENOENT.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, ".."); // desktop/tauri-client
const binName = process.platform === "win32" ? "tauri.cmd" : "tauri";
const tauriBin = resolve(root, "node_modules", ".bin", binName);
const sourcePng = resolve(root, "src-tauri", "icons", "icon.png");
const icoOut = resolve(root, "src-tauri", "icons", "icon.ico");

if (!existsSync(sourcePng)) {
  throw new Error(`source icon not found: ${sourcePng}`);
}
if (!existsSync(tauriBin)) {
  throw new Error(`tauri CLI not installed (run \`npm ci\` first): ${tauriBin}`);
}

console.log(`[generate-icons] cwd: ${root}`);
console.log(`[generate-icons] source: ${sourcePng}`);
console.log(`[generate-icons] bin: ${tauriBin}`);

execFileSync(tauriBin, ["icon", sourcePng], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(icoOut)) {
  throw new Error(`tauri icon finished but ${icoOut} is missing`);
}
console.log(`[generate-icons] ok: ${icoOut}`);

