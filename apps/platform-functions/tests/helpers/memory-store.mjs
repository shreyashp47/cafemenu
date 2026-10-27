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
 *   listPinnedCafes()                 live cafes with release.pinned set
 *   getOwnerEmail(uid, fallback)      owners.emails, else the fallback
 *   ensureMailToken(cafeId) / checkMailToken(cafeId, token)
 *   claimMail(cafeId, key, now) → whether it was free / unclaimMail(cafeId, key)
 *   setEmailPreference(cafeId, {releaseNotices})
 *   getDeployment(id)                 with `createdAt` in ms
 *   updateDeployment(id, patch)       a shallow merge
 *   transactDeployment(id, fn)        fn(current) → {patch, result}; returns result
 *   queueDeployment(cafeId, decide, now)   decide({cafe, active}) →
 *                                     {deployment, expire, cafeStatus}; returns the new id
 *   listOpenRequests(limit)           queued and running requests, oldest first
 *   getRequest(id) / updateRequest(id, patch) / transactRequest(id, fn)   as for deployments
 *   getAccount(uid)                   {emailVerified, admin}, or null
 *   claimJob(name, now, everyMs)      whether the periodic job may run now (and notes that it did)
 */
import { newToken, sameSecret } from "../../src/mail/token.mjs";

export function createMemoryStore() {
  const data = {
    cafes: new Map(),
    releases: new Map(),
    logos: new Map(),
    menus: new Map(),
    records: new Map(),
    owners: new Map(), // uid → display name
    emails: new Map(), // uid → account email (absent: the owner's account is gone)
    mail: new Map(), // cafeId → {token, sent: {key: when}}
    deployments: new Map(),
    requests: new Map(),
    accounts: new Map(), // uid → {emailVerified, admin}
    jobs: new Map(), // name → when it last ran (ms)
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
    /** Test setup: a request as the console would have written it. */
    addRequest: (request) =>
      data.requests.set(request.id, structuredClone(request)),
    addAccount: (uid, account) =>
      data.accounts.set(uid, { emailVerified: true, admin: false, ...account }),

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
    async listPinnedCafes() {
      return [...data.cafes.values()]
        .filter((cafe) => cafe.release?.pinned && cafe.status === "live")
        .map(withRelease);
    },
    async getOwnerEmail(uid, fallback = null) {
      return data.emails.get(uid) ?? fallback;
    },
    async ensureMailToken(cafeId) {
      const mail = data.mail.get(cafeId) ?? { sent: {} };
      mail.token ??= newToken();
      data.mail.set(cafeId, mail);
      return mail.token;
    },
    async checkMailToken(cafeId, token) {
      const saved = data.mail.get(cafeId)?.token;
      return Boolean(saved) && sameSecret(saved, token);
    },
    async claimMail(cafeId, key, now) {
      const mail = data.mail.get(cafeId) ?? { sent: {} };
      data.mail.set(cafeId, mail);
      if (mail.sent[key]) return false;
      mail.sent[key] = ms(now);
      return true;
    },
    async unclaimMail(cafeId, key) {
      delete data.mail.get(cafeId)?.sent[key];
    },
    async setEmailPreference(cafeId, { releaseNotices }) {
      const cafe = data.cafes.get(cafeId);
      cafe.emails = { ...cafe.emails, releaseNotices };
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
    async listOpenRequests(limit) {
      return [...data.requests.values()]
        .filter((r) => ["queued", "running"].includes(r.status))
        .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
        .slice(0, limit)
        .map(view);
    },
    async getRequest(id) {
      return view(data.requests.get(id)) ?? null;
    },
    async updateRequest(id, patch) {
      Object.assign(data.requests.get(id), structuredClone(patch));
    },
    async transactRequest(id, fn) {
      const { patch, result } = fn(view(data.requests.get(id)) ?? null);
      if (patch) Object.assign(data.requests.get(id), structuredClone(patch));
      return result;
    },
    async getAccount(uid) {
      return data.accounts.get(uid) ?? null;
    },
    async claimJob(name, now, everyMs) {
      const last = data.jobs.get(name);
      if (last !== undefined && now - last < everyMs) return false;
      data.jobs.set(name, now);
      return true;
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
