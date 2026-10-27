/**
 * A RequestRepository in memory, for tests: `create` records what the
 * console asks for, and `answer` plays the backend's part, moving a request
 * on as the worker would (apps/platform-functions/src/worker/).
 */

import type { RequestRepository } from "@/lib/data/types";
import type { BackendRequest } from "@/lib/platform/model";

export function fakeRequests(by = "u1") {
  const requests = new Map<string, BackendRequest>();
  const listeners = new Map<string, Set<(r: BackendRequest) => void>>();
  let counter = 0;
  const fire = (id: string) => {
    const request = requests.get(id);
    if (request)
      for (const listener of listeners.get(id) ?? []) listener(request);
  };
  const repo: RequestRepository = {
    async create({ cafeId, kind, params = {} }) {
      counter += 1;
      const id = `req${counter}`;
      requests.set(id, {
        id,
        cafeId,
        kind,
        params,
        status: "queued",
        by,
        createdAt: Date.now(),
        progress: null,
        result: null,
        error: null,
        errorCode: null,
        deploymentId: null,
        notBefore: null,
        finishedAt: null,
      });
      return id;
    },
    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set();
      set.add(listener);
      listeners.set(id, set);
      queueMicrotask(() => {
        const request = requests.get(id);
        if (request && set.has(listener)) listener(request);
      });
      return () => set.delete(listener);
    },
    subscribeForCafe(cafe, asker, listener) {
      listener(
        [...requests.values()].filter(
          (r) => r.cafeId === cafe.id && r.by === asker,
        ),
      );
      return () => {};
    },
  };
  return {
    repo,
    requests,
    /** The backend's part: changes request `id` and tells its listeners. */
    answer(id: string, patch: Partial<BackendRequest>) {
      const request = requests.get(id);
      if (!request) throw new Error(`no request ${id}`);
      requests.set(id, { ...request, ...patch });
      fire(id);
    },
    last: () => [...requests.values()].at(-1) ?? null,
  };
}
