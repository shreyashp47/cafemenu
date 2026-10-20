"use client";

/**
 * Cart state for a table, persisted so a reload mid-order never loses a basket
 * (docs/requirements.md §5.2, "cart-based ordering per table session").
 *
 * The reducer itself lives in src/lib/cart.ts so it can be tested without React.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  cartReducer,
  clearStoredCart,
  readStoredCart,
  writeStoredCart,
} from "@/lib/cart";
import { cartCount, cartTotal } from "@/lib/money";
import type { CartLine, MenuItem } from "@/lib/types";

export function useCart(tableNumber: number, menu: MenuItem[]) {
  const [lines, dispatch] = useReducer(cartReducer, tableNumber, (table) =>
    readStoredCart(table),
  );
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  // Re-hydrate if the table changes (customer scans a different QR).
  useEffect(() => {
    dispatch({ type: "replace", lines: readStoredCart(tableNumber) });
    hydrated.current = true;
    setReady(true);
  }, [tableNumber]);

  // Persist on every change, but only after hydration so we never wipe a stored
  // cart with the initial empty state.
  useEffect(() => {
    if (!hydrated.current) return;
    writeStoredCart(tableNumber, lines);
  }, [lines, tableNumber]);

  // A live menu update can sell an item out from under the cart.
  //
  // This keys off a *signature* rather than the array identity: callers
  // legitimately build a fresh array on every render (`useMenu()` returns a
  // stable reference, but a test or a parent component might not), and
  // depending on identity here would dispatch on every render and loop.
  const menuRef = useRef(menu);
  menuRef.current = menu;

  const menuSignature = menu
    .map((i) => `${i.id}:${i.price}:${i.available ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    if (menuRef.current.length === 0) return;
    dispatch({ type: "reconcile", menu: menuRef.current });
  }, [menuSignature]);

  const add = useCallback((item: MenuItem, qty = 1) => {
    dispatch({ type: "add", item, qty });
  }, []);

  const increment = useCallback(
    (menuItemId: string, by = 1) =>
      dispatch({ type: "increment", menuItemId, by }),
    [],
  );
  const decrement = useCallback(
    (menuItemId: string, by = 1) =>
      dispatch({ type: "decrement", menuItemId, by }),
    [],
  );
  const setQty = useCallback(
    (menuItemId: string, qty: number) =>
      dispatch({ type: "setQty", menuItemId, qty }),
    [],
  );
  const remove = useCallback(
    (menuItemId: string) => dispatch({ type: "remove", menuItemId }),
    [],
  );
  const clear = useCallback(() => {
    dispatch({ type: "clear" });
    clearStoredCart(tableNumber);
  }, [tableNumber]);

  /** Put a previous order back into the cart ("order again"). */
  const reAdd = useCallback(
    (previous: Array<Pick<CartLine, "menuItemId" | "qty">>) => {
      const byId = new Map(menu.map((i) => [i.id, i]));
      for (const line of previous) {
        const item = byId.get(line.menuItemId);
        if (item?.available) add(item, line.qty);
      }
    },
    [add, menu],
  );

  return useMemo(
    () => ({
      lines,
      ready,
      total: cartTotal(lines),
      count: cartCount(lines),
      add,
      increment,
      decrement,
      setQty,
      remove,
      clear,
      reAdd,
      isEmpty: lines.length === 0,
    }),
    [lines, ready, add, increment, decrement, setQty, remove, clear, reAdd],
  );
}

export type UseCart = ReturnType<typeof useCart>;
