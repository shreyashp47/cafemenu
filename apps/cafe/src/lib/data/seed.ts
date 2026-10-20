import { getCafeName, getCafeTagline } from "../config";
import type { MenuItem } from "../types";

/**
 * Seed menu, used when the demo store boots empty. Written as a cafe-neutral
 * but plausible small-cafe menu: three categories so the category rail and the
 * category icons have something real to show.
 */
export const SEED_MENU: MenuItem[] = [
  {
    id: "m-espresso",
    name: "Double Espresso",
    description: "Two shots, thick crema, no apologies.",
    price: 120,
    category: "Drinks",
    available: true,
    art: "espresso",
    sortOrder: 10,
  },
  {
    id: "m-cappuccino",
    name: "Cappuccino",
    description: "Silky microfoam, dusted with cocoa.",
    price: 180,
    category: "Drinks",
    available: true,
    art: "cappuccino",
    sortOrder: 20,
  },
  {
    id: "m-cold-brew",
    name: "Cold Brew Tonic",
    description: "18-hour steep, bright and citrusy.",
    price: 220,
    category: "Drinks",
    available: true,
    art: "coldbrew",
    sortOrder: 30,
  },
  {
    id: "m-matcha",
    name: "Iced Matcha Latte",
    description: "Ceremonial matcha, oat milk, lightly sweet.",
    price: 240,
    category: "Drinks",
    available: true,
    art: "matcha",
    sortOrder: 40,
  },
  {
    id: "m-tea",
    name: "Masala Chai",
    description: "Ginger, cardamom, a little bite of clove.",
    price: 140,
    category: "Drinks",
    available: true,
    art: "chai",
    sortOrder: 50,
  },
  {
    id: "m-scone",
    name: "Butter Scone",
    description: "Baked this morning. Butter, jam, repeat.",
    price: 160,
    category: "Bites",
    available: true,
    art: "scone",
    sortOrder: 60,
  },
  {
    id: "m-toastie",
    name: "Cheese & Chilli Toastie",
    description: "Molten cheese, jalapeño, toasted sourdough.",
    price: 260,
    category: "Bites",
    available: true,
    art: "toastie",
    sortOrder: 70,
  },
  {
    id: "m-sandwich",
    name: "Pesto Paneer Sandwich",
    description: "Grilled paneer, basil pesto, rocket.",
    price: 280,
    category: "Bites",
    available: true,
    art: "sandwich",
    sortOrder: 80,
  },
  {
    id: "m-cookie",
    name: "Sea-Salt Chocolate Cookie",
    description: "Warm, chewy, sea salt on top.",
    price: 120,
    category: "Sweets",
    available: true,
    art: "cookie",
    sortOrder: 90,
  },
  {
    id: "m-cheesecake",
    name: "Burnt Basque Cheesecake",
    description: "Wobbly, burnt top, barely sweet.",
    price: 320,
    category: "Sweets",
    available: true,
    art: "cheesecake",
    sortOrder: 100,
  },
  {
    id: "m-soft-serve",
    name: "Soft Serve Cone",
    description: "Vanilla or dark chocolate. Ask for a swirl.",
    price: 150,
    category: "Sweets",
    available: false,
    art: "softserve",
    sortOrder: 110,
  },
  {
    id: "m-brownie",
    name: "Fudge Brownie",
    description: "Fudgy middle, crackly top.",
    price: 180,
    category: "Sweets",
    available: true,
    art: "brownie",
    sortOrder: 120,
  },
];

export const SEED_OFFER = {
  enabled: true,
  text: "Free refills on all hot drinks before 11am",
} as const;

export const DEMO_STAFF_USER = {
  uid: "demo-staff",
  email: "staff@demo.cafe",
  role: "staff" as const,
  displayName: "Barista",
};

export const DEMO_OWNER_USER = {
  uid: "demo-owner",
  email: "owner@demo.cafe",
  role: "owner" as const,
  displayName: "Cafe Owner",
};

export const DEMO_CREDENTIALS = {
  staff: { email: "staff@demo.cafe", password: "cafe1122" },
  owner: { email: "owner@demo.cafe", password: "cafe1122" },
} as const;

export const SEED_TITLE = getCafeName();
export const SEED_TAGLINE = getCafeTagline();
