"use client";

/**
 * The data a page needs, as React state: the storage backend once it has
 * loaded, and the signed-in account once Auth has said who it is.
 */

import { useEffect, useState } from "react";
import { backend } from "../config";
import type { PlatformUser } from "../platform/model";
import { demoBundle, loadBundle } from "./index";
import type { DataBundle } from "./types";

/** The backend; straight away in demo mode, after the SDK loads otherwise. */
export function useDataBundle(): DataBundle | null {
  const [bundle, setBundle] = useState<DataBundle | null>(
    backend === "demo" ? demoBundle : null,
  );
  useEffect(() => {
    if (bundle) return;
    let live = true;
    loadBundle().then((loaded) => {
      if (live) setBundle(loaded);
    });
    return () => {
      live = false;
    };
  }, [bundle]);
  return bundle;
}

export interface AccountState {
  /** False until Auth has answered, so nothing flashes as signed out. */
  ready: boolean;
  user: PlatformUser | null;
}

export function useAccount(data: DataBundle | null): AccountState {
  const [state, setState] = useState<AccountState>({
    ready: false,
    user: null,
  });
  useEffect(() => {
    if (!data) return;
    return data.auth.subscribe((user) => setState({ ready: true, user }));
  }, [data]);
  return state;
}
