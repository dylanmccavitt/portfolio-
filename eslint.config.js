import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import globals from "globals";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["*.config.{js,mjs,ts}", "astro.config.{js,mjs,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ["dist/", ".astro/", "node_modules/"],
  },
];
