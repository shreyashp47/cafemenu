"use client";

/**
 * New-order chime.
 *
 * Requirements.md §5.3 wants an audible/vibration alert, and the docs/anime-theme.md §5
 * insists it be more than a toast. WebAudio is used instead of an <audio> file
 * so there is nothing to download and nothing to ship — and because browsers
 * block audio until a user gesture, `unlock()` is wired to the first tap.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "cafe-qr-order.staff.muted.v1";

export function useOrderChime() {
  const [muted, setMuted] = useState(false);
  // The sound is actually playable (the AudioContext is running).
  const [armed, setArmed] = useState(false);
  // The page has had a user gesture, which is all vibration needs.
  const [touched, setTouched] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setMuted(globalThis.localStorage?.getItem(STORAGE_KEY) === "1");
    } catch {
      setMuted(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (muted) globalThis.localStorage?.setItem(STORAGE_KEY, "1");
      else globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }, [muted]);

  const context = useCallback(() => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) {
      const ctx = new Ctor();
      // A context can also start (or be suspended again) outside unlock(),
      // for example when the tab comes back to the foreground.
      ctx.addEventListener?.("statechange", () =>
        setArmed(ctx.state === "running"),
      );
      ctxRef.current = ctx;
    }
    return ctxRef.current;
  }, []);

  /**
   * Try to switch the sound on from a user gesture. `armed` only turns true
   * once the context is actually running: in Chrome a touch pointerdown is not
   * a user activation for audio (pointerup, touchend and click are), so a
   * resume() from it can quietly do nothing, and the board must not claim the
   * sound is on while it is blocked. Callers may call this on every gesture
   * until `armed` is true.
   */
  const unlock = useCallback(() => {
    setTouched(true);
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "running") {
      setArmed(true);
      return;
    }
    const check = () => setArmed(ctx.state === "running");
    try {
      void Promise.resolve(ctx.resume()).then(check, () => {});
    } catch {
      /* resume refused */
    }
  }, [context]);

  /** Two-note bell: bright, short, and unmistakably a new order. */
  const chime = useCallback(() => {
    if (muted) return;
    const ctx = context();
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // quick attack, exponential decay — reads as a chime, not a beep
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    for (const [index, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + index * 0.14);
      osc.stop(now + 0.75);
    }
  }, [context, muted]);

  const buzz = useCallback(() => {
    // Only vibrate once the page has been interacted with — otherwise the
    // browser blocks the call and logs a console error for no benefit.
    if (muted || !touched) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch {
        /* unsupported */
      }
    }
  }, [muted, touched]);

  return { muted, setMuted, armed, unlock, chime, buzz };
}
