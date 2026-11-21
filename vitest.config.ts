// Copyright © 2026 Vant <sl_kevln@163.com>
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 2,
  },
});
