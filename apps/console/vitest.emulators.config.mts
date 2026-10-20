import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The Firebase adapters (src/lib/data/firestore.ts), run for real against the
 * Auth and Firestore emulators, so the code the console ships is checked
 * against the same firestore.rules as the rules test.
 *
 *   npm run emulators          # terminal 1
 *   npm run test:emulators     # terminal 2
 */
export default defineConfig({
  test: {
    // The Firebase SDK runs in Node here, as it does in scripts/rules-test.mjs.
    environment: "node",
    include: ["src/**/*.emulator.test.ts"],
    // One emulator, shared state: the files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
