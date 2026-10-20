import { describe, expect, it } from "vitest";

import {
  MAX_QTY_PER_LINE,
  cartReducer,
  clampQty,
  emptyCart,
  readStoredCart,
  writeStoredCart,
} from "@/lib/cart";
import type { MenuItem } from "@/lib/types";

const menu: MenuItem[] = [
  {
    id: "m1",
    name: "Cappuccino",
    description: "",
    price: 180,
    category: "Drinks",
    available: true,
    sortOrder: 10,
  },
  {
    id: "m2",
    name: "Butter Scone",
    description: "",
    price: 160,
    category: "Bites",
    available: true,
    sortOrder: 20,
  },
];

describe("cartReducer", () => {
  it("adds a new line", () => {
    const next = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ menuItemId: "m1", qty: 1, price: 180 });
  });

  it("merges a repeat add into the existing line", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "add", item: menu[0], qty: 2 });
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(3);
  });

  it("refuses to add an unavailable item", () => {
    const soldOut = { ...menu[0], available: false };
    expect(
      cartReducer(emptyCart(), { type: "add", item: soldOut }),
    ).toHaveLength(0);
  });

  it("takes the newest price when the price changed under the cart", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, {
      type: "add",
      item: { ...menu[0], price: 200 },
    });
    expect(cart[0].price).toBe(200);
  });

  it("increments and decrements", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "increment", menuItemId: "m1", by: 2 });
    expect(cart[0].qty).toBe(3);
    cart = cartReducer(cart, { type: "decrement", menuItemId: "m1" });
    expect(cart[0].qty).toBe(2);
  });

  it("removes the line when the quantity reaches zero", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "decrement", menuItemId: "m1" });
    expect(cart).toHaveLength(0);
  });

  it("never goes negative when decremented past zero", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "decrement", menuItemId: "m1", by: 5 });
    expect(cart).toHaveLength(0);
  });

  it("caps a single line at the max quantity", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, {
      type: "setQty",
      menuItemId: "m1",
      qty: 5000,
    });
    expect(cart[0].qty).toBe(MAX_QTY_PER_LINE);
  });

  it("removes a line explicitly", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "add", item: menu[1] });
    cart = cartReducer(cart, { type: "remove", menuItemId: "m1" });
    expect(cart.map((l) => l.menuItemId)).toEqual(["m2"]);
  });

  it("clears everything", () => {
    let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    cart = cartReducer(cart, { type: "clear" });
    expect(cart).toHaveLength(0);
  });

  describe("reconcile against a live menu update", () => {
    it("drops an item that just sold out", () => {
      let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
      cart = cartReducer(cart, { type: "add", item: menu[1] });
      cart = cartReducer(cart, {
        type: "reconcile",
        menu: [menu[0], { ...menu[1], available: false }],
      });
      expect(cart.map((l) => l.menuItemId)).toEqual(["m1"]);
    });

    it("drops an item the owner deleted", () => {
      let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
      cart = cartReducer(cart, { type: "reconcile", menu: [] });
      expect(cart).toHaveLength(0);
    });

    it("picks up a new price", () => {
      let cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
      cart = cartReducer(cart, {
        type: "reconcile",
        menu: [{ ...menu[0], price: 210 }],
      });
      expect(cart[0].price).toBe(210);
    });
  });
});

describe("cart persistence", () => {
  it("survives a reload for the same table", () => {
    const cart = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    writeStoredCart(3, cart);
    expect(readStoredCart(3)).toEqual(cart);
  });

  it("keeps tables separate", () => {
    const three = cartReducer(emptyCart(), { type: "add", item: menu[0] });
    writeStoredCart(3, three);
    expect(readStoredCart(4)).toEqual([]);
  });

  it("returns an empty cart for junk in storage", () => {
    localStorage.setItem("cafe-qr-order.cart.v1.t3", "not json");
    expect(readStoredCart(3)).toEqual([]);
  });

  it("rejects malformed lines on read", () => {
    localStorage.setItem(
      "cafe-qr-order.cart.v1.t3",
      JSON.stringify([{ menuItemId: "m1" }, { nope: true }]),
    );
    expect(readStoredCart(3)).toEqual([]);
  });

  it("clamps a stored quantity that is out of range", () => {
    localStorage.setItem(
      "cafe-qr-order.cart.v1.t3",
      JSON.stringify([
        {
          menuItemId: "m1",
          name: "Cappuccino",
          price: 180,
          qty: 9999,
          category: "Drinks",
        },
      ]),
    );
    expect(readStoredCart(3)[0].qty).toBe(clampQty(MAX_QTY_PER_LINE));
  });
});
