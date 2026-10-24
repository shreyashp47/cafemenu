/**
 * The platform's data in memory, with the same contract as
 * src/store-firestore.mjs (which the emulator test checks against a real
 * Firestore):
 *
 *   getCafe(id)                       the cafe with `release` filled in, or null
 *   setCafeStatus(id, status, now)
 *   setCafeRelease(id, {current?, previous?, pinned?})   only the keys given
 *   listReleases() / getRelease(version)
 *   getLogo(cafeId) / getStartingMenu(cafeId) / getOwnerName(uid)
 *   getRecord(cafeId) / setRecord(cafeId, record)
 *   getDeployment(id)                 with `createdAt` in ms
 *   updateDeployment(id, patch)       a shallow merge
 *   transactDeployment(id, fn)        fn(current) → {patch, result}; returns result
 *   queueDeployment(cafeId, decide, now)   decide({cafe, active}) →
 *                                     {deployment, expire, cafeStatus}; returns the new id
 */
export function createMemoryStore() {
  const data = {
    cafes: new Map(),
    releases: new Map(),
    logos: new Map(),
    menus: new Map(),
    records: new Map(),
    owners: new Map(), // uid → display name
    deployments: new Map(),
  };
  let counter = 0;
  const ms = (v) => (v instanceof Date ? v.getTime() : v);
  const view = (d) =>
    d && { ...structuredClone(d), id: d.id, createdAt: ms(d.createdAt) };
  const withRelease = (cafe) =>
    cafe && {
      ...structuredClone(cafe),
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
        ...cafe.release,
      },
    };

  return {
    data,
    /** Test setup: a cafe as the console would have created it. */
    addCafe: (cafe) => data.cafes.set(cafe.id, structuredClone(cafe)),
    addRelease: (release) => data.releases.set(release.version, release),

    async getCafe(id) {
      return withRelease(data.cafes.get(id)) ?? null;
    },
    async setCafeStatus(id, status, now) {
      Object.assign(data.cafes.get(id), { status, updatedAt: now });
    },
    async setCafeRelease(id, { current, previous, pinned }) {
      const cafe = data.cafes.get(id);
      cafe.release = { ...withRelease(cafe).release };
      if (current !== undefined) cafe.release.current = current;
      if (previous !== undefined) cafe.release.previous = previous;
      if (pinned !== undefined) cafe.release.pinned = pinned;
    },
    async listReleases() {
      return [...data.releases.values()];
    },
    async getRelease(version) {
      return data.releases.get(version) ?? null;
    },
    async getLogo(cafeId) {
      return data.logos.get(cafeId) ?? null;
    },
    async getStartingMenu(cafeId) {
      return data.menus.get(cafeId) ?? null;
    },
    async getOwnerName(uid) {
      return data.owners.get(uid) ?? null;
    },
    async getRecord(cafeId) {
      return structuredClone(data.records.get(cafeId) ?? null);
    },
    async setRecord(cafeId, record) {
      data.records.set(cafeId, structuredClone(record));
    },
    async getDeployment(id) {
      return view(data.deployments.get(id)) ?? null;
    },
    async updateDeployment(id, patch) {
      Object.assign(data.deployments.get(id), structuredClone(patch));
    },
    async transactDeployment(id, fn) {
      const { patch, result } = fn(view(data.deployments.get(id)) ?? null);
      if (patch)
        Object.assign(data.deployments.get(id), structuredClone(patch));
      return result;
    },
    async queueDeployment(cafeId, decide, now) {
      const active = [...data.deployments.values()]
        .filter(
          (d) =>
            d.cafeId === cafeId && ["queued", "running"].includes(d.status),
        )
        .map(view);
      const { deployment, expire, cafeStatus } = decide({
        cafe: await this.getCafe(cafeId),
        active,
      });
      counter += 1;
      const id = `dep${counter}`;
      data.deployments.set(id, { ...structuredClone(deployment), id });
      for (const dead of expire) {
        Object.assign(data.deployments.get(dead), {
          status: "failed",
          error: "This never finished, so it was closed.",
          finishedAt: now,
          lease: null,
        });
      }
      if (cafeStatus) {
        Object.assign(data.cafes.get(cafeId), {
          status: cafeStatus,
          updatedAt: now,
        });
      }
      return id;
    },
  };
}
