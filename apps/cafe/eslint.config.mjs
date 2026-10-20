import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      ".screenshots/**",
      "next-env.d.ts",
      // Claude Code's local state, including whole agent worktrees of this
      // repo; linting those lints the project several times over.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
