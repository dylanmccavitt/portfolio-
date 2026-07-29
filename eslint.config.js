import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";

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
    // Plain-.js modules under src/components ship to the browser (the Frost
    // island's helpers), so they get the browser globals they legitimately use.
    // .jsx files are not matched by any rule config above and stay unlinted.
    files: ["src/components/**/*.js"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        window: "readonly",
      },
    },
  },
  {
    ignores: [
      "dist/",
      ".astro/",
      ".vercel/",
      "node_modules/",
      ".claude/",
      // Inert reference copy of the Frost prototype: own package.json, not
      // built by Astro, tests not wired into the root test script.
      "prototype-lab/",
    ],
  },
];
