import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const appDir = path.join(distDir, "app");
const appIndex = path.join(distDir, "index.html");
const appTarget = path.join(appDir, "index.html");
const landingSource = path.join(distDir, "landingpage.html");
const rootTarget = path.join(distDir, "index.html");

async function assertFile(filePath, label) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`${label} fehlt: ${filePath}`);
  }
}

await assertFile(appIndex, "App-Einstieg");
await assertFile(landingSource, "Landingpage");

await mkdir(appDir, { recursive: true });
await copyFile(appIndex, appTarget);
await copyFile(landingSource, rootTarget);

console.log("Static entrypoints prepared: / = Landingpage, /app = SuperAPP");
