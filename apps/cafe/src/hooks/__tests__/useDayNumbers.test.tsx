/**
 * The board's numbering note has to clear when a new session starts, not only
 * on a reload.
 */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataProvider } from "@/components/providers/DataProvider";
import { useDayNumbers } from "@/hooks/useDayNumbers";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import { demoSetTableOpenUntil, resetDemoStore } from "@/lib/data/demo-store";
import type { Order } from "@/lib/types";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DataProvider>{children}</DataProvider>
);

beforeEach(async () => {
  resetDemoStore();
  localStorage.clear();
  await demoAuthRepo.signOut();
});

describe("useDayNumbers", () => {
  it("clears a stale 'numbering stopped' note when a new session starts", async () => {
    // An open table's order: one waiting for the counter is not numbered.
    demoSetTableOpenUntil(2, Date.now() + 3_600_000);
    const order = await demoOrderRepo.create({
      tableNumber: 2,
      items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
      total: 200,
      status: "preparing",
    });
    const orders: Order[] = [order];
    vi.useFakeTimers();
    try {
      // Signed out: the demo refuses, like the rules. After three refusals the
      // board is told numbering stopped.
      const { result, rerender } = renderHook(
        ({ on }: { on: boolean }) => useDayNumbers(orders, on),
        { wrapper, initialProps: { on: true } },
      );
      for (let i = 0; i < 4; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
      }
      expect(result.current.stalled?.message).toMatch(/permission/i);

      // Sign out and back in (as staff) without a reload.
      rerender({ on: false });
      await demoAuthRepo.signInWithPin("1122");
      rerender({ on: true });
      expect(result.current.stalled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
