import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

/** True when the module at `url` is the script node was started with. */
export function isMain(url) {
  if (!process.argv[1]) return false;

  try {
    return url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

/** Runs `main`, printing a failure as one line (or a list) and exiting 1. */
export function run(main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** `path` relative to the current folder when it is inside it, else as given. */
export function shortPath(path) {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}
