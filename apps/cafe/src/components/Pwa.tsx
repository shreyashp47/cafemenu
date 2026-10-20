"use client";

/**
 * Service-worker registration + "add to home screen" hint.
 *
 * docs/requirements.md §3: "No app installs required for customers or staff
 * (mobile web / PWA)". A PWA install is offered, never required — the app is
 * fully usable in a plain browser tab.
 */

import { useCallback, useEffect, useState } from "react";

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/Button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const HINT_KEY = "cafe-qr-order.install-hint-dismissed.v1";

/** How often a long-lived tab asks for a new sw.js. The file is tiny. */
const UPDATE_CHECK_MS = 60 * 60_000;

/**
 * Registers the service worker and tells the user when a new build has taken
 * over.
 *
 * The browser only re-checks sw.js on a navigation (or once a day), and the
 * counter phone sits on one page all shift, so this also asks for an update
 * hourly and whenever the tab comes back into view.
 *
 * A new worker takes control straight away (public/sw.js skips waiting), but
 * the page itself is never reloaded automatically. On the staff board a reload
 * would silently disarm the order sound — browsers only allow audio after a tap —
 * and could land in the middle of a status change. So the page shows a small
 * "new version" bar and the person holding the phone picks the moment.
 */
export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    // The first install also fires controllerchange (clients.claim), and that
    // one is not an update: there was no old version on screen.
    let hadController = Boolean(sw.controller);
    const onControllerChange = () => {
      if (hadController) setUpdateReady(true);
      hadController = true;
    };
    sw.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | null = null;
    const check = () => {
      registration?.update().catch(() => {
        /* offline: try again next time */
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);

    const register = () => {
      sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
        })
        .catch(() => {
          /* offline support is a bonus, never a requirement */
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => {
      window.removeEventListener("load", register);
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!updateReady) return null;
  return <UpdateBar onDismiss={() => setUpdateReady(false)} />;
}

export function UpdateBar({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="safe-t pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-2"
    >
      <div className="border-secondary bg-paper shadow-card pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border-2 py-1.5 pr-1.5 pl-3">
        <p className="text-ink min-w-0 flex-1 text-sm font-semibold">
          A new version is ready.
        </p>
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Not now"
          className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function InstallHint({ appName }: { appName: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    let seen = false;
    try {
      seen = globalThis.localStorage?.getItem(HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    setDismissed(seen);
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari reports standalone differently
        (navigator as { standalone?: boolean }).standalone === true,
    );

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      globalThis.localStorage?.setItem(HINT_KEY, "1");
    } catch {
      /* storage unavailable: the hint just reappears next visit */
    }
  }, []);

  if (!deferred || dismissed || standalone) return null;

  return (
    <div className="shell-wide mb-3">
      <div className="border-secondary/50 bg-highlight-soft/40 flex items-center gap-3 rounded-lg border-2 border-dashed p-3">
        <Mascot size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-ink font-semibold">Install {appName}</p>
          <p className="text-muted text-sm">
            Add it to your home screen for a full-screen board. No app store, no
            install required to use it.
          </p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            await deferred?.prompt();
            await deferred?.userChoice;
            dismiss();
          }}
        >
          Install
        </Button>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Dismiss install hint"
          className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
