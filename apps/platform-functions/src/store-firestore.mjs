/**
 * The platform's Firestore, as the store the rest of the backend talks to
 * (the contract is spelled out in tests/helpers/memory-store.mjs, which the
 * unit tests use in its place). Admin SDK, so the security rules don't apply:
 * this is "the backend" firestore.rules and model.ts speak of.
 *
 *   cafes/{id}                    read; the backend writes status and release.*
 *   cafes/{id}/setup/{logo,menu}  read: what the owner gave at sign-up
 *   cafes/{id}/private/deployRecord  the deploy record (deploy-log.mjs). No
 *                                 rule matches `private`, so no client can read it.
 *   cafes/{id}/private/mail       the unsubscribe token, and the emails sent so
 *                                 far (mail/notify.mjs)
 *   cafes/{id}.emails             {releaseNotices: false} once the owner unsubscribed
 *   releases/{version}            read
 *   deployments/{id}              created, claimed and updated here
 *   requests/{id}                 what people asked for (#77): read, claimed
 *                                 and answered by the worker (src/worker/)
 *   backend/worker                the worker's own bookkeeping: the releases
 *                                 it has seen, when its email jobs last ran.
 *                                 No rule matches it, so no client can read it.
 *   owners/{uid}                  the admin's directory (#78): each account
 *                                 from Auth, and its status
 *   adminLog/{id}                 every admin action (#78): only ever created,
 *                                 with the request's id, so a retry adds nothing
 *   cafes/{id}/emails/{id}        the emails a cafe's owner was sent
 *
 * Accounts are read from the platform's Auth (`getAccount`, `getOwnerEmail`,
 * `getOwnerName`, `listAccounts`); the admin's actions also disable, delete
 * and mark them (`setAccountDisabled`, `deleteAccount`, `setAdminClaim`),
 * which needs the Firebase Authentication Admin role.
 */
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { newToken, sameSecret } from "./mail/token.mjs";

const ms = (value) =>
  typeof value?.toMillis === "function"
    ? value.toMillis()
    : value instanceof Date
      ? value.getTime()
      : value;

const OPEN = ["queued", "running"];

