import { defineConfig } from "vite";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const themesDir = fileURLToPath(new URL("./themes", import.meta.url));

// themes/ is served as-is: /default/theme.css, /builtin/<name>/theme.css for the themes every
// build ships, and /private/<name>/theme.css for any private themes on this machine (that
// folder is gitignored, so public builds only ship the default and the built-ins).
const themesIn = dir => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(`${dir}/${d.name}/theme.css`))
      .map(d => d.name)
      .sort()
  : [];
const ORDER = ["paper", "night", "high-contrast"];   // the shipped set, in the order Settings lists them
const builtinThemes = themesIn(`${themesDir}/builtin`).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
const privateThemes = themesIn(`${themesDir}/private`);

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  publicDir: themesDir,
  clearScreen: false,
  define: { __VIRGIL_BUILTIN_THEMES__: JSON.stringify(builtinThemes), __VIRGIL_PRIVATE_THEMES__: JSON.stringify(privateThemes) },
  build: { outDir: "../dist", emptyOutDir: true, target: "safari14" },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
