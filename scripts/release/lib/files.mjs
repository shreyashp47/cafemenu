import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Byte order, not locale order, so every machine sorts paths the same way. */
export function byPath(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/**
 * Every regular file under `root`, as sorted "a/b/c" paths. Symlinks and other
 * special files are refused rather than followed: a package holds files only.
 * `skip(name)` leaves out a file or folder by its own name.
 */
export async function listFiles(root, { skip = () => false } = {}) {
  const found = [];

  async function walk(dir, rel) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip(entry.name)) continue;

      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), path);
      } else if (entry.isFile()) {
        found.push(path);
      } else {
        throw new Error(
          `${join(dir, entry.name)} is not a regular file or folder (symlinks are not packaged)`,
        );
      }
    }
  }

  await walk(root, "");
  return found.sort(byPath);
}
