// Copy static web assets (index.html, styles.css, src/) into app/ for Tauri.
// Tauri 2's frontendDist must point at a directory that does NOT contain
// src-tauri/, node_modules/, or target/. We stage the real sources there.

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const app = resolve(root, "app");

const entries = ["index.html", "styles.css", "src"];

await rm(app, { recursive: true, force: true });
await mkdir(app, { recursive: true });

for (const entry of entries) {
  const from = resolve(root, entry);
  const to = resolve(app, entry);
  await cp(from, to, { recursive: true });
}

console.log(`Copied [${entries.join(", ")}] -> ${app}`);
