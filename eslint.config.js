import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["dist/**", "release/**", ".test-data/**", "test-results/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: ["@babel/preset-react", "@babel/preset-typescript"],
        },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Babel parses TypeScript syntax, but semantic undefined/unused checks
      // remain the responsibility of the repository TypeScript compiler.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];
