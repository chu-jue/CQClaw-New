// Generate platform icons from src-tauri/icons/icon.png.
//
// `tauri build` runs `beforeBuildCommand` with CWD = src-tauri/, so a bare
// `tauri icon src-tauri/icons/icon.png` from package.json would resolve
// the source path against src-tauri/ and miss. This script uses absolute
// paths and sets cwd explicitly so the icon generator always runs in the
// project root and finds the source PNG.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, ".."); // desktop/tauri-client
const sourcePng = resolve(root, "src-tauri", "icons", "icon.png");
const icoOut = resolve(root, "src-tauri", "icons", "icon.ico");

if (!existsSync(sourcePng)) {
  throw new Error(`source icon not found: ${sourcePng}`);
}

console.log(`[generate-icons] cwd: ${root}`);
console.log(`[generate-icons] source: ${sourcePng}`);

execFileSync("npx", ["tauri", "icon", sourcePng], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(icoOut)) {
  throw new Error(`tauri icon finished but ${icoOut} is missing`);
}
console.log(`[generate-icons] ok: ${icoOut}`);
