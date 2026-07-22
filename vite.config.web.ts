import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Read the version once at config-load time, the same string package.json
// already carries, rather than duplicating it (used later by the SW cache
// name and the About line; see docs/WEB.md, "Versioning").
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"),
) as { version: string };

// Web (PWA) build: separate root/outDir/base from the desktop Tauri config
// (vite.config.ts), which stays untouched. See docs/WEB.md, "Build".
export default defineConfig({
  root: "pwa",
  base: process.env.PAGES_BASE ?? "/opensoegaki/",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    target: "es2022",
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
