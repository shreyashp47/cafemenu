/**
 * Chooses the storage backend.
 *
 * Demo mode is a *static* import, so a visitor with no configuration gets a
 * small bundle and no Firebase download at all. Firebase is behind a dynamic
 * `import()`, fetched only when the emulators or a real project are set.
 */

import { backend } from "../config";
import { demoBundle } from "./demo";
import type { DataBundle } from "./types";

let firebaseBundle: Promise<DataBundle> | null = null;

export async function loadBundle(): Promise<DataBundle> {
  if (backend === "demo") return demoBundle;
  const target = backend;
  firebaseBundle ??= import("./firestore").then((m) =>
    m.firebaseBundle(target),
  );
  return firebaseBundle;
}

export { demoBundle };
export * from "./types";
