/**
 * The published releases, in the shape the platform's `releases` collection
 * has them ({version, channel, publishedAt, withdrawn}), for the support
 * window (@cafemenu/shared/support-window) when `rollout` runs without the
 * platform: from GitHub's releases API, or from a file.
 */
import { readFile as fsReadFile } from "node:fs/promises";

import { UsageError } from "./errors.mjs";
import { parseVersion } from "./release-package.mjs";

export const RELEASES_API =
  "https://api.github.com/repos/shreyashp47/cafemenu/releases";

const PER_PAGE = 100;
const MAX_PAGES = 5;

/** GitHub's release objects as releases: drafts, and tags that aren't versions, are left out. */
export function releasesFromGitHub(items) {
  const releases = [];
  for (const item of items) {
    if (item.draft) continue;
    let parsed;
    try {
      parsed = parseVersion(item.tag_name);
    } catch {
      continue;
    }
    releases.push({
      version: parsed.version,
      channel: parsed.channel,
      publishedAt: Date.parse(item.published_at),
      // GitHub has no withdrawal: a release file can say so.
      withdrawn: false,
    });
  }
  return releases;
}

/** Every published release of the repository (the newest `MAX_PAGES` × 100). Public: no token. */
export async function fetchPublishedReleases(fetchImpl = fetch) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${RELEASES_API}?per_page=${PER_PAGE}&page=${page}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`${url} didn't give a list`);
    items.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return releasesFromGitHub(items);
}

/**
 * `--releases <file>`: a JSON list of {version, channel?, publishedAt, withdrawn?},
 * or {"releases": [...]}, with `publishedAt` as a date string or milliseconds.
 * It is what you export from the platform's `releases` collection.
 */
export async function readReleasesFile(path, read = fsReadFile) {
  let data;
  try {
    data = JSON.parse(await read(path, "utf8"));
  } catch (error) {
    throw new UsageError(
      `Can't read the releases file ${path} (${error.code ?? error.message}).`,
    );
  }
  const list = Array.isArray(data) ? data : data?.releases;
  if (!Array.isArray(list))
    throw new UsageError(`${path} needs a list of releases.`);
  return list;
}
