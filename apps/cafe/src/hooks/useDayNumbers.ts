"use client";

/**
 * Runs the day-number assigner (src/lib/day-number.ts) over the staff board's
 * live list: any order on the board without today's number gets the next one,
 * oldest first, one at a time.
 *
 * Only the board runs this. It needs a staff session (the rules refuse anyone
 * else), and the board is the one screen that is open all service anyway.
 * Returns why numbering has stopped, if it has, so the board can say so; the
 * board keeps working either way.
 */

import { useEffect, useRef, useState } from "react";

import { useOrderRepo } from "@/components/providers/DataProvider";
import {
  createDayNumberAssigner,
  type DayNumberAssigner,
} from "@/lib/day-number";
import type { Order } from "@/lib/types";

export function useDayNumbers(
  orders: readonly Order[],
  enabled: boolean,
): { stalled: Error | null } {
  const repo = useOrderRepo();
  const [stalled, setStalled] = useState<Error | null>(null);
  const assigner = useRef<DayNumberAssigner | null>(null);

  useEffect(() => {
    if (!repo || !enabled) return;
    // A fresh assigner starts healthy. Without this, a note from the previous
    // session (sign out, sign in as someone else, no reload) stayed up.
    setStalled(null);
    const a = createDayNumberAssigner({
      assign: (id) => repo.assignDayNumber(id),
      onStall: setStalled,
    });
    assigner.current = a;
    return () => {
      a.stop();
      assigner.current = null;
    };
  }, [repo, enabled]);

  useEffect(() => {
    assigner.current?.update(orders);
  }, [orders, repo, enabled]);

  return { stalled: enabled ? stalled : null };
}
