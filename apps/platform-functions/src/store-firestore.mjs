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
 *   releases/{version}            read
 *   deployments/{id}              created, claimed and updated here
 */
import { FieldValue } from "firebase-admin/firestore";

const ms = (value) =>
  typeof value?.toMillis === "function"
    ? value.toMillis()
    : value instanceof Date
      ? value.getTime()
      : value;

export function createFirestoreStore({ db, auth }) {
  const cafeRef = (id) => db.collection("cafes").doc(id);
  const deployments = db.collection("deployments");
  const deploymentOf = (snap) => {
    if (!snap.exists) return null;
    const data = snap.data();
    return { ...data, id: snap.id, createdAt: ms(data.createdAt) };
  };

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
