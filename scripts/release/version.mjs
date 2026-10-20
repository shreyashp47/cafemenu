#!/usr/bin/env node
/**
 * Reads a release tag, for the release workflow.
 *
 *   node scripts/release/version.mjs v0.1.0-beta.1
 *     version=0.1.0-beta.1
 *     channel=beta
 *     prerelease=true
 *     line=0.1
 *
 *   gh release list … | node scripts/release/version.mjs --newest
 *     the newest stable tag among the lines on stdin (others are skipped)
 *
 * The first form exits 1 on a tag that is not a release version, which is what
 * stops the workflow on a bad tag. Its output is GITHUB_OUTPUT's format.
 */
import { text } from "node:stream/consumers";

import { isMain, run } from "./lib/cli.mjs";
import { compareVersions, parseVersion } from "./lib/version.mjs";

/** The newest stable release tag in `tags`, or null. */
export function newestStable(tags) {
  const stable = tags.filter((tag) => {
    try {
      return parseVersion(tag).channel === "stable";
    } catch {
      return false;
    }
  });
  return stable.sort(compareVersions).pop() ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--newest") {
    const tags = (await text(process.stdin)).split(/\s+/).filter(Boolean);
    console.log(newestStable(tags) ?? "");
    return;
  }
  if (args.length !== 1)
    throw new Error("usage: node scripts/release/version.mjs <tag> | --newest");

  const release = parseVersion(args[0]);
  console.log(`version=${release.version}`);
  console.log(`channel=${release.channel}`);
  console.log(`prerelease=${release.prerelease !== null}`);
  console.log(`line=${release.line}`);
}

if (isMain(import.meta.url)) run(main);
