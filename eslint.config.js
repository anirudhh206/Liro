// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", "**/prisma/migrations/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Financial code: an ignored Promise is a silently-dropped side effect
      // (an un-awaited ledger write, an un-awaited signature submit) — treat
      // it as an error, not a style nit.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["error"] }],
    },
  },
  {
    // Config/build scripts and test setup files run outside each package's
    // own tsconfig "include" (src only) — no type-aware project to attach to.
    files: ["**/*.config.js", "**/*.config.ts", "**/test/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
