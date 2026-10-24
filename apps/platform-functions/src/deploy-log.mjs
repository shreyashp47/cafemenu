/**
 * The deployer's DeployLog (packages/deployer/src/deploy-log.mjs) on the
 * platform's Firestore, for one cafe: the answer to TODO(#28) there.
 *
 *   get()      the cafe's record: what is live and what came before it, with
 *              the Hosting version and rules each release went out as. Kept
 *              in `cafes/{id}/private/deployRecord`, which no rule lets a
 *              client read, since it has no business being the owner's.
 *   record()   keeps the new record, and puts the versions on the cafe
 *              (`release.current`, `release.previous`) for the console. The
 *              deployer's own Deployment goes to `onDeployment`: the worker
 *              owns `deployments/{id}`, so progress and results are one write.
 */
export function createPlatformDeployLog({ store, cafeId, onDeployment }) {
  return {
    path: "the platform's deploy record",
    get: () => store.getRecord(cafeId),
    async record({ deployment, cafe }) {
      if (cafe) {
        await store.setRecord(cafeId, cafe);
        await store.setCafeRelease(cafeId, {
          current: cafe.current?.version ?? null,
          previous: cafe.previous?.version ?? null,
        });
      }
      onDeployment?.(deployment);
    },
  };
}
