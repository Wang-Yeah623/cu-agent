import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@cu-agent/core": path.resolve(__dirname, "src/core"),
      "@cu-agent/registry": path.resolve(__dirname, "src/registry"),
    },
  },
});
