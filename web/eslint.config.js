// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Data from extra.json must never be parsed as HTML. Build DOM with `h()` (src/dom.ts) instead.
const NO_HTML_SINKS = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message: "Use h() from src/dom.ts; never parse data as HTML.",
}));

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      "no-restricted-properties": ["error", ...NO_HTML_SINKS],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: "document.write is not allowed.",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
