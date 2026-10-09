import tseslint from "typescript-eslint";
import js from "@eslint/js";

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  AbortController: "readonly",
  queueMicrotask: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly"
};

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { globals: nodeGlobals }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "tests/**/*.ts"]
  })),
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      // TypeScript already reports undefined variables; avoid double-reporting.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
);
