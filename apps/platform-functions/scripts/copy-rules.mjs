/**
 * Copies the console's Firestore rules and indexes next to this app for the
 * emulators: the Firebase CLI refuses a rules file outside its project
 * directory, and the platform's rules belong to apps/console (the model and
 * the rules tests live there). The copy is not committed.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "../../console");
const to = join(here, "../.emulator");

await mkdir(to, { recursive: true });
for (const file of ["firestore.rules", "firestore.indexes.json"]) {
  await copyFile(join(from, file), join(to, file));
}
