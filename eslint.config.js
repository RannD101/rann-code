import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  module: "readonly",
  require: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly"
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off"
    }
  },
  {
    files: ["**/*.cjs", "scripts/**/*.mjs"],
    languageOptions: { globals: nodeGlobals }
  }
);
