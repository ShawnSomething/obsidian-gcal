import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // The real `obsidian` package is types-only and has no runtime entry,
      // so any module importing it fails to load under vitest.
      obsidian: fileURLToPath(
        new URL("./tests/stubs/obsidian.ts", import.meta.url)
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
