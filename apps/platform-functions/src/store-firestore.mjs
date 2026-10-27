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
 *   requests/{id}                 written by the console; claimed, progressed
 *                                 and finished here (requests.mjs)
 *   state/worker                  when each periodic job last ran (worker.mjs)
 */
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { newToken, sameSecret } from "./mail/token.mjs";

const ms = (value) =>
  typeof value?.toMillis === "function"
    ? value.toMillis()
    : value instanceof Date
      ? value.getTime()
      : value;

export function createFirestoreStore({ db, auth }) {
  const cafeRef = (id) => db.collection("cafes").doc(id);
  const deployments = db.collection("deployments");
  const requests = db.collection("requests");
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

    async setEmailPreference(cafeId, { releaseNotices }) {
      await cafeRef(cafeId).update({ "emails.releaseNotices": releaseNotices });
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

    // -- requests the console wrote (requests.mjs) --------------------------------

    /** The queued and running requests, oldest first, at most `limit`. */
    async listOpenRequests(limit) {
      const snap = await requests
        .where("status", "in", ["queued", "running"])
        .orderBy("createdAt", "asc")
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

    /** The signed-in account `uid` as the rules would see it: {emailVerified, admin}, or null if it is gone. */
    async getAccount(uid) {
      try {
        const user = await auth.getUser(uid);
        return {
          emailVerified: user.emailVerified === true,
          admin: user.customClaims?.admin === true,
        };
      } catch {
        return null;
      }
    },

    /**
     * Whether this run may do the periodic job `name` now: true, and noted,
     * when it last ran at least `everyMs` ago. Atomic, so two runs never both do it.
     */
    claimJob(name, now, everyMs) {
      return db.runTransaction(async (tx) => {
        const ref = db.collection("state").doc("worker");
        const last = (await tx.get(ref)).data()?.[name];
        if (typeof last === "number" && now - last < everyMs) return false;
        tx.set(ref, { [name]: now }, { merge: true });
        return true;
      });
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
