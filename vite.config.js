import { defineConfig } from "vite";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const themesDir = fileURLToPath(new URL("./themes", import.meta.url));
const privateDir = `${themesDir}/private`;

// themes/ is served as-is: /default/theme.css, and /private/<name>/theme.css for any private
// themes on this machine (that folder is gitignored, so public builds only ship the default).
const privateThemes = existsSync(privateDir)
  ? readdirSync(privateDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(`${privateDir}/${d.name}/theme.css`))
      .map(d => d.name)
      .sort()
  : [];

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  publicDir: themesDir,
  clearScreen: false,
  define: { __VIRGIL_PRIVATE_THEMES__: JSON.stringify(privateThemes) },
  build: { outDir: "../dist", emptyOutDir: true, target: "safari14" },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
