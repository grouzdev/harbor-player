import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageInfo = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function buildCommit() {
  const githubSha = process.env.GITHUB_SHA;
  if (githubSha && /^[0-9a-f]{7,}$/i.test(githubSha))
    return githubSha.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __HARBOR_BUILD_VERSION__: JSON.stringify(packageInfo.version),
    __HARBOR_BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4317" },
    watch: {
      ignored: [
        "**/.test-data/**",
        "**/.fixtures/**",
        "**/dist/**",
        "**/verification/**",
        "**/*.log",
      ],
    },
  },
});
