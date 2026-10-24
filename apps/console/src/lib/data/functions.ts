/**
 * The Firebase side of callables.ts: a `Call` over the Functions SDK, for the
 * console's Firebase app. Only reached through the dynamic import in
 * firestore.ts, so a demo-mode visitor never downloads it.
 */

import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { EMULATOR_HOSTS, functionsRegion } from "../config";
import type { Call } from "./callables";
import type { FirebaseHandles } from "./firebase";

const emulated = new WeakSet<Functions>();

export function firebaseCall(
  connect: () => Promise<FirebaseHandles>,
  emulators: boolean,
): Call {
  return async (name, data) => {
    const { auth } = await connect();
    const functions = getFunctions(auth.app, functionsRegion);
    if (emulators && !emulated.has(functions)) {
      connectFunctionsEmulator(
        functions,
        EMULATOR_HOSTS.host,
        EMULATOR_HOSTS.functionsPort,
      );
      emulated.add(functions);
    }
    return (await httpsCallable(functions, name)(data)).data;
  };
}