export function createFirestoreStore({ db, auth }) {
  const cafeRef = (id) => db.collection("cafes").doc(id);
  const deployments = db.collection("deployments");
  const requests = db.collection("requests");
  const workerRef = db.collection("backend").doc("worker");
  const owners = db.collection("owners");
  const adminLog = db.collection("adminLog");
  const accountOf = (user) => ({
    uid: user.uid,
    email: user.email ?? null,
    name: user.displayName ?? null,
    emailVerified: user.emailVerified === true,
    disabled: user.disabled === true,
    admin: user.customClaims?.admin === true,
    createdAt: Date.parse(user.metadata?.creationTime ?? "") || null,
    lastSignInAt: Date.parse(user.metadata?.lastSignInTime ?? "") || null,
  });
  const notFound = (error) => error?.code === "auth/user-not-found";
  async function listAccounts() {
    const accounts = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      accounts.push(...page.users.map(accountOf));
      pageToken = page.pageToken;
    } while (pageToken);
    return accounts;
  }
  /** Deletes what `query` finds, in batches of the most a batch may hold. */
  async function deleteAll(query) {
    for (;;) {
      const snap = await query.limit(400).get();
      if (snap.empty) return;
      const batch = db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
    }
  }
  const requestOf = (snap) => {
    if (!snap.exists) return null;
    const data = snap.data();
    return { ...data, id: snap.id, createdAt: ms(data.createdAt) };
  };
  const deploymentOf = (snap) => {
    if (!snap.exists) return null;
    const data = snap.data();
    return { ...data, id: snap.id, createdAt: ms(data.createdAt) };
  };

  const mailRef = (cafeId) => cafeRef(cafeId).collection("private").doc("mail");

  const cafeOf = (snap) => {
    if (!snap.exists) return null;
    const data = snap.data();
    return {
      ...data,
      id: snap.id,
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
        ...data.release,
      },
    };
  };

  return {
    async getCafe(id) {
      return cafeOf(await cafeRef(id).get());
    },

    async setCafeStatus(id, status, now) {
      await cafeRef(id).update({ status, updatedAt: now });
    },

    /** Sets the versions given: `current`, `previous` and/or `pinned`. */
    async setCafeRelease(id, { current, previous, pinned }) {
      const update = { updatedAt: FieldValue.serverTimestamp() };
      if (current !== undefined) update["release.current"] = current;
      if (previous !== undefined) update["release.previous"] = previous;
      if (pinned !== undefined) update["release.pinned"] = pinned;
      await cafeRef(id).update(update);
    },

    async listReleases() {
      const snap = await db.collection("releases").get();
      return snap.docs.map((d) => ({ ...d.data(), version: d.id }));
    },

    async getRelease(version) {
      const snap = await db.collection("releases").doc(version).get();
      return snap.exists ? { ...snap.data(), version } : null;
    },

    async getLogo(cafeId) {
      const snap = await cafeRef(cafeId).collection("setup").doc("logo").get();
      const png = snap.data()?.png;
      return png ? Buffer.from(png) : null;
    },

    async getStartingMenu(cafeId) {
      const snap = await cafeRef(cafeId).collection("setup").doc("menu").get();
      return snap.exists ? snap.data() : null;
    },

    async getRecord(cafeId) {
      const snap = await cafeRef(cafeId)
        .collection("private")
        .doc("deployRecord")
        .get();
      return snap.exists ? snap.data() : null;
    },

    async setRecord(cafeId, record) {
      await cafeRef(cafeId)
        .collection("private")
        .doc("deployRecord")
        .set(record);
    },

    /** Live cafes that stay on a minor line: the ones a new release is not applied to. */
    async listPinnedCafes() {
      const snap = await db
        .collection("cafes")
        .where("release.pinned", "!=", null)
        .get();
      return snap.docs.map(cafeOf).filter((cafe) => cafe.status === "live");
    },

    /** The owner's address from their account, else `fallback` (the one the cafe was made with). */
    async getOwnerEmail(uid, fallback = null) {
      try {
        return (await auth.getUser(uid)).email ?? fallback;
      } catch {
        return fallback;
      }
    },

    /** The cafe's unsubscribe token, made on first use. */
    ensureMailToken(cafeId) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(mailRef(cafeId));
        const existing = snap.data()?.token;
        if (existing) return existing;
        const token = newToken();
        tx.set(mailRef(cafeId), { token }, { merge: true });
        return token;
      });
    },

    async checkMailToken(cafeId, token) {
      const snap = await mailRef(cafeId).get();
      const saved = snap.data()?.token;
      return Boolean(saved) && sameSecret(saved, token);
    },

    /** Records that the email `key` is being sent; false if it already was. */
    claimMail(cafeId, key, now) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(mailRef(cafeId));
        if (snap.data()?.sent?.[key]) return false;
        tx.set(mailRef(cafeId), { sent: { [key]: now } }, { merge: true });
        return true;
      });
    },

    /** Takes a claim back after the send failed. */
    async unclaimMail(cafeId, key) {
      await mailRef(cafeId).update(
        new FieldPath("sent", key),
        FieldValue.delete(),
      );
    },

    /** A line in the cafe's email history, for the admin's page. */
    async recordEmail(cafeId, { kind, key, at }) {
      await cafeRef(cafeId).collection("emails").add({ kind, key, at });
    },

    async setEmailPreference(cafeId, { releaseNotices }) {
      await cafeRef(cafeId).update({ "emails.releaseNotices": releaseNotices });
    },

    /**
     * The account `uid` as the backend checks a request's asker: null when
     * there is no such account. Any other failure is thrown, so a request is
     * never refused because Auth was briefly unreachable.
     */
    async getAccount(uid) {
      try {
        return accountOf(await auth.getUser(uid));
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },

    /** The account with `email`, or null. */
    async findAccountByEmail(email) {
      try {
        return accountOf(await auth.getUserByEmail(email));
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },

    /** Every account in the platform's Auth. */
    listAccounts,

    async listAdmins() {
      return (await listAccounts()).filter((a) => a.admin);
    },

    /** A suspended account can't sign in, nor refresh a token it has. */
    async setAccountDisabled(uid, disabled) {
      await auth.updateUser(uid, { disabled });
      if (disabled) await auth.revokeRefreshTokens(uid);
    },

    async deleteAccount(uid) {
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if (!notFound(error)) throw error;
      }
    },

    /** Sets or clears the `admin` claim, keeping any other claims. */
    async setAdminClaim(uid, admin) {
      const user = await auth.getUser(uid);
      const claims = { ...user.customClaims };
      if (admin) claims.admin = true;
      else delete claims.admin;
      await auth.setCustomUserClaims(
        uid,
        Object.keys(claims).length ? claims : null,
      );
    },

    // -- the admin's records (#78) --------------------------------------------

    async listCafesOf(ownerUid) {
      const snap = await db
        .collection("cafes")
        .where("ownerUid", "==", ownerUid)
        .get();
      return snap.docs.map(cafeOf);
    },

    /** The backend's fields of a cafe: status, its reason, maintenance. */
    async updateCafe(id, patch) {
      await cafeRef(id).update({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    },

    /** Merges `patch` into the owner's directory entry. */
    async setOwnerRecord(uid, patch) {
      await owners.doc(uid).set(patch, { merge: true });
    },

    async listOwnerRecords() {
      const snap = await owners.get();
      return new Map(snap.docs.map((d) => [d.id, d.data()]));
    },

    /**
     * Adds an entry to the admin log under `id` (the request's), unless one
     * is there: a retried request logs once. Never changes an entry.
     * Returns whether it was added.
     */
    async addAdminLog(id, entry) {
      try {
        await adminLog.doc(id).create(entry);
        return true;
      } catch (error) {
        if (error?.code === 6 || /already exists/i.test(error?.message ?? ""))
          return false;
        throw error;
      }
    },

    /** Queued or running requests about the cafe. */
    async listOpenRequestsFor(cafeId) {
      const snap = await requests
        .where("cafeId", "==", cafeId)
        .where("status", "in", OPEN)
        .get();
      return snap.docs.map(requestOf);
    },

    /**
     * Everything CafeMenu holds about an owner, but the admin log (#78,
     * decision 5): their cafes with what is under them (setup, the deploy
     * record, emails), the cafes' deployments, the requests they made, and
     * their directory entry. Their login is deleteAccount's.
     */
    async deleteOwnerData(uid, cafeIds) {
      for (const id of cafeIds) {
        await deleteAll(deployments.where("cafeId", "==", id));
        await db.recursiveDelete(cafeRef(id));
      }
      await deleteAll(requests.where("by", "==", uid));
      await owners.doc(uid).delete();
    },

    async getOwnerName(uid) {
      try {
        return (await auth.getUser(uid)).displayName ?? null;
      } catch {
        return null;
      }
    },

    async getDeployment(id) {
      return deploymentOf(await deployments.doc(id).get());
    },

    async updateDeployment(id, patch) {
      await deployments.doc(id).update(patch);
    },

    /** Reads the deployment, lets `fn` decide ({patch, result}), writes the patch: atomically. */
    transactDeployment(id, fn) {
      return db.runTransaction(async (tx) => {
        const ref = deployments.doc(id);
        const { patch, result } = fn(deploymentOf(await tx.get(ref)));
        if (patch) tx.update(ref, patch);
        return result;
      });
    },

    /** Queued or running deployments, oldest first: the ones to run. */
    async listActiveDeployments(limit) {
      const snap = await deployments
        .where("status", "in", OPEN)
        .orderBy("createdAt")
        .limit(limit)
        .get();
      return snap.docs.map(deploymentOf);
    },

    // -- requests (#77) ------------------------------------------------------

    /** Queued or running requests, oldest first. */
    async listActiveRequests(limit) {
      const snap = await requests
        .where("status", "in", OPEN)
        .orderBy("createdAt")
        .limit(limit)
        .get();
      return snap.docs.map(requestOf);
    },

    async getRequest(id) {
      return requestOf(await requests.doc(id).get());
    },

    async updateRequest(id, patch) {
      await requests.doc(id).update(patch);
    },

    /** Reads the request, lets `fn` decide ({patch, result}), writes the patch: atomically. */
    transactRequest(id, fn) {
      return db.runTransaction(async (tx) => {
        const ref = requests.doc(id);
        const { patch, result } = fn(requestOf(await tx.get(ref)));
        if (patch) tx.update(ref, patch);
        return result;
      });
    },

    async getWorkerState() {
      const snap = await workerRef.get();
      return snap.exists ? snap.data() : null;
    },

    /** Replaces the worker's bookkeeping (not a merge: a release that is gone goes from it too). */
    async setWorkerState(state) {
      await workerRef.set(state);
    },

    /**
     * Atomically: reads the cafe and its queued or running deployments, lets
     * `decide({cafe, active})` return {deployment, expire, cafeStatus}, and
     * writes that. Returns the new deployment's id.
     */
    queueDeployment(cafeId, decide, now) {
      return db.runTransaction(async (tx) => {
        const cafe = await tx.get(cafeRef(cafeId));
        const active = await tx.get(
          deployments
            .where("cafeId", "==", cafeId)
            .where("status", "in", ["queued", "running"]),
        );
        const { deployment, expire, cafeStatus } = decide({
          cafe: cafeOf(cafe),
          active: active.docs.map(deploymentOf),
        });
        const ref = deployments.doc();
        tx.create(ref, deployment);
        for (const id of expire) {
          tx.update(deployments.doc(id), {
            status: "failed",
            error: "This never finished, so it was closed.",
            finishedAt: now,
            lease: null,
          });
        }
        if (cafeStatus) {
          tx.update(cafeRef(cafeId), { status: cafeStatus, updatedAt: now });
        }
        return ref.id;
      });
    },
  };
}
