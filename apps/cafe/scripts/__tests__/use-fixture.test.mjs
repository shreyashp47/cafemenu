/** scripts/use-fixture.mjs: a fixture cafe's site.json, always a demo. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FIXTURES_DIR, writeFixtureSite } from "../lib/use-fixture.mjs";

const dirs = [];
async function build(withIndex = true) {
  const dir = await mkdtemp(join(tmpdir(), "use-fixture-"));
  dirs.push(dir);
  if (withIndex) await writeFile(join(dir, "index.html"), "<html></html>");
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("writeFixtureSite", () => {
  it("writes the fixture's settings as a demo site.json", async () => {
    const out = await build();
    const path = await writeFixtureSite("toe", out);
    const written = JSON.parse(await readFile(path, "utf8"));
    const fixture = JSON.parse(
      await readFile(join(FIXTURES_DIR, "toe.json"), "utf8"),
    );
    expect(written).toEqual({ ...fixture, demo: true });
  });

  it("always marks it a demo, whatever the fixture says", async () => {
    const out = await build();
    const fixtures = await build(false);
    await writeFile(join(fixtures, "real.json"), '{"name":"X","demo":false}');
    const written = JSON.parse(
      await readFile(await writeFixtureSite("real", out, fixtures), "utf8"),
    );
    expect(written.demo).toBe(true);
  });

  it("only writes into a finished build", async () => {
    await expect(writeFixtureSite("toe", await build(false))).rejects.toThrow(
      /not a build/,
    );
  });

  it("refuses a name that is not a fixture", async () => {
    const out = await build();
    await expect(writeFixtureSite("", out)).rejects.toThrow(/name a fixture/);
    await expect(writeFixtureSite("../package", out)).rejects.toThrow(
      /name a fixture/,
    );
    await expect(writeFixtureSite("nope", out)).rejects.toThrow();
  });
});
