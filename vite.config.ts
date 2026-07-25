import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Original vinext/Cloudflare configuration was replaced because GitHub Pages
// serves static files only. GITHUB_REPOSITORY resolves project-site base paths.
const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isUserSite = repository?.endsWith(".github.io");
const base = process.env.VITE_BASE_PATH ?? (repository && !isUserSite ? `/${repository}/` : "/");

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["tests/unit/**/*.test.ts"],
  },
});
