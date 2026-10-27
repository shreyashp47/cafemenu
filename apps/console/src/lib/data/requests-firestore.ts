/**
 * The requests (./request-backend.ts) kept in the platform's Firestore: the
 * write the rules allow, and the live views. Loaded only through firestore.ts.
 */

import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { parseRequest } from "../platform/parse";
import { newRequestRecord } from "../platform/records";
import type { FirebaseHandles } from "./firebase";
import type { RequestTransport } from "./request-backend";
import {
  CodedError,
  REQUEST_HISTORY,
  type ErrorListener,
  type RequestRepository,
  type Unsubscribe,
} from "./types";

type Connect = () => Promise<FirebaseHandles>;

/** Runs `start` once Firebase is ready; unsubscribing before that leaks nothing. */
function whenReady(
  connect: Connect,
  start: (handles: FirebaseHandles) => Unsubscribe,
  onError?: ErrorListener,
): Unsubscribe {
  let stop: Unsubscribe | null = null;
  let cancelled = false;
  connect().then(
    (handles) => {
      if (!cancelled) stop = start(handles);
    },
    (error) =>
      onError?.(error instanceof Error ? error : new Error(String(error))),
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

export function firestoreRequestTransport(connect: Connect): RequestTransport {
  return {
    async create(cafeId, kind, params) {
      const { auth, db } = await connect();
      const user = auth.currentUser;
      if (!user) throw new CodedError("unauthenticated", "Sign in first.");
      const ref = await addDoc(
        collection(db, "requests"),
        newRequestRecord(user, cafeId, kind, params, serverTimestamp()),
      );
      return ref.id;
    },
    watch(id, listener, onError) {
      return whenReady(
        connect,
        ({ db }) =>
          onSnapshot(
            doc(db, "requests", id),
            (snap) =>
              listener(
                snap.exists()
                  ? parseRequest(
                      snap.id,
                      snap.data({ serverTimestamps: "estimate" }),
                    )
                  : null,
              ),
            (error) => onError(error),
          ),
        onError,
      );
    },
  };
}

export function firestoreRequestRepo(connect: Connect): RequestRepository {
  return {
    subscribeForCafe(cafe, listener, onError) {
      return whenReady(
        connect,
        ({ db }) =>
          onSnapshot(
            query(
              collection(db, "requests"),
              // The owner filter is what lets the rules prove the query only
              // returns this owner's requests (firestore.indexes.json).
              where("ownerUid", "==", cafe.ownerUid),
              where("cafeId", "==", cafe.id),
              orderBy("createdAt", "desc"),
              limit(REQUEST_HISTORY),
            ),
            (snap) =>
              listener(
                snap.docs
                  .map((d) =>
                    parseRequest(
                      d.id,
                      d.data({ serverTimestamps: "estimate" }),
                    ),
                  )
                  .filter((r) => r !== null),
              ),
            (error) => onError?.(error),
          ),
        onError,
      );
    },
  };
}
