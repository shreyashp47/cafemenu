import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // match Next.js's automatic JSX runtime so components need no React import
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/components/**", "src/hooks/**"],
      // The Firestore adapters talk to a remote service, so a unit test cannot
      // exercise them. They are held to the documented behaviour in
      // src/lib/__tests__/repository-contract.test.ts and enforced by
      // firestore.rules, so counting them would only dilute the real signal.
      exclude: [
        "src/lib/data/firestore.ts",
        "src/lib/data/firebase.ts",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
