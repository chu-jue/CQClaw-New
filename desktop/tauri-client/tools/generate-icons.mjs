// Generate platform icons from src-tauri/icons/icon.png.
//
// `tauri build` runs `beforeBuildCommand` with CWD = src-tauri/, so a bare
// `tauri icon src-tauri/icons/icon.png` from package.json would resolve
// the source path against src-tauri/ and miss. This script uses absolute
// paths and sets cwd explicitly so the icon generator always runs in the
// project root and finds the source PNG.
//
// Invoke the JS entrypoint with the current Node runtime instead of executing
// node_modules/.bin/tauri(.cmd). The .cmd shim can fail under GitHub Actions
// Windows runners when called through execFileSync.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, ".."); // desktop/tauri-client
const tauriCli = resolve(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const sourcePng = resolve(root, "src-tauri", "icons", "icon.png");
const icoOut = resolve(root, "src-tauri", "icons", "icon.ico");

if (!existsSync(sourcePng)) {
  throw new Error(`source icon not found: ${sourcePng}`);
}
if (!existsSync(tauriCli)) {
  throw new Error(`tauri CLI not installed (run \`npm ci\` first): ${tauriCli}`);
}

console.log(`[generate-icons] cwd: ${root}`);
console.log(`[generate-icons] source: ${sourcePng}`);
console.log(`[generate-icons] cli: ${tauriCli}`);

execFileSync(process.execPath, [tauriCli, "icon", sourcePng], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(icoOut)) {
  throw new Error(`tauri icon finished but ${icoOut} is missing`);
}
console.log(`[generate-icons] ok: ${icoOut}`);
