/** See scripts/use-fixture.mjs. */
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);

/** Writes <outDir>/site.json for fixture `name` and returns its path. */
export async function writeFixtureSite(
  name,
  outDir,
  fixturesDir = FIXTURES_DIR,
) {
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`name a fixture from fixtures/, e.g. "toe" (got ${name})`);
  }
  // A site.json next to the sources would turn every demo into a real cafe's
  // retry screen, so only ever write into a finished build.
  try {
    await access(join(outDir, "index.html"));
  } catch {
    throw new Error(
      `${outDir} is not a build (no index.html). Run npm run build.`,
    );
  }
  const settings = JSON.parse(
    await readFile(join(fixturesDir, `${name}.json`), "utf8"),
  );
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new Error(`fixtures/${name}.json is not a settings object`);
  }
  const path = join(outDir, "site.json");
  await writeFile(
    path,
    `${JSON.stringify({ ...settings, demo: true }, null, 2)}\n`,
  );
  return path;
}
