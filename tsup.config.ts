import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: false,
  sourcemap: false,
  clean: true,
  // A leading hashbang is legal in any ESM module; the bin entry needs it.
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" })
});
