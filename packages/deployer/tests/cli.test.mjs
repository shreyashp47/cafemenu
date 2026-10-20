import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { EXIT, main, parseCommandLine } from "../src/cli.mjs";
import { UsageError } from "../src/errors.mjs";
import {
  collectFiles,
  isIgnored,
  readHostingConfig,
  toServingConfig,
} from "../src/hosting-files.mjs";
import { tempDir, writeTree } from "./helpers/setup.mjs";

async function capture(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    env: {},
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("parseCommandLine", () => {
  it("parses a command with its options", () => {
    assert.deepEqual(
      parseCommandLine([
        "provision",
        "--project",
        "lantern-cafe-1a2b",
        "--region",
        "asia-south1",
        "--site",
        "Lantern-Cafe",
        "--dry-run",
      ]),
      {
        command: "provision",
        project: "lantern-cafe-1a2b",
        keyPath: undefined,
        dryRun: true,
        options: {
          region: "asia-south1",
          site: "lantern-cafe",
          appName: "CafeMenu",
        },
      },
    );
  });

  it("rejects what would only fail later at Google", () => {
    const bad = [
      ["provision", "--region", "eur3", "--site", "x"],
      [
        "provision",
        "--project",
        "Not_A_Project",
        "--region",
        "eur3",
        "--site",
        "x",
      ],
      ["provision", "--project", "lantern-cafe", "--site", "x"],
      [
        "provision",
        "--project",
        "lantern-cafe",
        "--region",
        "eur3",
        "--site",
        "bad_name",
      ],
      ["deploy", "--project", "lantern-cafe"],
      [
        "deploy",
        "--project",
        "lantern-cafe",
        "--only",
        "functions",
        "--rules",
        "r",
      ],
      ["check", "--project", "lantern-cafe", "--for", "everything"],
      ["owner", "--project", "lantern-cafe", "--email", "a@b.co"],
      [
        "owner",
        "--project",
        "lantern-cafe",
        "--email",
        "a@b.co",
        "--name",
        "x".repeat(81),
      ],
      ["rollback", "--project", "lantern-cafe", "--site", "s", "--unknown"],
      ["publish", "--project", "lantern-cafe"],
    ];
    for (const argv of bad)
      assert.throws(() => parseCommandLine(argv), UsageError, argv.join(" "));
  });

  it("orders deploy parts as rules, indexes, hosting whatever order --only gives", () => {
    const { options } = parseCommandLine([
      "deploy",
      "--project",
      "lantern-cafe",
      "--only",
      "hosting,rules",
      "--rules",
      "r",
      "--site",
      "s",
      "--dir",
      "out",
    ]);
    assert.deepEqual(options.parts, ["rules", "hosting"]);
  });
});

describe("main", () => {
  it("prints help on stdout with exit 0, and usage errors on stderr with exit 2", async () => {
    const help = await capture(["--help"]);
    assert.equal(help.code, EXIT.ok);
    assert.match(help.out, /Commands:\n {2}check/);

    const commandHelp = await capture(["deploy", "--help"]);
    assert.equal(commandHelp.code, EXIT.ok);
    assert.match(commandHelp.out, /--only <parts>/);

    const none = await capture([]);
    assert.equal(none.code, EXIT.usage);
    assert.match(none.err, /Usage: deployer <command>/);

    const noKey = await capture(["check", "--project", "lantern-cafe"]);
    assert.equal(noKey.code, EXIT.usage);
    assert.match(
      noKey.err,
      /--key <path> or set GOOGLE_APPLICATION_CREDENTIALS/,
    );
  });
});

describe("hosting files", () => {
  it("ignores like firebase-tools: dotfiles, node_modules and firebase.json", () => {
    const ignore = ["firebase.json", "**/.*", "**/node_modules/**"];
    assert.ok(isIgnored(".DS_Store", ignore));
    assert.ok(isIgnored("img/.hidden", ignore));
    assert.ok(isIgnored(".well-known/assetlinks.json", ignore));
    assert.ok(isIgnored("node_modules/a/b.js", ignore));
    assert.ok(isIgnored("firebase.json", ignore));
    assert.ok(!isIgnored("index.html", ignore));
    assert.ok(!isIgnored("_next/static/chunks/app.js", ignore));
    assert.ok(isIgnored("drafts/a.html", ["drafts/**"]));
    assert.ok(isIgnored("a.map", ["*.map"]));
    assert.ok(!isIgnored("js/a.map", ["*.map"]), "* doesn't cross folders");
  });

  it("hashes the same build the same way every time", async () => {
    const dir = await writeTree(await tempDir(), {
      "index.html": "<h1>hi</h1>",
      "a/b.txt": "b",
    });
    const first = await collectFiles(dir);
    const second = await collectFiles(dir);
    assert.deepEqual(
      first.map((f) => [f.path, f.hash]),
      second.map((f) => [f.path, f.hash]),
    );
    assert.deepEqual(
      first.map((f) => f.path),
      ["/a/b.txt", "/index.html"],
    );
  });

  it("translates redirects, rewrites and trailingSlash into ServingConfig", () => {
    assert.deepEqual(
      toServingConfig({
        trailingSlash: true,
        redirects: [
          { source: "/", destination: "https://toe-cafe.web.app/", type: 302 },
          { regex: "^/old/(.*)$", destination: "/new/:1" },
        ],
        rewrites: [{ source: "**", destination: "/index.html" }],
        appAssociation: "NONE",
      }),
      {
        trailingSlashBehavior: "ADD",
        appAssociation: "NONE",
        redirects: [
          { glob: "/", location: "https://toe-cafe.web.app/", statusCode: 302 },
          { regex: "^/old/(.*)$", location: "/new/:1", statusCode: 301 },
        ],
        rewrites: [{ glob: "**", path: "/index.html" }],
      },
    );
    assert.throws(
      () =>
        toServingConfig({ rewrites: [{ source: "/api/**", function: "api" }] }),
      UsageError,
    );
  });

  it("picks the hosting entry by target, and needs --target when there are several", async () => {
    const dir = await tempDir();
    await writeTree(dir, {
      "firebase.json": JSON.stringify({
        hosting: [
          { target: "app", cleanUrls: true, ignore: ["**/.*"] },
          {
            target: "legacy",
            redirects: [
              { source: "/", destination: "https://x.web.app/", type: 302 },
            ],
          },
        ],
      }),
    });
    const path = join(dir, "firebase.json");
    assert.deepEqual(await readHostingConfig(path, "app"), {
      config: { cleanUrls: true },
      ignore: ["**/.*"],
    });
    await assert.rejects(readHostingConfig(path), /pick one with --target/);
    await assert.rejects(
      readHostingConfig(path, "nope"),
      /no hosting entry with target "nope"/,
    );
  });
});
